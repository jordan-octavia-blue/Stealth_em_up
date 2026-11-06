package game

// Entry point: sokol_app window, the browser's requestAnimationFrame loop (one render
// per frame, a fixed 60 Hz simulation inside), and the event plumbing that stands in for
// the DOM handlers.

import "base:runtime"
import "core:os"
import "core:fmt"
import "core:strings"
import "core:path/filepath"
import "core:math"
import sapp "sokol:app"
import sg "sokol:gfx"
import sgl "sokol:gl"
import sglue "sokol:glue"
import slog "sokol:log"
import stm "sokol:time"

asset_root: string

// Assets are read from the repo layout (images/, movie_clips/, maps/, data/ and
// odin/assets/). Look upwards from the working directory and the executable.
find_asset_root :: proc() -> string {
	cwd, _ := os.get_working_directory(context.temp_allocator)
	starts := [2]string{cwd, filepath.dir(os.args[0])}
	for s in starts {
		dir := s
		for _ in 0 ..< 5 {
			probe, _ := filepath.join({dir, "maps", "bank_1.jomap"}, context.temp_allocator)
			if os.exists(probe) do return strings.clone(dir)
			dir = filepath.dir(dir)
		}
	}
	return "."
}

asset_path :: proc(rel: string) -> string {
	p, _ := filepath.join({asset_root, rel}, context.temp_allocator)
	return p
}

concat2 :: proc(a, b: string) -> string {
	return strings.concatenate({a, b}, context.temp_allocator)
}

last_time: u64
started: bool
app_ok: bool
cursor_x, cursor_y: f64

init :: proc "c" () {
	context = runtime.default_context()
	sg.setup({environment = sglue.environment(), logger = {func = slog.func}})
	sgl.setup({max_vertices = 1 << 20, max_commands = 1 << 16, logger = {func = slog.func}})
	stm.setup()
	render_init()
	asset_root = find_asset_root()
	if !text_init() do fmt.eprintln("text disabled")
	if !load_spritesheet(asset_path("images/spritesheet.json"), asset_path("images/spritesheet.png")) {
		fmt.eprintln("could not load images/spritesheet.json")
		sapp.request_quit()
		return
	}
	load_tileset()
	load_weapons()
	guns_init()
	load_images()
	net_register_textures()
	if !load_map(concat2("maps/", "bank_1.jomap")) {
		sapp.request_quit()
		return
	}
	physics_init()
	audio_init()
	window_w = f64(sapp.widthf()) / f64(sapp.dpi_scale())
	window_h = f64(sapp.heightf()) / f64(sapp.dpi_scale())
	mouse_relative = {0, 0}
	start_menu()
	menu_build()
	app_ok = true
	if os.get_env("STEALTH_AUTOSTART", context.temp_allocator) != "" do pending_action = .Start_Game
	net_startup_from_env_and_args()
}

// Co-op entry points that don't go through the menu:
//   - Steam launches us with `+connect_lobby <id>` when a friend accepts an invite while
//     the game is closed;
//   - STEALTH_HOST=1 / STEALTH_JOIN=<ip[:port]> host or join over plain UDP (LAN, testing).
net_startup_from_env_and_args :: proc() {
	if os.get_env("STEALTH_HOST", context.temp_allocator) != "" {
		net_host_begin(false)
	} else if addr := os.get_env("STEALTH_JOIN", context.temp_allocator); addr != "" {
		net_join_udp(addr)
	} else if steam_init() {
		// Steam up from the start, so a friend's invite or "Join Game" reaches us in the menu
		if lobby := steam_lobby_from_args(); lobby != 0 do steam_join_lobby(lobby)
	}
}

frame :: proc "c" () {
	context = runtime.default_context()
	defer free_all(context.temp_allocator)
	if !app_ok do return
	now := stm.now()
	delta_ms := 0.0
	if last_time != 0 do delta_ms = stm.ms(stm.diff(now, last_time))
	last_time = now

	net_frame(delta_ms)

	switch pending_action {
	case .None:
	case .Start_Game:
		pending_action = .None
		start_game()
		delta_ms = 0
	case .Start_Menu:
		pending_action = .None
		menu_dirty = false
		start_menu()
		menu_build()
	case .Quit:
		sapp.request_quit()
		return
	}
	if menu_dirty {
		menu_dirty = false
		if state == .Start_Menu {
			start_menu()
			menu_build()
		}
	}

	// Pixi's shared ticker drives MovieClips on wall-clock time.
	tick := min(delta_ms, 100) * 0.06
	for c in all_clips do clip_update(c, tick)

	if state == .Gameplay {
		animate_gameplay(delta_ms)
		flash_overlays_tick()
	}

	blood_flush()

	action: sg.Pass_Action
	action.colors[0] = {load_action = .CLEAR, clear_value = {0, 0, 0, 1}}
	action.stencil = {load_action = .CLEAR, clear_value = 0}
	sg.begin_pass({action = action, swapchain = sglue.swapchain()})
	render_begin_frame(window_w, window_h)
	render_node(stage, MAT_IDENTITY, 1)
	sgl.draw()
	sg.end_pass()
	sg.commit()
	text_end_frame()
}

event :: proc "c" (e: ^sapp.Event) {
	context = runtime.default_context()
	if !app_ok do return
	scale := f64(sapp.dpi_scale())
	#partial switch e.type {
	case .RESIZED:
		window_w = f64(e.window_width) / scale
		window_h = f64(e.window_height) / scale
		if state == .Start_Menu {
			start_menu()
			menu_build()
		}
	case .MOUSE_MOVE:
		cursor_x = f64(e.mouse_x) / scale
		cursor_y = f64(e.mouse_y) / scale
		mouse_relative = {cursor_x, cursor_y}
		ui_mouse_move(cursor_x, cursor_y)
	case .MOUSE_DOWN:
		cursor_x = f64(e.mouse_x) / scale
		cursor_y = f64(e.mouse_y) / scale
		if ui_click(cursor_x, cursor_y) do return
		if state != .Gameplay do return
		if net_is_client() {
			if e.mouse_button == .LEFT || e.mouse_button == .RIGHT do net_client_mouse(e.mouse_button == .LEFT ? 0 : 1, true)
		} else {
			on_mouse_down(e.mouse_button)
		}
	case .MOUSE_UP:
		if state != .Gameplay do return
		if net_is_client() {
			if e.mouse_button == .LEFT || e.mouse_button == .RIGHT do net_client_mouse(e.mouse_button == .LEFT ? 0 : 1, false)
		} else {
			on_mouse_up(e.mouse_button)
		}
	case .MOUSE_SCROLL:
		if state == .Gameplay do on_mouse_wheel(e.scroll_y)
	case .KEY_DOWN:
		if state == .Start_Menu {
			if e.key_code == .ENTER || e.key_code == .KP_ENTER do request_start_game()
			return
		}
		if state != .Gameplay do return
		code := sapp_to_keycode(e.key_code)
		if code < 0 do return
		if net_is_client() {
			if !e.key_repeat do net_client_key_down(code)
		} else {
			on_key_down(code)
		}
	case .KEY_UP:
		if state != .Gameplay do return
		code := sapp_to_keycode(e.key_code)
		if code < 0 do return
		if net_is_client() do net_client_key_up(code)
		else do on_key_up(code)
	}
}

cleanup :: proc "c" () {
	context = runtime.default_context()
	net_leave()
	steam_shutdown()
	audio_shutdown()
	sgl.shutdown()
	sg.shutdown()
}

main :: proc() {
	sapp.run({
		init_cb = init,
		frame_cb = frame,
		event_cb = event,
		cleanup_cb = cleanup,
		width = 1280,
		height = 800,
		sample_count = 1,
		depth_format = .DEPTH_STENCIL,
		high_dpi = true,
		window_title = "Stealth 'em Up",
		logger = {func = slog.func},
	})
}
