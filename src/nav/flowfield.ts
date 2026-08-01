/**
 * Flow field — one reverse Dijkstra, every converging guard steers by table lookup
 * (roadmap §4).
 *
 * When the whole squad converges on a single target (the hero's last known position)
 * the old code ran one full A* per guard. Instead this runs ONE Dijkstra outward from
 * the target across the walkable grid, producing:
 *
 *   distance[i]  accumulated cost from cell i to the target (Infinity if unreachable)
 *   dir[i]       the direction index of the first step of the best route (-1 at the
 *                target and in unreachable cells)
 *
 * 15 guards then converge for the price of one search. The distance layer double-serves
 * as the hearing-occlusion model in Phase 6 (sound travels *around* walls with falloff,
 * instead of today's flat 500 px through-wall radius) and as "path distance to hero"
 * for AI utility scoring.
 */

import { IndexHeap } from './heap';
import { ALL_DIRS, DIR_COST, DIR_X, DIR_Y, NavGrid, OPPOSITE_DIR } from './navgrid';

export class FlowField {
  readonly distance: Float32Array;
  /** Direction index (into DIR_X/DIR_Y) of the step *towards* the target. */
  readonly dir: Int8Array;
  /** Cell the field converges on. */
  target = -1;
  /** NavGrid.version this field was computed against. */
  version = -1;

  constructor(size: number) {
    this.distance = new Float32Array(size).fill(Infinity);
    this.dir = new Int8Array(size).fill(-1);
  }

  reachable(index: number): boolean {
    return index >= 0 && index < this.distance.length && this.distance[index] !== Infinity;
  }

  distanceAt(index: number): number {
    if (index < 0 || index >= this.distance.length) return Infinity;
    return this.distance[index];
  }
}

const heap = new IndexHeap(1024);
let closed = new Uint8Array(0);

/** (Re)compute the field for `target`, reusing `into`'s arrays when given. */
export function computeFlowField(grid: NavGrid, target: number, into?: FlowField): FlowField {
  const field = into ?? new FlowField(grid.size);
  field.distance.fill(Infinity);
  field.dir.fill(-1);
  field.target = target;
  field.version = grid.version;
  if (!grid.isWalkable(target)) return field;

  const { distance, dir } = field;
  if (closed.length < grid.size) closed = new Uint8Array(grid.size);
  closed.fill(0, 0, grid.size);
  heap.clear();

  distance[target] = 0;
  heap.push(target, distance);

  while (heap.size > 0) {
    const current = heap.pop(distance);
    // Lazy deletion instead of decrease-key: a node can be in the heap several times,
    // and every copy after the first pop is stale.
    if (closed[current] === 1) continue;
    closed[current] = 1;

    for (let d = 0; d < ALL_DIRS; d++) {
      // Stepping outward from the target, so every edge is walked backwards: the
      // neighbour's route to the target is the *opposite* of this step.
      const next = grid.neighbor(current, d);
      if (next === -1 || closed[next] === 1) continue;
      // `next` travels *into* `current` on its way to the target, so it pays
      // `current`'s node cost — the same convention A*'s g-score uses.
      const candidate = distance[current] + DIR_COST[d] * grid.costAt(current);
      if (candidate >= distance[next]) continue;
      distance[next] = candidate;
      dir[next] = OPPOSITE_DIR[d];
      heap.push(next, distance);
    }
  }

  return field;
}

/**
 * Walk the direction table from `start` to the field's target.
 *
 * Pure table lookups — no search — so a whole squad converging costs one Dijkstra plus
 * a handful of array reads each. Returns an empty path when `start` cannot reach the
 * target.
 */
export function pathFromField(grid: NavGrid, field: FlowField, start: number): number[] {
  if (!field.reachable(start)) return [];
  const path: number[] = [start];
  let current = start;
  // The distance strictly decreases each step, so this cannot loop; the cap is pure
  // belt-and-braces against a field built against different geometry.
  for (let guard = 0; guard <= grid.size && current !== field.target; guard++) {
    const d = field.dir[current];
    if (d === -1) return [];
    const next = grid.index(grid.cellX(current) + DIR_X[d], grid.cellY(current) + DIR_Y[d]);
    path.push(next);
    current = next;
  }
  return current === field.target ? path : [];
}
