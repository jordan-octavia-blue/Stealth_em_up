import { describe, expect, it } from 'vitest';

import '../src/legacy/jo_utility';

describe('get_distance', () => {
  it('measures a 3-4-5 triangle', () => {
    expect(get_distance(0, 0, 3, 4)).toBe(5);
    expect(get_distance(3, 4, 0, 0)).toBe(5);
  });

  it('is zero for a point against itself', () => {
    expect(get_distance(12, -7, 12, -7)).toBe(0);
  });
});

describe('findAngleBetweenPoints', () => {
  const cases: Array<[number, number, number]> = [
    [1, 0, 0],
    [0, 1, Math.PI / 2],
    [-1, 0, Math.PI],
    [0, -1, -Math.PI / 2],
    [1, 1, Math.PI / 4],
  ];

  it.each(cases)('points at (%d, %d)', (dx, dy, expected) => {
    expect(findAngleBetweenPoints({ x: 0, y: 0 }, { x: dx, y: dy })).toBeCloseTo(expected);
  });

  it('is relative to the start point', () => {
    expect(findAngleBetweenPoints({ x: 50, y: 50 }, { x: 60, y: 50 })).toBeCloseTo(0);
  });
});

describe('angle_between', () => {
  it('accepts an angle inside the arc and rejects one outside', () => {
    expect(angle_between(45, 30, 60)).toBe(true);
    expect(angle_between(90, 30, 60)).toBe(false);
  });

  it('includes both ends of the arc', () => {
    expect(angle_between(30, 30, 60)).toBe(true);
    expect(angle_between(60, 30, 60)).toBe(true);
  });

  it('handles an arc that wraps past 0/360', () => {
    expect(angle_between(0, 350, 10)).toBe(true);
    expect(angle_between(355, 350, 10)).toBe(true);
    expect(angle_between(5, 350, 10)).toBe(true);
    expect(angle_between(180, 350, 10)).toBe(false);
  });

  it('normalises out-of-range and negative angles', () => {
    expect(angle_between(405, 30, 60)).toBe(true); // 405 -> 45
    expect(angle_between(-315, 30, 60)).toBe(true); // -315 -> 45
    expect(angle_between(45, -330, 60)).toBe(true); // -330 -> 30
  });
});

describe('angleInArc', () => {
  it('matches the worked example in the source comment', () => {
    // 45,25 is a 25-degree arc centred on 45 degrees: 32.5 .. 57.5
    expect(angleInArc(45, 25, 40)).toBe(true);
    expect(angleInArc(45, 25, 32.5)).toBe(true);
    expect(angleInArc(45, 25, 57.5)).toBe(true);
    expect(angleInArc(45, 25, 60)).toBe(false);
  });

  it('handles a cone straddling 0 degrees', () => {
    expect(angleInArc(0, 90, 20)).toBe(true);
    expect(angleInArc(0, 90, 340)).toBe(true);
    expect(angleInArc(0, 90, 180)).toBe(false);
  });

  it('is the guard vision-cone test: wider arcs see more', () => {
    expect(angleInArc(90, 20, 105)).toBe(false);
    expect(angleInArc(90, 60, 105)).toBe(true);
  });
});

describe('angleInArcRad', () => {
  it('is angleInArc with radian inputs', () => {
    expect(angleInArcRad(Math.PI / 2, Math.PI / 3, Math.PI / 2)).toBe(true);
    expect(angleInArcRad(Math.PI / 2, Math.PI / 3, Math.PI)).toBe(false);
  });

  it('agrees with the degree version for the same cone', () => {
    const deg = (r: number) => (r * 180) / Math.PI;
    const arc = Math.PI / 4;
    const size = Math.PI / 6;
    for (const a of [0, 0.3, 0.9, 2.0, -1.2]) {
      expect(angleInArcRad(arc, size, a)).toBe(angleInArc(deg(arc), deg(size), deg(a)));
    }
  });
});

describe('circle_linesetment_intersect', () => {
  const circle = { center: { x: 50, y: 50 }, radius: 10 };

  it('hits a segment driven straight through the circle (impale)', () => {
    expect(circle_linesetment_intersect(circle, { x: 0, y: 50 }, { x: 100, y: 50 })).toBe(true);
  });

  it('hits a segment that stops inside the circle (poke)', () => {
    expect(circle_linesetment_intersect(circle, { x: 0, y: 50 }, { x: 50, y: 50 })).toBe(true);
  });

  it('hits a segment that starts inside and leaves (exit wound)', () => {
    expect(circle_linesetment_intersect(circle, { x: 50, y: 50 }, { x: 100, y: 50 })).toBe(true);
  });

  it('misses a segment that stops short', () => {
    expect(circle_linesetment_intersect(circle, { x: 0, y: 50 }, { x: 20, y: 50 })).toBe(false);
  });

  it('misses a segment that passes by the side', () => {
    expect(circle_linesetment_intersect(circle, { x: 0, y: 0 }, { x: 100, y: 0 })).toBe(false);
  });

  it('misses a segment contained entirely inside the circle', () => {
    // Not an oversight in the test: the algorithm only reports boundary crossings, so a
    // segment that never reaches the edge reads as a miss. Bullet code relies on it.
    expect(circle_linesetment_intersect(circle, { x: 48, y: 50 }, { x: 52, y: 50 })).toBe(false);
  });

  it('grazes the circle exactly at the tangent', () => {
    expect(circle_linesetment_intersect(circle, { x: 0, y: 40 }, { x: 100, y: 40 })).toBe(true);
  });
});

describe('positionInCircle', () => {
  it('returns the bearing from the circle centre, in degrees', () => {
    const c = { x: 100, y: 100 };
    expect(positionInCircle(c, 110, 100)).toBeCloseTo(0);
    expect(positionInCircle(c, 100, 110)).toBeCloseTo(90);
    expect(positionInCircle(c, 90, 100)).toBeCloseTo(180);
    expect(positionInCircle(c, 100, 90)).toBeCloseTo(-90);
  });
});

describe('quickSort', () => {
  const byAngle = (xs: number[]) =>
    quickSort(
      xs.map((angle) => ({ angle })),
      0,
      xs.length - 1,
    ).map((p: { angle: number }) => p.angle);

  it('sorts LOS points by angle', () => {
    expect(byAngle([3, 1, 2])).toEqual([1, 2, 3]);
    expect(byAngle([5, 4, 3, 2, 1])).toEqual([1, 2, 3, 4, 5]);
    expect(byAngle([-2.5, 0, 3.1, -0.4])).toEqual([-2.5, -0.4, 0, 3.1]);
  });

  it('keeps duplicates and handles already-sorted and single-element input', () => {
    expect(byAngle([1, 1, 2, 2])).toEqual([1, 1, 2, 2]);
    expect(byAngle([1, 2, 3])).toEqual([1, 2, 3]);
    expect(byAngle([7])).toEqual([7]);
  });

  it('sorts a larger shuffled set', () => {
    const input = Array.from({ length: 64 }, (_, i) => ((i * 37) % 64) - 32);
    expect(byAngle(input)).toEqual([...input].sort((a, b) => a - b));
  });

  it('sorts in place and returns the same array', () => {
    const items = [{ angle: 2 }, { angle: 1 }];
    expect(quickSort(items, 0, 1)).toBe(items);
    expect(items[0].angle).toBe(1);
  });
});

describe('swap', () => {
  it('exchanges two entries', () => {
    const items = ['a', 'b', 'c'];
    swap(items, 0, 2);
    expect(items).toEqual(['c', 'b', 'a']);
  });
});

describe('Ray', () => {
  it('holds a start and an end that can be reset in place', () => {
    const ray = new Ray(1, 2, 3, 4);
    expect(ray.start).toEqual({ x: 1, y: 2 });
    expect(ray.end).toEqual({ x: 3, y: 4 });

    const start = ray.start;
    ray.set(10, 20, 30, 40);
    expect(ray.start).toEqual({ x: 10, y: 20 });
    expect(ray.end).toEqual({ x: 30, y: 40 });
    expect(ray.start).toBe(start);
  });
});
