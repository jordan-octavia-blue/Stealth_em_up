/**
 * The guard FSM transition function (roadmap §5.1).
 *
 *   PATROL → SUSPICIOUS → INVESTIGATE → COMBAT → SEARCH → PATROL   plus FLEE, DEAD
 *
 * `nextState` is a *pure function* of (current state, context) — exactly the property
 * §5.1 calls for so the whole transition table is unit-testable. It decides *which*
 * state a guard should be in; the enter/exit side effects (repathing, texture swaps,
 * shooting) live in GuardBrain and the guard loop, keyed off the returned state.
 */

import { AlertLevel, GuardState, Memory, Perception } from './types';
import { DETECTED_THRESHOLD, SUSPICIOUS_THRESHOLD } from './awareness';

export interface FsmContext {
  perception: Perception;
  memory: Memory;
  /** Global squad temperature this tick. */
  alertLevel: AlertLevel;
  /** Squad self-preservation vote (roadmap §5.3). */
  wantsFlee: boolean;
  /** The guard has arrived at the point it was investigating. */
  reachedGoal: boolean;
  /** The search has run its course with nothing found. */
  searchExhausted: boolean;
  /** The target memory has aged past the forget window. */
  memoryForgotten: boolean;
}

function detected(p: Perception): boolean {
  return p.canSeeTarget && p.targetAlerting && p.awareness >= DETECTED_THRESHOLD;
}

function suspicious(p: Perception): boolean {
  return p.awareness >= SUSPICIOUS_THRESHOLD;
}

function heardSomething(p: Perception): boolean {
  return p.heardPos !== null;
}

/** The next state a guard should occupy. Pure — same inputs, same output, no side effects. */
export function nextState(current: GuardState, ctx: FsmContext): GuardState {
  // DEAD is terminal.
  if (current === GuardState.Dead) return GuardState.Dead;

  const p = ctx.perception;

  // FLEE pre-empts every engaged state: a guard that decides to run does so regardless
  // of what it can see, and only re-engages once the squad vote clears.
  if (current === GuardState.Flee) {
    if (ctx.wantsFlee) return GuardState.Flee;
    if (detected(p)) return GuardState.Combat;
    return ctx.memory.hasTarget && !ctx.memoryForgotten ? GuardState.Search : GuardState.Patrol;
  }
  const engaged =
    current === GuardState.Combat ||
    current === GuardState.Investigate ||
    current === GuardState.Search ||
    current === GuardState.Suspicious;
  if (ctx.wantsFlee && engaged) return GuardState.Flee;

  switch (current) {
    case GuardState.Patrol:
      if (detected(p)) return GuardState.Combat;
      if (suspicious(p)) return GuardState.Suspicious;
      if (heardSomething(p)) return GuardState.Investigate;
      return GuardState.Patrol;

    case GuardState.Suspicious:
      if (detected(p)) return GuardState.Combat;
      if (suspicious(p)) return GuardState.Suspicious; // meter still up
      // Meter fell back below the suspicious line. If there's a spot worth checking,
      // go look; otherwise stand down.
      if (heardSomething(p) || (ctx.memory.hasTarget && !ctx.memoryForgotten)) {
        return GuardState.Investigate;
      }
      return GuardState.Patrol;

    case GuardState.Investigate:
      if (detected(p)) return GuardState.Combat;
      // Reached the last-known/heard spot with nothing there → sweep the area.
      if (ctx.reachedGoal) return GuardState.Search;
      return GuardState.Investigate;

    case GuardState.Combat:
      if (detected(p)) return GuardState.Combat;
      // Lost the target — fall to SEARCH to hunt the last-known position (COMBAT → SEARCH).
      return GuardState.Search;

    case GuardState.Search:
      if (detected(p)) return GuardState.Combat;
      if (heardSomething(p)) return GuardState.Investigate; // a new noise to chase
      // Give up only once the squad has cooled *and* the search is spent.
      if (ctx.searchExhausted && ctx.alertLevel <= AlertLevel.Suspicious && !suspicious(p)) {
        return GuardState.Patrol;
      }
      return GuardState.Search;

    default:
      return current;
  }
}
