import { beforeEach, describe, expect, it } from 'vitest';
import { Body, Box, Vec2, World } from 'planck';
import { driveCarBody, DEFAULT_CAR_TUNING, CarControls, CarSteering } from '../../src/physics/car';
import { PhysicsWorld, PhysicsGridLike, ActorOwner } from '../../src/physics/world';
import { CATEGORY } from '../../src/physics/constants';
import { DEFAULT_CAR_TUNING as TUNING } from '../../src/physics';

const CS = 64;
const DT = 1 / 60;

// --- the pure front-wheel car model (roadmap §3.3) --------------------------

/** A lone dynamic box in an empty world, the way the model sees the car, plus the
 *  wheel-angle state the model advances each step. */
function makeCar(angle = 0): { world: World; body: Body; steering: CarSteering } {
  const world = new World({ gravity: Vec2(0, 0) });
  const body = world.createDynamicBody({
    position: Vec2(0, 0),
    angle,
    linearDamping: DEFAULT_CAR_TUNING.linearDamping,
    allowSleep: false,
  });
  body.createFixture(Box(1.7, 0.9), { density: 1 });
  return { world, body, steering: { steer: 0 } };
}

type Car = ReturnType<typeof makeCar>;

function drive(car: Car, controls: CarControls, steps: number): void {
  for (let i = 0; i < steps; i++) {
    driveCarBody(car.body, controls, DEFAULT_CAR_TUNING, car.steering, DT);
    car.world.step(DT);
  }
}

const IDLE: CarControls = { throttle: 0, steer: 0, handbrake: false };

describe('car model: driving', () => {
  it('throttle accelerates the car along its heading', () => {
    const car = makeCar(0); // pointing +x
    drive(car, { throttle: 1, steer: 0, handbrake: false }, 60);
    const v = car.body.getLinearVelocity();
    expect(v.x).toBeGreaterThan(2); // moving forward
    expect(Math.abs(v.y)).toBeLessThan(0.2); // and straight
    expect(car.body.getPosition().x).toBeGreaterThan(1);
  });

  it('holds a top speed instead of accelerating forever', () => {
    const car = makeCar(0);
    drive(car, { throttle: 1, steer: 0, handbrake: false }, 600);
    const speed = car.body.getLinearVelocity().length();
    expect(speed).toBeGreaterThan(8);
    expect(speed).toBeLessThanOrEqual(DEFAULT_CAR_TUNING.maxSpeed + 1);
  });

  it('reverse backs the car up', () => {
    const car = makeCar(0);
    drive(car, { throttle: -1, steer: 0, handbrake: false }, 60);
    expect(car.body.getPosition().x).toBeLessThan(-0.5);
  });

  it('holding reverse while rolling forward brakes hard before backing up', () => {
    const car = makeCar(0);
    car.body.setLinearVelocity(Vec2(15, 0));
    drive(car, { throttle: -1, steer: 0, handbrake: false }, 15); // a quarter second
    const v = car.body.getLinearVelocity().x;
    expect(v).toBeGreaterThan(0); // still rolling forward — no instant direction snap
    expect(v).toBeLessThan(10); // but braking much harder than a mere coast
  });

  it('coasts to an actual stop when the throttle is released', () => {
    const car = makeCar(0);
    car.body.setLinearVelocity(Vec2(10, 0));
    drive(car, IDLE, 240); // four seconds of engine braking
    expect(car.body.getLinearVelocity().length()).toBeLessThan(0.05);
  });
});

describe('car model: grip and drift', () => {
  it('grip scrubs a sideways slide off within a few steps', () => {
    const car = makeCar(0);
    car.body.setLinearVelocity(Vec2(0, 5)); // pure sideways velocity
    drive(car, IDLE, 6); // a tenth of a second
    // the lateral component (world y, since heading is +x) is nearly gone
    expect(Math.abs(car.body.getLinearVelocity().y)).toBeLessThan(0.2);
  });

  it('the handbrake lets the back end keep sliding', () => {
    const grip = makeCar(0);
    grip.body.setLinearVelocity(Vec2(0, 5));
    drive(grip, IDLE, 1);

    const slide = makeCar(0);
    slide.body.setLinearVelocity(Vec2(0, 5));
    drive(slide, { throttle: 0, steer: 0, handbrake: true }, 1);

    // with the handbrake down far more of the sideways velocity survives the step
    expect(Math.abs(slide.body.getLinearVelocity().y)).toBeGreaterThan(
      Math.abs(grip.body.getLinearVelocity().y) + 2,
    );
  });
});

describe('car model: steering', () => {
  it('turns when moving but not when stopped', () => {
    const moving = makeCar(0);
    moving.body.setLinearVelocity(Vec2(5, 0));
    drive(moving, { throttle: 0, steer: 1, handbrake: false }, 20);
    expect(Math.abs(moving.body.getAngle())).toBeGreaterThan(0.05);

    // parked, the *wheels* turn but the car does not
    const parked = makeCar(0);
    drive(parked, { throttle: 0, steer: 1, handbrake: false }, 60);
    expect(Math.abs(parked.body.getAngle())).toBeLessThan(1e-6);
    expect(parked.steering.steer).toBeCloseTo(DEFAULT_CAR_TUNING.maxSteerLowSpeed, 2);
  });

  it('steers the opposite way in reverse, like a real car', () => {
    const fwd = makeCar(0);
    fwd.body.setLinearVelocity(Vec2(5, 0));
    driveCarBody(fwd.body, { throttle: 0, steer: 1, handbrake: false }, DEFAULT_CAR_TUNING, fwd.steering, DT);
    fwd.world.step(DT);

    const rev = makeCar(0);
    rev.body.setLinearVelocity(Vec2(-5, 0));
    driveCarBody(rev.body, { throttle: 0, steer: 1, handbrake: false }, DEFAULT_CAR_TUNING, rev.steering, DT);
    rev.world.step(DT);

    // same steering input, opposite direction of travel → opposite yaw
    expect(Math.sign(fwd.body.getAngularVelocity())).toBe(-Math.sign(rev.body.getAngularVelocity()));
  });

  it('the steering lock narrows at speed, keeping the turn rate bounded', () => {
    // full throttle, full lock, from a standstill — the regime that used to spin out
    const car = makeCar(0);
    drive(car, { throttle: 1, steer: 1, handbrake: false }, 600);
    // at top speed the wheels are pinned near the high-speed lock...
    expect(car.steering.steer).toBeLessThanOrEqual(DEFAULT_CAR_TUNING.maxSteerHighSpeed + 0.02);
    // ...so the yaw rate stays modest instead of growing with speed
    expect(Math.abs(car.body.getAngularVelocity())).toBeLessThan(2.5);
    // and the car is still actually driving a circle, not sliding: speed stays near max
    expect(car.body.getLinearVelocity().length()).toBeGreaterThan(DEFAULT_CAR_TUNING.maxSpeed * 0.7);
  });

  it('a steady wheel angle drives a circle of the geometric radius', () => {
    const car = makeCar(0);
    car.body.setLinearVelocity(Vec2(8, 0));
    // hold a gentle turn and let the wheel angle settle
    drive(car, { throttle: 0, steer: 0.5, handbrake: false }, 30);
    const steer = car.steering.steer;
    const speed = car.body.getLinearVelocity().length();
    const omega = Math.abs(car.body.getAngularVelocity());
    const expected = (speed * Math.tan(steer)) / DEFAULT_CAR_TUNING.wheelbase;
    expect(omega).toBeCloseTo(expected, 1);
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

  it('a person walking into the parked van cannot shove it around', () => {
    world.build(gridFrom(['..........', '..........', '..........', '..........']));
    const car = ownerAt(2, 1); // parked, pointing +x; nobody driving
    world.addCar(car, { length: 108, width: 58, angle: 0, tuning: DEFAULT_CAR_TUNING });
    const startX = world.getCarState(car)!.x;
    const startY = world.getCarState(car)!.y;

    // a hero-sized body pressed into the van's flank, walking at full speed for 3 seconds
    const pusher: ActorOwner = { x: startX, y: startY + 29 + 14 + 1 };
    world.addActor(pusher, { radius: 14, category: CATEGORY.HERO });
    for (let i = 0; i < 180; i++) {
      world.setVelocity(pusher, 0, -280); // the hero's walk speed, straight into the van
      world.step(DT);
    }

    const st = world.getCarState(car)!;
    expect(Math.abs(st.x - startX)).toBeLessThan(2); // moved less than 2 px in 3 s
    expect(Math.abs(st.y - startY)).toBeLessThan(2);
  });

  it('an unmanned rolling van brakes itself to a stop', () => {
    world.build(gridFrom(['....................', '....................', '....................']));
    const car = ownerAt(1, 1);
    world.addCar(car, { length: 108, width: 58, angle: 0, tuning: DEFAULT_CAR_TUNING });
    // get it moving, then let go of everything — no more driveCar calls
    for (let i = 0; i < 60; i++) {
      world.driveCar(car, { throttle: 1, steer: 0, handbrake: false });
      world.step(DT);
    }
    expect(world.getCarState(car)!.speed).toBeGreaterThan(100);
    for (let i = 0; i < 300; i++) world.step(DT);
    expect(world.getCarState(car)!.speed).toBeLessThan(5); // px/s — parked
  });

  it('reports the live front-wheel angle in the car state', () => {
    world.build(gridFrom(['..........', '..........', '..........']));
    const car = ownerAt(1, 1);
    world.addCar(car, { length: 108, width: 58, angle: 0, tuning: DEFAULT_CAR_TUNING });
    expect(world.getCarState(car)!.steer).toBe(0);
    for (let i = 0; i < 30; i++) {
      world.driveCar(car, { throttle: 1, steer: 1, handbrake: false });
      world.step(DT);
    }
    expect(world.getCarState(car)!.steer).toBeGreaterThan(0.05);
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
