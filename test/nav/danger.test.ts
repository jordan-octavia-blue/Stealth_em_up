import { describe, expect, it } from 'vitest';
import { decayDanger, depositDanger, MAX_DANGER, peakDanger } from '../../src/nav/danger';
import { gridFromAscii } from './helpers';

describe('depositDanger', () => {
  it('is hottest at the centre and falls off with distance', () => {
    const grid = gridFromAscii([
      '.....',
      '.....',
      '.....',
      '.....',
      '.....',
    ]);
    depositDanger(grid, grid.index(2, 2), { amount: 6, radius: 2 });
    const centre = grid.dangerCost[grid.index(2, 2)];
    const near = grid.dangerCost[grid.index(3, 2)];
    const far = grid.dangerCost[grid.index(4, 2)];
    expect(centre).toBeCloseTo(6);
    expect(near).toBeGreaterThan(0);
    expect(near).toBeLessThan(centre);
    expect(far).toBeGreaterThan(0);
    expect(far).toBeLessThan(near);
    expect(grid.dangerCost[grid.index(0, 0)]).toBe(0);
  });

  it('accumulates when the same spot keeps getting people killed', () => {
    const grid = gridFromAscii(['...']);
    depositDanger(grid, grid.index(1, 0), { amount: 2, radius: 0 });
    depositDanger(grid, grid.index(1, 0), { amount: 2, radius: 0 });
    expect(grid.dangerCost[grid.index(1, 0)]).toBeCloseTo(4);
  });

  it('clamps, so one busy corridor cannot become impassable', () => {
    const grid = gridFromAscii(['...']);
    for (let i = 0; i < 50; i++) depositDanger(grid, grid.index(1, 0), { amount: 5, radius: 0 });
    expect(grid.dangerCost[grid.index(1, 0)]).toBe(MAX_DANGER);
  });

  it('skips solid cells and out-of-range centres', () => {
    const grid = gridFromAscii(['.#.']);
    depositDanger(grid, grid.index(1, 0), { amount: 5, radius: 1 });
    expect(grid.dangerCost[grid.index(1, 0)]).toBe(0);
    expect(grid.dangerCost[grid.index(0, 0)]).toBeGreaterThan(0);

    depositDanger(grid, -1, { amount: 5, radius: 1 });
    depositDanger(grid, 999, { amount: 5, radius: 1 });
    expect(peakDanger(grid)).toBeLessThan(5.1);
  });

  it('ignores a non-positive amount', () => {
    const grid = gridFromAscii(['...']);
    depositDanger(grid, 1, { amount: 0, radius: 2 });
    expect(peakDanger(grid)).toBe(0);
  });
});

describe('decayDanger', () => {
  it('halves a deposit every half-life', () => {
    const grid = gridFromAscii(['...']);
    depositDanger(grid, grid.index(1, 0), { amount: 8, radius: 0 });
    decayDanger(grid, 8, 8);
    expect(grid.dangerCost[grid.index(1, 0)]).toBeCloseTo(4);
    decayDanger(grid, 8, 8);
    expect(grid.dangerCost[grid.index(1, 0)]).toBeCloseTo(2);
  });

  it('is framerate-independent: two half steps equal one whole step', () => {
    const a = gridFromAscii(['.']);
    const b = gridFromAscii(['.']);
    depositDanger(a, 0, { amount: 10, radius: 0 });
    depositDanger(b, 0, { amount: 10, radius: 0 });
    decayDanger(a, 1, 8);
    decayDanger(b, 0.5, 8);
    decayDanger(b, 0.5, 8);
    expect(b.dangerCost[0]).toBeCloseTo(a.dangerCost[0], 5);
  });

  it('snaps a cooled cell to exactly zero', () => {
    const grid = gridFromAscii(['.']);
    depositDanger(grid, 0, { amount: 1, radius: 0 });
    decayDanger(grid, 200, 8);
    expect(grid.dangerCost[0]).toBe(0);
  });

  it('does nothing for a zero or negative step', () => {
    const grid = gridFromAscii(['.']);
    depositDanger(grid, 0, { amount: 4, radius: 0 });
    decayDanger(grid, 0, 8);
    decayDanger(grid, -1, 8);
    expect(grid.dangerCost[0]).toBeCloseTo(4);
  });
});

describe('peakDanger', () => {
  it('reports the hottest cell, for scaling the debug overlay', () => {
    const grid = gridFromAscii(['...']);
    expect(peakDanger(grid)).toBe(0);
    depositDanger(grid, grid.index(0, 0), { amount: 3, radius: 0 });
    depositDanger(grid, grid.index(2, 0), { amount: 7, radius: 0 });
    expect(peakDanger(grid)).toBeCloseTo(7);
  });
});
