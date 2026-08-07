/**
 * The `ai` facade (roadmap §5). Owns the two pieces of squad-global state — the shared
 * SquadBlackboard and the decaying global alert level — and re-exports the guard-local
 * building blocks (GuardBrain and the pure modules) for the guard loop and the tests.
 *
 * Like `nav` and `physics`, this module is the only surface the legacy code talks to;
 * everything under `src/ai/` stays free of window globals.
 */

import { AlertState, alertLevel, createAlert, decayAlert, escalateTo, resetAlert } from './alert';
import { SquadBlackboard } from './blackboard';
import { AlertLevel } from './types';

export * from './types';
export * from './awareness';
export * from './memory';
export * from './hearing';
export * from './alert';
export * from './fsm';
export * from './blackboard';
export { GuardBrain, DEFAULT_BRAIN_CONFIG } from './brain';
export type { BrainInput, BrainConfig } from './brain';

/** The one board every guard shares this run. */
export const squad = new SquadBlackboard();

/** The one global alert temperature this run. */
const alertState: AlertState = createAlert();

export const ai = {
  squad,

  /** Current global alert band. */
  alertLevel(): AlertLevel {
    return alertLevel(alertState);
  },

  /** Raw alert value, 0..3 (for the debug overlay). */
  alertValue(): number {
    return alertState.value;
  },

  /** A confirmed sighting forces the squad to at least Alarmed. */
  raiseAlarmed(): void {
    escalateTo(alertState, AlertLevel.Alarmed);
  },

  /** The full-lockdown escalation (backup called). */
  raiseLockdown(): void {
    escalateTo(alertState, AlertLevel.Lockdown);
  },

  /** A lesser stimulus (a heard noise) nudges the squad toward Suspicious. */
  raiseSuspicious(): void {
    escalateTo(alertState, AlertLevel.Suspicious);
  },

  /**
   * Decay one fixed step. `activeThreat` holds the level up while any guard still has the
   * hero in sight, so the squad only cools once nobody is actively engaged.
   */
  decay(dtSeconds: number, activeThreat: boolean): void {
    decayAlert(alertState, dtSeconds, activeThreat ? AlertLevel.Alarmed : AlertLevel.Calm);
  },

  /** Wipe squad state on level (re)start. */
  reset(): void {
    resetAlert(alertState);
    squad.reset();
  },
};
