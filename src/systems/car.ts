/**
 * Drivable getaway van — the gameplay half of Phase 7 (roadmap §7).
 *
 * `src/physics/car.ts` owns the body math; this owns everything the *player* experiences:
 * getting in and out, the controls, the engine you can hear, running guards over, crashing
 * through weak walls, and the guards' reaction to a two-tonne threat bearing down on them.
 *
 * The van is a normal `jo_sprite` (`getawaycar`) that also carries a physics box. While the
 * hero is driving, the hero's own body is pulled out of the world and the hero sprite is
 * hidden; the hero's `x`/`y` are pinned to the van so the guards keep aiming at the van and
 * the fog keeps sweeping from it. Getting out puts the hero back into the world at a clear
 * spot beside the door.
 *
 * Reads the same window globals the rest of the legacy game does (`hero`, `guards`, `grid`,
 * `keys`, `camera`, ...). No test imports this module, so those globals are always present
 * when it runs.
 */

import { gameClock } from '../core/clock';
import { physics } from '../physics';
import { bloodParticleSplatter } from './particles';

// --- tuning -----------------------------------------------------------------

/** Collision box, in pixels. The van sprite is 128×128; the body is the car shape inside it. */
const CAR_LENGTH_PX = 108; // along the direction of travel
const CAR_WIDTH_PX = 58;

/**
 * The van art points **up** (north); a physics angle of 0 points along +x (east). So the
 * sprite is drawn a quarter-turn ahead of the body — add this to the body angle to get the
 * sprite's rotation. A body angle of -π/2 therefore parks the van pointing up, exactly how
 * it looked as a static prop.
 */
const CAR_ART_OFFSET = Math.PI / 2;

/** How close (px, centre to centre) the hero must be to the van to climb in. */
const ENTER_DISTANCE_PX = 96;

/** Closing speed (px/s) at which hitting a guard is lethal rather than a nudge. */
const RUN_OVER_SPEED_PX = 120;
/** How hard, and how long, a run-over throws the body. */
const KNOCKBACK_SPEED_PX = 420;
const KNOCKBACK_MS = 300;

/** Below this closing speed (px/s) the van bumps a wall without damaging it. */
const BREACH_SPEED_PX = 100;
/** Breach damage per px/s of impact, clamped — a full-speed ram levels brick, a nudge does not. */
const BREACH_DAMAGE_PER_SPEED = 0.2;
const BREACH_DAMAGE_MAX = 80;

/** A guard has ~half a second to jump clear once the van is bearing down on them. */
const DODGE_MS = 500;
/** Only guards inside this cone ahead of the van (cosine of the half-angle) dodge. */
const DODGE_CONE_DOT = 0.5; // ~60° half-angle
/** ...and only if impact is less than this many seconds away. */
const DODGE_TIME_TO_IMPACT_S = 1.2;
/** ...and within this range (px). */
const DODGE_RANGE_PX = 240;
/** How far to the side a dodging guard lunges (px). */
const DODGE_DISTANCE_PX = 60;
/** The van must be moving at least this fast (px/s) to threaten anyone. */
const DODGE_MIN_SPEED_PX = 80;

/** Engine noise draws guards; re-announce the van's position no more than this often. */
const NOISE_INTERVAL_MS = 700;
/** ...and only while actually moving. */
const NOISE_MIN_SPEED_PX = 60;

/** Camera in car mode: zoom out and lead the car by its velocity. */
const CAR_ZOOM_OUT = 1 / 1.3;
const CAR_LOOKAHEAD_S = 0.5;
const CAR_CAM_SMOOTH = 0.12;

// --- state ------------------------------------------------------------------

/** The van sprite (an ActorOwner: has x, y, and a `sprite`/`rad`). Set by `initCar`. */
let van: any = null;
let active = false;
let lastNoiseAt = -Infinity;

/** Smoothed camera aim point while driving. */
const camLead = { x: 0, y: 0 };

/** Corpses still sliding from a run-over: position integrated down over a few frames. */
interface Knockback {
  sprite: any;
  vx: number;
  vy: number;
  ttl: number;
}
const knockbacks: Knockback[] = [];

// --- engine sound (Web Audio) ----------------------------------------------
// A single filtered sawtooth whose pitch rises with speed. Not a sample — synthesised so
// no engine audio asset is needed — but it satisfies "engine sound pitch ∝ speed" and gives
// the van an audible presence. Absent in a headless/no-AudioContext environment.

let audioCtx: any = null;
let engineOsc: any = null;
let engineGain: any = null;
let engineFilter: any = null;

function startEngine(): void {
  try {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    if (!audioCtx) audioCtx = new Ctx();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    engineOsc = audioCtx.createOscillator();
    engineOsc.type = 'sawtooth';
    engineFilter = audioCtx.createBiquadFilter();
    engineFilter.type = 'lowpass';
    engineFilter.frequency.value = 600;
    engineGain = audioCtx.createGain();
    engineGain.gain.value = 0;
    engineOsc.connect(engineFilter);
    engineFilter.connect(engineGain);
    engineGain.connect(audioCtx.destination);
    engineOsc.frequency.value = 45;
    engineOsc.start();
  } catch {
    // No audio available — the van just runs silent.
  }
}

function updateEngine(speedRatio: number): void {
  if (!engineOsc || !engineGain || !audioCtx) return;
  const master = typeof (window as any).volume_master === 'number' ? (window as any).volume_master : 1;
  const now = audioCtx.currentTime;
  // Idle rumble at 45 Hz climbing to ~150 Hz flat-out; volume swells a little with speed.
  engineOsc.frequency.setTargetAtTime(45 + speedRatio * 105, now, 0.05);
  engineGain.gain.setTargetAtTime((0.05 + speedRatio * 0.06) * master, now, 0.05);
}

function stopEngine(): void {
  try {
    if (engineOsc) engineOsc.stop();
  } catch {
    /* already stopped */
  }
  engineOsc = null;
  engineGain = null;
  engineFilter = null;
}

// --- lifecycle --------------------------------------------------------------

/**
 * Turn the parked van prop into a drivable body. Called from `setup_map` right after the
 * van sprite is created. `angle` is the initial body angle (‑π/2 = parked pointing up).
 */
export function initCar(owner: any, angle: number): void {
  van = owner;
  active = false;
  if (owner.sprite && owner.sprite.anchor) {
    owner.sprite.anchor.x = 0.5;
    owner.sprite.anchor.y = 0.5;
  }
  physics.addCar(owner, CAR_LENGTH_PX, CAR_WIDTH_PX, angle);
  owner.rad = angle + CAR_ART_OFFSET;
  camLead.x = owner.x;
  camLead.y = owner.y;
}

/** Drop all car state between runs. */
export function resetCarSystem(): void {
  stopEngine();
  van = null;
  active = false;
  lastNoiseAt = -Infinity;
  knockbacks.length = 0;
}

export function isInCar(): boolean {
  return active;
}

// --- enter / exit -----------------------------------------------------------

/** The interact key (E): climb in if next to the van, climb out if already driving. */
export function toggleCar(): void {
  if (!van) return;
  if (active) {
    exitCar();
  } else {
    if (!hero.alive) return;
    if (get_distance(hero.x, hero.y, van.x, van.y) <= ENTER_DISTANCE_PX) enterCar();
    else newFloatingMessage('Get closer to the van', { x: hero.x, y: hero.y }, '#FFaa00');
  }
}

function enterCar(): void {
  active = true;
  hero.inCar = true;
  // Put the gun away and take the hero body out of the world; the hero rides inside the van.
  hero.gunOut = false;
  if (typeof setHeroImage === 'function') setHeroImage();
  physics.removeActor(hero);
  hero.sprite.visible = false;
  // The hero now *is* the van as far as everyone else is concerned.
  hero.x = van.x;
  hero.y = van.y;

  startEngine();

  // The engine is loud: every guard hears it start and turns toward the van, so anyone who
  // watched the hero get in transfers their attention to the car (roadmap §7).
  if (typeof alert_all_guards === 'function') alert_all_guards();
  hero.setLastSeen(null);

  const msg = hero.carry
    ? "You're in the van with the loot — drive to the escape zone!"
    : "You're in the van! (E to get out)";
  newMessage(msg);
}

/** Points to try dropping the hero, in order: both sides of the van, then behind, then front. */
function exitCandidates(): Array<{ x: number; y: number }> {
  const st = physics.getCarState(van);
  const angle = st ? st.angle : van.rad - CAR_ART_OFFSET;
  const fx = Math.cos(angle);
  const fy = Math.sin(angle);
  const px = -fy; // left normal
  const py = fx;
  const side = CAR_WIDTH_PX / 2 + hero.radius + 6;
  const ends = CAR_LENGTH_PX / 2 + hero.radius + 6;
  return [
    { x: van.x + px * side, y: van.y + py * side },
    { x: van.x - px * side, y: van.y - py * side },
    { x: van.x - fx * ends, y: van.y - fy * ends },
    { x: van.x + fx * ends, y: van.y + fy * ends },
  ];
}

function exitCar(): void {
  const spot = exitCandidates().find((s) => physics.spotClearForActor(s.x, s.y, hero.radius));
  if (!spot) {
    newFloatingMessage('No room to get out!', { x: van.x, y: van.y }, '#FFaa00');
    return;
  }
  active = false;
  hero.inCar = false;
  stopEngine();
  hero.x = spot.x;
  hero.y = spot.y;
  physics.addHero(hero, hero.radius);
  physics.teleport(hero, spot.x, spot.y);
  hero.sprite.visible = true;
  hero.moving = true;
  newMessage('Out of the van.');
}

// --- per-step (before the physics step) -------------------------------------

/**
 * Apply the driver's input and set up guard reactions. Runs before `physics.step`, so the
 * drive force lands this step and the guards see the threat this step.
 */
export function updateCarPreStep(): void {
  if (!van || !active) return;

  physics.driveCar(van, {
    throttle: keys.w ? 1 : keys.s ? -1 : 0,
    steer: keys.d ? 1 : keys.a ? -1 : 0,
    handbrake: !!keys.space,
  });

  const st = physics.getCarState(van);
  if (!st) return;

  // Keep the hero pinned to the van so guard vision, gunfire and last-seen all target it.
  hero.x = st.x;
  hero.y = st.y;

  // Engine noise: while moving fast, re-broadcast the van's position so guards converge on it.
  if (st.speed >= NOISE_MIN_SPEED_PX) {
    const now = gameClock.now();
    if (now - lastNoiseAt >= NOISE_INTERVAL_MS) {
      lastNoiseAt = now;
      hero.setLastSeen(null);
    }
  }

  triggerDodges(st);
}

/** Send guards standing in the van's path into a short perpendicular dodge. */
function triggerDodges(st: { x: number; y: number; vx: number; vy: number; speed: number }): void {
  if (st.speed < DODGE_MIN_SPEED_PX || typeof guards === 'undefined' || !guards) return;
  const fx = st.vx / st.speed;
  const fy = st.vy / st.speed;
  const now = gameClock.now();
  for (let i = 0; i < guards.length; i++) {
    const guard = guards[i];
    if (!guard.alive || guard.being_choked_out) continue;
    const dx = guard.x - st.x;
    const dy = guard.y - st.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > DODGE_RANGE_PX || dist < 1) continue;
    const ahead = dx * fx + dy * fy; // px in front of the van along its heading
    if (ahead <= 0) continue; // behind the van
    if (ahead / dist < DODGE_CONE_DOT) continue; // outside the danger cone
    if (ahead / st.speed > DODGE_TIME_TO_IMPACT_S) continue; // not imminent
    // Lunge to whichever side the guard is already on, away from the van's centre-line.
    const perpX = -fy;
    const perpY = fx;
    const sideSign = dx * perpX + dy * perpY >= 0 ? 1 : -1;
    guard.dodgeUntil = now + DODGE_MS;
    guard.target = {
      x: guard.x + perpX * sideSign * DODGE_DISTANCE_PX,
      y: guard.y + perpY * sideSign * DODGE_DISTANCE_PX,
    };
    guard.moving = true;
    guard.path = [];
  }
}

// --- per-step (after the physics step) --------------------------------------

/**
 * Sync the van sprite to its body, resolve everything the van hit this step, and lead the
 * camera. Runs after `physics.syncActors`.
 */
export function updateCarPostStep(dtMs: number): void {
  if (!van) return;

  const st = physics.getCarState(van);
  if (st) {
    van.x = st.x;
    van.y = st.y;
    van.rad = st.angle + CAR_ART_OFFSET;
    if (active) {
      hero.x = st.x;
      hero.y = st.y;
      const ratio = Math.min(st.speed / (14 * 32), 1); // maxSpeed in px/s = 14 m/s * PPM
      updateEngine(ratio);
      camLead.x += (st.x + st.vx * CAR_LOOKAHEAD_S - camLead.x) * CAR_CAM_SMOOTH;
      camLead.y += (st.y + st.vy * CAR_LOOKAHEAD_S - camLead.y) * CAR_CAM_SMOOTH;
    }
  }

  resolveCarContacts(st);
  advanceKnockbacks(dtMs);
}

function resolveCarContacts(st: { vx: number; vy: number; speed: number } | null): void {
  const contacts = physics.drainCarContacts();
  for (const c of contacts) {
    if (c.kind === 'actor' && c.owner) {
      const guard = c.owner as any;
      if (guard.alive && c.speed >= RUN_OVER_SPEED_PX) runOver(guard, st);
    } else if (c.kind === 'cell' && c.cell >= 0 && c.speed >= BREACH_SPEED_PX) {
      // damageCell filters by material: drywall and brick give way to a car, concrete and
      // steel (and the map border) shrug it off. Amount scales with the impact.
      const amount = Math.min(c.speed * BREACH_DAMAGE_PER_SPEED, BREACH_DAMAGE_MAX);
      grid.damageCell(c.cell, amount, 'car');
    }
  }
}

/** Kill a guard the van ran into and throw the body along the van's heading. */
function runOver(guard: any, st: { vx: number; vy: number; speed: number } | null): void {
  const dirX = st && st.speed > 0 ? st.vx / st.speed : 0;
  const dirY = st && st.speed > 0 ? st.vy / st.speed : 0;
  bloodParticleSplatter(Math.atan2(dirY, dirX), guard);
  guard.kill();
  knockbacks.push({
    sprite: guard,
    vx: dirX * KNOCKBACK_SPEED_PX,
    vy: dirY * KNOCKBACK_SPEED_PX,
    ttl: KNOCKBACK_MS,
  });
  newFloatingMessage('Splat!', { x: guard.x, y: guard.y }, '#cc0000');
}

/** Slide run-over corpses along for a few frames, decaying to a stop. */
function advanceKnockbacks(dtMs: number): void {
  const dt = dtMs / 1000;
  for (let i = knockbacks.length - 1; i >= 0; i--) {
    const k = knockbacks[i];
    k.sprite.x += k.vx * dt;
    k.sprite.y += k.vy * dt;
    k.vx *= 0.85;
    k.vy *= 0.85;
    k.ttl -= dtMs;
    if (k.ttl <= 0) knockbacks.splice(i, 1);
  }
}

// --- camera hook ------------------------------------------------------------

/** Where the camera should aim while driving (velocity-led, smoothed), or null on foot. */
export function carCameraTarget(): { x: number; y: number } | null {
  return active ? camLead : null;
}

/** The zoom-out factor to apply in car mode (roadmap §7: ~1.3× wider view). */
export function carZoomOut(): number {
  return CAR_ZOOM_OUT;
}
