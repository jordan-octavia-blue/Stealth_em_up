package game

// jo_progress_bar.ts, menu_button_manager.ts, jo_local_storage.ts and the native menu
// that replaces game.html's instructions screen.

import "core:math"
import "core:os"
import "core:strings"
import "core:strconv"
import "core:fmt"
import "core:path/filepath"

// ---------------------------------------------------------------- circular progress bar

Prog_Callback :: enum u8 { None, Reload, Mask, Unlock, Bomb_Timed, Bomb_Remote }

prog_bar: struct {
	graphics:               ^Node,
	x, y:                   f64,
	draw_x, draw_y:         f64,
	size, radius:           f64,
	percent:                f64,
	line_width:             f64,
	follow:                 ^Sprite,
	visible:                bool,
	time_passed:            f64,
	time_to_finish:         f64,
	cancel_target:          Point,
	has_cancel_target:      bool,
	callback:               Prog_Callback,
	cb_gun:                 ^Gun,
	cb_sprite:              ^Sprite,
	target_follow:          ^Sprite,
	param:                  bool,
}

prog_init :: proc(x, y, size, line_width: f64) {
	prog_bar = {}
	prog_bar.graphics = new_graphics()
	add_child(display_actors, prog_bar.graphics)
	prog_bar.x = x
	prog_bar.y = y
	prog_bar.size = size
	prog_bar.radius = (size - line_width) / 2
	prog_bar.line_width = line_width
}

prog_run_callback :: proc() {
	switch prog_bar.callback {
	case .None:
	case .Reload:
		prog_bar.cb_gun.ammo = prog_bar.cb_gun.clip_size
		prog_bar.cb_sprite.reloading = false
	case .Mask:
		use_mask(prog_bar.param)
	case .Unlock:
		door_unlock(prog_bar.cb_sprite)
	case .Bomb_Timed:
		hero.planting_bomb = false
		plant_bomb()
		set_bomb(5000)
	case .Bomb_Remote:
		hero.planting_bomb = false
		plant_bomb()
		set_text(bomb_tooltip, "Press 'f' to detonate")
	}
}

prog_increment :: proc(dt: f64) {
	if prog_bar.has_cancel_target && get_distance(hero.x, hero.y, prog_bar.cancel_target.x, prog_bar.cancel_target.y) > hero.radius * drag_distance * (3.0 / 2.0) {
		prog_stop()
		if hero.lockpicking do hero.lockpicking = false
	}
	if prog_bar.target_follow != nil {
		prog_bar.x = prog_bar.target_follow.x
		prog_bar.y = prog_bar.target_follow.y
	}
	prog_bar.time_passed += dt
	prog_bar.percent = prog_bar.time_passed / prog_bar.time_to_finish
	if prog_bar.percent >= 1 {
		prog_run_callback()
		prog_bar.visible = false
		prog_bar.target_follow = nil
		prog_bar.param = false
	}
}

prog_stop :: proc() {
	g_clear(prog_bar.graphics)
	prog_bar.visible = false
	prog_bar.time_passed = 0
	prog_bar.percent = 0
	prog_bar.callback = .None
	if hero.planting_bomb do hero.planting_bomb = false
}

prog_hero_mask :: proc(time_to_finish: f64, param: bool) {
	if hero.planting_bomb do hero.planting_bomb = false
	prog_bar.has_cancel_target = false
	prog_bar.target_follow = hero
	prog_bar.time_passed = 0
	prog_bar.time_to_finish = time_to_finish
	prog_bar.percent = 0
	prog_bar.callback = .Mask
	prog_bar.param = param
	prog_bar.visible = true
}

prog_reset :: proc(x, y, time_to_finish: f64, cb: Prog_Callback, gun: ^Gun = nil, sprite: ^Sprite = nil) {
	if hero.planting_bomb do hero.planting_bomb = false
	prog_bar.has_cancel_target = false
	prog_bar.follow = nil
	prog_bar.x = x
	prog_bar.y = y
	prog_bar.time_passed = 0
	prog_bar.time_to_finish = time_to_finish
	prog_bar.percent = 0
	prog_bar.callback = cb
	prog_bar.cb_gun = gun
	prog_bar.cb_sprite = sprite
	prog_bar.visible = true
}

prog_draw :: proc() {
	g := prog_bar.graphics
	g_clear(g)
	if prog_bar.visible {
		r := prog_bar.radius
		g_line_style(g, prog_bar.line_width, 0xababab, 1)
		g_move_to(g, prog_bar.draw_x + r, prog_bar.draw_y)
		// The web build sweeps 2π·100 (one hundred identical opaque loops); one loop
		// covers exactly the same pixels.
		g_arc(g, prog_bar.draw_x, prog_bar.draw_y, r, 0, math.PI * 2)
		g_line_style(g, prog_bar.line_width + 2, 0x555555, 1)
		g_move_to(g, prog_bar.draw_x + r, prog_bar.draw_y)
		g_arc(g, prog_bar.draw_x, prog_bar.draw_y, r, 0, math.PI * 2 * prog_bar.percent)
	}
}

prog_prepare_for_draw :: proc() {
	if prog_bar.follow != nil {
		prog_bar.x = prog_bar.follow.x
		prog_bar.y = prog_bar.follow.y
	}
	prog_bar.draw_x = prog_bar.x
	prog_bar.draw_y = prog_bar.y
}

// ---------------------------------------------------------------- buttons

Button_Action :: enum u8 { Play_Again, Start_Game, Quit }

Button :: struct {
	node:      ^Node, // the button background (a Graphics) with its label as a child
	label:     ^Node,
	x, y:      f64,
	w, h:      f64,
	action:    Button_Action,
	over:      bool,
	enabled:   bool,
}
buttons: [dynamic]^Button

ui_add_button :: proc(text: string, x, y: f64, action: Button_Action, parent: ^Node = nil) {
	b := new(Button)
	b.action = action
	b.enabled = true
	b.label = new_text(text, 30, 0x000000, 0xFFFFFF, 4)
	b.label.anchor = {0.5, 0.5}
	w, _ := text_size(b.label.text)
	b.w = max(220, w + 60)
	b.h = 64
	b.x = x
	b.y = y
	b.node = new_graphics()
	b.node.x = x
	b.node.y = y
	button_paint(b)
	add_child(b.node, b.label)
	add_child(parent != nil ? parent : stage, b.node)
	append(&buttons, b)
}

button_paint :: proc(b: ^Button) {
	g := b.node
	g_clear(g)
	g_begin_fill(g, b.over ? 0x3cb0fd : 0x3498db, 1)
	g_line_style(g, 2, 0x1f5f8b, 1)
	g_draw_rect(g, -b.w / 2, -b.h / 2, b.w, b.h)
	g_end_fill(g)
}

ui_clear_buttons :: proc() {
	for b in buttons do free(b)
	clear(&buttons)
}

ui_mouse_move :: proc(x, y: f64) {
	for b in buttons {
		over := b.enabled && abs(x - b.x) <= b.w / 2 && abs(y - b.y) <= b.h / 2
		if over != b.over {
			b.over = over
			button_paint(b)
		}
	}
}

// Returns true when a button took the click.
ui_click :: proc(x, y: f64) -> bool {
	for b in buttons {
		if b.enabled && abs(x - b.x) <= b.w / 2 && abs(y - b.y) <= b.h / 2 {
			b.enabled = false
			switch b.action {
			case .Play_Again: pending_action = .Start_Game
			case .Start_Game: pending_action = .Start_Game
			case .Quit: pending_action = .Quit
			}
			return true
		}
	}
	return false
}

Pending_Action :: enum u8 { None, Start_Game, Start_Menu, Quit }
pending_action: Pending_Action

// ---------------------------------------------------------------- menu

CONTROLS := [][2]string{
	{"Move", "W A S D"},
	{"Sprint", "Hold Shift"},
	{"Put on / take off mask", "V"},
	{"Draw / holster weapon", "G"},
	{"Shoot (weapon drawn)", "Left Click"},
	{"Reload", "R"},
	{"Pick up gun", "Right Click"},
	{"Interact / lock-pick / bug camera", "Space"},
	{"Drag body / choke out guard", "Hold Space"},
	{"Plant bomb (5 s fuse)", "F"},
	{"Frag / smoke / flash grenade", "3 / 4 / 5 (aims at mouse)"},
	{"Spyglass", "P"},
	{"Enter / exit the van", "E (stand next to it)"},
	{"Drive the van", "W A S D, Space = handbrake"},
	{"Zoom", "Mouse Wheel"},
	{"Debug: nav / physics / walls", "N / B / H"},
	{"Back to this menu", "Esc"},
}

menu_build :: proc() {
	bg := new_graphics()
	g_begin_fill(bg, 0x1b1f2a, 1)
	g_draw_rect(bg, 0, 0, 10000, 10000)
	g_end_fill(bg)
	add_child(stage, bg)
	cx := window_w / 2
	y := max(30, window_h / 2 - 330)
	title := new_text("STEALTH 'em UP", 44, 0xFFFFFF, 0x000000, 4)
	title.anchor = {0.5, 0}
	title.x = cx
	title.y = y
	add_child(stage, title)
	y += 70
	blurb := new_text("Grab the loot, get in the van, drive to the green escape zone.", 18, 0xd9ddec, 0x000000, 0)
	blurb.anchor = {0.5, 0}
	blurb.x = cx
	blurb.y = y
	add_child(stage, blurb)
	y += 40
	for row in CONTROLS {
		l := new_text(row[0], 17, 0xafbcec, 0, 0)
		l.anchor = {1, 0}
		l.x = cx - 12
		l.y = y
		add_child(stage, l)
		r := new_text(row[1], 17, 0xFFFFFF, 0, 0)
		r.x = cx + 12
		r.y = y
		add_child(stage, r)
		y += 24
	}
	y += 14
	stats := new_text(fmt.tprintf("Wins %s   Losses %s   Guards shot %s   Guards choked %s",
		store_get("wins"), store_get("loses"), store_get("guardsShot"), store_get("guardsChoked")), 15, 0x8890a8, 0, 0)
	stats.anchor = {0.5, 0}
	stats.x = cx
	stats.y = y
	add_child(stage, stats)
	y += 60
	ui_add_button("Start Game", cx, y, .Start_Game)
	hint := new_text("Enter to start", 14, 0x8890a8, 0, 0)
	hint.anchor = {0.5, 0}
	hint.x = cx
	hint.y = y + 40
	add_child(stage, hint)
}

// ---------------------------------------------------------------- stats (localStorage)

stats_loaded: bool
stats_map: map[string]int

stats_path :: proc() -> string {
	home := os.get_env("HOME", context.temp_allocator)
	if home == "" do return "stealth_em_up_stats.txt"
	dir, _ := filepath.join({home, ".local", "share", "stealth_em_up"}, context.temp_allocator)
	p, _ := filepath.join({dir, "stats.txt"}, context.temp_allocator)
	return p
}

stats_load :: proc() {
	if stats_loaded do return
	stats_loaded = true
	data, err := os.read_entire_file(stats_path(), context.temp_allocator)
	if err != nil do return
	for line in strings.split_lines(string(data), context.temp_allocator) {
		parts := strings.split(line, "=", context.temp_allocator)
		if len(parts) != 2 do continue
		n, ok := strconv.parse_int(parts[1])
		if ok do stats_map[strings.clone(parts[0])] = n
	}
}

stats_save :: proc() {
	p := stats_path()
	os.make_directory_all(filepath.dir(p))
	b := strings.builder_make(context.temp_allocator)
	for k, v in stats_map do fmt.sbprintf(&b, "%s=%d\n", k, v)
	_ = os.write_entire_file(p, transmute([]u8)strings.to_string(b))
}

store_inc :: proc(name: string) {
	stats_load()
	if name in stats_map do stats_map[name] += 1
	else do stats_map[strings.clone(name)] = 1
	stats_save()
}

store_get :: proc(name: string) -> string {
	stats_load()
	return fmt.tprintf("%d", stats_map[name] or_else 0)
}
