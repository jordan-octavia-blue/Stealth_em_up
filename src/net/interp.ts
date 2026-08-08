/**
 * Interpolation buffers. Clients render remote entities (guards, teammates, the
 * van) slightly in the past: snapshots arrive ~20Hz over an unreliable channel,
 * and drawing at `newest - delay` means a lost or late packet just narrows the
 * cushion instead of freezing anyone on screen.
 *
 * The buffer stores timestamped states per entity; the caller picks the render
 * tick and lerps the two bracketing samples with the returned alpha.
 */

export interface InterpSpan<T> {
  a: T;
  b: T;
  /** 0 at `a`, 1 at `b`. */
  alpha: number;
}

const MAX_SAMPLES = 32;

export class InterpBuffer<T> {
  private ticks: number[] = [];
  private states: T[] = [];

  /** Insert a sample. Out-of-order arrivals are inserted in place; duplicate ticks replace. */
  push(tick: number, state: T): void {
    const n = this.ticks.length;
    if (n === 0 || tick > this.ticks[n - 1]) {
      this.ticks.push(tick);
      this.states.push(state);
    } else {
      let i = n - 1;
      while (i >= 0 && this.ticks[i] > tick) i--;
      if (i >= 0 && this.ticks[i] === tick) {
        this.states[i] = state;
      } else {
        this.ticks.splice(i + 1, 0, tick);
        this.states.splice(i + 1, 0, state);
      }
    }
    if (this.ticks.length > MAX_SAMPLES) {
      this.ticks.shift();
      this.states.shift();
    }
  }

  latestTick(): number | null {
    return this.ticks.length ? this.ticks[this.ticks.length - 1] : null;
  }

  latest(): T | null {
    return this.states.length ? this.states[this.states.length - 1] : null;
  }

  /**
   * Bracket `renderTick`. Before the oldest sample → clamp to oldest; past the
   * newest → clamp to newest (no extrapolation: a briefly frozen guard beats one
   * that overshoots through a wall). Null only when empty.
   */
  sample(renderTick: number): InterpSpan<T> | null {
    const n = this.ticks.length;
    if (n === 0) return null;
    if (renderTick <= this.ticks[0]) {
      return { a: this.states[0], b: this.states[0], alpha: 0 };
    }
    if (renderTick >= this.ticks[n - 1]) {
      return { a: this.states[n - 1], b: this.states[n - 1], alpha: 0 };
    }
    let i = 1;
    while (this.ticks[i] < renderTick) i++;
    const t0 = this.ticks[i - 1];
    const t1 = this.ticks[i];
    return {
      a: this.states[i - 1],
      b: this.states[i],
      alpha: (renderTick - t0) / (t1 - t0),
    };
  }

  clear(): void {
    this.ticks.length = 0;
    this.states.length = 0;
  }
}

export function lerp(a: number, b: number, alpha: number): number {
  return a + (b - a) * alpha;
}

const TWO_PI = Math.PI * 2;

/** Shortest-arc angle interpolation (so a guard turning through ±π doesn't spin the long way). */
export function lerpAngle(a: number, b: number, alpha: number): number {
  let diff = (b - a) % TWO_PI;
  if (diff > Math.PI) diff -= TWO_PI;
  if (diff < -Math.PI) diff += TWO_PI;
  return a + diff * alpha;
}
