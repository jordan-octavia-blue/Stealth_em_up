import { beforeEach, describe, expect, it } from 'vitest';
import { GuardLike, squad } from '../../src/ai/squad';
import { events } from '../../src/core/events';
import { DOOR_COST, LegacyGridLike, nav } from '../../src/nav';

/**
 * A central room reachable from a surrounding ring corridor by three doors (N/W/E). Guards
 * start in the ring; the hero is believed to be in the central room. This is the geometry the
 * "door funnel" is about — one shared destination, several ways in.
 *
 *   row/col   0123456789
 */
const THREE_DOOR_ROOM = [
  '##########',
  '#........#',
  '#.##D###.#', // N door at (4,2)
  '#.#....#.#',
  '#.D....D.#', // W door at (2,4), E door at (7,4)
  '#.#....#.#',
  '#.#....#.#',
  '#.######.#',
  '#........#',
  '##########',
];

function legacyGrid(rows: string[]): LegacyGridLike {
  const width = rows[0].length;
  const cells: LegacyGridLike['cells'] = [];
  for (const row of rows) {
    for (const ch of row) {
      cells.push({ solid: ch === '#' || ch === 'D', door: ch === 'D', restricted: ch === 'R' });
    }
  }
  return { width, height: rows.length, cell_size: 64, cells };
}

/** Centre of cell (x, y) in world pixels. */
const at = (x: number, y: number) => ({ x: x * 64 + 32, y: y * 64 + 32 });

function makeGuard(cellX: number, cellY: number): GuardLike {
  const p = at(cellX, cellY);
  return {
    x: p.x,
    y: p.y,
    alive: true,
    radius: 19,
    alarmed: true,
    chasingHero: false,
    path: [],
    target: { x: null, y: null },
    moving: true,
    target_rotate: null,
    assignedEntry: null,
    patrolRouteIndex: -1,
    patrolLeg: 0,
  };
}

// The three door cells, resolved once the grid is built.
let doorN = -1;
let doorW = -1;
let doorE = -1;

beforeEach(() => {
  nav.reset();
  const grid = nav.build(legacyGrid(THREE_DOOR_ROOM));
  doorN = grid.index(4, 2);
  doorW = grid.index(2, 4);
  doorE = grid.index(7, 4);
  squad.witnessSee = () => true; // every living guard sees every death, in these tests
  squad.build(grid, [doorN, doorW, doorE]);
});

describe('squad entry-point assignment (the door-funnel fix)', () => {
  it('spreads approaching guards across distinct entrances instead of one door', () => {
    const guards = [makeGuard(3, 8), makeGuard(4, 8), makeGuard(5, 8)]; // clustered in the ring
    guards.forEach((g) => squad.addGuard(g));

    squad.updateBelief(at(4, 4).x, at(4, 4).y, 0); // hero believed in the central room
    squad.update(1000);

    const assigned = guards.map((g) => g.assignedEntry);
    // Every guard got an entrance, all three are real doors, and no two share one — so at most
    // one guard ever walks through any single door.
    expect(assigned.every((e) => e === doorN || e === doorW || e === doorE)).toBe(true);
    expect(new Set(assigned).size).toBe(3);
  });

  it('routes survivors around a door where a guard just died (the kill box)', () => {
    const survivors = [makeGuard(3, 8), makeGuard(5, 8)]; // two guards for three doors
    survivors.forEach((g) => squad.addGuard(g));
    const dead = makeGuard(4, 2); // fell in the north doorway
    dead.alive = false;
    squad.addGuard(dead);

    squad.updateBelief(at(4, 4).x, at(4, 4).y, 0);
    squad.reportDeath(dead, 500); // heavy, witnessed, at a chokepoint -> danger on door N
    squad.removeGuard(dead);
    squad.update(1000);

    // The north door is now the most dangerous cell, and with a spare door each survivor is
    // sent elsewhere: nobody is assigned back into the kill box.
    expect(nav.navGrid.dangerCost[doorN]).toBeGreaterThan(nav.navGrid.dangerCost[doorE]);
    const assigned = survivors.map((g) => g.assignedEntry);
    expect(assigned).not.toContain(doorN);
    expect(assigned.every((e) => e === doorW || e === doorE)).toBe(true);
  });

  it('treats a blown-open wall as a new candidate entrance', () => {
    const grid = nav.navGrid;
    const breach = grid.index(4, 7); // south wall of the central room
    // Simulate the destruction pipeline: the cell becomes walkable, then breach.ts announces it.
    grid.setWalkable(breach, true);
    events.emit('cell:breached', { index: breach, x: at(4, 7).x, y: at(4, 7).y });

    const guards = [makeGuard(2, 8), makeGuard(3, 8), makeGuard(5, 8), makeGuard(6, 8)];
    guards.forEach((g) => squad.addGuard(g));
    squad.updateBelief(at(4, 4).x, at(4, 4).y, 0);
    squad.update(1000);

    // Four guards, four entrances (three doors + the breach) -> the breach gets used.
    expect(guards.map((g) => g.assignedEntry)).toContain(breach);
  });

  it('falls back to random wander when the map defines no patrol routes', () => {
    const g = makeGuard(3, 8);
    squad.addGuard(g);
    squad.setPatrolRoutes([]);
    // false tells sprite_guard.getRandomPatrolPath to run its own region-safe wander.
    expect(squad.patrolPathFor(g)).toBe(false);
  });

  it('assigns and walks a named patrol route when the map defines one', () => {
    const g = makeGuard(3, 8);
    squad.addGuard(g);
    squad.setPatrolRoutes([{ name: 'ring', points: [[at(6, 8).x, at(6, 8).y], [at(8, 1).x, at(8, 1).y]] }]);
    expect(squad.patrolPathFor(g)).toBe(true);
    expect(g.patrolRouteIndex).toBe(0);
  });

  it('restores every door cost on reset, so a spike never leaks into the next map', () => {
    const grid = nav.navGrid;
    const guards = [makeGuard(3, 8), makeGuard(5, 8)];
    guards.forEach((g) => squad.addGuard(g));
    squad.updateBelief(at(4, 4).x, at(4, 4).y, 0);
    squad.update(1000); // spikes the assigned doors' cost above the static DOOR_COST

    const assignedDoor = guards[0].assignedEntry as number;
    expect(grid.doorCost[assignedDoor]).toBeGreaterThan(DOOR_COST);

    squad.reset();
    for (const door of [doorN, doorW, doorE]) {
      expect(grid.doorCost[door]).toBeCloseTo(DOOR_COST);
    }
  });
});
