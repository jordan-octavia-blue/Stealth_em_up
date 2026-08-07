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
import { DEFAULT_CAR_TUNING, physics, PPM } from '../physics';
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

/** Debug-outline wheels: drawn at the physics model's real axle positions. */
const WHEEL_LENGTH_PX = 18;
const WHEEL_WIDTH_PX = 7;
/** Front/rear axle distance from the body centre, from the model's wheelbase. */
const AXLE_X_PX = (DEFAULT_CAR_TUNING.wheelbase * PPM) / 2;
/** How far each wheel sits out from the centre-line. */
const AXLE_Y_PX = CAR_WIDTH_PX / 2 - 6;
/** The van's top speed in px/s, for the engine-pitch ratio. */
const CAR_MAX_SPEED_PX = DEFAULT_CAR_TUNING.maxSpeed * PPM;

/** How close (px, centre to centre) the hero must be to the van to climb in. */
const ENTER_DISTANCE_PX = 96;

/**
 * Speed (px/s) the van itself must be **driving** at for a unit it hits to be run over and
 * killed. Below it, the unit is only shoved aside by the collision — so a parked or
 * crawling van never hurts anyone, and a guard (or the hero on foot) can walk right up to
 * it. This is the van's own speed, not the closing speed, so a person walking into a
 * stationary van is never lethal.
 */
const RUN_OVER_SPEED_PX = 120;
/** How hard, and how long, a run-over throws the body. */
const KNOCKBACK_SPEED_PX = 420;
const KNOCKBACK_MS = 300;

/** Below this closing speed (px/s) the van bumps a wall without damaging it at all. */
const BREACH_SPEED_PX = 100;
/**
 * Wall damage per px/s of impact, and the most any single impact can do. Deliberately small:
 * one collision damages a wall but never levels a solid one — a 40–60 hp brick wall survives
 * a full-speed ram and needs several. Drywall (15 hp) still gives way to one good hit, which
 * is what makes it shootable/rammable cover.
 */
const BREACH_DAMAGE_PER_SPEED = 0.05;
const BREACH_DAMAGE_MAX = 20;

// --- taking fire while driving ----------------------------------------------

/** Hits the van's bodywork can soak before it is wrecked (and the driver with it). */
const CAR_MAX_HEALTH = 12;
/** Per bullet, the chance a shot finds the driver through the bodywork and kills instantly. */
const DRIVER_HIT_CHANCE = 0.04;

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
/** Bodywork left before the van is wrecked. Only counts down while it is being shot. */
let carHealth = CAR_MAX_HEALTH;

/**
 * The stand-in for the van art: a hollow box drawn at the physics body's real size and
 * angle, so the collision shape and what you see are the same thing. Replaces the
 * `getawaycar` image (which no longer lines up with the body) until new art exists.
 */
let carOutline: any = null;
/** The two front-wheel graphics, children of `carOutline`, rotated by the live steer angle. */
let frontWheels: any[] = [];

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
  carHealth = CAR_MAX_HEALTH;
  // Hide the mismatched van image; the physics-shaped outline stands in for it.
  if (owner.sprite) owner.sprite.visible = false;
  physics.addCar(owner, CAR_LENGTH_PX, CAR_WIDTH_PX, angle);
  owner.rad = angle + CAR_ART_OFFSET;
  buildCarOutline();
  syncCarOutline(owner.x, owner.y, angle, 0);
  camLead.x = owner.x;
  camLead.y = owner.y;
}

/**
 * Draw the van as the box the physics uses: length along the car's forward (+x) axis,
 * width across it, with a short line out the nose so the facing is obvious, plus the
 * four wheels at the model's real axle positions. The rear wheels are part of the box
 * drawing; the front pair are child graphics that `syncCarOutline` rotates every frame
 * to the model's actual steering angle — so you can *see* how far you're steering.
 */
function buildCarOutline(): void {
  const G = (window as any).PIXI;
  const layer = (window as any).display_actors;
  if (!G || !layer) return;
  if (carOutline && carOutline.parent) carOutline.parent.removeChild(carOutline);
  frontWheels = [];
  const g = new G.Graphics();
  const hl = CAR_LENGTH_PX / 2;
  const hw = CAR_WIDTH_PX / 2;
  g.lineStyle(2, 0xff5252, 0.95);
  g.drawRect(-hl, -hw, CAR_LENGTH_PX, CAR_WIDTH_PX);
  // Nose marker: a line from the centre out past the front so "forward" is unambiguous.
  g.moveTo(0, 0);
  g.lineTo(hl + 10, 0);
  // Rear wheels: fixed to the body.
  g.lineStyle(2, 0xbbbbbb, 0.9);
  for (const side of [-1, 1]) {
    g.drawRect(
      -AXLE_X_PX - WHEEL_LENGTH_PX / 2,
      side * AXLE_Y_PX - WHEEL_WIDTH_PX / 2,
      WHEEL_LENGTH_PX,
      WHEEL_WIDTH_PX,
    );
  }
  // Front wheels: their own graphics so they can pivot on their axle to the steer angle.
  for (const side of [-1, 1]) {
    const w = new G.Graphics();
    w.lineStyle(2, 0xffee58, 0.95);
    w.drawRect(-WHEEL_LENGTH_PX / 2, -WHEEL_WIDTH_PX / 2, WHEEL_LENGTH_PX, WHEEL_WIDTH_PX);
    w.position.set(AXLE_X_PX, side * AXLE_Y_PX);
    g.addChild(w);
    frontWheels.push(w);
  }
  layer.addChild(g);
  carOutline = g;
}

/** Put the outline over the body at (x, y) turned to `angle`, front wheels at `steer`. */
function syncCarOutline(x: number, y: number, angle: number, steer: number): void {
  if (!carOutline) return;
  carOutline.position.x = x;
  carOutline.position.y = y;
  carOutline.rotation = angle;
  for (const w of frontWheels) w.rotation = steer;
}

/** Drop all car state between runs. */
export function resetCarSystem(): void {
  stopEngine();
  if (carOutline && carOutline.parent) carOutline.parent.removeChild(carOutline);
  carOutline = null;
  frontWheels = [];
  van = null;
  active = false;
  carHealth = CAR_MAX_HEALTH;
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

  // Getting into the van is NOT a crime: it raises no alarm and no suspicion on its own.
  // A guard only reacts to the van if the hero is *doing* something suspicious in it
  // (masked, holding loot, etc. — see hero.willCauseAlert), or once the van is driven fast
  // enough to be heard (the engine-noise broadcast in updateCarPreStep pulls already-alarmed
  // guards toward it, but never alarms a calm one).
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

// --- taking fire ------------------------------------------------------------

/**
 * A guard's bullet struck the van while the hero was driving it. Two outcomes:
 *
 *   - a small `DRIVER_HIT_CHANCE` that the round finds the driver and kills them outright;
 *   - otherwise the bodywork soaks it, and once `CAR_MAX_HEALTH` such hits land the van is
 *     wrecked and the driver dies with it.
 *
 * `fromX/fromY` is the shooter's position, only used to angle the death splatter. Called
 * from the bullet loop in main.ts; a no-op unless the hero is actually in the van.
 */
export function carHitByBullet(fromX: number, fromY: number): void {
  if (!active || !van || !hero.alive) return;

  if (Math.random() < DRIVER_HIT_CHANCE) {
    killDriver(fromX, fromY, 'The driver is hit!');
    return;
  }

  carHealth -= 1;
  if (carHealth <= 0) {
    killDriver(fromX, fromY, 'The van is wrecked!');
    return;
  }
  newFloatingMessage('Van hit! (' + carHealth + ')', { x: van.x, y: van.y }, '#FFaa00');
}

/** End the drive with the hero dead at the wheel: cut the engine, show the body, game over. */
function killDriver(fromX: number, fromY: number, reason: string): void {
  active = false;
  hero.inCar = false;
  stopEngine();
  // Bring the (now to-be-dead) hero back into view slumped where the van stopped.
  hero.x = van.x;
  hero.y = van.y;
  hero.sprite.visible = true;
  newFloatingMessage(reason, { x: van.x, y: van.y }, '#cc0000');
  if (typeof killHero === 'function') killHero(fromX, fromY);
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
    syncCarOutline(st.x, st.y, st.angle, st.steer);
    if (active) {
      hero.x = st.x;
      hero.y = st.y;
      const ratio = Math.min(st.speed / CAR_MAX_SPEED_PX, 1);
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
  // Lethality is gated on the van's own driving speed, not the closing speed: a stationary
  // van can never run anyone over, however fast they walk into it — the collision just
  // shoves them (Box2D does that on its own). Only a van driving above the threshold kills.
  const driving = st ? st.speed : 0;
  for (const c of contacts) {
    if (c.kind === 'actor' && c.owner) {
      const unit = c.owner as any;
      if (unit.alive && driving >= RUN_OVER_SPEED_PX) runOver(unit, st);
    } else if (c.kind === 'cell' && c.cell >= 0 && c.speed >= BREACH_SPEED_PX) {
      // damageCell filters by material: drywall and brick take car damage, concrete and
      // steel (and the map border) shrug it off. The amount is capped low (see
      // BREACH_DAMAGE_MAX) so one impact damages a solid wall but never destroys it.
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
