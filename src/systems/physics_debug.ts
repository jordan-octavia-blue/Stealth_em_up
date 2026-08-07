/**
 * Physics / fog debug overlay (roadmap §10.4 — "debug overlays are part of each system's
 * deliverable, not an afterthought").
 *
 * Press **B** in game to cycle: off -> fixtures -> occluders -> visible polygon.
 *
 *   fixtures  every collision fixture in the world. Walls and furniture in grey, doors
 *             in amber (hollow when open, i.e. a sensor), actors in cyan, proximity
 *             sensors dotted. This is the view that tells you whether a breach actually
 *             destroyed a fixture or only repainted the tile.
 *   occluders the merged vision-blocking edges the fog sweeps against.
 *   polygon   the hero's current visibility polygon, drawn on top of the world instead
 *             of into the mask, so you can see what the fog thinks you can see.
 *
 * Like the other extracted systems this reads shared world state (`camera`,
 * `display_actors`) as window globals; the data comes from `physics` and `src/fog`,
 * neither of which knows about rendering.
 */

import { physics, CATEGORY } from '../physics';
import { computeVisibility } from '../fog/visibility';
import { currentOccluders, occluderRebuilds, FOG_RADIUS } from '../render/fog';

export const PHYSICS_DEBUG_MODES = ['off', 'fixtures', 'occluders', 'polygon'] as const;
export type PhysicsDebugMode = (typeof PHYSICS_DEBUG_MODES)[number];

let mode = 0;
let graphics: any = null;

// Same rationale as nav_debug: publishing the service here, in the debug module, is what
// lets the browser console and the headless harness poke at it without any shipping code
// depending on a global.
window.physics = physics;
window.fog = {
  occluders: currentOccluders,
  rebuilds: occluderRebuilds,
  radius: FOG_RADIUS,
  // one sweep from the hero, so the cost of the fog can be measured on its own
  sweep: () => computeVisibility({ x: hero.x, y: hero.y }, currentOccluders(), { radius: FOG_RADIUS }),
};

export function currentPhysicsDebugMode(): PhysicsDebugMode {
  return PHYSICS_DEBUG_MODES[mode];
}

export function cyclePhysicsDebug(): PhysicsDebugMode {
  mode = (mode + 1) % PHYSICS_DEBUG_MODES.length;
  if (graphics && mode === 0) graphics.clear();
  return currentPhysicsDebugMode();
}

/** Drop the overlay's Pixi objects — the display containers are rebuilt per run. */
export function resetPhysicsDebug(): void {
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

/** Called once per fixed step from gameloop(), after the physics step. */
export function drawPhysicsDebug(): void {
  if (mode === 0 || !physics.ready) return;
  const g = ensureGraphics();
  g.clear();

  if (currentPhysicsDebugMode() === 'fixtures') {
    physics.forEachFixture((shape) => {
      const isDoor = (shape.category & CATEGORY.DOOR) !== 0;
      const isActor = shape.kind === 'actor';
      const isCar = shape.kind === 'car';
      const color = isCar
        ? 0xff5252
        : shape.kind === 'trigger'
          ? 0x9c27b0
          : isDoor
            ? 0xffb300
            : isActor
              ? 0x00e5ff
              : 0x9e9e9e;
      g.lineStyle(shape.sensor ? 1 : 2, color, shape.sensor ? 0.5 : 0.9);
      if (shape.circle) {
        const p = camera.relativePoint({ x: shape.circle.x, y: shape.circle.y });
        g.drawCircle(p.x, p.y, shape.circle.r);
      } else if (shape.polygon) {
        const points: number[] = [];
        for (let i = 0; i < shape.polygon.length; i += 2) {
          const p = camera.relativePoint({ x: shape.polygon[i], y: shape.polygon[i + 1] });
          points.push(p.x, p.y);
        }
        if (points.length >= 4) {
          points.push(points[0], points[1]);
          g.drawPolygon(points);
        }
      }
    });
    return;
  }

  const segments = currentOccluders();

  if (currentPhysicsDebugMode() === 'occluders') {
    g.lineStyle(2, 0xff4081, 0.9);
    for (const s of segments) {
      const a = camera.relativePoint({ x: s.x1, y: s.y1 });
      const b = camera.relativePoint({ x: s.x2, y: s.y2 });
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
    }
    return;
  }

  // polygon
  const origin = spyglassPos ? { x: spyglassPos.x, y: spyglassPos.y } : { x: hero.x, y: hero.y };
  const polygon = computeVisibility(origin, segments, { radius: FOG_RADIUS });
  if (polygon.length < 6) return;
  const points: number[] = [];
  for (let i = 0; i < polygon.length; i += 2) {
    const p = camera.relativePoint({ x: polygon[i], y: polygon[i + 1] });
    points.push(p.x, p.y);
  }
  g.lineStyle(2, 0x76ff03, 0.9);
  g.drawPolygon(points);
}
