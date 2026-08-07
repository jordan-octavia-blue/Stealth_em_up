/**
 * SquadBlackboard (roadmap §5.3) — one shared coordinator for all guards, fixing the
 * "door funnel / kill box": today every alarmed guard paths to the hero's last-known
 * position by the cheapest route, which is the *same* route, so the whole squad files
 * through one doorway one at a time and dies in the same spot.
 *
 * The fix is entirely cost-shaping, not scripting:
 *
 *  - **Fused belief** — any guard's sighting writes one shared hero last-known position
 *    (`updateBelief`); every guard steers off it instead of its own private memory.
 *  - **Entry-point assignment** — the guards approaching the room the hero is in are spread
 *    across that room's entrances (doors *and* blown-open wall gaps) by `assignEntriesRoundRobin`,
 *    and each approaches its assigned entrance with its own A* search, so they arrive from
 *    different directions. Flanking falls out of the assignment; nothing scripts it.
 *  - **Kill-box danger** — when a guard dies (`reportDeath`), the living guards that could see
 *    it deposit heavy danger there (heavier with more witnesses, heavier still at a chokepoint).
 *    Every path search sums the danger layer, so later searches route *around* the spot; while
 *    guards keep dying there it stays hot, and it cools once they stop (8 s half-life).
 *
 * Layered on the existing flag-based guard AI — this module *drives* the guard's flags/path;
 * it introduces no state machine. It is deliberately free of Pixi and `window`: guards are seen
 * through the structural `GuardLike` view and geometry through `NavGrid`, so the pure helpers
 * below are unit-testable against ascii grids exactly like `src/nav`.
 *
 * Phase 6a (perception/health) was skipped by design, so two 6b sub-features are intentionally
 * absent here: FLEE (needs an hp fraction) and staggered entry / hold-and-peek (queuing guards
 * through a door one-at-a-time does not stop them re-entering the kill box — the spread + danger
 * routing above is what does).
 */

import { events } from '../core/events';
import { DOOR_COST, nav, PathPriority } from '../nav';
import { MAX_DANGER } from '../nav/danger';
import { ALL_DIRS, NavGrid, Point } from '../nav/navgrid';

// ---------------------------------------------------------------------------
// Pure helpers (no game state) — the unit-tested core.
// ---------------------------------------------------------------------------

/** Room labels, computed with entry cells treated as barriers. */
export interface RoomMap {
  /** Room label per cell; -1 for solid cells AND for entry cells (doors/breaches). */
  labels: Int32Array;
  /** NavGrid.version this labelling was computed against. */
  version: number;
}

/**
 * Flood-fill the walkable grid into rooms, refusing to step onto (or seed from) an entry
 * cell — so a door or a breach separates the two rooms it joins.
 *
 * This is why we can't reuse `nav.regions`: regions flood *through* doors (doors are
 * walkable), so two door-joined rooms share one label, which is useless for "which doors
 * are the way into the hero's room". Same iterative flood as `labelRegions`, one rule added.
 */
export function labelRooms(grid: NavGrid, entryCells: ReadonlySet<number>, into?: RoomMap): RoomMap {
  const map: RoomMap =
    into && into.labels.length === grid.size ? into : { labels: new Int32Array(grid.size), version: -1 };
  map.labels.fill(-1);

  const stack: number[] = [];
  let label = 0;
  for (let seed = 0; seed < grid.size; seed++) {
    if (grid.walkable[seed] !== 1 || entryCells.has(seed) || map.labels[seed] !== -1) continue;
    const current = label++;
    map.labels[seed] = current;
    stack.push(seed);
    while (stack.length > 0) {
      const cell = stack.pop() as number;
      for (let dir = 0; dir < ALL_DIRS; dir++) {
        const next = grid.neighbor(cell, dir);
        // Don't cross into an entry cell: that is the membrane between two rooms.
        if (next === -1 || entryCells.has(next) || map.labels[next] !== -1) continue;
        map.labels[next] = current;
        stack.push(next);
      }
    }
  }
  map.version = grid.version;
  return map;
}

/**
 * Room label of a world point. If the point is on a solid or entry cell it snaps to the
 * nearest walkable cell, then (if that is itself an entry cell) to an adjacent room. -1 when
 * there is no room nearby.
 */
export function roomOfPoint(grid: NavGrid, rooms: RoomMap, x: number, y: number): number {
  const index = grid.indexAtPoint(x, y);
  if (index === -1) return -1;
  if (rooms.labels[index] !== -1) return rooms.labels[index];
  const near = grid.nearestWalkable(index);
  if (near === -1) return -1;
  if (rooms.labels[near] !== -1) return rooms.labels[near];
  // `near` is an entry cell (walkable but label -1): read a bordering room.
  for (let dir = 0; dir < ALL_DIRS; dir++) {
    const n = grid.neighbor(near, dir);
    if (n !== -1 && rooms.labels[n] !== -1) return rooms.labels[n];
  }
  return -1;
}

/** One entrance on the target room's perimeter, plus a reachable cell on the guards' side. */
export interface EntryCandidate {
  /** The door/breach cell itself (walkable). */
  cell: number;
  /** A walkable room cell adjacent to `cell` on the OUTSIDE (not the target room). */
  approachCell: number;
  /** Current kill-box danger on the entry cell — the assignment weight steers away from it. */
  danger: number;
}

/**
 * Every entry cell that borders `targetRoom`, paired with an approach cell on the guards'
 * side. Entries reachable only from inside the target room (no outside approach) are dropped.
 */
export function candidateEntries(
  grid: NavGrid,
  rooms: RoomMap,
  targetRoom: number,
  entryCells: ReadonlySet<number>,
): EntryCandidate[] {
  const out: EntryCandidate[] = [];
  for (const cell of entryCells) {
    if (grid.walkable[cell] !== 1) continue;
    let bordersTarget = false;
    let approach = -1;
    for (let dir = 0; dir < ALL_DIRS; dir++) {
      const n = grid.neighbor(cell, dir);
      if (n === -1) continue;
      const label = rooms.labels[n];
      if (label === targetRoom) bordersTarget = true;
      else if (label !== -1 && !entryCells.has(n) && approach === -1) approach = n;
    }
    if (bordersTarget && approach !== -1) {
      out.push({ cell, approachCell: approach, danger: grid.dangerCost[cell] });
    }
  }
  // Stable order (Set iteration is insertion order, but sort by cell for deterministic tests).
  out.sort((a, b) => a.cell - b.cell);
  return out;
}

/** Octile (8-way) distance between two cells, in cell units. */
export function octileDistance(grid: NavGrid, a: number, b: number): number {
  const dx = Math.abs(grid.cellX(a) - grid.cellX(b));
  const dy = Math.abs(grid.cellY(a) - grid.cellY(b));
  return dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy);
}

export interface AssignOptions {
  /** Cost from a guard's cell to a candidate. Default: octile to the approach cell. */
  distanceFn: (guardCell: number, candidate: EntryCandidate) => number;
  /** How hard danger (real kill-box danger) repels an assignment. */
  dangerWeight: number;
  /** Virtual cost added to a candidate each time it is picked — this is what spreads guards. */
  spikePerClaim: number;
}

/**
 * Assign each guard to an entrance, greedily and deterministically.
 *
 * Guards are processed nearest-first; each takes the candidate minimising
 * `distanceFn + dangerWeight*(danger + accumulatedSpike)`, and picking a candidate bumps its
 * accumulated spike so the next guard prefers a different one. With `spikePerClaim` large the
 * squad fans out across entrances; with it 0 they all collapse onto the nearest — the spike is
 * the whole spreading mechanism. No grid mutation, so it is trivially unit-testable.
 *
 * @returns map from index-into-`guardCells` → chosen entry cell.
 */
export function assignEntriesRoundRobin(
  guardCells: number[],
  candidates: EntryCandidate[],
  opts: AssignOptions,
): Map<number, number> {
  const result = new Map<number, number>();
  if (candidates.length === 0 || guardCells.length === 0) return result;

  const virtualSpike = new Map<number, number>();
  for (const c of candidates) virtualSpike.set(c.cell, 0);

  const minDistOf = (guardCell: number): number => {
    let m = Infinity;
    for (const c of candidates) {
      const d = opts.distanceFn(guardCell, c);
      if (d < m) m = d;
    }
    return m;
  };
  // Nearest guards choose first (stable by original index on ties) for better, deterministic
  // assignments; a far guard being nudged to a second-choice door matters less.
  const order = guardCells.map((_, i) => i).sort((a, b) => minDistOf(guardCells[a]) - minDistOf(guardCells[b]) || a - b);

  for (const gi of order) {
    const guardCell = guardCells[gi];
    let best: EntryCandidate | null = null;
    let bestCost = Infinity;
    for (const c of candidates) {
      const cost = opts.distanceFn(guardCell, c) + opts.dangerWeight * (c.danger + (virtualSpike.get(c.cell) as number));
      if (cost < bestCost) {
        bestCost = cost;
        best = c;
      }
    }
    if (!best) continue;
    result.set(gi, best.cell);
    virtualSpike.set(best.cell, (virtualSpike.get(best.cell) as number) + opts.spikePerClaim);
  }
  return result;
}

/**
 * How much danger a death should deposit. `witnessDangerAmount(false, 0)` returns the old flat
 * `{amount: 6, radius: 2}`, so a lone unwitnessed death is unchanged; more witnesses and a
 * chokepoint make it heavier (clamped under `MAX_DANGER`). This is the "stop walking into the
 * meat grinder" weight.
 */
export function witnessDangerAmount(atEntry: boolean, witnessCount: number): { amount: number; radius: number } {
  const witnesses = Math.max(0, Math.min(witnessCount, 3));
  const amount = Math.min(6 + 2 * witnesses + (atEntry ? 3 : 0), MAX_DANGER);
  return { amount, radius: atEntry ? 3 : 2 };
}

// ---------------------------------------------------------------------------
// The squad singleton (impure: holds state, talks to guards + nav + the event bus).
// ---------------------------------------------------------------------------

/** The shared hero last-known position/time. */
export interface SquadBelief {
  x: number;
  y: number;
  /** Game-clock time (ms) of the last update. */
  t: number;
  valid: boolean;
}

/** Structural view of a guard — no Pixi, no legacy methods (cf. `LegacyGridLike` in nav). */
export interface GuardLike {
  x: number;
  y: number;
  alive: boolean;
  radius: number;
  alarmed: boolean;
  chasingHero: boolean;
  path: Point[];
  target: { x: number | null; y: number | null };
  moving: boolean;
  target_rotate: unknown;
  // 6b flags, declared on the guard in sprite_guard.ts:
  assignedEntry: number | null;
  patrolRouteIndex: number;
  patrolLeg: number;
}

/** A named patrol route from the map format (`src/map/loader.ts`). */
export interface PatrolRouteInput {
  name: string;
  points: Array<[number, number]>;
}

/** Line-of-sight test injected by the game (`physics.canSee`); defaults to "everyone sees". */
export type SightFn = (x0: number, y0: number, x1: number, y1: number) => boolean;

class SquadBlackboard {
  private grid: NavGrid | null = null;
  /** Doors ∪ destroyed-wall gaps — the barriers `labelRooms` splits on and the entry candidates. */
  private entryCells = new Set<number>();
  private roomMap: RoomMap | null = null;
  private roomsDirty = true;
  private guards: GuardLike[] = [];
  private beliefState: SquadBelief = { x: 0, y: 0, t: 0, valid: false };
  private routes: PatrolRouteInput[] = [];
  private routeCursor = 0;
  private lastReassignAt = -Infinity;
  /** Real doorCost we added, keyed by cell, so `reset`/reassign can subtract it back exactly. */
  private spikes = new Map<number, number>();
  private breachUnsub: (() => void) | null = null;
  /** Last belief time we ran `convergeTo` for a guard, so combat repaths only on new sightings. */
  private convergeAt = new WeakMap<GuardLike, number>();
  /** Last entry cell we issued an approach search for, so we repath only when the plan changes. */
  private approachGoal = new WeakMap<GuardLike, number>();

  /** Injected by the game so witness counting uses real occlusion; tests override it. */
  witnessSee: SightFn = () => true;

  // --- tunables -------------------------------------------------------------
  private readonly REASSIGN_INTERVAL_MS = 1000;
  private readonly DANGER_WEIGHT = 2;
  /** Big enough to overcome a typical distance gap so guards genuinely fan out. */
  private readonly SPIKE_PER_CLAIM = DOOR_COST * 2;
  /** Temporary real doorCost added at each assigned entry (spec's "spike for other guards"). */
  private readonly ENTRY_SPIKE = DOOR_COST;

  // --- lifecycle ------------------------------------------------------------

  /** Wire the squad to a freshly built nav grid and the map's doors. Call once per map load. */
  build(grid: NavGrid, doorCells: number[]): void {
    this.reset();
    this.grid = grid;
    for (const cell of doorCells) if (grid.walkable[cell] === 1) this.entryCells.add(cell);
    this.roomsDirty = true;
    // A blown-open wall is a new way into a room (roadmap §5.3): breach.ts already emits this.
    this.breachUnsub = events.on('cell:breached', (payload) => {
      const index = typeof payload === 'number' ? payload : (payload as { index?: number })?.index;
      if (typeof index !== 'number' || !this.grid || this.grid.walkable[index] !== 1) return;
      if (!this.entryCells.has(index)) {
        this.entryCells.add(index);
        this.roomsDirty = true;
        this.forceReassign();
      }
    });
  }

  /** Tear down between runs; restores any door-cost spikes so nothing leaks into the next map. */
  reset(): void {
    this.restoreSpikes();
    if (this.breachUnsub) {
      this.breachUnsub();
      this.breachUnsub = null;
    }
    this.grid = null;
    this.entryCells.clear();
    this.roomMap = null;
    this.roomsDirty = true;
    this.guards = [];
    this.beliefState = { x: 0, y: 0, t: 0, valid: false };
    this.routes = [];
    this.routeCursor = 0;
    this.lastReassignAt = -Infinity;
    this.convergeAt = new WeakMap();
    this.approachGoal = new WeakMap();
  }

  addGuard(guard: GuardLike): void {
    if (!this.guards.includes(guard)) this.guards.push(guard);
  }

  removeGuard(guard: GuardLike): void {
    const i = this.guards.indexOf(guard);
    if (i !== -1) this.guards.splice(i, 1);
    guard.assignedEntry = null;
    // Fewer guards → redistribute the survivors across the entrances next tick.
    this.forceReassign();
  }

  setPatrolRoutes(routes: PatrolRouteInput[]): void {
    this.routes = routes ?? [];
    this.routeCursor = 0;
  }

  // --- belief ---------------------------------------------------------------

  /** Any guard's sighting (or a gunshot / bomb) updates the one shared last-known position. */
  updateBelief(x: number, y: number, now: number): void {
    const prev = this.beliefState;
    this.beliefState = { x, y, t: now, valid: true };
    if (!prev.valid) {
      this.forceReassign();
      return;
    }
    // Re-plan immediately when the hero is believed to have crossed into another room.
    if (this.grid) {
      const rooms = this.rooms();
      if (roomOfPoint(this.grid, rooms, prev.x, prev.y) !== roomOfPoint(this.grid, rooms, x, y)) {
        this.forceReassign();
      }
    }
  }

  get belief(): SquadBelief {
    return this.beliefState;
  }

  // --- per-frame ------------------------------------------------------------

  /** Called every fixed step from the gameloop (after `nav.update`). Reassign is gated to ~1 Hz. */
  update(now: number): void {
    if (!this.grid || !this.beliefState.valid) return;
    if (now - this.lastReassignAt >= this.REASSIGN_INTERVAL_MS) {
      this.reassignEntries();
      this.lastReassignAt = now;
    }
  }

  /**
   * Steer one alarmed guard that does NOT currently see the hero (called from the alarmed
   * branch of `gameloop_guards`, replacing the old "path straight to last-known" block).
   *
   * A guard already in the hero's room (or without a plan yet) converges on the belief via the
   * shared flow field. A guard in another room approaches its assigned entrance by its own A*,
   * which reads danger + door-cost spikes live, so guards fan out and route around kill boxes.
   */
  steerAlarmed(guard: GuardLike, _now: number): void {
    const grid = this.grid;
    if (!grid || !this.beliefState.valid) return;
    const rooms = this.rooms();
    const targetRoom = roomOfPoint(grid, rooms, this.beliefState.x, this.beliefState.y);
    const guardRoom = roomOfPoint(grid, rooms, guard.x, guard.y);

    if (targetRoom === -1 || guardRoom === targetRoom || guard.assignedEntry === null) {
      if (guardRoom === targetRoom) guard.assignedEntry = null;
      this.convergeOnBelief(guard);
      return;
    }
    // Approaching: head to the assigned entrance by an individual search.
    guard.moving = true;
    guard.chasingHero = true;
    const goalCell = guard.assignedEntry;
    if (nav.hasPendingRequest(guard)) return;
    const noRoute = guard.path.length === 0 && (guard.target.x === null || guard.target.y === null);
    if (this.approachGoal.get(guard) === goalCell && !noRoute) return;
    this.approachGoal.set(guard, goalCell);
    const goal = grid.pointAtIndex(goalCell);
    nav.requestPath({
      owner: guard,
      from: { x: guard.x, y: guard.y },
      to: goal,
      radius: guard.radius,
      priority: PathPriority.Combat,
      onReady: (path) => {
        if (path.length > 0) guard.path = path;
      },
    });
  }

  /**
   * Patrol using the map's named routes if any (round-robin one per guard, walked leg by leg).
   * Returns false when there are no usable routes, so the caller's random-wander fallback runs.
   */
  patrolPathFor(guard: GuardLike): boolean {
    if (this.routes.length === 0 || !this.grid) return false;
    if (guard.patrolRouteIndex < 0) {
      guard.patrolRouteIndex = this.routeCursor % this.routes.length;
      this.routeCursor++;
      guard.patrolLeg = 0;
    }
    const route = this.routes[guard.patrolRouteIndex];
    if (!route || route.points.length === 0) return false;
    // Still walking the current leg — leave it be.
    if (guard.path.length > 0 || guard.target.x !== null) return true;
    const leg = route.points[guard.patrolLeg % route.points.length];
    const dest = { x: leg[0], y: leg[1] };
    // If this route can't be reached from where the guard is, hand back to random wander.
    if (!nav.canReach({ x: guard.x, y: guard.y }, dest)) return false;
    guard.patrolLeg = (guard.patrolLeg + 1) % route.points.length;
    guard.moving = true;
    if (!nav.hasPendingRequest(guard)) {
      nav.requestPath({
        owner: guard,
        from: { x: guard.x, y: guard.y },
        to: dest,
        radius: guard.radius,
        priority: PathPriority.Patrol,
        onReady: (path) => {
          if (path.length > 0) guard.path = path;
        },
      });
    }
    return true;
  }

  // --- death ----------------------------------------------------------------

  /**
   * A guard died. Deposit danger scaled by how many living guards could see it and whether it
   * fell at a chokepoint, so subsequent path searches route around the spot. Call before
   * `removeGuard` so the dead guard's squadmates are still counted.
   */
  reportDeath(dead: GuardLike, _now: number): void {
    const grid = this.grid;
    let witnesses = 0;
    let atEntry = false;
    if (grid) {
      for (const other of this.guards) {
        if (other === dead || !other.alive) continue;
        if (this.witnessSee(other.x, other.y, dead.x, dead.y)) witnesses++;
      }
      const cell = grid.indexAtPoint(dead.x, dead.y);
      atEntry = cell !== -1 && (this.entryCells.has(cell) || this.isNextToEntry(cell));
    }
    const { amount, radius } = witnessDangerAmount(atEntry, witnesses);
    events.emit('nav:danger', { x: dead.x, y: dead.y, amount, radius });
    this.forceReassign();
  }

  // --- internals ------------------------------------------------------------

  private convergeOnBelief(guard: GuardLike): void {
    const belief = this.beliefState;
    if (!belief.valid) return;
    guard.moving = true;
    guard.chasingHero = true;
    const noRoute = guard.path.length === 0 && (guard.target.x === null || guard.target.y === null);
    // Recompute only when out of route or the belief has moved since our last converge — the
    // shared flow field is cheap, but we still avoid regenerating a walked path every frame.
    if (noRoute || this.convergeAt.get(guard) !== belief.t) {
      const path = nav.convergeTo({ x: guard.x, y: guard.y }, { x: belief.x, y: belief.y }, guard.radius);
      if (path.length > 0) {
        guard.path = path;
        this.convergeAt.set(guard, belief.t);
      }
    }
  }

  private reassignEntries(): void {
    const grid = this.grid;
    if (!grid) return;
    this.restoreSpikes();
    for (const guard of this.guards) if (guard.alive) guard.assignedEntry = null;
    if (!this.beliefState.valid) return;

    const rooms = this.rooms();
    const targetRoom = roomOfPoint(grid, rooms, this.beliefState.x, this.beliefState.y);
    if (targetRoom === -1) return;
    const candidates = candidateEntries(grid, rooms, targetRoom, this.entryCells);
    if (candidates.length === 0) return; // one open way in (or none) — nothing to spread across.

    const approaching = this.guards.filter(
      (g) => g.alive && g.alarmed && roomOfPoint(grid, rooms, g.x, g.y) !== targetRoom,
    );
    if (approaching.length === 0) return;

    const guardCells = approaching.map((g) => grid.nearestWalkable(grid.indexAtPoint(g.x, g.y)));
    const assignment = assignEntriesRoundRobin(guardCells, candidates, {
      distanceFn: (guardCell, e) => octileDistance(grid, guardCell, e.approachCell),
      dangerWeight: this.DANGER_WEIGHT,
      spikePerClaim: this.SPIKE_PER_CLAIM,
    });
    for (const [gi, entryCell] of assignment) approaching[gi].assignedEntry = entryCell;

    // Secondary: a temporary real door-cost bump at each claimed entrance, so the shared
    // in-room field and any fallback search also prefer the other ways in. Fully restored next
    // reassign / on reset, so it can never leak into a permanently-expensive door.
    for (const entryCell of new Set(assignment.values())) {
      grid.doorCost[entryCell] += this.ENTRY_SPIKE;
      this.spikes.set(entryCell, (this.spikes.get(entryCell) ?? 0) + this.ENTRY_SPIKE);
    }
  }

  private restoreSpikes(): void {
    if (this.grid) {
      for (const [cell, added] of this.spikes) this.grid.doorCost[cell] -= added;
    }
    this.spikes.clear();
  }

  private rooms(): RoomMap {
    if (!this.grid) throw new Error('squad.build() has not run yet');
    if (!this.roomMap || this.roomsDirty || this.roomMap.version !== this.grid.version) {
      this.roomMap = labelRooms(this.grid, this.entryCells, this.roomMap ?? undefined);
      this.roomsDirty = false;
    }
    return this.roomMap;
  }

  private isNextToEntry(cell: number): boolean {
    if (!this.grid) return false;
    for (let dir = 0; dir < ALL_DIRS; dir++) {
      const n = this.grid.neighbor(cell, dir);
      if (n !== -1 && this.entryCells.has(n)) return true;
    }
    return false;
  }

  private forceReassign(): void {
    this.lastReassignAt = -Infinity;
  }
}

/** The game's squad coordinator. */
export const squad = new SquadBlackboard();
