import { beforeEach, describe, expect, it } from 'vitest';
import { PhysicsWorld, PhysicsGridLike, ActorOwner } from '../../src/physics/world';
import { BULLET_MASK, CATEGORY, VISION_MASK } from '../../src/physics/constants';

const CS = 64;

/**
 * A grid from an ASCII map:
 *   `#` solid + vision blocking (a wall)
 *   `o` solid, see-through (office furniture — you can shoot over it)
 *   `D` a closed door, `d` an open one
 *   `.` floor
 */
function gridFrom(rows: string[]): PhysicsGridLike {
  const height = rows.length;
  const width = rows[0].length;
  const cells: PhysicsGridLike['cells'] = [];
  for (const row of rows) {
    for (const ch of row) {
      cells.push({
        solid: ch === '#' || ch === 'o' || ch === 'D',
        door: ch === 'D' || ch === 'd',
        blocks_vision: ch === '#' || ch === 'D',
      });
    }
  }
  return { width, height, cell_size: CS, cells };
}

function centre(x: number, y: number): { x: number; y: number } {
  return { x: x * CS + CS / 2, y: y * CS + CS / 2 };
}

function index(grid: PhysicsGridLike, x: number, y: number): number {
  return y * grid.width + x;
}

function actorAt(x: number, y: number): ActorOwner {
  const p = centre(x, y);
  return { x: p.x, y: p.y };
}

/** Run `n` fixed steps, re-asserting the velocity each step the way the gameloop does. */
function run(world: PhysicsWorld, n: number, tick: () => void = () => {}): void {
  for (let i = 0; i < n; i++) {
    tick();
    world.step(1 / 60);
    world.syncActors();
  }
}

describe('PhysicsWorld: map geometry', () => {
  let world: PhysicsWorld;

  beforeEach(() => {
    world = new PhysicsWorld();
  });

  it('creates one fixture per solid cell and per door', () => {
    const grid = gridFrom(['#####', '#.o.#', '#.D.#', '#...#', '#####']);
    world.build(grid);
    const solids = grid.cells.filter((c) => c.solid || c.door).length;
    expect(world.fixtureCount).toBe(solids);
  });

  it('leaves floor cells alone', () => {
    const grid = gridFrom(['...', '...', '...']);
    world.build(grid);
    expect(world.fixtureCount).toBe(0);
  });

  it('rebuilding drops the previous map', () => {
    world.build(gridFrom(['###', '###', '###']));
    expect(world.fixtureCount).toBe(9);
    world.build(gridFrom(['...', '...', '...']));
    expect(world.fixtureCount).toBe(0);
  });
});

describe('PhysicsWorld: raycasts', () => {
  let world: PhysicsWorld;

  beforeEach(() => {
    world = new PhysicsWorld();
  });

  it('a wall blocks sight, furniture does not', () => {
    const grid = gridFrom(['.....', '.....', '..#..', '.....', '.....']);
    world.build(grid);
    const a = centre(0, 2);
    const b = centre(4, 2);
    expect(world.isClear(a.x, a.y, b.x, b.y, VISION_MASK)).toBe(false);

    // same layout, but the obstacle is see-through furniture
    world.build(gridFrom(['.....', '.....', '..o..', '.....', '.....']));
    expect(world.isClear(a.x, a.y, b.x, b.y, VISION_MASK)).toBe(true);
  });

  it('reports the nearest hit, not just any hit', () => {
    const grid = gridFrom(['.....', '.....', '.#.#.', '.....', '.....']);
    world.build(grid);
    const a = centre(0, 2);
    const b = centre(4, 2);
    const hit = world.rayCast(a.x, a.y, b.x, b.y, VISION_MASK);
    expect(hit).not.toBeNull();
    // the near wall's west face, at x = 1 * CS
    expect(hit!.x).toBeCloseTo(CS, 3);
    expect(hit!.cell).toBe(index(grid, 1, 2));
  });

  it('a bullet stops at a person before it reaches the wall behind them', () => {
    const grid = gridFrom(['.....', '.....', '....#', '.....', '.....']);
    world.build(grid);
    const shooter = actorAt(0, 2);
    const victim = actorAt(2, 2);
    world.addActor(shooter, { radius: 14, category: CATEGORY.HERO });
    world.addActor(victim, { radius: 19, category: CATEGORY.GUARD });

    const hit = world.rayCast(shooter.x, shooter.y, 5 * CS, shooter.y, BULLET_MASK, shooter);
    expect(hit).not.toBeNull();
    expect(hit!.owner).toBe(victim);
  });

  it('ignores the shooter', () => {
    world.build(gridFrom(['.....', '.....', '.....', '.....', '.....']));
    const shooter = actorAt(2, 2);
    world.addActor(shooter, { radius: 14, category: CATEGORY.HERO });
    // a ray that starts inside the shooter's own fixture
    expect(world.rayCast(shooter.x - 40, shooter.y, shooter.x + 200, shooter.y, BULLET_MASK, shooter)).toBeNull();
    expect(world.rayCast(shooter.x - 40, shooter.y, shooter.x + 200, shooter.y, BULLET_MASK, null)).not.toBeNull();
  });

  it('skips sensor fixtures, so a door trigger never stops a bullet', () => {
    const grid = gridFrom(['.....', '.....', '..d..', '.....', '.....']);
    world.build(grid);
    const a = centre(0, 2);
    const b = centre(4, 2);
    // the open door's own fixture is a sensor and it carries no VISION_BLOCKER bit;
    // its proximity trigger is a 76 px sensor circle sitting right on the line.
    expect(world.isClear(a.x, a.y, b.x, b.y, VISION_MASK)).toBe(true);
    expect(world.isClear(a.x, a.y, b.x, b.y, BULLET_MASK)).toBe(true);
  });
});

describe('PhysicsWorld: doors', () => {
  let world: PhysicsWorld;
  let grid: PhysicsGridLike;
  let door: number;

  beforeEach(() => {
    world = new PhysicsWorld();
    grid = gridFrom(['#####', '#...#', '##D##', '#...#', '#####']);
    door = index(grid, 2, 2);
    world.build(grid);
  });

  it('blocks sight when closed and not when open', () => {
    const a = centre(2, 1);
    const b = centre(2, 3);
    expect(world.isClear(a.x, a.y, b.x, b.y, VISION_MASK)).toBe(false);
    world.setDoorOpen(door, true);
    expect(world.isClear(a.x, a.y, b.x, b.y, VISION_MASK)).toBe(true);
    world.setDoorOpen(door, false);
    expect(world.isClear(a.x, a.y, b.x, b.y, VISION_MASK)).toBe(false);
  });

  it('stops a body when closed and lets it through when open', () => {
    const walker = actorAt(2, 1);
    world.addActor(walker, { radius: 14, category: CATEGORY.HERO });
    const push = () => world.setVelocity(walker, 0, 240);

    run(world, 90, push);
    expect(walker.y).toBeLessThan(2 * CS); // held at the closed door

    world.setDoorOpen(door, true);
    run(world, 90, push);
    expect(walker.y).toBeGreaterThan(3 * CS); // walked into the far room
  });

  it('reports who is inside its proximity sensor', () => {
    const walker = actorAt(2, 1);
    world.addActor(walker, { radius: 14, category: CATEGORY.HERO });
    // spawned a cell away from the door centre — inside the 76 px sensor
    run(world, 2);
    expect([...world.openersNear(door)]).toContain(walker);

    world.removeActor(walker);
    run(world, 2);
    expect([...world.openersNear(door)]).toHaveLength(0);
  });
});

describe('PhysicsWorld: actors', () => {
  let world: PhysicsWorld;

  beforeEach(() => {
    world = new PhysicsWorld();
  });

  it('a body driven at a wall stops at it instead of passing through', () => {
    const grid = gridFrom(['.....', '.....', '..#..', '.....', '.....']);
    world.build(grid);
    const walker = actorAt(0, 2);
    world.addActor(walker, { radius: 14, category: CATEGORY.HERO });
    run(world, 180, () => world.setVelocity(walker, 480, 0));
    // stopped against the wall's west face at x = 2 * CS, minus its own radius
    expect(walker.x).toBeLessThan(2 * CS);
    expect(walker.x).toBeGreaterThan(CS);
  });

  it('slides along a wall instead of sticking to it', () => {
    // a long horizontal wall the walker is pushed diagonally into
    const grid = gridFrom(['..........', '..........', '##########', '..........']);
    world.build(grid);
    const walker = actorAt(1, 1);
    const startX = walker.x;
    world.addActor(walker, { radius: 14, category: CATEGORY.HERO });
    run(world, 120, () => world.setVelocity(walker, 240, 240));
    expect(walker.y).toBeLessThan(2 * CS); // never got through the wall
    expect(walker.x).toBeGreaterThan(startX + 400); // but kept its full speed along it
  });

  it('keeps two bodies from occupying the same spot', () => {
    world.build(gridFrom(['.....', '.....', '.....', '.....', '.....']));
    const a = actorAt(2, 2);
    const b = { x: a.x + 4, y: a.y };
    world.addActor(a, { radius: 19, category: CATEGORY.GUARD });
    world.addActor(b, { radius: 19, category: CATEGORY.GUARD });
    run(world, 60);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(30);
  });

  it('a removed body stops colliding and stops being synced', () => {
    world.build(gridFrom(['.....', '.....', '.....', '.....', '.....']));
    const corpse = actorAt(2, 2);
    world.addActor(corpse, { radius: 19, category: CATEGORY.GUARD });
    expect(world.hasActor(corpse)).toBe(true);

    world.setVelocity(corpse, 240, 0);
    world.removeActor(corpse);
    expect(world.hasActor(corpse)).toBe(false);

    const before = corpse.x;
    run(world, 60);
    expect(corpse.x).toBe(before); // the drag code owns this position now
  });

  it('teleporting a body moves it without simulating the trip', () => {
    world.build(gridFrom(['.....', '.....', '..#..', '.....', '.....']));
    const walker = actorAt(0, 0);
    world.addActor(walker, { radius: 14, category: CATEGORY.HERO });
    const target = centre(4, 4);
    world.teleport(walker, target.x, target.y);
    run(world, 2);
    expect(walker.x).toBeCloseTo(target.x, 1);
    expect(walker.y).toBeCloseTo(target.y, 1);
  });
});

describe('PhysicsWorld: destruction', () => {
  it('a cleared cell stops blocking movement and sight — the marquee breach test', () => {
    const world = new PhysicsWorld();
    const grid = gridFrom(['.....', '.....', '#####', '.....', '.....']);
    world.build(grid);
    const cell = index(grid, 2, 2);
    const above = centre(2, 1);
    const below = centre(2, 3);

    expect(world.isClear(above.x, above.y, below.x, below.y, VISION_MASK)).toBe(false);

    const walker = actorAt(2, 1);
    world.addActor(walker, { radius: 14, category: CATEGORY.HERO });
    run(world, 60, () => world.setVelocity(walker, 0, 240));
    expect(walker.y).toBeLessThan(2 * CS);

    // ...bomb goes off
    world.clearCell(cell);
    expect(world.hasCellFixture(cell)).toBe(false);

    run(world, 90, () => world.setVelocity(walker, 0, 240));
    expect(walker.y).toBeGreaterThan(3 * CS);
    expect(world.isClear(above.x, above.y, below.x, below.y, VISION_MASK)).toBe(true);
  });

  it('sealing a cell adds collision and opacity back', () => {
    const world = new PhysicsWorld();
    const grid = gridFrom(['.....', '.....', '.....', '.....', '.....']);
    world.build(grid);
    const cell = index(grid, 2, 2);
    const a = centre(0, 2);
    const b = centre(4, 2);
    expect(world.isClear(a.x, a.y, b.x, b.y, VISION_MASK)).toBe(true);

    // this is what the getaway van and the security computer do to their own tile
    world.setCellSolid(cell, true);
    expect(world.isClear(a.x, a.y, b.x, b.y, VISION_MASK)).toBe(false);
    expect(world.fixtureCount).toBe(1);
  });
});
