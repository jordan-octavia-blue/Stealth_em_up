/**
 * SquadBlackboard — the door-funnel fix (roadmap §5.3).
 *
 * One shared board that all guards read and write. It holds:
 *
 *  - a **fused belief**: any guard's sighting updates a single squad-wide last-known
 *    hero position/velocity/time, so a guard that never saw the hero still converges on
 *    where an ally last did;
 *  - **entry-point tokens**: one token per candidate entry (a door or a destroyed-wall
 *    gap). At most one guard is committed through a given entry at a time; the rest
 *    HoldAtEntry and peek. The claim also drives a temporary `doorCost` spike for other
 *    guards (applied by the caller against nav), so flanking emerges from cost shaping;
 *  - a **witnessed-death count** feeding the FLEE utility.
 *
 * The board itself is pure data + bookkeeping — no nav, no physics, no window globals —
 * so its assignment logic is unit-testable. The `shouldFlee` utility is a free function
 * for the same reason.
 */

import { Vec } from './types';

export interface Belief {
  /** Squad-wide last-known hero position, or null before any sighting. */
  pos: Vec | null;
  vel: Vec;
  /** gameClock time (ms) of the freshest sighting fused in. */
  time: number;
}

export class SquadBlackboard {
  readonly belief: Belief = { pos: null, vel: { x: 0, y: 0 }, time: 0 };
  /** entry cell index → owning guard id. */
  private readonly claims = new Map<number, number>();
  /** guard id → the entry it currently holds (for O(1) release). */
  private readonly heldBy = new Map<number, number>();
  witnessedDeaths = 0;

  /** Fuse a sighting. Only a *fresher* one overwrites the belief. */
  reportSighting(pos: Vec, vel: Vec, now: number): void {
    if (this.belief.pos !== null && now < this.belief.time) return;
    this.belief.pos = { x: pos.x, y: pos.y };
    this.belief.vel = { x: vel.x, y: vel.y };
    this.belief.time = now;
  }

  hasBelief(): boolean {
    return this.belief.pos !== null;
  }

  /**
   * Try to claim `entry` for `guardId`. Succeeds if the entry is free or already held by
   * this guard (idempotent). A guard holds at most one entry — claiming a new one first
   * releases the old.
   */
  claimEntry(entry: number, guardId: number): boolean {
    const owner = this.claims.get(entry);
    if (owner !== undefined && owner !== guardId) return false;
    const previous = this.heldBy.get(guardId);
    if (previous !== undefined && previous !== entry) this.claims.delete(previous);
    this.claims.set(entry, guardId);
    this.heldBy.set(guardId, entry);
    return true;
  }

  /** Release whatever entry this guard holds (a no-op if it holds none). */
  releaseEntry(guardId: number): void {
    const entry = this.heldBy.get(guardId);
    if (entry === undefined) return;
    if (this.claims.get(entry) === guardId) this.claims.delete(entry);
    this.heldBy.delete(guardId);
  }

  isClaimed(entry: number): boolean {
    return this.claims.has(entry);
  }

  claimant(entry: number): number | null {
    const owner = this.claims.get(entry);
    return owner === undefined ? null : owner;
  }

  claimedBy(guardId: number): number | null {
    const entry = this.heldBy.get(guardId);
    return entry === undefined ? null : entry;
  }

  /** Currently-claimed entry cells (for applying doorCost spikes against nav). */
  claimedEntries(): number[] {
    return [...this.claims.keys()];
  }

  recordDeath(): void {
    this.witnessedDeaths++;
  }

  /** Clear everything — called on level (re)start. */
  reset(): void {
    this.belief.pos = null;
    this.belief.vel = { x: 0, y: 0 };
    this.belief.time = 0;
    this.claims.clear();
    this.heldBy.clear();
    this.witnessedDeaths = 0;
  }
}

/**
 * Assign candidate entries to guards round-robin, weighted low-cost-first, one guard per
 * entry (roadmap §5.3). Returns a map of guardId → chosen entry. Guards past the number
 * of entries are left unassigned (they HoldAtEntry). `cost(guardId, entry)` is the
 * caller's path-distance + dangerCost estimate; lower is better.
 *
 * Pure and deterministic given its inputs — greedy over the (guard, entry) pairs by
 * ascending cost, skipping guards and entries already taken.
 */
export function assignEntries(
  guardIds: number[],
  entries: number[],
  cost: (guardId: number, entry: number) => number,
): Map<number, number> {
  const pairs: { g: number; e: number; c: number }[] = [];
  for (const g of guardIds) {
    for (const e of entries) pairs.push({ g, e, c: cost(g, e) });
  }
  pairs.sort((a, b) => a.c - b.c);
  const assignment = new Map<number, number>();
  const takenEntries = new Set<number>();
  for (const { g, e } of pairs) {
    if (assignment.has(g) || takenEntries.has(e)) continue;
    assignment.set(g, e);
    takenEntries.add(e);
  }
  return assignment;
}

/** Below this morale a guard in COMBAT breaks and runs (roadmap §5.3). */
export const FLEE_THRESHOLD = 0.32;

/**
 * Self-preservation morale check (roadmap §5.3). Weighs the guard's own health, how many
 * living allies are nearby, and how many ally deaths it has witnessed. Returns true when
 * morale drops below `threshold`. The "last guard alive doesn't charge" case falls out:
 * with no allies the ally term is zero, so any wound or witnessed death tips it over.
 */
export function shouldFlee(
  hpFraction: number,
  livingAllies: number,
  witnessedDeaths: number,
  threshold: number = FLEE_THRESHOLD,
): boolean {
  const hp = clamp01(hpFraction);
  const allies = clamp(livingAllies, 0, 4) / 4;
  const deaths = clamp(witnessedDeaths, 0, 4);
  const morale = 0.5 * hp + 0.4 * allies - 0.18 * deaths;
  return morale < threshold;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
