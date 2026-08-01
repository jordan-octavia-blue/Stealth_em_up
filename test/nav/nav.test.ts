import { beforeEach, describe, expect, it, vi } from 'vitest';
import { events } from '../../src/core/events';
import { LegacyGridLike, nav, PathPriority } from '../../src/nav';

/**
 * A stand-in for the legacy `jo_grid` — the same structural shape nav reads at build
 * time: a flat `cells` array of `{solid, door, restricted}` in `y * width + x` order.
 */
function legacyGrid(rows: string[]): LegacyGridLike {
  const width = rows[0].length;
  const cells: LegacyGridLike['cells'] = [];
  for (const row of rows) {
    for (const ch of row) {
      cells.push({
        solid: ch === '#' || ch === 'D',
        door: ch === 'D',
        restricted: ch === 'R',
      });
    }
  }
  return { width, height: rows.length, cell_size: 64, cells };
}

const OPEN_ROOM = [
  '##########',
  '#........#',
  '#........#',
  '#........#',
  '#........#',
  '##########',
];

/** Centre of cell (x, y) in world pixels. */
const at = (x: number, y: number) => ({ x: x * 64 + 32, y: y * 64 + 32 });

/** Run enough fixed steps for the scheduler to drain its queue. */
function pump(steps = 10): void {
  for (let i = 0; i < steps; i++) nav.update(1000 / 60);
}

describe('nav.build', () => {
  beforeEach(() => nav.reset());

  it('derives walkability from the legacy cell flags', () => {
    const grid = nav.build(legacyGrid(OPEN_ROOM));
    expect(nav.ready).toBe(true);
    expect(grid.isWalkable(grid.index(0, 0))).toBe(false);
    expect(grid.isWalkable(grid.index(1, 1))).toBe(true);
  });

  it('keeps doors walkable but charges a chokepoint cost', () => {
    const grid = nav.build(legacyGrid(['###', '#D#', '###']));
    const door = grid.index(1, 1);
    expect(grid.isWalkable(door)).toBe(true);
    expect(grid.costAt(door)).toBeGreaterThan(1);
  });

  it('charges a little extra for restricted floor', () => {
    const grid = nav.build(legacyGrid(['###', '#R#', '###']));
    expect(grid.costAt(grid.index(1, 1))).toBeGreaterThan(1);
  });
});

describe('nav path requests', () => {
  beforeEach(() => {
    nav.reset();
    nav.build(legacyGrid(OPEN_ROOM));
  });

  it('delivers a path on a later step, not inline', () => {
    const onReady = vi.fn();
    const handle = nav.requestPath({
      owner: 'guard',
      from: at(1, 1),
      to: at(8, 4),
      radius: 19,
      onReady,
    });
    expect(handle.pending).toBe(true);
    expect(onReady).not.toHaveBeenCalled();

    pump(1);
    expect(handle.state).toBe('ready');
    expect(handle.path?.length).toBeGreaterThan(0);
    expect(handle.path?.[handle.path.length - 1]).toEqual(at(8, 4));
  });

  it('caps the searches run per step', () => {
    for (let i = 0; i < 12; i++) {
      nav.requestPath({ owner: `guard${i}`, from: at(1, 1), to: at(8, 4) });
    }
    nav.update(1000 / 60);
    expect(nav.stats.searches).toBeLessThanOrEqual(4);
    expect(nav.stats.queued).toBeGreaterThan(0);
  });

  it('serves a combat request before queued patrol ones', () => {
    const order: string[] = [];
    for (let i = 0; i < 6; i++) {
      nav.requestPath({
        owner: `patrol${i}`,
        from: at(1, 1),
        to: at(8, 4),
        priority: PathPriority.Patrol,
        onReady: () => order.push('patrol'),
      });
    }
    nav.requestPath({
      owner: 'chaser',
      from: at(1, 1),
      to: at(8, 4),
      priority: PathPriority.Combat,
      onReady: () => order.push('combat'),
    });
    nav.update(1000 / 60);
    expect(order[0]).toBe('combat');
  });

  it('fails a request into a sealed room without searching the whole map', () => {
    nav.reset();
    nav.build(
      legacyGrid([
        '#######',
        '#.....#',
        '#.###.#',
        '#.#.#.#',
        '#.###.#',
        '#.....#',
        '#######',
      ]),
    );
    const onFail = vi.fn();
    nav.requestPath({ owner: 'guard', from: at(1, 1), to: at(3, 3), onFail });
    pump(1);
    expect(onFail).toHaveBeenCalledOnce();
    expect(nav.canReach(at(1, 1), at(3, 3))).toBe(false);
  });

  it('snaps a start point that sits inside a solid cell', () => {
    // The van and the security computer make the ground under themselves solid, so
    // units really do stand in solid cells.
    const handle = nav.requestPath({ owner: 'guard', from: at(0, 0), to: at(8, 4) });
    pump(1);
    expect(handle.state).toBe('ready');
  });
});

describe('nav.randomDestinationNear', () => {
  beforeEach(() => nav.reset());

  it('only ever samples the requester own region', () => {
    nav.build(
      legacyGrid([
        '#########',
        '#...#...#',
        '#...#...#',
        '#...#...#',
        '#########',
      ]),
    );
    for (let i = 0; i < 100; i++) {
      const destination = nav.randomDestinationNear(at(1, 1));
      expect(destination).not.toBeNull();
      // left room only: x stays left of the dividing wall at cell x = 4
      expect((destination as { x: number }).x).toBeLessThan(4 * 64);
    }
  });

  it('gives up gracefully when a guard is walled in alone', () => {
    nav.build(
      legacyGrid([
        '###',
        '#.#',
        '###',
      ]),
    );
    // the only cell in the region is the guard's own, so there is nowhere to patrol
    expect(nav.randomDestinationNear(at(1, 1))).toBeNull();
  });

  it('prefers a destination that is actually worth walking to', () => {
    nav.build(legacyGrid(OPEN_ROOM));
    let far = 0;
    for (let i = 0; i < 50; i++) {
      const destination = nav.randomDestinationNear(at(1, 1));
      const dx = Math.abs((destination as { x: number }).x - at(1, 1).x);
      const dy = Math.abs((destination as { y: number }).y - at(1, 1).y);
      if (dx >= 3 * 64 || dy >= 3 * 64) far++;
    }
    expect(far).toBeGreaterThan(40);
  });
});

describe('nav.convergeTo', () => {
  beforeEach(() => {
    nav.reset();
    nav.build(legacyGrid(OPEN_ROOM));
  });

  it('returns waypoints ending at the shared target', () => {
    const path = nav.convergeTo(at(1, 1), at(8, 4), 19);
    expect(path.length).toBeGreaterThan(0);
    expect(path[path.length - 1]).toEqual(at(8, 4));
  });

  it('builds ONE field however many units converge on the same target', () => {
    const before = nav.stats.flowFieldRebuilds;
    for (let i = 1; i <= 4; i++) nav.convergeTo(at(1, i), at(8, 4), 19);
    expect(nav.stats.flowFieldRebuilds).toBe(before + 1);
  });

  it('rebuilds when the target moves', () => {
    nav.convergeTo(at(1, 1), at(8, 4), 19);
    const after = nav.stats.flowFieldRebuilds;
    nav.convergeTo(at(1, 1), at(2, 2), 19);
    expect(nav.stats.flowFieldRebuilds).toBe(after + 1);
  });

  it('exposes cost-weighted distance to the target for later AI use', () => {
    nav.convergeTo(at(1, 1), at(8, 4), 19);
    expect(nav.distanceToFieldTarget(at(8, 4))).toBe(0);
    expect(nav.distanceToFieldTarget(at(1, 1))).toBeGreaterThan(0);
    expect(nav.distanceToFieldTarget(at(1, 1))).toBeLessThan(Infinity);
  });
});

describe('nav:dirty', () => {
  beforeEach(() => nav.reset());

  it('makes a blown-open wall pathable immediately', () => {
    // Two rooms with no connection at all.
    const grid = nav.build(
      legacyGrid([
        '#########',
        '#...#...#',
        '#...#...#',
        '#...#...#',
        '#########',
      ]),
    );
    expect(nav.canReach(at(1, 1), at(7, 1))).toBe(false);
    expect(nav.regions.count).toBe(2);

    // the bomb takes out the middle of the dividing wall
    events.emit('nav:dirty', [grid.index(4, 2)]);

    expect(nav.regions.count).toBe(1);
    expect(nav.canReach(at(1, 1), at(7, 1))).toBe(true);

    const handle = nav.requestPath({ owner: 'guard', from: at(1, 1), to: at(7, 1), radius: 19 });
    pump(1);
    expect(handle.state).toBe('ready');
  });

  it('marks rubble as passable but slightly less inviting than clean floor', () => {
    const grid = nav.build(legacyGrid(['###', '#.#', '###']));
    events.emit('nav:dirty', grid.index(1, 0));
    expect(grid.isWalkable(grid.index(1, 0))).toBe(true);
    expect(grid.costAt(grid.index(1, 0))).toBeGreaterThan(grid.costAt(grid.index(1, 1)));
  });

  it('accepts a cell being sealed as well as opened', () => {
    const grid = nav.build(legacyGrid(OPEN_ROOM));
    events.emit('nav:dirty', { index: grid.index(5, 2), walkable: false });
    expect(grid.isWalkable(grid.index(5, 2))).toBe(false);
  });

  it('drops the live flow field so converging guards do not use stale geometry', () => {
    const grid = nav.build(legacyGrid(OPEN_ROOM));
    nav.convergeTo(at(1, 1), at(8, 4), 19);
    expect(nav.flowField).not.toBeNull();
    events.emit('nav:dirty', { index: grid.index(5, 2), walkable: false });
    expect(nav.flowField).toBeNull();
  });

  it('ignores out-of-range indices', () => {
    nav.build(legacyGrid(OPEN_ROOM));
    expect(() => events.emit('nav:dirty', [-1, 99999])).not.toThrow();
  });
});

describe('nav:danger', () => {
  beforeEach(() => {
    nav.reset();
    nav.build(legacyGrid(OPEN_ROOM));
  });

  it('deposits at a world position and decays over time', () => {
    const grid = nav.navGrid;
    events.emit('nav:danger', { x: at(4, 2).x, y: at(4, 2).y, amount: 8, radius: 1 });
    const hot = grid.dangerCost[grid.index(4, 2)];
    expect(hot).toBeCloseTo(8);

    // ~8s of fixed steps is one half-life
    for (let i = 0; i < 60 * 8; i++) nav.update(1000 / 60);
    expect(grid.dangerCost[grid.index(4, 2)]).toBeLessThan(hot * 0.55);
  });

  it('bends paths around a spot where guards keep dying', () => {
    const grid = nav.navGrid;
    // a hot column, so the straight run along row 2 becomes the expensive option
    for (let y = 1; y <= 4; y++) {
      events.emit('nav:danger', { x: at(5, y).x, y: at(5, y).y, amount: 10, radius: 0 });
    }
    const straight = nav.convergeTo(at(1, 2), at(8, 2), 0);
    expect(straight.length).toBeGreaterThan(0);
    const crossesHotColumn = straight.some(
      (p) => grid.indexAtPoint(p.x, p.y) === grid.index(5, 2),
    );
    expect(crossesHotColumn).toBe(false);
  });

  it('ignores a position off the map', () => {
    expect(() => events.emit('nav:danger', { x: -500, y: -500, amount: 5 })).not.toThrow();
  });
});

describe('nav.reset', () => {
  it('drops queued requests so nothing survives into the next run', () => {
    nav.reset();
    nav.build(legacyGrid(OPEN_ROOM));
    const handle = nav.requestPath({ owner: 'guard', from: at(1, 1), to: at(8, 4) });
    nav.reset();
    expect(handle.state).toBe('cancelled');
    expect(nav.ready).toBe(false);
    // and nothing throws when the loop keeps ticking between runs
    expect(() => nav.update(16)).not.toThrow();
  });
});
