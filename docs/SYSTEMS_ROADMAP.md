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

### Phase 0 — Triage the current code (days)

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

### Phase 1 — Tooling: Vite + TypeScript + Vitest (days)

Real npm `package.json`; Vite; mechanical ESM + `.ts` conversion of `js/*` with the
`src/legacy-bridge.ts` window bridge (loose tsconfig, §2.1); jQuery → `fetch`; Vitest with
first tests against the pure-math files (`jo_math`, `jo_utility`). Optional CI
(`vitest run` + `vite build`).
**Verify:** behaviorally identical game under `npm run dev` and `npm run build && preview`.

### Phase 2 — Core loop: fixed timestep, clock, events (~1 week)

Accumulator-based fixed 60 Hz update (fixes framerate-dependent speed — a prerequisite for
physics tuning). A pausable `GameClock` (`after(ms)`, `every(ms)`) replaces every raw
`setTimeout`/`new Date()` in gameplay code — kills the fires-after-death timer bugs and
makes pause real. Event bus lands. Extract 2–3 easy systems (input, camera, particles) to
prove the strangler loop.
**Verify:** cap FPS at 30 — movement speed unchanged; pause mid-"investigate" — the timer
resumes correctly. Unit tests: clock.

### Phase 3 — Pathfinding v2 (~1–2 weeks)

All of §4. Guards switch to `nav.requestPath`. Delete `js/astar.js` and the graph code in
`jo_grid.js:407-423`. Debug overlay (paths, regions, danger heatmap) behind a hotkey.
**Verify:** Vitest is the star — golden paths, corner-cutting, region labels, scheduler
budget, flow-field directions, danger decay. Frame time with 15 patrolling guards vs the
Phase 0 baseline.

### Phase 4 — Physics (planck.js) + 4b Fog-of-war (~2–3 weeks)

**4a:** world + bodies per §3; movement via velocities; bullets and AI vision become
physics raycasts. Delete the brute-force hero collision, O(n²) separation, door proximity
loops, and `jo_raycast.js`. Guards now physically collide with walls — budget small
AI-follow tuning.
**4b:** fog-of-war restored per §8.1; `enableLOS` on; old starburst code deleted.
**Verify:** wall sliding feels at least as good as the hand-tuned pushout (budget feel
time); bullets never tunnel at low FPS; guards can't be shoved through walls; fog polygon
correct around doors as they open/close. Frame-time check.

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
2. **Vitest for all pure logic:** nav (search, regions, flow fields, costs, decay), FSM
   transitions, clock, map-version migration, math. Target near-full coverage on
   pathfinding and AI-transition logic; physics *feel* and rendering are verified by play.
3. **Frame-time note per phase** vs the Phase 0 Stats.js baseline — watch for regressions,
   confirm the Phase 3/4 wins.
4. **Debug overlays are part of each system's deliverable, not an afterthought:** paths,
   regions, danger heatmap, vision cones + awareness, hearing radii, physics fixtures,
   FSM state labels, fog occluder edges.
