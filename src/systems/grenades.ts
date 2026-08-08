/**
 * Grenades / throwables (roadmap §8.2, Phase 8).
 *
 * Three throwables, each a *composition* of systems the earlier phases already built —
 * there is almost no bespoke gameplay code here, only wiring:
 *
 *  - **Frag:** on detonation it runs the same `grid.damageCell(..., 'bomb')` over its
 *    radius that the planted bomb does (so it breaches walls the same way), one-shot-kills
 *    guards in range with `guard.kill()` (guards have no hitpoints — Phase 6a's health
 *    model was deliberately skipped, so a frag kills exactly like the bomb), and makes the
 *    same loud alarm the bomb makes.
 *  - **Smoke:** deploys a set of `VISION_BLOCKER` sensor circles through `physics`
 *    (which now stop guard/camera sight and gunfire) *and* flags the covered grid cells
 *    `blocks_vision` so the player's fog-of-war darkens over them too. Guard vision and the
 *    player's fog are two separate systems in this codebase, so smoke has to touch both.
 *  - **Flash:** blinds every guard and camera inside its radius that it has line of sight
 *    to, by setting `blindUntil` on them (see `jo_sprite.doesSpriteSeeSprite`). A blinded
 *    guard sees nothing and its alarm state cannot change until the blind wears off; the
 *    guard loop in main.ts also freezes it in place and shows a "dazed" marker while it holds.
 *
 * Two things every grenade does on detonation, wired here: a burst of debris particles across
 * the blast disc (`grenadeBlastParticles`), and alerting guards who *hear* the pop (`beHeard`,
 * proximity, non-loud grenades only). Guards who *see* a live grenade are handled by putting an
 * `{x, y}` proxy in `window.alarmingObjects` while the grenade exists, so the normal detection
 * loop reacts to it exactly as it reacts to a dead body.
 *
 * A thrown grenade is a lerp from the hero to the target point with a faked height (the
 * sprite grows then shrinks) — top-down, so there is no physics body until it lands. On
 * landing a short fuse runs, then the effect fires.
 *
 * The lifecycle math and the target/footprint selection are pure and exported for tests;
 * everything that touches Pixi or the legacy window globals is guarded the same way
 * `breach.ts` guards its FX, so this module is safe to import headless.
 */

import { gameClock } from '../core/clock';
import { events } from '../core/events';
import { physics } from '../physics';
import { squad } from '../ai/squad';
import { DAMAGE_AMOUNT } from '../map/tileset';
import { grenadeBlastParticles } from './particles';
import { throwableDef, ThrowableDef } from './weapons';

export interface Vec {
  x: number;
  y: number;
}

// --- tunables ---------------------------------------------------------------

/** Throw speed the arc duration is derived from (pixels per ms). */
const THROW_SPEED_PX_PER_MS = 0.8;
const THROW_MS_MIN = 220;
const THROW_MS_MAX = 1000;
/** Peak extra sprite scale at the apex of the arc — the "faked height" of the lob. */
const ARC_HEIGHT = 0.5;
/**
 * Each covered cell gets a vision-blocker circle a little larger than the cell so
 * neighbours overlap and no sight ray threads between two of them.
 */
const CLOUD_CIRCLE_RADIUS_FACTOR = 0.72;
/**
 * How far a *non-loud* grenade (smoke, flash) is heard, per point of its `loudness`
 * (0-10). A guard within `loudness * this` pixels of the blast — no line of sight needed —
 * hears the pop and comes to investigate. Frag skips this: it is `loud`, so it wakes the
 * whole floor through `alert_all_guards()` instead. (loudness 2 smoke ≈ 160px ≈ 2.5 cells;
 * loudness 6 flash ≈ 480px ≈ 7.5 cells.)
 */
const HEAR_PX_PER_LOUDNESS = 80;

const dist = (a: Vec, b: Vec): number => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

// --- pure helpers (exported for tests) --------------------------------------

/** How long the throw arc lasts, scaled by distance and clamped. */
export function computeThrowMs(start: Vec, target: Vec): number {
  return clamp(dist(start, target) / THROW_SPEED_PX_PER_MS, THROW_MS_MIN, THROW_MS_MAX);
}

/**
 * Position along the throw at progress `t` in [0, 1], plus the sprite `scale` that fakes
 * the grenade's height (1 at the ends, higher in the middle).
 */
export function throwArcPosition(start: Vec, target: Vec, t: number): { x: number; y: number; scale: number } {
  const c = clamp(t, 0, 1);
  return {
    x: start.x + (target.x - start.x) * c,
    y: start.y + (target.y - start.y) * c,
    scale: 1 + ARC_HEIGHT * Math.sin(Math.PI * c),
  };
}

/** The shape of the legacy grid this module reads for the smoke footprint. */
export interface GrenadeGridLike {
  width: number;
  height: number;
  cell_size: number;
  cells: Array<{ blocks_vision: boolean }>;
}

/**
 * The cells a smoke cloud of `radius` at (cx, cy) covers, and the physics vision-blocker
 * circles that fill them. `cells` are grid indices (flagged `blocks_vision` for the fog);
 * `circles` are pixel-space discs (the physics sensors that stop guard sight).
 */
export function cloudFootprint(
  grid: GrenadeGridLike,
  cx: number,
  cy: number,
  radius: number,
): { cells: number[]; circles: Array<{ x: number; y: number; r: number }> } {
  const size = grid.cell_size;
  const r = size * CLOUD_CIRCLE_RADIUS_FACTOR;
  const cells: number[] = [];
  const circles: Array<{ x: number; y: number; r: number }> = [];
  const minGx = Math.max(0, Math.floor((cx - radius) / size));
  const maxGx = Math.min(grid.width - 1, Math.floor((cx + radius) / size));
  const minGy = Math.max(0, Math.floor((cy - radius) / size));
  const maxGy = Math.min(grid.height - 1, Math.floor((cy + radius) / size));
  for (let gy = minGy; gy <= maxGy; gy++) {
    for (let gx = minGx; gx <= maxGx; gx++) {
      const ccx = gx * size + size / 2;
      const ccy = gy * size + size / 2;
      if (dist({ x: cx, y: cy }, { x: ccx, y: ccy }) <= radius) {
        cells.push(gy * grid.width + gx);
        circles.push({ x: ccx, y: ccy, r });
      }
    }
  }
  return { cells, circles };
}

/**
 * Of `targets`, the ones within `radius` of `center` that `canSee(center → target)` — the
 * shared "who does this radial effect reach, with line of sight" filter used by both the
 * flash (guards + cameras) and, when a caller wants it, the frag.
 */
export function targetsInRadiusWithLOS<T extends Vec>(
  center: Vec,
  radius: number,
  targets: readonly T[],
  canSee: (x0: number, y0: number, x1: number, y1: number) => boolean,
): T[] {
  return targets.filter((t) => dist(center, t) <= radius && canSee(center.x, center.y, t.x, t.y));
}

// --- runtime ----------------------------------------------------------------

type Phase = 'flying' | 'fuse' | 'cloud' | 'done';

interface Grenade {
  def: ThrowableDef;
  start: Vec;
  target: Vec;
  throwMs: number;
  elapsed: number;
  fuseRemaining: number;
  cloudRemaining: number;
  phase: Phase;
  /** Thrown-grenade sprite (a jo_sprite), or null when running headless. */
  sprite: any | null;
  /** Physics vision-blocker handle for a deployed smoke cloud, or -1. */
  smokeId: number;
  /** Grid cells this smoke set `blocks_vision` on (only the ones it flipped false→true). */
  smokeCells: number[];
  /** Smoke cloud graphics, or null. */
  cloudFx: any | null;
  /**
   * The `{x, y}` proxy this grenade puts in `window.alarmingObjects` so guards and cameras
   * that *see* it (in flight or lying on the ground) react through the normal detection
   * loop — exactly the way they react to a dead body. Removed when the grenade is done.
   */
  sighting: Vec | null;
}

const grenades: Grenade[] = [];

const W = (): any => window as any;

/** True when the render globals a thrown grenade needs are present (i.e. the real game). */
function fxAvailable(): boolean {
  const w = W();
  return !!(w.PIXI && w.display_effects && w.img_bomb);
}

/** Tint the thrown grenade sprite by type, so the three read apart in flight. */
function tintFor(id: string): number {
  if (id === 'frag') return 0xff5533;
  if (id === 'smoke') return 0x9aa0a6;
  if (id === 'flash') return 0xffe680;
  return 0xffffff;
}

function makeSprite(def: ThrowableDef): any | null {
  if (!fxAvailable()) return null;
  const w = W();
  const s = new w.jo_sprite(new w.PIXI.Sprite(w.img_bomb), w.display_effects);
  s.sprite.anchor.x = 0.5;
  s.sprite.anchor.y = 0.5;
  s.sprite.scale.x = 0.3;
  s.sprite.scale.y = 0.3;
  s.sprite.tint = tintFor(def.id);
  s.sprite.visible = true;
  return s;
}

function destroySprite(s: any | null): void {
  if (!s) return;
  s.sprite.visible = false;
  if (s.sprite.parent) s.sprite.parent.removeChild(s.sprite);
}

/**
 * Throw a grenade of `typeId` (`'frag' | 'smoke' | 'flash'`) toward `target`. Returns
 * false if there is no such throwable in the table. The grenade arcs to the target over
 * the next frames, then fuses, then fires its effect — `updateGrenades` drives all of it.
 */
export function throwGrenade(typeId: string, target: Vec): boolean {
  const def = throwableDef(typeId);
  if (!def) return false;
  const hero = W().hero;
  const start: Vec = hero ? { x: hero.x, y: hero.y } : { x: target.x, y: target.y };
  const g: Grenade = {
    def,
    start,
    target: { x: target.x, y: target.y },
    throwMs: computeThrowMs(start, target),
    elapsed: 0,
    fuseRemaining: def.fuseMs,
    cloudRemaining: def.durationMs ?? 0,
    phase: 'flying',
    sprite: makeSprite(def),
    smokeId: -1,
    smokeCells: [],
    cloudFx: null,
    sighting: null,
  };
  registerSighting(g, start);
  grenades.push(g);
  return true;
}

/**
 * Put (or move) this grenade's `{x, y}` proxy in `window.alarmingObjects` so any guard or
 * camera with line of sight to it reacts through the same per-frame loop that reacts to a
 * dead body — this is the "guards get alerted when they *see* a grenade" half. A live
 * grenade is a visible object on the floor; seeing one is alarming.
 */
function registerSighting(g: Grenade, at: Vec): void {
  const objs = W().alarmingObjects;
  if (!Array.isArray(objs)) return;
  if (!g.sighting) {
    g.sighting = { x: at.x, y: at.y };
    objs.push(g.sighting);
  } else {
    g.sighting.x = at.x;
    g.sighting.y = at.y;
  }
}

/** Remove this grenade's sighting proxy from `window.alarmingObjects`, if it added one. */
function unregisterSighting(g: Grenade): void {
  if (!g.sighting) return;
  const objs = W().alarmingObjects;
  if (Array.isArray(objs)) {
    const i = objs.indexOf(g.sighting);
    if (i >= 0) objs.splice(i, 1);
  }
  g.sighting = null;
}

/** Advance every in-flight grenade / active cloud by `dtMs`. Call once per game step. */
export function updateGrenades(dtMs: number): void {
  for (let i = 0; i < grenades.length; i++) {
    const g = grenades[i];
    stepGrenade(g, dtMs);
    if (g.phase === 'done') {
      unregisterSighting(g);
      grenades.splice(i, 1);
      i--;
    }
  }
}

/** Drop every grenade and tear down every cloud — called when a map is (re)loaded. */
export function resetGrenades(): void {
  for (const g of grenades) {
    tearDownSmoke(g);
    destroySprite(g.sprite);
    unregisterSighting(g);
  }
  grenades.length = 0;
}

function stepGrenade(g: Grenade, dtMs: number): void {
  if (g.phase === 'flying') {
    g.elapsed += dtMs;
    const t = g.throwMs > 0 ? g.elapsed / g.throwMs : 1;
    const p = throwArcPosition(g.start, g.target, t);
    if (g.sprite) {
      g.sprite.x = p.x;
      g.sprite.y = p.y;
      g.sprite.sprite.scale.x = 0.3 * p.scale;
      g.sprite.sprite.scale.y = 0.3 * p.scale;
      g.sprite.sprite.rotation = (g.sprite.sprite.rotation ?? 0) + 0.3;
      g.sprite.prepare_for_draw();
    }
    // Keep the "guards can see it" proxy on the grenade as it flies.
    registerSighting(g, p);
    if (t >= 1) g.phase = 'fuse';
    return;
  }

  if (g.phase === 'fuse') {
    g.fuseRemaining -= dtMs;
    if (g.sprite) g.sprite.prepare_for_draw();
    if (g.fuseRemaining <= 0) {
      detonate(g);
      // Frag and flash are done the moment they fire; smoke lingers as a cloud (detonate
      // sets `phase` to 'cloud' for smoke). The cast defeats TS narrowing across the call.
      if ((g.phase as Phase) !== 'cloud') g.phase = 'done';
    }
    return;
  }

  if (g.phase === 'cloud') {
    g.cloudRemaining -= dtMs;
    if (g.cloudFx) {
      // Fade the cloud out over its last second so it does not vanish in one frame.
      const fade = clamp(g.cloudRemaining / 1000, 0, 1);
      g.cloudFx.alpha = 0.55 * fade + 0.0;
    }
    if (g.cloudRemaining <= 0) {
      tearDownSmoke(g);
      g.phase = 'done';
    }
    return;
  }
}

function detonate(g: Grenade): void {
  destroySprite(g.sprite);
  g.sprite = null;
  const center = g.target;
  const effects = g.def.effects;
  if (effects.includes('damage') || effects.includes('breach')) detonateFrag(g, center);
  if (effects.includes('vision_block')) deploySmoke(g, center);
  // Blind must run before the "heard" alert below, so a guard this flash just blinded is
  // skipped by beHeard (it is dazed — it hears nothing useful).
  if (effects.includes('blind')) detonateFlash(g, center);

  // Noise on detonation — the "hear a grenade" half. Frag is `loud`: it wakes the whole
  // floor (`alert_all_guards`, as the planted bomb does). Everything else makes a smaller
  // pop only nearby guards hear.
  if (effects.includes('loud')) beLoud(center);
  else beHeard(g, center);

  // A burst of debris across the blast disc, tinted per type (Phase 8).
  grenadeBlastParticles(center, g.def.radius, tintFor(g.def.id));
}

/**
 * The "hear a non-loud grenade" alert: every living guard within `loudness * HEAR_PX...`
 * of the blast — no line of sight required — becomes alarmed and investigates the spot,
 * through the same `seeAlarmingObject`/squad-belief path a sighting uses. Guards this same
 * blast just blinded are skipped: a flashbanged guard is dazed and reacts to nothing until
 * it recovers.
 */
function beHeard(g: Grenade, center: Vec): void {
  const w = W();
  const radius = g.def.loudness * HEAR_PX_PER_LOUDNESS;
  if (radius <= 0) return;
  const now = gameClock.now();
  const guards = w.guards ?? [];
  let anyHeard = false;
  for (const guard of guards) {
    if (!guard.alive || guard.being_choked_out) continue;
    if (guard.blindUntil && now < guard.blindUntil) continue;
    if (dist(center, guard) <= radius) {
      guard.sawHeroLastAt = { x: center.x, y: center.y };
      guard.seeAlarmingObject(center);
      anyHeard = true;
    }
  }
  if (anyHeard) {
    // Point the squad — including guards already alarmed — at the noise.
    squad.updateBelief(center.x, center.y, now);
    if (w.hero) {
      w.hero.lastSeenX = center.x;
      w.hero.lastSeenY = center.y;
    }
    if (w.hero_last_seen) {
      w.hero_last_seen.x = center.x;
      w.hero_last_seen.y = center.y;
    }
    w.notifyGuardsOfHeroLocation = true;
  }
}

// --- frag -------------------------------------------------------------------

function detonateFrag(g: Grenade, center: Vec): void {
  const w = W();
  const grid = w.grid;
  const radius = g.def.radius;

  // Breach + damage walls exactly like the bomb: every cell in range takes a 'bomb' hit
  // through the one damage entry point, and damageCell decides per cell whether it breaks.
  if (grid && typeof grid.damageCell === 'function') {
    const size = grid.cell_size;
    for (let idx = 0; idx < grid.cells.length; idx++) {
      const ccx = (idx % grid.width) * size + size / 2;
      const ccy = Math.floor(idx / grid.width) * size + size / 2;
      if (dist(center, { x: ccx, y: ccy }) < radius) grid.damageCell(idx, DAMAGE_AMOUNT.bomb, 'bomb');
    }
  }

  // One-shot-kill guards in range (no hitpoints; identical to the bomb).
  const guards = w.guards ?? [];
  for (const guard of guards) {
    if (guard.alive && dist(center, guard) < radius) guard.kill(center.x, center.y);
  }

  // Blow the hero up too if they threw it at their own feet.
  if (w.hero && typeof w.killHero === 'function' && dist(center, w.hero) < radius) {
    w.killHero(center.x, center.y);
  }

  // A dangerous spot for the squad to route through, on top of each breach's own deposit.
  events.emit('nav:danger', { x: center.x, y: center.y, amount: 8, radius: 3 });

  // FX.
  if (typeof w.play_sound === 'function' && w.sound_explosion) w.play_sound(w.sound_explosion);
  if (w.camera && typeof w.camera.startShake === 'function') w.camera.startShake(300, 12);
}

/**
 * The bomb's "an explosion just happened here" alarm: alert every guard and point them at
 * the blast. This is the loud-hearing half of the frag — a grenade going off is not a
 * stealthy act, so it alarms calm guards, exactly as the planted bomb does.
 */
function beLoud(center: Vec): void {
  const w = W();
  if (typeof w.alert_all_guards === 'function') w.alert_all_guards();
  if (w.hero) {
    w.hero.lastSeenX = center.x;
    w.hero.lastSeenY = center.y;
  }
  if (w.hero_last_seen) {
    w.hero_last_seen.x = center.x;
    w.hero_last_seen.y = center.y;
  }
  w.notifyGuardsOfHeroLocation = true;
  // The blast is where the squad now believes the hero is, so alarmed guards converge on
  // it (a distraction lure) — the same thing the planted bomb does in explodeBomb().
  squad.updateBelief(center.x, center.y, gameClock.now());
}

// --- smoke ------------------------------------------------------------------

function deploySmoke(g: Grenade, center: Vec): void {
  const w = W();
  const grid = w.grid;
  if (!grid) return;
  const { cells, circles } = cloudFootprint(grid, center.x, center.y, g.def.radius);

  // Guard/camera sight + gunfire: VISION_BLOCKER sensor circles.
  g.smokeId = physics.addVisionBlocker(circles);

  // Player fog-of-war: flag the covered floor cells opaque and rebuild the occluders.
  // Only remember the ones we actually flipped, so we never clear a real wall's flag.
  const changed: number[] = [];
  for (const idx of cells) {
    const cell = grid.cells[idx];
    if (cell && !cell.blocks_vision) {
      cell.blocks_vision = true;
      changed.push(idx);
    }
  }
  g.smokeCells = changed;
  if (changed.length) events.emit('vision:dirty', { cells: changed });

  g.cloudFx = makeCloudFx(circles);
  g.phase = 'cloud';
}

function tearDownSmoke(g: Grenade): void {
  if (g.smokeId >= 0) {
    physics.removeVisionBlocker(g.smokeId);
    g.smokeId = -1;
  }
  if (g.smokeCells.length) {
    const grid = W().grid;
    if (grid) {
      for (const idx of g.smokeCells) {
        const cell = grid.cells[idx];
        if (cell) cell.blocks_vision = false;
      }
      events.emit('vision:dirty', { cells: g.smokeCells });
    }
    g.smokeCells = [];
  }
  if (g.cloudFx) {
    if (g.cloudFx.parent) g.cloudFx.parent.removeChild(g.cloudFx);
    g.cloudFx = null;
  }
}

function makeCloudFx(circles: Array<{ x: number; y: number; r: number }>): any | null {
  const w = W();
  if (!(w.PIXI && w.display_effects)) return null;
  const gfx = new w.PIXI.Graphics();
  gfx.beginFill(0xbfc4c9, 1);
  for (const c of circles) gfx.drawCircle(c.x, c.y, c.r * 1.35);
  gfx.endFill();
  gfx.alpha = 0.55;
  w.display_effects.addChild(gfx);
  return gfx;
}

// --- flash ------------------------------------------------------------------

function detonateFlash(g: Grenade, center: Vec): void {
  const w = W();
  const durMs = g.def.blindMs ?? 3000;
  const until = gameClock.now() + durMs;
  const radius = g.def.radius;
  const canSee = (x0: number, y0: number, x1: number, y1: number): boolean =>
    physics.canSee ? physics.canSee(x0, y0, x1, y1) : true;

  // Blind every guard and camera it can actually see (walls and smoke both block the flash).
  const guards = (w.guards ?? []).filter((u: any) => u.alive);
  const cams = (w.security_cameras ?? []).filter((u: any) => u.alive);
  for (const u of targetsInRadiusWithLOS(center, radius, [...guards, ...cams], canSee)) {
    (u as any).blindUntil = until;
  }

  // A bright pop the player sees: screen shake + a quick white flash if the app has one.
  if (w.camera && typeof w.camera.startShake === 'function') w.camera.startShake(200, 6);
  flashScreen();
}

function flashScreen(): void {
  const w = W();
  if (!(w.PIXI && w.stage_child)) return;
  const overlay = new w.PIXI.Graphics();
  // Cover a generous area around the map in world space; it fades in ~250ms.
  overlay.beginFill(0xffffff, 1);
  overlay.drawRect(-5000, -5000, 20000, 20000);
  overlay.endFill();
  overlay.alpha = 0.85;
  w.stage_child.addChild(overlay);
  let a = 0.85;
  const fade = (): void => {
    a -= 0.06;
    overlay.alpha = a;
    if (a <= 0) {
      if (overlay.parent) overlay.parent.removeChild(overlay);
    } else {
      requestAnimationFrame(fade);
    }
  };
  requestAnimationFrame(fade);
}

// --- legacy global bridge ---------------------------------------------------
// The input handler and the gameloop still call these by bare name off `window`.
Object.assign(window, { throwGrenade, updateGrenades, resetGrenades });
