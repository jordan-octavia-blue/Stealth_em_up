import { describe, expect, it } from 'vitest';
import {
  decode,
  encodeHeroState,
  encodeJson,
  encodePing,
  encodePong,
  encodeSnapshot,
  encodeVanState,
  GuardFlag,
  HeroFlag,
  MsgType,
} from '../../src/net/protocol';
import type { HeroStateMsg, Snapshot } from '../../src/net/protocol';

const POS_EPS = 1 / 8 / 2 + 1e-9; // half a quantization step
const VEL_EPS = 1 / 256 / 2 + 1e-9;
const ANGLE_EPS = (Math.PI * 2) / 0x10000 / 2 + 1e-9;

describe('hero state codec', () => {
  it('round-trips within quantization error', () => {
    const msg: HeroStateMsg = {
      seq: 4711,
      x: 1234.56,
      y: 2555.9,
      vx: -3.21,
      vy: 7.99,
      rad: -2.5, // negative angles must wrap, not clamp
      flags: HeroFlag.Masked | HeroFlag.Carry | HeroFlag.Downed | HeroFlag.Alive,
      gunId: 3,
    };
    const decoded = decode(encodeHeroState(msg));
    if (decoded.kind !== 'heroState') throw new Error(`wrong kind ${decoded.kind}`);
    const out = decoded.msg;
    expect(out.seq).toBe(4711);
    expect(out.x).toBeCloseTo(msg.x, 0.5);
    expect(Math.abs(out.x - msg.x)).toBeLessThanOrEqual(POS_EPS);
    expect(Math.abs(out.y - msg.y)).toBeLessThanOrEqual(POS_EPS);
    expect(Math.abs(out.vx - msg.vx)).toBeLessThanOrEqual(VEL_EPS);
    expect(Math.abs(out.vy - msg.vy)).toBeLessThanOrEqual(VEL_EPS);
    const wrapped = ((msg.rad % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    expect(Math.abs(out.rad - wrapped)).toBeLessThanOrEqual(ANGLE_EPS);
    expect(out.flags).toBe(msg.flags);
    expect(out.gunId).toBe(3);
  });

  it('clamps out-of-world positions instead of wrapping', () => {
    const decoded = decode(
      encodeHeroState({ seq: 0, x: -50, y: 99999, vx: 0, vy: 0, rad: 0, flags: 0, gunId: 0 }),
    );
    if (decoded.kind !== 'heroState') throw new Error('wrong kind');
    expect(decoded.msg.x).toBe(0);
    expect(decoded.msg.y).toBeCloseTo(0xffff / 8, 3);
  });
});

describe('van state codec', () => {
  it('round-trips including negative steer and angular velocity', () => {
    const decoded = decode(
      encodeVanState({
        seq: 9,
        x: 320.5,
        y: 640.25,
        angle: Math.PI / 3,
        vx: -12.5,
        vy: 4.75,
        angularVel: -1.5,
        steer: -0.44,
      }),
    );
    if (decoded.kind !== 'vanState') throw new Error('wrong kind');
    const v = decoded.msg;
    expect(v.seq).toBe(9);
    expect(Math.abs(v.x - 320.5)).toBeLessThanOrEqual(POS_EPS);
    expect(Math.abs(v.vx - -12.5)).toBeLessThanOrEqual(VEL_EPS);
    expect(Math.abs(v.angularVel - -1.5)).toBeLessThanOrEqual(VEL_EPS);
    expect(v.steer).toBeCloseTo(-0.44, 2);
  });
});

describe('snapshot codec', () => {
  function worstCaseSnapshot(): Snapshot {
    return {
      tick: 123456,
      heroes: Array.from({ length: 4 }, (_, i) => ({
        playerId: i,
        x: 100 + i * 3.125,
        y: 200 + i,
        rad: i * 1.1,
        flags: HeroFlag.Alive | (i % 2 ? HeroFlag.Masked : 0),
        gunId: i,
      })),
      guards: Array.from({ length: 13 }, (_, i) => ({
        idx: i,
        x: 50 * i + 0.5,
        y: 60 * i,
        rad: -i,
        flags: GuardFlag.Alive | (i % 3 === 0 ? GuardFlag.Alarmed : 0),
      })),
      cams: [
        { idx: 0, rad: 1.2, flags: 1 },
        { idx: 1, rad: 4.5, flags: 3 },
      ],
      van: {
        x: 2000,
        y: 2400.125,
        angle: 2.2,
        vx: 8,
        vy: -3,
        angularVel: 0.25,
        driverId: 2,
        aboardMask: 0b0110,
      },
      doorOpenBits: 0b1010101010,
      doorUnlockedBits: 0b1111111111,
      doorBrokenBits: 0b1,
      dragged: Array.from({ length: 15 }, (_, i) => ({
        guardIdx: i,
        x: i * 10,
        y: i * 11,
        draggerId: i % 4,
      })),
      globalFlags: 0b10110,
      lastSeenX: 512.5,
      lastSeenY: 1024.25,
    };
  }

  it('round-trips a worst-case world', () => {
    const snap = worstCaseSnapshot();
    const decoded = decode(encodeSnapshot(snap));
    if (decoded.kind !== 'snapshot') throw new Error('wrong kind');
    const out = decoded.msg;
    expect(out.tick).toBe(123456);
    expect(out.heroes).toHaveLength(4);
    expect(out.guards).toHaveLength(13);
    expect(out.cams).toHaveLength(2);
    expect(out.dragged).toHaveLength(15);
    expect(out.van?.driverId).toBe(2);
    expect(out.van?.aboardMask).toBe(0b0110);
    expect(out.doorOpenBits).toBe(0b1010101010);
    expect(out.globalFlags).toBe(0b10110);
    expect(Math.abs(out.heroes[3].x - snap.heroes[3].x)).toBeLessThanOrEqual(POS_EPS);
    expect(Math.abs(out.guards[7].y - snap.guards[7].y)).toBeLessThanOrEqual(POS_EPS);
    expect(Math.abs(out.lastSeenY - snap.lastSeenY)).toBeLessThanOrEqual(POS_EPS);
  });

  it('worst case fits Steam unreliable packet budget with headroom', () => {
    const bytes = encodeSnapshot(worstCaseSnapshot());
    expect(bytes.length).toBeLessThan(600); // hard Steam cap is 1200
  });

  it('handles an empty world (pre-spawn)', () => {
    const decoded = decode(
      encodeSnapshot({
        tick: 0,
        heroes: [],
        guards: [],
        cams: [],
        van: null,
        doorOpenBits: 0,
        doorUnlockedBits: 0,
        doorBrokenBits: 0,
        dragged: [],
        globalFlags: 0,
        lastSeenX: 0,
        lastSeenY: 0,
      }),
    );
    if (decoded.kind !== 'snapshot') throw new Error('wrong kind');
    expect(decoded.msg.van).toBeNull();
    expect(decoded.msg.heroes).toHaveLength(0);
  });
});

describe('json envelope', () => {
  it('round-trips nested payloads and unicode', () => {
    const decoded = decode(
      encodeJson({ t: 'ev_test', name: 'Jörg 🎭', nested: { a: [1, 2, 3], b: null } }),
    );
    if (decoded.kind !== 'json') throw new Error('wrong kind');
    expect(decoded.msg.t).toBe('ev_test');
    expect(decoded.msg.name).toBe('Jörg 🎭');
    expect(decoded.msg.nested).toEqual({ a: [1, 2, 3], b: null });
  });

  it('rejects malformed json as unknown instead of throwing', () => {
    const bad = new Uint8Array([MsgType.Json, 0x7b, 0x22]); // truncated "{"
    expect(decode(bad).kind).toBe('unknown');
  });
});

describe('ping/pong', () => {
  it('round-trips and preserves the echoed timestamp', () => {
    const ping = decode(encodePing({ seq: 77, timeMs: 123456789 }));
    if (ping.kind !== 'ping') throw new Error('wrong kind');
    expect(ping.msg.seq).toBe(77);
    expect(ping.msg.timeMs).toBe(123456789);
    const pong = decode(encodePong(ping.msg));
    expect(pong.kind).toBe('pong');
  });
});

describe('decode robustness', () => {
  it('unknown type bytes and empty packets are reported, not thrown', () => {
    expect(decode(new Uint8Array([250, 1, 2, 3])).kind).toBe('unknown');
    expect(decode(new Uint8Array([])).kind).toBe('unknown');
  });
});
