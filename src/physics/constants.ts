/**
 * Physics constants and collision filtering (roadmap §3.2).
 *
 * Scale: a 64 px tile is 2 m, so `PPM = 32`. That puts the hero's 14 px radius at
 * 0.44 m and a guard's 19 px at 0.59 m — comfortably inside Box2D's happy 0.1–10 m
 * range, which is the whole reason for not simulating in pixels.
 *
 * The category bits are the single filtering vocabulary shared by *collision* and by
 * *raycasts* (bullets, vision, fog). A fixture may carry several bits: a black wall
 * cell is `WALL | VISION_BLOCKER`, a brown furniture cell is `WALL` only — which is
 * exactly the old distinction between `cell.solid` and `cell.blocks_vision`, now
 * expressed once instead of in two parallel grid queries.
 */

/** Pixels per metre. 64 px tile = 2 m. */
export const PPM = 32;

export function toMeters(px: number): number {
  return px / PPM;
}

export function toPixels(m: number): number {
  return m * PPM;
}

/**
 * Collision categories. 16-bit; one bit each, and a fixture may set several.
 *
 * `VISION_BLOCKER` is deliberately orthogonal to `WALL`/`DOOR` rather than implied by
 * them: furniture stops movement without stopping sight, an open door stops neither,
 * and (Phase 8) a smoke grenade will stop sight without stopping movement by being a
 * `VISION_BLOCKER` sensor and nothing else.
 */
export const CATEGORY = {
  /** Static map geometry that blocks movement. */
  WALL: 0x0001,
  /** A door cell. Keeps the bit whether open or closed; open ones become sensors. */
  DOOR: 0x0002,
  HERO: 0x0004,
  GUARD: 0x0008,
  /** Phase 7's drivable van. Declared now so the masks below never need editing. */
  CAR: 0x0010,
  /** Sensor fixtures: door proximity today, loot/escape zones later. */
  TRIGGER: 0x0020,
  /** Blocks line of sight and gunfire. */
  VISION_BLOCKER: 0x0040,
} as const;

export type CategoryBits = number;

/** Everything that can push a character around. */
export const ACTOR_MASK =
  CATEGORY.WALL | CATEGORY.DOOR | CATEGORY.HERO | CATEGORY.GUARD | CATEGORY.CAR | CATEGORY.TRIGGER;

/** What static geometry collides with. */
export const STATIC_MASK = CATEGORY.HERO | CATEGORY.GUARD | CATEGORY.CAR;

/** Door proximity sensors only care about people. */
export const TRIGGER_MASK = CATEGORY.HERO | CATEGORY.GUARD | CATEGORY.CAR;

/**
 * Vision rays. Only `VISION_BLOCKER` — so furniture and open doors are see-through,
 * and a wall the bomb removed is transparent the instant its fixture is destroyed.
 */
export const VISION_MASK = CATEGORY.VISION_BLOCKER;

/**
 * Bullet rays: whatever stops sight also stops a bullet, plus the people in the way.
 * (Matching the old behaviour, which raycast against `blocks_vision` — you have always
 * been able to shoot over the office furniture.)
 */
export const BULLET_MASK =
  CATEGORY.VISION_BLOCKER | CATEGORY.HERO | CATEGORY.GUARD | CATEGORY.CAR;

/** Fixed simulation step, in seconds. Matches main.ts's `STEP_MS` (1000/60). */
export const PHYSICS_STEP_S = 1 / 60;
export const VELOCITY_ITERATIONS = 8;
export const POSITION_ITERATIONS = 3;

/**
 * Frames run at a fixed 60 Hz, so a "speed" of 4 px per tick is 240 px/s. The legacy
 * sprite speeds are all per-tick, and this is the one place that conversion happens.
 */
export const TICKS_PER_SECOND = 60;
