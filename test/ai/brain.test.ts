import { describe, expect, it } from 'vitest';
import { GuardBrain, BrainInput } from '../../src/ai/brain';
import { GuardState, AlertLevel } from '../../src/ai/types';

function baseInput(over: Partial<BrainInput> = {}): BrainInput {
  return {
    now: 0,
    dt: 1 / 60,
    canSeeTarget: false,
    targetAlerting: false,
    targetPos: { x: 0, y: 0 },
    targetVel: { x: 0, y: 0 },
    targetDist: Infinity,
    targetSpeed: 0,
    stanceFactor: 1,
    heardPos: null,
    alertLevel: AlertLevel.Calm,
    hpFraction: 1,
    livingAllies: 3,
    witnessedDeaths: 0,
    reachedGoal: false,
    searchExhausted: false,
    ...over,
  };
}

/** Drive the brain for `seconds` with a constant input, advancing `now`. */
function run(brain: GuardBrain, over: Partial<BrainInput>, seconds: number): GuardState {
  const dt = 1 / 60;
  let now = brain.stateSince;
  let state = brain.state;
  for (let t = 0; t < seconds; t += dt) {
    now += dt * 1000;
    state = brain.update(baseInput({ ...over, now, dt }));
  }
  return state;
}

describe('GuardBrain', () => {
  it('starts patrolling with an empty meter', () => {
    const b = new GuardBrain();
    expect(b.state).toBe(GuardState.Patrol);
    expect(b.awareness).toBe(0);
  });

  it('spots a nearby alerting hero within a second or two and enters COMBAT', () => {
    const b = new GuardBrain();
    const state = run(b, { canSeeTarget: true, targetAlerting: true, targetPos: { x: 30, y: 0 }, targetDist: 30 }, 3);
    expect(state).toBe(GuardState.Combat);
    expect(b.awareness).toBe(1);
    expect(b.memory.hasTarget).toBe(true);
  });

  it('passes through SUSPICIOUS on the way to COMBAT (telegraph)', () => {
    const b = new GuardBrain();
    const seen: GuardState[] = [];
    let now = 0;
    const dt = 1 / 60;
    for (let i = 0; i < 300 && b.state !== GuardState.Combat; i++) {
      now += dt * 1000;
      seen.push(
        b.update(
          baseInput({ now, dt, canSeeTarget: true, targetAlerting: true, targetPos: { x: 120, y: 0 }, targetDist: 120 }),
        ),
      );
    }
    expect(seen).toContain(GuardState.Suspicious);
    expect(b.state).toBe(GuardState.Combat);
  });

  it('never reacts to a visible but non-alerting hero (unmasked, idle)', () => {
    const b = new GuardBrain();
    const state = run(b, { canSeeTarget: true, targetAlerting: false, targetDist: 30 }, 5);
    expect(state).toBe(GuardState.Patrol);
    expect(b.awareness).toBe(0);
  });

  it('ignores an alerting hero beyond vision range (the range cap)', () => {
    const b = new GuardBrain({ maxVisionRange: 450 });
    const state = run(b, { canSeeTarget: true, targetAlerting: true, targetDist: 600, targetPos: { x: 600, y: 0 } }, 5);
    expect(state).toBe(GuardState.Patrol);
  });

  it('drops COMBAT → SEARCH when the hero breaks line of sight', () => {
    const b = new GuardBrain();
    run(b, { canSeeTarget: true, targetAlerting: true, targetPos: { x: 30, y: 0 }, targetDist: 30 }, 3);
    expect(b.state).toBe(GuardState.Combat);
    const state = run(b, { canSeeTarget: false, targetAlerting: false }, 0.2);
    expect(state).toBe(GuardState.Search);
  });

  it('eventually gives up: SEARCH → PATROL once exhausted and the squad is calm', () => {
    const b = new GuardBrain({ memoryForgetMs: 500 });
    run(b, { canSeeTarget: true, targetAlerting: true, targetPos: { x: 30, y: 0 }, targetDist: 30 }, 2);
    run(b, { canSeeTarget: false }, 0.2); // → SEARCH
    expect(b.state).toBe(GuardState.Search);
    // Give up only once the meter has fully drained AND the search timed out AND the squad
    // is calm — a couple of seconds out of sight.
    const state = run(b, { canSeeTarget: false, searchExhausted: true, alertLevel: AlertLevel.Calm }, 3);
    expect(state).toBe(GuardState.Patrol);
  });

  it('a heard sound sends a patroller to INVESTIGATE', () => {
    const b = new GuardBrain();
    const state = b.update(baseInput({ heardPos: { x: 200, y: 200 } }));
    expect(state).toBe(GuardState.Investigate);
  });

  it('a broken, wounded, lone guard flees COMBAT', () => {
    const b = new GuardBrain();
    run(b, { canSeeTarget: true, targetAlerting: true, targetPos: { x: 30, y: 0 }, targetDist: 30 }, 3);
    expect(b.state).toBe(GuardState.Combat);
    const state = b.update(
      baseInput({
        canSeeTarget: true,
        targetAlerting: true,
        targetDist: 30,
        hpFraction: 0.1,
        livingAllies: 0,
        witnessedDeaths: 2,
      }),
    );
    expect(state).toBe(GuardState.Flee);
  });

  it('markDead pins the state and stops transitions', () => {
    const b = new GuardBrain();
    b.markDead();
    const state = b.update(baseInput({ canSeeTarget: true, targetAlerting: true, targetDist: 10 }));
    expect(state).toBe(GuardState.Dead);
  });

  it('adoptBelief seeds a memory without a direct sighting', () => {
    const b = new GuardBrain();
    b.adoptBelief({ x: 300, y: 400 }, { x: 0, y: 0 }, 1000);
    expect(b.memory.hasTarget).toBe(true);
    expect(b.memory.lastKnownPos).toEqual({ x: 300, y: 400 });
  });
});
