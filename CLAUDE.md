# Stealth_em_up — project notes for Claude

Top-down stealth game. Legacy JavaScript ported to TypeScript: the core gameplay
lives in `src/legacy/` (still written in the old global-function style), with newer
systems in `src/systems/`, `src/physics/`, and `src/nav/`. Tests are Vitest under
`test/`. Typecheck with `npx tsc --noEmit -p tsconfig.json`; run tests with
`npx vitest run`.

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

The mask is protection **until a guard sees your face unmasked** — once a guard sets
`knowsHerosFace` (`sprite_guard.ts`), the mask no longer hides you from that guard.

**A vehicle is not on this list.** Sitting in or driving the getaway van
(`hero.inCar`) is deliberately *not* suspicious by itself. Guards react to the van
only if the hero is doing one of the things above while in it (e.g. driving off with
the loot, or masked), or once it is driven fast enough to be heard (see below). This
is intentional: a van is just a van.

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
