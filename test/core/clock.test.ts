import { describe, expect, it, vi } from 'vitest';
import { GameClock } from '../../src/core/clock';

describe('GameClock.now', () => {
  it('starts at zero and advances only with update()', () => {
    const clock = new GameClock();
    expect(clock.now()).toBe(0);
    clock.update(16);
    clock.update(16);
    expect(clock.now()).toBe(32);
  });

  it('ignores negative dt', () => {
    const clock = new GameClock();
    clock.update(100);
    clock.update(-50);
    expect(clock.now()).toBe(100);
  });
});

describe('GameClock.after', () => {
  it('fires once when the delay has elapsed, not before', () => {
    const clock = new GameClock();
    const fn = vi.fn();
    clock.after(100, fn);
    clock.update(99);
    expect(fn).not.toHaveBeenCalled();
    clock.update(1);
    expect(fn).toHaveBeenCalledTimes(1);
    clock.update(1000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('is pause-safe: no update, no firing, and the remaining delay survives the gap', () => {
    const clock = new GameClock();
    const fn = vi.fn();
    clock.after(100, fn);
    clock.update(60);
    // ...game paused here: gameloop stops calling update(), wall time passes...
    expect(fn).not.toHaveBeenCalled();
    clock.update(39);
    expect(fn).not.toHaveBeenCalled();
    clock.update(1); // resumes exactly where it left off
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('fires non-positive delays on the next update', () => {
    const clock = new GameClock();
    const fn = vi.fn();
    clock.after(0, fn);
    clock.after(-5, fn);
    expect(fn).not.toHaveBeenCalled();
    clock.update(0);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('fires timers in due order within one update', () => {
    const clock = new GameClock();
    const order: string[] = [];
    clock.after(200, () => order.push('b'));
    clock.after(100, () => order.push('a'));
    clock.after(300, () => order.push('c'));
    clock.update(1000);
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('supports the nested-timeout pattern (a callback scheduling another after)', () => {
    // sprite_guard's reaction: after(500) -> becomeAlarmed, then after(2000) -> alert all.
    const clock = new GameClock();
    const events: string[] = [];
    clock.after(500, () => {
      events.push('alarmed');
      clock.after(2000, () => events.push('alert-others'));
    });
    clock.update(500);
    expect(events).toEqual(['alarmed']);
    clock.update(1999);
    expect(events).toEqual(['alarmed']);
    clock.update(1);
    expect(events).toEqual(['alarmed', 'alert-others']);
  });

  it('does not fire a timer scheduled during the update it was scheduled in, even at 0 delay', () => {
    const clock = new GameClock();
    let chained = 0;
    clock.after(0, function reschedule() {
      chained++;
      clock.after(0, reschedule);
    });
    clock.update(10);
    expect(chained).toBe(1); // one per update, not an infinite loop inside one tick
    clock.update(10);
    expect(chained).toBe(2);
  });
});

describe('GameClock.every', () => {
  it('fires once per interval, catching up if one update spans several', () => {
    const clock = new GameClock();
    const fn = vi.fn();
    clock.every(100, fn);
    clock.update(99);
    expect(fn).not.toHaveBeenCalled();
    clock.update(1);
    expect(fn).toHaveBeenCalledTimes(1);
    clock.update(350); // covers 200, 300, 400
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it('does not drift: beats stay anchored to the schedule, not the update grid', () => {
    const clock = new GameClock();
    const times: number[] = [];
    clock.every(100, () => times.push(clock.now()));
    for (let i = 0; i < 25; i++) clock.update(16);
    // 25 * 16 = 400ms -> 4 beats, even though 16 never divides 100
    expect(times.length).toBe(4);
  });

  it('rejects non-positive intervals', () => {
    const clock = new GameClock();
    expect(() => clock.every(0, () => {})).toThrow();
    expect(() => clock.every(-10, () => {})).toThrow();
  });

  it('stops when cancelled from inside its own callback', () => {
    const clock = new GameClock();
    let count = 0;
    const handle = clock.every(10, () => {
      count++;
      if (count === 3) handle.cancel();
    });
    clock.update(1000);
    expect(count).toBe(3);
    clock.update(1000);
    expect(count).toBe(3);
  });
});

describe('cancel and clear', () => {
  it('cancel() prevents firing and marks the handle done', () => {
    const clock = new GameClock();
    const fn = vi.fn();
    const handle = clock.after(100, fn);
    expect(handle.done).toBe(false);
    handle.cancel();
    clock.update(1000);
    expect(fn).not.toHaveBeenCalled();
    expect(handle.done).toBe(true);
  });

  it('a callback can cancel a not-yet-fired timer in the same update', () => {
    const clock = new GameClock();
    const fn = vi.fn();
    const later = clock.after(200, fn);
    clock.after(100, () => later.cancel());
    clock.update(1000);
    expect(fn).not.toHaveBeenCalled();
  });

  it('clear() cancels everything, including from inside a callback (restart mid-update)', () => {
    const clock = new GameClock();
    const fn = vi.fn();
    clock.after(100, () => clock.clear()); // clearStage() can run from a clock callback
    clock.after(200, fn);
    clock.every(50, fn);
    clock.update(1000);
    // the every(50) at t=50 fires before the clear at t=100; nothing after survives
    expect(fn).toHaveBeenCalledTimes(1);
    expect(clock.pendingCount()).toBe(0);
  });

  it('handles are one-shot done after firing', () => {
    const clock = new GameClock();
    const handle = clock.after(10, () => {});
    clock.update(10);
    expect(handle.done).toBe(true);
    expect(clock.pendingCount()).toBe(0);
  });
});
