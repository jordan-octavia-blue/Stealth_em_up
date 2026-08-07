/**
 * `nav` — the navigation facade (roadmap §4).
 *
 * **Nothing outside `src/nav/` ever calls a search directly.** Callers ask this object
 * for a path and get a handle back; the scheduler decides when the search actually
 * runs. That single rule is what replaced the vendored `astar.js` and the per-frame
 * A* storm it powered.
 *
 * Wiring, in one place:
 *   - `build()` derives the typed-array layers from the legacy `jo_grid`.
 *   - `nav:dirty`  (event bus) — a cell's solidity changed (the bomb, later Phase 5's
 *     `damageCell`); walkability is re-derived, regions relabelled, flow fields dropped.
 *   - `nav:danger` (event bus) — deposit danger at a world position.
 *   - `update(dtMs)` runs once per fixed step from the gameloop.
 */

import { events } from '../core/events';
import { findPath } from './astar';
import { decayDanger, depositDanger } from './danger';
import { computeFlowField, FlowField, pathFromField } from './flowfield';
import { NavGrid, Point } from './navgrid';
import { labelRegions, RegionMap } from './regions';
import { PathHandle, PathPriority, PathRequest, PathScheduler } from './scheduler';
import { isCorridorWalkable, smoothPath } from './smooth';

export { NavGrid } from './navgrid';
export type { Point } from './navgrid';
export { PathPriority } from './scheduler';
export type { PathHandle } from './scheduler';

/** The shape of the legacy `jo_grid` this module reads. Structural on purpose: nav
 *  knows nothing about Pixi sprites, and the legacy object keeps its own concerns. */
export interface LegacyGridLike {
  width: number;
  height: number;
  cell_size: number;
  cells: Array<{ solid: boolean; door: boolean; restricted: boolean }>;
}

/** Extra cost for stepping through a doorway — a static chokepoint penalty. Phase 6
 *  adds temporary per-squad spikes on top of this to spread guards across entries. */
export const DOOR_COST = 1.5;
/** Restricted (staff-only) floor: guards may cross it, they just prefer not to. */
export const RESTRICTED_COST = 1.15;
/** A blown-open wall is walkable but strewn with rubble; clean floor wins ties. */
export const RUBBLE_COST = 1.4;
/** Danger halves every this many seconds. */
export const DANGER_HALF_LIFE_S = 8;

export interface DangerEvent {
  x: number;
  y: number;
  amount: number;
  radius?: number;
}

/** One cell in a `nav:dirty` payload. A bare index means "this opened up". */
export type NavDirtyCell = number | { index: number; walkable?: boolean };
/** Payload of `nav:dirty`: one changed cell, or a batch of them. */
export type NavDirtyEvent = NavDirtyCell | NavDirtyCell[];

export interface NavStats {
  searches: number;
  queued: number;
  coalesced: number;
  regions: number;
  flowFieldRebuilds: number;
}

class Nav {
  private grid: NavGrid | null = null;
  private regionMap: RegionMap | null = null;
  private field: FlowField | null = null;
  private fieldRebuilds = 0;

  readonly scheduler = new PathScheduler((request) => this.solve(request));

  constructor() {
    events.on('nav:dirty', (payload) => this.markDirty(payload as NavDirtyEvent));
    // A destroyed cell (roadmap §6.2, pipeline step 2) opens up exactly like a `nav:dirty`
    // walkable cell: re-derive walkability, drop the region labels and the flow field.
    events.on('cell:destroyed', (payload) => this.markDirty(payload as NavDirtyEvent));
    events.on('nav:danger', (payload) => this.deposit(payload as DangerEvent));
  }

  get ready(): boolean {
    return this.grid !== null;
  }

  /** The typed-array grid, for the debug overlay and tests. Throws before `build()`. */
  get navGrid(): NavGrid {
    if (!this.grid) throw new Error('nav.build() has not run yet');
    return this.grid;
  }

  get regions(): RegionMap {
    this.ensureRegions();
    return this.regionMap as RegionMap;
  }

  /** The live convergence field, or null when nothing is converging. */
  get flowField(): FlowField | null {
    return this.field;
  }

  get stats(): NavStats {
    return {
      searches: this.scheduler.stats.searches,
      queued: this.scheduler.queued,
      coalesced: this.scheduler.stats.coalesced,
      regions: this.grid ? this.regions.count : 0,
      flowFieldRebuilds: this.fieldRebuilds,
    };
  }

  // --- setup ----------------------------------------------------------------

  /** Derive the nav layers from a freshly built legacy grid. Call once per map load. */
  build(source: LegacyGridLike): NavGrid {
    const grid = new NavGrid(source.width, source.height, source.cell_size);
    for (let i = 0; i < grid.size; i++) {
      const cell = source.cells[i];
      if (!cell) continue;
      // Doors are walkable: guards open them. This matches the graph the old
      // astar.js was handed, so patrol behaviour is unchanged.
      grid.walkable[i] = cell.solid && !cell.door ? 0 : 1;
      grid.baseCost[i] = cell.restricted ? RESTRICTED_COST : 1;
      grid.doorCost[i] = cell.door ? DOOR_COST : 0;
    }
    grid.version++;
    this.grid = grid;
    this.regionMap = labelRegions(grid);
    this.field = null;
    this.fieldRebuilds = 0;
    this.scheduler.clear();
    return grid;
  }

  /** Tear down between runs, so nothing survives into the next game. */
  reset(): void {
    this.grid = null;
    this.regionMap = null;
    this.field = null;
    this.scheduler.clear();
  }

  // --- per-step -------------------------------------------------------------

  update(dtMs: number): void {
    if (!this.grid) return;
    decayDanger(this.grid, dtMs / 1000, DANGER_HALF_LIFE_S);
    this.scheduler.update();
  }

  // --- requests -------------------------------------------------------------

  /**
   * Queue a path search. The handle starts `pending`; `onReady` fires on the fixed step
   * the search actually runs, so callers keep their old path in the meantime.
   */
  requestPath(request: PathRequest): PathHandle {
    return this.scheduler.request(request);
  }

  hasPendingRequest(owner: unknown): boolean {
    return this.scheduler.hasPending(owner);
  }

  cancelRequest(owner: unknown): void {
    this.scheduler.cancel(owner);
  }

  /** O(1) reachability: same region label means a path is guaranteed to exist. */
  canReach(from: Point, to: Point): boolean {
    if (!this.grid) return false;
    const a = this.grid.nearestWalkable(this.grid.indexAtPoint(from.x, from.y));
    const b = this.grid.nearestWalkable(this.grid.indexAtPoint(to.x, to.y));
    return this.regions.connected(a, b);
  }

  /**
   * A random destination **in the requester's own region** — reachable by construction.
   *
   * This is the fix for the original pathology: the old code sampled any non-solid cell
   * on the map, so a destination inside a sealed room returned no path and the guard
   * re-searched the next frame, forever.
   */
  randomDestinationNear(
    from: Point,
    random: () => number = Math.random,
    minCellsAway = 3,
  ): Point | null {
    if (!this.grid) return null;
    const grid = this.grid;
    const start = grid.nearestWalkable(grid.indexAtPoint(from.x, from.y));
    if (start === -1) return null;
    const startX = grid.cellX(start);
    const startY = grid.cellY(start);

    // A destination one tile away is a wasted search, but in a broom-cupboard-sized
    // region there may not be a farther one — so this is a preference, not a filter.
    let fallback = -1;
    for (let attempt = 0; attempt < 8; attempt++) {
      const cell = this.regions.randomCellInRegionOf(start, random);
      if (cell === -1) return null;
      if (cell === start) continue;
      fallback = cell;
      const dx = grid.cellX(cell) - startX;
      const dy = grid.cellY(cell) - startY;
      if (Math.abs(dx) >= minCellsAway || Math.abs(dy) >= minCellsAway) {
        return grid.pointAtIndex(cell);
      }
    }
    return fallback === -1 ? null : grid.pointAtIndex(fallback);
  }

  /**
   * Steer towards a shared target using the squad flow field — ONE Dijkstra for the
   * whole squad instead of one A* per guard. Cheap enough to run inline (it is table
   * lookups after the first caller pays for the field), so it returns waypoints
   * directly rather than a handle.
   */
  convergeTo(from: Point, to: Point, radius = 0): Point[] {
    if (!this.grid) return [];
    const grid = this.grid;
    const target = grid.nearestWalkable(grid.indexAtPoint(to.x, to.y));
    const start = grid.nearestWalkable(grid.indexAtPoint(from.x, from.y));
    if (target === -1 || start === -1) return [];

    if (!this.field || this.field.target !== target || this.field.version !== grid.version) {
      this.field = computeFlowField(grid, target, this.field ?? undefined);
      this.fieldRebuilds++;
    }
    const cells = pathFromField(grid, this.field, start);
    if (cells.length === 0) return [];
    return smoothPath(grid, cells, radius, from);
  }

  /**
   * True when a unit of `radius` can walk the straight line from `a` to `b` without its
   * body clipping a wall.
   *
   * A smoothed path only guarantees each leg is clear *from the spot it was planned at*.
   * By the time a unit actually walks its first leg it may be somewhere else — a search
   * resolves a few fixed steps after it was requested, a replaced route can leave a stale
   * target behind, or the physics solver shoves the body off the planned line. This is the
   * follow-time check the guard loop uses so a unit never chases a waypoint straight
   * through a wall; when it fails the caller drops the route and re-plans from where the
   * unit actually is (`smoothPath` clearance-checks the new first leg against that spot).
   *
   * Returns true before the grid is built so it never blocks movement during setup.
   */
  isDirectPathClear(a: Point, b: Point, radius = 0): boolean {
    if (!this.grid) return true;
    return isCorridorWalkable(this.grid, a, b, radius);
  }

  /**
   * Cost-weighted distance from a world point to the live flow field's target, or
   * Infinity. Phase 6 reads this for hearing occlusion (sound travels around walls)
   * and for AI utility scoring.
   */
  distanceToFieldTarget(from: Point): number {
    if (!this.grid || !this.field) return Infinity;
    const cell = this.grid.nearestWalkable(this.grid.indexAtPoint(from.x, from.y));
    return this.field.distanceAt(cell);
  }

  // --- dynamic updates ------------------------------------------------------

  /**
   * A cell's solidity changed. Re-derives walkability, drops the region labels and any
   * live flow field. This is the whole of pathology #2's fix: a blown-open wall is
   * pathable immediately instead of staying impassable for the rest of the run.
   */
  markDirty(payload: NavDirtyEvent): void {
    if (!this.grid) return;
    const grid = this.grid;
    const list: NavDirtyCell[] = Array.isArray(payload) ? payload : [payload];
    let changed = false;
    for (const item of list) {
      const index = typeof item === 'number' ? item : item.index;
      // Destruction is the only source today, so walkable defaults to true.
      const walkable = typeof item === 'number' ? true : (item.walkable ?? true);
      if (index < 0 || index >= grid.size) continue;
      if (!grid.setWalkable(index, walkable)) continue;
      changed = true;
      if (walkable) {
        grid.baseCost[index] = RUBBLE_COST;
        grid.doorCost[index] = 0;
      } else {
        grid.dangerCost[index] = 0;
      }
    }
    if (!changed) return;
    // Regions and flow fields are re-derived lazily off `grid.version`; a full relabel
    // of 1600 cells is microseconds, so there is no partial-update cleverness here.
    this.field = null;
  }

  private deposit(event: DangerEvent): void {
    if (!this.grid || !event) return;
    const index = this.grid.indexAtPoint(event.x, event.y);
    if (index === -1) return;
    depositDanger(this.grid, index, { amount: event.amount, radius: event.radius ?? 1 });
  }

  private ensureRegions(): RegionMap {
    if (!this.grid) throw new Error('nav.build() has not run yet');
    if (!this.regionMap || this.regionMap.version !== this.grid.version) {
      this.regionMap = labelRegions(this.grid, this.regionMap ?? undefined);
    }
    return this.regionMap;
  }

  private solve(request: PathRequest): Point[] | null {
    if (!this.grid) return null;
    const grid = this.grid;
    const start = grid.nearestWalkable(grid.indexAtPoint(request.from.x, request.from.y));
    const goal = grid.nearestWalkable(grid.indexAtPoint(request.to.x, request.to.y));
    if (start === -1 || goal === -1) return null;
    // Reachability first: an unreachable goal costs one integer compare instead of a
    // full exhaustive search of every cell the guard *can* get to.
    if (!this.regions.connected(start, goal)) return null;
    const { path } = findPath(grid, start, goal);
    if (path.length === 0) return null;
    return smoothPath(grid, path, request.radius ?? 0, request.from);
  }
}

/** The game's navigation service. */
export const nav = new Nav();

/** Priorities, re-exported for the legacy call sites that only import `nav`. */
export const NAV_PRIORITY = PathPriority;
