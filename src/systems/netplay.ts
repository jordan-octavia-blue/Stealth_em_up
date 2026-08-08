/**
 * Netplay — the game-facing half of multiplayer. Everything here reads/writes the
 * legacy window globals (heroes, guards, grid, van...), which is exactly why it
 * lives in src/systems and not in the pure src/net layer.
 *
 * Responsibilities:
 *  - session lifecycle: create/join a lobby, handshake, roster, start the mission
 *    on every machine, READY/GO gate (window.pause) so nobody's clock starts early;
 *  - host: apply each client's streamed hero state onto that player's replica hero
 *    (teleporting its physics body so guards can see, block and shoot it), and
 *    broadcast world snapshots ~20×/s plus a reliable keyframe every ~2s;
 *  - client: stream the local hero ~30×/s, interpolate guards / teammates / the
 *    van ~130ms in the past, and apply door/camera/global state.
 *
 * Transport today is the BroadcastChannel dev pair (?net=host / ?net=join&room=x
 * in two browser tabs, with ?netlag/?netjitter/?netloss impairment). The Steam
 * transport plugs into the same seams.
 */

import { events } from '../core/events';
import { physics } from '../physics';
import { LocalLobby, LocalTransport, randomPeerId } from '../net/transport';
import type { LobbyProvider, PeerId } from '../net/transport';
import { NetSession, MAX_PLAYERS } from '../net/session';
import type { GameMessage, PlayerInfo } from '../net/session';
import {
  encodeHeroState,
  encodeSnapshot,
  encodeVanState,
  HeroFlag,
  GuardFlag,
  CamFlag,
  GlobalFlag,
  PROTOCOL_VERSION,
} from '../net/protocol';
import type { HeroStateMsg, Snapshot, SnapshotVan, VanStateMsg, JsonMsg } from '../net/protocol';
import { InterpBuffer, lerp, lerpAngle } from '../net/interp';
import {
  setRole,
  getRole,
  isHost,
  isClient,
  setNetHooks,
  setRequestSender,
  setSession,
} from './mp';
import { isHeroInCar, enterCar, exitCar, vanDriver } from './car';

// --- pacing ------------------------------------------------------------------

const HERO_SEND_EVERY_TICKS = 2; // 30 Hz
const SNAPSHOT_EVERY_TICKS = 3; // 20 Hz
const KEYFRAME_EVERY_TICKS = 120; // every 2 s, reliable
/** How far behind the newest snapshot clients render remote entities. */
const INTERP_DELAY_TICKS = 8; // ~133 ms
const READY_TIMEOUT_MS = 8000;

/** Build fingerprint for the version handshake. Bump PROTOCOL_VERSION on wire changes. */
const APP_BUILD = `dev-p${PROTOCOL_VERSION}`;

// --- session state -----------------------------------------------------------

let lobby: LobbyProvider | null = null;
let localTransport: LocalTransport | null = null;
let session: NetSession | null = null;
let lobbyIsMine = false;
let statusEl: HTMLElement | null = null;

let missionRunning = false;
let tick = 0;
let heroSeq = 0;
let vanSeq = 0;

// READY/GO gate (host side)
const readyPlayers = new Set<number>();
let goSent = false;
let missionStartedAt = 0;

// host: cells destroyed this mission, for keyframe healing
const destroyedCells: number[] = [];
events.on('cell:destroyed', (idx) => {
  if (isHost() && missionRunning && typeof idx === 'number') destroyedCells.push(idx);
});

// client: interpolation buffers
interface PosState {
  x: number;
  y: number;
  rad: number;
}
const guardBufs = new Map<number, InterpBuffer<PosState>>();
const heroBufs = new Map<number, InterpBuffer<PosState>>();
let vanBuf = new InterpBuffer<{ x: number; y: number; angle: number }>();
let latestSnapTick = -1;
let renderTick = -1;
/** host: latest van state streamed by a remote driver (speed feeds lethality). */
let remoteVanSpeed = 0;

function resetMissionNetState(): void {
  tick = 0;
  heroSeq = 0;
  vanSeq = 0;
  readyPlayers.clear();
  goSent = false;
  destroyedCells.length = 0;
  guardBufs.clear();
  heroBufs.clear();
  vanBuf = new InterpBuffer();
  latestSnapTick = -1;
  renderTick = -1;
  remoteVanSpeed = 0;
}

// --- small helpers over the legacy globals -----------------------------------

declare const window: any;

function heroByPlayerId(playerId: number): any {
  const heroes = window.heroes as any[] | undefined;
  if (!heroes) return null;
  for (const h of heroes) if (h.playerId === playerId) return h;
  return null;
}

function gunIdOf(gun: any): number {
  const prefabs = window.all_gun_prefabs as any[];
  if (!gun || !prefabs) return 0;
  const i = prefabs.findIndex((p) => p.name === gun.name);
  return i === -1 ? 0 : i;
}

function gunById(id: number): any {
  const prefabs = window.all_gun_prefabs as any[];
  return prefabs && prefabs[id] ? prefabs[id] : null;
}

function inMission(): boolean {
  return missionRunning && window.state === 1;
}

// --- flags <-> hero fields ---------------------------------------------------

function collectLocalHeroFlags(): number {
  const h = window.hero;
  let f = 0;
  if (h.masked) f |= HeroFlag.Masked;
  if (h.gunOut) f |= HeroFlag.GunOut;
  if (h.carry) f |= HeroFlag.Carry;
  if (h.lockpicking) f |= HeroFlag.Lockpicking;
  if (h.plantingBomb) f |= HeroFlag.PlantingBomb;
  if (h.inOffLimits) f |= HeroFlag.InOffLimits;
  if (h.drag_target) f |= HeroFlag.Dragging;
  if (h.downed) f |= HeroFlag.Downed;
  if (h.inCar) f |= HeroFlag.InCar;
  if (h.speed === h.speed_sprint) f |= HeroFlag.Sprinting;
  if (h.spyglass_equipped) f |= HeroFlag.Spyglass;
  if (h.alive) f |= HeroFlag.Alive;
  if (h.reloading) f |= HeroFlag.Reloading;
  if (h.sprite_animate) f |= HeroFlag.Moving;
  return f;
}

function applyHeroGun(h: any, gunId: number): void {
  if (gunIdOf(h.gun) === gunId) return;
  const prefab = gunById(gunId);
  if (prefab) {
    h.gun = prefab.make_copy();
    window.setHeroImageFor(h);
  }
}

function applyHeroMoving(h: any, moving: boolean): void {
  if (moving && !h.sprite_animate) {
    h.feet_clip.gotoAndPlay(0);
    h.sprite_animate = true;
  } else if (!moving && h.sprite_animate) {
    h.feet_clip.gotoAndStop(0);
    h.sprite_animate = false;
  }
}

/**
 * HOST: apply a client's streamed flags onto their replica. Only the flags the
 * client legitimately owns: what they're wearing/holding/doing. World-owned truth
 * (carry, drag, downed, alive) is set by the host's own logic, never from here.
 */
function applyReplicaFlags(h: any, flags: number, gunId: number): void {
  const wasMasked = !!h.masked;
  h.masked = !!(flags & HeroFlag.Masked);
  const gunOut = !!(flags & HeroFlag.GunOut);
  const gunChanged = h.gunOut !== gunOut || gunIdOf(h.gun) !== gunId;
  h.gunOut = gunOut;
  h.lockpicking = !!(flags & HeroFlag.Lockpicking);
  h.plantingBomb = !!(flags & HeroFlag.PlantingBomb);
  h.inOffLimits = !!(flags & HeroFlag.InOffLimits);
  h.spyglass_equipped = !!(flags & HeroFlag.Spyglass);
  applyHeroMoving(h, !!(flags & HeroFlag.Moving));
  if (gunChanged) {
    applyHeroGun(h, gunId);
    window.setHeroImageFor(h);
  }
  if (wasMasked !== h.masked) {
    h.imgMaskOn(h.masked);
    //taking the mask OFF in view of a guard burns that player's face
    if (!h.masked) window.checkUnmaskSeen(h);
  }
  //van seating follows the client's own enter/exit (validated request comes later;
  //the flag transition self-heals either way)
  const wantsInCar = !!(flags & HeroFlag.InCar);
  if (wantsInCar !== isHeroInCar(h)) {
    if (wantsInCar) enterCar(h);
    else exitCar(h);
  }
}

/** CLIENT: apply a teammate's snapshot flags — pure presentation. */
function applyRemoteHeroVisuals(h: any, flags: number, gunId: number): void {
  const masked = !!(flags & HeroFlag.Masked);
  if (masked !== !!h.masked) {
    h.masked = masked;
    h.imgMaskOn(masked);
  }
  const gunOut = !!(flags & HeroFlag.GunOut);
  if (h.gunOut !== gunOut || gunIdOf(h.gun) !== gunId) {
    h.gunOut = gunOut;
    applyHeroGun(h, gunId);
    window.setHeroImageFor(h);
  }
  applyHeroMoving(h, !!(flags & HeroFlag.Moving));
  h.inCar = !!(flags & HeroFlag.InCar);
  const visible = !h.inCar;
  if (h.sprite.visible !== visible) h.sprite.visible = visible;
  if (h.nameTag) h.nameTag.visible = visible;
}

// --- guard replicas (client) -------------------------------------------------

function ensureGuardReplica(idx: number, flags: number): any {
  const guards = window.guards as any[];
  while (guards.length <= idx) {
    const shield = !!(flags & GuardFlag.RiotShield);
    const img = shield ? window.img_guard_riot_reg : window.img_guard_reg;
    const g = new window.sprite_guard_wrapper(new window.PIXI.Sprite(img), shield ? 1 : 0);
    //replicas collide with the local hero so teammates' guard walls feel solid
    physics.addGuard(g, g.radius);
    guards.push(g);
  }
  return guards[idx];
}

function applyGuardVisuals(guard: any, flags: number): void {
  const alive = !!(flags & GuardFlag.Alive);
  const shield = !!(flags & GuardFlag.RiotShield);
  if (guard.hasRiotShield !== shield) guard.hasRiotShield = shield;
  guard.alarmed = !!(flags & GuardFlag.Alarmed);
  guard.being_choked_out = !!(flags & GuardFlag.BeingChoked);

  if (!alive && guard.alive) {
    //client-side death: the world-facing parts only (no alarm bookkeeping — the
    //host owns alarmingObjects, gun drops and nav danger)
    guard.alive = false;
    physics.removeActor(guard);
    guard.sprite_body.texture = window.img_guard_dead;
    if (guard.feet_clip) guard.feet_clip.visible = false;
    guard.sprite.visible = true;
    return;
  }
  if (!alive) {
    guard.sprite_body.texture = window.img_guard_drag && guard.beingDraggedNet ? window.img_guard_drag : window.img_guard_dead;
    return;
  }

  if (guard.being_choked_out) {
    guard.sprite_body.texture = window.img_guard_choke;
  } else if (guard.alarmed) {
    guard.sprite_body.texture = shield ? window.img_guard_riot_alert : window.img_guard_alert;
  } else {
    guard.sprite_body.texture = shield ? window.img_guard_riot_reg : window.img_guard_reg;
  }
  const moving = !!(flags & GuardFlag.Moving);
  if (guard.feet_clip) {
    if (moving && !guard.netMoving) guard.feet_clip.gotoAndPlay(0);
    else if (!moving && guard.netMoving) guard.feet_clip.gotoAndStop(0);
  }
  guard.netMoving = moving;
}

// --- cameras / doors / globals (client) --------------------------------------

function applyCamVisuals(cam: any, rad: number, flags: number): void {
  const alive = !!(flags & CamFlag.Alive);
  cam.rad = rad;
  cam.rotation = rad;
  cam.hacked = !!(flags & CamFlag.Hacked);
  if (!alive && cam.alive) {
    cam.alive = false;
    cam.sprite.texture = window.img_cam_broken;
  } else if (alive && !window.cameras_disabled) {
    const alarmed = !!(flags & CamFlag.Alarmed);
    if (alarmed !== cam.alarmed) {
      cam.alarmed = alarmed;
      cam.sprite.texture = alarmed ? window.img_security_camera_alerted : window.img_security_camera;
    }
  }
}

function applyDoorBits(openBits: number, unlockedBits: number, brokenBits: number): void {
  const grid = window.grid;
  if (!grid || !grid.door_sprites) return;
  for (let i = 0; i < grid.door_sprites.length && i < 32; i++) {
    const door = grid.door_sprites[i];
    door.unlocked = !!(unlockedBits & (1 << i));
    door.broken = !!(brokenBits & (1 << i));
    //open()/close() are idempotent and flip grid solidity + physics + sounds
    if (openBits & (1 << i)) door.open();
    else door.close();
  }
}

function applyGlobalFlags(flags: number, lastSeenX: number, lastSeenY: number): void {
  const camsOff = !!(flags & GlobalFlag.CamerasDisabled);
  if (camsOff && !window.cameras_disabled) {
    window.cameras_disabled = true;
    if (window.computer_for_security_cameras) {
      window.computer_for_security_cameras.sprite.texture = window.img_computer_off;
    }
    for (const cam of window.security_cameras) cam.sprite.texture = window.img_cam_off;
  }
  window.backupCalled = !!(flags & GlobalFlag.BackupCalled);
  window.last_seen_active = !!(flags & GlobalFlag.LastSeenActive);
  if (window.last_seen_active && window.hero_last_seen) {
    window.hero_last_seen.x = lastSeenX;
    window.hero_last_seen.y = lastSeenY;
  }
}

function applyDestroyedCells(cells: number[]): void {
  const grid = window.grid;
  if (!grid) return;
  for (const idx of cells) {
    const cell = grid.cells[idx];
    //damageCell runs the whole local destroy pipeline (grid, nav, physics, fog,
    //autotile, FX) — only for cells still standing here
    if (cell && cell.solid) grid.damageCell(idx, 1000000, 'bullet');
  }
}

// --- building the host snapshot ----------------------------------------------

function buildSnapshot(): Snapshot {
  const heroes = window.heroes as any[];
  const guards = window.guards as any[];
  const cams = window.security_cameras as any[];
  const grid = window.grid;

  const snap: Snapshot = {
    tick,
    heroes: [],
    guards: [],
    cams: [],
    van: null,
    doorOpenBits: 0,
    doorUnlockedBits: 0,
    doorBrokenBits: 0,
    dragged: [],
    globalFlags: 0,
    lastSeenX: window.hero_last_seen ? window.hero_last_seen.x : 0,
    lastSeenY: window.hero_last_seen ? window.hero_last_seen.y : 0,
  };

  for (const h of heroes) {
    let flags = h === window.hero ? collectLocalHeroFlags() : replicaSnapshotFlags(h);
    snap.heroes.push({
      playerId: h.playerId,
      x: h.x,
      y: h.y,
      rad: h.rad || 0,
      flags,
      gunId: gunIdOf(h.gun),
    });
  }

  for (let i = 0; i < guards.length; i++) {
    const g = guards[i];
    let flags = 0;
    if (g.alive) flags |= GuardFlag.Alive;
    if (g.alarmed) flags |= GuardFlag.Alarmed;
    if (g.alarmedPre) flags |= GuardFlag.AlarmedPre;
    if (g.moving && g.alive) flags |= GuardFlag.Moving;
    if (g.being_choked_out) flags |= GuardFlag.BeingChoked;
    if (g.hasRiotShield) flags |= GuardFlag.RiotShield;
    snap.guards.push({ idx: i, x: g.x, y: g.y, rad: g.rad || 0, flags });
    if (g.dragged_by) {
      snap.dragged.push({ guardIdx: i, x: g.x, y: g.y, draggerId: g.dragged_by.playerId });
    }
  }

  for (let i = 0; i < cams.length; i++) {
    const c = cams[i];
    let flags = 0;
    if (c.alive) flags |= CamFlag.Alive;
    if (c.hacked) flags |= CamFlag.Hacked;
    if (c.alarmed) flags |= CamFlag.Alarmed;
    snap.cams.push({ idx: i, rad: c.rad || 0, flags });
  }

  const van = window.getawaycar;
  if (van && physics.hasCar(van)) {
    const st = physics.getCarState(van);
    if (st) {
      let aboardMask = 0;
      for (const h of heroes) if (isHeroInCar(h)) aboardMask |= 1 << h.playerId;
      const driver = vanDriver();
      snap.van = {
        x: st.x,
        y: st.y,
        angle: st.angle,
        vx: st.vx / 60, //px/s -> px/tick for the codec's velocity scale
        vy: st.vy / 60,
        angularVel: 0,
        driverId: driver ? driver.playerId : 255,
        aboardMask,
      };
    }
  }

  const doors = grid && grid.door_sprites ? grid.door_sprites : [];
  for (let i = 0; i < doors.length && i < 32; i++) {
    if (doors[i].opened) snap.doorOpenBits |= 1 << i;
    if (doors[i].unlocked) snap.doorUnlockedBits |= 1 << i;
    if (doors[i].broken) snap.doorBrokenBits |= 1 << i;
  }

  if (window.backupCalled) snap.globalFlags |= GlobalFlag.BackupCalled;
  if (window.cameras_disabled) snap.globalFlags |= GlobalFlag.CamerasDisabled;
  if (window.bomb && window.bomb.sprite && window.bomb.sprite.visible) snap.globalFlags |= GlobalFlag.BombPlanted;
  if (window.hasWon) snap.globalFlags |= GlobalFlag.HasWon;
  if (window.last_seen_active) snap.globalFlags |= GlobalFlag.LastSeenActive;

  return snap;
}

/** Host-side flags for a replica hero in the outgoing snapshot (world-owned bits included). */
function replicaSnapshotFlags(h: any): number {
  let f = 0;
  if (h.masked) f |= HeroFlag.Masked;
  if (h.gunOut) f |= HeroFlag.GunOut;
  if (h.carry) f |= HeroFlag.Carry;
  if (h.lockpicking) f |= HeroFlag.Lockpicking;
  if (h.plantingBomb) f |= HeroFlag.PlantingBomb;
  if (h.inOffLimits) f |= HeroFlag.InOffLimits;
  if (h.drag_target) f |= HeroFlag.Dragging;
  if (h.downed) f |= HeroFlag.Downed;
  if (h.inCar) f |= HeroFlag.InCar;
  if (h.spyglass_equipped) f |= HeroFlag.Spyglass;
  if (h.alive) f |= HeroFlag.Alive;
  if (h.sprite_animate) f |= HeroFlag.Moving;
  return f;
}

// --- the per-tick hooks -------------------------------------------------------

function applyIncoming(_deltaTime: number): void {
  if (!session) return;
  session.pump(performance.now());
  const messages = session.drainGameMessages();
  for (const m of messages) handleGameMessage(m);
  if (isClient() && inMission()) clientAdvanceInterpolation();
}

function collectOutgoing(_deltaTime: number): void {
  if (!session || !inMission()) return;
  tick++;
  if (isHost()) {
    if (tick % SNAPSHOT_EVERY_TICKS === 0) {
      session.broadcast(encodeSnapshot(buildSnapshot()), false);
    }
    if (tick % KEYFRAME_EVERY_TICKS === 0) {
      session.broadcastJson(buildKeyframe());
    }
    //READY timeout: don't let one wedged client hold the heist hostage
    if (!goSent && performance.now() - missionStartedAt > READY_TIMEOUT_MS) sendGo();
  } else {
    if (tick % HERO_SEND_EVERY_TICKS === 0) {
      const h = window.hero;
      const msg: HeroStateMsg = {
        seq: heroSeq++,
        x: h.x,
        y: h.y,
        vx: 0,
        vy: 0,
        rad: h.rad || 0,
        flags: collectLocalHeroFlags(),
        gunId: gunIdOf(h.gun),
      };
      session.sendToHost(encodeHeroState(msg), false);
    }
    //driver authority: while the LOCAL hero drives, stream the van body
    if (vanDriver() === window.hero && tick % HERO_SEND_EVERY_TICKS === 0) {
      const van = window.getawaycar;
      const st = van && physics.hasCar(van) ? physics.getCarState(van) : null;
      if (st) {
        const msg: VanStateMsg = {
          seq: vanSeq++,
          x: st.x,
          y: st.y,
          angle: st.angle,
          vx: st.vx / 60,
          vy: st.vy / 60,
          angularVel: 0,
          steer: st.steer || 0,
        };
        session.sendToHost(encodeVanState(msg), false);
      }
    }
  }
}

function buildKeyframe(): JsonMsg {
  const grid = window.grid;
  const doors = grid && grid.door_sprites ? grid.door_sprites : [];
  const doorState = { open: 0, unlocked: 0, broken: 0 };
  for (let i = 0; i < doors.length && i < 32; i++) {
    if (doors[i].opened) doorState.open |= 1 << i;
    if (doors[i].unlocked) doorState.unlocked |= 1 << i;
    if (doors[i].broken) doorState.broken |= 1 << i;
  }
  return {
    t: 'keyframe',
    tick,
    doors: doorState,
    destroyedCells: destroyedCells.slice(),
    camerasDisabled: !!window.cameras_disabled,
    backupCalled: !!window.backupCalled,
  };
}

// --- inbound message handling -------------------------------------------------

function handleGameMessage(m: GameMessage): void {
  const d = m.decoded;
  if (d.kind === 'json') {
    handleJson(m.fromPlayerId, d.msg);
    return;
  }
  if (!inMission()) return;
  if (isHost()) {
    if (d.kind === 'heroState') {
      const h = heroByPlayerId(m.fromPlayerId);
      if (h && h !== window.hero) {
        h.x = d.msg.x;
        h.y = d.msg.y;
        h.rad = d.msg.rad;
        if (physics.hasActor(h)) physics.teleport(h, d.msg.x, d.msg.y);
        applyReplicaFlags(h, d.msg.flags, d.msg.gunId);
      }
    } else if (d.kind === 'vanState') {
      //a remote driver owns the van: mirror its body kinematically
      const driver = vanDriver();
      if (driver && driver.playerId === m.fromPlayerId) {
        const van = window.getawaycar;
        if (van && physics.hasCar(van)) {
          physics.teleportCar(van, d.msg.x, d.msg.y, d.msg.angle);
          remoteVanSpeed = Math.hypot(d.msg.vx * 60, d.msg.vy * 60);
        }
      }
    }
  } else {
    if (d.kind === 'snapshot') applySnapshot(d.msg);
  }
}

function handleJson(fromPlayerId: number, msg: JsonMsg): void {
  switch (msg.t) {
    case 'start':
      if (!isHost() && !missionRunning) {
        beginMission(msg.roster as PlayerInfo[], false);
      }
      break;
    case 'ready':
      if (isHost() && session) {
        readyPlayers.add(fromPlayerId);
        const others = session.players.filter((p) => p.playerId !== session!.localPlayerId);
        if (!goSent && others.every((p) => readyPlayers.has(p.playerId))) sendGo();
      }
      break;
    case 'go':
      window.pause = false;
      window.newMessage && window.newMessage('The heist is on!');
      break;
    case 'keyframe':
      if (isClient() && inMission()) {
        const doors = msg.doors as { open: number; unlocked: number; broken: number };
        applyDoorBits(doors.open, doors.unlocked, doors.broken);
        applyDestroyedCells((msg.destroyedCells as number[]) || []);
        let gf = 0;
        if (msg.camerasDisabled) gf |= GlobalFlag.CamerasDisabled;
        if (msg.backupCalled) gf |= GlobalFlag.BackupCalled;
        if (window.last_seen_active) gf |= GlobalFlag.LastSeenActive;
        applyGlobalFlags(gf, window.hero_last_seen ? window.hero_last_seen.x : 0, window.hero_last_seen ? window.hero_last_seen.y : 0);
      }
      break;
    default:
      //future request/event traffic (phase 6+) lands here
      break;
  }
}

// --- client: snapshot application ---------------------------------------------

function applySnapshot(snap: Snapshot): void {
  if (snap.tick <= latestSnapTick) return; //stale/duplicate
  latestSnapTick = snap.tick;

  for (const sh of snap.heroes) {
    if (sh.playerId === (window.mpLocalPlayerId ?? 0)) continue; //client-auth own hero
    const h = heroByPlayerId(sh.playerId);
    if (!h) continue;
    let buf = heroBufs.get(sh.playerId);
    if (!buf) {
      buf = new InterpBuffer();
      heroBufs.set(sh.playerId, buf);
    }
    buf.push(snap.tick, { x: sh.x, y: sh.y, rad: sh.rad });
    applyRemoteHeroVisuals(h, sh.flags, sh.gunId);
  }

  for (const sg of snap.guards) {
    const guard = ensureGuardReplica(sg.idx, sg.flags);
    let buf = guardBufs.get(sg.idx);
    if (!buf) {
      buf = new InterpBuffer();
      guardBufs.set(sg.idx, buf);
    }
    buf.push(snap.tick, { x: sg.x, y: sg.y, rad: sg.rad });
    applyGuardVisuals(guard, sg.flags);
  }

  for (const sc of snap.cams) {
    const cam = window.security_cameras[sc.idx];
    if (cam) applyCamVisuals(cam, sc.rad, sc.flags);
  }

  if (snap.van && vanDriver() !== window.hero) {
    vanBuf.push(snap.tick, { x: snap.van.x, y: snap.van.y, angle: snap.van.angle });
    applyVanSeatsFromSnapshot(snap.van);
  }

  //dragged bodies follow the host's authority — except my own drag, which I
  //simulate locally so it never trails me
  for (const dr of snap.dragged) {
    if (dr.draggerId === (window.mpLocalPlayerId ?? 0)) continue;
    const guard = window.guards[dr.guardIdx];
    if (guard) {
      guard.x = dr.x;
      guard.y = dr.y;
      guard.beingDraggedNet = true;
    }
  }

  applyDoorBits(snap.doorOpenBits, snap.doorUnlockedBits, snap.doorBrokenBits);
  applyGlobalFlags(snap.globalFlags, snap.lastSeenX, snap.lastSeenY);
}

function applyVanSeatsFromSnapshot(van: SnapshotVan): void {
  //teammate visibility while aboard is driven by their hero InCar flag; here we
  //only need to remember who drives (for the HUD later)
  window.mpVanDriverId = van.driverId;
}

function clientAdvanceInterpolation(): void {
  if (latestSnapTick < 0) return;
  const target = latestSnapTick - INTERP_DELAY_TICKS;
  if (renderTick < 0) renderTick = target;
  else {
    renderTick += 1;
    const err = target - renderTick;
    //re-sync gently; snap only when badly off (tab was hidden, burst loss)
    if (Math.abs(err) > 6) renderTick = target;
    else renderTick += Math.max(-0.25, Math.min(0.25, err * 0.05));
  }

  for (const [playerId, buf] of heroBufs) {
    const h = heroByPlayerId(playerId);
    if (!h) continue;
    const span = buf.sample(renderTick);
    if (!span) continue;
    h.x = lerp(span.a.x, span.b.x, span.alpha);
    h.y = lerp(span.a.y, span.b.y, span.alpha);
    h.rad = lerpAngle(span.a.rad, span.b.rad, span.alpha);
  }

  const guards = window.guards as any[];
  for (const [idx, buf] of guardBufs) {
    const guard = guards[idx];
    if (!guard || guard.beingDraggedNet) continue;
    const span = buf.sample(renderTick);
    if (!span) continue;
    guard.x = lerp(span.a.x, span.b.x, span.alpha);
    guard.y = lerp(span.a.y, span.b.y, span.alpha);
    guard.rad = lerpAngle(span.a.rad, span.b.rad, span.alpha);
    if (guard.alive && physics.hasActor(guard)) physics.teleport(guard, guard.x, guard.y);
  }

  const van = window.getawaycar;
  if (van && physics.hasCar(van) && vanDriver() !== window.hero) {
    const span = vanBuf.sample(renderTick);
    if (span) {
      const x = lerp(span.a.x, span.b.x, span.alpha);
      const y = lerp(span.a.y, span.b.y, span.alpha);
      const angle = lerpAngle(span.a.angle, span.b.angle, span.alpha);
      physics.teleportCar(van, x, y, angle);
    }
  }
}

// --- lobby / mission lifecycle ------------------------------------------------

function updateStatus(text: string): void {
  if (!statusEl) {
    const parent = document.getElementById('instructions-container') || document.body;
    statusEl = document.createElement('div');
    statusEl.id = 'mp-status';
    statusEl.style.cssText =
      'margin:12px auto;padding:8px 14px;max-width:640px;background:#123;color:#8ef;' +
      'font:14px monospace;border:1px solid #8ef;border-radius:4px;';
    parent.insertBefore(statusEl, parent.firstChild);
  }
  statusEl.textContent = text;
}

function rosterLine(): string {
  if (!session) return '';
  return session.players.map((p) => p.name + (p.playerId === session!.localPlayerId ? ' (you)' : '')).join(', ');
}

function onRosterChanged(): void {
  if (!session) return;
  const room = window.mpRoom || '';
  if (lobbyIsMine) {
    updateStatus(`Hosting co-op room "${room}" — crew: ${rosterLine()}. Press Start Game to begin the heist.`);
  } else {
    updateStatus(`In co-op room "${room}" — crew: ${rosterLine()}. Waiting for the host to start...`);
  }
}

function sendGo(): void {
  if (!session || goSent) return;
  goSent = true;
  session.broadcastJson({ t: 'go' });
  window.pause = false;
  window.newMessage && window.newMessage('The heist is on!');
}

function beginMission(roster: PlayerInfo[], hosting: boolean): void {
  resetMissionNetState();
  missionRunning = true;
  missionStartedAt = performance.now();
  window.mpSessionRoster = roster;
  window.mpLocalPlayerId = session ? session.localPlayerId : 0;
  //solo host in a lobby plays plain single-player rules
  setRole(roster.length > 1 ? (hosting ? 'host' : 'client') : 'single');
  //freeze the sim until everyone is loaded (GO); the accumulator gate in
  //animate() already respects pause
  window.pause = true;
  window.startGame();
  if (isClient() && session) {
    session.sendJsonToHost({ t: 'ready' });
    updateStatus('');
  }
  if (isHost()) {
    readyPlayers.clear();
    goSent = false;
    if (!session || session.players.length <= 1) sendGo();
  }
}

/**
 * Called from fullscreen() when Start Game is pressed. Returns true when the
 * press was handled by multiplayer (so the plain single-player start must not
 * also run).
 */
function mpTryStartMission(): boolean {
  if (!session) return false;
  if (!lobbyIsMine) {
    updateStatus('Only the host can start the heist — hang tight.');
    return true;
  }
  const roster = session.players;
  session.broadcastJson({ t: 'start', roster });
  beginMission(roster, true);
  return true;
}

// --- player join/leave during a mission ----------------------------------------

function removeRemoteHero(playerId: number): void {
  const h = heroByPlayerId(playerId);
  if (!h || h === window.hero) return;
  if (isHeroInCar(h)) exitCar(h);
  if (h.drag_target) {
    h.drag_target.dragged_by = null;
    h.drag_target.stop_dragging && h.drag_target.stop_dragging();
    h.drag_target = null;
  }
  if (physics.hasActor(h)) physics.removeActor(h);
  if (h.sprite && h.sprite.parent) h.sprite.parent.removeChild(h.sprite);
  if (h.nameTag && h.nameTag.parent) h.nameTag.parent.removeChild(h.nameTag);
  window.heroes = (window.heroes as any[]).filter((u) => u !== h);
  heroBufs.delete(playerId);
}

// --- boot ---------------------------------------------------------------------

function setupFromUrl(): void {
  const params = window.url_queryString || {};
  const mode = params['net'];
  if (mode !== 'host' && mode !== 'join') return;
  const room = params['room'] || 'dev';
  window.mpRoom = room;

  const peerId = randomPeerId();
  lobby = new LocalLobby(room, peerId);
  localTransport = new LocalTransport(room, peerId);
  const lag = Number(params['netlag'] || 0);
  const jitter = Number(params['netjitter'] || 0);
  const loss = Number(params['netloss'] || 0);
  localTransport.impairment = { latencyMs: lag, jitterMs: jitter, loss };

  const name = params['name'] || (mode === 'host' ? 'Host' : 'Guest-' + peerId.slice(0, 4));

  const finishSetup = (info: { ownerId: PeerId }) => {
    lobbyIsMine = info.ownerId === peerId;
    session = new NetSession({
      transport: localTransport!,
      role: lobbyIsMine ? 'host' : 'client',
      hostPeerId: info.ownerId,
      localName: String(name),
      appBuild: APP_BUILD,
      maxPlayers: MAX_PLAYERS,
      callbacks: {
        onRosterChanged: () => onRosterChanged(),
        onPlayerLeft: (p) => {
          window.newMessage && window.newMessage(p.name + ' left the game.');
          if (missionRunning) removeRemoteHero(p.playerId);
          onRosterChanged();
        },
        onHostLost: () => {
          updateStatus('Connection to the host was lost.');
          window.newMessage && window.newMessage('Connection to the host was lost.');
          missionRunning = false;
          setRole('single');
          window.startMenu && window.startMenu();
        },
        onRejected: (reason) => updateStatus('Could not join: ' + reason),
      },
    });
    setSession(session);
    setNetHooks({ apply: applyIncoming, collect: collectOutgoing });
    onRosterChanged();
  };

  if (mode === 'host') {
    lobby.createLobby(MAX_PLAYERS).then(finishSetup);
  } else {
    updateStatus(`Looking for room "${room}"...`);
    lobby
      .joinLobby(room)
      .then(finishSetup)
      .catch((err: Error) => updateStatus(err.message));
  }

  //pump the session while in the menu too (gameloop isn't running there)
  const menuPump = () => {
    if (session && window.state === 0) session.pump(performance.now());
    requestAnimationFrame(menuPump);
  };
  requestAnimationFrame(menuPump);
}

setupFromUrl();

// --- legacy global bridge ---------------------------------------------------
Object.assign(window, { mpTryStartMission, mpRemoveRemoteHero: removeRemoteHero });

export { mpTryStartMission };
