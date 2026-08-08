/**
 * Adapt an editor `MapData` to the shape the game's wall autotiler reads.
 *
 * `findWallType` (src/render/autotile.ts) decides which of the six black-wall sprites a wall
 * cell uses from its four orthogonal neighbours. It asks a grid for `getCellFromIndex(x,y)`
 * and treats a neighbour as "wall" only when it is `solid && !door && blocks_vision`. The
 * game derives those three flags from the tile code when it builds the grid; the editor has
 * only the raw `data[]` array, so this adapter reproduces the exact same derivation. Feeding
 * `findWallType` through this adapter makes the editor draw walls pixel-for-pixel like the
 * game — the whole reason the editor reuses the game's autotiler instead of its own.
 */

import type { MapData } from '../map/loader';
import type { AutotileGridLike, WallCellLike } from '../render/autotile';

/**
 * The three autotile flags implied by a tile code, matching the `switch` in
 * `src/legacy/jo_grid.ts`:
 *  - 1 black wall  → solid, opaque            (counts as a wall neighbour)
 *  - 3 brown desk  → solid but see-through    (not a wall neighbour)
 *  - 5/6 door      → solid, opaque, but door  (not a wall neighbour)
 *  - 2/4 floor     → neither                  (not a wall neighbour)
 * Net effect: only code 1 counts as a wall for autotiling, exactly as in the game.
 */
export function cellFlagsForCode(code: number): WallCellLike {
  switch (code) {
    case 1:
      return { solid: true, door: false, blocks_vision: true };
    case 3:
      return { solid: true, door: false, blocks_vision: false };
    case 5:
    case 6:
      return { solid: true, door: true, blocks_vision: true };
    default:
      return { solid: false, door: false, blocks_vision: false };
  }
}

/** Wrap a `MapData` (read-only) as the grid `findWallType` expects. */
export function autotileAdapter(map: MapData): AutotileGridLike {
  return {
    getCellFromIndex(x: number, y: number): WallCellLike | undefined {
      if (x < 0 || y < 0 || x >= map.width || y >= map.height) return undefined;
      return cellFlagsForCode(map.data[map.width * y + x]);
    },
  };
}
