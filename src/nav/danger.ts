/**
 * Danger heatmap (roadmap §4) — pure math over `NavGrid.dangerCost`, so it is fully
 * unit-testable and has no idea what a guard is.
 *
 * Deposits are splatted with linear falloff (large where an ally died, small on cells
 * where shots were fired) and decay exponentially with a half-life. Because the layer
 * is summed at node expansion, paths bend away from the places guards keep dying —
 * the mechanical half of the "stop walking into the meat grinder" fix that Phase 6's
 * squad logic builds on.
 */

import { NavGrid } from './navgrid';

/** Hard ceiling per cell, so one very busy corridor can't make the map impassable. */
export const MAX_DANGER = 12;

export interface DangerDeposit {
  /** Peak amount added at the centre cell. */
  amount: number;
  /** Falloff radius in cells; 0 deposits on the centre cell only. */
  radius: number;
}

/**
 * Add danger around `center`, falling off linearly to zero at `radius` cells.
 * Unwalkable cells are skipped — nothing paths through them anyway, and leaving them
 * at zero keeps the debug overlay readable.
 */
export function depositDanger(
  grid: NavGrid,
  center: number,
  { amount, radius }: DangerDeposit,
): void {
  if (center < 0 || center >= grid.size || amount <= 0) return;
  const cx = grid.cellX(center);
  const cy = grid.cellY(center);
  const r = Math.max(0, Math.floor(radius));
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!grid.inBounds(nx, ny)) continue;
      const index = grid.index(nx, ny);
      if (grid.walkable[index] !== 1) continue;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > r) continue;
      const falloff = r === 0 ? 1 : 1 - dist / (r + 1);
      const next = grid.dangerCost[index] + amount * falloff;
      grid.dangerCost[index] = next > MAX_DANGER ? MAX_DANGER : next;
    }
  }
}

/**
 * Exponential decay towards zero. `halfLifeSeconds` is how long a deposit takes to
 * lose half its value; values below `epsilon` are snapped to 0 so a cell that has
 * cooled off costs exactly as much as one that never saw trouble.
 */
export function decayDanger(
  grid: NavGrid,
  dtSeconds: number,
  halfLifeSeconds: number,
  epsilon = 0.01,
): void {
  if (dtSeconds <= 0 || halfLifeSeconds <= 0) return;
  const factor = Math.pow(0.5, dtSeconds / halfLifeSeconds);
  const danger = grid.dangerCost;
  for (let i = 0; i < danger.length; i++) {
    if (danger[i] === 0) continue;
    const next = danger[i] * factor;
    danger[i] = next < epsilon ? 0 : next;
  }
}

/** Highest value anywhere in the layer — the debug overlay scales its alpha by this. */
export function peakDanger(grid: NavGrid): number {
  let peak = 0;
  const danger = grid.dangerCost;
  for (let i = 0; i < danger.length; i++) {
    if (danger[i] > peak) peak = danger[i];
  }
  return peak;
}
