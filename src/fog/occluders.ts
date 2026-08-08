/**
 * Occluder extraction (roadmap §8.1).
 *
 * The vision-blocking edges of the map, derived from the **live** grid every time the
 * cache is invalidated — not collected once at setup like the old `setupLOS`, which is
 * why the previous fog could never have tracked a door, let alone a blown-open wall.
 *
 * Edges are emitted only where a vision-blocking cell meets a see-through one, and
 * collinear runs are merged into single segments. On `bank_1` that turns ~450 wall cells
 * (1800 raw edges) into a couple of hundred segments, which is what keeps the per-frame
 * visibility sweep cheap.
 *
 * Pure geometry: no Pixi, no globals, no physics. `src/render/fog.ts` owns the cache.
 */

export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** The shape of the legacy `jo_grid` this module reads. */
export interface OccluderGridLike {
  width: number;
  height: number;
  cell_size: number;
  cells: Array<{ blocks_vision: boolean }>;
}

/**
 * Vision-blocking boundary edges of the grid, merged along each run.
 *
 * Everything outside the map counts as blocking, so the border walls do not emit
 * outward-facing edges nobody can ever stand behind. The four map-boundary segments are
 * appended regardless, so a sweep can never escape a map whose edge is not walled in.
 *
 * `inset` pushes each wall edge that many pixels *into* the wall, away from the open cell
 * it borders. The visibility sweep then reaches that far past the wall's front face, so a
 * strip of the wall stays lit instead of the whole wall being swallowed by shadow — the
 * Teleglitch look. Walls are at least one full `cell_size` thick and the inset is small,
 * so a ray can never cross a wall through it: it only ever reveals the wall's own near
 * face. The four map-boundary segments are never inset (there is nothing behind them).
 */
export function buildOccluders(grid: OccluderGridLike, inset = 0): Segment[] {
  const { width, height, cells } = grid;
  const cs = grid.cell_size;
  const out: Segment[] = [];

  const blocking = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= width || y >= height) return true;
    const cell = cells[y * width + x];
    return cell ? cell.blocks_vision : true;
  };

  // Horizontal runs: the top edge of every blocking cell whose northern neighbour is
  // see-through, then the same for bottom edges. `-side * inset` slides the line off the
  // wall's face and into its body (south for a top edge, north for a bottom edge).
  for (const side of [-1, 1] as const) {
    for (let y = 0; y < height; y++) {
      const lineY = (side === -1 ? y * cs : (y + 1) * cs) - side * inset;
      let runStart = -1;
      for (let x = 0; x <= width; x++) {
        const isEdge = x < width && blocking(x, y) && !blocking(x, y + side);
        if (isEdge && runStart < 0) runStart = x;
        else if (!isEdge && runStart >= 0) {
          out.push({ x1: runStart * cs, y1: lineY, x2: x * cs, y2: lineY });
          runStart = -1;
        }
      }
    }
  }

  // Vertical runs: west edges, then east edges, slid into the wall the same way.
  for (const side of [-1, 1] as const) {
    for (let x = 0; x < width; x++) {
      const lineX = (side === -1 ? x * cs : (x + 1) * cs) - side * inset;
      let runStart = -1;
      for (let y = 0; y <= height; y++) {
        const isEdge = y < height && blocking(x, y) && !blocking(x + side, y);
        if (isEdge && runStart < 0) runStart = y;
        else if (!isEdge && runStart >= 0) {
          out.push({ x1: lineX, y1: runStart * cs, x2: lineX, y2: y * cs });
          runStart = -1;
        }
      }
    }
  }

  const w = width * cs;
  const h = height * cs;
  out.push({ x1: 0, y1: 0, x2: w, y2: 0 });
  out.push({ x1: w, y1: 0, x2: w, y2: h });
  out.push({ x1: w, y1: h, x2: 0, y2: h });
  out.push({ x1: 0, y1: h, x2: 0, y2: 0 });

  return out;
}
