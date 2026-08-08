/**
 * Multiplayer smoke harness — two browser pages in one Chromium, connected over
 * the BroadcastChannel dev transport (?net=host / ?net=join), playing co-op.
 *
 * Asserts the whole replication loop: lobby handshake, networked mission start,
 * READY/GO gate, hero state streaming host<-client, world snapshots host->client
 * (guards appear on the guest even though clients never spawn guards locally),
 * and interpolation actually moving remote entities.
 *
 * Run it like tools/smoke.mjs (needs a browser, so not in CI):
 *
 *   npm run build
 *   npx vite preview --port 4173 &
 *   npm i --no-save playwright
 *   node tools/smoke_mp.mjs
 *
 * Env: BASE (default http://127.0.0.1:4173), CHROMIUM (executable path).
 * Pass IMPAIR=1 to run with 150ms latency + 5% loss on the guest.
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://127.0.0.1:4173';
const ROOM = 'smoke' + Math.floor(Math.random() * 1e6);
const IMPair = process.env.IMPAIR
  ? '&netlag=150&netjitter=40&netloss=0.05'
  : '';

const results = [];
function check(name, ok, extra = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
}

const browser = await chromium.launch({
  ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}),
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const context = await browser.newContext({ viewport: { width: 1100, height: 700 } });
const pageErrors = { host: [], guest: [] };

const host = await context.newPage();
host.on('pageerror', (e) => pageErrors.host.push(String(e)));
const guest = await context.newPage();
guest.on('pageerror', (e) => pageErrors.guest.push(String(e)));

await host.goto(`${BASE}/game.html?volume=0&level=bank_1&net=host&room=${ROOM}&name=Hosty`);
await guest.goto(
  `${BASE}/game.html?volume=0&level=bank_1&net=join&room=${ROOM}&name=Guesty${IMPair}`,
);

// --- lobby handshake ---------------------------------------------------------
await host.waitForFunction(
  () => document.getElementById('mp-status')?.textContent?.includes('Guesty'),
  null,
  { timeout: 15000 },
);
check('lobby: host sees the guest in the crew list', true);
await guest.waitForFunction(
  () => document.getElementById('mp-status')?.textContent?.includes('Hosty'),
  null,
  { timeout: 15000 },
);
check('lobby: guest sees the host in the crew list', true);

// --- networked start ---------------------------------------------------------
await host.click('#start-btn');
await host.waitForFunction(() => window.state === 1 && window.pause === false, null, {
  timeout: 15000,
});
check('start: host entered gameplay and unpaused after GO', true);
await guest.waitForFunction(() => window.state === 1 && window.pause === false, null, {
  timeout: 15000,
});
check('start: guest entered gameplay and unpaused after GO', true);

check(
  'roles: host is authoritative, guest is a client',
  (await host.evaluate(() => window.netRole)) === 'host' &&
    (await guest.evaluate(() => window.netRole)) === 'client',
);

// --- replication: guards flow host -> guest ---------------------------------
await guest.waitForFunction(() => window.guards && window.guards.length > 0, null, {
  timeout: 10000,
});
const guardCounts = [
  await host.evaluate(() => window.guards.length),
  await guest.evaluate(() => window.guards.length),
];
check(
  'snapshot: guest received guard replicas from the host',
  guardCounts[1] === guardCounts[0],
  `host=${guardCounts[0]} guest=${guardCounts[1]}`,
);

check(
  'heroes: both machines have both heroes',
  (await host.evaluate(() => window.heroes.length)) === 2 &&
    (await guest.evaluate(() => window.heroes.length)) === 2,
);

// --- hero state streaming: guest -> host -------------------------------------
const guestHeroOnHostBefore = await host.evaluate(() => {
  const h = window.heroes.find((u) => u !== window.hero);
  return { x: h.x, y: h.y };
});
await guest.keyboard.down('w');
await guest.waitForTimeout(700);
await guest.keyboard.up('w');
await guest.waitForTimeout(400);
const guestHeroOnHostAfter = await host.evaluate(() => {
  const h = window.heroes.find((u) => u !== window.hero);
  return { x: h.x, y: h.y };
});
check(
  'streaming: guest hero movement shows up on the host replica',
  Math.abs(guestHeroOnHostAfter.y - guestHeroOnHostBefore.y) > 10 ||
    Math.abs(guestHeroOnHostAfter.x - guestHeroOnHostBefore.x) > 10,
  JSON.stringify({ before: guestHeroOnHostBefore, after: guestHeroOnHostAfter }),
);

// --- interpolation: host hero movement shows on the guest ---------------------
const hostHeroOnGuestBefore = await guest.evaluate(() => {
  const h = window.heroes.find((u) => u !== window.hero);
  return { x: h.x, y: h.y };
});
await host.keyboard.down('s');
await host.waitForTimeout(700);
await host.keyboard.up('s');
await host.waitForTimeout(600);
const hostHeroOnGuestAfter = await guest.evaluate(() => {
  const h = window.heroes.find((u) => u !== window.hero);
  return { x: h.x, y: h.y };
});
check(
  'interpolation: host hero movement shows up on the guest',
  Math.abs(hostHeroOnGuestAfter.y - hostHeroOnGuestBefore.y) > 10 ||
    Math.abs(hostHeroOnGuestAfter.x - hostHeroOnGuestBefore.x) > 10,
  JSON.stringify({ before: hostHeroOnGuestBefore, after: hostHeroOnGuestAfter }),
);

// --- guards move on the guest without any local AI ----------------------------
const guardPosBefore = await guest.evaluate(() =>
  window.guards.filter((g) => g.alive).map((g) => [g.x, g.y]),
);
await guest.waitForTimeout(2500);
const guardPosAfter = await guest.evaluate(() =>
  window.guards.filter((g) => g.alive).map((g) => [g.x, g.y]),
);
const anyGuardMoved = guardPosBefore.some(
  (p, i) =>
    guardPosAfter[i] &&
    (Math.abs(guardPosAfter[i][0] - p[0]) > 4 || Math.abs(guardPosAfter[i][1] - p[1]) > 4),
);
check('snapshot: patrolling guards move on the guest via interpolation', anyGuardMoved);

// --- suspicion travels: masked guest alarms a host guard ---------------------
// (teleport the guest hero next to a guard, put the mask on, let the host see it)
await guest.evaluate(() => {
  window.hero.masked = true;
});
await guest.waitForTimeout(300);
const replicaMasked = await host.evaluate(() => {
  const h = window.heroes.find((u) => u !== window.hero);
  return !!h.masked;
});
check('flags: guest mask state replicated onto the host replica', replicaMasked);

check('stability: no page errors on host', pageErrors.host.length === 0, pageErrors.host[0]);
check('stability: no page errors on guest', pageErrors.guest.length === 0, pageErrors.guest[0]);

await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
