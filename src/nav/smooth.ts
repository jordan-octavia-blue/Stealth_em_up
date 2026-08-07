/**
 * String pulling (roadmap §4).
 *
 * The old `reducePathWithShortcut` idea is kept — a grid path is a staircase and units
 * should cut the corners off it — but reimplemented against the nav grid's walkability
 * flags instead of the 40-step DDA raycaster, and unit-tested. (Phase 4 swaps the
 * clearance test for physics raycasts without changing this file's shape.)
 *
 * Clearance is checked the way the original did it: not one centre line but the two
 * lines offset perpendicular by the unit's radius, so a shortcut is only taken when the
 * unit's whole body fits — that is what stops guards from clipping wall corners.
 */

import { NavGrid, Point } from './navgrid';

/**
 * Walk every cell a segment passes through (Amanatides & Woo voxel traversal), calling
 * `visit` on each. Stops early and returns false if `visit` does. Cells outside the
 * grid count as a stop.
 */
export function forEachCellOnSegment(
  grid: NavGrid,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  visit: (index: number) => boolean,
): boolean {
  const cs = grid.cellSize;
  let cx = Math.floor(x0 / cs);
  let cy = Math.floor(y0 / cs);
  const endX = Math.floor(x1 / cs);
  const endY = Math.floor(y1 / cs);

  const dx = x1 - x0;
  const dy = y1 - y0;
  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;

  // Parametric distance (0..1 along the segment) to the next cell boundary on each axis.
  const tDeltaX = stepX === 0 ? Infinity : cs / Math.abs(dx);
  const tDeltaY = stepY === 0 ? Infinity : cs / Math.abs(dy);
  let tMaxX =
    stepX === 0
      ? Infinity
      : stepX > 0
        ? ((cx + 1) * cs - x0) / dx
        : (cx * cs - x0) / dx;
  let tMaxY =
    stepY === 0
      ? Infinity
      : stepY > 0
        ? ((cy + 1) * cs - y0) / dy
        : (cy * cs - y0) / dy;

  for (;;) {
    if (!grid.inBounds(cx, cy)) return false;
    if (!visit(grid.index(cx, cy))) return false;
    if (cx === endX && cy === endY) return true;
    if (tMaxX < tMaxY) {
      if (tMaxX > 1) return true;
      cx += stepX;
      tMaxX += tDeltaX;
    } else {
      if (tMaxY > 1) return true;
      cy += stepY;
      tMaxY += tDeltaY;
    }
  }
}

/** True when nothing solid lies on the straight line between two world points. */
export function isSegmentWalkable(
  grid: NavGrid,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): boolean {
  return forEachCellOnSegment(grid, x0, y0, x1, y1, (index) => grid.walkable[index] === 1);
}

/**
 * True when a unit of `radius` can walk straight from a to b: both flanks of the
 * corridor it sweeps are clear, not just its centre line.
 */
export function isCorridorWalkable(
  grid: NavGrid,
  a: Point,
  b: Point,
  radius: number,
): boolean {
  if (radius <= 0) return isSegmentWalkable(grid, a.x, a.y, b.x, b.y);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return grid.isWalkable(grid.indexAtPoint(a.x, a.y));
  // unit normal
  const nx = (-dy / len) * radius;
  const ny = (dx / len) * radius;
  return (
    isSegmentWalkable(grid, a.x + nx, a.y + ny, b.x + nx, b.y + ny) &&
    isSegmentWalkable(grid, a.x - nx, a.y - ny, b.x - nx, b.y - ny)
  );
}

/**
 * Turn a path of cell indices into world waypoints, dropping every waypoint the unit
 * can skip.
 *
 * `start` is the unit's actual position — anchoring on it instead of on the centre of
 * the cell it happens to stand in stops the little backwards jog the old code produced
 * when a guard was near a cell edge. The unit is already at the anchor, so the anchor
 * is not part of the returned waypoints.
 */
export function smoothPath(
  grid: NavGrid,
  cells: readonly number[],
  radius: number,
  start?: Point,
): Point[] {
  if (cells.length === 0) return [];
  const points: Point[] = cells.map((index) => grid.pointAtIndex(index));
  // Centre of the cell the unit stands in. Unlike the unit's real position it sits a full
  // body-radius clear of that walkable cell's walls, so it is a safe pivot to lead with.
  const startCellCentre = points[0];
  if (start) points[0] = { x: start.x, y: start.y };

  const out: Point[] = [];
  let anchor = 0;
  while (anchor < points.length - 1) {
    // Reach as far ahead as stays clear, then commit to that waypoint. Stopping at the
    // first blocked candidate (rather than scanning the whole tail) keeps this linear.
    let furthest = anchor + 1;
    for (let i = anchor + 2; i < points.length; i++) {
      if (!isCorridorWalkable(grid, points[anchor], points[i], radius)) break;
      furthest = i;
    }
    out.push(points[furthest]);
    anchor = furthest;
  }

  // Every leg but the first runs centre-to-centre between corner-safe cells, so the body
  // clears it. The first leg is the exception: it starts at the unit's real position, and
  // `furthest = anchor + 1` commits to it with no clearance test. When physics has packed
  // the unit off-centre against a wall, the straight line from there to the first cell
  // centre can clip the very corner the grid path was routed around — the "path through a
  // wall" that leaves a guard grinding along it. If that leg isn't clear for the body,
  // lead with the unit's own cell centre: reaching it is clear, and from a cell centre the
  // rest of the path was already safe.
  if (start && out.length > 0 && !isCorridorWalkable(grid, points[0], out[0], radius)) {
    out.unshift(startCellCentre);
  }
  return out;
}
