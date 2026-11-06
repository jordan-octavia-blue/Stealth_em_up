# CLAUDE.md

Guidance for working in this repo. Start with `README.md` (how to build and run) and `odin/README.md`
(layout, file-by-file map, intentional differences from the old web build).

- The game is Odin + [sokol-odin](https://github.com/floooh/sokol-odin). The code is in `odin/game/`, and the
  hand-ported planck (Box2D v2) subset is in `odin/physics/`.
- Build with `odin/build.bat` on Windows or `./odin/build.sh` on Linux. Either script fetches sokol-odin at a
  pinned commit and compiles its C libraries on the first run. CI builds both platforms
  (`.github/workflows/ci.yml`).
- Runtime assets stay at the repo root: `images/`, `movie_clips/`, `maps/` and `data/`. The game also uses
  `odin/assets/`, which holds the WAV sounds and the font. `sound/` keeps the original audio files.
- The JavaScript/Pixi version was removed. It is still in git history before the commit "Make the Odin build the
  only build" if you need to compare behaviour. The Odin code was ported from it line for line, and comments
  often name the TS file a proc came from.
- Keep runtime performance in mind. The simulation is a fixed 60 Hz step (`animate_gameplay` in
  `odin/game/game.odin`) and rendering batches through sokol_gl. Flag any change that costs frame time.

## Controls

The keyboard and mouse handlers are the single source of truth: `odin/game/input.odin` (`on_key_down`,
`on_key_up`, `on_mouse_down`). The debug-overlay cycles are in `odin/game/debug.odin`.

The player-facing list of controls is `CONTROLS` in `odin/game/ui.odin`, which the menu shows. When you add,
remove, or rebind a key in `input.odin`, including the bomb (`F`) and the debug overlays (`N` / `B` / `H`), update
that list to match so the two never drift apart.

## How and why guards get alerted

There is **no numeric "wanted" or suspicion meter**. Alerting comes down to two questions:

1. **Is the hero doing something a guard would react to right now?** This is a single boolean,
   `hero_will_cause_alert()` in `odin/game/sprite.odin`.
2. **Did a guard or camera actually see the hero (or a dead body) while that was true?** This is decided by the
   per-frame detection loops `gameloop_guards` and `gameloop_security_cams` in `odin/game/game.odin`.

Both must hold. A guard who can't see you never alerts, no matter what you're doing. A guard who sees you doing
nothing suspicious just watches you walk by.

### What makes the hero suspicious: `hero_will_cause_alert()`

It returns true while **any** of these is true. These are the *only* things that make the hero worth raising
the alarm over:

| Condition | Field | Set when |
|---|---|---|
| Wearing a mask | `hero.masked` | Masked up (V key) |
| Gun drawn | `hero.gun_out` | Weapon out (G key) |
| On an off-limits tile | `hero.in_off_limits` | Standing on a tile flagged `restricted` |
| Lockpicking a door | `hero.lockpicking` | During the lockpick channel (Space at a locked door) |
| Planting a bomb | `hero.planting_bomb` | During the ~1.5 s bomb-plant channel (F key) |
| Carrying stolen loot | `hero.carry` | Holding the money |
| Dragging or choking a body | `hero_drag_target` | Dragging a corpse or choking a guard |
| Just rammed a wall or ran someone over in the van | `hero.van_suspicious_until` | The van hits a wall hard or mows a guard down (`odin/game/car.odin`). This is a short deadline set by `hero_mark_van_suspicious()` |

The mask is protection **until a guard sees your face unmasked**. Once a guard learns that robber's face (`guard_learn_face`, a per-player bit in `knows_face`), the mask
no longer hides you from that guard.

**Calmly driving a vehicle is not on this list; ramming things with it is.** Sitting in or gently driving the
getaway van (`hero.in_car`) is deliberately *not* suspicious by itself, because a van is just a van. The *violent*
things a van does are suspicious. Ramming a wall or running a guard over briefly marks the hero suspicious for
about 2.5 s of game clock, through `hero.van_suspicious_until`. During that window, any guard or camera that sees
the van alarms through the normal detection path, exactly as for any other suspicious act. If the driver is
unmasked, that guard or camera also learns their face.

Guards also react to the van whenever the hero is *already* doing one of the things above while in it, for
example wearing the mask or driving off with the loot. A fast van is heard even when nothing suspicious is
happening (see below).

### How a guard or camera turns a sighting into an alarm

Each frame, `gameloop_guards` and `gameloop_security_cams` check every guard's and camera's vision
(`sprite_sees` / `sprite_sees_point` in `sprite.odin`). When one sees a suspicious hero or a dead body:

1. The guard calls `guard_see_alarming_object()`. A reaction delay of about 500 ms models "taking a second to
   register it". Then `guard_become_alarmed()` runs: the guard switches to its alert texture, its speed jumps to
   3, and it stops patrolling and engages.
2. Two seconds later, if that guard is still alive, it calls `alert_all_guards()` in `game.odin`. That alarms
   every living guard within 500 px of the hero, with no line of sight needed. This is how one sighting
   escalates to the whole floor.
3. Gunshots and cameras broadcast the hero's position immediately via `hero_set_last_seen()`. That sends
   *already-alarmed* guards to repath to that spot. It does **not** alarm calm guards.

Dead bodies are their own alarm source. `guard_kill()` pushes the corpse into `alarming_objects`, so a guard or
camera that later sees it alerts the same way.

### The getaway van and noise

- **Getting in** (`car_enter` in `odin/game/car.odin`) raises no alarm and no suspicion.
- **Driving fast** re-broadcasts the van's position on an interval through `hero_set_last_seen()`. This happens
  in `car_update_pre_step` and only above `NOISE_MIN_SPEED_PX`. A loud getaway therefore pulls
  *already-alarmed* guards toward the van, but never alarms a guard who wasn't already alerted.

### Grenades and data-driven weapons

Weapon and throwable stats live in `data/weapons.json`, which `load_weapons` in `odin/game/grenades.odin` loads.

- Guns have `{ id, damage, loudness, ... }`. They still kill in one shot: guards have **no hp**, and `damage` is
  carried as data but never subtracted from anything.
- The three throwables have `{ id, damage, loudness, fuseMs, radius, effects }`.

Throw with **3 = frag, 4 = smoke, 5 = flash**, aimed at the mouse. A grenade lerps from the hero to the target
with a faked height: the sprite grows, then shrinks. There is no physics body until it lands. Then a short fuse
runs, and then its effect fires.

- **Frag** reuses the bomb's machinery:
  - `grid_damage_cell(..., .Bomb)` over its radius, so it breaches walls exactly like the bomb;
  - `guard_kill()` on anyone in range;
  - `alert_all_guards()`, and it points the squad at the blast.

  A frag is **not** a stealth tool. An explosion alarms calm guards, on purpose.
- **Smoke** touches the *two separate vision systems*:
  - Guards and cameras see through physics raycasts. Smoke adds vision-blocker sensor circles for them with
    `physics_add_vision_blocker` in `odin/game/phys.odin`.
  - The player's fog of war is built from the grid's `blocks_vision` flags, not from physics. Smoke flags the
    covered cells and calls `fog_invalidate()`.

  Both are undone when the cloud expires.
- **Flash** sets `blind_until`, a game-clock timestamp, on every guard and camera within its radius that it has
  line of sight to.
  - While that holds, the unit sees nothing, and its alarm state cannot change.
  - This is deliberately **independent of `hero_will_cause_alert()`**.
  - A blinded guard stops where it stands and shows spinning "dazed stars" (`update_guard_blind_fx` in
    `game.odin`), then resumes its route when the blindness ends.
  - A blinded camera stops swivelling.

### Grenade blast particles and "guards notice grenades"

- Every grenade throws a burst of tinted debris across its blast disc (`grenade_blast_particles` in
  `odin/game/effects.odin`). It reuses the shard particles, so the debris bounces off walls and fades.
- **See:** while a grenade is in the air or on the floor, it puts a sighting proxy in `alarming_objects`, so any
  guard or camera with line of sight reacts through the normal path.
- **Hear:** on detonation, a *non-loud* grenade (smoke or flash) alerts every living guard within
  `loudness * 80` px, with no line of sight needed (`be_heard`). It also points the squad at the spot. Guards
  that the same flash just blinded are skipped. Frag skips this because it is loud and calls
  `alert_all_guards()` instead.

### Key files

All are in `odin/game/`:

- `sprite.odin`: hero, guards, cameras and doors. It holds the suspicion fields, `hero_will_cause_alert()`,
  `guard_see_alarming_object`, `guard_become_alarmed` and per-guard alarm state.
- `game.odin`: the main loop, the guard and camera detection loops, `alert_all_guards`, the off-limits check,
  and mask and bomb handling.
- `squad.odin`: squad tactics for alarmed guards, such as entry points and converging on the last known position.
- `car.odin`: van enter and exit, driving, engine noise, run-overs and melee.
- `grenades.odin`: frag, smoke and flash, from the throw arc and fuse to the three effects.
- `phys.odin`: the physics world, raycasts, and the vision blockers smoke uses.
- `fog.odin`: the player's fog of war, drawn with stencil-buffer visibility polygons.
- `input.odin`: the key handlers that set the suspicion flags and throw grenades.

## Co-op

Two to four robbers, host-authoritative, over Steam P2P or LAN UDP. `odin/README.md` ("Co-op") has the design.
What matters when changing gameplay code:

- The single-player globals (`hero`, `keys`, `mouse`, `hero_drag_target`, `prog_bar`, the spyglass) hold whichever
  player is *bound*. Code that should act for every robber loops over `players` with `player_switch(i)` (and
  switches back). Between per-player sections the globals hold the local player.
- Guards and cameras pick which robber to react to with `pick_seen_hero`. Face knowledge is per player.
- A new one-shot effect (a sound, particles, a message) reaches clients only through an emitter in `net.odin`
  (`net_ev_*`), usually called at the top of the effect proc. If a client already reproduces it from another
  event, wrap the host's call in `net.mute += 1` / `net.mute -= 1`.
- Anything a client must see continuously (positions, flags) goes in the snapshot (`net_write_snapshot` /
  `net_client_apply_snapshot`). Bump `NET_VERSION` when the wire format changes.

