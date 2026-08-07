/**
 * GuardBrain — the stateful glue that turns per-tick perception inputs into a guard's
 * current FSM state (roadmap §5). It owns the accumulating state the pure modules can't:
 * the awareness meter, the decaying memory, and the current `GuardState`. Everything it
 * needs about the world (can it see the hero, is the hero doing something alerting, what
 * did it hear) is handed in as a `BrainInput`, computed by the guard loop from the
 * physics raycast and hero flags — so the brain itself reads no window globals and is
 * unit-testable with hand-built inputs.
 *
 * The brain decides *state*; the guard loop reads `.state` and drives the effects
 * (repath, aim, shoot, textures).
 */

import { stepAwareness } from './awareness';
import { FsmContext, nextState } from './fsm';
import { isForgotten, rememberSighting } from './memory';
import { shouldFlee } from './blackboard';
import { AlertLevel, GuardState, Memory, Perception, Vec, emptyMemory } from './types';

export interface BrainConfig {
  /** Vision range in px (roadmap §5.2 — the old code had none). */
  maxVisionRange: number;
  /** Memory older than this is forgotten (ms). */
  memoryForgetMs: number;
  /** Reference walk speed (px/s) that maps to speedFactor 1. */
  referenceSpeed: number;
  fleeThreshold: number;
}

export const DEFAULT_BRAIN_CONFIG: BrainConfig = {
  maxVisionRange: 450,
  memoryForgetMs: 12000,
  referenceSpeed: 180,
  fleeThreshold: 0.32,
};

export interface BrainInput {
  /** gameClock time, ms. */
  now: number;
  /** Fixed step, seconds. */
  dt: number;
  /** Hero is in the cone, in LOS, within range this tick. */
  canSeeTarget: boolean;
  /** ...and the hero is masked/armed/suspicious or this guard knows its face. */
  targetAlerting: boolean;
  targetPos: Vec;
  /** Hero velocity, px/s (for memory extrapolation). */
  targetVel: Vec;
  targetDist: number;
  /** Hero speed, px/s. */
  targetSpeed: number;
  /** Stance multiplier on awareness fill (1 neutral). */
  stanceFactor: number;
  /** Nearest audible sound this tick, or null. */
  heardPos: Vec | null;
  alertLevel: AlertLevel;
  hpFraction: number;
  livingAllies: number;
  witnessedDeaths: number;
  /** Guard reached the point it was moving to investigate. */
  reachedGoal: boolean;
  /** Search has run long enough to give up (when the squad has also cooled). */
  searchExhausted: boolean;
}

export class GuardBrain {
  state: GuardState = GuardState.Patrol;
  awareness = 0;
  memory: Memory = emptyMemory();
  /** gameClock time the guard entered its current state (ms). */
  stateSince = 0;
  private readonly config: BrainConfig;

  constructor(config: Partial<BrainConfig> = {}) {
    this.config = { ...DEFAULT_BRAIN_CONFIG, ...config };
  }

  get maxVisionRange(): number {
    return this.config.maxVisionRange;
  }

  /** Advance the brain one fixed step; returns the (possibly new) state. */
  update(input: BrainInput): GuardState {
    if (this.state === GuardState.Dead) return GuardState.Dead;

    const alerting = input.canSeeTarget && input.targetAlerting;

    this.awareness = stepAwareness(
      this.awareness,
      {
        visible: alerting,
        distance: input.targetDist,
        maxRange: this.config.maxVisionRange,
        speedFactor: input.targetSpeed / this.config.referenceSpeed,
        stanceFactor: input.stanceFactor,
      },
      input.dt,
    );

    // Update memory whenever we can actually see an alerting target.
    if (alerting) {
      this.memory = rememberSighting(this.memory, input.targetPos, input.targetVel, input.now);
    }

    const memoryForgotten = isForgotten(this.memory, input.now, this.config.memoryForgetMs);

    const perception: Perception = {
      canSeeTarget: input.canSeeTarget,
      targetAlerting: input.targetAlerting,
      awareness: this.awareness,
      heardPos: input.heardPos,
    };

    // The FLEE vote only matters while engaged; computing it always keeps it pure.
    const wantsFlee = shouldFlee(
      input.hpFraction,
      input.livingAllies,
      input.witnessedDeaths,
      this.config.fleeThreshold,
    );

    const ctx: FsmContext = {
      perception,
      memory: this.memory,
      alertLevel: input.alertLevel,
      wantsFlee,
      reachedGoal: input.reachedGoal,
      searchExhausted: input.searchExhausted,
      memoryForgotten,
    };

    const next = nextState(this.state, ctx);
    if (next !== this.state) {
      this.state = next;
      this.stateSince = input.now;
    }
    return this.state;
  }

  /** Record a sighting reported by an ally (fused belief) without seeing it directly. */
  adoptBelief(pos: Vec, vel: Vec, now: number): void {
    this.memory = rememberSighting(this.memory, pos, vel, now);
  }

  markDead(): void {
    this.state = GuardState.Dead;
    this.awareness = 0;
  }

  timeInState(now: number): number {
    return now - this.stateSince;
  }
}
