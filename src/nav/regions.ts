/**
 * Connected-component labelling (roadmap §4).
 *
 * A flood fill using exactly the same step rule as the searches (`NavGrid.canStep`, so
 * no corner cutting), which is what makes "same label" equivalent to "a path exists".
 * That turns reachability into an O(1) integer compare and destination sampling into
 * "pick any cell from my own region" — which is what kills the per-frame A* storm at
 * the source: a guard can no longer ask for a patrol destination it cannot reach.
 *
 * The whole pass is O(1600) on this map, so it is simply recomputed on any walkability
 * change rather than being incrementally patched.
 */

import { ALL_DIRS, NavGrid } from './navgrid';

export class RegionMap {
  /** Region label per cell; -1 for unwalkable cells. */
  readonly labels: Int32Array;
  /** Cell indices per region label, for O(1) random sampling. */
  readonly cells: number[][] = [];
  /** NavGrid.version this labelling was computed against. */
  version = -1;

  constructor(size: number) {
    this.labels = new Int32Array(size).fill(-1);
  }

  get count(): number {
    return this.cells.length;
  }

  labelAt(index: number): number {
    if (index < 0 || index >= this.labels.length) return -1;
    return this.labels[index];
  }

  /** True when both cells are walkable and a path between them exists. */
  connected(a: number, b: number): boolean {
    const la = this.labelAt(a);
    return la !== -1 && la === this.labelAt(b);
  }

  /** How many walkable cells share `index`'s region (0 if it has none). */
  regionSize(index: number): number {
    const label = this.labelAt(index);
    return label === -1 ? 0 : this.cells[label].length;
  }

  /**
   * A uniformly random cell from `index`'s own region — guaranteed reachable.
   * Returns -1 when the cell is unwalkable or alone in its region.
   */
  randomCellInRegionOf(index: number, random: () => number = Math.random): number {
    const label = this.labelAt(index);
    if (label === -1) return -1;
    const members = this.cells[label];
    if (members.length === 0) return -1;
    return members[Math.floor(random() * members.length) % members.length];
  }
}

/** (Re)label `grid` into `into`, reusing its arrays. */
export function labelRegions(grid: NavGrid, into?: RegionMap): RegionMap {
  const map = into ?? new RegionMap(grid.size);
  map.labels.fill(-1);
  map.cells.length = 0;

  // One reusable stack; the fill is iterative because a 1600-cell recursion is a
  // needless stack risk for zero readability gain.
  const stack: number[] = [];
  for (let seed = 0; seed < grid.size; seed++) {
    if (grid.walkable[seed] !== 1 || map.labels[seed] !== -1) continue;

    const label = map.cells.length;
    const members: number[] = [];
    map.cells.push(members);

    map.labels[seed] = label;
    members.push(seed);
    stack.push(seed);

    while (stack.length > 0) {
      const current = stack.pop() as number;
      for (let dir = 0; dir < ALL_DIRS; dir++) {
        const next = grid.neighbor(current, dir);
        if (next === -1 || map.labels[next] !== -1) continue;
        map.labels[next] = label;
        members.push(next);
        stack.push(next);
      }
    }
  }

  map.version = grid.version;
  return map;
}
