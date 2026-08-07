// Ambient declarations for the globals the legacy code still shares by bare name.
//
// Phase 1 converted js/*.js to ES modules under src/legacy/. Module scope is not
// global scope, so every top-level `var` in those files became a `window.*`
// assignment and every top-level `function` is republished onto `window` at the
// bottom of its file. This file is the type-level half of that bridge: it tells
// TypeScript that these bare names exist, exactly as the old <script> tags did.
//
// Everything here is `any` on purpose — Phase 1 is a mechanical conversion, not a
// typing pass (see docs/SYSTEMS_ROADMAP.md §2.1). As systems are extracted into
// real modules, their names are deleted from this list and imported instead.
//
// GENERATED as part of the Phase 1 conversion; edit by hand from here on.

export {};

declare global {
  // published by the debug overlays for the console and the headless harness
  var physics: any;
  var fog: any;
  // Loose index signature so `window.<legacyName> = ...` type-checks everywhere.
  interface Window {
    [key: string]: any;
  }

  // jo_local_storage.ts
  var jo_store: any;
  var jo_store_get: any;
  var jo_store_inc: any;
  var storageEnabled: any;
  var supports_html5_storage: any;

  // images_from_sheet.ts
  var onAssetsLoaded: any;

  // jo_gun.ts
  var all_gun_prefabs: any;
  var all_gun_prefabs_without_sawed: any;
  var gun_machine: any;
  var gun_pistol: any;
  var gun_pistol_silenced: any;
  var gun_shotgun: any;
  var gun_shotgun_sawed_off: any;
  var jo_gun: any;

  // jo_gun_drop.ts
  var jo_gun_drop: any;

  // menu_button_manager.ts
  var addButton: any;
  var buttons: any;

  // jo_debug.ts
  var debug_circle: any;
  var debug_line: any;

  // jo_door.ts
  var sprite_door_wrapper: any;

  // jo_math.ts
  var biasTest: any;
  var moveToTarget: any;
  var randomFloatFromInterval: any;
  var randomFloatWithBias: any;
  var randomFloatWithBias2: any;
  var randomIntFromInterval: any;
  var rotate_point_about_axis: any;

  // jo_sprite.ts
  var jo_sprite: any;

  // jo_cam.ts
  var jo_cam: any;

  // jo_utility.ts
  var Ray: any;
  var angleInArc: any;
  var angleInArcRad: any;
  var angle_between: any;
  var circle_linesetment_intersect: any;
  var findAngleBetweenPoints: any;
  var get_distance: any;
  var positionInCircle: any;

  // jo_doodad.ts
  var jo_doodad: any;

  // jo_wall.ts
  var img_tile_black: any;
  var img_tile_brown: any;
  var img_tile_red: any;
  var img_tile_white: any;
  var jo_wall: any;
  var walls: any;

  // jo_grid.ts
  var jo_grid: any;
  var tile_container_black: any;
  var tile_container_brown: any;
  var tile_container_purple: any;
  var tile_container_red: any;
  var tile_container_white: any;
  var tile_containers: any;

  // Stats.ts
  var Stats: any;

  // jo_security_camera.ts
  var security_camera_wrapper: any;

  // sprite_hero.ts
  var sprite_hero_wrapper: any;

  // sprite_guard.ts
  var sprite_guard_wrapper: any;

  // jo_movie_clip.ts
  var jo_movie_clip: any;

  // sound_manager.ts
  var changeVolume: any;
  var force_buffer_sound: any;
  var music_hero_dead: any;
  var music_masked: any;
  var music_unmasked: any;
  var pause_sound: any;
  var play_sound: any;
  var play_sound_many: any;
  var readjustVolumes: any;
  var sound_door_close: any;
  var sound_door_open: any;
  var sound_dry_fire: any;
  var sound_explosion: any;
  var sound_guard_choke: any;
  var sound_gun_shot: any;
  var sound_gun_shot_silenced: any;
  var sound_gun_shots: any;
  var volume_master: any;

  // jo_progress_bar.ts
  var circularProgressBar: any;

  // main.ts
  var DEFAULT_LEVEL: any;
  var DEFAULT_VOLUME: any;
  var BLOOD_TRAIL_BAKE_EVERY: any;
  var alarmingObjects: any;
  var alert_all_guards: any;
  var alert_clip: any;
  var animate: any;
  var backupCalled: any;
  var bakeBloodTrail: any;
  var blood_trail: any;
  var blood_trail_pending: any;
  var blood_trail_sprite: any;
  var blood_trail_texture: any;
  var bloods: any;
  var bomb: any;
  var bomb_fuse: any;
  var bomb_fuse_start: any;
  var bomb_radius: any;
  var bomb_radius_debug: any;
  var bomb_scale_variety: any;
  var bomb_ticking: any;
  var bomb_tooltip: any;
  var bombs_left: any;
  var bullets: any;
  var camera: any;
  var cameras_disabled: any;
  var circProgBar: any;
  var clearStage: any;
  var clickEvent: any;
  var computer_for_security_cameras: any;
  var currentTexture: any;
  var debug_info: any;
  var debug_on: any;
  var deltaTime: any;
  var display_actors: any;
  var display_blood: any;
  var display_effects: any;
  var display_guards: any;
  var display_tiles: any;
  var display_tiles_walls: any;
  var doGunShotEffects: any;
  var doodads: any;
  var dragDistance: any;
  var drawBloodTrail: any;
  var drop_gun: any;
  var enableLOS: any;
  var explodeBomb: any;
  var fullscreen: any;
  var gameloop: any;
  var gameloop_alert_animation: any;
  var gameloop_bomb: any;
  var gameloop_bullets: any;
  var gameloop_doors: any;
  var gameloop_dragtarget: any;
  var gameloop_getawaycar_and_loot: any;
  var gameloop_guards: any;
  var gameloop_messages_and_tooltip: any;
  var gameloop_security_cams: any;
  var getColor: any;
  var getMapInfo: any;
  var getUrlVars: any;
  var getawaycar: any;
  var escape_zone: any;
  var escape_zone_sprite: any;
  var hasWon: any;
  var grid: any;
  var grid_height: any;
  var grid_width: any;
  var guard_backup_spawn: any;
  var guards: any;
  var gun_drops: any;
  var hero: any;
  var hero_drag_target: any;
  var hero_end_aim_coord: any;
  var hero_is_dead: any;
  var hero_last_seen: any;
  var keys: any;
  var killHero: any;
  var lastTimeStamp: any;
  var latestAlert: any;
  // Fixed-timestep state (Phase 2): the sim always steps in STEP_MS increments.
  var STEP_MS: number;
  var MAX_FRAME_MS: number;
  var step_accumulator: number;
  var look_sensitivity: any;
  var loot: any;
  var mapName: any;
  var map_json: any;
  var message: any;
  var messageGameOver: any;
  var messageText: any;
  var messages_floating: any;
  var mouse: any;
  var mouse_relative: any;
  // debug-only: published by src/systems/nav_debug.ts so the console and the headless
  // perf harness can read nav.stats. No shipping code reads it.
  var nav: any;
  var newFloatingMessage: any;
  var newMessage: any;
  var notifyGuardsOfHeroLocation: any;
  var numOfBackupGuards: any;
  var onresize: any;
  var particle_container: any;
  var pause: any;
  var pickUpGunDrop: any;
  var plantBomb: any;
  var reactionTimeout: any;
  var removeAllChildren: any;
  var renderer: any;
  var security_cameras: any;
  var setBomb: any;
  var setHeroImage: any;
  var set_latestAlert: any;
  var setup_map: any;
  var shardType: any;
  var shards: any;
  var shell1: any;
  var shell2: any;
  var shell3: any;
  var shell4: any;
  var shell5: any;
  var shellTextures: any;
  var shellType: any;
  var shells: any;
  var show_sprite_tooltips: any;
  var spawn_backup: any;
  var spawn_individual_backup: any;
  var spyglassPos: any;
  var stage: any;
  var stage_child: any;
  var startGame: any;
  var startMenu: any;
  var state: any;
  var states: any;
  var static_effect_sprites: any;
  var stats: any;
  var tooltip: any;
  var tooltipshown: any;
  var unsilenced_gun: any;
  var updateDebugInfo: any;
  var updateMessage: any;
  var url_queryString: any;
  var useMask: any;
  var wabbitTexture: any;
  var windowSetup: any;
  var window_properties: any;
  var zoom: any;
  var zoom_magnitude: any;

  // Accidental implicit globals — these are assigned without `var` in the original ES5
  // (`img_bullet = ...` inside onAssetsLoaded, `shard = ...` inside a particle loop).
  // Classic scripts ran sloppy, so the assignment silently created a global; ES modules
  // are always strict, where the same assignment is a ReferenceError. They are now
  // explicit `window.*` writes at their assignment sites, which keeps behaviour
  // identical. Most are genuinely shared state; `mouse_click_obj` and `percent` are
  // write-only leftovers, and `shard`/`shell` want to be locals. Cleaning that up is a
  // behaviour change, so it waits for the phase that owns those subsystems.
  var currentShard: any;
  var mouse_click_obj: any;
  var percent: any;
  var shardImages: any;

  // Sprite-sheet frame handles, all assigned in images_from_sheet.ts:onAssetsLoaded().
  var img_blue: any;
  var img_bomb: any;
  var img_bullet: any;
  var img_cam_broken: any;
  var img_cam_off: any;
  var img_computer: any;
  var img_computer_off: any;
  var img_doodad_lamp: any;
  var img_doodad_paper: any;
  var img_door_closed: any;
  var img_door_open: any;
  var img_getawaycar: any;
  var img_guard_alert: any;
  var img_guard_choke: any;
  var img_guard_dead: any;
  var img_guard_drag: any;
  var img_guard_knows_hero_face: any;
  var img_guard_reg: any;
  var img_guard_riot_alert: any;
  var img_guard_riot_knows_face: any;
  var img_guard_riot_reg: any;
  var img_guard_spawn_icon: any;
  var img_gun_machine: any;
  var img_gun_pistol: any;
  var img_gun_pistol_silenced: any;
  var img_gun_shotgun: any;
  var img_gun_shotgun_sawed: any;
  var img_hero_body: any;
  var img_hero_dead: any;
  var img_hero_head: any;
  var img_hero_head_masked: any;
  var img_hero_with_machine_gun: any;
  var img_hero_with_money: any;
  var img_hero_with_pistol: any;
  var img_hero_with_pistol_silenced: any;
  var img_hero_with_shotty: any;
  var img_hero_with_shotty_sawed: any;
  var img_lastSeen: any;
  var img_masked: any;
  var img_money: any;
  var img_origin: any;
  var img_player_spawn_icon: any;
  var img_security_camera: any;
  var img_security_camera_alerted: any;
  var img_shard_1: any;
  var img_shard_2: any;
  var img_shard_3: any;
  var img_shell: any;
  var img_spyglass: any;
}
