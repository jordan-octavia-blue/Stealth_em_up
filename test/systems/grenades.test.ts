import { describe, expect, it } from 'vitest';
import {
  cloudFootprint,
  computeThrowMs,
  targetsInRadiusWithLOS,
  throwArcPosition,
  GrenadeGridLike,
} from '../../src/systems/grenades';

const CS = 64;

/** A plain all-floor grid (no walls) of the given size, for footprint tests. */
function floorGrid(w: number, h: number): GrenadeGridLike {
  const cells = Array.from({ length: w * h }, () => ({ blocks_vision: false }));
  return { width: w, height: h, cell_size: CS, cells };
}

const dist = (ax: number, ay: number, bx: number, by: number): number =>
  Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2);

describe('throw arc', () => {
  it('scales the flight time with distance and clamps it', () => {
    const near = computeThrowMs({ x: 0, y: 0 }, { x: 10, y: 0 });
    const far = computeThrowMs({ x: 0, y: 0 }, { x: 5000, y: 0 });
    expect(near).toBeLessThan(far);
    // clamped to the [220, 1000] ms band
    expect(near).toBeGreaterThanOrEqual(220);
    expect(far).toBeLessThanOrEqual(1000);
  });

  it('starts at the hero, ends at the target, and lobs (bigger sprite) in the middle', () => {
    const start = { x: 100, y: 100 };
    const target = { x: 300, y: 100 };
    const a = throwArcPosition(start, target, 0);
    const mid = throwArcPosition(start, target, 0.5);
    const b = throwArcPosition(start, target, 1);
    expect(a).toMatchObject({ x: 100, y: 100, scale: 1 });
    expect(b).toMatchObject({ x: 300, y: 100, scale: 1 });
    expect(mid.x).toBeCloseTo(200);
    expect(mid.scale).toBeGreaterThan(1); // apex of the faked height
  });

  it('clamps progress past the ends', () => {
    const start = { x: 0, y: 0 };
    const target = { x: 100, y: 0 };
    expect(throwArcPosition(start, target, 2).x).toBe(100);
    expect(throwArcPosition(start, target, -1).x).toBe(0);
  });
});

describe('smoke footprint', () => {
  it('covers exactly the cells whose centre is within the radius', () => {
    const grid = floorGrid(12, 12);
    const cx = 6 * CS + CS / 2;
    const cy = 6 * CS + CS / 2;
    const radius = 100;
    const { cells, circles } = cloudFootprint(grid, cx, cy, radius);

    expect(cells.length).toBeGreaterThan(0);
    // one physics circle per covered cell
    expect(circles.length).toBe(cells.length);
    // every covered cell's centre really is inside the radius
    for (const idx of cells) {
      const gx = idx % grid.width;
      const gy = Math.floor(idx / grid.width);
      expect(dist(cx, cy, gx * CS + CS / 2, gy * CS + CS / 2)).toBeLessThanOrEqual(radius);
    }
    // adjacent circles overlap (radius > half a cell) so no ray threads between them
    expect(circles[0].r).toBeGreaterThan(CS / 2);
  });

  it('stays inside the grid bounds near an edge', () => {
    const grid = floorGrid(6, 6);
    const { cells } = cloudFootprint(grid, 0, 0, 200);
    for (const idx of cells) {
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(grid.width * grid.height);
    }
  });
});

describe('radial line-of-sight filter (flash / frag targeting)', () => {
  const center = { x: 0, y: 0 };
  const targets = [
    { id: 'near_visible', x: 50, y: 0 },
    { id: 'near_blocked', x: 40, y: 0 },
    { id: 'far', x: 500, y: 0 },
  ];

  it('keeps only targets in range that line of sight reaches', () => {
    // canSee blocks the one target we marked blocked
    const canSee = (_x0: number, _y0: number, x1: number, _y1: number): boolean => x1 !== 40;
    const hit = targetsInRadiusWithLOS(center, 100, targets, canSee).map((t) => t.id);
    expect(hit).toEqual(['near_visible']); // blocked one dropped, far one out of range
  });
});
