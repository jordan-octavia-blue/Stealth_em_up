/**
 * Steam transport + lobby over the Golems-Electron-Build IPC bridge.
 *
 * Inside the Electron shell the renderer cannot touch steamworks.js directly
 * (contextIsolation): the template's preload exposes two objects instead —
 * `globalThis.electronSettings` (p2pSend / p2pCreateLobby / openInviteDialog /
 * getLobbyMembers / mySteamId / ...) and `globalThis.steamworks`
 * (subscribeToP2PMessages / subscribeToLobbyJoined / ...). This file adapts that
 * surface to the game's Transport/LobbyProvider interfaces.
 *
 * Peer ids are SteamID64 strings. Underneath sits Steam's classic P2P API:
 * unreliable packets <= 1200 bytes, reliable <= 1MB, NAT traversal by Steam.
 * The forked template's `p2pSend(peerId, bytes, reliable)` passes the
 * reliability flag through to sendP2PPacket; on an un-forked template the third
 * argument is ignored and everything rides the reliable channel — correct, just
 * not as smooth under loss.
 */

import type { LobbyInfo, LobbyProvider, MessageHandler, PeerId, Transport } from './transport';

/** The template's preload surface (the parts this file uses). */
interface ElectronSettingsBridge {
  mySteamId(): Promise<string> | string;
  mySteamName(): Promise<string> | string;
  p2pSend(peerId: string, data: Uint8Array, reliable?: boolean): void;
  p2pCreateLobby(): void;
  openInviteDialog(): void;
  leaveLobby(): void;
  getLobbyMembers(): Promise<Array<{ steamId64: string }> | string[]>;
}

interface SteamworksBridge {
  subscribeToP2PMessages(cb: (data: unknown, senderId: string) => void): void;
  subscribeToLobbyJoined(cb: (lobbyId: unknown) => void): void;
  subscribeToFriendJoinedLobby(cb: (payload: unknown) => void): void;
  subscribeToLobbyChanges?(cb: (payload: unknown) => void): void;
  subscribeToP2PConnectionLost?(cb: (steamId: string) => void): void;
}

export interface SteamBridges {
  settings: ElectronSettingsBridge;
  events: SteamworksBridge;
}

/** Null when not running inside the Electron/Steam shell. */
export function detectSteamBridges(): SteamBridges | null {
  const g = globalThis as Record<string, unknown>;
  const settings = g['electronSettings'] as ElectronSettingsBridge | undefined;
  const eventsBridge = g['steamworks'] as SteamworksBridge | undefined;
  if (!settings || !eventsBridge || typeof settings.p2pSend !== 'function') return null;
  return { settings, events: eventsBridge };
}

function toUint8(data: unknown): Uint8Array | null {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data as ArrayBufferView)) {
    const view = data as ArrayBufferView;
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }
  return null;
}

export class SteamTransport implements Transport {
  private handlers: MessageHandler[] = [];
  private goneHandlers: Array<(peer: PeerId) => void> = [];
  private closed = false;

  constructor(
    private bridges: SteamBridges,
    public readonly localId: PeerId,
  ) {
    bridges.events.subscribeToP2PMessages((data, senderId) => {
      if (this.closed) return;
      const bytes = toUint8(data);
      if (!bytes) return;
      for (const h of [...this.handlers]) h(String(senderId), bytes);
    });
    bridges.events.subscribeToP2PConnectionLost?.((steamId) => {
      if (this.closed) return;
      for (const h of [...this.goneHandlers]) h(String(steamId));
    });
  }

  send(to: PeerId, data: Uint8Array, reliable: boolean): void {
    if (this.closed) return;
    this.bridges.settings.p2pSend(to, data, reliable);
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
    this.closed = true;
  }
}

async function memberIds(bridge: ElectronSettingsBridge): Promise<PeerId[]> {
  try {
    const raw = await bridge.getLobbyMembers();
    if (!Array.isArray(raw)) return [];
    return raw.map((m) => (typeof m === 'string' ? m : String(m.steamId64)));
  } catch {
    return [];
  }
}

/**
 * Steam lobby, template-flavored: the shell keeps an always-joinable friends
 * lobby and handles invites/joins in the main process (`+connect_lobby`,
 * GameLobbyJoinRequested). From the game's side:
 *  - `createLobby()` asks the shell for a fresh lobby and resolves once the
 *    membership can be read;
 *  - remote joins surface through the shell's lobby events, re-read via
 *    getLobbyMembers() and fanned out through onLobbyUpdate;
 *  - a guest never calls joinLobby directly — the shell has already joined by
 *    the time the game learns about it — so `attachExistingLobby()` adopts it.
 */
export class SteamLobby implements LobbyProvider {
  private updateHandlers: Array<(info: LobbyInfo) => void> = [];
  private info: LobbyInfo | null = null;
  /** The shell tells us who owns the lobby only implicitly; the game layer sets it. */
  public ownerId: PeerId;

  constructor(
    private bridges: SteamBridges,
    public readonly localId: PeerId,
  ) {
    this.ownerId = localId;
    const refresh = () => void this.refreshMembers();
    bridges.events.subscribeToFriendJoinedLobby(refresh);
    bridges.events.subscribeToLobbyChanges?.(refresh);
  }

  async createLobby(_maxMembers: number): Promise<LobbyInfo> {
    this.bridges.settings.p2pCreateLobby();
    this.ownerId = this.localId;
    //membership may take a beat to be readable; poll briefly
    for (let i = 0; i < 20; i++) {
      const members = await memberIds(this.bridges.settings);
      if (members.includes(this.localId)) {
        this.info = { id: 'steam', ownerId: this.localId, members };
        this.emit();
        return this.info;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    //degenerate but non-fatal: solo lobby
    this.info = { id: 'steam', ownerId: this.localId, members: [this.localId] };
    this.emit();
    return this.info;
  }

  /** Guest path: the Electron shell already joined a friend's lobby. */
  async attachExistingLobby(ownerId: PeerId): Promise<LobbyInfo> {
    this.ownerId = ownerId;
    const members = await memberIds(this.bridges.settings);
    this.info = {
      id: 'steam',
      ownerId,
      members: members.length ? members : [ownerId, this.localId],
    };
    this.emit();
    return this.info;
  }

  joinLobby(_id: string): Promise<LobbyInfo> {
    return Promise.reject(
      new Error('Steam joins happen through invites/friends list, not by room id'),
    );
  }

  leaveLobby(): void {
    try {
      this.bridges.settings.leaveLobby();
    } catch {
      /* shell may already have left */
    }
    this.info = null;
  }

  onLobbyUpdate(handler: (info: LobbyInfo) => void): () => void {
    this.updateHandlers.push(handler);
    return () => {
      const i = this.updateHandlers.indexOf(handler);
      if (i !== -1) this.updateHandlers.splice(i, 1);
    };
  }

  openInviteDialog(): void {
    this.bridges.settings.openInviteDialog();
  }

  private async refreshMembers(): Promise<void> {
    if (!this.info) return;
    const members = await memberIds(this.bridges.settings);
    if (members.length) {
      this.info = { ...this.info, members };
      this.emit();
    }
  }

  private emit(): void {
    if (!this.info) return;
    for (const h of [...this.updateHandlers]) h(this.info);
  }
}
