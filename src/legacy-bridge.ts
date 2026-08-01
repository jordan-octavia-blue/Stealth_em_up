/**
 * The legacy bridge.
 *
 * `game.html` used to load 25 classic <script> tags in a fixed order, all sharing one
 * global scope. Phase 1 turned each of those files into an ES module under `src/legacy/`
 * without touching what they do. This module re-creates the old contract:
 *
 *  - Import order below is the script-tag order, verbatim. Static ESM imports are
 *    evaluated depth-first in source order and none of the legacy modules import each
 *    other, so each one still runs exactly when its <script> tag used to.
 *  - Module scope is not global scope, so each legacy file publishes its own top-level
 *    declarations onto `window` as it is evaluated (`window.grid = ...`, and an
 *    `Object.assign(window, { ... })` for function declarations at the bottom of the
 *    file). Publishing happens *inside* each module rather than here, because that is
 *    the only way to keep a mutable global live: a `window.x = x` re-export from this
 *    file would snapshot the value at import time and go stale on the next assignment.
 *  - `src/legacy-globals.d.ts` is the type-level half — it declares those same names so
 *    the untouched code that reads them by bare name still type-checks.
 *
 * Strangling this file is the work of Phases 2+ (roadmap §2.2): each subsystem extracted
 * to `src/systems/` deletes an import here and a name from `legacy-globals.d.ts`, and
 * the bridge shrinks until nothing needs it.
 */

// PIXI v3 is still a UMD global loaded by a plain <script> tag in the host page; the
// legacy code reads `PIXI.*` directly everywhere. Isolating it behind src/render/ is
// Phase 2+ work (roadmap §2.3).
import './legacy/jo_local_storage';
import './legacy/images_from_sheet';
import './legacy/jo_gun';
import './legacy/jo_gun_drop';
import './legacy/menu_button_manager';
import './legacy/jo_debug';
import './legacy/jo_door';
import './legacy/jo_math';
import './legacy/jo_sprite';
import './legacy/jo_cam';
import './legacy/jo_utility';
import './legacy/jo_doodad';
import './legacy/jo_wall';
import './legacy/jo_grid';
import './legacy/Stats';
import './legacy/jo_security_camera';
import './legacy/sprite_hero';
import './legacy/sprite_guard';
import './legacy/jo_movie_clip';
import './legacy/sound_manager';
import './legacy/jo_progress_bar';
import './legacy/main';

export {};
