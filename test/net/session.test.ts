import { describe, expect, it } from 'vitest';
import { createMemoryHub } from '../../src/net/transport';
import { NetSession } from '../../src/net/session';
import type { PlayerInfo } from '../../src/net/session';
import { decode, encodeJson } from '../../src/net/protocol';

const BUILD = 'test-build';

function makePair(clientBuild = BUILD) {
  const hub = createMemoryHub();
  const hostTransport = hub.connect('H');
  const clientTransport = hub.connect('C1');
  const host = new NetSession({
    transport: hostTransport,
    role: 'host',
    hostPeerId: 'H',
    localName: 'Hosty',
    appBuild: BUILD,
  });
  const rejections: string[] = [];
  const client = new NetSession({
    transport: clientTransport,
    role: 'client',
    hostPeerId: 'H',
    localName: 'Guest',
    appBuild: clientBuild,
    callbacks: { onRejected: (r) => rejections.push(r) },
  });
  return { hub, host, client, rejections };
}

/** Pump both sides a few times at the same timestamp to settle handshakes. */
function settle(sessions: NetSession[], nowMs: number, rounds = 4) {
  for (let i = 0; i < rounds; i++) for (const s of sessions) s.pump(nowMs);
}

describe('NetSession handshake', () => {
  it('client joins, both sides converge on the same roster with names', () => {
    const { host, client } = makePair();
    settle([client, host, client], 1000);
    expect(client.joined).toBe(true);
    expect(client.localPlayerId).toBe(1);
    expect(host.players.map((p: PlayerInfo) => [p.playerId, p.name])).toEqual([
      [0, 'Hosty'],
      [1, 'Guest'],
    ]);
    expect(client.players).toHaveLength(2);
    expect(client.players[0].name).toBe('Hosty');
  });

  it('rejects a build mismatch with a readable reason', () => {
    const { host, client, rejections } = makePair('other-build');
    settle([client, host, client], 1000);
    expect(client.joined).toBe(false);
    expect(rejections).toHaveLength(1);
    expect(rejections[0]).toContain('Version mismatch');
    expect(host.players).toHaveLength(1);
  });

  it('hello retries are idempotent (duplicate welcome keeps one roster entry)', () => {
    const { host, client } = makePair();
    // Two hello rounds at times far enough apart to trigger a retry.
    client.pump(1000);
    client.pump(2500);
    settle([host, client], 3000);
    expect(host.players).toHaveLength(2);
    expect(client.players).toHaveLength(2);
  });

  it('a third player gets the next free slot', () => {
    const { hub, host, client } = makePair();
    const c2 = new NetSession({
      transport: hub.connect('C2'),
      role: 'client',
      hostPeerId: 'H',
      localName: 'Third',
      appBuild: BUILD,
    });
    settle([client, c2, host, client, c2], 1000);
    expect(c2.localPlayerId).toBe(2);
    expect(host.players.map((p) => p.playerId)).toEqual([0, 1, 2]);
    // First client also learned about the third via roster broadcast.
    expect(client.players).toHaveLength(3);
  });

  it('enforces the player cap', () => {
    const hub = createMemoryHub();
    const host = new NetSession({
      transport: hub.connect('H'),
      role: 'host',
      hostPeerId: 'H',
      localName: 'Hosty',
      appBuild: BUILD,
      maxPlayers: 2,
    });
    const c1 = new NetSession({
      transport: hub.connect('C1'),
      role: 'client',
      hostPeerId: 'H',
      localName: 'One',
      appBuild: BUILD,
    });
    const rejected: string[] = [];
    const c2 = new NetSession({
      transport: hub.connect('C2'),
      role: 'client',
      hostPeerId: 'H',
      localName: 'Two',
      appBuild: BUILD,
      callbacks: { onRejected: (r) => rejected.push(r) },
    });
    settle([c1, host, c2, host, c1, c2], 1000);
    expect(c1.joined).toBe(true);
    expect(c2.joined).toBe(false);
    expect(rejected[0]).toContain('full');
  });
});

describe('NetSession liveness', () => {
  it('host drops a silent client after the timeout and notifies', () => {
    const { host, client } = makePair();
    settle([client, host, client], 1000);
    const gone: string[] = [];
    (host as unknown as { callbacks: { onPlayerLeft: (p: PlayerInfo) => void } }).callbacks = {
      onPlayerLeft: (p: PlayerInfo) => gone.push(p.name),
    };
    // Client goes silent; host pumps past the 8s timeout.
    host.pump(5000);
    expect(host.players).toHaveLength(2);
    host.pump(9500);
    expect(host.players).toHaveLength(1);
    expect(gone).toEqual(['Guest']);
  });

  it('client detects a silent host', () => {
    const { host, client } = makePair();
    let hostLost = false;
    (client as unknown as { callbacks: { onHostLost: () => void } }).callbacks = {
      onHostLost: () => (hostLost = true),
    };
    settle([client, host, client], 1000);
    client.pump(9500);
    expect(hostLost).toBe(true);
  });

  it('a deliberate client leave removes it immediately', () => {
    const { host, client } = makePair();
    settle([client, host, client], 1000);
    client.leave();
    host.pump(1001);
    expect(host.players).toHaveLength(1);
  });

  it('client rtt is measured from ping/pong', () => {
    const { host, client } = makePair();
    settle([client, host, client], 1000);
    client.pump(2001); // sends ping stamped 2001
    host.pump(2001); // pongs
    client.pump(2031); // receives pong 30ms later
    expect(client.rttMs).toBeGreaterThan(0);
    expect(client.rttMs).toBeLessThanOrEqual(30);
  });
});

describe('NetSession game traffic', () => {
  it('routes non-control messages to the game inbox with player attribution', () => {
    const { host, client } = makePair();
    settle([client, host, client], 1000);
    client.sendJsonToHost({ t: 'req_test', value: 42 });
    host.pump(1001);
    const msgs = host.drainGameMessages();
    expect(msgs).toHaveLength(1);
    expect(msgs[0].fromPlayerId).toBe(1);
    expect(msgs[0].decoded.kind).toBe('json');
    if (msgs[0].decoded.kind === 'json') expect(msgs[0].decoded.msg.value).toBe(42);
    expect(host.drainGameMessages()).toHaveLength(0);
  });

  it('drops game traffic from peers that never completed the handshake', () => {
    const hub = createMemoryHub();
    const host = new NetSession({
      transport: hub.connect('H'),
      role: 'host',
      hostPeerId: 'H',
      localName: 'Hosty',
      appBuild: BUILD,
    });
    const stranger = hub.connect('X');
    stranger.send('H', encodeJson({ t: 'req_test' }), true);
    host.pump(1000);
    expect(host.drainGameMessages()).toHaveLength(0);
  });

  it('host broadcast reaches every client except the excluded peer', () => {
    const { hub, host, client } = makePair();
    const received: string[] = [];
    const c2transport = hub.connect('C2');
    const c2 = new NetSession({
      transport: c2transport,
      role: 'client',
      hostPeerId: 'H',
      localName: 'Third',
      appBuild: BUILD,
    });
    settle([client, c2, host, client, c2], 1000);
    c2transport.onMessage((_from, data) => {
      const d = decode(data);
      if (d.kind === 'json' && d.msg.t === 'ev_x') received.push('C2');
    });
    host.broadcastJson({ t: 'ev_x' }, 'C1');
    expect(received).toEqual(['C2']);
  });
});
