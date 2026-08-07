/**
 * Global squad alert level with de-escalation (roadmap §5.2). A single continuous
 * `value` in [0, 3] maps to the four AlertLevel bands. Stimuli push it up; time without
 * stimuli lets it decay back down. This is the mechanism that ends "alarmed forever":
 * once the value cools to Calm, guards in SEARCH fall back to PATROL.
 *
 * Pure state + pure operations — `dtSeconds` is passed in, no wall-clock reads.
 */

import { AlertLevel } from './types';

export const ALERT_MIN = 0;
export const ALERT_MAX = 3;

/** Per-second decay when no fresh stimulus arrives (~13 s from Alarmed to Calm). */
export const ALERT_DECAY_PER_S = 0.15;

export interface AlertState {
  value: number;
}

export function createAlert(): AlertState {
  return { value: 0 };
}

/** The band the current value sits in. */
export function levelFromValue(value: number): AlertLevel {
  if (value >= 2.5) return AlertLevel.Lockdown;
  if (value >= 1.5) return AlertLevel.Alarmed;
  if (value >= 0.5) return AlertLevel.Suspicious;
  return AlertLevel.Calm;
}

export function alertLevel(state: AlertState): AlertLevel {
  return levelFromValue(state.value);
}

/** Raise the level, never past Lockdown. */
export function escalate(state: AlertState, amount: number): void {
  if (amount <= 0) return;
  state.value = Math.min(ALERT_MAX, state.value + amount);
}

/** Pin the level to at least `floor` (0..3) — e.g. a confirmed sighting forces Alarmed. */
export function escalateTo(state: AlertState, floor: number): void {
  state.value = Math.max(state.value, Math.min(ALERT_MAX, floor));
}

/** Decay one step. Held above `floor` (default Calm) so a still-active threat can pin it. */
export function decayAlert(
  state: AlertState,
  dtSeconds: number,
  floor: number = ALERT_MIN,
  ratePerSec: number = ALERT_DECAY_PER_S,
): void {
  const next = state.value - ratePerSec * dtSeconds;
  state.value = Math.max(Math.max(ALERT_MIN, floor), next);
}

export function resetAlert(state: AlertState): void {
  state.value = 0;
}
