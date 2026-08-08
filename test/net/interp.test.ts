import { describe, expect, it } from 'vitest';
import { InterpBuffer, lerp, lerpAngle } from '../../src/net/interp';

interface P {
  x: number;
}

describe('InterpBuffer', () => {
  it('brackets a render tick between two samples', () => {
    const buf = new InterpBuffer<P>();
    buf.push(100, { x: 0 });
    buf.push(103, { x: 30 });
    const span = buf.sample(101);
    expect(span).not.toBeNull();
    expect(span!.a.x).toBe(0);
    expect(span!.b.x).toBe(30);
    expect(span!.alpha).toBeCloseTo(1 / 3, 5);
    expect(lerp(span!.a.x, span!.b.x, span!.alpha)).toBeCloseTo(10, 5);
  });

  it('clamps before the oldest and after the newest sample (no extrapolation)', () => {
    const buf = new InterpBuffer<P>();
    buf.push(10, { x: 1 });
    buf.push(20, { x: 2 });
    expect(buf.sample(5)!.a.x).toBe(1);
    expect(buf.sample(5)!.alpha).toBe(0);
    expect(buf.sample(25)!.a.x).toBe(2);
    expect(buf.sample(25)!.alpha).toBe(0);
  });

  it('returns null only when empty', () => {
    const buf = new InterpBuffer<P>();
    expect(buf.sample(0)).toBeNull();
    buf.push(1, { x: 1 });
    expect(buf.sample(0)).not.toBeNull();
  });

  it('inserts out-of-order arrivals in place and replaces duplicate ticks', () => {
    const buf = new InterpBuffer<P>();
    buf.push(10, { x: 1 });
    buf.push(30, { x: 3 });
    buf.push(20, { x: 2 }); // late arrival
    const span = buf.sample(25);
    expect(span!.a.x).toBe(2);
    expect(span!.b.x).toBe(3);
    buf.push(20, { x: 22 }); // replacement
    const at20 = buf.sample(20)!;
    expect(lerp(at20.a.x, at20.b.x, at20.alpha)).toBe(22);
  });

  it('caps stored samples', () => {
    const buf = new InterpBuffer<P>();
    for (let i = 0; i < 100; i++) buf.push(i, { x: i });
    expect(buf.latestTick()).toBe(99);
    // oldest were evicted: sampling far in the past clamps to the retained window
    expect(buf.sample(0)!.a.x).toBeGreaterThan(0);
  });
});

describe('lerpAngle', () => {
  it('takes the short way across the ±π seam', () => {
    const a = Math.PI - 0.1;
    const b = -Math.PI + 0.1;
    const mid = lerpAngle(a, b, 0.5);
    // Short arc passes through π, not through 0.
    const wrapped = ((mid % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    expect(Math.abs(wrapped - Math.PI)).toBeLessThan(1e-6);
  });

  it('is plain lerp when the arc does not wrap', () => {
    expect(lerpAngle(0.2, 0.6, 0.5)).toBeCloseTo(0.4, 6);
  });
});
