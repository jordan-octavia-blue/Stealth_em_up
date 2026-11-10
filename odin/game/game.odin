package game

// src/legacy/main.ts: run setup, the fixed-step game loop and its helpers.

import "core:math"
import "core:fmt"
import "core:strings"

// ---------------------------------------------------------------- world state

Game_State :: enum { Start_Menu, Gameplay }
state: Game_State

window_w, window_h: f64

stage, stage_child: ^Node
display_tiles, display_blood, display_effects, display_tiles_walls: ^Node
particle_container, display_actors, display_guards: ^Node

mouse: Point
mouse_relative: Point

Keys :: struct {
	w, a, s, d, r, v, g, e, n, b, h, k3, k4, k5: bool,
	space, shift, lmb, rmb: bool,
}
keys: Keys

zoom, zoom_magnitude, look_sensitivity: f64
gun_drops: [dynamic]^Gun_Drop
doodads: [dynamic]^Doodad

bomb: ^Sprite
bombs_left: int
bomb_fuse_start, bomb_fuse: f64
bomb_ticking: bool
bomb_scale_variety: f64
bomb_tooltip: ^Node
bomb_tooltip_obj: Point
bomb_radius_debug: ^Node
bomb_radius: f64

cameras_disabled: bool
bullets: [dynamic]^Sprite
hero: ^Sprite
hero_last_seen: ^Sprite
hero_end_aim: Point
hero_drag_target: ^Sprite
guards: [dynamic]^Sprite
guard_backup_spawn: Point
num_backup_guards: int
backup_called: bool
computer_for_security_cameras: ^Sprite
security_cameras: [dynamic]^Sprite
alarming_objects: [dynamic]^Sprite
getawaycar: ^Sprite
loot: [dynamic]^Sprite
escape_zone: [4]f64
has_escape_zone: bool
escape_zone_sprite: ^Node
has_won: bool

message: ^Node
message_text: [dynamic]string
message_game_over: ^Node
Floating_Message :: struct {
	node:             ^Node,
	obj_x, obj_y:     f64,
	last_float_speed: f64,
}
messages_floating: [dynamic]Floating_Message
tooltip: ^Node
tooltip_obj: Point
tooltip_shown: bool
alert_clip: ^Sprite
latest_alert: ^Sprite
drag_distance: f64
notify_guards_of_hero_location: bool

spyglass_pos: Point
spyglass_in_door: bool
spyglass_valid: bool

grid_width_px, grid_height_px: f64

// textures
img_bullet, img_bomb, img_security_camera, img_security_camera_alerted, img_cam_broken, img_cam_off: ^Texture
img_computer, img_computer_off, img_door_closed, img_door_open: ^Texture
img_guard_reg, img_guard_riot_reg, img_guard_alert, img_guard_riot_alert, img_guard_knows_hero_face: ^Texture
img_guard_riot_knows_face, img_guard_choke, img_guard_dead, img_guard_drag: ^Texture
img_hero_with_money, img_hero_with_pistol, img_hero_with_pistol_silenced, img_hero_with_machine_gun: ^Texture
img_hero_with_shotty, img_hero_with_shotty_sawed, img_hero_dead, img_doodad_lamp, img_last_seen: ^Texture
img_gun_machine, img_money, img_doodad_paper, img_gun_pistol, img_gun_shotgun_sawed: ^Texture
img_shell, img_gun_shotgun, img_gun_pistol_silenced, img_getawaycar, img_hero_body, img_hero_head: ^Texture
img_hero_head_masked, img_spyglass: ^Texture
shard_images: [3]^Texture

load_images :: proc() {
	img_bullet = frame_tex("bullet3x.png")
	img_bomb = frame_tex("c4.png")
	img_security_camera = frame_tex("camera.png")
	img_security_camera_alerted = frame_tex("camera_alert.png")
	img_cam_broken = frame_tex("camera_broken.png")
	img_cam_off = frame_tex("camera_off.png")
	img_computer = frame_tex("computer.png")
	img_computer_off = frame_tex("computer_off.png")
	img_door_closed = frame_tex("door_closed.png")
	img_door_open = frame_tex("door_open.png")
	img_guard_reg = frame_tex("guard.png")
	img_guard_riot_reg = frame_tex("guard_riot.png")
	img_guard_alert = frame_tex("guard_alert.png")
	img_guard_riot_alert = frame_tex("guard_riot_alert.png")
	img_guard_knows_hero_face = frame_tex("guard_alert_knows_face.png")
	img_guard_riot_knows_face = frame_tex("guard_riot_knows_face.png")
	img_guard_choke = frame_tex("guard_choke.png")
	img_guard_dead = frame_tex("guard_dead.png")
	img_guard_drag = frame_tex("guard_dragging.png")
	img_hero_with_money = frame_tex("hero_body_1_bag.png")
	img_hero_with_pistol = frame_tex("hero_body_1_masked.png")
	img_hero_with_pistol_silenced = frame_tex("hero_body_1_masked_handgun_silenced.png")
	img_hero_with_machine_gun = frame_tex("hero_body_1_masked_machine.png")
	img_hero_with_shotty = frame_tex("hero_body_1_masked_shotgun.png")
	img_hero_with_shotty_sawed = frame_tex("hero_body_1_masked_shotty_sawed.png")
	img_hero_dead = frame_tex("hero_dead.png")
	img_doodad_lamp = frame_tex("lamp.png")
	img_last_seen = frame_tex("last_seen.png")
	img_gun_machine = frame_tex("machine-gun2.png")
	img_money = frame_tex("money.png")
	img_doodad_paper = frame_tex("papers.png")
	img_gun_pistol = frame_tex("pistol.png")
	img_gun_shotgun_sawed = frame_tex("sawed-shotgun.png")
	img_shell = frame_tex("shell.png")
	img_gun_shotgun = frame_tex("shotgun.png")
	img_gun_pistol_silenced = frame_tex("silenced_pistol.png")
	img_getawaycar = frame_tex("van.png")
	img_hero_body = frame_tex("body.png")
	img_hero_head = frame_tex("head.png")
	img_hero_head_masked = frame_tex("head_masked.png")
	img_spyglass = frame_tex("spyglass.png")
	shard_images = {frame_tex("shard.png"), frame_tex("shard2.png"), frame_tex("shard3.png")}
	current_shard = shard_images[0]
	feet_frames = make_clip_frames("feet_", 8)
	alert_frames = make_clip_frames("alert_", 12)
}

// ---------------------------------------------------------------- jo_cam

Cam :: struct {
	x, y:                       f64,
	pos_before_shake_x:         f64,
	pos_before_shake_y:         f64,
	shake_intensity:            f64,
	shake_decay:                f64,
	shaking:                    bool,
	kick:                       Point,
	has_kick:                   bool,
}
camera: Cam

cam_get_mouse :: proc(rel: Point) -> Point {
	sx := stage_child.scale.x
	sy := stage_child.scale.y
	cx := camera.x - window_w * (1 / sx) / 2
	cy := camera.y - window_h * (1 / sy) / 2
	return {rel.x * (1 / sx) + cx, rel.y * (1 / sy) + cy}
}

cam_start_shake :: proc(intensity, decay: f64) {
	camera.pos_before_shake_x = camera.x
	camera.pos_before_shake_y = camera.y
	camera.shake_intensity = intensity
	camera.shake_decay = decay
	camera.shaking = true
}

cam_shake :: proc() {
	if camera.shake_intensity > 0 {
		camera.x = camera.pos_before_shake_x + random() * camera.shake_intensity
		camera.y = camera.pos_before_shake_y + random() * camera.shake_intensity
		camera.shake_intensity -= camera.shake_decay
	} else {
		camera.shaking = false
	}
}

// ---------------------------------------------------------------- stage lifecycle

free_node :: proc(n: ^Node) {
	if n == nil do return
	for c in n.children do free_node(c)
	delete(n.children)
	if n.gfx != nil {
		cur := n.gfx.current
		if cur != nil && contains_shape(n.gfx.shapes[:], cur) do cur = nil
		for s in n.gfx.shapes do g_free_shape(s)
		delete(n.gfx.shapes)
		if cur != nil do g_free_shape(cur)
		free(n.gfx)
	}
	if n.text != nil {
		delete(n.text.str)
		free(n.text)
	}
	if n.clip != nil {
		for c, i in all_clips do if c == n {
			unordered_remove(&all_clips, i)
			break
		}
		free(n.clip)
	}
	free(n)
}

clear_stage :: proc() {
	ui_clear_buttons()
	clock_clear()
	remove_handlers(false)
	squad_reset()
	nav_reset()
	physics_reset()
	car_reset()
	grenades_reset()
	has_won = false
	nav_debug_reset()
	physics_debug_reset()
	breach_debug_reset()
	fog_reset()
	blood_reset()
	for s in all_sprites {
		delete(s.path)
		delete(s.glass_hit)
		free(s)
	}
	clear(&all_sprites)
	for d in doodads do free(d)
	clear(&doodads)
	for d in gun_drops do free(d)
	clear(&gun_drops)
	if stage != nil do free_node(stage)
	clear(&all_clips)
	hero = nil
	hero_drag_target = nil
	latest_alert = nil
	clear(&bullets)
	clear(&guards)
	clear(&security_cameras)
	clear(&alarming_objects)
	clear(&loot)
	clear(&messages_floating)
	clear(&message_text)
	clear(&shells)
	clear(&shards)
	clear(&bloods)
	clear(&point_pool.free)
	for p in point_pool.all {
		p.in_free = true
		append(&point_pool.free, p)
	}
	stage = new_container()
	stage_child = nil
	display_actors = nil
}

start_menu :: proc() {
	clear_stage()
	state = .Start_Menu
}

start_game :: proc() {
	clear_stage()
	state = .Gameplay
	step_accumulator = 0
	keys = {}
	stage_child = new_container()
	add_child(stage, stage_child)
	zoom = 1
	zoom_magnitude = 0.02
	look_sensitivity = 2.5
	display_tiles = new_container()
	display_blood = new_container()
	display_effects = new_container()
	display_tiles_walls = new_container()
	particle_container = new_particle_container()
	display_actors = new_container()
	display_guards = new_container()
	add_child(stage_child, display_tiles)
	add_child(stage_child, display_blood)
	add_child(stage_child, particle_container)
	add_child(stage_child, display_effects)
	add_child(stage_child, display_tiles_walls)
	add_child(stage_child, display_guards)
	add_child(stage_child, display_actors)

	bomb = new_sprite_obj(.Basic, new_sprite(img_bomb), nil)
	bomb.sprite.visible = false
	bomb.sprite.scale = {0.35, 0.35}
	bomb.rad = math.PI / 6
	bombs_left = 5
	bomb_fuse_start = 5000
	bomb_fuse = bomb_fuse_start
	bomb_ticking = false
	bomb_scale_variety = 0
	bomb_tooltip = new_text("Bomb Tooltip", 45, 0x000000, 0xFFFFFF, 2)
	bomb_tooltip.anchor = {0.5, 0.5}
	bomb_tooltip_obj = {0, 0}
	bomb_tooltip.visible = false
	add_child(stage_child, bomb_tooltip)
	bomb_radius_debug = new_graphics()
	g_line_style(bomb_radius_debug, 0)
	add_child(stage_child, bomb_radius_debug)
	bomb_radius = 200
	blood_setup()

	if !map_load_selected() {
		map_select(0)
		map_load_selected()
	}
	setup_map(&map_data)

	camera = {}
	cameras_disabled = false

	message = new_text("", 20, 0x000000, 0xFFFFFF, 3)
	message.x = 0
	message.y = window_h
	message.anchor.y = 1
	add_child(stage, message)
	message_game_over = new_text("", 30, 0x000000, 0xFFFFFF, 2)
	message_game_over.x = window_w / 2
	message_game_over.y = window_h / 2
	message_game_over.anchor.x = 0.5
	add_child(stage, message_game_over)
	tooltip = new_text("Tooltip", 30, 0x000000, 0xFFFFFF, 2)
	tooltip.anchor.x = 0.5
	tooltip_obj = {0, 0}
	add_child(stage_child, tooltip)

	alert_clip = new_sprite_obj(.Basic, make_clip(alert_frames), display_actors)
	alert_clip.sprite.clip.loop = false
	alert_clip.sprite.visible = false
	alert_clip.sprite.scale = {0.4, 0.4}
	alert_clip.sprite.clip.animation_speed = 0.8

	drag_distance = 5
	add_key_handlers()
	for pi in 0 ..< MAX_PLAYERS {
		if !players[pi].active do continue
		prev := player_switch(pi)
		prog_init(400, 400, 60, 15)
		player_switch(prev)
	}
	spyglass_valid = false
	mouse = {}
}

setup_map :: proc(m: ^Map_Data) {
	grid_build(m)
	grid_set_images_for_tiles()
	nav_build()
	door_cells := make([dynamic]int, context.temp_allocator)
	for ds in grid.door_sprites do append(&door_cells, cell_index(ds.door_cell))
	squad_build(nav.grid, door_cells[:])
	squad_set_patrol_routes(m.patrol_routes)
	physics_build()
	grid_width_px = f64(grid.width * grid.cell_size)
	grid_height_px = f64(grid.height * grid.cell_size)
	blood_setup_texture()
	fog_setup()
	add_child(display_tiles_walls, tile_containers[0])
	add_child(display_tiles_walls, tile_containers[2])
	add_child(display_tiles_walls, tile_containers[5])
	add_child(display_tiles, tile_containers[1])
	add_child(display_tiles, tile_containers[3])
	add_child(display_tiles, tile_containers[4])

	players_spawn_all({m.hero.x, m.hero.y})
	hero_last_seen = new_sprite_obj(.Basic, new_sprite(img_last_seen), nil)
	hero_last_seen.sprite.visible = false
	for gp in m.guards {
		riot := random_int_from_interval(0, 2) != 0
		inst := new_guard(riot ? img_guard_riot_reg : img_guard_reg, riot)
		inst.x = gp.x
		inst.y = gp.y
		physics_add_guard(inst, inst.radius)
		squad_add_guard(inst)
		guard_get_random_patrol_path(inst)
		append(&guards, inst)
	}
	guard_backup_spawn = {m.guard_backup_spawn.x, m.guard_backup_spawn.y}
	num_backup_guards = m.backup_guards
	backup_called = false
	computer_for_security_cameras = new_sprite_obj(.Basic, new_sprite(img_computer), nil)
	computer_for_security_cameras.x = m.computer.x
	computer_for_security_cameras.y = m.computer.y
	grid_make_wall_solid(computer_for_security_cameras.x, computer_for_security_cameras.y)
	for c in m.security_cams {
		append(&security_cameras, new_security_camera(c.x, c.y, c.swivel_max, c.swivel_min))
	}
	getawaycar = new_sprite_obj(.Basic, new_sprite(img_getawaycar), nil)
	getawaycar.x = m.van.x
	getawaycar.y = m.van.y
	car_init(getawaycar, -math.PI / 2)
	has_escape_zone = m.has_escape
	escape_zone = m.escape
	if has_escape_zone {
		escape_zone_sprite = new_graphics()
		g_begin_fill(escape_zone_sprite, 0x00ff66, 0.12)
		g_line_style(escape_zone_sprite, 3, 0x00ff66, 0.8)
		g_draw_rect(escape_zone_sprite, escape_zone[0], escape_zone[1], escape_zone[2], escape_zone[3])
		g_end_fill(escape_zone_sprite)
		add_child(display_tiles, escape_zone_sprite)
	}
	money := new_sprite_obj(.Basic, new_sprite(img_money), nil)
	money.x = m.loot.x
	money.y = m.loot.y
	append(&loot, money)
}

// ---------------------------------------------------------------- animate

STEP_MS :: 1000.0 / 60
MAX_FRAME_MS :: 250.0
step_accumulator: f64
paused: bool

// One rendered frame of gameplay: fixed 60 Hz steps, then the fog.
animate_gameplay :: proc(delta_ms: f64) {
	dt := min(delta_ms, MAX_FRAME_MS)
	if !paused {
		step_accumulator += dt
		for step_accumulator >= STEP_MS {
			step_accumulator -= STEP_MS
			if net_is_client() do client_gameloop(STEP_MS)
			else do gameloop(STEP_MS)
		}
	}
	fog_update()
}

// ---------------------------------------------------------------- per-guard

reaction_timeout :: proc(data: rawptr, arg: int) {
	g := cast(^Sprite)data
	for p in players {
		if p.active && p.hero != nil && sprite_sees(g, p.hero) do g.can_shoot = true
	}
	g.reacting = false
}

update_guard_blind_fx :: proc(g: ^Sprite) {
	blinded := g.alive && g.blind_until != 0 && clock_now() < g.blind_until
	if blinded {
		if g.blind_fx == nil {
			g.blind_fx = new_graphics()
			g.blind_fx_angle = 0
			add_child(display_effects, g.blind_fx)
		}
		g.blind_fx_angle += 0.18
		fx := g.blind_fx
		g_clear(fx)
		R :: 20.0
		for k in 0 ..< 3 {
			a := g.blind_fx_angle + f64(k) * (math.PI * 2 / 3)
			g_begin_fill(fx, 0xffee44, 0.95)
			g_draw_circle(fx, math.cos(a) * R, math.sin(a) * R * 0.5, 4)
			g_end_fill(fx)
		}
		fx.x = g.x
		fx.y = g.y - 26
	} else if g.blind_fx != nil {
		fx := g.blind_fx
		remove_from_parent(fx)
		free_node(fx)
		g.blind_fx = nil
	}
}

null_target :: #force_inline proc(s: ^Sprite) {
	s.target.null = true
}

// Whether the local player can see this guard (fog of war). Uses the local spyglass.
guard_update_visibility :: proc(guard: ^Sprite) {
	if !enable_los do return
	in_fog_range := get_distance(guard.x, guard.y, spyglass_pos.x, spyglass_pos.y) <= FOG_RADIUS
	if !in_fog_range {
		guard.sprite.visible = false
	} else if hero.spyglass_equipped && spyglass_in_door && physics_can_see_ignoring_doors(guard.x, guard.y, spyglass_pos.x, spyglass_pos.y) {
		guard.sprite.visible = true
	} else if physics_can_see(guard.x, guard.y, spyglass_pos.x, spyglass_pos.y) {
		guard.sprite.visible = true
	} else {
		guard.sprite.visible = false
	}
	for cam in security_cameras {
		if cam.hacked && cam.alive && sprite_sees(cam, guard) do guard.sprite.visible = true
	}
}

gameloop_guards :: proc(dt: f64) {
	for i := 0; i < len(guards); i += 1 {
		guard := guards[i]
		update_guard_blind_fx(guard)
		if !guard.alive do continue
		if guard.blind_until != 0 && clock_now() < guard.blind_until {
			if physics_has_actor(guard) do physics_stop(guard)
			continue
		}
		if guard.dodge_until != 0 && clock_now() < guard.dodge_until {
			sprite_move_to_target(guard)
			continue
		}
		guard_update_visibility(guard)
		if tick_stunned(guard) do continue
		prev := player_switch(pick_seen_hero(guard))
		defer player_switch(prev)
		pid := bound_player
		guard.currently_sees_hero = sprite_sees(guard, hero)
		aim_x_offset := math.floor(random() * guard.accuracy)
		aim_y_offset := math.floor(random() * guard.accuracy)
		if guard.can_shoot {
			ax, ay := physics_sight_stop(guard.x, guard.y, hero.x + aim_x_offset, hero.y + aim_y_offset)
			guard.aim_start = {guard.x, guard.y}
			guard.aim_end = {ax, ay}
		}
		if !guard.alarmed && !guard.being_choked_out {
			for j := 0; j < len(alarming_objects); j += 1 {
				if sprite_sees(guard, alarming_objects[j]) {
					new_message("A guard has seen something alarming!")
					guard_see_alarming_object(guard)
				}
			}
			if !guard.being_choked_out && guard.currently_sees_hero {
				if hero_will_cause_alert(hero) || guard_knows_face(guard, pid) {
					if !hero.masked do guard_learn_face(guard, pid)
					new_message("A guard has seen you being suspicious!")
					guard_see_alarming_object(guard)
					set_latest_alert(guard)
					guard.target_rotate = rot_sprite(hero)
					hero_set_last_seen(hero, guard)
					guard.saw_hero_last_at = {hero.x, hero.y}
					squad_update_belief(hero.x, hero.y, clock_now())
				}
			} else {
				guard.target_rotate = rot_none
			}
		} else {
			if !guard.being_choked_out && guard.currently_sees_hero {
				if (hero_will_cause_alert(hero) || guard_knows_face(guard, pid)) && hero.alive {
					if !hero.masked {
						guard_learn_face(guard, pid)
						guard.sprite_body.tex = guard.has_riot_shield ? img_guard_riot_knows_face : img_guard_knows_hero_face
					}
					guard.moving = false
					guard.target_rotate = rot_sprite(hero)
					if guard.can_shoot {
						do_gun_shot_effects(guard, false)
						sprite_shoot(guard)
						eject_shell(guard)
						if guard.accuracy > 10 do guard.accuracy -= 10
						else do guard.accuracy = 0
					} else {
						if !guard.reacting {
							guard.reacting = true
							clock_after(guard.shoot_speed, reaction_timeout, guard)
						}
					}
					set_latest_alert(guard)
					hero_set_last_seen(hero, guard)
					guard.saw_hero_last_at = {hero.x, hero.y}
					squad_update_belief(hero.x, hero.y, clock_now())
				}
			} else {
				if len(guard.path) > 0 && get_distance(guard.x, guard.y, guard.path[0].x, guard.path[0].y) < 100 {
					guard.target_rotate = rot_point(guard.path[0])
				} else {
					guard.target_rotate = rot_none
				}
				squad_steer_alarmed(guard, clock_now())
			}
		}
		if len(guard.path) > 0 {
			if guard.target.null do guard.target = path_shift(guard)
		} else {
			guard_get_random_patrol_path(guard)
		}
		if nav_ready() && guard.moving && !guard.target.null &&
		   !nav_is_direct_path_clear({guard.x, guard.y}, {guard.target.x, guard.target.y}, guard.radius) {
			null_target(guard)
			clear_path(guard)
			guard.chasing_hero = false
		}
		if sprite_move_to_target(guard) {
			null_target(guard)
		} else if guard_check_stuck(guard) {
			null_target(guard)
			clear_path(guard)
			guard.chasing_hero = false
		}
	}
}

sprite_shoot :: proc(s: ^Sprite) {
	gun_shoot(s.gun, s)
	s.can_shoot = false
}

gameloop_security_cams :: proc(dt: f64) {
	for cam in security_cameras {
		if !cameras_disabled && cam.alive {
			if !(cam.blind_until != 0 && clock_now() < cam.blind_until) do camera_swivel(cam, dt)
			if !cam.alarmed {
				for j := 0; j < len(alarming_objects); j += 1 {
					o := alarming_objects[j]
					if sprite_sees(cam, o) {
						new_message("A security camera has seen something alarming!")
						camera_see_alarming_object(cam, o.x, o.y)
					}
				}
				for pi in 0 ..< MAX_PLAYERS {
					if !players[pi].active || cam.alarmed do continue
					prev := player_switch(pi)
					if sprite_sees(cam, hero) {
						if hero_will_cause_alert(hero) {
							new_message("A security camera has seen you being suspicious!")
							camera_see_alarming_object(cam, hero.x, hero.y)
							sprite_rotate_to(cam, hero.x, hero.y)
							set_latest_alert(cam)
							hero_set_last_seen(hero, nil)
							squad_update_belief(hero.x, hero.y, clock_now())
						}
					}
					player_switch(prev)
				}
			} else {
				for pi in 0 ..< MAX_PLAYERS {
					if !players[pi].active do continue
					prev := player_switch(pi)
					if sprite_sees(cam, hero) {
						if hero.masked {
							set_latest_alert(cam)
							hero_set_last_seen(hero, nil)
							squad_update_belief(hero.x, hero.y, clock_now())
						}
					}
					player_switch(prev)
				}
			}
		}
		if hero.alive && cam.alive && !cam.hacked && get_distance(hero.x, hero.y, cam.x, cam.y) <= hero.radius * drag_distance {
			show_tooltip("[Space] to bug camera", cam.x, cam.y - 32)
		}
		sprite_prepare_for_draw(cam)
	}
	c := computer_for_security_cameras
	if get_distance(hero.x, hero.y, c.x, c.y) <= hero.radius * 4 {
		if hero.alive && !cameras_disabled do show_tooltip("[Space] to deactivate cameras", c.x, c.y)
	}
	sprite_prepare_for_draw(c)
}

show_tooltip :: proc(text: string, x, y: f64) {
	if !bound_is_local() do return
	tooltip.visible = true
	tooltip_shown = true
	set_text(tooltip, text)
	tooltip_obj = {x, y}
}

remove_bullet :: proc(index: int) {
	b := bullets[index]
	net_ev_bullet_end(b)
	remove_child(display_actors, b.sprite)
	ordered_remove(&bullets, index)
	free_bullet(b)
}

damage_glass_in_bullet_path :: proc(b: ^Sprite, x0, y0, x1, y1: f64) {
	dx := x1 - x0
	dy := y1 - y0
	l := math.sqrt(dx * dx + dy * dy)
	if l == 0 do return
	steps := max(1, int(math.ceil(l / (f64(grid.cell_size) / 2))))
	for s in 0 ..= steps {
		t := f64(s) / f64(steps)
		gx, gy := grid_index_2d(x0 + dx * t, y0 + dy * t)
		c := grid_cell_at(gx, gy)
		if c != nil && c.solid && c.material == .Glass {
			idx := grid.width * gy + gx
			seen := false
			for h in b.glass_hit do if h == idx do seen = true
			if !seen {
				append(&b.glass_hit, idx)
				grid_damage_cell(idx, DAMAGE_AMOUNT[.Bullet], .Bullet)
			}
		}
	}
}

gameloop_bullets :: proc(dt: f64) {
	for b := 0; b < len(bullets); b += 1 {
		bullet := bullets[b]
		sprite_prepare_for_draw(bullet)
		from_x := bullet.x
		from_y := bullet.y
		reached_end := sprite_move_to_target(bullet)
		sprite_rotate_to_instant(bullet, bullet.target.x, bullet.target.y)
		to_x := reached_end ? bullet.target.x : bullet.x
		to_y := reached_end ? bullet.target.y : bullet.y
		damage_glass_in_bullet_path(bullet, from_x, from_y, to_x, to_y)
		by_hero := bullet.ignore.kind == .Hero
		mask := CAT_VISION_BLOCKER | (by_hero ? CAT_GUARD : CAT_HERO)
		if !by_hero && car_is_active() do mask |= CAT_CAR
		hit, has_hit := physics_bullet_hit(from_x, from_y, to_x, to_y, bullet.ignore, mask)
		if !by_hero {
			hit_drag := false
			for pi in 0 ..< MAX_PLAYERS {
				t := player_drag_target(pi)
				if !players[pi].active || t == nil do continue
				if circle_linesegment_intersect(t.x, t.y, t.radius, {from_x, from_y}, {to_x, to_y}) {
					if t.alive do sprite_kill(t)
					blood_particle_splatter(angle_between_points(from_x, from_y, t.x, t.y), t.x, t.y)
					hit_drag = true
					break
				}
			}
			if hit_drag {
				remove_bullet(b)
				b -= 1
				continue
			}
		}
		for cam in security_cameras {
			if circle_linesegment_intersect(cam.x, cam.y, cam.radius, {from_x, from_y}, {to_x, to_y}) do camera_kill(cam)
		}
		if has_hit && hit.owner != nil {
			victim := hit.owner
			if hit.category & CAT_CAR != 0 {
				car_hit_by_bullet(bullet.ignore.x, bullet.ignore.y)
			} else if victim.kind == .Hero {
				if victim.alive {
					prev := player_switch(victim.player_id)
					hero_hurt(hero, bullet.ignore.x, bullet.ignore.y)
					player_switch(prev)
				}
			} else if victim.alive {
				guard_dies := true
				splatter_angle := angle_between_points(bullet.ignore.x, bullet.ignore.y, victim.x, victim.y)
				if victim.has_riot_shield && victim.alarmed {
					if angle_in_arc_rad(victim.rad, math.PI / 2, math.PI + splatter_angle) {
						guard_dies = false
						shard_particle_splatter(splatter_angle, victim.x, victim.y)
					}
				}
				if guard_dies {
					sprite_kill(victim, bullet.ignore.x, bullet.ignore.y)
					blood_particle_splatter(splatter_angle, victim.x, victim.y)
					victim.blood_trail = true
					if victim.alarmed && !backup_called do new_message("You dispatch the guard before he can get the word out!")
					if by_hero && bullet.ignore.player_id == local_player do store_inc("guardsShot")
				}
			}
			remove_bullet(b)
			b -= 1
			continue
		}
		if has_hit || reached_end {
			ex, ey := has_hit ? hit.x : bullet.target.x, has_hit ? hit.y : bullet.target.y
			shard_particle_splatter(-angle_between_points(from_x, from_y, ex, ey), ex, ey)
			if has_hit && hit.cell >= 0 do grid_damage_cell(hit.cell, DAMAGE_AMOUNT[.Bullet], .Bullet)
			remove_bullet(b)
			b -= 1
			continue
		}
	}
}

gameloop_doors :: proc(dt: f64) {
	for d in grid.door_sprites {
		wall := d.door_cell
		cx := wall.x + f64(grid.cell_size) / 2
		cy := wall.y + f64(grid.cell_size) / 2
		d.opener_near = false
		for unit in physics_openers_near(cell_index(wall)) {
			if unit.kind != .Hero && unit.alive && get_distance(cx, cy, unit.x, unit.y) <= unit.radius * 4 do d.opener_near = true
		}
		for pi in 0 ..< MAX_PLAYERS {
			if !players[pi].active do continue
			prev := player_switch(pi)
			if get_distance(cx, cy, hero.x, hero.y) <= hero.radius * 4 {
				if d.unlocked do d.opener_near = true
				if hero.ability_kick_doors && keys.shift {
					door_open(d)
					d.broken = true
				}
				if hero.alive do show_tooltip("[Space]", d.x, d.y - 32)
			}
			if hero_drag_target != nil && get_distance(cx, cy, hero_drag_target.x, hero_drag_target.y) <= hero_drag_target.radius * 4 {
				d.opener_near = true
			}
			player_switch(prev)
		}
		if d.opener_near do door_open(d)
		else do door_close(d)
	}
}

gameloop_dragtarget :: proc(dt: f64) {
	for pi in 0 ..< MAX_PLAYERS {
		if !players[pi].active do continue
		prev := player_switch(pi)
		player_dragtarget()
		player_switch(prev)
	}
}

player_dragtarget :: proc() {
	for guard in guards {
		if hero.alive && guard.alive && !guard.being_choked_out && get_distance(hero.x, hero.y, guard.x, guard.y) <= hero.radius * drag_distance {
			show_tooltip("[Space]", guard.x, guard.y - 32)
		}
	}
	if !tooltip_shown {
		tooltip.visible = false
	}
	if hero_drag_target != nil {
		t := hero_drag_target
		t.target = new_point(hero.x, hero.y)
		sprite_get_dragged(t)
		if t.blood_trail {
			bx := random_float_with_bias(-10, 10)
			by := random_float_with_bias(-10, 10)
			bs := random_float_with_bias(1, t.blood_trail_size)
			skip := random_float_from_interval(0, t.blood_trail_skip_frequency)
			if t.blood_trail_size > 3 do t.blood_trail_size -= 0.01
			t.blood_trail_skip_frequency += 0.01
			if skip <= 1 do draw_blood_trail(t.x + bx, t.y + by, bs)
		}
	}
}

js_round :: proc(x: f64) -> int { return int(math.floor(x + 0.5)) }

gameloop_messages_and_tooltip :: proc(dt: f64) {
	tooltip.x = tooltip_obj.x
	tooltip.y = tooltip_obj.y
	bomb_tooltip.x = bomb_tooltip_obj.x
	bomb_tooltip.y = bomb_tooltip_obj.y
	for i := 0; i < len(messages_floating); i += 1 {
		m := &messages_floating[i]
		m.node.x = m.obj_x
		m.node.y = m.obj_y
		start_speed := 0.1 * dt / stage_child.scale.x
		if m.last_float_speed == 0 {
			m.obj_y -= start_speed
			m.last_float_speed = start_speed
		} else {
			m.obj_y -= m.last_float_speed
		}
		m.last_float_speed *= 0.98
		if m.last_float_speed <= start_speed * 0.5 do m.node.alpha -= 0.0007 * dt
		if m.node.alpha <= 0 {
			remove_child(stage_child, m.node)
			free_node(m.node)
			ordered_remove(&messages_floating, i)
			i -= 1
		}
	}
}

gameloop_getawaycar_and_loot :: proc(dt: f64) {
	sprite_prepare_for_draw(getawaycar)
	for l in loot do sprite_prepare_for_draw(l)
	for pi in 0 ..< MAX_PLAYERS {
		if !players[pi].active do continue
		prev := player_switch(pi)
		player_pick_up_loot()
		player_switch(prev)
	}
	if !has_won && car_is_active() && car_carries_loot() && has_escape_zone {
		ex, ey, ew, eh := escape_zone[0], escape_zone[1], escape_zone[2], escape_zone[3]
		if getawaycar.x >= ex && getawaycar.x <= ex + ew && getawaycar.y >= ey && getawaycar.y <= ey + eh {
			has_won = true
			new_message("You escaped with the loot! Clean getaway.")
			if net_is_host_or_offline() {
				if selected_map + 1 < len(MAPS) {
					ui_add_button_row({{"Play Again", .Play_Again}, {"Next Heist", .Next_Heist}}, window_w / 2, window_h / 2)
				} else {
					ui_add_button("Play Again", window_w / 2, window_h / 2, .Play_Again)
				}
			}
			store_inc("wins")
			net_on_game_over(true)
		}
	}
}

player_pick_up_loot :: proc() {
	if hero.carry == nil && !hero.in_car && hero.alive {
		for l in loot {
			if get_distance(hero.x, hero.y, l.x, l.y) <= hero.radius * 2 {
				hero.carry = l
				l.sprite.visible = false
				new_message("You've got the money!  Get it to the van and drive to the escape zone!")
				break
			}
		}
	}
}

gameloop_alert_animation :: proc(dt: f64) {
	if latest_alert != nil {
		if !sprite_sees(latest_alert, hero) || !latest_alert.alive {
			alert_clip.sprite.visible = false
			latest_alert = nil
		} else {
			dist_from_hero := 400.0
			dx := -hero.x + latest_alert.x
			dy := -hero.y + latest_alert.y
			C := math.sqrt(dx * dx + dy * dy)
			alert_clip.x = hero.x + dx * (dist_from_hero / C)
			alert_clip.y = hero.y + dy * (dist_from_hero / C)
			if dist_from_hero >= C {
				alert_clip.x = latest_alert.x
				alert_clip.y = latest_alert.y - 64
			}
		}
	}
}

pick_up_gun_drop :: proc(d: ^Gun_Drop) {
	hero.gun = d.gun
	set_hero_image()
	new_floating_message(fmt.tprintf("You picked up: %s!", d.gun.name), hero.x, hero.y, 0xFFaa00)
	remove_child(d.parent, d.sprite)
	d.flag_for_removal = true
}

hero_fire :: proc() {
	hero.gun.ammo -= 1
	do_gun_shot_effects(hero, hero.gun.silenced)
	if bound_is_local() do camera_kickback()
	eject_shell(hero)
	sprite_shoot(hero)
	if !hero.gun.silenced do unsilenced_gun()
}

// One fixed step. The per-player parts run once per robber with that robber's state bound
// (see players.odin); with a single player the order of operations is exactly the original.
gameloop :: proc(dt: f64) {
	clock_update(dt)
	nav_update(dt)
	squad_update(clock_now())
	if mouse_relative.x != -10000 do mouse = cam_get_mouse(mouse_relative)
	net_host_apply_remote_inputs()
	for_each_player(player_step_input, dt)
	tooltip_shown = false
	sprite_prepare_for_draw(alert_clip)
	for_each_player(player_step_progress, dt)
	for d in grid.door_sprites do sprite_prepare_for_draw(d)
	for_each_player(player_step_move, dt)
	update_particles(dt)
	for c in grid.cells do cell_prepare_for_draw(c)
	sprite_prepare_for_draw(bomb)
	if bomb.sprite.visible {
		g_clear(bomb_radius_debug)
		g_begin_fill(bomb_radius_debug, 0x990000, 1.0)
		g_draw_circle(bomb_radius_debug, bomb.x, bomb.y, bomb_radius)
	} else {
		g_clear(bomb_radius_debug)
	}
	if backup_called {
		hero_last_seen.sprite.visible = math.sqrt(math.pow(hero.x - hero_last_seen.x, 2) + math.pow(hero.y - hero_last_seen.y, 2)) > hero.radius
	}
	sprite_prepare_for_draw(hero_last_seen)
	with_car_driver(car_update_pre_step)
	gameloop_guards(dt)
	for_each_player(proc(dt: f64) { kick_hits() }, dt)
	for_each_player(proc(dt: f64) {
		sprint_knockback(hero, guards[:], keys.shift && hero_drag_target == nil)
	}, dt)
	notify_guards_of_hero_location = false
	physics_step(dt)
	physics_sync_actors()
	car_update_post_step(dt)
	for p in players do if p.active do sprite_prepare_for_draw(p.hero)
	for g in guards do sprite_prepare_for_draw(g)
	gameloop_security_cams(dt)
	gameloop_alert_animation(dt)
	gameloop_bullets(dt)
	gameloop_bomb(dt)
	grenades_update(dt)
	gameloop_getawaycar_and_loot(dt)
	gameloop_doors(dt)
	gameloop_dragtarget(dt)
	nav_debug_draw()
	gameloop_messages_and_tooltip(dt)
	for d in doodads do prepare_simple(d.sprite, d.x, d.y, d.rad)
	for i := 0; i < len(gun_drops); i += 1 {
		d := gun_drops[i]
		if d.flag_for_removal {
			ordered_remove(&gun_drops, i)
			i -= 1
			continue
		}
		prepare_simple(d.sprite, d.x, d.y, d.rad)
		for pi in 0 ..< MAX_PLAYERS {
			if !players[pi].active do continue
			prev := player_switch(pi)
			picked := false
			if get_distance(hero.x, hero.y, d.x, d.y) <= hero.radius * drag_distance {
				if hero.ability_auto_pickup_ammo {
					pick_up_gun_drop(d)
					picked = true
				} else {
					show_tooltip("[Right Click] to pick up gun.", d.x, d.y)
				}
			}
			player_switch(prev)
			if picked do break
		}
		if d.flag_for_removal do break
	}
	update_camera(dt)
	physics_debug_draw()
	breach_debug_draw()
	net_host_after_step()
	points_maybe_sweep()
}

for_each_player :: proc(fn: proc(dt: f64), dt: f64) {
	for pi in 0 ..< MAX_PLAYERS {
		if !players[pi].active do continue
		prev := player_switch(pi)
		fn(dt)
		player_switch(prev)
	}
}

// Keys -> movement target, and automatic fire.
player_step_input :: proc(dt: f64) {
	hero_end_aim.x, hero_end_aim.y = physics_sight_stop(hero.x, hero.y, mouse.x, mouse.y)
	if keys.w do hero.target.y = hero.y - 100
	else if keys.s do hero.target.y = hero.y + 100
	else do hero.target.y = hero.y
	if keys.d do hero.target.x = hero.x + 100
	else if keys.a do hero.target.x = hero.x - 100
	else do hero.target.x = hero.x
	hero.target.null = false
	if hero.gun_out && keys.lmb && hero.gun.automatic {
		if hero.gun.ammo > 0 {
			hero_fire()
		} else if bound_is_local() {
			camera.shake_decay = 1.5
		}
	}
}

player_step_progress :: proc(dt: f64) {
	if prog_bar.visible {
		prog_increment(dt)
		prog_prepare_for_draw()
		prog_draw()
	}
}

// Move, aim, spyglass, off-limits tiles and facing.
player_step_move :: proc(dt: f64) {
	if net_hero_is_client_driven(bound_player) {
		net_host_apply_remote_position(bound_player)
		kick_tick(hero)
	} else if !kick_drive(hero) {
		sprite_move_to_target(hero)
	}
	if hero.alive && hero.gun_out {
		hero.aim_start = {hero.x, hero.y}
		hero.aim_end = hero_end_aim
	}
	spyglass_pos = hero_get_spyglass_pos(hero)
	spyglass_valid = true
	spyglass_in_wall := is_wall_solid_and_not_door(spyglass_pos.x, spyglass_pos.y)
	spyglass_in_door = is_wall_door(spyglass_pos.x, spyglass_pos.y)
	if !hero.alive || (!hero.spyglass_equipped || spyglass_in_wall) {
		spyglass_pos = {hero.x, hero.y}
		hero.sprite_spyglass.visible = false
	} else {
		hero.sprite_spyglass.visible = true
	}
	if is_tile_restricted(hero.x, hero.y) {
		if hero.alive do hero.in_off_limits = true
	} else {
		hero.in_off_limits = false
	}
	if hero.alive && hero_drag_target == nil {
		hero.aim_point = {x = mouse.x, y = mouse.y}
		hero.target_rotate = rot_point(&hero.aim_point)
		sprite_rotate_to_instant(hero, mouse.x, mouse.y)
	} else if hero_drag_target != nil {
		hero.target_rotate = rot_sprite(hero_drag_target)
	} else {
		hero.target_rotate = rot_none
	}
}

// ---------------------------------------------------------------- helpers

new_message :: proc(m: string) {
	net_ev_msg(m)
	append(&message_text, strings.clone(m))
	if len(message_text) > 3 {
		delete(message_text[0])
		ordered_remove(&message_text, 0)
	}
	b := strings.builder_make(context.temp_allocator)
	for t in message_text {
		strings.write_string(&b, t)
		strings.write_string(&b, "\n")
	}
	set_text(message, strings.to_string(b))
}

// A message only this machine's player should see (never sent to the crew).
local_message :: proc(m: string) {
	net.mute += 1
	new_message(m)
	net.mute -= 1
}

new_floating_message :: proc(m: string, x, y: f64, color: u32) {
	net_ev_float(m, x, y, color)
	n := new_text(m, 30 / stage_child.scale.x, color, 0xFFFFFF, 3)
	n.anchor.y = 1
	append(&messages_floating, Floating_Message{node = n, obj_x = x, obj_y = y})
	add_child(stage_child, n)
}

BACKUP_WAVE_INTERVAL_MS :: 5000.0

spawn_backup :: proc() {
	new_message("The police have arrived!")
	remaining := num_backup_guards
	wave := 0
	for remaining > 0 {
		size := min(remaining, wave % 2 == 0 ? 3 : 2)
		clock_after(f64(wave) * BACKUP_WAVE_INTERVAL_MS, proc(data: rawptr, size: int) {
			for _ in 0 ..< size do spawn_individual_backup()
		}, nil, size)
		remaining -= size
		wave += 1
	}
}

spawn_individual_backup :: proc() {
	riot := random_int_from_interval(0, 2) != 0
	g := new_guard(img_guard_alert, riot)
	g.x = guard_backup_spawn.x
	g.y = guard_backup_spawn.y
	physics_add_guard(g, g.radius)
	guard_become_alarmed(g)
	g.chasing_hero = false
	squad_add_guard(g)
	append(&guards, g)
}

alert_all_guards :: proc() {
	for g in guards {
		if g.alive && get_distance(hero.x, hero.y, g.x, g.y) < 500 do guard_become_alarmed(g)
	}
	if !backup_called {
		backup_called = true
		spawn_backup()
	}
}

unsilenced_gun :: proc() {
	alert_all_guards()
	hero_set_last_seen(hero, nil)
	squad_update_belief(hero.x, hero.y, clock_now())
}

set_hero_image :: proc() {
	if hero.gun_out {
		switch hero.gun.name {
		case "Shotgun": hero.sprite_body.tex = img_hero_with_shotty
		case "Sawed-Off Shotty": hero.sprite_body.tex = img_hero_with_shotty_sawed
		case "Handgun": hero.sprite_body.tex = img_hero_with_pistol
		case "Silenced Handgun": hero.sprite_body.tex = img_hero_with_pistol_silenced
		case "Machine Gun": hero.sprite_body.tex = img_hero_with_machine_gun
		case: hero_img_mask_on(hero, true)
		}
	} else {
		hero.sprite_body.tex = img_hero_body
	}
}

use_mask :: proc(toggle: bool) {
	hero.masked = toggle
	if toggle {
		// `hero.sprite.texture = img_hero_with_money` sets a texture on a Container:
		// it draws nothing, so carrying the loot just leaves the head as it was.
		if hero.carry == nil do hero_img_mask_on(hero, true)
	} else {
		hero_img_mask_on(hero, false)
		for g in guards {
			if g.alive && !g.being_choked_out && sprite_sees(g, hero) {
				guard_learn_face(g, bound_player)
				new_message("A guard has seen you taking off your mask!")
				guard_see_alarming_object(g)
				set_latest_alert(g)
				g.target_rotate = rot_sprite(hero)
				hero_set_last_seen(hero, g)
				g.saw_hero_last_at = {hero.x, hero.y}
				squad_update_belief(hero.x, hero.y, clock_now())
			}
		}
	}
}

// The music it switches is never loaded in the web build.
hero_is_dead :: proc() {}

do_gun_shot_effects :: proc(unit: ^Sprite, silenced: bool) {
	if silenced do play_sound(.Gun_Shot_Silenced)
	else do play_gun_shots()
	emit_nav_danger(unit.x, unit.y, silenced ? 0.5 : 1.5, 1)
}

set_latest_alert :: proc(unit: ^Sprite) {
	net_ev_alert(unit)
	if hero_last_seen.sprite.visible || !backup_called {
		cf := clip_current_frame(alert_clip.sprite)
		if latest_alert != unit && (cf == len(alert_clip.sprite.clip.frames) - 1 || cf == 0) {
			latest_alert = unit
			alert_clip.sprite.visible = true
			clip_goto_and_play(alert_clip.sprite, 0)
			clock_after(3500, proc(data: rawptr, arg: int) {
				alert_clip.sprite.visible = false
			})
		}
	}
}

set_bomb :: proc(fuse_start: f64) {
	bomb_fuse_start = fuse_start
	bomb_fuse = bomb_fuse_start
	bomb_scale_variety = 0
	bomb_ticking = true
}

gameloop_bomb :: proc(dt: f64) {
	if !bomb_ticking do return
	set_text(bomb_tooltip, fmt.tprintf("%.1f", bomb_fuse / 1000.0))
	bomb_fuse -= dt
	p := 1 - bomb_fuse / bomb_fuse_start
	if p >= 0.95 {
		bomb_tooltip.text.fill = 0xff0000
	} else {
		d := u32(js_round(p * 16)) & 0xF
		bomb_tooltip.text.fill = (d * 0x11) << 16
	}
	s := 0.1 * math.sin(bomb_scale_variety) + 1
	bomb_tooltip.scale = {s, s}
	bomb_scale_variety += dt * 0.01
	if bomb_fuse <= 0 {
		bomb_ticking = false
		explode_bomb()
	}
}

explode_bomb :: proc() {
	// clients play the bang, shake and doodad clean-up from this one event
	net_ev_explosion(bomb.x, bomb.y)
	net.mute += 1
	play_sound(.Explosion)
	cam_start_shake(300, 12)
	net.mute -= 1
	bomb.sprite.visible = false
	bomb_tooltip.visible = false
	alert_all_guards()
	hero.last_seen_x = bomb.x
	hero.last_seen_y = bomb.y
	hero_last_seen.x = bomb.x
	hero_last_seen.y = bomb.y
	notify_guards_of_hero_location = true
	squad_update_belief(bomb.x, bomb.y, clock_now())
	for c, w in grid.cells {
		if get_distance(bomb.x, bomb.y, c.x, c.y) < bomb_radius do grid_damage_cell(w, DAMAGE_AMOUNT[.Bomb], .Bomb)
	}
	emit_nav_danger(bomb.x, bomb.y, 8, 3)
	for g := 0; g < len(guards); g += 1 {
		guard := guards[g]
		if get_distance(bomb.x, bomb.y, guard.x, guard.y) < bomb_radius do sprite_kill(guard, bomb.x, bomb.y)
	}
	for d := 0; d < len(doodads); d += 1 {
		dd := doodads[d]
		if get_distance(bomb.x, bomb.y, dd.x, dd.y) < bomb_radius + 32 {
			remove_child(dd.parent, dd.sprite)
			ordered_remove(&doodads, d)
			d -= 1
		}
	}
	for pi in 0 ..< MAX_PLAYERS {
		if !players[pi].active do continue
		prev := player_switch(pi)
		if hero.alive && get_distance(bomb.x, bomb.y, hero.x, hero.y) < bomb_radius do kill_hero(bomb.x, bomb.y)
		player_switch(prev)
	}
}

plant_bomb :: proc() {
	hero.moving = true
	bomb.sprite.visible = true
	bomb.x = hero.x
	bomb.y = hero.y
	bomb_tooltip_obj = {bomb.x, bomb.y - 32}
	bomb_tooltip.visible = true
}

drop_gun :: proc(gun: ^Gun, x, y: f64) {
	image: ^Texture
	switch gun.name {
	case "Shotgun": image = img_gun_shotgun
	case "Handgun": image = img_gun_pistol
	case "Sawed-Off Shotty": image = img_gun_shotgun_sawed
	case "Silenced Handgun": image = img_gun_pistol_silenced
	case "Machine Gun": image = img_gun_machine
	}
	append(&gun_drops, new_gun_drop(new_sprite(image), display_effects, x, y, gun))
}

kill_hero :: proc(from_x, from_y: f64) {
	hero_kill(hero, from_x, from_y)
}

// ---------------------------------------------------------------- systems/camera.ts

KICKBACK_SPEED :: 5.0
KICKBACK_AMOUNT :: 30.0

update_camera :: proc(dt: f64) {
	car_target, has_car := car_camera_target()
	watched := spectate_hero()
	if watched != nil do has_car = watched.in_car
	desired := has_car ? zoom * CAR_ZOOM_OUT : zoom
	if stage_child.scale.x < desired - 0.05 {
		stage_child.scale.x += zoom_magnitude
		stage_child.scale.y += zoom_magnitude
		change_font_sizes()
	} else if stage_child.scale.x > desired + 0.05 {
		stage_child.scale.x -= zoom_magnitude
		stage_child.scale.y -= zoom_magnitude
		change_font_sizes()
	}
	if watched != nil {
		p := spectate_camera_point(watched)
		camera.x = p.x
		camera.y = p.y
	} else if has_car {
		camera.x = car_target.x
		camera.y = car_target.y
	} else {
		camera.x = hero.x + (mouse.x - hero.x) / look_sensitivity
		camera.y = hero.y + (mouse.y - hero.y) / look_sensitivity
	}
	cam_w := window_w * (1 / stage_child.scale.x)
	cam_h := window_h * (1 / stage_child.scale.y)
	ax := camera.x
	ay := camera.y
	if camera.x < 0 + cam_w / 2 do ax = 0 + cam_w / 2
	if camera.y < 0 + cam_h / 2 do ay = 0 + cam_h / 2
	if camera.x >= grid_width_px - cam_w / 2 do ax = grid_width_px - cam_w / 2
	if camera.y >= grid_height_px - cam_h / 2 do ay = grid_height_px - cam_h / 2
	if cam_w > grid_width_px do ax = grid_width_px / 2
	if cam_h > grid_height_px do ay = grid_height_px / 2
	camera.x = ax
	camera.y = ay
	if camera.shaking {
		camera.pos_before_shake_x = ax
		camera.pos_before_shake_y = ay
	}
	cam_shake()
	if camera.has_kick {
		mv := move_to_target_xy(camera.kick.x, camera.kick.y, camera.x, camera.y, KICKBACK_SPEED)
		if mv.x == camera.x && mv.y == camera.y {
			camera.has_kick = false
		} else {
			camera.kick = {mv.x, mv.y}
			stage_child.x = (-camera.kick.x + cam_w / 2) * stage_child.scale.x
			stage_child.y = (-camera.kick.y + cam_h / 2) * stage_child.scale.y
		}
	} else {
		stage_child.x = (-camera.x + cam_w / 2) * stage_child.scale.x
		stage_child.y = (-camera.y + cam_h / 2) * stage_child.scale.y
	}
}

change_font_sizes :: proc() {
	tooltip.text.size = 30 / stage_child.scale.x
}

camera_kickback :: proc() {
	d := get_distance(hero.x, hero.y, mouse.x, mouse.y)
	mod := random_float_from_interval(0, 20)
	c := KICKBACK_AMOUNT + mod
	xx := -(c / d) * (mouse.x - hero.x)
	yy := -(c / d) * (mouse.y - hero.y)
	camera.kick = {xx + camera.x, yy + camera.y}
	camera.has_kick = true
}
