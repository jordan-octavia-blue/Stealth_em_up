/**
 * `physics` — the physics facade (roadmap §3).
 *
 * The counterpart of `nav`: one object the rest of the game talks to, so no gameplay
 * code ever touches planck directly. It owns the world's lifetime, translates the
 * legacy grid into static geometry, and exposes the three things gameplay actually
 * wants — move an actor, ask what a ray hits, tell a door it opened.
 *
 * Wiring, in one place:
 *   - `build()` creates the map body from a freshly built `jo_grid`.
 *   - `nav:dirty` (event bus) — a cell's solidity changed (the bomb opening a wall, the
 *     van sealing its own tile). The name is nav-flavoured for historical reasons; it is
 *     the geometry-change signal, and Phase 5's `damageCell` pipeline (§6.2) is what
 *     eventually renames it to `cell:destroyed`.
 *   - `step(dtMs)` / `syncActors()` run once per fixed step from the gameloop.
 */

import { events } from '../core/events';
import { BULLET_MASK, CATEGORY, TICKS_PER_SECOND, VISION_MASK } from './constants';
import { ActorOwner, DebugShape, PhysicsGridLike, PhysicsWorld, RayHit } from './world';

export { CATEGORY, PPM, BULLET_MASK, VISION_MASK, TICKS_PER_SECOND } from './constants';
export type { ActorOwner, DebugShape, RayHit } from './world';

/** One cell in a `nav:dirty` payload — mirrors `src/nav`'s reading of the same event. */
type DirtyCell = number | { index: number; walkable?: boolean };
type DirtyEvent = DirtyCell | DirtyCell[];

export interface Point {
  x: number;
  y: number;
}

class Physics {
  private impl = new PhysicsWorld();
  private built = false;

  constructor() {
    events.on('nav:dirty', (payload) => this.onGeometryChanged(payload as DirtyEvent));
  }

  get ready(): boolean {
    return this.built;
  }

  // --- lifetime -------------------------------------------------------------

  build(grid: PhysicsGridLike): void {
    this.impl.build(grid);
    this.built = true;
  }

  reset(): void {
    this.impl.reset();
    this.built = false;
  }

  // --- per-step -------------------------------------------------------------

  /** Advance the world by one fixed step. `dtMs` is the gameloop's `STEP_MS`. */
  step(dtMs: number): void {
    if (!this.built) return;
    this.impl.step(dtMs / 1000);
  }

  /** Write every body's position back onto the sprite that owns it. */
  syncActors(): void {
    if (!this.built) return;
    this.impl.syncActors();
  }

  // --- actors ---------------------------------------------------------------

  addHero(owner: ActorOwner, radius: number): void {
    this.impl.addActor(owner, { radius, category: CATEGORY.HERO });
  }

  addGuard(owner: ActorOwner, radius: number): void {
    this.impl.addActor(owner, { radius, category: CATEGORY.GUARD });
  }

  /** Dead and choked-out guards stop being obstacles — they become draggable props. */
  removeActor(owner: ActorOwner): void {
    this.impl.removeActor(owner);
  }

  hasActor(owner: ActorOwner): boolean {
    return this.impl.hasActor(owner);
  }

  /**
   * Steer an actor at `speedPxPerTick` toward a point, or stop it dead when it is
   * already within `stopDistance`. Returns true when the target is reached.
   *
   * Speeds are per *tick* everywhere in the legacy code (Phase 2 made the tick rate
   * fixed), so the conversion to Box2D's per-second velocities happens here and only
   * here.
   */
  steerTowards(
    owner: ActorOwner,
    targetX: number,
    targetY: number,
    speedPxPerTick: number,
    stopDistance: number,
  ): boolean {
    const dx = targetX - owner.x;
    const dy = targetY - owner.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance < stopDistance || distance === 0) {
      this.impl.setVelocity(owner, 0, 0);
      return true;
    }
    const speed = speedPxPerTick * TICKS_PER_SECOND;
    this.impl.setVelocity(owner, (dx / distance) * speed, (dy / distance) * speed);
    return false;
  }

  stop(owner: ActorOwner): void {
    this.impl.setVelocity(owner, 0, 0);
  }

  teleport(owner: ActorOwner, x: number, y: number): void {
    this.impl.teleport(owner, x, y);
  }

  // --- map geometry ---------------------------------------------------------

  setDoorOpen(cell: number, open: boolean): void {
    this.impl.setDoorOpen(cell, open);
  }

  /** Everyone standing in a door's proximity sensor — replaces the doors x guards loop. */
  openersNear(cell: number): ReadonlySet<ActorOwner> {
    return this.impl.openersNear(cell);
  }

  // --- queries --------------------------------------------------------------

  /**
   * Nearest bullet hit, ignoring the shooter. `null` when the shot reaches `x1,y1`.
   *
   * `mask` narrows what counts: the hero's bullets look for guards, a guard's look for
   * the hero. Guards have never shot each other and this is not the phase to start.
   */
  bulletHit(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    shooter: ActorOwner | null,
    mask: number = BULLET_MASK,
  ): RayHit | null {
    return this.impl.rayCast(x0, y0, x1, y1, mask, shooter);
  }

  /**
   * Where the view along this segment ends: a wall/closed door, or the far point.
   *
   * Also where a *shot* along it ends up: aiming and bullet flight target the geometry,
   * not the people in the way — who is actually hit is resolved per step by `bulletHit`.
   * Pointing a bullet's target at the nearest body instead would stop it a hair short of
   * its own victim.
   */
  sightStop(x0: number, y0: number, x1: number, y1: number): Point {
    return this.impl.castPoint(x0, y0, x1, y1, VISION_MASK);
  }

  /** True when nothing vision-blocking sits between the two points. */
  canSee(x0: number, y0: number, x1: number, y1: number): boolean {
    return this.impl.isClear(x0, y0, x1, y1, VISION_MASK);
  }

  /** As `canSee`, but doors do not count — the spyglass peers under them. */
  canSeeIgnoringDoors(x0: number, y0: number, x1: number, y1: number): boolean {
    return this.impl.rayCast(x0, y0, x1, y1, VISION_MASK, null, CATEGORY.DOOR) === null;
  }

  /** Every fixture as pixel-space geometry, for the debug overlay. */
  forEachFixture(visit: (shape: DebugShape) => void): void {
    if (!this.built) return;
    this.impl.forEachFixture(visit);
  }

  /** Fixture count — a cheap way to assert destruction actually happened. */
  get fixtureCount(): number {
    return this.impl.fixtureCount;
  }

  // --- internals ------------------------------------------------------------

  private onGeometryChanged(payload: DirtyEvent): void {
    if (!this.built) return;
    const list: DirtyCell[] = Array.isArray(payload) ? payload : [payload];
    for (const item of list) {
      const index = typeof item === 'number' ? item : item.index;
      const walkable = typeof item === 'number' ? true : (item.walkable ?? true);
      if (walkable) this.impl.clearCell(index);
      // A cell that became solid also became opaque: the only callers are objects that
      // seal the ground under themselves (the van, the security computer).
      else this.impl.setCellSolid(index, true);
    }
  }
}

/** The game's physics service. */
export const physics = new Physics();
