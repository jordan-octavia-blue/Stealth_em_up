import { describe, expect, it } from 'vitest';
import {
  clearMemory,
  isForgotten,
  memoryConfidence,
  predictedPos,
  rememberSighting,
} from '../../src/ai/memory';
import { emptyMemory } from '../../src/ai/types';

describe('rememberSighting', () => {
  it('captures position, velocity and time, and sets hasTarget', () => {
    const m = rememberSighting(emptyMemory(), { x: 10, y: 20 }, { x: 1, y: -2 }, 5000);
    expect(m.hasTarget).toBe(true);
    expect(m.lastKnownPos).toEqual({ x: 10, y: 20 });
    expect(m.lastKnownVel).toEqual({ x: 1, y: -2 });
    expect(m.lastSeenTime).toBe(5000);
  });

  it('does not alias the caller-supplied vectors', () => {
    const pos = { x: 1, y: 1 };
    const m = rememberSighting(emptyMemory(), pos, { x: 0, y: 0 }, 0);
    pos.x = 999;
    expect(m.lastKnownPos.x).toBe(1);
  });
});

describe('memoryConfidence', () => {
  it('is 0 without a target', () => {
    expect(memoryConfidence(emptyMemory(), 1000, 4000)).toBe(0);
  });

  it('is 1 at the instant of sighting and halves each half-life', () => {
    const m = rememberSighting(emptyMemory(), { x: 0, y: 0 }, { x: 0, y: 0 }, 0);
    expect(memoryConfidence(m, 0, 4000)).toBeCloseTo(1);
    expect(memoryConfidence(m, 4000, 4000)).toBeCloseTo(0.5);
    expect(memoryConfidence(m, 8000, 4000)).toBeCloseTo(0.25);
  });
});

describe('isForgotten', () => {
  it('is true without a target', () => {
    expect(isForgotten(emptyMemory(), 0, 1000)).toBe(true);
  });

  it('flips once the memory ages past the forget window', () => {
    const m = rememberSighting(emptyMemory(), { x: 0, y: 0 }, { x: 0, y: 0 }, 0);
    expect(isForgotten(m, 5000, 12000)).toBe(false);
    expect(isForgotten(m, 12000, 12000)).toBe(true);
  });
});

describe('predictedPos', () => {
  it('extrapolates along the last velocity within the window', () => {
    const m = rememberSighting(emptyMemory(), { x: 0, y: 0 }, { x: 100, y: 0 }, 0);
    // 0.5 s later at 100 px/s → 50 px along x
    expect(predictedPos(m, 500, 2000)).toEqual({ x: 50, y: 0 });
  });

  it('clamps the extrapolation window so a glimpse is not chased across the map', () => {
    const m = rememberSighting(emptyMemory(), { x: 0, y: 0 }, { x: 100, y: 0 }, 0);
    // 10 s later, but the window caps at 2 s → 200 px, not 1000 px
    expect(predictedPos(m, 10000, 2000)).toEqual({ x: 200, y: 0 });
  });
});

describe('clearMemory', () => {
  it('returns a blank memory', () => {
    expect(clearMemory().hasTarget).toBe(false);
  });
});
