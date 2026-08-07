import { describe, expect, it } from 'vitest';
import {
  ALERT_MAX,
  alertLevel,
  createAlert,
  decayAlert,
  escalate,
  escalateTo,
  levelFromValue,
  resetAlert,
} from '../../src/ai/alert';
import { AlertLevel } from '../../src/ai/types';

describe('levelFromValue', () => {
  it('maps the continuous value onto the four bands', () => {
    expect(levelFromValue(0)).toBe(AlertLevel.Calm);
    expect(levelFromValue(0.5)).toBe(AlertLevel.Suspicious);
    expect(levelFromValue(1.5)).toBe(AlertLevel.Alarmed);
    expect(levelFromValue(2.5)).toBe(AlertLevel.Lockdown);
    expect(levelFromValue(3)).toBe(AlertLevel.Lockdown);
  });
});

describe('escalate', () => {
  it('raises the value but never past Lockdown', () => {
    const s = createAlert();
    escalate(s, 5);
    expect(s.value).toBe(ALERT_MAX);
    expect(alertLevel(s)).toBe(AlertLevel.Lockdown);
  });

  it('ignores non-positive amounts', () => {
    const s = createAlert();
    escalate(s, -1);
    expect(s.value).toBe(0);
  });
});

describe('escalateTo', () => {
  it('pins the value up to a floor without lowering it', () => {
    const s = createAlert();
    escalateTo(s, AlertLevel.Alarmed);
    expect(alertLevel(s)).toBe(AlertLevel.Alarmed);
    escalateTo(s, AlertLevel.Suspicious); // lower floor must not demote
    expect(alertLevel(s)).toBe(AlertLevel.Alarmed);
  });
});

describe('decayAlert', () => {
  it('cools over time — Alarmed eventually reaches Calm without stimuli', () => {
    const s = createAlert();
    escalateTo(s, AlertLevel.Alarmed);
    for (let i = 0; i < 60; i++) decayAlert(s, 1); // 60 s
    expect(alertLevel(s)).toBe(AlertLevel.Calm);
  });

  it('is held up by a floor while a threat is still active', () => {
    const s = createAlert();
    escalateTo(s, AlertLevel.Lockdown);
    for (let i = 0; i < 100; i++) decayAlert(s, 1, AlertLevel.Alarmed);
    expect(alertLevel(s)).toBe(AlertLevel.Alarmed);
    expect(s.value).toBeGreaterThanOrEqual(AlertLevel.Alarmed);
  });

  it('never drops below zero', () => {
    const s = createAlert();
    decayAlert(s, 100);
    expect(s.value).toBe(0);
  });

  it('is framerate-independent (one 1 s step ≈ ten 0.1 s steps)', () => {
    const a = createAlert();
    const b = createAlert();
    escalateTo(a, AlertLevel.Alarmed);
    escalateTo(b, AlertLevel.Alarmed);
    decayAlert(a, 1);
    for (let i = 0; i < 10; i++) decayAlert(b, 0.1);
    expect(a.value).toBeCloseTo(b.value, 5);
  });
});

describe('resetAlert', () => {
  it('clears the level', () => {
    const s = createAlert();
    escalateTo(s, AlertLevel.Lockdown);
    resetAlert(s);
    expect(s.value).toBe(0);
  });
});
