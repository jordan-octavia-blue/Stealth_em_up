/**
 * Shared AI vocabulary (roadmap §5). Everything here is plain data — the pure
 * transition/perception logic in the sibling modules operates on these shapes and
 * nothing else, so it is all directly testable in Vitest without a running game.
 */

export interface Vec {
  x: number;
  y: number;
}

/**
 * The hierarchical guard FSM (roadmap §5.1). This replaces the flag soup
 * (`alarmedPre/alarmed/chasingHero/moving/...`) that used to be branched inline in
 * `gameloop_guards`. The COMBAT sub-behaviours (Engage / HoldAtEntry / Flank /
 * TakeCover) live on the SquadBlackboard as entry claims rather than as extra states —
 * a guard in COMBAT that is told to hold an entry simply has no free entry token.
 */
export enum GuardState {
  Patrol = 'PATROL',
  Suspicious = 'SUSPICIOUS',
  Investigate = 'INVESTIGATE',
  Combat = 'COMBAT',
  Search = 'SEARCH',
  Flee = 'FLEE',
  Dead = 'DEAD',
}

/**
 * Global squad temperature (roadmap §5.2 "de-escalation"). It decays without fresh
 * stimuli, which is what finally kills "alarmed forever": guards drop from SEARCH back
 * to PATROL once the level cools to Calm.
 */
export enum AlertLevel {
  Calm = 0,
  Suspicious = 1,
  Alarmed = 2,
  Lockdown = 3,
}

export type SoundType = 'gunshot' | 'breach' | 'glass' | 'engine' | 'body' | 'footstep';

/**
 * A hearing stimulus on the event bus (roadmap §5.2). `loudness` is expressed directly
 * in pixels of nav-distance carry: a sound is audible to a listener whose cost-weighted
 * nav distance from `pos` is within `loudness` (times a global tuning constant). Because
 * the distance is measured through the nav graph, occlusion falls out for free — sound
 * travels *around* walls with falloff instead of the old flat 500 px through-wall radius.
 */
export interface Sound {
  pos: Vec;
  loudness: number;
  type: SoundType;
}

/** A guard's perception snapshot for one tick — the pure FSM's read-only world view. */
export interface Perception {
  /** Hero is inside the cone, in LOS, and within vision range this tick. */
  canSeeTarget: boolean;
  /** ...and the hero is doing something worth reacting to (suspicious or known face). */
  targetAlerting: boolean;
  /** Detection meter, 0 (oblivious) → 1 (fully spotted). */
  awareness: number;
  /** Most recent audible sound this tick, or null. */
  heardPos: Vec | null;
}

/** Decaying belief about where the target is (roadmap §5.2 "memory"). */
export interface Memory {
  hasTarget: boolean;
  lastKnownPos: Vec;
  lastKnownVel: Vec;
  /** gameClock time (ms) of the sighting this memory came from. */
  lastSeenTime: number;
}

export function emptyMemory(): Memory {
  return {
    hasTarget: false,
    lastKnownPos: { x: 0, y: 0 },
    lastKnownVel: { x: 0, y: 0 },
    lastSeenTime: 0,
  };
}
