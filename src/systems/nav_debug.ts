/**
 * Navigation debug overlay (roadmap §10.4 — "debug overlays are part of each system's
 * deliverable, not an afterthought").
 *
 * Press **N** in game to cycle: off -> paths -> mesh -> regions -> danger -> flow field.
 *
 * Like the other extracted systems this one still reads shared world state (`camera`,
 * `guards`, the display containers) as window globals; the nav data it draws comes from
 * `nav`, which knows nothing about rendering.
 */

import { nav } from '../nav';
import { DIR_X, DIR_Y } from '../nav/navgrid';
import { peakDanger } from '../nav/danger';

export const NAV_DEBUG_MODES = ['off', 'paths', 'mesh', 'regions', 'danger', 'flow'] as const;
export type NavDebugMode = (typeof NAV_DEBUG_MODES)[number];

let mode = 0;
let graphics: any = null;

// The nav service is otherwise reachable only through imports. Publishing it here — in
// the debug module, not in the game code — is what lets the browser console and the
// headless perf harness read `nav.stats` (searches this step, queue depth, flow-field
// rebuilds) without any shipping code depending on a global.
window.nav = nav;

/** Distinct-ish colours per region label; index wraps. */
const REGION_COLORS = [
  0x4fc3f7, 0xffb74d, 0x81c784, 0xe57373, 0xba68c8, 0x4db6ac, 0xfff176, 0xa1887f,
];

export function currentNavDebugMode(): NavDebugMode {
  return NAV_DEBUG_MODES[mode];
}

/** Advance to the next overlay mode and return its name (for the on-screen message). */
export function cycleNavDebug(): NavDebugMode {
  mode = (mode + 1) % NAV_DEBUG_MODES.length;
  if (graphics && mode === 0) graphics.clear();
  return currentNavDebugMode();
}

/** Drop the overlay's Pixi objects — the display containers are rebuilt per run. */
export function resetNavDebug(): void {
  graphics = null;
  mode = 0;
}

function ensureGraphics(): any {
  if (!graphics || !graphics.parent) {
    graphics = new PIXI.Graphics();
    display_actors.addChild(graphics);
  }
  return graphics;
}

/** Called once per fixed step from gameloop(), after the guards have moved. */
export function drawNavDebug(): void {
  if (mode === 0 || !nav.ready) return;
  const g = ensureGraphics();
  g.clear();

  const grid = nav.navGrid;
  const cs = grid.cellSize;

  if (currentNavDebugMode() === 'mesh') {
    // What nav actually believes the map is: solid vs walkable. Drawn bold and opaque so it
    // reads over the fog-of-war shading — solid cells filled red, walkable cells a green
    // grid — which is what makes "a path crossing a wall" obvious at a glance (a green path
    // line over a red cell) and tells a wall apart from a walkable cell nav wrongly opened.
    for (let i = 0; i < grid.size; i++) {
      const p = camera.relativePoint({ x: grid.cellX(i) * cs, y: grid.cellY(i) * cs });
      if (grid.walkable[i] === 1) {
        g.lineStyle(1, 0x00ff88, 0.55);
        g.beginFill(0x00ff88, 0.06);
        g.drawRect(p.x, p.y, cs, cs);
        g.endFill();
      } else {
        g.lineStyle(2, 0xff3366, 0.95);
        g.beginFill(0xff1133, 0.4);
        g.drawRect(p.x + 1, p.y + 1, cs - 2, cs - 2);
        g.endFill();
      }
    }
    g.lineStyle(0, 0, 0);
    return;
  }

  if (currentNavDebugMode() === 'regions') {
    const regions = nav.regions;
    for (let i = 0; i < grid.size; i++) {
      const label = regions.labelAt(i);
      if (label === -1) continue;
      const p = camera.relativePoint({ x: grid.cellX(i) * cs, y: grid.cellY(i) * cs });
      // Opaque enough to read over the fog shading, with a matching outline so cell edges
      // stay crisp instead of blurring into one wash of colour.
      g.lineStyle(1, REGION_COLORS[label % REGION_COLORS.length], 0.9);
      g.beginFill(REGION_COLORS[label % REGION_COLORS.length], 0.5);
      g.drawRect(p.x, p.y, cs, cs);
      g.endFill();
    }
    g.lineStyle(0, 0, 0);
    return;
  }

  if (currentNavDebugMode() === 'danger') {
    const peak = peakDanger(grid);
    if (peak <= 0) return;
    for (let i = 0; i < grid.size; i++) {
      const danger = grid.dangerCost[i];
      if (danger <= 0) continue;
      const p = camera.relativePoint({ x: grid.cellX(i) * cs, y: grid.cellY(i) * cs });
      g.beginFill(0xff2200, 0.1 + 0.6 * (danger / peak));
      g.drawRect(p.x, p.y, cs, cs);
      g.endFill();
    }
    return;
  }

  if (currentNavDebugMode() === 'flow') {
    const field = nav.flowField;
    if (!field) return;
    g.lineStyle(2, 0x00e5ff, 0.8);
    const half = cs / 2;
    for (let i = 0; i < grid.size; i++) {
      const dir = field.dir[i];
      if (dir === -1) continue;
      const cx = grid.cellX(i) * cs + half;
      const cy = grid.cellY(i) * cs + half;
      const a = camera.relativePoint({ x: cx, y: cy });
      const b = camera.relativePoint({
        x: cx + DIR_X[dir] * half * 0.8,
        y: cy + DIR_Y[dir] * half * 0.8,
      });
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
    }
    // Mark the target the whole squad is converging on.
    if (field.target !== -1) {
      const t = camera.relativePoint(grid.pointAtIndex(field.target));
      g.lineStyle(2, 0xff00ff, 1);
      g.drawCircle(t.x, t.y, 10);
    }
    return;
  }

  // paths: every living guard's remaining waypoints, plus the leg it is walking now.
  //
  // The first leg (unit -> current target) is drawn thick amber and the rest bright green,
  // because that first leg is the only one anchored on the unit's live position and so the
  // only one that can cross a wall — calling it out makes the failure mode legible.
  const waypoints: Array<{ x: number; y: number }> = [];
  // Waypoint-to-waypoint legs first (green).
  for (let i = 0; i < guards.length; i++) {
    const guard = guards[i];
    if (!guard.alive || !guard.target || guard.target.x == null) continue;
    g.lineStyle(2, 0x00ff88, 0.9);
    const target = camera.relativePoint(guard.target);
    g.moveTo(target.x, target.y);
    waypoints.push(target);
    for (let p = 0; p < guard.path.length; p++) {
      const next = camera.relativePoint(guard.path[p]);
      g.lineTo(next.x, next.y);
      waypoints.push(next);
    }
  }
  // The unit -> target first leg on top, thick amber, so a wall crossing here stands out.
  for (let i = 0; i < guards.length; i++) {
    const guard = guards[i];
    if (!guard.alive || !guard.target || guard.target.x == null) continue;
    g.lineStyle(4, 0xffb300, 0.95);
    const from = camera.relativePoint({ x: guard.x, y: guard.y });
    const target = camera.relativePoint(guard.target);
    g.moveTo(from.x, from.y);
    g.lineTo(target.x, target.y);
  }
  // Waypoint dots come last: in Pixi v3 drawCircle ends the current path, so a lineTo
  // after one throws.
  g.lineStyle(0, 0, 0);
  g.beginFill(0x00ff88, 0.9);
  for (const point of waypoints) g.drawCircle(point.x, point.y, 3);
  g.endFill();
}
