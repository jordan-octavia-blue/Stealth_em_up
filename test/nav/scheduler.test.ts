import { describe, expect, it, vi } from 'vitest';
import { PathPriority, PathScheduler, PathSolver } from '../../src/nav/scheduler';

const ORIGIN = { x: 0, y: 0 };

/** A solver that records what it was asked and always succeeds. */
function recordingSolver(log: unknown[]): PathSolver {
  return (request) => {
    log.push(request.owner);
    return [{ x: request.to.x, y: request.to.y }];
  };
}

describe('PathScheduler budget', () => {
  it('runs at most maxSearches per update', () => {
    const log: unknown[] = [];
    const scheduler = new PathScheduler(recordingSolver(log), { maxSearches: 4, now: () => 0 });
    for (let i = 0; i < 10; i++) {
      scheduler.request({ owner: `guard${i}`, from: ORIGIN, to: { x: i, y: 0 } });
    }
    expect(scheduler.update().searches).toBe(4);
    expect(log.length).toBe(4);
    expect(scheduler.queued).toBe(6);

    scheduler.update();
    expect(log.length).toBe(8);
    scheduler.update();
    expect(log.length).toBe(10);
    expect(scheduler.queued).toBe(0);
  });

  it('stops when the time ceiling is hit', () => {
    const log: unknown[] = [];
    let clock = 0;
    // every search "takes" 1ms against a 2ms ceiling
    const scheduler = new PathScheduler(
      (request) => {
        clock += 1;
        return recordingSolver(log)(request);
      },
      { maxSearches: 10, maxMillis: 2, now: () => clock },
    );
    for (let i = 0; i < 10; i++) {
      scheduler.request({ owner: `guard${i}`, from: ORIGIN, to: ORIGIN });
    }
    expect(scheduler.update().searches).toBe(2);
  });

  it('always runs one search even when the ceiling is already blown', () => {
    let clock = 0;
    const scheduler = new PathScheduler(
      () => {
        clock += 100;
        return [ORIGIN];
      },
      { maxSearches: 4, maxMillis: 0.5, now: () => clock },
    );
    scheduler.request({ owner: 'a', from: ORIGIN, to: ORIGIN });
    scheduler.request({ owner: 'b', from: ORIGIN, to: ORIGIN });
    expect(scheduler.update().searches).toBe(1);
    expect(scheduler.queued).toBe(1);
  });
});

describe('PathScheduler priority', () => {
  it('serves combat before investigate before patrol', () => {
    const log: unknown[] = [];
    const scheduler = new PathScheduler(recordingSolver(log), { maxSearches: 3, now: () => 0 });
    scheduler.request({ owner: 'patrol', from: ORIGIN, to: ORIGIN, priority: PathPriority.Patrol });
    scheduler.request({
      owner: 'combat',
      from: ORIGIN,
      to: ORIGIN,
      priority: PathPriority.Combat,
    });
    scheduler.request({
      owner: 'investigate',
      from: ORIGIN,
      to: ORIGIN,
      priority: PathPriority.Investigate,
    });
    scheduler.update();
    expect(log).toEqual(['combat', 'investigate', 'patrol']);
  });

  it('keeps arrival order within one priority', () => {
    const log: unknown[] = [];
    const scheduler = new PathScheduler(recordingSolver(log), { maxSearches: 3, now: () => 0 });
    scheduler.request({ owner: 'first', from: ORIGIN, to: ORIGIN });
    scheduler.request({ owner: 'second', from: ORIGIN, to: ORIGIN });
    scheduler.request({ owner: 'third', from: ORIGIN, to: ORIGIN });
    scheduler.update();
    expect(log).toEqual(['first', 'second', 'third']);
  });
});

describe('PathScheduler coalescing', () => {
  it('replaces an owner pending request instead of queueing behind it', () => {
    const log: unknown[] = [];
    const scheduler = new PathScheduler(
      (request) => {
        log.push(request.to.x);
        return [request.to];
      },
      { maxSearches: 10, now: () => 0 },
    );
    const first = scheduler.request({ owner: 'guard', from: ORIGIN, to: { x: 1, y: 0 } });
    const second = scheduler.request({ owner: 'guard', from: ORIGIN, to: { x: 2, y: 0 } });
    expect(first.state).toBe('cancelled');
    expect(second.state).toBe('pending');
    expect(scheduler.queued).toBe(1);

    scheduler.update();
    expect(log).toEqual([2]);
    expect(second.state).toBe('ready');
  });

  it('reports whether an owner is waiting', () => {
    const scheduler = new PathScheduler(() => [ORIGIN], { now: () => 0 });
    expect(scheduler.hasPending('guard')).toBe(false);
    scheduler.request({ owner: 'guard', from: ORIGIN, to: ORIGIN });
    expect(scheduler.hasPending('guard')).toBe(true);
    scheduler.update();
    expect(scheduler.hasPending('guard')).toBe(false);
  });

  it('never runs a cancelled request', () => {
    const solve = vi.fn(() => [ORIGIN]);
    const scheduler = new PathScheduler(solve, { now: () => 0 });
    scheduler.request({ owner: 'guard', from: ORIGIN, to: ORIGIN });
    scheduler.cancel('guard');
    scheduler.update();
    expect(solve).not.toHaveBeenCalled();
  });

  it('drops everything on clear()', () => {
    const solve = vi.fn(() => [ORIGIN]);
    const scheduler = new PathScheduler(solve, { now: () => 0 });
    const handle = scheduler.request({ owner: 'guard', from: ORIGIN, to: ORIGIN });
    scheduler.clear();
    scheduler.update();
    expect(handle.state).toBe('cancelled');
    expect(solve).not.toHaveBeenCalled();
  });
});

describe('PathHandle', () => {
  it('delivers the path through onReady', () => {
    const scheduler = new PathScheduler(() => [{ x: 10, y: 20 }], { now: () => 0 });
    const onReady = vi.fn();
    const handle = scheduler.request({ owner: 'guard', from: ORIGIN, to: ORIGIN, onReady });
    expect(handle.pending).toBe(true);
    expect(handle.path).toBeNull();

    scheduler.update();
    expect(handle.state).toBe('ready');
    expect(handle.path).toEqual([{ x: 10, y: 20 }]);
    expect(onReady).toHaveBeenCalledWith([{ x: 10, y: 20 }]);
  });

  it('reports failure when no path exists', () => {
    const onFail = vi.fn();
    const onReady = vi.fn();
    const scheduler = new PathScheduler(() => null, { now: () => 0 });
    const handle = scheduler.request({ owner: 'guard', from: ORIGIN, to: ORIGIN, onReady, onFail });
    scheduler.update();
    expect(handle.state).toBe('failed');
    expect(onFail).toHaveBeenCalledOnce();
    expect(onReady).not.toHaveBeenCalled();
  });

  it('treats an empty path as a failure', () => {
    const onFail = vi.fn();
    const scheduler = new PathScheduler(() => [], { now: () => 0 });
    scheduler.request({ owner: 'guard', from: ORIGIN, to: ORIGIN, onFail });
    scheduler.update();
    expect(onFail).toHaveBeenCalledOnce();
  });
});
