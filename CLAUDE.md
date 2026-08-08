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

Keyboard keys are rebindable. `src/systems/keybindings.ts` is the single source of truth
for which physical key triggers which action: `KEY_ACTIONS` lists every rebindable action
with its default `keyCode`, and the stored overrides live in `localStorage`. The keyboard
handlers — `src/systems/input.ts` (`addKeyHandlers`) — resolve each pressed key through
`getBindings()` (never a hard-coded `keyCode`), with the debug-overlay cycles in
`src/systems/nav_debug.ts`, `src/systems/physics_debug.ts`, and
`src/systems/breach_debug.ts`. To add or change a control, edit `KEY_ACTIONS` and add the
matching `code == kb.<id>` check in `input.ts`.

The player-facing Controls list (in the menu's Settings → Controls screen) is generated
from `KEY_ACTIONS`, so it can't drift from `input.ts`. Mouse buttons, the wheel zoom and
Esc are deliberately NOT rebindable (they aren't keyboard keys) and are shown as a fixed
list. The menu itself — main screen, mission select, settings, stats, credits — is
`menu.html` + `src/menu/`, a self-contained port of the Some of You May Die main menu
(view switching via a `menu-{name}` body class, settings persisted through
`src/menu/storage.ts`'s `OPTIONS` blob).

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

### Key files

- `src/legacy/sprite_hero.ts` — the suspicion flags and `willCauseAlert()`.
- `src/legacy/main.ts` — guard/camera detection loops, `alert_all_guards`,
  off-limits-tile check, mask/bomb handling.
- `src/legacy/sprite_guard.ts` — per-guard alarm state (`alarmedPre`, `alarmed`,
  `knowsHerosFace`), `seeAlarmingObject`, `becomeAlarmed`.
- `src/legacy/jo_security_camera.ts` — camera alarm logic and dead-body registration.
- `src/systems/car.ts` — van enter/exit, driving, and engine noise.
- `src/systems/input.ts` — key handlers that set the suspicion flags.

