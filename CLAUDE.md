# CLAUDE.md

Guidance for working in this repo. Start with `README.md` (how to run, layout) and
`docs/SYSTEMS_ROADMAP.md` (architecture and the phased modernization plan).

- `src/game.ts` is the `game.html` entry; `src/menu.ts` is `menu.html`'s.
- Legacy ES5, converted to ES modules, lives in `src/legacy/` and still shares state
  through `window` (see `src/legacy-bridge.ts` / `src/legacy-globals.d.ts`).
- Extracted subsystems live under `src/systems/`, `src/nav/`, `src/physics/`, `src/map/`,
  `src/render/`, `src/core/`. Tests are Vitest under
`test/`. Typecheck with `npx tsc --noEmit -p tsconfig.json`; run tests with
`npx vitest run`.

## Controls

The keyboard/mouse handlers are the single source of truth — `src/systems/input.ts`
(`addKeyHandlers`), with the debug-overlay cycles in `src/systems/nav_debug.ts`,
`src/systems/physics_debug.ts`, and `src/systems/breach_debug.ts`.

The player-facing list of controls lives in the menu (`menu.html`, the "Controls" screen).
When you add, remove, or rebind a key in `input.ts` — including the bomb (`F`) and the debug
overlays (`N` / `B` / `H`) — update that menu list to match so the two never drift apart.

## How and why guards get alerted

There is **no numeric "wanted"/suspicion meter**. Alerting is two simple things:

1. **Is the hero doing something a guard would react to right now?** — a single
   boolean, `hero.willCauseAlert()` in `src/legacy/sprite_hero.ts`.
2. **Did a guard or camera actually see the hero (or a dead body) while that was
   true?** — the per-frame detection loops in `src/legacy/main.ts`.

Both must hold. A guard who can't see you never alerts no matter what you're doing;
a guard who sees you doing nothing suspicious just watches you walk by.

### What makes the hero suspicious — `willCauseAlert()`

Returns true while **any** of these is true. These are the *only* things that make the
hero worth raising the alarm over:

| Condition | Flag | Set when |
|---|---|---|
| Wearing a mask | `hero.masked` | Masked up (V key) |
| Gun drawn | `hero.gunOut` | Weapon out (G key) |
| On an off-limits tile | `hero.inOffLimits` | Standing on a tile flagged `restricted` |
| Lockpicking a door | `hero.lockpicking` | During the lockpick channel (Space at a locked door) |
| Planting a bomb | `hero.plantingBomb` | During the ~1.5s bomb-plant channel (F key) |
| Carrying stolen loot | `hero.carry` | Holding the money |
| Dragging / choking a body | `hero_drag_target` | Dragging a corpse or choking a guard |
| Just rammed a wall / ran someone over in the van | `hero.vanSuspiciousUntil` | The van hits a wall hard or mows a guard down (`src/systems/car.ts`); a short deadline set by `markVanSuspicious()` |

The mask is protection **until a guard sees your face unmasked** — once a guard sets
`knowsHerosFace` (`sprite_guard.ts`), the mask no longer hides you from that guard.

**Calmly driving a vehicle is not on this list; ramming things in it is.** Sitting in
or gently driving the getaway van (`hero.inCar`) is deliberately *not* suspicious by
itself — a van is just a van. But the *violent* things a van does are: ramming a wall
or running a guard over briefly marks the hero suspicious (`hero.vanSuspiciousUntil`,
a ~2.5s gameClock deadline set from `src/systems/car.ts`). During that window any guard
or camera that sees the van alarms through the normal detection path — and, if the
driver is unmasked, learns their face — exactly as for any other suspicious act.
Guards also react to the van whenever the hero is *already* doing one of the things
above while in it (e.g. masked, or driving off with the loot), and a fast van is heard
even when nothing suspicious is happening (see below).

### How a guard/camera turns a sighting into an alarm

Per frame, `gameloop_guards` and `gameloop_security_cams` in `src/legacy/main.ts`
check each guard's/camera's vision. On seeing a suspicious hero (or a dead body):

1. The guard calls `seeAlarmingObject()` (`src/legacy/sprite_guard.ts`). A
   `reactionTimeMillis` (~500ms) delay models "taking a second to register it," then
   `becomeAlarmed()` runs: alert texture, speed jumps to 3, the guard stops patrolling
   and engages.
2. Two seconds later, if still alive, that guard calls `alert_all_guards()`
   (`src/legacy/main.ts`), which alarms every living guard within 500px of the hero —
   no line of sight needed. This is how one sighting escalates to the whole floor.
3. Gunshots and cameras broadcast the hero's position immediately via
   `hero.setLastSeen(null)`, which sets `notifyGuardsOfHeroLocation` so *already-alarmed*
   guards repath to that spot. It does **not** alarm calm guards.

Dead bodies are their own alarm source: `guard.kill()` pushes the corpse into
`alarmingObjects`, so a guard or camera that later sees it alerts the same way.

### The getaway van and noise

- **Getting in** (`enterCar` in `src/systems/car.ts`) raises no alarm and no
  suspicion. It used to call `alert_all_guards()` and broadcast the van's position on
  entry; both were removed.
- **Driving fast** re-broadcasts the van's position on an interval
  (`updateCarPreStep`, gated by `NOISE_MIN_SPEED_PX`) via the same
  `setLastSeen(null)` path — so a loud getaway pulls *already-alarmed* guards toward
  the van, but never alarms a guard who wasn't already alerted.

### Grenades and data-driven weapons (Phase 8)

Weapon and throwable stats live in `data/weapons.json` (loaded by `src/systems/weapons.ts`):
`{ id, damage, loudness, ... }` for guns, plus `{ id, damage, loudness, fuseMs, radius,
effects }` for the three throwables. Guns migrated to this table but still kill in one shot
— `damage` is carried as data, not subtracted from any hitpoint pool (guards have **no hp**;
Phase 6a's health model was skipped — see the memory note). Throw with keys **3 = frag,
4 = smoke, 5 = flash**, aimed at the mouse. A grenade lerps from the hero to the target with
a faked height (the sprite grows then shrinks — top-down, no physics body until it lands),
then a short fuse runs, then its effect fires. All of this lives in `src/systems/grenades.ts`.

- **Frag** reuses the bomb's machinery: `grid.damageCell(..., 'bomb')` over its radius (so it
  breaches walls exactly like the bomb), `guard.kill()` on anyone in range (one-shot, no hp),
  and the bomb's loud alarm — `alert_all_guards()` plus pointing the squad at the blast. A
  frag is **not** a stealth tool; an explosion alarms calm guards, on purpose.
- **Smoke** touches the *two separate vision systems* in this codebase. For guards and
  cameras (which see via physics raycasts) it adds `VISION_BLOCKER` sensor circles through
  `physics.addVisionBlocker` — the ray filter now lets a `VISION_BLOCKER` sensor stop sight
  and gunfire. For the player's fog-of-war (built from the grid's `blocks_vision` flags, not
  physics) it flags the covered cells `blocks_vision` and emits `vision:dirty` to rebuild the
  occluders. Both are undone when the cloud expires.
- **Flash** sets `blindUntil` (a gameClock timestamp) on every guard and camera within radius
  that it has line of sight to. While it holds, `jo_sprite.doesSpriteSeeSprite` returns false
  for that unit — so it sees nothing and its alarm state cannot change (awareness frozen).
  This is deliberately **independent of `willCauseAlert()`**: a flash blinds a guard whatever
  the hero is or isn't doing. While blinded, a guard also **stops where it stands** and shows a
  spinning "dazed stars" marker above it (`updateGuardBlindFx` in `src/legacy/main.ts` freezes
  its AI/movement for those frames without clearing `moving`, so it resumes its route when the
  blind ends), and a blinded camera **stops swivelling**.

### Grenade blast particles and "guards notice grenades"

- Every grenade throws a burst of small tinted debris across its whole blast disc on
  detonation (`grenadeBlastParticles` in `src/systems/particles.ts`, tinted per type). It reuses
  the existing shard tick loop, so the particles bounce off walls and fade like wall shards.
- Guards and cameras get alerted two ways, both reusing the normal detection path:
  - **See:** while a grenade is in the air or lying on the floor, it puts a lightweight
    `{x, y}` proxy in `window.alarmingObjects` (the same list a dead body goes in), so any
    guard/camera with line of sight to it reacts through `seeAlarmingObject()`. The proxy tracks
    the grenade's position and is removed when it is gone. (A smoke cloud blocks sight, so it
    tends to hide its own canister once it deploys.)
  - **Hear:** on detonation a *non-loud* grenade (smoke, flash) alerts every living guard within
    `loudness * 80` px — no line of sight — and points the squad at the spot (`beHeard` in
    `src/systems/grenades.ts`). Guards this same flash just blinded are skipped. Frag skips this
    path because it is `loud`: it wakes the whole floor via `alert_all_guards()` instead.

### Key files

- `src/legacy/sprite_hero.ts` — the suspicion flags and `willCauseAlert()`.
- `src/legacy/main.ts` — guard/camera detection loops, `alert_all_guards`,
  off-limits-tile check, mask/bomb handling.
- `src/legacy/sprite_guard.ts` — per-guard alarm state (`alarmedPre`, `alarmed`,
  `knowsHerosFace`), `seeAlarmingObject`, `becomeAlarmed`.
- `src/legacy/jo_security_camera.ts` — camera alarm logic and dead-body registration.
- `src/systems/car.ts` — van enter/exit, driving, and engine noise.
- `src/systems/grenades.ts` — frag/smoke/flash: throw arc, fuse, and the three effects.
- `src/systems/weapons.ts` + `data/weapons.json` — the data-driven weapon/throwable table.
- `src/physics/world.ts` — `addVisionBlocker`/`removeVisionBlocker` (smoke) and the ray
  filter that lets a `VISION_BLOCKER` sensor stop sight.
- `src/systems/input.ts` — key handlers that set the suspicion flags and throw grenades.
