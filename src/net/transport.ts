/**
 * Transport abstraction. The netcode never talks to Steam directly — it sends
 * bytes to peer ids over a `Transport` and learns about lobby membership from a
 * `LobbyProvider`. Three implementations:
 *
 *  - `SteamTransport` / `SteamLobby` (src/net/steam.ts): the shipping path, over
 *    the Electron template's IPC bridge to steamworks.js classic P2P.
 *  - `LocalTransport` / `LocalLobby` (this file): BroadcastChannel between two
 *    browser tabs for development, with an artificial latency/jitter/loss
 *    simulator so netcode feel is testable without Steam.
 *  - `createMemoryHub` (this file): in-process pairs for Vitest.
 *
 * Semantics every implementation must honor (they mirror Steam classic P2P):
 *  - reliable sends are ordered per sender-pair and never dropped;
 *  - unreliable sends may drop and (across the reliable stream) reorder;
 *  - `send` to an unknown/gone peer is a silent no-op (failure surfaces through
 *    heartbeat timeouts at the session layer, plus best-effort `onPeerGone`).
 */

export type PeerId = string;

export type MessageHandler = (from: PeerId, data: Uint8Array) => void;

export interface Transport {
  readonly localId: PeerId;
  send(to: PeerId, data: Uint8Array, reliable: boolean): void;
  /** Subscribe to incoming packets. Returns unsubscribe. */
  onMessage(handler: MessageHandler): () => void;
  /** Best-effort transport-level "that peer is unreachable" signal. Returns unsubscribe. */
  onPeerGone(handler: (peer: PeerId) => void): () => void;
  close(): void;
}

export interface LobbyInfo {
  id: string;
  ownerId: PeerId;
  members: PeerId[];
}

export interface LobbyProvider {
  readonly localId: PeerId;
  createLobby(maxMembers: number): Promise<LobbyInfo>;
  joinLobby(id: string): Promise<LobbyInfo>;
  leaveLobby(): void;
  /** Fires on any membership/ownership change, including after create/join. Returns unsubscribe. */
  onLobbyUpdate(handler: (info: LobbyInfo) => void): () => void;
  /** Present when the platform has an invite UI (Steam overlay). */
  openInviteDialog?(): void;
}

export function randomPeerId(): PeerId {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && 'randomUUID' in c) return c.randomUUID();
  return `peer-${Math.floor(Math.random() * 0xffffffff).toString(16)}`;
}

// --- in-memory hub (tests) --------------------------------------------------

export interface MemoryHubOptions {
  /**
   * Deliver synchronously inside send() when true (default). Tests that want to
   * exercise async arrival can pass false to get microtask delivery.
   */
  synchronous?: boolean;
}

interface MemoryPeer {
  transport: MemoryTransport;
  handlers: MessageHandler[];
  goneHandlers: Array<(peer: PeerId) => void>;
}

class MemoryTransport implements Transport {
  constructor(
    private hub: MemoryHubImpl,
    public readonly localId: PeerId,
  ) {}

  send(to: PeerId, data: Uint8Array, reliable: boolean): void {
    this.hub.route(this.localId, to, data, reliable);
  }

  onMessage(handler: MessageHandler): () => void {
    const peer = this.hub.peers.get(this.localId);
    if (!peer) return () => {};
    peer.handlers.push(handler);
    return () => {
      const i = peer.handlers.indexOf(handler);
      if (i !== -1) peer.handlers.splice(i, 1);
    };
  }

  onPeerGone(handler: (peer: PeerId) => void): () => void {
    const peer = this.hub.peers.get(this.localId);
    if (!peer) return () => {};
    peer.goneHandlers.push(handler);
    return () => {
      const i = peer.goneHandlers.indexOf(handler);
      if (i !== -1) peer.goneHandlers.splice(i, 1);
    };
  }

  close(): void {
    this.hub.disconnect(this.localId);
  }
}

class MemoryHubImpl {
  peers = new Map<PeerId, MemoryPeer>();
  /** Unreliable sends are dropped while > 0 (tests dial packet loss on and off). */
  dropUnreliable = 0;

  constructor(private options: MemoryHubOptions) {}

  connect(id: PeerId): Transport {
    const transport = new MemoryTransport(this, id);
    this.peers.set(id, { transport, handlers: [], goneHandlers: [] });
    return transport;
  }

  disconnect(id: PeerId): void {
    if (!this.peers.delete(id)) return;
    for (const peer of this.peers.values()) {
      for (const h of [...peer.goneHandlers]) h(id);
    }
  }

  route(from: PeerId, to: PeerId, data: Uint8Array, reliable: boolean): void {
    if (!reliable && this.dropUnreliable > 0) {
      this.dropUnreliable--;
      return;
    }
    const target = this.peers.get(to);
    if (!target) return;
    const copy = data.slice();
    const deliver = () => {
      // Re-check: the peer may have closed between send and microtask delivery.
      if (this.peers.get(to) !== target) return;
      for (const h of [...target.handlers]) h(from, copy);
    };
    if (this.options.synchronous === false) queueMicrotask(deliver);
    else deliver();
  }
}

export interface MemoryHub {
  connect(id: PeerId): Transport;
  /** Drop the next `count` unreliable packets hub-wide. */
  dropNextUnreliable(count: number): void;
}

export function createMemoryHub(options: MemoryHubOptions = {}): MemoryHub {
  const hub = new MemoryHubImpl(options);
  return {
    connect: (id) => hub.connect(id),
    dropNextUnreliable: (count) => {
      hub.dropUnreliable += count;
    },
  };
}

// --- BroadcastChannel transport (two-tab dev) --------------------------------

export interface Impairment {
  /** One-way delay applied to every packet, ms. */
  latencyMs: number;
  /** Extra random delay [0, jitterMs) applied to unreliable packets only. */
  jitterMs: number;
  /** Probability [0,1] an unreliable packet is dropped. */
  loss: number;
}

interface WirePacket {
  k: 'pkt';
  from: PeerId;
  to: PeerId;
  reliable: boolean;
  data: Uint8Array;
}

interface WireBye {
  k: 'bye';
  from: PeerId;
}

type WireMsg = WirePacket | WireBye;

/**
 * Dev transport: every tab on the same `room` string sees each other via a
 * BroadcastChannel. Impairment is applied on the receive side, so one tab's
 * settings affect only what that tab experiences. Reliable packets get flat
 * latency and strict per-sender ordering (a chained delivery queue); unreliable
 * packets get latency + jitter and may drop — the same contract as Steam P2P.
 */
export class LocalTransport implements Transport {
  public readonly localId: PeerId;
  public impairment: Impairment = { latencyMs: 0, jitterMs: 0, loss: 0 };

  private channel: BroadcastChannel;
  private handlers: MessageHandler[] = [];
  private goneHandlers: Array<(peer: PeerId) => void> = [];
  /** Tail of the pending reliable-delivery chain per sender, for ordering. */
  private reliableTail = new Map<PeerId, Promise<void>>();
  private closed = false;

  constructor(room: string, localId: PeerId = randomPeerId()) {
    this.localId = localId;
    this.channel = new BroadcastChannel(`semup-net-${room}`);
    this.channel.onmessage = (ev: MessageEvent) => this.receive(ev.data as WireMsg);
  }

  send(to: PeerId, data: Uint8Array, reliable: boolean): void {
    if (this.closed) return;
    const msg: WirePacket = { k: 'pkt', from: this.localId, to, reliable, data };
    this.channel.postMessage(msg);
  }

  onMessage(handler: MessageHandler): () => void {
    this.handlers.push(handler);
    return () => {
      const i = this.handlers.indexOf(handler);
      if (i !== -1) this.handlers.splice(i, 1);
    };
  }

  onPeerGone(handler: (peer: PeerId) => void): () => void {
    this.goneHandlers.push(handler);
    return () => {
      const i = this.goneHandlers.indexOf(handler);
      if (i !== -1) this.goneHandlers.splice(i, 1);
    };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    const bye: WireBye = { k: 'bye', from: this.localId };
    this.channel.postMessage(bye);
    this.channel.close();
  }

  private receive(msg: WireMsg): void {
    if (this.closed) return;
    if (msg.k === 'bye') {
      for (const h of [...this.goneHandlers]) h(msg.from);
      return;
    }
    if (msg.to !== this.localId) return;
    const { latencyMs, jitterMs, loss } = this.impairment;
    if (!msg.reliable && loss > 0 && Math.random() < loss) return;

    const dispatch = () => {
      if (this.closed) return;
      for (const h of [...this.handlers]) h(msg.from, msg.data);
    };

    if (msg.reliable) {
      // Chain reliable deliveries per sender so latency never reorders them.
      const prev = this.reliableTail.get(msg.from) ?? Promise.resolve();
      const next = prev.then(
        () =>
          new Promise<void>((resolve) => {
            setTimeout(() => {
              dispatch();
              resolve();
            }, latencyMs);
          }),
      );
      this.reliableTail.set(msg.from, next);
    } else {
      const delay = latencyMs + (jitterMs > 0 ? Math.random() * jitterMs : 0);
      if (delay <= 0) dispatch();
      else setTimeout(dispatch, delay);
    }
  }
}

// --- BroadcastChannel lobby (two-tab dev) ------------------------------------

interface LobbyWireJoin {
  k: 'join';
  id: PeerId;
}
interface LobbyWireLeave {
  k: 'leave';
  id: PeerId;
}
interface LobbyWireAlive {
  k: 'alive';
  id: PeerId;
}
interface LobbyWireState {
  k: 'state';
  info: LobbyInfo;
}

type LobbyWire = LobbyWireJoin | LobbyWireLeave | LobbyWireAlive | LobbyWireState;

const LOBBY_BEACON_MS = 1000;
const LOBBY_MEMBER_TIMEOUT_MS = 4000;
const LOBBY_JOIN_TIMEOUT_MS = 3000;

/**
 * Dev lobby matching the Steam shape: the creator owns the authoritative member
 * list and beacons it; joiners announce themselves and wait to appear in the
 * beaconed state. Owner prunes members whose keepalives stop.
 */
export class LocalLobby implements LobbyProvider {
  public readonly localId: PeerId;

  private channel: BroadcastChannel;
  private info: LobbyInfo | null = null;
  private isOwner = false;
  private updateHandlers: Array<(info: LobbyInfo) => void> = [];
  private lastAlive = new Map<PeerId, number>();
  private beaconTimer: ReturnType<typeof setInterval> | null = null;

  constructor(room: string, localId: PeerId = randomPeerId()) {
    this.localId = localId;
    this.channel = new BroadcastChannel(`semup-lobby-${room}`);
    this.channel.onmessage = (ev: MessageEvent) => this.receive(ev.data as LobbyWire);
  }

  createLobby(_maxMembers: number): Promise<LobbyInfo> {
    this.isOwner = true;
    this.info = { id: this.localId, ownerId: this.localId, members: [this.localId] };
    this.beaconTimer = setInterval(() => this.ownerBeat(), LOBBY_BEACON_MS);
    this.emitUpdate();
    return Promise.resolve(this.info);
  }

  joinLobby(_id: string): Promise<LobbyInfo> {
    const join: LobbyWireJoin = { k: 'join', id: this.localId };
    this.channel.postMessage(join);
    this.beaconTimer = setInterval(() => {
      const alive: LobbyWireAlive = { k: 'alive', id: this.localId };
      this.channel.postMessage(alive);
    }, LOBBY_BEACON_MS);
    return new Promise<LobbyInfo>((resolve, reject) => {
      const timeout = setTimeout(() => {
        unsub();
        reject(new Error('No lobby answered — is a host tab open?'));
      }, LOBBY_JOIN_TIMEOUT_MS);
      const unsub = this.onLobbyUpdate((info) => {
        if (info.members.includes(this.localId)) {
          clearTimeout(timeout);
          unsub();
          resolve(info);
        }
      });
    });
  }

  leaveLobby(): void {
    if (this.beaconTimer !== null) {
      clearInterval(this.beaconTimer);
      this.beaconTimer = null;
    }
    const leave: LobbyWireLeave = { k: 'leave', id: this.localId };
    this.channel.postMessage(leave);
    this.info = null;
    this.isOwner = false;
  }

  onLobbyUpdate(handler: (info: LobbyInfo) => void): () => void {
    this.updateHandlers.push(handler);
    return () => {
      const i = this.updateHandlers.indexOf(handler);
      if (i !== -1) this.updateHandlers.splice(i, 1);
    };
  }

  close(): void {
    this.leaveLobby();
    this.channel.close();
  }

  private ownerBeat(): void {
    if (!this.isOwner || !this.info) return;
    const now = Date.now();
    const before = this.info.members.length;
    this.info.members = this.info.members.filter((m) => {
      if (m === this.localId) return true;
      const seen = this.lastAlive.get(m) ?? 0;
      return now - seen < LOBBY_MEMBER_TIMEOUT_MS;
    });
    if (this.info.members.length !== before) this.emitUpdate();
    const state: LobbyWireState = { k: 'state', info: this.info };
    this.channel.postMessage(state);
  }

  private receive(msg: LobbyWire): void {
    switch (msg.k) {
      case 'join':
        if (this.isOwner && this.info && !this.info.members.includes(msg.id)) {
          this.info.members.push(msg.id);
          this.lastAlive.set(msg.id, Date.now());
          this.emitUpdate();
          this.ownerBeat();
        }
        break;
      case 'alive':
        this.lastAlive.set(msg.id, Date.now());
        break;
      case 'leave':
        if (this.isOwner && this.info && this.info.members.includes(msg.id)) {
          this.info.members = this.info.members.filter((m) => m !== msg.id);
          this.emitUpdate();
          this.ownerBeat();
        }
        break;
      case 'state':
        if (!this.isOwner) {
          this.info = msg.info;
          this.emitUpdate();
        }
        break;
    }
  }

  private emitUpdate(): void {
    if (!this.info) return;
    for (const h of [...this.updateHandlers]) h(this.info);
  }
}
