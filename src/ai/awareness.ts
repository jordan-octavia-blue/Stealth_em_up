/**
 * The awareness meter (roadmap §5.2). Instant detection is replaced by a 0→1 meter that
 * fills while an alerting target is visible — faster the closer and faster-moving the
 * target — and drains when it is not. This is what produces the readable "?!" telegraph:
 * a guard crosses SUSPICIOUS on the way up and only reaches COMBAT at a full meter.
 *
 * Pure functions over numbers — no game state, no clock — so the fill/drain curve is
 * unit-tested directly.
 */

/** Meter crosses into SUSPICIOUS here. */
export const SUSPICIOUS_THRESHOLD = 0.5;
/** Meter is full — the target is spotted. */
export const DETECTED_THRESHOLD = 1;

/** Per-second fill at point-blank range with a still target and neutral stance. */
export const BASE_FILL_PER_S = 1.6;
/** Even at the edge of vision range the meter still fills at this fraction of base. */
const MIN_PROXIMITY_FACTOR = 0.3;
/** Per-second drain when nothing alerting is visible. Slower than the fill so the
 *  meter lingers a beat — a guard stays keyed-up briefly after the target ducks away. */
export const DRAIN_PER_S = 0.55;

export interface AwarenessInput {
  /** Target is visible *and* alerting this tick. */
  visible: boolean;
  /** Distance to the target in px. */
  distance: number;
  /** Vision range in px; at or beyond this the meter does not fill. */
  maxRange: number;
  /** Target speed in px/s, normalized against a reference walk speed. 0 = still. */
  speedFactor: number;
  /** Stance multiplier: 1 neutral, >1 for louder giveaways (gun out, sprinting). */
  stanceFactor: number;
}

/** Per-second fill rate for the current tick (0 when nothing alerting is visible). */
export function fillRate(input: AwarenessInput): number {
  if (!input.visible) return 0;
  if (input.distance >= input.maxRange) return 0;
  const proximity = 1 - clamp(input.distance / input.maxRange, 0, 1); // 0 (far) → 1 (close)
  const proximityFactor = MIN_PROXIMITY_FACTOR + (1 - MIN_PROXIMITY_FACTOR) * proximity;
  const speed = 1 + 0.6 * clamp(input.speedFactor, 0, 2);
  const stance = Math.max(0.1, input.stanceFactor);
  return BASE_FILL_PER_S * proximityFactor * speed * stance;
}

/** Advance the meter one step of `dtSeconds`, clamped to [0, 1]. */
export function stepAwareness(current: number, input: AwarenessInput, dtSeconds: number): number {
  const rate = fillRate(input);
  const next = rate > 0 ? current + rate * dtSeconds : current - DRAIN_PER_S * dtSeconds;
  return clamp(next, 0, 1);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
