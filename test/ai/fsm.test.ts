import { describe, expect, it } from 'vitest';
import { nextState, FsmContext } from '../../src/ai/fsm';
import { AlertLevel, GuardState, Memory, Perception, emptyMemory } from '../../src/ai/types';
import { DETECTED_THRESHOLD, SUSPICIOUS_THRESHOLD } from '../../src/ai/awareness';

function perception(over: Partial<Perception> = {}): Perception {
  return {
    canSeeTarget: false,
    targetAlerting: false,
    awareness: 0,
    heardPos: null,
    ...over,
  };
}

function memory(over: Partial<Memory> = {}): Memory {
  return { ...emptyMemory(), ...over };
}

function ctx(over: Partial<FsmContext> = {}): FsmContext {
  return {
    perception: perception(),
    memory: memory(),
    alertLevel: AlertLevel.Calm,
    wantsFlee: false,
    reachedGoal: false,
    searchExhausted: false,
    memoryForgotten: false,
    ...over,
  };
}

const spotted = perception({ canSeeTarget: true, targetAlerting: true, awareness: DETECTED_THRESHOLD });
const suspicious = perception({ canSeeTarget: true, targetAlerting: true, awareness: SUSPICIOUS_THRESHOLD });

describe('nextState — determinism & terminal states', () => {
  it('is a pure function: same inputs, same output', () => {
    const c = ctx({ perception: spotted });
    expect(nextState(GuardState.Patrol, c)).toBe(nextState(GuardState.Patrol, c));
  });

  it('DEAD is terminal regardless of what is perceived', () => {
    expect(nextState(GuardState.Dead, ctx({ perception: spotted, wantsFlee: true }))).toBe(
      GuardState.Dead,
    );
  });
});

describe('nextState — escalation ladder', () => {
  it('PATROL → COMBAT on a full meter with an alerting, visible target', () => {
    expect(nextState(GuardState.Patrol, ctx({ perception: spotted }))).toBe(GuardState.Combat);
  });

  it('PATROL → SUSPICIOUS when the meter is only half full (the "?!" telegraph)', () => {
    expect(nextState(GuardState.Patrol, ctx({ perception: suspicious }))).toBe(
      GuardState.Suspicious,
    );
  });

  it('PATROL → INVESTIGATE on a heard sound with nothing seen', () => {
    const heard = perception({ heardPos: { x: 100, y: 100 } });
    expect(nextState(GuardState.Patrol, ctx({ perception: heard }))).toBe(GuardState.Investigate);
  });

  it('PATROL stays PATROL when a visible target is not alerting (unmasked, idle)', () => {
    const seenButHarmless = perception({ canSeeTarget: true, targetAlerting: false, awareness: 0 });
    expect(nextState(GuardState.Patrol, ctx({ perception: seenButHarmless }))).toBe(
      GuardState.Patrol,
    );
  });

  it('SUSPICIOUS → COMBAT when the meter fills', () => {
    expect(nextState(GuardState.Suspicious, ctx({ perception: spotted }))).toBe(GuardState.Combat);
  });

  it('SUSPICIOUS holds while the meter stays up', () => {
    expect(nextState(GuardState.Suspicious, ctx({ perception: suspicious }))).toBe(
      GuardState.Suspicious,
    );
  });

  it('SUSPICIOUS → PATROL when the meter drains and there is nothing to check', () => {
    expect(nextState(GuardState.Suspicious, ctx())).toBe(GuardState.Patrol);
  });

  it('SUSPICIOUS → INVESTIGATE when the meter drains but a memory remains', () => {
    const c = ctx({ memory: memory({ hasTarget: true, lastSeenTime: 0 }) });
    expect(nextState(GuardState.Suspicious, c)).toBe(GuardState.Investigate);
  });
});

describe('nextState — investigate / combat / search', () => {
  it('INVESTIGATE → COMBAT on detection', () => {
    expect(nextState(GuardState.Investigate, ctx({ perception: spotted }))).toBe(GuardState.Combat);
  });

  it('INVESTIGATE → SEARCH once the goal is reached with nothing there', () => {
    expect(nextState(GuardState.Investigate, ctx({ reachedGoal: true }))).toBe(GuardState.Search);
  });

  it('INVESTIGATE keeps investigating until the goal is reached', () => {
    expect(nextState(GuardState.Investigate, ctx({ reachedGoal: false }))).toBe(
      GuardState.Investigate,
    );
  });

  it('COMBAT holds while the target is still detected', () => {
    expect(nextState(GuardState.Combat, ctx({ perception: spotted }))).toBe(GuardState.Combat);
  });

  it('COMBAT → SEARCH the moment the target is lost', () => {
    expect(nextState(GuardState.Combat, ctx())).toBe(GuardState.Search);
  });

  it('SEARCH → COMBAT on re-detection', () => {
    expect(nextState(GuardState.Search, ctx({ perception: spotted }))).toBe(GuardState.Combat);
  });

  it('SEARCH → INVESTIGATE when a fresh noise is heard', () => {
    const heard = perception({ heardPos: { x: 5, y: 5 } });
    expect(nextState(GuardState.Search, ctx({ perception: heard, searchExhausted: true }))).toBe(
      GuardState.Investigate,
    );
  });

  it('SEARCH → PATROL only once exhausted AND the squad has cooled', () => {
    expect(
      nextState(GuardState.Search, ctx({ searchExhausted: true, alertLevel: AlertLevel.Calm })),
    ).toBe(GuardState.Patrol);
  });

  it('SEARCH keeps searching while the squad is still alarmed, even when exhausted', () => {
    expect(
      nextState(GuardState.Search, ctx({ searchExhausted: true, alertLevel: AlertLevel.Alarmed })),
    ).toBe(GuardState.Search);
  });

  it('SEARCH keeps searching before the timer is up', () => {
    expect(nextState(GuardState.Search, ctx({ searchExhausted: false }))).toBe(GuardState.Search);
  });
});

describe('nextState — FLEE pre-empts engagement', () => {
  it('an engaged guard that votes to flee flees, even while it can see the target', () => {
    expect(nextState(GuardState.Combat, ctx({ perception: spotted, wantsFlee: true }))).toBe(
      GuardState.Flee,
    );
  });

  it('does not drag a patrolling guard into FLEE (nothing to flee from)', () => {
    expect(nextState(GuardState.Patrol, ctx({ wantsFlee: true }))).toBe(GuardState.Patrol);
  });

  it('FLEE holds until the vote clears', () => {
    expect(nextState(GuardState.Flee, ctx({ wantsFlee: true }))).toBe(GuardState.Flee);
  });

  it('FLEE → COMBAT if the guard is cornered and re-detects the target', () => {
    expect(nextState(GuardState.Flee, ctx({ wantsFlee: false, perception: spotted }))).toBe(
      GuardState.Combat,
    );
  });

  it('FLEE → SEARCH when safe again with a live memory', () => {
    const c = ctx({ wantsFlee: false, memory: memory({ hasTarget: true }), memoryForgotten: false });
    expect(nextState(GuardState.Flee, c)).toBe(GuardState.Search);
  });

  it('FLEE → PATROL when safe again and the memory is gone', () => {
    const c = ctx({ wantsFlee: false, memory: memory({ hasTarget: true }), memoryForgotten: true });
    expect(nextState(GuardState.Flee, c)).toBe(GuardState.Patrol);
  });
});
