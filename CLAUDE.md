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
  the hero is or isn't doing.

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
