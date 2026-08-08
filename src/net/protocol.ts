/**
 * Wire protocol (multiplayer). Two encodings share one stream:
 *
 *  - The hot per-tick messages (hero state, van state, world snapshot) are
 *    hand-packed binary. They ride Steam's *unreliable* P2P channel, which caps a
 *    packet at 1200 bytes — the snapshot codec is sized so a worst-case world
 *    (4 heroes, 13 guards, van, corpses being dragged) stays a few hundred bytes.
 *  - Everything infrequent (handshake, requests, events, keyframes) is a JSON
 *    envelope on the *reliable* channel. Readability beats bytes at these rates.
 *
 * Every packet's first byte is a MsgType discriminant. All integers little-endian.
 *
 * Quantization: positions are 1/8px fixed point in a uint16 (world is 2560px wide,
 * 2560*8 = 20480 < 65535); velocities are px/tick in 8.8 fixed point (int16);
 * angles map [0, 2π) onto a uint16.
 */

export const PROTOCOL_VERSION = 1;

export const MsgType = {
  HeroState: 1,
  VanState: 2,
  Snapshot: 3,
  Ping: 4,
  Pong: 5,
  Json: 20,
} as const;

// --- quantization helpers ---------------------------------------------------

const POS_SCALE = 8;
const VEL_SCALE = 256;
const TWO_PI = Math.PI * 2;

function quantPos(v: number): number {
  const q = Math.round(v * POS_SCALE);
  return q < 0 ? 0 : q > 0xffff ? 0xffff : q;
}
function dequantPos(q: number): number {
  return q / POS_SCALE;
}
function quantVel(v: number): number {
  const q = Math.round(v * VEL_SCALE);
  return q < -0x8000 ? -0x8000 : q > 0x7fff ? 0x7fff : q;
}
function dequantVel(q: number): number {
  return q / VEL_SCALE;
}
function quantAngle(rad: number): number {
  let a = rad % TWO_PI;
  if (a < 0) a += TWO_PI;
  return Math.round((a / TWO_PI) * 0x10000) & 0xffff;
}
function dequantAngle(q: number): number {
  return (q / 0x10000) * TWO_PI;
}

// --- growable little-endian writer / reader ---------------------------------

export class ByteWriter {
  private buf: ArrayBuffer;
  private view: DataView;
  private len = 0;

  constructor(capacity = 512) {
    this.buf = new ArrayBuffer(capacity);
    this.view = new DataView(this.buf);
  }

  private ensure(extra: number): void {
    if (this.len + extra <= this.buf.byteLength) return;
    const grown = new ArrayBuffer(Math.max(this.buf.byteLength * 2, this.len + extra));
    new Uint8Array(grown).set(new Uint8Array(this.buf, 0, this.len));
    this.buf = grown;
    this.view = new DataView(this.buf);
  }

  u8(v: number): void {
    this.ensure(1);
    this.view.setUint8(this.len, v);
    this.len += 1;
  }
  u16(v: number): void {
    this.ensure(2);
    this.view.setUint16(this.len, v, true);
    this.len += 2;
  }
  i16(v: number): void {
    this.ensure(2);
    this.view.setInt16(this.len, v, true);
    this.len += 2;
  }
  u32(v: number): void {
    this.ensure(4);
    this.view.setUint32(this.len, v >>> 0, true);
    this.len += 4;
  }
  bytes(): Uint8Array {
    return new Uint8Array(this.buf, 0, this.len).slice();
  }
}

export class ByteReader {
  private view: DataView;
  private pos = 0;

  constructor(data: Uint8Array) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }

  u8(): number {
    const v = this.view.getUint8(this.pos);
    this.pos += 1;
    return v;
  }
  u16(): number {
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }
  i16(): number {
    const v = this.view.getInt16(this.pos, true);
    this.pos += 2;
    return v;
  }
  u32(): number {
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }
}

// --- hero state (client -> host, unreliable, ~30Hz) -------------------------

/** Bit positions for HeroStateMsg.flags / SnapshotHero.flags. */
export const HeroFlag = {
  Masked: 1 << 0,
  GunOut: 1 << 1,
  Carry: 1 << 2,
  Lockpicking: 1 << 3,
  PlantingBomb: 1 << 4,
  InOffLimits: 1 << 5,
  Dragging: 1 << 6,
  Downed: 1 << 7,
  InCar: 1 << 8,
  Sprinting: 1 << 9,
  Spyglass: 1 << 10,
  Alive: 1 << 11,
  Reloading: 1 << 12,
  Moving: 1 << 13,
} as const;

export interface HeroStateMsg {
  seq: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rad: number;
  flags: number;
  gunId: number;
}

export function encodeHeroState(m: HeroStateMsg): Uint8Array {
  const w = new ByteWriter(20);
  w.u8(MsgType.HeroState);
  w.u16(m.seq & 0xffff);
  w.u16(quantPos(m.x));
  w.u16(quantPos(m.y));
  w.i16(quantVel(m.vx));
  w.i16(quantVel(m.vy));
  w.u16(quantAngle(m.rad));
  w.u16(m.flags & 0xffff);
  w.u8(m.gunId & 0xff);
  return w.bytes();
}

function readHeroState(r: ByteReader): HeroStateMsg {
  return {
    seq: r.u16(),
    x: dequantPos(r.u16()),
    y: dequantPos(r.u16()),
    vx: dequantVel(r.i16()),
    vy: dequantVel(r.i16()),
    rad: dequantAngle(r.u16()),
    flags: r.u16(),
    gunId: r.u8(),
  };
}

// --- van state (driver -> host, unreliable, while driving) ------------------

export interface VanStateMsg {
  seq: number;
  x: number;
  y: number;
  angle: number;
  vx: number;
  vy: number;
  /** rad/s, 8.8 fixed point on the wire */
  angularVel: number;
  /** steering angle in rad, quantized as i8 * 0.02 */
  steer: number;
}

export function encodeVanState(m: VanStateMsg): Uint8Array {
  const w = new ByteWriter(20);
  w.u8(MsgType.VanState);
  w.u16(m.seq & 0xffff);
  w.u16(quantPos(m.x));
  w.u16(quantPos(m.y));
  w.u16(quantAngle(m.angle));
  w.i16(quantVel(m.vx));
  w.i16(quantVel(m.vy));
  w.i16(quantVel(m.angularVel));
  const steerQ = Math.max(-127, Math.min(127, Math.round(m.steer / 0.02)));
  w.u8(steerQ & 0xff);
  return w.bytes();
}

function readVanState(r: ByteReader): VanStateMsg {
  const out: VanStateMsg = {
    seq: r.u16(),
    x: dequantPos(r.u16()),
    y: dequantPos(r.u16()),
    angle: dequantAngle(r.u16()),
    vx: dequantVel(r.i16()),
    vy: dequantVel(r.i16()),
    angularVel: dequantVel(r.i16()),
    steer: 0,
  };
  const steerRaw = r.u8();
  out.steer = ((steerRaw << 24) >> 24) * 0.02; // sign-extend i8
  return out;
}

// --- snapshot (host -> clients, unreliable, ~20Hz) --------------------------

export const GuardFlag = {
  Alive: 1 << 0,
  Alarmed: 1 << 1,
  AlarmedPre: 1 << 2,
  Moving: 1 << 3,
  BeingChoked: 1 << 4,
  RiotShield: 1 << 5,
  Dodging: 1 << 6,
} as const;

export const CamFlag = {
  Alive: 1 << 0,
  Hacked: 1 << 1,
  Alarmed: 1 << 2,
} as const;

export const GlobalFlag = {
  BackupCalled: 1 << 0,
  CamerasDisabled: 1 << 1,
  BombPlanted: 1 << 2,
  HasWon: 1 << 3,
  LastSeenActive: 1 << 4,
} as const;

export interface SnapshotHero {
  playerId: number;
  x: number;
  y: number;
  rad: number;
  flags: number;
  gunId: number;
}

export interface SnapshotGuard {
  idx: number;
  x: number;
  y: number;
  rad: number;
  flags: number;
}

export interface SnapshotCam {
  idx: number;
  rad: number;
  flags: number;
}

export interface SnapshotVan {
  x: number;
  y: number;
  angle: number;
  vx: number;
  vy: number;
  angularVel: number;
  /** playerId of the driver, 255 = empty seat */
  driverId: number;
  /** bit i set = playerId i is aboard */
  aboardMask: number;
}

export interface SnapshotDragged {
  guardIdx: number;
  x: number;
  y: number;
  /** playerId doing the dragging, 255 = none */
  draggerId: number;
}

export interface Snapshot {
  tick: number;
  heroes: SnapshotHero[];
  guards: SnapshotGuard[];
  cams: SnapshotCam[];
  van: SnapshotVan | null;
  doorOpenBits: number;
  doorUnlockedBits: number;
  doorBrokenBits: number;
  dragged: SnapshotDragged[];
  globalFlags: number;
  lastSeenX: number;
  lastSeenY: number;
}

export function encodeSnapshot(s: Snapshot): Uint8Array {
  const w = new ByteWriter(512);
  w.u8(MsgType.Snapshot);
  w.u32(s.tick);

  w.u8(s.heroes.length);
  for (const h of s.heroes) {
    w.u8(h.playerId);
    w.u16(quantPos(h.x));
    w.u16(quantPos(h.y));
    w.u16(quantAngle(h.rad));
    w.u16(h.flags & 0xffff);
    w.u8(h.gunId & 0xff);
  }

  w.u8(s.guards.length);
  for (const g of s.guards) {
    w.u8(g.idx);
    w.u16(quantPos(g.x));
    w.u16(quantPos(g.y));
    w.u16(quantAngle(g.rad));
    w.u8(g.flags & 0xff);
  }

  w.u8(s.cams.length);
  for (const c of s.cams) {
    w.u8(c.idx);
    w.u16(quantAngle(c.rad));
    w.u8(c.flags & 0xff);
  }

  w.u8(s.van ? 1 : 0);
  if (s.van) {
    w.u16(quantPos(s.van.x));
    w.u16(quantPos(s.van.y));
    w.u16(quantAngle(s.van.angle));
    w.i16(quantVel(s.van.vx));
    w.i16(quantVel(s.van.vy));
    w.i16(quantVel(s.van.angularVel));
    w.u8(s.van.driverId & 0xff);
    w.u8(s.van.aboardMask & 0xff);
  }

  w.u32(s.doorOpenBits);
  w.u32(s.doorUnlockedBits);
  w.u32(s.doorBrokenBits);

  w.u8(s.dragged.length);
  for (const d of s.dragged) {
    w.u8(d.guardIdx);
    w.u16(quantPos(d.x));
    w.u16(quantPos(d.y));
    w.u8(d.draggerId & 0xff);
  }

  w.u8(s.globalFlags & 0xff);
  w.u16(quantPos(s.lastSeenX));
  w.u16(quantPos(s.lastSeenY));
  return w.bytes();
}

function readSnapshot(r: ByteReader): Snapshot {
  const s: Snapshot = {
    tick: r.u32(),
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
  };
  const nh = r.u8();
  for (let i = 0; i < nh; i++) {
    s.heroes.push({
      playerId: r.u8(),
      x: dequantPos(r.u16()),
      y: dequantPos(r.u16()),
      rad: dequantAngle(r.u16()),
      flags: r.u16(),
      gunId: r.u8(),
    });
  }
  const ng = r.u8();
  for (let i = 0; i < ng; i++) {
    s.guards.push({
      idx: r.u8(),
      x: dequantPos(r.u16()),
      y: dequantPos(r.u16()),
      rad: dequantAngle(r.u16()),
      flags: r.u8(),
    });
  }
  const nc = r.u8();
  for (let i = 0; i < nc; i++) {
    s.cams.push({ idx: r.u8(), rad: dequantAngle(r.u16()), flags: r.u8() });
  }
  if (r.u8() === 1) {
    s.van = {
      x: dequantPos(r.u16()),
      y: dequantPos(r.u16()),
      angle: dequantAngle(r.u16()),
      vx: dequantVel(r.i16()),
      vy: dequantVel(r.i16()),
      angularVel: dequantVel(r.i16()),
      driverId: r.u8(),
      aboardMask: r.u8(),
    };
  }
  s.doorOpenBits = r.u32();
  s.doorUnlockedBits = r.u32();
  s.doorBrokenBits = r.u32();
  const nd = r.u8();
  for (let i = 0; i < nd; i++) {
    s.dragged.push({
      guardIdx: r.u8(),
      x: dequantPos(r.u16()),
      y: dequantPos(r.u16()),
      draggerId: r.u8(),
    });
  }
  s.globalFlags = r.u8();
  s.lastSeenX = dequantPos(r.u16());
  s.lastSeenY = dequantPos(r.u16());
  return s;
}

// --- ping / pong ------------------------------------------------------------

export interface PingMsg {
  seq: number;
  /** sender's wall-clock ms, echoed back verbatim for RTT measurement */
  timeMs: number;
}

function encodePingLike(type: number, m: PingMsg): Uint8Array {
  const w = new ByteWriter(8);
  w.u8(type);
  w.u16(m.seq & 0xffff);
  w.u32(m.timeMs >>> 0);
  return w.bytes();
}

export function encodePing(m: PingMsg): Uint8Array {
  return encodePingLike(MsgType.Ping, m);
}
export function encodePong(m: PingMsg): Uint8Array {
  return encodePingLike(MsgType.Pong, m);
}

// --- JSON envelope (reliable channel) ---------------------------------------

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/** Reliable-channel message: `{ t: 'hello' | 'welcome' | 'req_*' | 'ev_*' | ..., ... }` */
export interface JsonMsg {
  t: string;
  [key: string]: unknown;
}

export function encodeJson(obj: JsonMsg): Uint8Array {
  const body = textEncoder.encode(JSON.stringify(obj));
  const out = new Uint8Array(body.length + 1);
  out[0] = MsgType.Json;
  out.set(body, 1);
  return out;
}

// --- top-level decode -------------------------------------------------------

export type Decoded =
  | { kind: 'heroState'; msg: HeroStateMsg }
  | { kind: 'vanState'; msg: VanStateMsg }
  | { kind: 'snapshot'; msg: Snapshot }
  | { kind: 'ping'; msg: PingMsg }
  | { kind: 'pong'; msg: PingMsg }
  | { kind: 'json'; msg: JsonMsg }
  | { kind: 'unknown'; type: number };

export function decode(data: Uint8Array): Decoded {
  if (data.length === 0) return { kind: 'unknown', type: -1 };
  const type = data[0];
  if (type === MsgType.Json) {
    try {
      const msg = JSON.parse(textDecoder.decode(data.subarray(1))) as JsonMsg;
      if (typeof msg !== 'object' || msg === null || typeof msg.t !== 'string') {
        return { kind: 'unknown', type };
      }
      return { kind: 'json', msg };
    } catch {
      return { kind: 'unknown', type };
    }
  }
  const r = new ByteReader(data.subarray(1));
  switch (type) {
    case MsgType.HeroState:
      return { kind: 'heroState', msg: readHeroState(r) };
    case MsgType.VanState:
      return { kind: 'vanState', msg: readVanState(r) };
    case MsgType.Snapshot:
      return { kind: 'snapshot', msg: readSnapshot(r) };
    case MsgType.Ping:
      return { kind: 'ping', msg: { seq: r.u16(), timeMs: r.u32() } };
    case MsgType.Pong:
      return { kind: 'pong', msg: { seq: r.u16(), timeMs: r.u32() } };
    default:
      return { kind: 'unknown', type };
  }
}
