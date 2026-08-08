/**
 * NetSession — membership, handshake, liveness. One instance per machine while
 * multiplayer is active. The session owns *who is connected* (roster, heartbeats,
 * timeouts, version check); it deliberately knows nothing about heists, heroes or
 * snapshots — game messages pass through untouched via `drainGameMessages()`, and
 * game lifecycle (lobby UI, loading, playing) lives in src/systems/mp.ts.
 *
 * Topology is a star: clients only ever talk to the host. The host relays
 * whatever the game layer asks it to (world snapshots already carry every
 * player's hero, so clients never need each other).
 *
 * No internal timers: `pump(nowMs)` is called every frame by the game (menu and
 * gameplay both), which keeps behavior deterministic under test.
 */

import type { PeerId, Transport } from './transport';
import { decode, encodeJson, encodePing, encodePong, PROTOCOL_VERSION } from './protocol';
import type { Decoded, JsonMsg } from './protocol';

export type Role = 'single' | 'host' | 'client';

export interface PlayerInfo {
  playerId: number;
  peerId: PeerId;
  name: string;
}

export interface GameMessage {
  from: PeerId;
  fromPlayerId: number;
  decoded: Decoded;
}

export interface SessionCallbacks {
  onRosterChanged?: (players: PlayerInfo[]) => void;
  /** A player (never the host) dropped: timed out, closed, or left. */
  onPlayerLeft?: (player: PlayerInfo, reason: 'timeout' | 'left') => void;
  /** Client only: the host is gone — the session is over. */
  onHostLost?: () => void;
  /** Client only: the host refused our hello (version mismatch, lobby full...). */
  onRejected?: (reason: string) => void;
}

export interface SessionOptions {
  transport: Transport;
  role: 'host' | 'client';
  hostPeerId: PeerId;
  localName: string;
  /** Build fingerprint; host rejects mismatches with a readable error. */
  appBuild: string;
  maxPlayers?: number;
  callbacks?: SessionCallbacks;
}

const HEARTBEAT_MS = 1000;
const HELLO_RETRY_MS = 1000;
const TIMEOUT_MS = 8000;
export const MAX_PLAYERS = 4;

interface PeerHealth {
  lastHeardAt: number;
  lastPingAt: number;
}

export class NetSession {
  public readonly role: 'host' | 'client';
  public readonly localPeerId: PeerId;
  public players: PlayerInfo[] = [];
  public localPlayerId = -1;
  /** Client's smoothed round-trip time to the host, ms. */
  public rttMs = 0;
  /** True once the client's hello was accepted (host: immediately true). */
  public joined = false;

  private transport: Transport;
  private hostPeerId: PeerId;
  private localName: string;
  private appBuild: string;
  private maxPlayers: number;
  private callbacks: SessionCallbacks;

  private inboxRaw: Array<{ from: PeerId; data: Uint8Array }> = [];
  private gameInbox: GameMessage[] = [];
  private health = new Map<PeerId, PeerHealth>();
  private lastHelloAt = -Infinity;
  private pingSeq = 0;
  private closed = false;
  private unsubscribes: Array<() => void> = [];

  constructor(options: SessionOptions) {
    this.transport = options.transport;
    this.role = options.role;
    this.localPeerId = options.transport.localId;
    this.hostPeerId = options.hostPeerId;
    this.localName = options.localName;
    this.appBuild = options.appBuild;
    this.maxPlayers = options.maxPlayers ?? MAX_PLAYERS;
    this.callbacks = options.callbacks ?? {};

    this.unsubscribes.push(
      this.transport.onMessage((from, data) => {
        this.inboxRaw.push({ from, data });
      }),
      this.transport.onPeerGone((peer) => this.handlePeerGone(peer)),
    );

    if (this.role === 'host') {
      this.joined = true;
      this.localPlayerId = 0;
      this.players = [{ playerId: 0, peerId: this.localPeerId, name: this.localName }];
    }
  }

  // --- game-layer API --------------------------------------------------------

  /** All non-control messages received since the last drain, in arrival order. */
  drainGameMessages(): GameMessage[] {
    const out = this.gameInbox;
    this.gameInbox = [];
    return out;
  }

  sendToHost(data: Uint8Array, reliable: boolean): void {
    if (this.role === 'client') this.transport.send(this.hostPeerId, data, reliable);
  }

  /** Host: send to every connected client (not itself). */
  broadcast(data: Uint8Array, reliable: boolean, exceptPeer?: PeerId): void {
    if (this.role !== 'host') return;
    for (const p of this.players) {
      if (p.peerId === this.localPeerId || p.peerId === exceptPeer) continue;
      this.transport.send(p.peerId, data, reliable);
    }
  }

  sendJsonToHost(msg: JsonMsg): void {
    this.sendToHost(encodeJson(msg), true);
  }

  broadcastJson(msg: JsonMsg, exceptPeer?: PeerId): void {
    this.broadcast(encodeJson(msg), true, exceptPeer);
  }

  /** Host: send a reliable JSON message to one player. */
  sendJsonTo(peerId: PeerId, msg: JsonMsg): void {
    if (this.role === 'host' && peerId !== this.localPeerId) {
      this.transport.send(peerId, encodeJson(msg), true);
    }
  }

  playerByPeer(peerId: PeerId): PlayerInfo | undefined {
    return this.players.find((p) => p.peerId === peerId);
  }

  playerById(playerId: number): PlayerInfo | undefined {
    return this.players.find((p) => p.playerId === playerId);
  }

  /** Deliberately leave: tell the other side, then shut down. */
  leave(): void {
    if (this.closed) return;
    if (this.role === 'client') this.sendJsonToHost({ t: 'bye' });
    else this.broadcastJson({ t: 'bye' });
    this.close();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const unsub of this.unsubscribes) unsub();
    this.unsubscribes = [];
  }

  // --- per-frame pump --------------------------------------------------------

  pump(nowMs: number): void {
    if (this.closed) return;

    const raw = this.inboxRaw;
    this.inboxRaw = [];
    for (const { from, data } of raw) {
      this.touch(from, nowMs);
      const decoded = decode(data);
      if (!this.handleControl(from, decoded, nowMs)) {
        const player = this.playerByPeer(from);
        // Game traffic from peers that never completed the handshake is dropped.
        if (player) {
          this.gameInbox.push({ from, fromPlayerId: player.playerId, decoded });
        }
      }
    }

    if (this.role === 'client') this.pumpClient(nowMs);
    else this.pumpHost(nowMs);
  }

  private pumpClient(nowMs: number): void {
    if (!this.joined) {
      if (nowMs - this.lastHelloAt >= HELLO_RETRY_MS) {
        this.lastHelloAt = nowMs;
        this.sendJsonToHost({
          t: 'hello',
          protocol: PROTOCOL_VERSION,
          build: this.appBuild,
          name: this.localName,
        });
      }
      return;
    }
    const health = this.mustHealth(this.hostPeerId, nowMs);
    if (nowMs - health.lastPingAt >= HEARTBEAT_MS) {
      health.lastPingAt = nowMs;
      this.transport.send(
        this.hostPeerId,
        encodePing({ seq: this.pingSeq++ & 0xffff, timeMs: nowMs >>> 0 }),
        false,
      );
    }
    if (nowMs - health.lastHeardAt > TIMEOUT_MS) {
      this.close();
      this.callbacks.onHostLost?.();
    }
  }

  private pumpHost(nowMs: number): void {
    for (const p of [...this.players]) {
      if (p.peerId === this.localPeerId) continue;
      const health = this.mustHealth(p.peerId, nowMs);
      if (nowMs - health.lastHeardAt > TIMEOUT_MS) {
        this.removePlayer(p, 'timeout');
      }
    }
  }

  // --- control messages ------------------------------------------------------

  /** Returns true when the message was a session-internal control message. */
  private handleControl(from: PeerId, decoded: Decoded, nowMs: number): boolean {
    if (decoded.kind === 'ping') {
      this.transport.send(from, encodePong(decoded.msg), false);
      return true;
    }
    if (decoded.kind === 'pong') {
      const rtt = (nowMs >>> 0) - decoded.msg.timeMs;
      if (rtt >= 0 && rtt < 60000) {
        this.rttMs = this.rttMs === 0 ? rtt : this.rttMs * 0.8 + rtt * 0.2;
      }
      return true;
    }
    if (decoded.kind !== 'json') return false;
    const msg = decoded.msg;
    switch (msg.t) {
      case 'hello':
        if (this.role === 'host') this.handleHello(from, msg);
        return true;
      case 'welcome':
        if (this.role === 'client' && from === this.hostPeerId) {
          this.joined = true;
          this.localPlayerId = msg.playerId as number;
          this.players = msg.roster as PlayerInfo[];
          this.callbacks.onRosterChanged?.(this.players);
        }
        return true;
      case 'reject':
        if (this.role === 'client' && from === this.hostPeerId) {
          this.close();
          this.callbacks.onRejected?.(String(msg.reason ?? 'rejected'));
        }
        return true;
      case 'roster':
        if (this.role === 'client' && from === this.hostPeerId) {
          const previous = this.players;
          this.players = msg.roster as PlayerInfo[];
          this.callbacks.onRosterChanged?.(this.players);
          for (const old of previous) {
            if (
              old.peerId !== this.localPeerId &&
              !this.players.some((p) => p.peerId === old.peerId)
            ) {
              this.callbacks.onPlayerLeft?.(old, 'left');
            }
          }
        }
        return true;
      case 'bye': {
        if (this.role === 'host') {
          const player = this.playerByPeer(from);
          if (player) this.removePlayer(player, 'left');
        } else if (from === this.hostPeerId) {
          this.close();
          this.callbacks.onHostLost?.();
        }
        return true;
      }
      default:
        return false;
    }
  }

  private handleHello(from: PeerId, msg: JsonMsg): void {
    if (msg.protocol !== PROTOCOL_VERSION || msg.build !== this.appBuild) {
      this.sendJsonTo(from, {
        t: 'reject',
        reason: `Version mismatch — host is on build "${this.appBuild}", you are on "${String(
          msg.build,
        )}". Update to the same version to play together.`,
      });
      return;
    }
    let player = this.playerByPeer(from);
    if (!player) {
      if (this.players.length >= this.maxPlayers) {
        this.sendJsonTo(from, { t: 'reject', reason: 'The lobby is full.' });
        return;
      }
      let id = 0;
      while (this.players.some((p) => p.playerId === id)) id++;
      player = { playerId: id, peerId: from, name: String(msg.name ?? `Player ${id + 1}`) };
      this.players.push(player);
      this.players.sort((a, b) => a.playerId - b.playerId);
    } else {
      player.name = String(msg.name ?? player.name);
    }
    // Welcome is idempotent — hello retries just get the current roster again.
    this.sendJsonTo(from, { t: 'welcome', playerId: player.playerId, roster: this.players });
    this.broadcastJson({ t: 'roster', roster: this.players }, from);
    this.callbacks.onRosterChanged?.(this.players);
  }

  private handlePeerGone(peer: PeerId): void {
    if (this.closed) return;
    if (this.role === 'client') {
      if (peer === this.hostPeerId) {
        this.close();
        this.callbacks.onHostLost?.();
      }
      return;
    }
    const player = this.playerByPeer(peer);
    if (player) this.removePlayer(player, 'left');
  }

  private removePlayer(player: PlayerInfo, reason: 'timeout' | 'left'): void {
    this.players = this.players.filter((p) => p.peerId !== player.peerId);
    this.health.delete(player.peerId);
    this.broadcastJson({ t: 'roster', roster: this.players });
    this.callbacks.onRosterChanged?.(this.players);
    this.callbacks.onPlayerLeft?.(player, reason);
  }

  private touch(peer: PeerId, nowMs: number): void {
    this.mustHealth(peer, nowMs).lastHeardAt = nowMs;
  }

  private mustHealth(peer: PeerId, nowMs: number): PeerHealth {
    let h = this.health.get(peer);
    if (!h) {
      h = { lastHeardAt: nowMs, lastPingAt: -Infinity };
      this.health.set(peer, h);
    }
    return h;
  }
}
