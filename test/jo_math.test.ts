import { afterEach, describe, expect, it, vi } from 'vitest';

import '../src/legacy/jo_math';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('moveToTarget', () => {
  it('snaps to the target when the step would overshoot it', () => {
    expect(moveToTarget(0, 0, 3, 4, 5.5)).toEqual({ x: 3, y: 4 });
    expect(moveToTarget(0, 0, 3, 4, 50)).toEqual({ x: 3, y: 4 });
  });

  it('steps exactly `speed` along the line when the target is further away', () => {
    const step = moveToTarget(0, 0, 30, 40, 5);
    expect(step.x).toBeCloseTo(3);
    expect(step.y).toBeCloseTo(4);
    expect(Math.hypot(step.x, step.y)).toBeCloseTo(5);
  });

  it('reports the heading of the step it just took', () => {
    expect(moveToTarget(0, 0, 10, 0, 1).ang).toBeCloseTo(0);
    expect(moveToTarget(0, 0, 0, 10, 1).ang).toBeCloseTo(Math.PI / 2);
    expect(moveToTarget(0, 0, -10, 0, 1).ang).toBeCloseTo(Math.PI);
  });

  it('moves relative to the current position, not the origin', () => {
    const step = moveToTarget(100, 100, 130, 140, 5);
    expect(step.x).toBeCloseTo(103);
    expect(step.y).toBeCloseTo(104);
  });

  it('snaps only on a strictly longer step, so an exact-distance step is computed', () => {
    // The snap test is `speed > distance`, so speed === distance falls through to the
    // maths. Both land on the target; only the computed branch carries `ang`, and the
    // snap branch is the one callers must not read a heading from.
    expect(moveToTarget(0, 0, 3, 4, 5.5).ang).toBeUndefined();

    const exact = moveToTarget(0, 0, 3, 4, 5);
    expect(exact.x).toBeCloseTo(3);
    expect(exact.y).toBeCloseTo(4);
    expect(exact.ang).toBeCloseTo(Math.atan2(4, 3));
  });
});

describe('rotate_point_about_axis', () => {
  it('rotates a quarter turn about the origin', () => {
    const p = rotate_point_about_axis({ x: 0, y: 0 }, 90, { x: 10, y: 0 });
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(10);
  });

  it('rotates about an arbitrary axis', () => {
    const p = rotate_point_about_axis({ x: 5, y: 5 }, 180, { x: 7, y: 5 });
    expect(p.x).toBeCloseTo(3);
    expect(p.y).toBeCloseTo(5);
  });

  it('is a no-op at 0 and 360 degrees', () => {
    expect(rotate_point_about_axis({ x: 1, y: 2 }, 0, { x: 9, y: 4 })).toEqual({ x: 9, y: 4 });
    const full = rotate_point_about_axis({ x: 1, y: 2 }, 360, { x: 9, y: 4 });
    expect(full.x).toBeCloseTo(9);
    expect(full.y).toBeCloseTo(4);
  });

  it('mutates the point it is given and returns that same object', () => {
    // Callers (gun spread) rely on this; pinned so an extraction cannot quietly change it.
    const p = { x: 10, y: 0 };
    const returned = rotate_point_about_axis({ x: 0, y: 0 }, 90, p);
    expect(returned).toBe(p);
    expect(p.y).toBeCloseTo(10);
  });
});

describe('randomIntFromInterval', () => {
  it('returns min at the bottom of the random range and stops short of max', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(randomIntFromInterval(3, 8)).toBe(3);

    vi.spyOn(Math, 'random').mockReturnValue(0.999999);
    // max is exclusive — the roll can never produce 8.
    expect(randomIntFromInterval(3, 8)).toBe(7);
  });

  it('floors towards min', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    expect(randomIntFromInterval(0, 5)).toBe(2);
  });
});

describe('randomFloatFromInterval', () => {
  it('interpolates between min and max', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(randomFloatFromInterval(2, 10)).toBeCloseTo(2);

    vi.spyOn(Math, 'random').mockReturnValue(0.25);
    expect(randomFloatFromInterval(2, 10)).toBeCloseTo(4);

    vi.spyOn(Math, 'random').mockReturnValue(1);
    expect(randomFloatFromInterval(2, 10)).toBeCloseTo(10);
  });
});

describe('randomFloatWithBias', () => {
  it('squares the roll so low values are far more likely', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    // (0.5 * 0.5 * max) + min — min shifts the result, it does not bound it, so the
    // range is [min, max + min) rather than [min, max]. Pinned as the current behaviour.
    expect(randomFloatWithBias(1, 8)).toBeCloseTo(3);
    expect(randomFloatWithBias2(1, 8)).toBeCloseTo(3);
  });

  it('produces a mean well below the midpoint of the range', () => {
    let seed = 1;
    vi.spyOn(Math, 'random').mockImplementation(() => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    });
    let sum = 0;
    for (let i = 0; i < 2000; i++) sum += randomFloatWithBias(0, 100);
    // E[U1*U2] = 0.25, versus 0.5 for a flat roll.
    expect(sum / 2000).toBeGreaterThan(20);
    expect(sum / 2000).toBeLessThan(30);
  });
});
