import { NavGrid } from '../../src/nav/navgrid';

/**
 * Build a NavGrid from an ASCII map, so the pathfinding tests read as pictures.
 *
 *   '#' solid   '.' floor   'D' door (walkable, chokepoint cost)   'R' restricted
 */
export function gridFromAscii(rows: string[], cellSize = 64): NavGrid {
  const height = rows.length;
  const width = rows[0].length;
  for (const row of rows) {
    if (row.length !== width) throw new Error(`ragged ascii map: "${row}"`);
  }
  const grid = new NavGrid(width, height, cellSize);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ch = rows[y][x];
      const i = grid.index(x, y);
      grid.walkable[i] = ch === '#' ? 0 : 1;
      grid.baseCost[i] = ch === 'R' ? 1.15 : 1;
      grid.doorCost[i] = ch === 'D' ? 1.5 : 0;
    }
  }
  grid.version++;
  return grid;
}

/** Centre of cell (x, y) in world pixels. */
export function center(grid: NavGrid, x: number, y: number): { x: number; y: number } {
  return grid.pointAtIndex(grid.index(x, y));
}

/** Render a path of cell indices as "x,y" pairs — readable assertion failures. */
export function asCoords(grid: NavGrid, path: readonly number[]): string[] {
  return path.map((i) => `${grid.cellX(i)},${grid.cellY(i)}`);
}
