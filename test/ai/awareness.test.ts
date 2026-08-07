import { describe, expect, it } from 'vitest';
import {
  AwarenessInput,
  DETECTED_THRESHOLD,
  DRAIN_PER_S,
  fillRate,
  stepAwareness,
  SUSPICIOUS_THRESHOLD,
} from '../../src/ai/awareness';

function input(over: Partial<AwarenessInput> = {}): AwarenessInput {
  return {
    visible: true,
    distance: 0,
    maxRange: 450,
    speedFactor: 0,
    stanceFactor: 1,
    ...over,
  };
}

describe('fillRate', () => {
  it('is zero when nothing alerting is visible', () => {
    expect(fillRate(input({ visible: false }))).toBe(0);
  });

  it('is zero at or beyond the vision range', () => {
    expect(fillRate(input({ distance: 450, maxRange: 450 }))).toBe(0);
    expect(fillRate(input({ distance: 900, maxRange: 450 }))).toBe(0);
  });

  it('fills faster the closer the target', () => {
    const close = fillRate(input({ distance: 20 }));
    const far = fillRate(input({ distance: 400 }));
    expect(close).toBeGreaterThan(far);
    expect(far).toBeGreaterThan(0);
  });

  it('fills faster for a moving target', () => {
    expect(fillRate(input({ speedFactor: 1 }))).toBeGreaterThan(fillRate(input({ speedFactor: 0 })));
  });

  it('fills faster for a louder stance (gun out)', () => {
    expect(fillRate(input({ stanceFactor: 1.5 }))).toBeGreaterThan(
      fillRate(input({ stanceFactor: 1 })),
    );
  });
});

describe('stepAwareness', () => {
  it('rises toward 1 while visible and clamps there', () => {
    let a = 0;
    for (let i = 0; i < 100; i++) a = stepAwareness(a, input({ distance: 0 }), 0.1);
    expect(a).toBe(1);
  });

  it('drains toward 0 while not visible and clamps there', () => {
    let a = 1;
    for (let i = 0; i < 100; i++) a = stepAwareness(a, input({ visible: false }), 0.1);
    expect(a).toBe(0);
  });

  it('drains at exactly DRAIN_PER_S when not visible', () => {
    expect(stepAwareness(1, input({ visible: false }), 1)).toBeCloseTo(1 - DRAIN_PER_S);
  });

  it('crosses SUSPICIOUS before DETECTED at close range (readable telegraph)', () => {
    let a = 0;
    let steps = 0;
    let suspiciousAt = -1;
    let detectedAt = -1;
    while (a < DETECTED_THRESHOLD && steps < 1000) {
      a = stepAwareness(a, input({ distance: 40 }), 1 / 60);
      steps++;
      if (suspiciousAt < 0 && a >= SUSPICIOUS_THRESHOLD) suspiciousAt = steps;
      if (detectedAt < 0 && a >= DETECTED_THRESHOLD) detectedAt = steps;
    }
    expect(suspiciousAt).toBeGreaterThan(0);
    expect(detectedAt).toBeGreaterThan(suspiciousAt);
  });

  it('a distant target takes longer to spot than a near one', () => {
    const ticks = (distance: number) => {
      let a = 0;
      let n = 0;
      while (a < DETECTED_THRESHOLD && n < 10000) {
        a = stepAwareness(a, input({ distance }), 1 / 60);
        n++;
      }
      return n;
    };
    expect(ticks(400)).toBeGreaterThan(ticks(40));
  });

  it('is framerate-independent: one big step equals many small ones (while filling)', () => {
    const inp = input({ distance: 100 });
    let small = 0;
    for (let i = 0; i < 10; i++) small = Math.min(1, small + fillRate(inp) * 0.01);
    const big = Math.min(1, 0 + fillRate(inp) * 0.1);
    expect(small).toBeCloseTo(big, 5);
  });
});
