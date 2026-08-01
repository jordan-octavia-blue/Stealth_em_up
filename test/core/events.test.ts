import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../src/core/events';

describe('EventBus', () => {
  it('delivers payloads to every subscriber of the event, in subscription order', () => {
    const bus = new EventBus();
    const order: string[] = [];
    bus.on('sound', (p) => order.push('a:' + p));
    bus.on('sound', (p) => order.push('b:' + p));
    bus.on('other', () => order.push('never'));
    bus.emit('sound', 'gunshot');
    expect(order).toEqual(['a:gunshot', 'b:gunshot']);
  });

  it('emit on an event with no subscribers is a no-op', () => {
    const bus = new EventBus();
    expect(() => bus.emit('nobody-home', 123)).not.toThrow();
  });

  it('off() and the unsubscribe function both stop delivery', () => {
    const bus = new EventBus();
    const viaOff = vi.fn();
    const viaReturn = vi.fn();
    bus.on('e', viaOff);
    const unsub = bus.on('e', viaReturn);
    bus.emit('e');
    bus.off('e', viaOff);
    unsub();
    bus.emit('e');
    expect(viaOff).toHaveBeenCalledTimes(1);
    expect(viaReturn).toHaveBeenCalledTimes(1);
  });

  it('a handler unsubscribing itself mid-emit does not skip the next handler', () => {
    const bus = new EventBus();
    const second = vi.fn();
    const unsub = bus.on('e', () => unsub());
    bus.on('e', second);
    bus.emit('e');
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('a handler subscribed during emit does not receive that same emit', () => {
    const bus = new EventBus();
    const late = vi.fn();
    bus.on('e', () => bus.on('e', late));
    bus.emit('e');
    expect(late).not.toHaveBeenCalled();
    bus.emit('e');
    expect(late).toHaveBeenCalledTimes(1);
  });

  it('same handler on two events only detaches from the one passed to off()', () => {
    const bus = new EventBus();
    const fn = vi.fn();
    bus.on('a', fn);
    bus.on('b', fn);
    bus.off('a', fn);
    bus.emit('a');
    bus.emit('b');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
