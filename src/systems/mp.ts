/**
 * Multiplayer seam — the one place the legacy game asks "what is my role?".
 *
 * Roles:
 *  - 'single': no networking. `isHost()` is TRUE — every host-gated block in the
 *    game loop runs exactly as it always has. This is the default and the
 *    guarantee that single-player behavior never changes.
 *  - 'host':   this machine runs the authoritative world (guards, alarms, doors,
 *    damage) and broadcasts snapshots.
 *  - 'client': this machine simulates only the local hero; the world arrives
 *    over the network.
 *
 * The two per-tick hooks (`mpApplyIncoming` / `mpCollectOutgoing`) are no-ops
 * until the replication layer registers itself, so merely importing this module
 * changes nothing.
 *
 * `mpAction(name, payload, directFn)` is the interaction seam: single-player and
 * the host execute `directFn` immediately (today's behavior, unchanged); clients
 * instead send a reliable request the host validates and answers with events.
 */
import type { NetSession, Role } from '../net/session';

let role: Role = 'single';
let session: NetSession | null = null;

export function getRole(): Role {
  return role;
}

export function setRole(next: Role): void {
  role = next;
  window.netRole = next;
}

/** True in single-player on purpose: 'single' is "host of a party of one". */
export function isHost(): boolean {
  return role !== 'client';
}

export function isClient(): boolean {
  return role === 'client';
}

export function isMultiplayer(): boolean {
  return role !== 'single';
}

export function getSession(): NetSession | null {
  return session;
}

export function setSession(next: NetSession | null): void {
  session = next;
}

// --- per-tick net hooks (registered by src/net wiring, no-ops until then) ----

type NetHook = (deltaTime: number) => void;
let applyHook: NetHook | null = null;
let collectHook: NetHook | null = null;

export function setNetHooks(hooks: { apply: NetHook; collect: NetHook } | null): void {
  applyHook = hooks ? hooks.apply : null;
  collectHook = hooks ? hooks.collect : null;
}

/** First thing in the tick: apply everything that arrived from the network. */
export function mpApplyIncoming(deltaTime: number): void {
  if (applyHook) applyHook(deltaTime);
}

/** Last thing in the tick: stream local hero state / host snapshot on schedule. */
export function mpCollectOutgoing(deltaTime: number): void {
  if (collectHook) collectHook(deltaTime);
}

// --- the interaction seam ----------------------------------------------------

type RequestSender = (name: string, payload: Record<string, unknown>) => void;
let requestSender: RequestSender | null = null;

export function setRequestSender(sender: RequestSender | null): void {
  requestSender = sender;
}

/**
 * Run a world-mutating interaction. Host and single-player run it directly;
 * a client sends `req_<name>` to the host instead and waits for the resulting
 * event broadcast.
 */
export function mpAction(
  name: string,
  payload: Record<string, unknown>,
  directFn: () => void,
): void {
  if (!isClient()) {
    directFn();
    return;
  }
  if (requestSender) {
    requestSender(name, payload);
  } else {
    console.warn(`mpAction '${name}' dropped: client role but no request sender wired`);
  }
}

// --- legacy global bridge ---------------------------------------------------
// Console/debug affordances: `mpSetRole('client')` is the "dead client" drill.
Object.assign(window, { mpGetRole: getRole, mpSetRole: setRole, mpAction });
window.netRole = role;

export {};
