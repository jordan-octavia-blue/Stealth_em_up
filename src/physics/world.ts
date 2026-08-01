/**
 * `PhysicsWorld` — the planck.js (Box2D) wrapper (roadmap §3.2).
 *
 * Knows nothing about Pixi, the event bus, or the legacy globals: it is handed a
 * grid-shaped object, hands back bodies, and answers raycasts. `src/physics/index.ts`
 * is what wires it to the rest of the game.
 *
 * What lives here, and why it matters:
 *
 *  - **One static body for the map, one 2 m box fixture per solid cell.** ~470 fixtures
 *    on `bank_1`. Deliberately *not* greedy-merged into rectangles: per-cell fixtures
 *    make Phase 5's destruction a single `destroyFixture` call, and Box2D's broadphase
 *    is the spatial partition this codebase never had. The hero's old collision check
 *    against all 1600 cells, every frame, is what this replaces.
 *  - **Doors are fixtures on that same body**, toggled between solid and sensor. Each
 *    also carries a sensor "someone is near" fixture, so the doors x guards proximity
 *    loop becomes contact bookkeeping.
 *  - **Actors are dynamic circles with `fixedRotation`** — facing stays a game-logic
 *    angle. Movement is a velocity set each fixed step, so wall sliding, guard
 *    separation and character-vs-character push all fall out of the solver.
 *  - **Raycasts filter on the shared category bits**, so vision, bullets and fog ask the
 *    same world the same way.
 */

import { Body, Box, Circle, Fixture, Vec2, World } from 'planck';
import {
  ACTOR_MASK,
  CATEGORY,
  POSITION_ITERATIONS,
  PPM,
  STATIC_MASK,
  TRIGGER_MASK,
  VELOCITY_ITERATIONS,
} from './constants';

/** The shape of the legacy `jo_grid` this module reads. Structural on purpose. */
export interface PhysicsGridLike {
  width: number;
  height: number;
  cell_size: number;
  cells: Array<{ solid: boolean; door: boolean; blocks_vision: boolean }>;
}

/**
 * Anything with a world position that can own a body. The legacy sprites satisfy this
 * structurally, so nothing here needs to know what a `jo_sprite` is.
 */
export interface ActorOwner {
  x: number;
  y: number;
}

export interface ActorOptions {
  /** Body radius in pixels. */
  radius: number;
  category: number;
  mask?: number;
  /** Continuous collision detection — for Phase 7's fast car. */
  bullet?: boolean;
}

export interface RayHit {
  /** Hit point, in pixels. */
  x: number;
  y: number;
  /** 0..1 along the segment. */
  fraction: number;
  category: number;
  /** The actor that was hit, when the fixture belongs to one. */
  owner: ActorOwner | null;
  /** The grid cell index for wall/door hits, otherwise -1. */
  cell: number;
}

type FixtureKind = 'cell' | 'door' | 'trigger' | 'actor';

interface FixtureData {
  kind: FixtureKind;
  cell: number;
  owner: ActorOwner | null;
}

/** A fixture reduced to pixel-space geometry, for the debug overlay. */
export interface DebugShape {
  kind: FixtureKind;
  sensor: boolean;
  category: number;
  circle?: { x: number; y: number; r: number };
  /** Flat `[x, y, x, y, ...]` in world pixels. */
  polygon?: number[];
}

interface ActorRecord {
  body: Body;
  fixture: Fixture;
  radius: number;
}

/** How far from a door's centre an opener has to be for the door to notice, in pixels.
 *  The old loop used `unit.radius * 4`, which is 76 px for a guard and 56 for the hero;
 *  the sensor is sized for the larger and exact per-opener distance is re-checked
 *  against the handful of bodies actually touching it. */
export const DOOR_SENSOR_RADIUS_PX = 76;

export class PhysicsWorld {
  readonly world: World;

  private mapBody: Body | null = null;
  private cellFixtures = new Map<number, Fixture>();
  private doorFixtures = new Map<number, Fixture>();
  private triggerOverlaps = new Map<number, Set<ActorOwner>>();
  private actors = new Map<ActorOwner, ActorRecord>();
  /** Box2D forbids destroying fixtures mid-step; these are flushed before the next one. */
  private pendingDestroy: Fixture[] = [];

  private gridWidth = 0;
  private cellSize = 64;

  constructor() {
    this.world = new World({ gravity: Vec2(0, 0) });
    this.world.on('begin-contact', (contact) => this.onContact(contact, true));
    this.world.on('end-contact', (contact) => this.onContact(contact, false));
  }

  get ready(): boolean {
    return this.mapBody !== null;
  }

  /** Fixture count, for tests and the debug overlay. */
  get fixtureCount(): number {
    return this.cellFixtures.size + this.doorFixtures.size;
  }

  // --- setup ----------------------------------------------------------------

  /** Build the static map geometry. Call once per map load, after `jo_grid`. */
  build(grid: PhysicsGridLike): void {
    this.reset();
    this.gridWidth = grid.width;
    this.cellSize = grid.cell_size;
    const body = this.world.createBody({ type: 'static', position: Vec2(0, 0) });
    this.mapBody = body;

    for (let i = 0; i < grid.cells.length; i++) {
      const cell = grid.cells[i];
      if (!cell) continue;
      if (cell.door) {
        this.createDoor(i, cell.solid, cell.blocks_vision);
      } else if (cell.solid) {
        this.createCell(i, cell.blocks_vision);
      }
    }
  }

  reset(): void {
    if (this.mapBody) this.world.destroyBody(this.mapBody);
    for (const record of this.actors.values()) this.world.destroyBody(record.body);
    this.mapBody = null;
    this.cellFixtures.clear();
    this.doorFixtures.clear();
    this.triggerOverlaps.clear();
    this.actors.clear();
    this.pendingDestroy.length = 0;
  }

  // --- per-step -------------------------------------------------------------

  /** Advance the simulation by one fixed step (seconds). */
  step(dtSeconds: number): void {
    this.flushDestroys();
    this.world.step(dtSeconds, VELOCITY_ITERATIONS, POSITION_ITERATIONS);
  }

  /** Copy every body's position back onto the object that owns it. */
  syncActors(): void {
    for (const [owner, record] of this.actors) {
      const p = record.body.getPosition();
      owner.x = p.x * PPM;
      owner.y = p.y * PPM;
    }
  }

  // --- actors ---------------------------------------------------------------

  addActor(owner: ActorOwner, options: ActorOptions): void {
    if (this.actors.has(owner)) return;
    const body = this.world.createDynamicBody({
      position: Vec2(owner.x / PPM, owner.y / PPM),
      fixedRotation: true,
      // The characters are velocity-driven, so damping is cosmetic — but a body that
      // falls asleep stops reporting sensor contacts, and doors read those.
      allowSleep: false,
      linearDamping: 0,
      bullet: options.bullet ?? false,
    });
    const fixture = body.createFixture(Circle(options.radius / PPM), {
      density: 1,
      friction: 0,
      restitution: 0,
      filterCategoryBits: options.category,
      filterMaskBits: options.mask ?? ACTOR_MASK,
    });
    fixture.setUserData({ kind: 'actor', cell: -1, owner } satisfies FixtureData);
    this.actors.set(owner, { body, fixture, radius: options.radius });
  }

  removeActor(owner: ActorOwner): void {
    const record = this.actors.get(owner);
    if (!record) return;
    this.world.destroyBody(record.body);
    this.actors.delete(owner);
    // destroyBody fires end-contact for live contacts, but a body removed in the same
    // step it was added may never have had one — so purge defensively.
    for (const set of this.triggerOverlaps.values()) set.delete(owner);
  }

  hasActor(owner: ActorOwner): boolean {
    return this.actors.has(owner);
  }

  /** Set an actor's velocity in **pixels per second**. */
  setVelocity(owner: ActorOwner, vxPx: number, vyPx: number): void {
    const record = this.actors.get(owner);
    if (!record) return;
    record.body.setLinearVelocity(Vec2(vxPx / PPM, vyPx / PPM));
  }

  /** Velocity in pixels per second. */
  getVelocity(owner: ActorOwner): { x: number; y: number } {
    const record = this.actors.get(owner);
    if (!record) return { x: 0, y: 0 };
    const v = record.body.getLinearVelocity();
    return { x: v.x * PPM, y: v.y * PPM };
  }

  /** Move an actor without simulating the trip (spawns, respawns). */
  teleport(owner: ActorOwner, x: number, y: number): void {
    const record = this.actors.get(owner);
    if (!record) return;
    record.body.setTransform(Vec2(x / PPM, y / PPM), 0);
    record.body.setLinearVelocity(Vec2(0, 0));
    owner.x = x;
    owner.y = y;
  }

  // --- map geometry ---------------------------------------------------------

  /** Add (or replace) a solid fixture for a cell. Used by the van sealing its own tile. */
  setCellSolid(cell: number, opaque: boolean): void {
    if (!this.mapBody) return;
    if (this.doorFixtures.has(cell)) return;
    const existing = this.cellFixtures.get(cell);
    if (existing) this.mapBody.destroyFixture(existing);
    this.createCell(cell, opaque);
  }

  /**
   * Remove a cell's collision *and* its opacity — the destruction half of Phase 5's
   * pipeline, already used by the bomb. Deferred: Box2D forbids destroying a fixture
   * from inside a step or a contact callback.
   */
  clearCell(cell: number): void {
    const fixture = this.cellFixtures.get(cell) ?? this.doorFixtures.get(cell);
    if (!fixture) return;
    this.cellFixtures.delete(cell);
    this.doorFixtures.delete(cell);
    this.triggerOverlaps.delete(cell);
    this.pendingDestroy.push(fixture);
  }

  hasCellFixture(cell: number): boolean {
    return this.cellFixtures.has(cell) || this.doorFixtures.has(cell);
  }

  /**
   * Open or close a door cell. Open = sensor (walk through) and no `VISION_BLOCKER`
   * bit (see through, shoot through). One call replaces the grid-flag flipping that
   * vision and pathfinding each had to notice separately.
   */
  setDoorOpen(cell: number, open: boolean): void {
    const fixture = this.doorFixtures.get(cell);
    if (!fixture) return;
    fixture.setSensor(open);
    fixture.setFilterData({
      categoryBits: open ? CATEGORY.DOOR : CATEGORY.DOOR | CATEGORY.VISION_BLOCKER,
      maskBits: STATIC_MASK,
      groupIndex: 0,
    });
  }

  /** Everyone currently inside a door's proximity sensor. */
  openersNear(cell: number): ReadonlySet<ActorOwner> {
    return this.triggerOverlaps.get(cell) ?? EMPTY_SET;
  }

  // --- queries --------------------------------------------------------------

  /**
   * Nearest hit along a segment, filtered by category bits. Sensor fixtures are always
   * skipped — the only sensors are proximity triggers and (Phase 8) smoke, which gets
   * its own `VISION_BLOCKER` handling.
   */
  rayCast(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    mask: number,
    ignore: ActorOwner | null = null,
    reject = 0,
  ): RayHit | null {
    if (!this.mapBody) return null;
    // planck's ray cast is undefined for a zero-length segment.
    if (x0 === x1 && y0 === y1) return null;
    let best: RayHit | null = null;
    this.world.rayCast(
      Vec2(x0 / PPM, y0 / PPM),
      Vec2(x1 / PPM, y1 / PPM),
      (fixture, point, _normal, fraction) => {
        if (fixture.isSensor()) return -1;
        const category = fixture.getFilterCategoryBits();
        if ((category & mask) === 0) return -1;
        if (reject !== 0 && (category & reject) !== 0) return -1;
        const data = fixture.getUserData() as FixtureData | null;
        if (ignore && data && data.owner === ignore) return -1;
        if (best && fraction >= best.fraction) return best.fraction;
        best = {
          x: point.x * PPM,
          y: point.y * PPM,
          fraction,
          category,
          owner: data ? data.owner : null,
          cell: data ? data.cell : -1,
        };
        return fraction;
      },
    );
    return best;
  }

  /** The first blocking point along a segment, or the segment's end if nothing blocks. */
  castPoint(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    mask: number,
  ): { x: number; y: number } {
    const hit = this.rayCast(x0, y0, x1, y1, mask);
    return hit ? { x: hit.x, y: hit.y } : { x: x1, y: y1 };
  }

  /** True when nothing matching `mask` sits between the two points. */
  isClear(x0: number, y0: number, x1: number, y1: number, mask: number): boolean {
    return this.rayCast(x0, y0, x1, y1, mask) === null;
  }

  // --- debug ----------------------------------------------------------------

  /**
   * Walk every fixture in the world as plain pixel-space geometry. The debug overlay
   * draws this; keeping the traversal here is what stops planck types leaking into the
   * render layer.
   */
  forEachFixture(visit: (shape: DebugShape) => void): void {
    for (let body = this.world.getBodyList(); body; body = body.getNext()) {
      const t = body.getPosition();
      for (let fixture = body.getFixtureList(); fixture; fixture = fixture.getNext()) {
        const data = fixture.getUserData() as FixtureData | null;
        const base = {
          kind: data ? data.kind : ('cell' as FixtureKind),
          sensor: fixture.isSensor(),
          category: fixture.getFilterCategoryBits(),
        };
        const shape = fixture.getShape();
        if (shape.getType() === 'circle') {
          const circle = shape as unknown as { m_p: Vec2; getRadius(): number };
          visit({
            ...base,
            circle: {
              x: (t.x + circle.m_p.x) * PPM,
              y: (t.y + circle.m_p.y) * PPM,
              r: circle.getRadius() * PPM,
            },
          });
        } else if (shape.getType() === 'polygon') {
          const polygon = shape as unknown as { m_vertices: Vec2[] };
          const points: number[] = [];
          for (const v of polygon.m_vertices) points.push((t.x + v.x) * PPM, (t.y + v.y) * PPM);
          visit({ ...base, polygon: points });
        }
      }
    }
  }

  // --- internals ------------------------------------------------------------

  private cellCenter(cell: number): Vec2 {
    const half = this.cellSize / 2;
    const x = (cell % this.gridWidth) * this.cellSize + half;
    const y = Math.floor(cell / this.gridWidth) * this.cellSize + half;
    return Vec2(x / PPM, y / PPM);
  }

  private createCell(cell: number, opaque: boolean): void {
    const body = this.mapBody;
    if (!body) return;
    const half = this.cellSize / 2 / PPM;
    const fixture = body.createFixture(Box(half, half, this.cellCenter(cell)), {
      filterCategoryBits: opaque ? CATEGORY.WALL | CATEGORY.VISION_BLOCKER : CATEGORY.WALL,
      filterMaskBits: STATIC_MASK,
    });
    fixture.setUserData({ kind: 'cell', cell, owner: null } satisfies FixtureData);
    this.cellFixtures.set(cell, fixture);
  }

  private createDoor(cell: number, solid: boolean, opaque: boolean): void {
    const body = this.mapBody;
    if (!body) return;
    const half = this.cellSize / 2 / PPM;
    const center = this.cellCenter(cell);
    const fixture = body.createFixture(Box(half, half, center), {
      isSensor: !solid,
      filterCategoryBits: opaque ? CATEGORY.DOOR | CATEGORY.VISION_BLOCKER : CATEGORY.DOOR,
      filterMaskBits: STATIC_MASK,
    });
    fixture.setUserData({ kind: 'door', cell, owner: null } satisfies FixtureData);
    this.doorFixtures.set(cell, fixture);

    const trigger = body.createFixture(Circle(center, DOOR_SENSOR_RADIUS_PX / PPM), {
      isSensor: true,
      filterCategoryBits: CATEGORY.TRIGGER,
      filterMaskBits: TRIGGER_MASK,
    });
    trigger.setUserData({ kind: 'trigger', cell, owner: null } satisfies FixtureData);
    this.triggerOverlaps.set(cell, new Set());
  }

  private flushDestroys(): void {
    if (this.pendingDestroy.length === 0) return;
    const body = this.mapBody;
    for (const fixture of this.pendingDestroy) {
      if (body) body.destroyFixture(fixture);
    }
    this.pendingDestroy.length = 0;
  }

  private onContact(contact: { getFixtureA(): Fixture; getFixtureB(): Fixture }, begin: boolean): void {
    const a = contact.getFixtureA().getUserData() as FixtureData | null;
    const b = contact.getFixtureB().getUserData() as FixtureData | null;
    if (!a || !b) return;
    const trigger = a.kind === 'trigger' ? a : b.kind === 'trigger' ? b : null;
    if (!trigger) return;
    const other = trigger === a ? b : a;
    if (other.kind !== 'actor' || !other.owner) return;
    const set = this.triggerOverlaps.get(trigger.cell);
    if (!set) return;
    if (begin) set.add(other.owner);
    else set.delete(other.owner);
  }
}

const EMPTY_SET: ReadonlySet<ActorOwner> = new Set();
