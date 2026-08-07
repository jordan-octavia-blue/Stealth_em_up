import { beforeEach, describe, expect, it } from 'vitest';
import { Body, Box, Vec2, World } from 'planck';
import { driveCarBody, DEFAULT_CAR_TUNING, CarControls } from '../../src/physics/car';
import { PhysicsWorld, PhysicsGridLike, ActorOwner } from '../../src/physics/world';
import { CATEGORY } from '../../src/physics/constants';
import { DEFAULT_CAR_TUNING as TUNING } from '../../src/physics';

const CS = 64;

// --- the pure top-down car model (roadmap §3.3) -----------------------------

/** A lone dynamic box in an empty world, the way the model sees the car. */
function makeCarBody(angle = 0): { world: World; body: Body } {
  const world = new World({ gravity: Vec2(0, 0) });
  const body = world.createDynamicBody({ position: Vec2(0, 0), angle, allowSleep: false });
  body.createFixture(Box(1.7, 0.9), { density: 1 });
  return { world, body };
}

function drive(world: World, body: Body, controls: CarControls, steps: number): void {
  for (let i = 0; i < steps; i++) {
    driveCarBody(body, controls, DEFAULT_CAR_TUNING);
    world.step(1 / 60);
  }
}

const IDLE: CarControls = { throttle: 0, steer: 0, handbrake: false };

describe('car model: driving', () => {
  it('throttle accelerates the car along its heading', () => {
    const { world, body } = makeCarBody(0); // pointing +x
    drive(world, body, { throttle: 1, steer: 0, handbrake: false }, 60);
    const v = body.getLinearVelocity();
    expect(v.x).toBeGreaterThan(2); // moving forward
    expect(Math.abs(v.y)).toBeLessThan(0.2); // and straight
    expect(body.getPosition().x).toBeGreaterThan(1);
  });

  it('holds a top speed instead of accelerating forever', () => {
    const { world, body } = makeCarBody(0);
    drive(world, body, { throttle: 1, steer: 0, handbrake: false }, 600);
    const speed = body.getLinearVelocity().length();
    expect(speed).toBeGreaterThan(8);
    expect(speed).toBeLessThanOrEqual(DEFAULT_CAR_TUNING.maxSpeed + 1);
  });

  it('reverse backs the car up', () => {
    const { world, body } = makeCarBody(0);
    drive(world, body, { throttle: -1, steer: 0, handbrake: false }, 60);
    expect(body.getPosition().x).toBeLessThan(-0.5);
  });
});

describe('car model: grip and drift', () => {
  it('grip cancels a sideways slide almost at once', () => {
    const { world, body } = makeCarBody(0);
    body.setLinearVelocity(Vec2(0, 5)); // pure sideways velocity
    driveCarBody(body, IDLE, DEFAULT_CAR_TUNING);
    world.step(1 / 60);
    // the lateral component (world y, since heading is +x) is killed within a step
    expect(Math.abs(body.getLinearVelocity().y)).toBeLessThan(0.5);
  });

  it('the handbrake lets the back end keep sliding', () => {
    const grip = makeCarBody(0);
    grip.body.setLinearVelocity(Vec2(0, 5));
    driveCarBody(grip.body, IDLE, DEFAULT_CAR_TUNING);
    grip.world.step(1 / 60);

    const slide = makeCarBody(0);
    slide.body.setLinearVelocity(Vec2(0, 5));
    driveCarBody(slide.body, { throttle: 0, steer: 0, handbrake: true }, DEFAULT_CAR_TUNING);
    slide.world.step(1 / 60);

    // with the handbrake down far more of the sideways velocity survives the step
    expect(Math.abs(slide.body.getLinearVelocity().y)).toBeGreaterThan(
      Math.abs(grip.body.getLinearVelocity().y) + 2,
    );
  });
});

describe('car model: steering', () => {
  it('turns when moving but not when stopped', () => {
    const moving = makeCarBody(0);
    moving.body.setLinearVelocity(Vec2(5, 0));
    drive(moving.world, moving.body, { throttle: 0, steer: 1, handbrake: false }, 20);
    expect(Math.abs(moving.body.getAngle())).toBeGreaterThan(0.05);

    const parked = makeCarBody(0);
    drive(parked.world, parked.body, { throttle: 0, steer: 1, handbrake: false }, 20);
    expect(Math.abs(parked.body.getAngle())).toBeLessThan(1e-6);
  });

  it('steers the opposite way in reverse, like a real car', () => {
    const fwd = makeCarBody(0);
    fwd.body.setLinearVelocity(Vec2(5, 0));
    driveCarBody(fwd.body, { throttle: 0, steer: 1, handbrake: false }, DEFAULT_CAR_TUNING);
    fwd.world.step(1 / 60);

    const rev = makeCarBody(0);
    rev.body.setLinearVelocity(Vec2(-5, 0));
    driveCarBody(rev.body, { throttle: 0, steer: 1, handbrake: false }, DEFAULT_CAR_TUNING);
    rev.world.step(1 / 60);

    // same steering input, opposite direction of travel → opposite yaw
    expect(Math.sign(fwd.body.getAngularVelocity())).toBe(-Math.sign(rev.body.getAngularVelocity()));
  });
});

// --- the car inside the real physics world ----------------------------------

function gridFrom(rows: string[]): PhysicsGridLike {
  const height = rows.length;
  const width = rows[0].length;
  const cells: PhysicsGridLike['cells'] = [];
  for (const row of rows) {
    for (const ch of row) {
      cells.push({ solid: ch === '#', door: false, blocks_vision: ch === '#' });
    }
  }
  return { width, height, cell_size: CS, cells };
}

function centre(x: number, y: number): { x: number; y: number } {
  return { x: x * CS + CS / 2, y: y * CS + CS / 2 };
}
function idx(grid: PhysicsGridLike, x: number, y: number): number {
  return y * grid.width + x;
}
function ownerAt(x: number, y: number): ActorOwner {
  const p = centre(x, y);
  return { x: p.x, y: p.y };
}

describe('PhysicsWorld: the car body', () => {
  let world: PhysicsWorld;

  beforeEach(() => {
    world = new PhysicsWorld();
  });

  it('re-exports a default tuning', () => {
    expect(TUNING.maxSpeed).toBeGreaterThan(0);
  });

  it('reports the car position and moves it under throttle', () => {
    world.build(gridFrom(['..........', '..........', '..........']));
    const car = ownerAt(1, 1);
    world.addCar(car, { length: 108, width: 58, angle: 0, tuning: DEFAULT_CAR_TUNING });
    expect(world.hasCar(car)).toBe(true);
    const start = world.getCarState(car)!.x;
    for (let i = 0; i < 60; i++) {
      world.driveCar(car, { throttle: 1, steer: 0, handbrake: false });
      world.step(1 / 60);
    }
    expect(world.getCarState(car)!.x).toBeGreaterThan(start + 20);
  });

  it('stops at a wall it drives into and records the hit', () => {
    // a vertical wall three cells to the right of the car
    const grid = gridFrom(['.....', '...#.', '.....']);
    const wall = idx(grid, 3, 1);
    world.build(grid);
    const car = ownerAt(1, 1);
    world.addCar(car, { length: 108, width: 58, angle: 0, tuning: DEFAULT_CAR_TUNING });
    let hitCell = -1;
    for (let i = 0; i < 180; i++) {
      world.driveCar(car, { throttle: 1, steer: 0, handbrake: false });
      world.step(1 / 60);
      for (const c of world.drainCarContacts()) if (c.kind === 'cell') hitCell = c.cell;
    }
    expect(hitCell).toBe(wall); // the car reported hitting that wall cell
    expect(world.getCarState(car)!.x).toBeLessThan(3 * CS); // and never tunnelled through it
  });

  it('records a guard it drives into, with the closing speed', () => {
    world.build(gridFrom(['..........', '..........', '..........']));
    const car = ownerAt(1, 1);
    const guard = ownerAt(4, 1);
    world.addCar(car, { length: 108, width: 58, angle: 0, tuning: DEFAULT_CAR_TUNING });
    world.addActor(guard, { radius: 19, category: CATEGORY.GUARD });

    let hit = null as null | { kind: string; owner: ActorOwner | null; speed: number };
    for (let i = 0; i < 200 && !hit; i++) {
      world.driveCar(car, { throttle: 1, steer: 0, handbrake: false });
      world.step(1 / 60);
      for (const c of world.drainCarContacts()) if (c.kind === 'actor') hit = c;
    }
    expect(hit).not.toBeNull();
    expect(hit!.owner).toBe(guard);
    expect(hit!.speed).toBeGreaterThan(0);
  });

  it('spotClear tells open floor from a wall', () => {
    const grid = gridFrom(['.....', '..#..', '.....']);
    world.build(grid);
    const open = centre(4, 1);
    const onWall = centre(2, 1);
    expect(world.spotClear(open.x, open.y, 14, CATEGORY.WALL | CATEGORY.GUARD)).toBe(true);
    expect(world.spotClear(onWall.x, onWall.y, 14, CATEGORY.WALL | CATEGORY.GUARD)).toBe(false);
  });

  it('drops the car on reset', () => {
    world.build(gridFrom(['.....', '.....']));
    const car = ownerAt(1, 1);
    world.addCar(car, { length: 108, width: 58, angle: 0, tuning: DEFAULT_CAR_TUNING });
    expect(world.hasCar(car)).toBe(true);
    world.reset();
    expect(world.hasCar(car)).toBe(false);
  });
});
