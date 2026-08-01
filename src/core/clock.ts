/**
 * GameClock — pausable, restartable gameplay time (roadmap Phase 2).
 *
 * All gameplay delays go through this instead of raw `setTimeout`/`new Date()`.
 * The clock only advances when `update(dt)` is called, and `update` is only called
 * from the fixed-timestep gameloop — so pausing the game pauses every pending timer
 * for free, and `clear()` on restart kills the whole batch at once (the old code
 * looped over every window timeout id to get the same effect).
 *
 * Deliberately NOT wall-clock time: `now()` is milliseconds of *simulated* time since
 * the clock was created/cleared. Anything that should keep running while paused
 * (real-world UI, say) does not belong here.
 */

export type ClockCallback = () => void;

export interface ClockHandle {
  /** True once the timer has fired for the last time or been cancelled. */
  readonly done: boolean;
  cancel(): void;
}

interface Timer {
  /** Absolute clock time (ms) at which this timer next fires. */
  dueAt: number;
  /** Repeat interval in ms; 0 for one-shots. */
  intervalMs: number;
  callback: ClockCallback;
  cancelled: boolean;
}

class Handle implements ClockHandle {
  constructor(private timer: Timer) {}
  get done(): boolean {
    return this.timer.cancelled;
  }
  cancel(): void {
    this.timer.cancelled = true;
  }
}

export class GameClock {
  private timeMs = 0;
  private timers: Timer[] = [];

  /** Milliseconds of simulated (unpaused) time since creation or the last clear(). */
  now(): number {
    return this.timeMs;
  }

  /** Run `callback` once, `ms` from now in game time. Non-positive delays fire on the next update. */
  after(ms: number, callback: ClockCallback): ClockHandle {
    return this.add(this.timeMs + Math.max(0, ms), 0, callback);
  }

  /** Run `callback` every `ms` of game time, first firing `ms` from now. */
  every(ms: number, callback: ClockCallback): ClockHandle {
    if (ms <= 0) throw new Error('GameClock.every() needs a positive interval');
    return this.add(this.timeMs + ms, ms, callback);
  }

  /** Cancel every pending timer (used on game restart). */
  clear(): void {
    for (const timer of this.timers) timer.cancelled = true;
    this.timers = [];
  }

  /**
   * Advance game time by `dt` ms and fire everything that came due, in global due
   * order — repeating `every()` beats interleave correctly with one-shots when one
   * update spans several intervals. Callbacks may schedule new timers (they wait
   * for a later update), cancel other timers, or clear() the whole clock — all
   * safe mid-update.
   */
  update(dt: number): void {
    if (dt < 0) return;
    this.timeMs += dt;

    // Snapshot: timers scheduled by callbacks during this update must not fire in it
    // (a callback chaining `after(0, ...)` would otherwise loop forever in one tick).
    const snapshot = new Set(this.timers);

    // Pull the earliest due timer each round. Linear scan, but gameplay holds a
    // handful of timers at a time — correctness of ordering matters more here.
    for (;;) {
      let next: Timer | null = null;
      for (const t of this.timers) {
        if (t.cancelled || !snapshot.has(t) || t.dueAt > this.timeMs) continue;
        if (next === null || t.dueAt < next.dueAt) next = t;
      }
      if (next === null) break;
      if (next.intervalMs > 0) {
        next.dueAt += next.intervalMs; // one beat per elapsed interval, no drift
      } else {
        next.cancelled = true;
      }
      next.callback();
    }

    this.timers = this.timers.filter((t) => !t.cancelled);
  }

  /** Pending (not yet fired/cancelled) timer count — used by tests and debug overlays. */
  pendingCount(): number {
    return this.timers.filter((t) => !t.cancelled).length;
  }

  private add(dueAt: number, intervalMs: number, callback: ClockCallback): ClockHandle {
    const timer: Timer = { dueAt, intervalMs, callback, cancelled: false };
    this.timers.push(timer);
    return new Handle(timer);
  }
}

/** The game's clock. Ticked once per fixed step from gameloop(); cleared on restart. */
export const gameClock = new GameClock();
