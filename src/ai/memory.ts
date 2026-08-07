/**
 * Guard memory (roadmap §5.2). Replaces the append-only `alarmingObjects` array —
 * which grew forever and was raycast per guard per entry per frame — with a single
 * decaying belief per guard: where the target was, how fast it was going, and when.
 *
 * Pure functions: a `Memory` in, a new `Memory` (or a scalar) out. `now` is passed in
 * so tests drive time explicitly.
 */

import { Memory, Vec, emptyMemory } from './types';

/** Record a fresh sighting. `vel` is the target's current velocity (px/s). The previous
 *  memory is not needed — a sighting fully replaces it — but the slot is kept so callers
 *  read as `mem = rememberSighting(mem, ...)`. */
export function rememberSighting(_prev: Memory, pos: Vec, vel: Vec, now: number): Memory {
  return {
    hasTarget: true,
    lastKnownPos: { x: pos.x, y: pos.y },
    lastKnownVel: { x: vel.x, y: vel.y },
    lastSeenTime: now,
  };
}

/** Confidence in the memory, 1 at the moment of sighting decaying by half-life. */
export function memoryConfidence(mem: Memory, now: number, halfLifeMs: number): number {
  if (!mem.hasTarget || halfLifeMs <= 0) return 0;
  const age = Math.max(0, now - mem.lastSeenTime);
  return Math.pow(0.5, age / halfLifeMs);
}

/** True once the memory is older than `forgetMs` (or was never set). */
export function isForgotten(mem: Memory, now: number, forgetMs: number): boolean {
  if (!mem.hasTarget) return true;
  return now - mem.lastSeenTime >= forgetMs;
}

/**
 * Where the target probably is now: the last sighting extrapolated along its last
 * velocity, but only for a short window (`maxExtrapMs`) so a guard doesn't chase a
 * straight-line prediction across the whole map after a fleeting glimpse.
 */
export function predictedPos(mem: Memory, now: number, maxExtrapMs: number): Vec {
  if (!mem.hasTarget) return { x: 0, y: 0 };
  const dtMs = Math.min(Math.max(0, now - mem.lastSeenTime), maxExtrapMs);
  const dtS = dtMs / 1000;
  return {
    x: mem.lastKnownPos.x + mem.lastKnownVel.x * dtS,
    y: mem.lastKnownPos.y + mem.lastKnownVel.y * dtS,
  };
}

/** Drop the belief (e.g. a search that turned up nothing). */
export function clearMemory(): Memory {
  return emptyMemory();
}
