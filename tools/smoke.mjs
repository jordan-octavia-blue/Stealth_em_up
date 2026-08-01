/**
 * Phase 4 smoke harness — the §10.1 checklist, automated.
 *
 * Drives the production build in headless Chromium and asserts the state changes a
 * human would look for: the map builds, the hero moves and cannot be pushed through
 * geometry, guards patrol without ending up inside walls, doors open on contact and
 * block sight when shut, a shot kills, a bomb opens a hole that is walkable *and*
 * see-through, a corpse can be dragged, the loot run can be won, a restart rebuilds
 * everything, and an alarmed squad does not wedge itself permanently.
 *
 * It proves nothing throws and the state changes are right. It says nothing about
 * *feel* — wall sliding, drift, whether the fog reads well — which is what the human
 * playthrough in §10.1 is for.
 *
 * Not wired into CI: it needs a browser. To run it:
 *
 *   npm run build
 *   npx vite preview --port 4173 &
 *   npm i --no-save playwright
 *   node tools/smoke.mjs
 *
 * On a machine where Playwright manages its own browsers, drop CHROMIUM.
 * Env: BASE (default http://127.0.0.1:4173), CHROMIUM (executable path), SHOT.
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://127.0.0.1:4173';
const URL = `${BASE}/game.html?volume=0&level=bank_1`;

const results = [];
function check(name, ok, extra = '') {
  results.push({ name, ok, extra });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
}

const browser = await chromium.launch({
  ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}),
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];   // uncaught JS exceptions — the signal that matters
const netErrors = []; // network noise (analytics is blocked in this sandbox)
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !ignorable(m.text())) netErrors.push(m.text()); });
// google-analytics is blocked by the sandbox and has nothing to do with the game
const ignorable = (t) => /google-analytics|analytics\.js|favicon/.test(t);
page.on('requestfailed', (r) => { if (!ignorable(r.url())) netErrors.push('requestfailed ' + r.url()); });
page.on('response', (r) => { if (r.status() >= 400 && !ignorable(r.url())) netErrors.push(r.status() + ' ' + r.url()); });

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.fullscreen === 'function' && window.map_json, null, { timeout: 30000 });
await page.click('#start-btn');
await page.waitForFunction(() => window.state === 1 && window.hero && window.grid, null, { timeout: 30000 });
await page.waitForTimeout(600);

// --- map + physics build ----------------------------------------------------
const built = await page.evaluate(() => ({
  guards: window.guards.length,
  cells: window.grid.cells.length,
  fixtures: window.physics.fixtureCount,
  solid: window.grid.cells.filter((c) => c.solid || c.door).length,
  enableLOS: window.enableLOS,
}));
check('map loads, physics world built', built.fixtures > 0, JSON.stringify(built));
check('one fixture per solid cell/door', built.fixtures === built.solid, `${built.fixtures} vs ${built.solid}`);
check('fog of war is enabled', built.enableLOS === true);
check('no uncaught errors on load', errors.length === 0, errors.slice(0, 3).join(' | '));

// --- WASD movement + wall sliding ------------------------------------------
const before = await page.evaluate(() => ({ x: window.hero.x, y: window.hero.y }));
await page.keyboard.down('d');
await page.waitForTimeout(700);
await page.keyboard.up('d');
const after = await page.evaluate(() => ({ x: window.hero.x, y: window.hero.y }));
check('WASD moves the hero', Math.abs(after.x - before.x) > 40, `dx=${(after.x - before.x).toFixed(1)}`);

// hero never ends up inside a solid cell
const insideWall = await page.evaluate(() => window.grid.isWallSolid_coords(window.hero.x, window.hero.y));
check('hero is not inside a wall', insideWall === false);

// walk hard into a wall for 2s from a known spot and confirm we are stopped, not through
const walled = await page.evaluate(async () => {
  // find the nearest solid cell to the east and drive at it
  const startX = window.hero.x, startY = window.hero.y;
  return new Promise((resolve) => {
    let ticks = 0;
    const id = setInterval(() => {
      window.keys.d = true;
      window.keys.s = true;
      if (++ticks > 120) {
        clearInterval(id);
        window.keys.d = false;
        window.keys.s = false;
        resolve({
          startX, startY,
          x: window.hero.x, y: window.hero.y,
          inWall: window.grid.isWallSolid_coords(window.hero.x, window.hero.y),
        });
      }
    }, 16);
  });
});
check('hero cannot be pushed into geometry', walled.inWall === false, JSON.stringify(walled));

// --- guards patrol ----------------------------------------------------------
const patrol = await page.evaluate(() => {
  const start = window.guards.map((g) => ({ x: g.x, y: g.y }));
  return new Promise((resolve) => setTimeout(() => {
    const moved = window.guards.filter((g, i) =>
      Math.hypot(g.x - start[i].x, g.y - start[i].y) > 20).length;
    resolve({ moved, total: window.guards.length,
      withPaths: window.guards.filter((g) => g.path.length > 0 || g.target.x != null).length,
      inWalls: window.guards.filter((g) => window.grid.isWallPathBlocking_coords(g.x, g.y)).length });
  }, 3000));
});
check('guards patrol', patrol.moved > 0, JSON.stringify(patrol));
check('guards stay out of solid walls', patrol.inWalls === 0, JSON.stringify(patrol));

// --- doors ------------------------------------------------------------------
const doors = await page.evaluate(() => ({
  total: window.grid.door_sprites.length,
  open: window.grid.door_sprites.filter((d) => d.opened).length,
}));
check('doors exist', doors.total > 0, JSON.stringify(doors));

const doorTest = await page.evaluate(async () => {
  // a guard opens any door; the hero only opens unlocked ones (unchanged rule)
  // pick a door with open floor on both sides along one axis, so the probe ray only
  // ever meets the door itself
  const g = window.grid;
  let door = null, axis = 'v';
  for (const d of g.door_sprites) {
    if (d.opened || d.broken) continue;
    const w = d.relatedDoorWall;
    const n = g.getCellFromIndex(w.grid_index_x, w.grid_index_y - 1);
    const s2 = g.getCellFromIndex(w.grid_index_x, w.grid_index_y + 1);
    const e = g.getCellFromIndex(w.grid_index_x + 1, w.grid_index_y);
    const wst = g.getCellFromIndex(w.grid_index_x - 1, w.grid_index_y);
    if (n && s2 && !n.blocks_vision && !s2.blocks_vision) { door = d; axis = 'v'; break; }
    if (e && wst && !e.blocks_vision && !wst.blocks_vision) { door = d; axis = 'h'; break; }
  }
  if (!door) return { none: true };
  const wall = door.relatedDoorWall;
  const cx = wall.x + 32, cy = wall.y + 32;
  const probe = () => axis === 'v'
    ? window.physics.canSee(cx, cy - 60, cx, cy + 60)
    : window.physics.canSee(cx - 60, cy, cx + 60, cy);
  // hold the squad still: a patrolling guard drifting into the sensor would keep the
  // door open and this is a test of the door, not of patrol routes
  const frozen = window.guards.filter((g) => g.alive);
  for (const g2 of frozen) { g2.moving = false; window.physics.stop(g2); }
  const guard = frozen.find((g2) => Math.hypot(g2.x - cx, g2.y - cy) > 400) || frozen[0];
  const blockedBefore = !probe();
  window.physics.teleport(guard, axis === 'v' ? cx : cx - 48, axis === 'v' ? cy - 48 : cy);
  await new Promise((r) => setTimeout(r, 500));
  const opened = door.opened;
  const seeThrough = probe();
  window.physics.teleport(guard, axis === 'v' ? cx : cx - 500, axis === 'v' ? cy - 500 : cy);
  await new Promise((r) => setTimeout(r, 700));
  const res = { blockedBefore, opened, seeThrough, closedAgain: !door.opened,
    blockedAgain: !probe() };
  for (const g2 of frozen) g2.moving = true;
  return res;
});
check('a door opens for a nearby opener (sensor contacts)', doorTest.opened === true, JSON.stringify(doorTest));
check('an open door stops blocking sight', doorTest.seeThrough === true);
check('the door closes again and blocks sight again', doorTest.closedAgain && doorTest.blockedAgain, JSON.stringify(doorTest));

// --- fog --------------------------------------------------------------------
const fog = await page.evaluate(() => {
  const occ = window.fog ? window.fog.occluders() : null;
  return { occluders: occ ? occ.length : -1 };
});
check('fog occluders derived from the live grid', fog.occluders > 20, JSON.stringify(fog));

// --- shooting ---------------------------------------------------------------
const shot = await page.evaluate(async () => {
  const guard = window.guards.find((g) => g.alive);
  guard.moving = false;
  // park the hero a clear 120 px west of a guard, gun out, and fire down the line
  window.physics.teleport(window.hero, guard.x - 120, guard.y);
  window.hero.gunOut = true;
  window.hero.masked = true;
  await new Promise((r) => setTimeout(r, 200));
  const rayHitsGuard = window.physics.bulletHit(window.hero.x, window.hero.y, guard.x, guard.y, window.hero) || {};
  window.hero.aim.set(window.hero.x, window.hero.y, guard.x, guard.y);
  const gunsBefore = window.gun_drops.length;
  const bulletsBefore = window.bullets.length;
  window.hero.shoot();
  const spawned = window.bullets.length - bulletsBefore;
  const target = window.bullets.length ? { ...window.bullets[window.bullets.length - 1].target } : null;
  await new Promise((r) => setTimeout(r, 1500));
  return {
    heroToGuard: Math.round(Math.hypot(window.hero.x - guard.x, window.hero.y - guard.y)),
    rayOwnerIsGuard: rayHitsGuard.owner === guard,
    spawned, target,
    alive: guard.alive,
    bulletsLeft: window.bullets.length,
    gunDropped: window.gun_drops.length > gunsBefore,
    hasBody: window.physics.hasActor(guard),
  };
});
check('shooting a guard kills them', shot.alive === false, JSON.stringify(shot));
check('the dead guard drops their gun', shot.gunDropped === true);
check('a corpse leaves the physics world (draggable)', shot.hasBody === false);
check('the bullet is cleaned up', shot.bulletsLeft === 0);

// From here on the harness is checking systems, not survival: an alarmed guard 120 px
// away will happily shoot the one-hit-point hero and every later check would then be
// running against a corpse. The bomb check below still exercises a real kill, because
// the blast calls killHero() outright rather than going through health.
await page.evaluate(() => { window.hero.health = 999; });

// --- bomb: breach must be pathable, walkable AND transparent -----------------
const bomb = await page.evaluate(async () => {
  // find a solid, non-border wall cell with floor on both sides and blow it
  const g = window.grid;
  let target = -1;
  for (let i = 0; i < g.cells.length; i++) {
    const info = g.getInfoFromIndex(i);
    if (info.x_index < 2 || info.y_index < 2) continue;
    if (info.x_index > g.width - 3 || info.y_index > g.height - 3) continue;
    const c = g.cells[i];
    if (!c.solid || c.door) continue;
    const n = g.getCellFromIndex(info.x_index, info.y_index - 1);
    const s = g.getCellFromIndex(info.x_index, info.y_index + 1);
    if (n && s && !n.solid && !s.solid) { target = i; break; }
  }
  if (target < 0) return { target };
  const info = g.getInfoFromIndex(target);
  const cx = info.x_index * 64 + 32, cy = info.y_index * 64 + 32;
  // stand well outside the 200 px blast, or the hero dies here and the rest of the
  // checklist runs against a corpse
  window.physics.teleport(window.hero, cx, cy + 900);
  await new Promise((r) => setTimeout(r, 200));
  const before = {
    fixtures: window.physics.fixtureCount,
    sight: window.physics.canSee(cx, cy - 80, cx, cy + 80),
    walkable: window.nav.navGrid.walkable[target],
  };
  window.bomb.x = cx; window.bomb.y = cy;
  window.bomb.sprite.visible = true;
  window.explodeBomb();
  await new Promise((r) => setTimeout(r, 300));
  return {
    target, before,
    fixtures: window.physics.fixtureCount,
    sight: window.physics.canSee(cx, cy - 80, cx, cy + 80),
    walkable: window.nav.navGrid.walkable[target],
    solid: g.cells[target].solid,
    heroAlive: window.hero.alive,
  };
});
check('bomb removes wall fixtures', bomb.fixtures < bomb.before.fixtures, JSON.stringify(bomb));
check('the breach is see-through (fog + AI vision)', bomb.before.sight === false && bomb.sight === true);
check('the breach is walkable to nav', bomb.before.walkable === 0 && bomb.walkable === 1);
check('the hero survived the blast at range', bomb.heroAlive === true, JSON.stringify(bomb));

// --- guards path through the breach ----------------------------------------
const throughBreach = await page.evaluate(async () => {
  await new Promise((r) => setTimeout(r, 2000));
  return {
    moving: window.guards.filter((g) => g.alive && (g.path.length > 0 || g.target.x != null)).length,
    alive: window.guards.filter((g) => g.alive).length,
    moved: 0,
  };
});
check('guards keep getting routes after the breach', throughBreach.moving > 0, JSON.stringify(throughBreach));

// --- dragging a corpse ------------------------------------------------------
const drag = await page.evaluate(async () => {
  const corpse = window.guards.find((g) => !g.alive);
  if (!corpse) return { none: true };
  // Park the hero on open floor well clear of any door: pressing space next to a door
  // starts lockpicking and returns before it ever looks for a body to drag.
  const g = window.grid;
  const farFromDoors = (x, y) => g.doors.every((d) =>
    Math.hypot(x - (d.x + 32), y - (d.y + 32)) > g.cell_size * 3);
  let spot = null;
  for (let i = 0; i < g.cells.length && !spot; i++) {
    const c = g.cells[i];
    if (c.solid || c.door) continue;
    const cx = c.x + 32, cy = c.y + 32;
    if (farFromDoors(cx, cy)) spot = { x: cx, y: cy };
  }
  window.physics.teleport(window.hero, spot.x, spot.y);
  corpse.x = spot.x + 30;
  corpse.y = spot.y;
  await new Promise((r) => setTimeout(r, 200));
  window.keys.space = true;
  window.onkeydown({ keyCode: 32 });
  await new Promise((r) => setTimeout(r, 200));
  const grabbed = window.hero_drag_target === corpse;
  const from = { x: corpse.x, y: corpse.y };
  window.physics.teleport(window.hero, spot.x, spot.y + 300);
  await new Promise((r) => setTimeout(r, 900));
  const moved = Math.hypot(corpse.x - from.x, corpse.y - from.y);
  window.keys.space = false;
  window.onkeyup({ keyCode: 32 });
  window.hero_drag_target = null;
  window.hero.speed = window.hero.speed_walk;
  return { grabbed, moved };
});
check('a corpse can be grabbed and dragged', drag.grabbed === true && drag.moved > 40, JSON.stringify(drag));

// --- loot and the win condition ---------------------------------------------
const win = await page.evaluate(async () => {
  const money = window.loot[0];
  let carrying = false;
  for (let i = 0; i < 20 && !carrying; i++) {
    // the solver can nudge a body off an exact teleport, so keep re-seating it
    window.physics.teleport(window.hero, money.x, money.y);
    await new Promise((r) => setTimeout(r, 100));
    carrying = window.hero.carry === money;
  }
  let deposited = false;
  for (let i = 0; i < 20 && !deposited; i++) {
    window.physics.teleport(window.hero, window.getawaycar.x, window.getawaycar.y + 40);
    await new Promise((r) => setTimeout(r, 100));
    deposited = window.hero.carry === null;
  }
  return { carrying, deposited };
});
check('loot can be picked up', win.carrying === true, JSON.stringify(win));
check('reaching the van with the loot wins', win.deposited === true, JSON.stringify(win));

// --- restart tears the world down and rebuilds it ---------------------------
const restart = await page.evaluate(() => ({ before: window.physics.fixtureCount }));
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
const cleared = await page.evaluate(() => ({ ready: window.physics.ready, state: window.state }));
check('leaving a run drops the physics world', cleared.ready === false && cleared.state === 0, JSON.stringify(cleared));
await page.click('#start-btn');
await page.waitForFunction(() => window.state === 1 && window.hero && window.physics.ready, null, { timeout: 20000 });
await page.waitForTimeout(1200);
const rebuilt = await page.evaluate(() => ({
  fixtures: window.physics.fixtureCount,
  guards: window.guards.length,
  heroHasBody: window.physics.hasActor(window.hero),
  occluders: window.fog.occluders().length,
  guardsMoving: window.guards.filter((g) => g.path.length > 0 || g.target.x != null).length,
}));
check('restarting rebuilds the world cleanly', rebuilt.fixtures === built.fixtures && rebuilt.heroHasBody, JSON.stringify(rebuilt));
check('guards patrol again after a restart', rebuilt.guardsMoving > 0, JSON.stringify(rebuilt));

// --- soak: an alarmed squad must not wedge itself permanently ---------------
const soak = await page.evaluate(async () => {
  window.hero.masked = true;
  window.alert_all_guards();
  await new Promise((r) => setTimeout(r, 9000));
  // A guard is wedged if it is trying to walk somewhere and has not moved at all.
  // (Guards that have arrived, or stopped to shoot, are not wedged — `moving` is false
  // for the latter and there is no path for the former.)
  const wedged = () => window.guards.filter((g) =>
    g.alive && g.moving && (g.path.length > 0 || g.target.x != null));
  const before = wedged().map((g) => ({ g, x: g.x, y: g.y }));
  await new Promise((r) => setTimeout(r, 20000));
  const stillTrying = new Set(wedged());
  const stuck = before.filter((s) => stillTrying.has(s.g) && Math.hypot(s.g.x - s.x, s.g.y - s.y) < 10).length;
  const alive = window.guards.filter((g) => g.alive);
  return { total: window.guards.length, alive: alive.length, tracked: before.length, stuck,
    inWalls: alive.filter((g) => window.grid.isWallPathBlocking_coords(g.x, g.y)).length };
});
check('no guard is wedged for 20 s while trying to walk', soak.stuck === 0, JSON.stringify(soak));
check('no guard ends up inside a wall after 30 s of combat', soak.inWalls === 0, JSON.stringify(soak));

check('no uncaught page errors at all', errors.length === 0, errors.slice(0, 5).join(' | '));
console.log('network noise (informational): ' + (netErrors.length ? netErrors.slice(0, 4).join(' | ') : 'none'));

if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
