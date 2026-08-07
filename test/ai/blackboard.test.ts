import { describe, expect, it } from 'vitest';
import {
  assignEntries,
  FLEE_THRESHOLD,
  shouldFlee,
  SquadBlackboard,
} from '../../src/ai/blackboard';

describe('SquadBlackboard — fused belief', () => {
  it('starts with no belief', () => {
    const bb = new SquadBlackboard();
    expect(bb.hasBelief()).toBe(false);
    expect(bb.belief.pos).toBeNull();
  });

  it('any guard\'s sighting becomes the squad belief', () => {
    const bb = new SquadBlackboard();
    bb.reportSighting({ x: 100, y: 200 }, { x: 1, y: 0 }, 1000);
    expect(bb.hasBelief()).toBe(true);
    expect(bb.belief.pos).toEqual({ x: 100, y: 200 });
    expect(bb.belief.time).toBe(1000);
  });

  it('only a fresher sighting overwrites the belief', () => {
    const bb = new SquadBlackboard();
    bb.reportSighting({ x: 100, y: 200 }, { x: 0, y: 0 }, 1000);
    bb.reportSighting({ x: 5, y: 5 }, { x: 0, y: 0 }, 500); // stale
    expect(bb.belief.pos).toEqual({ x: 100, y: 200 });
    bb.reportSighting({ x: 7, y: 8 }, { x: 0, y: 0 }, 1500); // fresher
    expect(bb.belief.pos).toEqual({ x: 7, y: 8 });
  });

  it('does not alias the reported vectors', () => {
    const bb = new SquadBlackboard();
    const pos = { x: 1, y: 2 };
    bb.reportSighting(pos, { x: 0, y: 0 }, 0);
    pos.x = 999;
    expect(bb.belief.pos).toEqual({ x: 1, y: 2 });
  });
});

describe('SquadBlackboard — entry tokens (staggered entry)', () => {
  it('one guard per entry: a claimed entry is refused to others', () => {
    const bb = new SquadBlackboard();
    expect(bb.claimEntry(42, 1)).toBe(true);
    expect(bb.isClaimed(42)).toBe(true);
    expect(bb.claimant(42)).toBe(1);
    expect(bb.claimEntry(42, 2)).toBe(false);
  });

  it('claiming is idempotent for the holder', () => {
    const bb = new SquadBlackboard();
    bb.claimEntry(42, 1);
    expect(bb.claimEntry(42, 1)).toBe(true);
  });

  it('a guard holds at most one entry — a new claim releases the old', () => {
    const bb = new SquadBlackboard();
    bb.claimEntry(10, 1);
    bb.claimEntry(20, 1);
    expect(bb.isClaimed(10)).toBe(false);
    expect(bb.claimedBy(1)).toBe(20);
    // the freed entry is available to another guard
    expect(bb.claimEntry(10, 2)).toBe(true);
  });

  it('releasing frees the entry for the next guard', () => {
    const bb = new SquadBlackboard();
    bb.claimEntry(10, 1);
    bb.releaseEntry(1);
    expect(bb.isClaimed(10)).toBe(false);
    expect(bb.claimedBy(1)).toBeNull();
    expect(bb.claimEntry(10, 2)).toBe(true);
  });

  it('lists currently-claimed entries (for doorCost spikes)', () => {
    const bb = new SquadBlackboard();
    bb.claimEntry(10, 1);
    bb.claimEntry(20, 2);
    expect(bb.claimedEntries().sort((a, b) => a - b)).toEqual([10, 20]);
  });
});

describe('SquadBlackboard — reset', () => {
  it('wipes belief, claims and death count', () => {
    const bb = new SquadBlackboard();
    bb.reportSighting({ x: 1, y: 1 }, { x: 0, y: 0 }, 1);
    bb.claimEntry(1, 1);
    bb.recordDeath();
    bb.reset();
    expect(bb.hasBelief()).toBe(false);
    expect(bb.isClaimed(1)).toBe(false);
    expect(bb.witnessedDeaths).toBe(0);
  });
});

describe('assignEntries', () => {
  it('assigns each guard its cheapest entry, one guard per entry', () => {
    const guards = [1, 2];
    const entries = [10, 20];
    // guard 1 is closest to 10, guard 2 closest to 20
    const cost = (g: number, e: number) => (g === 1 ? (e === 10 ? 1 : 9) : e === 20 ? 1 : 9);
    const a = assignEntries(guards, entries, cost);
    expect(a.get(1)).toBe(10);
    expect(a.get(2)).toBe(20);
  });

  it('spreads guards across entries rather than stacking on the cheapest (the funnel fix)', () => {
    const guards = [1, 2];
    const entries = [10, 20];
    // both guards would prefer entry 10, but only one can take it
    const cost = (_g: number, e: number) => (e === 10 ? 1 : 2);
    const a = assignEntries(guards, entries, cost);
    const chosen = [a.get(1), a.get(2)].sort();
    expect(chosen).toEqual([10, 20]);
  });

  it('leaves surplus guards unassigned (they HoldAtEntry)', () => {
    const a = assignEntries([1, 2, 3], [10], () => 1);
    const assigned = [...a.values()];
    expect(assigned).toEqual([10]);
    expect(a.size).toBe(1);
  });
});

describe('shouldFlee', () => {
  it('a healthy guard with allies holds', () => {
    expect(shouldFlee(1, 3, 0)).toBe(false);
  });

  it('a badly wounded guard breaks', () => {
    expect(shouldFlee(0.1, 1, 1)).toBe(true);
  });

  it('the last guard alive does not charge after a wound', () => {
    // no allies, took a hit, saw a death → morale collapses
    expect(shouldFlee(0.4, 0, 1)).toBe(true);
  });

  it('witnessed deaths erode morale', () => {
    expect(shouldFlee(0.6, 1, 0)).toBe(false);
    expect(shouldFlee(0.6, 1, 3)).toBe(true);
  });

  it('respects a custom threshold', () => {
    // morale 0.42 (hp 1, one ally, one death) sits above the default threshold; a higher
    // threshold flips the same guard to fleeing.
    expect(shouldFlee(1, 1, 1, FLEE_THRESHOLD)).toBe(false);
    expect(shouldFlee(1, 1, 1, 0.6)).toBe(true);
  });
});
