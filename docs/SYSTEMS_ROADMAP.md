# Systems Improvement Roadmap

A phased plan to modernize Stealth_em_up, fix its systemic pathologies, and land the headline
features: **better pathfinding**, a **drivable escape vehicle** with real car physics,
**destructible walls** that pathfinding and vision adapt to, **restored fog-of-war**, and
**much smarter, coordinated guards**.

Guiding constraints:

- Single-dev hobby project — pragmatic, incremental steps over grand rewrites.
- **The game must stay playable at every phase boundary.** No phase ends mid-rewrite.
- 40×40 grid, ~15 guards max — efficiency targets are sensible, not over-engineered, but the
  real pathologies (per-frame A\*, O(n·1600) collision, unbounded allocations) get fixed.

---

## 1. Where the code is today

> **Note (post-Phase 1):** this section describes the code as found. Phase 0 deleted the
> dead weight and Phase 1 moved `js/*.js` to `src/legacy/*.ts` under Vite — file paths
> below are the originals. The pathologies themselves are all still there; that is what
> Phases 2+ are for. **Post-Phase 2:** pathology #4 (framerate-dependent simulation and
> raw wall-clock AI timers) is fixed — fixed 60 Hz timestep plus the pausable
> `GameClock`. **Post-Phase 3:** pathologies #1 and #2 are fixed — `src/nav/` replaced
> the vendored A\* and its never-updated graph; the last item of #8 (the
> `alarmingObjects` array) is Phase 6 work. **Post-Phase 4:** #3 is fixed (planck.js:
> the hero's 1600-cell loop, the O(n²) guard separation and the doors×guards loop are
> gone, and guards collide with walls) and #7 is fixed (fog of war rebuilt and switched
> back on). Of #5, only the vision *raycast* changed — range, hearing, memory and
> de-escalation are still Phase 6.

The game is plain ES5 loaded as 27 ordered `<script>` tags in `game.html`, sharing ~100
globals. Pixi.js v3 is vendored in `bin/`. There is no npm, no bundler, no modules — the
current `package.json` is actually an nw.js 0.12.2 app manifest. `js/main.js` is a
2,969-line god module holding the game loop, all 12 `gameloop_*` subsystems, input,
particles, the bomb, and setup. `map_editor_js/` is a 5,232-line drifted near-duplicate of
`js/` whose host HTML page was deleted — it is orphaned dead weight.

### The load-bearing problems

| # | Problem | Where |
|---|---------|-------|
| 1 | **Per-frame A\* storm.** A guard with an empty path calls `getRandomPatrolPath()` — a full A\* — every frame. Unreachable random destinations (sealed rooms) make this loop forever, per guard (~15 with backup). Each search also resets all 1600 graph nodes in `astar.init`. | `js/main.js:835-836`, `js/jo_grid.js:320`, `js/astar.js:21` |
| 2 | **A\* graph is built once and never updated.** The bomb sets cells `solid=false` but never touches the graph or vision — blown-open walls stay impassable and opaque to guards forever. | `js/jo_grid.js:407-423`, `js/main.js:2702-2728` |
| 3 | **Brute-force collision.** Hero vs *all 1600 cells* every frame; O(n²) guard separation; doors×guards nested proximity loop; no spatial partitioning anywhere. Guards don't collide with walls at all (they trust A\*). | `js/main.js:1926-1939`, `:873-877`, `:1145-1161`, `js/jo_sprite.js:280-349` |
| 4 | **Framerate-dependent simulation.** `deltaTime` is computed and threaded everywhere but consumed almost nowhere — movement, bullets, and particles are per-frame constants, so the game speed follows the refresh rate. AI timers are raw `setTimeout`/`new Date()`: not pausable, fire after death, defended by ad-hoc `alive` checks. | `js/main.js:658`, `js/sprite_guard.js:107,114`, `js/jo_security_camera.js:50` |
| 5 | **AI is boolean flag soup.** No state machine — `alarmedPre/alarmed/chasingHero/moving/...` branched inline in `gameloop_guards`. No vision range limit, no hearing model (an unsilenced shot is a flat 500 px through-wall radius), no de-escalation (alarmed forever), and the only coordination is a global "everyone repath to the hero's last seen position" pulse — which is exactly why every guard funnels through the same door into the same killzone. | `js/main.js:693-879`, `:2513`, `js/sprite_guard.js` |
| 6 | **The getaway van is a prop.** A static sprite plus a 95 px proximity trigger for the win condition. Nothing to build on. | `js/main.js:1409-1452`, `:622-629` |
| 7 | **Fog-of-war is disabled.** The LOS "starburst" system exists but is buggy and switched off (`const enableLOS = false`). Its occluder points are computed once at setup and would never track doors or destroyed walls anyway. | `js/main.js:18`, `:1489-1765`, `js/sprite_hero.js:209` |
| 8 | Assorted perf/latent bugs: blood-trail `PIXI.Graphics` accumulates draw commands forever (`noClear=true`); `console.log` in the bullet hot path; a 10 ms `setInterval` bomb timer; a misplaced parenthesis that puts `< 100` *inside* `get_distance`'s arguments; a `wilLCauseAlert` typo in the (dead) civilian path; the `alarmingObjects` array grows forever and is raycast per guard per entry per frame. | `js/main.js:1894-1914`, `:1064-1067`, `:2676`, `:815`, `:897`, `:736-741` |

---

## 2. Target architecture

### 2.1 Tooling: Vite + ES modules + TypeScript

- **Vite** replaces `python SimpleHTTPServer` / `local_server_for_testing.bat`: instant dev
  server with HMR, ESM-native, and **Vitest** shares its config so unit tests come nearly
  free. The 27 script tags in `game.html` become one `<script type="module">` entry.
- The repo gets a real npm `package.json`; the current nw.js manifest is set aside (nw.js
  0.12.2 is a decade old — if a desktop build is wanted again, Electron/Tauri later).
- **Full TypeScript conversion** of the existing code:
  - Start with a *loose* `tsconfig.json` (`strict: false`, `noImplicitAny: false`,
    `allowJs: true` during the rename window) so legacy files compile as `.ts` with minimal
    edits. The goal of the first pass is renaming + module syntax, not re-typing the world.
  - Define shared interfaces early (`Entity`, `Wall`, `Gun`, `MapData`, …) in
    `src/types.ts` and annotate the legacy prototype-closure classes against them
    incrementally.
  - Ratchet strictness (`noImplicitAny`, then `strict`) directory-by-directory as files are
    refactored. All **new** systems (`src/nav/`, `src/ai/`, `src/physics/`, …) are written
    strict from day one.
- **jQuery** is used only for the map XHR — replace with `fetch()` and drop the CDN tag.

### 2.2 Strangling `main.js` — no big bang

1. **Mechanical conversion first.** Every `js/*.js` file gets `export` statements and a
   `.ts` rename; a single `src/legacy-bridge.ts` imports them in the old script-tag order
   and assigns the globals the untouched code still expects (`window.grid = grid`, …). The
   game behaves identically; verification is binary (it loads and plays, or it doesn't).
2. **Then extract one subsystem at a time.** The `gameloop_*` functions are already cleanly
   separated (`main.js:693/880/933/1014/1141/1191/1239/1279/1409/1453`). Each one moves to
   `src/systems/<name>.ts`, swaps global reads for imports/parameters, and is deleted from
   `main.js`. The god module shrinks monotonically; the bridge shrinks as globals lose
   their last consumer.
3. **Event bus early.** A tiny `src/core/events.ts` (~30 lines, `on/off/emit`) is the seam
   every later system plugs into: wall destruction, AI stimuli (sounds), squad
   notifications, FX.

### 2.3 Rendering: keep Pixi v3 for now, isolate it

Pixi v3 works, and this game's rendering needs (sprites, a tilemap, particles) gain nothing
from v8 today — while the v3→v8 API churn (loader removal, `PIXI.extras` removal, Graphics
rewrite, async init) is pure cost. Instead: as systems are extracted, route all Pixi calls
through a thin `src/render/` layer (sprite creation, layers/z-order, autotile, fog, debug
draw). Once simulation code no longer touches `PIXI.*` directly, the v8 upgrade becomes a
contained, optional render-layer task (Phase 9).

---

## 3. Physics: planck.js

### 3.1 Why planck.js

| Criterion | planck.js | matter.js | Rapier (WASM) |
|---|---|---|---|
| Top-down car | Canonical Box2D top-down-car recipe, well documented | Doable, but soft constraint solver drifts | Doable |
| Destructible static geometry | `destroyFixture()` — trivial | OK | OK |
| Raycasts (bullets, vision) | First-class `world.rayCast` with fractions + filtering | Weak (region query, not a true raycast) | First-class |
| CCD (fast car, no tunneling) | Per-body `bullet: true` | **None** — known tunneling issues | Yes |
| Maintenance / footprint | Active, ~50 KB gz, pure JS/TS, sync init | Active, but solver quality is the recurring complaint | Very active, but WASM + async init friction |

matter.js is eliminated by the two core needs (CCD for a fast car, real raycasts for
bullets and vision). Rapier is excellent but WASM/async-init and its Rust-flavored API are
extra friction for zero benefit at ~20 dynamic bodies. **planck.js** gives Box2D semantics
and the exact top-down car technique from the Box2D literature, in plain TypeScript.

### 3.2 Integration (`src/physics/`)

- **Scale:** 64 px tile = 2 m (`PPM = 32`); hero/guard radius ≈ 0.6 m — inside Box2D's
  happy 0.1–10 m range. Gravity `(0, 0)`.
- **Walls:** one static body for the whole grid with a 2 m box **fixture per solid cell**
  (userData = cell index). ~400 fixtures is nothing at this scale, and per-cell fixtures
  make destruction a single `destroyFixture` call. Deliberately *not* greedy-merging
  rectangles — merging complicates destructibility for no measurable gain on a 40×40 map.
- **Doors:** kinematic body per door; fixture toggles sensor/solid on open/close/broken.
  Contact events replace the per-frame doors×guards proximity loop.
- **Hero & guards:** dynamic circles, `fixedRotation: true` (facing stays a game-logic
  angle), high linear damping; movement = set linear velocity from input/AI each fixed
  step. This **deletes** the 1600-cell hero collision loop, the corner/side pushout code,
  and the O(n²) guard separation — Box2D's broadphase *is* the spatial partition the
  codebase never had. Guards finally collide with walls too.
- **Bullets:** **raycasts, not bodies.** `world.rayCast` from the muzzle, first accepted
  hit wins; the visible tracer is pure VFX. (The current swept-segment bullet code is one
  of the few well-done parts, but raycasts are simpler still and share filtering with
  vision.)
- **Car:** dynamic box with `bullet: true` (CCD) — see §7.
- **Collision categories:** `WALL, DOOR, HERO, GUARD, CAR, LOOT_SENSOR, VISION_BLOCKER`.
  Vision rays filter on `WALL | DOOR(closed) | VISION_BLOCKER`; bullet rays on
  `WALL | DOOR | HERO | GUARD | CAR`. Future smoke grenades are `VISION_BLOCKER` sensor
  fixtures and need zero bespoke vision code.
- **Stepping:** fixed `1/60` timestep with an accumulator (delivered by Phase 2's clock).
  At a 60 Hz sim, render interpolation can be skipped initially.

### 3.3 Top-down car model

Single body, standard Box2D recipe (~80 lines, tunes well):

1. Each step, decompose velocity into forward (`dot(v, forward)`) and lateral
   (`dot(v, right)`) components.
2. **Kill lateral velocity** with impulse `-lateralVel * mass`, clamped to
   `maxLateralImpulse` — the clamp is the drift knob (handbrake raises it → sliding).
3. Apply drive force along forward for throttle/reverse; angular impulse for steering,
   scaled by speed (no steering while stationary, sign-flipped in reverse).
4. Rolling resistance + angular damping.

Skip the multi-body/revolute-joint variant — unnecessary for top-down feel.

---

## 4. Pathfinding v2 (`src/nav/`)

**Stay grid-based.** 40×40 = 1600 nodes; a full Dijkstra over the whole grid is
microseconds. That cheapness is a feature — it makes flow fields and region labeling
essentially free. The vendored `js/astar.js` is replaced by a small in-house module: typed,
unit-tested, owning its data layout.

- **Search:** A\* on an **8-connected** grid with the **octile heuristic**;
  corner-cutting forbidden (a diagonal step requires both orthogonal neighbors walkable —
  prevents wall-corner clipping). **JPS rejected:** it assumes uniform edge costs, which
  the cost layers below violate — and plain A\* is already sub-millisecond here. The
  existing string-pulling idea (`reducePathWithShortcut`) is kept but reimplemented against
  grid flags (later, physics raycasts) and unit-tested.
- **Data layout:** flat typed arrays per layer (`walkable: Uint8Array`,
  `baseCost/dangerCost/doorCost: Float32Array`) plus a per-search **generation stamp** on
  nodes — one integer compare replaces `astar.init`'s reset-all-1600 loop.
- **Region labels:** connected-component flood fill, recomputed on any walkability change
  (O(1600)). Patrol destinations are sampled *only from the requester's region* —
  reachability is a guaranteed O(1) check. Combined with a failure cooldown, this kills
  pathology #1 outright.
- **Path-request scheduler:** `nav.requestPath(from, to, opts): PathHandle` feeding a queue
  processed under a per-frame budget (e.g. max 4 searches or 0.5 ms). Requests carry
  priority (combat > investigate > patrol) and are coalesced (a re-request cancels the
  pending one); callers keep their old path until the new one arrives. **Nothing outside
  `src/nav/` ever calls A\* directly.**
- **Flow field for convergence:** when the squad converges on one target (hero last-known
  position), run ONE reverse Dijkstra from the target producing distance + best-direction
  per cell; every converging guard steers by table lookup — 15 guards converge for the
  price of one search. Rebuilt when the target moves ≥ 1 tile or on `nav:dirty`. The
  distance field double-serves as the **hearing-occlusion model** (§5) and as "path
  distance to hero" for AI utility scoring.
- **Cost layers** (summed at node expansion):
  - `baseCost` — 1 for floor; slightly higher for restricted tiles and rubble.
  - `doorCost` — static chokepoint penalty per door, **plus** dynamic per-squad
    "claimed entry" spikes (§6) — the mechanical half of the door-funnel fix.
  - `dangerCost` — a 40×40 float heatmap: large splatted deposits where allies die, small
    deposits on gunfire cells, exponential decay per second. Pure math, fully
    unit-testable.
- **Dynamic updates:** walkability derives from grid cell flags, so a destroyed wall is
  just `events.emit('nav:dirty', cellIndex)` → set walkable → relabel regions → invalidate
  live flow fields. This fixes pathology #2.

---

## 5. Guard AI v2 (`src/ai/`)

### 5.1 Hierarchical FSM (not a behavior tree)

For a solo dev with ~7 behaviors, an explicit FSM is easier to write, debug (current state
renders in an overlay), and unit-test. Behavior trees pay off with editor tooling and
dozens of leaf nodes — neither exists here. A `GuardBrain` owns `state` with
`enter/update/exit`, plus `Perception` and `Memory` structs. The flag soup maps to:

```
PATROL → SUSPICIOUS → INVESTIGATE → COMBAT { Engage | HoldAtEntry | Flank | TakeCover }
       → SEARCH → PATROL          plus: FLEE, DEAD
```

Transitions are **pure functions** of (perception, memory, blackboard) — directly testable
in Vitest.

### 5.2 Perception

- **Vision:** keep the cone (tune ~120°), add a **max range** (~450 px — today it's
  unlimited), and an **awareness meter** (0→1) that fills at a rate scaled by distance,
  target speed, and stance. Replaces instant detection with readable "?!" telegraphing.
  The LOS check becomes a physics raycast (replacing the grid-DDA raycaster and its
  40-step silent-pass cap).
- **Hearing:** sounds are bus events `{pos, loudness, type}` (gunshot, breach, car engine,
  glass). Audibility = nav **distance-field** distance from the sound ≤ loudness × k — so
  occlusion falls out of pathfinding for free: sound "travels around" walls with falloff
  instead of today's flat 500 px through-wall radius. Silenced weapons emit low loudness.
- **Memory:** `lastKnownPos`, `lastKnownVel`, `lastSeenTime`, with decay. Replaces the
  append-only `alarmingObjects` array (stimuli are consumed once; memory fades).
- **De-escalation:** a global `alertLevel` (calm → suspicious → alarmed → lockdown) that
  decays without fresh stimuli. Guards drop from SEARCH back to PATROL, patrolling near the
  last-known position first. "Alarmed forever" goes away.

### 5.3 Squad coordination — the door-funnel fix

One `SquadBlackboard` shared by all guards:

- **Fused belief:** any guard's sighting updates a shared hero last-known-position/time.
- **Entry-point assignment:** when converging on a room, compute candidate entries (doors
  *and destroyed-wall gaps* bordering the target region) and assign guards round-robin,
  weighted by each guard's path distance and the entry's `dangerCost`. Each claimed entry
  writes a temporary `doorCost` spike for *other* guards, so their A\* naturally routes
  them to different entries — **flanking emerges from cost shaping**, not scripting.
- **Danger map:** guards who watch an ally die at a chokepoint deposit heavy danger there;
  subsequent paths route around it. This is the direct "stop walking into the meat
  grinder" fix.
- **Staggered entry:** one entry token per entry point — at most one guard committed
  through a given door at a time. Others `HoldAtEntry` at a stack point offset out of the
  door's LOS slice and **peek** (step-out/step-back with a fire window) instead of standing
  in the funnel.
- **Self-preservation (FLEE):** a utility check each second in COMBAT over hp fraction,
  living allies nearby, and recently witnessed ally deaths — below threshold, retreat
  toward the alarm/backup point and regroup. The last guard alive does not charge.

### 5.4 Health, damage, backup

- Replace one-shot `kill()` with `takeDamage(amount, type, sourcePos)`: guards get
  `hp: 100`; weapon damage comes from the data-driven weapon table (§8.2); car impact
  damage ∝ impulse. Hero keeps existing rules initially.
- **Backup** arrives in waves of 2–3 at intervals, entering already in COMBAT with the
  blackboard belief — not 7 guards at one fixed point.
- **Patrols:** the map format gains optional named patrol routes (§6.3); region-safe random
  wander remains the fallback.

---

## 6. Destructible walls

### 6.1 Data

Cells gain `material` and `hp`, driven by `data/tileset.json` keyed by tile code:
`{ material: 'drywall'|'brick'|'concrete'|'steel', hp, blocksVision, rubbleTile }`.
Steel and map-border cells are indestructible (preserving the existing border guard in the
bomb code). Doors unify into the same system (hp instead of the `broken` boolean).

### 6.2 One damage entry point, one destroy pipeline

All damage flows through `grid.damageCell(index, amount, type)` — bullets (small, only vs
weak materials), bomb (large radial), frag grenade (same path as bomb), car impact
(∝ impulse, weak materials only).

On destruction, ordered listeners on `events.emit('cell:destroyed', index)`:

1. **Grid flags:** `solid=false, blocks_vision=false, door=false`; tile becomes rubble
   (`baseCost` raised slightly so paths prefer clean floor).
2. **Nav:** mark walkable, relabel regions, invalidate flow fields (§4).
3. **Physics:** queue `destroyFixture` for the cell's fixture, applied post-step (Box2D
   forbids mid-step destruction).
4. **Vision/fog:** invalidate the fog occluder cache (§8.1) — AI raycasts already see
   through automatically because the fixture is gone. Destroyed walls are immediately
   transparent to both guards and the player's fog-of-war.
5. **Autotile:** refresh the cell + 8 neighbors via the existing `findWallType` logic,
   extracted to `src/render/autotile.ts`.
6. **FX:** debris particles, dust, and a loud **sound event — guards hear breaches** (§5.2).
7. **AI:** deposit moderate danger at the breach and notify the blackboard of a new
   candidate entry point (§5.3).

### 6.3 Map format

`.jomap` gains `version`, `tilesetRef`, optional `patrolRoutes`, optional per-cell hp
overrides. A small versioned loader (`src/map/loader.ts`) migrates v1 maps (the current
`bank_1.jomap`) transparently. This loader is also the map editor's foundation (§9).

---

## 7. Drivable escape car

Make the **getaway van itself drivable** — minimal new content, maximal payoff.

- **Enter/exit:** interact key near the driver door; hero sprite hides and input routes to
  the car controller; exit re-spawns the hero beside the door (physics overlap query
  guards against blocked exits). Guards who saw the hero enter transfer their target to
  the car.
- **Controls:** W/S throttle/reverse, A/D steer, Space handbrake (drift via the
  lateral-impulse clamp, §3.3). Speed cap; engine sound pitch ∝ speed — and the engine is
  **loud**, i.e. a hearing stimulus.
- **Camera:** car mode zooms out ~1.3× and leads the car by `velocity × lookaheadTime`
  (smoothed).
- **Running over guards:** contact listener; closing speed above threshold →
  `takeDamage(impulse × k)` + knockback. Car takes cosmetic damage (optional hp later).
- **AI reaction:** the car is a perceived threat with velocity. Guards in its path
  (dot-product cone + time-to-impact) execute a perpendicular **dodge** micro-behavior
  (~0.5 s movement override), then resume; guards fire at the occupied car.
- **Walls:** car vs concrete = hard stop; car vs drywall at speed = breach via
  `damageCell` (§6) — **crashing through a weak wall to escape** falls out of the pipeline
  for free.
- **Win condition:** replaces the 95 px proximity trigger. Win = *in the van, carrying the
  loot, reach the escape zone* (a map-edge trigger region in the map objects) — the ending
  becomes an actual escape drive under fire.

---

## 8. Fog-of-war, and future-proofing hooks

### 8.1 Fog-of-war / LOS restoration (must survive wall destruction)

The disabled `enableLOS` starburst system is **rebuilt, not deleted**, as
`src/render/fog.ts`:

- **Occluder cache:** vision-blocking edges are derived from *live* grid + door state (not
  collected once at setup like today's `losPoints`). The cache is invalidated by door
  open/close events and `cell:destroyed` (§6.2 step 4) and lazily rebuilt — on a 40×40
  grid a full rebuild is trivially cheap, so no partial-update cleverness is needed.
- **Per frame:** a standard angular-sweep visibility polygon from the hero (rays to
  occluder corners ± ε, sorted once by angle), rendered into the mask `RenderTexture` the
  existing pipeline already uses. This replaces the buggy starburst's re-sort +
  splice-reorder per frame and its temporary `unit.x/y` mutation hack.
- **One source of truth:** the same occluder set / physics filters serve guard vision,
  security cameras, and the player's fog — blow a hole in a wall and *everyone* can see
  through it, in both directions.
- The old starburst code (`main.js:1489-1765`, `setupLOS`) is deleted only when the
  replacement ships (Phase 4b), and `enableLOS` is turned back on for good.

### 8.2 Grenades (build later, design now)

Weapon/throwable definitions move to `data/weapons.json`:
`{ id, damage, loudness, fuseMs, radius, effects: [...] }` — guns migrate to the same
table (they currently have no damage stat at all; damage is implicit one-shot-kill).
The three grenade types are pure composition of systems this roadmap already builds:

- **Frag:** radial `damageCell` (§6) + radial `takeDamage` (§5.4) + loud hearing event.
- **Smoke:** N short-lived `VISION_BLOCKER` sensor fixtures (§3.2) — guard vision rays and
  the fog occluder query hit them; zero bespoke vision code.
- **Flash:** LOS-checked radius query → `perception.blind(durMs)` (awareness frozen,
  vision range ≈ 0) — a pure Perception-module effect.

Throw arc = lerp with faked height (top-down; no physics body until it lands).

### 8.3 Map editor (build later, hooks now)

**Delete `map_editor_js/` immediately** (23 files, 5,232 lines, orphaned, drifted — it
taxes every refactor). The future editor is a second Vite entry (`editor.html` →
`src/editor/`) that **imports the same modules the game uses**: map loader/saver (§6.3),
grid, autotile renderer, tileset JSON. The hooks that make that cheap are already in this
plan: versioned map schema, render layer separated from simulation, constants in
`data/*.json`. Until then, the original Tiled `.tmx` sources in `working_files/` remain
the editing path (document a tmx→jomap conversion).

---

## 9. Phases

Each phase ends with the game playable start-to-finish.

### Phase 0 — Triage the current code (days) ✅ done

Fix the worst live bugs in place, before any restructuring, so later phases measure
against a sane baseline:

- Per-frame A\* storm: cooldown + retry backoff on `getRandomPatrolPath` (`main.js:835`).
- The `main.js:815` misplaced-paren distance check; the `wilLCauseAlert` typo (`:897`).
- Blood-trail `PIXI.Graphics` unbounded accumulation; `console.log` in the bullet path;
  the 10 ms bomb `setInterval` → frame-loop countdown; per-frame `new Date()` in camera
  swivel.
- **Delete:** `map_editor_js/` (all 23 files), `js/images.js` (fully commented),
  `jo_grid.js:426-541` (commented-out old `getPath`), hardcoded legacy maps at
  `jo_grid.js:2-106`, `bin/OLD/`, `drawPath.html`, `maps/*.php`, and the dead civilian
  system (`sprite_civ.js` + `gameloop_civs`) unless civilians are a wanted feature.
  **Keep** the disabled LOS/starburst code — it's replaced in Phase 4b, not dropped.
- **Verify:** full playthrough (stealth win, loud win, death); record a Stats.js
  frame-time baseline with ~15 guards.

#### What shipped

Bug fixes:

| Fix | Where |
|---|---|
| Patrol repath throttle: 250 ms minimum interval, plus exponential backoff (250→3000 ms, jittered) when a search returns no path | `sprite_guard.js` `getRandomPatrolPath` |
| Misplaced paren — `get_distance(…, y < 100)` → `get_distance(…) < 100`, so alarmed guards only re-aim at a waypoint they are actually near | `main.js` `gameloop_guards` |
| Blood trail baked into a `RenderTexture` every 200 splats, then the `Graphics` is cleared — the draw-command list is now bounded | `main.js` `drawBloodTrail` / `bakeBloodTrail` |
| Three `console.log`s removed from the per-bullet riot-shield check | `main.js` `gameloop_bullets` |
| Bomb fuse moved from a 10 ms `setInterval` to `gameloop_bomb(deltaTime)`; explosion body extracted to `explodeBomb()` | `main.js` |
| Camera swivel wait moved from two `new Date()` calls per camera per frame to a `deltaTime` countdown | `jo_security_camera.js` `swivel(deltaTime)` |
| **Found while verifying:** `img_burn_mark` is undefined (the art is gone from disk *and* the spritesheet), so *every* explosion threw before reaching the "did the blast kill the hero" check — the hero could stand on their own bomb and live. Burn-mark doodad removed; the blast damage check now runs. | `main.js` `explodeBomb` |

The `wilLCauseAlert` typo needed no separate fix — it only existed in `gameloop_civs`, which
was deleted with the rest of the civilian system.

Deleted: `map_editor_js/` (23 files), `js/images.js`, `js/sprite_civ.js` + `gameloop_civs`
and every `civs` reference, `drawPath.html`, `bin/OLD/`, `maps/get-data.php`,
`maps/r2015.php`, and 222 lines of dead code from `jo_grid.js` (the two hardcoded legacy
maps and the commented-out old `getPath`). `menu.html`'s community-map list XHR pointed at
the now-deleted `maps/get-data.php`; that page is not the live entry point
(`game.html?level=bank_1` is) and the request could never have worked on static hosting
anyway. The disabled LOS/starburst code is untouched, as planned.

#### Phase 0 baseline

Measured headless (Chromium + Playwright, software rendering) on `bank_1`, alarmed squad
with all backup spawned — **20 guards**, i.e. above the ~15 target. `gameloop()` wall time,
sampled over 8 s:

| | mean | p50 | p95 | max |
|---|---|---|---|---|
| master (pre-Phase 0) | 0.33 ms | 0.30 ms | 0.50 ms | 2.40 ms |
| Phase 0 | 0.38 ms | 0.40 ms | 0.50 ms | **0.60 ms** |

Mean is a wash on `bank_1` — the map is well connected, so patrol destinations are almost
always reachable and the A\* storm rarely fires in ordinary play. The tail is where it shows:
max frame cost drops 2.40 ms → 0.60 ms.

The storm itself was measured directly, by stubbing `grid.getPath` to always return no path
(the sealed-room case) and counting searches with 6 guards:

| | A\*/sec, normal patrol | A\*/sec, all destinations unreachable |
|---|---|---|
| master | ~0 | **166** |
| Phase 0 | ~0.3 | **8** |

Use these numbers as the reference point for the Phase 3 and Phase 4 comparisons.

### Phase 1 — Tooling: Vite + TypeScript + Vitest (days) ✅ done

Real npm `package.json`; Vite; mechanical ESM + `.ts` conversion of `js/*` with the
`src/legacy-bridge.ts` window bridge (loose tsconfig, §2.1); jQuery → `fetch`; Vitest with
first tests against the pure-math files (`jo_math`, `jo_utility`). Optional CI
(`vitest run` + `vite build`).
**Verify:** behaviorally identical game under `npm run dev` and `npm run build && preview`.

#### What shipped

- **npm + Vite + Vitest + TypeScript.** The nw.js manifest moved to `nw-package.json`;
  `package.json` is now a real one (`dev` / `build` / `preview` / `typecheck` / `test`).
  `vite.config.ts` is multi-page (`index`, `game`, `menu`, `keybindings`) and shares its
  config with Vitest. `local_server_for_testing.bat` is gone. CI runs typecheck, tests and
  a production build on every push.
- **`js/*.js` → `src/legacy/*.ts`**, converted by a codemod, not by hand. `tsconfig.json`
  is loose as planned (`strict: false`, `noImplicitAny: false`); `npm run typecheck`
  passes.
- **The bridge.** `src/legacy-bridge.ts` imports the 25 files in the old script-tag order;
  `src/legacy-globals.d.ts` declares the ~300 shared names so the untouched code still
  type-checks. One deviation from §2.2 worth recording: the roadmap pictured the bridge
  itself doing `window.grid = grid`, but a re-export from the bridge snapshots the value
  at import time and goes stale on the next assignment. Mutable globals are therefore
  published *inside* each legacy file (top-level `var x = …` became `window.x = …`), and
  functions are republished in an `Object.assign(window, { … })` at the bottom of each
  file. The bridge owns load order and documents the contract; extraction work still
  deletes one import here and one name from the `.d.ts` per subsystem.
- **jQuery is gone** from the game: the map XHR is `fetch` (with the error handler kept as
  the second argument to `.then`, so a failed request still alerts but a bad map or a
  broken `windowSetup` surfaces instead of being reported as "file not found"), and the
  three DOM calls are plain DOM. `menu.html` keeps its own jQuery for the hub screens; it
  no longer `<script>`-preloads the whole game, and the one module it does need
  (`jo_local_storage`) arrives via `src/menu.ts`.
- **First Vitest suites:** 45 tests over `jo_math` and `jo_utility` — movement stepping,
  rotation, the biased RNG, angle/arc wrap-around, circle-segment intersection, LOS
  quicksort. Several pin known quirks (`randomFloatWithBias`'s `min` shifts rather than
  bounds the range; a segment entirely inside a circle reads as a *miss*) so Phases 3–4
  can't change them by accident.

#### Two real bugs the conversion exposed

ES modules are always strict; the old `<script>` tags were sloppy. Two classes of latent
bug only showed up because of that, and both would have been silent breakage:

| | |
|---|---|
| **~55 implicit globals.** `onAssetsLoaded()` assigned every `img_*` sprite-sheet handle without `var`, as did `shard`/`shell`/`currentShard`/`shardImages`/`percent`/`mouse_click_obj`. Sloppy mode created a global; strict mode throws `ReferenceError`. They are now explicit `window.*` writes at the assignment sites — behaviour identical, and `legacy-globals.d.ts` flags which ones are actually dead or want to be locals. | `images_from_sheet.ts`, `main.ts`, `jo_progress_bar.ts` |
| **The vendored UMD wrappers broke bundling.** `astar.js` and `Stats.js` sniff for CommonJS before falling back to `window`. Seeing `module.exports` in the source made Vite classify the *whole chunk* as CommonJS and hand it a real `module` object, so astar registered into a throwaway export: `window.astar`/`window.Graph` were never set and the build died on the first path request. Dev was unaffected, which is exactly how this reaches production unnoticed. Both wrappers now take the browser branch unconditionally. | `astar.ts`, `Stats.ts` |

#### Phase 1 verification

The §10 smoke checklist was automated (Playwright driving Chromium) and run against three
targets: the pre-conversion commit, `npm run dev`, and `npm run build` + `preview`. It
covers map load, WASD movement, guard patrol, camera sweep, loot pickup, shooting a guard
(death, gun drop, blood, squad alert), the full bomb path (plant, fuse countdown, pause
freezes and resumes it, blast opens a wall and kills the hero standing on it), and the win
condition. **All three produce byte-identical results.**

The one caveat: the sandbox blocks outbound CDNs, so the baseline had to be run with a
locally-served jQuery — which is itself a small argument for the `fetch` swap, since the
unmodified `master` page cannot start at all without reaching `ajax.googleapis.com`. A
human playthrough for *feel* is still worth doing; the automated pass only proves nothing
throws and the state changes match.

#### Follow-ups after the Phase 1 review

Two things landed on top of the conversion, both at the maintainer's request:

- **The upgrades metagame is gone.** `get_upgrades_from_storage.ts` is deleted and the
  hero's stats are plain literals — the shop's starting values, so the loadout is
  unchanged. `menu.html` loses the shop panel, its "Upgrade" nav entry, the money readout
  and the CSS/JS behind them; its Mission Select, Controls and achievements screens stay,
  as does the wins/loses/kill-counter localStorage they read. `game.html` now defaults to
  `volume=1.0&level=bank_1` when the query string is absent, so opening it bare behaves
  exactly like the canonical URL, and `index.html`'s Play button links straight there. The
  win screen's "Back to Hub" button becomes "Play Again".
- **HiDPI canvas bug fixed** (pre-existing, not from the conversion — `origin/master`
  reproduces it identically). `PIXI.autoDetectRenderer(w, h, {resolution})` sizes the
  canvas *backing store* to `w x resolution` but never sets a CSS size, so on any display
  with `devicePixelRatio > 1` the element laid out at 2-3x the window. The page scrolled,
  most of the canvas sat off-screen, and `camera.getMouse` — which assumes canvas pixels
  are window pixels — mapped the mouse to the wrong world point: the hero could only aim
  into one region and the camera chased a bogus position. `windowSetup` now sets the CSS
  size the way `window.onresize` always did (which is why resizing the window used to fix
  it), and `mouseMove` reads `clientX/clientY` instead of `pageX/pageY` so a scrolled page
  can't skew aim either. Verified with a pinned-camera probe: screen-to-world is now
  identical at devicePixelRatio 1, 2 and 3.

### Phase 2 — Core loop: fixed timestep, clock, events (~1 week) ✅ done

Accumulator-based fixed 60 Hz update (fixes framerate-dependent speed — a prerequisite for
physics tuning). A pausable `GameClock` (`after(ms)`, `every(ms)`) replaces every raw
`setTimeout`/`new Date()` in gameplay code — kills the fires-after-death timer bugs and
makes pause real. Event bus lands. Extract 2–3 easy systems (input, camera, particles) to
prove the strangler loop.
**Verify:** cap FPS at 30 — movement speed unchanged; pause mid-"investigate" — the timer
resumes correctly. Unit tests: clock.

#### What shipped

- **Fixed 60 Hz timestep.** `animate()` accumulates wall time and runs `gameloop()` in
  fixed `1000/60` ms steps; per-frame movement constants are now per-*tick* constants, so
  game speed is independent of the display's refresh rate. Frame deltas are clamped to
  250 ms (a backgrounded tab or a too-slow machine slows down instead of freezing in a
  catch-up spiral), and `startGame` resets the accumulator so a stay in the menu isn't
  simulated as one burst.
- **`GameClock`** (`src/core/clock.ts`, strict TS): `now() / after(ms) / every(ms) /
  cancel / clear`, ticked once per fixed step from `gameloop()` — so pausing the game
  freezes every pending gameplay timer for free, and timers can no longer fire into a
  torn-down run. Every raw gameplay `setTimeout` migrated: guard shoot-reaction, guard
  see-something-alarming reaction and its alert-the-others chain (guards *and* cameras),
  `setLastSeen`'s 2 s confirmation, the choke-out kill, backup spawn waves, and the alert
  icon's hide delay. The patrol-repath backoff from Phase 0 now counts game time
  (`gameClock.now()`), not wall time, so pause doesn't burn it down. `clearStage()`'s
  clear-*every*-timeout-id-on-the-page hack is one `gameClock.clear()` now.
- **Event bus** (`src/core/events.ts`): `on/off/emit`, with one real subscriber to prove
  the seam — camera kickback is now `events.emit('camera:kickback')` from the two shoot
  paths, and the camera system listens. Sounds, wall destruction and squad signals plug
  into the same bus in Phases 5–6.
- **Three systems extracted** from `main.ts` (roadmap §2.2, mechanical move — they still
  read shared world state as window globals, but legacy files now *import* the extracted
  functions, and ~20 names left `legacy-globals.d.ts` and the window republish lists):
  - `src/systems/input.ts` — key/mouse/wheel handlers, `removeHandlers`, the walk
    animation check. `hero_moving` became a module local.
  - `src/systems/camera.ts` — zoom, loose follow + clamping, shake, kickback.
    `kickback_speed/amount` became module locals; dead `scaleStageChild` deleted.
  - `src/systems/particles.ts` — shells/shards/blood ticking (`updateParticles`), the
    splatter/eject spawners. `shard/shell/shard_limit/shell_speed/blood_speed` became
    module locals.
  `main.ts` is down to 2,297 lines from 2,969.

#### Phase 2 verification

22 new Vitest cases (clock: ordering, catch-up without drift, cancel/clear mid-update,
the nested-timer pattern the guard AI uses; bus: subscribe/unsubscribe during emit) on
top of the Phase 1 suites — 67 total, all green, plus typecheck and production build.

Headless Playwright (software rendering, so "native" is CPU-bound ~22–25 FPS; the caps
skip every 2nd/4th rAF callback). Hero walk speed, design value **240 px/s** (4 px/tick
× 60 Hz):

| build | ~25 FPS | ~21 FPS | ~13 FPS |
|---|---|---|---|
| pre-Phase 2 | 80.3 px/s | 77.6 px/s | 46.6 px/s |
| Phase 2 | 238.7–240.4 px/s | 240.3 px/s | 235.0 px/s |

The old build moves at a third of the intended speed *at its normal headless framerate* —
speed simply tracked FPS. The new build holds the design speed everywhere.

Pause semantics, verified end-to-end on both `vite dev` and the production build: a guard
in the 500 ms alarmed-pre reaction stays un-alarmed through a 1.5 s pause and alarms
~500 ms after resume; backup waves stop landing the moment `pause` is set (2 spawned
before, 0 during a 2.5 s pause, all 4 after resume); the bomb fuse freezes mid-countdown
and resumes; the blast still opens walls (9 cells) and kills a hero standing in it.
Kickback still fires through the bus; no console errors.

One vindication found while measuring: the first FPS-cap attempt replaced
`requestAnimationFrame` with a `setTimeout`-based fake, and on the *old* build the game
froze at the menu→game transition — `clearStage()`'s clear-all-timeouts hack was killing
the render loop's pending timeout. Exactly the class of friendly-fire the `GameClock`
migration removes.

### Phase 3 — Pathfinding v2 (~1–2 weeks) ✅ done

All of §4. Guards switch to `nav.requestPath`. Delete `js/astar.js` and the graph code in
`jo_grid.js:407-423`. Debug overlay (paths, regions, danger heatmap) behind a hotkey.
**Verify:** Vitest is the star — golden paths, corner-cutting, region labels, scheduler
budget, flow-field directions, danger decay. Frame time with 15 patrolling guards vs the
Phase 0 baseline.

#### What shipped

`src/nav/` — 8 files, strict TypeScript, no window globals, no Pixi:

| File | What it owns |
|---|---|
| `navgrid.ts` | The data layout: `walkable: Uint8Array`, `baseCost`/`doorCost`/`dangerCost` `Float32Array`s, the 8-direction tables, and the per-search **generation stamp** that replaced `astar.init`'s reset-all-1600 loop with one integer bump. Also `canStep` — the single definition of "is this move legal", including the no-corner-cutting rule — and `nearestWalkable`, which snaps a request whose end sits in a solid cell. |
| `astar.ts` | 8-connected A\*, octile heuristic, cost layers summed at expansion, lazy-deletion heap. ~120 lines. |
| `heap.ts` | Binary min-heap over cell indices, keyed by an external score array and reused between searches. |
| `regions.ts` | Connected-component labelling with the *same* step rule as the search, so "same label" is exactly "a path exists". Recomputed wholesale on any walkability change (microseconds at 1600 cells). |
| `flowfield.ts` | One reverse Dijkstra from a shared target → distance + best-direction per cell, plus `pathFromField` (pure table walk). |
| `danger.ts` | The decaying heatmap: splatted deposits with linear falloff, exponential decay by half-life, a per-cell clamp. Pure functions over the layer. |
| `smooth.ts` | String pulling, checked against grid flags via voxel traversal — and against **both flanks** of the unit's body, which is what keeps guards off wall corners. |
| `scheduler.ts` | `requestPath` → `PathHandle`, per-frame budget (4 searches / 0.5 ms), priority (combat > investigate > patrol), coalescing per requester. |
| `index.ts` | The `nav` facade: builds the layers from `jo_grid`, owns the flow-field cache, subscribes to `nav:dirty` and `nav:danger`, and is the only thing the rest of the game talks to. |

What changed outside `src/nav/`:

- **`grid.getPath` and the A\* graph are gone**, along with `astar.js` (deleted, 399 lines),
  `reducePathWithShortcut`/`isShortcutOK`, the two `getRandomNonSolid*CellIndex` samplers, and
  `jo_raycast`'s `isLineOKForPath` (its only caller was the shortcut test). `grid.angleBetweenPoints`
  stayed — it is pure math the blood-splatter code also uses.
- **Guards ask, they don't search.** `getRandomPatrolPath()` samples a destination from the
  guard's own region and posts a `Patrol` request; `pathToCoords()` — always called with the
  hero's last known position — goes through the flow field instead. Callers keep their old
  path until a new one is delivered.
- **`nav.update(deltaTime)`** runs once per fixed step, before the guards, decaying danger and
  draining the queue under budget.
- **The bomb feeds nav.** `explodeBomb` collects the cells it opens and emits one
  `nav:dirty` batch (plus a `nav:danger` deposit); `grid.makeWallSolid` emits the inverse.
  Guard deaths and gunshots emit `nav:danger`. Phase 5 replaces the bomb's ad-hoc block with
  `damageCell`, but the seam is already the one it will use.
- **Debug overlay on `N`**, cycling off → paths → regions → danger → flow field
  (`src/systems/nav_debug.ts`), listed in the in-game controls table.
- **`tsconfig.strict.json`** type-checks `src/core` and `src/nav` under full `strict` with the
  legacy ambient globals deliberately *out* of scope, so nothing modern can quietly reach for a
  window global. `npm run typecheck` runs both configs; CI is unchanged and picks it up.

#### The four pathologies §4 was aimed at

| | Before | After |
|---|---|---|
| Unreachable patrol destinations | sampled from anywhere on the map; a sealed-room pick returned no path and was retried forever (Phase 0 capped it with a backoff) | sampled from the requester's own region label — reachable by construction, and the scheduler checks region equality before searching at all, so a genuinely unreachable request costs one integer compare |
| Search scratch | `astar.init` reset all 1600 nodes per search | generation stamp: one `generation++` |
| Squad convergence | one full A\* per guard per "everyone repath" pulse | one Dijkstra for the whole squad; each guard reads its route from the direction table |
| Blown-open walls | graph built once at setup — a breach stayed impassable for the rest of the run | `nav:dirty` → walkable, relabel, drop flow fields; the gap is pathable on the next step |

#### Phase 3 verification

**Vitest: 105 new cases** across 8 nav suites (172 total, all green) — golden paths and octile
distance, the corner-cutting rule, cost-layer detours (danger and doors), sealed rooms, region
labelling and merge-on-breach, flow-field distances/directions/agreement with A\*, danger
falloff and framerate-independent decay, scheduler budget/priority/coalescing/handle states,
string pulling with body clearance, and the facade end-to-end (build from a legacy-shaped grid,
`nav:dirty` merging two rooms, `nav:danger` bending a route, reset between runs).

**Headless Playwright** (software rendering) against the production build, same scenario on the
Phase 2 tip and on Phase 3: `bank_1`, all backup spawned (**20 guards**), squad alarmed, a
"repath to the hero" pulse every second for 10 s. Per-fixed-step `gameloop()` cost — `animate()`
brackets the catch-up loop with `stats.begin/end`, so the frame total divided by the number of
steps that frame is the per-step cost:

| | mean | p50 | p95 | max | A\* searches/sec |
|---|---|---|---|---|---|
| Phase 2 (`grid.getPath`) | 0.31 / 0.28 ms | 0.23 / 0.20 ms | 0.60 / 0.55 ms | 2.15 / 2.10 ms | **8.9 / 9.8** |
| Phase 3 (`src/nav`) | 0.29 / 0.28 ms | 0.23 / 0.23 ms | 0.67 / 0.50 ms | 2.03 / 1.60 ms | **0.7 / 0.5** |

(two runs each). Frame time is a wash, as it was in Phase 0 — `bank_1` is well connected and
the searches were never the bottleneck on this map. The searches themselves are what changed:
an order of magnitude fewer, because convergence costs one flow field (1 rebuild for the whole
10 s run — the field is keyed on the target cell) and patrols are queued and coalesced. The
~2 ms tail is present on *both* builds, so it is not a nav cost.

Convergence still *behaves* the same, which is the thing the flow field must not break: with
the same pulse scenario, 12 of 20 guards closed meaningfully on the hero on both builds, mean
distance 1712 → 990 px (Phase 2) vs 1634 → 911 px (Phase 3).

The storm's worst case, for comparison with the Phase 0 table: a guard walled into a one-cell
region — the situation that used to loop A\* forever — now runs **0 searches/sec**, because
`randomDestinationNear` has nowhere to point it and returns null. The other guards keep
patrolling normally.

| | A\*/sec, patrol with unreachable destinations |
|---|---|
| pre-Phase 0 | 166 |
| Phase 0 (backoff) | 8 |
| Phase 3 (region sampling) | **0** |

**Smoke checklist** (§10.1), automated against the production build: map loads with no console
or page errors; WASD moves the hero; all 6 guards get paths and walk them; both security
cameras sweep; loot pickup and the van win condition fire; shooting a guard kills them, drops
the gun and clears their path; the bomb fuse freezes under pause and resumes; the blast opens
walls **and nav sees it** — a guard immediately gets a path through the new gap (the marquee
Phase 5 test, working already for pathfinding); the `N` overlay cycles all five modes.

Two real bugs the verification caught, both fixed: the overlay's path mode called
`Graphics.lineTo` after `drawCircle`, which throws in Pixi v3 (it ends the current path) and
killed the gameloop; and `grid.angleBetweenPoints` was deleted with the shortcut code even
though the blood-splatter paths still call it.

### Phase 4 — Physics (planck.js) + 4b Fog-of-war (~2–3 weeks) ✅ done

**4a:** world + bodies per §3; movement via velocities; bullets and AI vision become
physics raycasts. Delete the brute-force hero collision, O(n²) separation, door proximity
loops, and `jo_raycast.js`. Guards now physically collide with walls — budget small
AI-follow tuning.
**4b:** fog-of-war restored per §8.1; `enableLOS` on; old starburst code deleted.
**Verify:** wall sliding feels at least as good as the hand-tuned pushout (budget feel
time); bullets never tunnel at low FPS; guards can't be shoved through walls; fog polygon
correct around doors as they open/close. Frame-time check.

#### What shipped

`src/physics/` — planck.js 1.5, strict TypeScript, no window globals, no Pixi:

| File | What it owns |
|---|---|
| `constants.ts` | `PPM = 32` (a 64 px tile is 2 m), the collision categories, and the masks built from them. `VISION_BLOCKER` is deliberately a *separate bit* from `WALL`/`DOOR`, which is how one filtering vocabulary covers both "stops you walking" and "stops you seeing" — office furniture is `WALL` alone, a black wall is `WALL \| VISION_BLOCKER`. Phase 8's smoke grenade is already expressible: `VISION_BLOCKER` and nothing else. |
| `world.ts` | The planck wrapper. One static body for the whole map with a 2 m box fixture per solid cell (476 on `bank_1`); door fixtures that toggle between solid+opaque and sensor+transparent, each with a proximity sensor beside it; dynamic `fixedRotation` circles for the hero and guards; filtered raycasts; deferred `destroyFixture` (Box2D forbids destroying mid-step); contact bookkeeping for the door sensors; and pixel-space geometry for the debug overlay, so planck's types stop at this file. |
| `index.ts` | The `physics` facade: lifetime, the fixed step and the position write-back, `steerTowards` (the one place per-tick sprite speeds become Box2D's per-second velocities), and the four queries gameplay actually asks — `canSee`, `canSeeIgnoringDoors`, `sightStop`, `bulletHit`. |

`src/fog/` and `src/render/fog.ts` — the 4b half:

| File | What it owns |
|---|---|
| `fog/occluders.ts` | Vision-blocking boundary edges of the **live** grid, with collinear runs merged. On `bank_1` that is ~450 wall cells (1800 raw edges) down to ~160 segments. Everything outside the map counts as blocking, so border walls emit no outward face; the four map-boundary segments are appended so a sweep can never escape. |
| `fog/visibility.ts` | The angular sweep: a ray either side of every corner in range, plus a sampled arc for the unobstructed edge, sorted once by angle and walked into a fan. Takes the viewpoint as an argument — the spyglass used to be implemented by overwriting `hero.x`/`hero.y` for the duration of the sweep and putting them back. |
| `render/fog.ts` | The occluder cache and its invalidation, the mask `RenderTexture` pipeline, and the once-per-frame draw. |

What changed outside those directories:

- **Movement is a velocity.** `jo_sprite.move_to_target` sets one on sprites that own a
  body and keeps the original direct-move path for everything else (bullets, corpses
  being dragged, doors). **Deleted:** `collide` (four corner pushouts against every one of
  the 1600 cells, every frame), `collide_with_wall_sides`, and `unit_to_unit_collide` —
  along with the loop in `gameloop()` that drove the first two and the O(n²) loop in
  `gameloop_guards` that drove the third. Guards collide with walls and with each other
  for the first time.
- **Vision and gunfire are raycasts.** `doesSpriteSeeSprite` keeps its cone and swaps the
  grid-DDA raycaster for `physics.canSee`. `js/jo_raycast.ts` is **deleted** (232 lines) —
  including its 40-step scan limit, past which it silently reported "no wall".
- **Doors report their own contacts.** A sensor fixture per door replaces the
  doors×guards nested proximity loop; the handful of bodies actually touching a door still
  get the exact `radius * 4` test, so the rule is unchanged. `jo_wall.openDoor/closeDoor`
  is now the single place where a door's state reaches all three consumers: grid flags,
  physics fixture, fog cache.
- **The bomb reaches physics for free.** It already emitted the geometry-change event for
  nav; `physics` listens to the same one and drops the fixtures, so a breach is walkable,
  shootable and see-through in the same step.
- **A stuck detector for guards** (`sprite_guard.checkStuck`). New, and needed: guards used
  to walk through walls and each other, so "heading for a waypoint" and "getting there"
  were the same thing. A guard that holds a route without moving for 1.5 s now drops it and
  asks nav for another.
- **The starburst is gone** — 279 lines across `make_starburst`,
  `make_starburst_with_modified_view` and `make_starburst_without_limit`, plus both
  `setupLOS()` implementations (hero and security camera) and the angle `quickSort` in
  `jo_utility` that existed only to order its points. `enableLOS` is `true`.
- **Debug overlay on `B`**, cycling off → fixtures → occluders → visibility polygon
  (`src/systems/physics_debug.ts`), alongside `N`'s nav overlay.

#### Five deliberate deviations from §3 and §8.1

| | |
|---|---|
| **Bullets stayed projectiles.** §3.2 called for hitscan with the tracer as pure VFX. Guard accuracy decays to a perfect 0 px after five shots and the hero has one hit point, so hitscan would mean *unavoidable* death once any guard has fired a magazine — a playability regression, and every phase is supposed to end playable. Instead each bullet's swept segment is resolved by one `world.rayCast` per step. That still deletes the DDA raycast at spawn and the per-bullet loop over every guard doing circle-vs-segment maths, and it shares filtering with vision, which was the point. |
| **Doors are fixtures on the map body, not kinematic bodies.** They never actually move — the sprite rotates, the cell toggles. A kinematic body would buy nothing and cost a body per door. |
| **Vision range is still unlimited for the AI.** §5.2's ~450 px cap, the awareness meter and hearing are Phase 6. What Phase 4 adds is the *fog's* 900 px radius, and a matching range check on the guard-visibility code, so a guard is never drawn in a region the mask is painting dark. |
| **The geometry-change event is still called `nav:dirty`.** Physics and fog subscribe to it too. Renaming it is part of Phase 5's `damageCell` pipeline (§6.2), which replaces it with ordered `cell:destroyed` listeners; doing it now would have been churn for the same behaviour. |
| **Fog is swept once per rendered frame, not per fixed step.** It is presentation: at 30 FPS there is nothing to gain from sweeping twice for one picture, and it has to keep running while paused or the screen goes stale. |

#### Four real bugs, three of them found while verifying

| | |
|---|---|
| **Bullets stopped a hair short of their own victim.** The first cut aimed each shot with a mask that included people, so `bullet.target` landed on the *near edge of the guard being shot at* — the bullet then decelerated into its target and was cleaned up as a wall hit without ever testing a segment that contained the guard. Aiming targets geometry (`sightStop`); who is hit is resolved per step by `bulletHit`. | `jo_gun.ts`, `main.ts` |
| **The last few pixels of a shot were never tested.** `move_to_target` stops short rather than overshooting, so on a bullet's final step it does not move at all and the swept segment was zero-length. Anyone standing in that last sub-75 px gap was immune. The final stretch to the target is now included. | `gameloop_bullets` |
| **Backup guards spawned without a body.** Only the guards placed at map load were given one, so the seven police who arrive after the alarm walked through walls and each other. Found by the frame-time harness, which spawns them. | `spawn_individual_backup` |
| **A bombed door re-solidified itself.** `closeDoor()` sets `solid`/`blocks_vision` back to true, so the next guard to walk past a doorway that had just been blown open put a phantom wall in the middle of the hole — invisible before Phase 4, very visible now that the fog draws from the same flags. Breached door cells are marked `broken`, which both `open()` and `close()` already honour. | `explodeBomb` |

#### Phase 4 verification

**Vitest: 33 new cases** (200 total, all green) — 18 over the physics world (fixture counts,
nearest-hit raycasts, furniture that stops movement but not sight, the shooter being
ignored, sensors never stopping a ray, doors blocking and unblocking both movement and
sight, a body stopped by a wall, sliding along one without losing speed, two bodies
separating, a removed body going still, teleports, and the breach test: a cleared cell
stops blocking movement *and* sight) and 15 over the fog (edge extraction and run merging,
out-of-map treated as blocking, shadows behind a wall, seeing through a hole that opens,
the radius clip, cone limiting, a door closing and opening, and a vertex-count bound so
the polygon stays cheap to redraw).

**Headless Playwright** (software rendering) against the production build, same scenario as
the Phase 3 note: `bank_1`, 20 guards, squad alarmed, a "repath to the hero" pulse every
second for 10 s. Per-fixed-step `gameloop()` cost, two runs each:

| | per fixed step | frame bracket p50 | max | FPS (headless) |
|---|---|---|---|---|
| Phase 3 | 0.41 / 0.42 ms | 1.6 / 1.8 ms | 4.3 / 8.7 ms | 14.2 / 13.0 |
| Phase 4 | 0.62 / 0.67 ms | 4.9 / 5.2 ms | 10.8 / 11.8 ms | 7.7 / 7.6 |
| Phase 4, fog render off | 0.72 ms | 3.0 ms | 8.6 ms | 13.5 |

Two things worth reading carefully. The simulation costs about **+0.2 ms per fixed step** —
that is the solver carrying 20 dynamic bodies against 476 static fixtures, and it is the
price of deleting three brute-force loops and getting guard-vs-wall collision that never
existed. The **halved framerate is the fog's render pass, not the simulation**: switching
only the mask render off restores 13.5 FPS. That pass is a 2560×2560 `RenderTexture`
redrawn every frame, which SwiftShader rasterises on the CPU; the sweep *maths* is
**0.068 ms** for a 127-vertex polygon. On a real GPU this is a full-screen blit. Worth
re-checking on hardware during the Phase 5 playtest.

**Smoke harness**, now checked in at `tools/smoke.mjs` (§10.1 automated; not in CI, it
needs a browser): 32 assertions against the production build, all passing on three
consecutive runs. Map and physics build with one fixture per solid cell; WASD moves the
hero and two seconds of driving into geometry never puts him inside it; all guards patrol
and none ends up in a wall; a door opens on sensor contact, stops blocking sight, then
closes and blocks again; a shot kills a guard, drops their gun and takes their body out of
the world; the bomb removes fixtures and the hole is walkable to nav *and* see-through
(the marquee Phase 5 test, passing early for both nav and vision); a corpse can be grabbed
and dragged; the loot can be picked up and delivered to the van; `Esc` drops the physics
world and starting again rebuilds it with guards patrolling; and after 30 s of an alarmed
squad fighting in corridors, no guard is wedged and none is inside a wall.

A human playthrough is still worth doing for *feel* — wall sliding, whether the fog reads
well at the default zoom — which the automated pass says nothing about.

### Phase 5 — Destructible walls (~1 week)

All of §6. The bomb is rewired through `damageCell` (its ad-hoc block at
`main.js:2702-2728` deleted).
**Verify — the marquee test:** bomb a wall → a guard immediately paths through the gap;
the player can see through the hole (fog) and guards can see the player through it;
autotile edges correct. Unit tests: region relabel on destruction, occluder invalidation.

### Phase 6 — Guard AI v2 (~2–3 weeks, two sub-drops)

**6a:** FSM + Perception (range/awareness/hearing/memory) + de-escalation + health model,
replacing the `gameloop_guards` flag soup.
**6b:** SquadBlackboard — entry assignment + door-cost spikes, danger deposits, staggered
entry/peek, FLEE, wave-based backup.
**Verify:** scripted scenarios — alert the squad with a body at a door and assert *not*
all guards path through it; kill two entrants and assert the third holds or flanks. FSM
transition unit tests (pure functions). Playtest: guards feel smart; the alarm eventually
cools down.

### Phase 7 — Drivable van (~1–2 weeks)

All of §7.
**Verify:** full loud-escape playthrough; drift-feel tuning session; guard dodge visibly
works; the on-foot proximity win is gone.

### Phase 8 — Grenades + data-driven weapons (~1 week)

§8.2. **Verify:** smoke breaks an active vision lock; flash freezes awareness; frag opens
a wall exactly like the bomb.

### Phase 9 (optional) — Pixi v8 upgrade — render layer only (§2.3).

### Phase 10 (later) — Map editor as a second Vite entry reusing game modules (§8.3).

### Dependency graph

```
0 → 1 → 2 → 3 (nav) ──────┐
            └→ 4a (physics) → 4b (fog) → 5 (walls) → 6 (AI) → 8 (grenades)
                             └→ 7 (car; can run right after 4 with breaching stubbed)
```

3 and 4 both require 2 (3 can precede 4); 5 requires 3 + 4; 6 requires 3 (and 4 for
raycasts, 5 for breach entries); 7 requires 4 (5 for wall-breaching); 8 requires 5 + 6.
If motivation needs a fun win early, pull Phase 7 forward to right after Phase 4.

---

## 10. Cross-phase verification strategy

1. **Manual smoke checklist at every phase boundary** (keep it in this doc): load bank_1 →
   stealth to the loot → get spotted → loud fight → escape or die. Five minutes.

   Run `game.html?volume=1.0&level=bank_1` and tick off:

   - [ ] Map loads, hero spawns, no console errors.
   - [ ] WASD moves the hero; the hero slides along walls instead of sticking.
   - [ ] Guards patrol — they pick new destinations and walk them, they don't freeze.
   - [ ] Security cameras sweep, pause at each end of the arc, and reverse.
   - [ ] Sneak to the loot unseen; picking it up works.
   - [ ] Get spotted: the "?!" alert shows, the guard shoots, the squad goes on alert.
   - [ ] Shoot a guard: blood splatter, a blood trail while dragging the body, gun drops.
   - [ ] Plant and detonate a bomb: fuse counts down, walls in the blast open up, guards in
         range die, and standing on it kills the hero.
   - [ ] Pause mid-fuse — the countdown freezes and resumes correctly.
   - [ ] Reach the van with the loot and win; then die and confirm the death/restart flow.
   - [ ] Press `N` — the nav overlay cycles paths / regions / danger / flow field and back
         off, and the guard paths drawn match where they actually walk. (Added in Phase 3;
         it is also the fastest way to see a bug in a later phase's nav changes.)
   - [ ] Press `B` — the physics overlay cycles fixtures / occluders / visibility polygon
         and back off. Fixtures should trace the walls exactly, doors should go hollow when
         they open, and the polygon should match the lit part of the screen. (Added in
         Phase 4.)
   - [ ] Fog: the map beyond line of sight is shaded, corners cast shadows that move as you
         do, opening a door reveals what is behind it, and bombing a wall reveals what is
         behind *that*. Guards are only drawn where you can actually see them.

   Steps 1–10 of this checklist are automated in `tools/smoke.mjs` (Playwright, run
   against `vite preview`). It is not in CI — it needs a browser — but it is the cheapest
   way to find out whether a change broke something structural before playing for feel.

   Phase 0 note: the checklist above was verified headlessly (Playwright driving Chromium),
   including guard patrol, camera swivel, blood trail, and the full bomb/pause/blast path.
   A human playthrough is still worth doing for *feel* — the automated pass only proves
   nothing throws and the state changes are correct.
2. **Vitest for all pure logic:** nav (search, regions, flow fields, costs, decay), FSM
   transitions, clock, map-version migration, math. Target near-full coverage on
   pathfinding and AI-transition logic; physics *feel* and rendering are verified by play.
3. **Frame-time note per phase** vs the Phase 0 Stats.js baseline — watch for regressions,
   confirm the Phase 3/4 wins.
4. **Debug overlays are part of each system's deliverable, not an afterthought:** paths,
   regions, danger heatmap, vision cones + awareness, hearing radii, physics fixtures,
   FSM state labels, fog occluder edges.
