/**
 * A* over the NavGrid (roadmap §4).
 *
 * 8-connected, octile heuristic, corner-cutting forbidden (`NavGrid.canStep`).
 * Cost layers are summed at expansion, which is exactly why JPS was rejected: it
 * assumes uniform edge costs and the danger/door layers deliberately are not uniform.
 * Plain A* over 1600 nodes is microseconds anyway.
 *
 * The heuristic is admissible only if it never over-estimates, so it is scaled by the
 * grid's *minimum* per-node cost (1 unless a map lowers `baseCost`). Cost layers only
 * ever raise costs above 1, so the plain octile distance stays admissible in practice.
 */

import { IndexHeap } from './heap';
import { ALL_DIRS, DIR_COST, NavGrid } from './navgrid';

/** Diagonal-vs-straight constant of the octile heuristic. */
const OCTILE_D2_MINUS_2D = Math.SQRT2 - 2;

export interface SearchStats {
  /** Nodes popped from the open list. Used by the tests and the debug overlay. */
  expanded: number;
  /** True when the goal was reached. */
  found: boolean;
}

export interface SearchResult {
  /** Cell indices from start to goal inclusive; empty when no path exists. */
  path: number[];
  stats: SearchStats;
}

/** Octile distance in cells between two cells. */
export function octileDistance(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  return dx + dy + OCTILE_D2_MINUS_2D * Math.min(dx, dy);
}

const heap = new IndexHeap(1024);

/**
 * Find a path of cell indices from `start` to `goal`.
 *
 * Both ends must be walkable — callers snap them with `NavGrid.nearestWalkable` first.
 * Returns an empty path (not null) when the goal is unreachable, so callers can treat
 * "no path" and "already there" the same way.
 */
export function findPath(grid: NavGrid, start: number, goal: number): SearchResult {
  const stats: SearchStats = { expanded: 0, found: false };
  if (start < 0 || goal < 0 || start >= grid.size || goal >= grid.size) return { path: [], stats };
  if (!grid.isWalkable(start) || !grid.isWalkable(goal)) return { path: [], stats };
  if (start === goal) {
    stats.found = true;
    return { path: [start], stats };
  }

  const { gScore, fScore, cameFrom, state } = grid;
  const goalX = grid.cellX(goal);
  const goalY = grid.cellY(goal);

  grid.beginSearch();
  heap.clear();

  grid.touch(start);
  gScore[start] = 0;
  fScore[start] = octileDistance(grid.cellX(start), grid.cellY(start), goalX, goalY);
  cameFrom[start] = -1;
  state[start] = 1;
  heap.push(start, fScore);

  while (heap.size > 0) {
    const current = heap.pop(fScore);
    // A node can sit in the heap more than once (lazy deletion instead of decrease-key);
    // the stale copies are already closed by the time they come back up.
    if (state[current] === 2) continue;
    state[current] = 2;
    stats.expanded++;

    if (current === goal) {
      stats.found = true;
      return { path: reconstruct(cameFrom, current), stats };
    }

    for (let dir = 0; dir < ALL_DIRS; dir++) {
      const next = grid.neighbor(current, dir);
      if (next === -1) continue;
      const seen = grid.isTouched(next);
      if (seen && state[next] === 2) continue;

      const tentative = gScore[current] + DIR_COST[dir] * grid.costAt(next);
      if (seen && state[next] === 1 && gScore[next] <= tentative) continue;

      grid.touch(next);
      cameFrom[next] = current;
      gScore[next] = tentative;
      fScore[next] =
        tentative + octileDistance(grid.cellX(next), grid.cellY(next), goalX, goalY);
      state[next] = 1;
      heap.push(next, fScore);
    }
  }

  return { path: [], stats };
}

function reconstruct(cameFrom: Int32Array, goal: number): number[] {
  const path: number[] = [goal];
  let node = cameFrom[goal];
  while (node !== -1) {
    path.push(node);
    node = cameFrom[node];
  }
  path.reverse();
  return path;
}
