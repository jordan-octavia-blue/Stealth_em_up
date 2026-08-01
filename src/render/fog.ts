/**
 * Fog of war (roadmap §8.1, Phase 4b).
 *
 * The rendering half of the visibility system: it owns the occluder cache, the mask
 * texture, and the once-per-frame sweep. The geometry itself is in `src/fog/`, which is
 * pure and unit-tested.
 *
 * What this replaces: `enableLOS` has been `false` since long before the roadmap, and
 * the starburst behind it could not have been turned on usefully — its occluder corners
 * were collected once in `setupLOS()` at map load, so a door opening or a wall coming
 * down changed nothing, and it re-sorted and spliced its whole corner list every frame.
 * Here the occluders are derived from the live grid and thrown away whenever geometry
 * changes; a rebuild on a 40x40 map is cheap enough that there is no partial-update
 * cleverness to get wrong.
 *
 * One source of truth: the same `blocks_vision` flags drive these occluders *and* the
 * `VISION_BLOCKER` fixtures that guard sight and gunfire raycast against — so a hole in
 * a wall is transparent in both directions, for the player and for the AI.
 *
 * Like the other extracted systems this file still reads shared world state as window
 * globals (`grid`, `hero`, `security_cameras`, the display containers).
 */

import { events } from '../core/events';
import { buildOccluders, Segment } from '../fog/occluders';
import { computeVisibility } from '../fog/visibility';

/**
 * How far the hero can see, in pixels. The old fog was unbounded, which would mean
 * sweeping the whole building every frame; 900 px still covers more than the screen at
 * the default zoom, so in practice the limit is invisible.
 */
export const FOG_RADIUS = 900;
/** Security cameras keep the 120° cone the starburst gave them. */
export const CAMERA_CONE = (2 * Math.PI) / 3;

let occluders: Segment[] | null = null;
let occluderVersion = -1;

// The mask pipeline. `losShade` is a black rectangle over the whole map; `losSprite`
// masks it, and in Pixi v3 a sprite mask multiplies by the mask's red channel — so
// white in the mask texture means "shade this", black means "you can see".
let losTexture: any = null;
let losSprite: any = null;
let losShade: any = null;
let losShadeContainer: any = null;
let losPathGraphics: any = null;
let losPathGraphicsContainer: any = null;

events.on('nav:dirty', invalidateOccluders);
events.on('vision:dirty', invalidateOccluders);

/** Drop the cached occluder segments; they are rebuilt on the next frame. */
export function invalidateOccluders(): void {
  occluders = null;
}

/** Build the mask pipeline for a freshly loaded map. Called from `setup_map`. */
export function setupFog(): void {
  invalidateOccluders();
  occluderVersion = -1;
  if (!enableLOS) return;

  losTexture = new PIXI.RenderTexture(renderer, grid_width, grid_height);
  losSprite = new PIXI.Sprite(losTexture);
  stage_child.addChild(losSprite);

  losShade = new PIXI.Graphics();
  losShade.clear();
  losShade.alpha = 0.75;
  losShade.beginFill(0);
  losShade.drawPolygon([0, 0, grid_width, 0, grid_width, grid_height, 0, grid_height, 0, 0]);

  losShadeContainer = new PIXI.Container();
  losShadeContainer.addChild(losShade);
  stage_child.addChild(losShadeContainer);
  losShadeContainer.mask = losSprite;

  losPathGraphics = new PIXI.Graphics();
  losPathGraphicsContainer = new PIXI.Container();
  losPathGraphicsContainer.addChild(losPathGraphics);
}

/** Forget everything that belonged to the run being torn down. */
export function resetFog(): void {
  occluders = null;
  occluderVersion = -1;
  losTexture = null;
  losSprite = null;
  losShade = null;
  losShadeContainer = null;
  losPathGraphics = null;
  losPathGraphicsContainer = null;
}

/** The live occluder set, rebuilt lazily after any geometry change. */
export function currentOccluders(): Segment[] {
  if (!occluders) {
    occluders = buildOccluders(grid);
    occluderVersion++;
  }
  return occluders;
}

/** How many times the cache has been rebuilt — a cheap regression tripwire. */
export function occluderRebuilds(): number {
  return occluderVersion;
}

/**
 * Redraw the visibility mask. Called once per *rendered* frame (not per fixed step):
 * it is presentation, and at 30 FPS there is nothing to gain from sweeping twice for
 * one picture.
 */
export function updateFog(): void {
  if (!enableLOS || !losPathGraphics) return;

  const segments = currentOccluders();
  const g = losPathGraphics;
  g.clear();
  g.beginFill(0xffffff);
  g.drawPolygon([0, 0, grid_width, 0, grid_width, grid_height, 0, grid_height, 0, 0]);

  // The hero's own view, sourced from the spyglass position when one is deployed —
  // that is the whole point of the spyglass, and it used to be implemented by
  // temporarily overwriting `hero.x`/`hero.y` and putting them back afterwards.
  const view = viewpoint();
  const heroPolygon = computeVisibility(view, segments, { radius: FOG_RADIUS });
  if (heroPolygon.length >= 6) {
    g.beginFill(0);
    g.drawPolygon(heroPolygon);
  }

  // A bugged camera is a second pair of eyes for the player.
  for (let i = 0; i < security_cameras.length; i++) {
    const cam = security_cameras[i];
    if (!cam.hacked || !cam.alive) continue;
    const origin = safeOrigin(cam.x, cam.y, cam.losx, cam.losy);
    const polygon = computeVisibility(origin, segments, {
      radius: FOG_RADIUS,
      facing: cam.rad,
      coneAngle: CAMERA_CONE,
    });
    if (polygon.length >= 6) {
      g.beginFill(0);
      g.drawPolygon(polygon);
    }
  }

  losTexture.render(losPathGraphicsContainer, null, true);
}

/** Where the player is looking from this frame. */
function viewpoint(): { x: number; y: number } {
  if (spyglassPos) return safeOrigin(spyglassPos.x, spyglassPos.y, hero.x, hero.y);
  return { x: hero.x, y: hero.y };
}

/**
 * A sweep started inside a wall sees nothing at all, so fall back to a known-open point.
 * Cameras are mounted *on* walls, and the spyglass can be pushed into one.
 */
function safeOrigin(
  x: number,
  y: number,
  fallbackX: number,
  fallbackY: number,
): { x: number; y: number } {
  if (grid.isWallSightBlocking_coords(x, y)) return { x: fallbackX, y: fallbackY };
  return { x, y };
}
