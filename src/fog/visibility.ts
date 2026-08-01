/**
 * Visibility polygon by angular sweep (roadmap §8.1).
 *
 * The replacement for the disabled "starburst": rays to every occluder corner (nudged a
 * hair either side), sorted **once** by angle, walked into a triangle fan. The old code
 * re-sorted its corner list every frame *and* spliced it into a new order, then relied
 * on temporarily mutating `unit.x/y` to fake the spyglass viewpoint — this takes the
 * viewpoint as an argument.
 *
 * Pure geometry: hand it an origin and a segment list, get a flat `[x, y, x, y, ...]`
 * polygon back in world pixels, ready for `PIXI.Graphics.drawPolygon`.
 */

import type { Segment } from './occluders';

export interface VisibilityOptions {
  /** Maximum view distance in pixels; the polygon is clipped to this circle. */
  radius: number;
  /** Facing, in radians. Required when `coneAngle` is set. */
  facing?: number;
  /** Total cone width in radians. Omit for a full 360° sweep. */
  coneAngle?: number;
  /** Number of samples used to round off the unobstructed edge of the view circle. */
  arcSamples?: number;
}

/** How far either side of a corner the probe rays are cast. */
const CORNER_EPSILON = 0.00015;
const TWO_PI = Math.PI * 2;

/**
 * The polygon of everything visible from `origin`.
 *
 * For a full sweep the result is a closed star-shaped polygon around the origin. For a
 * cone the origin itself is the first vertex, so the fan closes through the viewer.
 */
export function computeVisibility(
  origin: { x: number; y: number },
  segments: readonly Segment[],
  options: VisibilityOptions,
): number[] {
  const radius = options.radius;
  const limited = options.coneAngle !== undefined && options.coneAngle < TWO_PI;
  const span = limited ? (options.coneAngle as number) : TWO_PI;
  const start = limited ? (options.facing ?? 0) - span / 2 : -Math.PI;

  // Only occluders that can reach the view circle matter. On a 40x40 map this is the
  // difference between sweeping the whole building and sweeping the room you are in.
  const near: Segment[] = [];
  for (const s of segments) {
    if (Math.min(s.x1, s.x2) > origin.x + radius) continue;
    if (Math.max(s.x1, s.x2) < origin.x - radius) continue;
    if (Math.min(s.y1, s.y2) > origin.y + radius) continue;
    if (Math.max(s.y1, s.y2) < origin.y - radius) continue;
    near.push(s);
  }

  // Candidate directions: a pair straddling every corner (so the ray slips past it on
  // both sides and the polygon reaches whatever is behind), plus a regular sampling of
  // the arc so an unobstructed view rounds off instead of collapsing to a wedge.
  const angles: number[] = [];
  const pushAngle = (a: number): void => {
    const rel = norm(a - start);
    if (rel <= span) angles.push(rel);
  };
  for (const s of near) {
    const a1 = Math.atan2(s.y1 - origin.y, s.x1 - origin.x);
    const a2 = Math.atan2(s.y2 - origin.y, s.x2 - origin.x);
    pushAngle(a1 - CORNER_EPSILON);
    pushAngle(a1 + CORNER_EPSILON);
    pushAngle(a2 - CORNER_EPSILON);
    pushAngle(a2 + CORNER_EPSILON);
  }
  const samples = options.arcSamples ?? 64;
  const step = span / samples;
  for (let i = 0; i <= samples; i++) angles.push(Math.min(i * step, span));

  angles.sort((a, b) => a - b);

  const points: number[] = [];
  if (limited) points.push(origin.x, origin.y);
  let lastX = NaN;
  let lastY = NaN;
  for (const rel of angles) {
    const angle = start + rel;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    let best = radius;
    for (const s of near) {
      const t = raySegment(origin.x, origin.y, dx, dy, s);
      if (t >= 0 && t < best) best = t;
    }
    const px = origin.x + dx * best;
    const py = origin.y + dy * best;
    // Consecutive rays through open space land on the same wall; dropping the duplicate
    // keeps the polygon small enough for Pixi to redraw every frame without complaint.
    if (Math.abs(px - lastX) < 0.01 && Math.abs(py - lastY) < 0.01) continue;
    points.push(px, py);
    lastX = px;
    lastY = py;
  }
  return points;
}

/** Distance along the ray to a segment, or -1 when it misses. */
function raySegment(
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  s: Segment,
): number {
  const sx = s.x2 - s.x1;
  const sy = s.y2 - s.y1;
  const denom = dx * sy - dy * sx;
  if (denom > -1e-12 && denom < 1e-12) return -1;
  const ax = s.x1 - ox;
  const ay = s.y1 - oy;
  const t = (ax * sy - ay * sx) / denom;
  if (t < 0) return -1;
  const u = (ax * dy - ay * dx) / denom;
  if (u < 0 || u > 1) return -1;
  return t;
}

/** Wrap an angle into [0, 2π). */
function norm(a: number): number {
  const r = a % TWO_PI;
  return r < 0 ? r + TWO_PI : r;
}
