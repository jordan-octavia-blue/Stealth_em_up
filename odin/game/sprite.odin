package game

// jo_sprite.ts, sprite_hero.ts, sprite_guard.ts, jo_security_camera.ts, jo_door.ts,
// jo_gun.ts, jo_gun_drop.ts, jo_doodad.ts.
//
// One `Sprite` struct stands in for jo_sprite and every "subclass" built on its
// prototype; `kind` says which methods apply. Waypoints are shared heap points (see the
// pool below) so the JS aliasing between `target`, `path[0]` and `target_rotate` holds.

import "core:math"
import "core:fmt"

// ---------------------------------------------------------------- path point pool
//
// JS waypoints are garbage collected. Here they come from a pool that is swept (mark
// from every live sprite's target / target_rotate / path) at the end of a fixed step,
// once enough have been handed out since the last sweep.

point_pool: struct {
	all:         [dynamic]^Path_Point,
	free:        [dynamic]^Path_Point,
	since_sweep: int,
}

new_point :: proc(x, y: f64) -> ^Path_Point {
	p: ^Path_Point
	if n := len(point_pool.free); n > 0 {
		p = point_pool.free[n - 1]
		pop(&point_pool.free)
		p^ = {}
	} else {
		p = new(Path_Point)
		append(&point_pool.all, p)
	}
	p.x = x
	p.y = y
	point_pool.since_sweep += 1
	return p
}

points_maybe_sweep :: proc() {
	if point_pool.since_sweep < 4096 do return
	point_pool.since_sweep = 0
	for p in point_pool.all do p.mark = false
	for s in all_sprites {
		if s.target != nil do s.target.mark = true
		if s.target_rotate.point != nil do s.target_rotate.point.mark = true
		for p in s.path do p.mark = true
	}
	for p in point_pool.all {
		if !p.mark && !p.in_free {
			p.in_free = true
			append(&point_pool.free, p)
		}
	}
}

// ---------------------------------------------------------------- guns

Gun :: struct {
	name:             string,
	id:               string,
	damage:           f64,
	loudness:         f64,
	clip_size:        int,
	ammo:             int,
	silenced:         bool,
	automatic:        bool,
	bullets_per_shot: int,
	spread:           f64,
}

gun_shotgun, gun_shotgun_sawed_off, gun_pistol, gun_pistol_silenced, gun_machine: Gun
all_gun_prefabs_without_sawed: [4]^Gun

make_gun :: proc(name: string, clip: int, silenced, automatic: bool, per_shot: int, spread: f64, id: string) -> Gun {
	g := Gun{name = name, damage = 100, loudness = silenced ? 2 : 8, clip_size = clip, ammo = clip,
		silenced = silenced, automatic = automatic, bullets_per_shot = per_shot, spread = spread, id = id}
	if def, ok := gun_defs[id]; ok {
		g.damage = def.damage
		g.loudness = def.loudness
	}
	return g
}

guns_init :: proc() {
	gun_shotgun = make_gun("Shotgun", 6, false, false, 8, 30, "shotgun")
	gun_shotgun_sawed_off = make_gun("Sawed-Off Shotty", 6, false, false, 8, 90, "shotgun_sawed_off")
	gun_pistol = make_gun("Handgun", 8, false, false, 1, 0, "pistol")
	gun_pistol_silenced = make_gun("Silenced Handgun", 8, true, false, 1, 0, "pistol_silenced")
	gun_machine = make_gun("Machine Gun", 600, false, true, 1, 3, "machine_gun")
	all_gun_prefabs_without_sawed = {&gun_shotgun, &gun_pistol, &gun_pistol_silenced, &gun_machine}
}

gun_copy :: proc(g: ^Gun) -> ^Gun {
	c := new(Gun)
	c^ = g^
	c.ammo = g.clip_size
	return c
}

gun_reload :: proc(g: ^Gun, unit: ^Sprite) {
	unit.reloading = true
	reload_speed := 2000.0
	if unit.reload_speed != 0 do reload_speed = unit.reload_speed
	prog_reset(hero.x, hero.y, reload_speed, .Reload, g, unit)
	prog_bar.follow = hero
}

gun_shoot :: proc(g: ^Gun, unit: ^Sprite) {
	for _ in 0 ..< g.bullets_per_shot {
		bullet := new_sprite_obj(.Bullet, new_sprite(img_bullet), nil)
		bullet.ignore = unit
		bullet.x = unit.x
		bullet.y = unit.y
		rand_rot := random_int_from_interval(-g.spread / 2, g.spread / 2)
		end := rotate_point_about_axis({unit.x, unit.y}, rand_rot, unit.aim_end)
		adx := end.x - unit.x
		ady := end.y - unit.y
		alen := math.sqrt(adx * adx + ady * ady)
		if alen > 0 {
			BULLET_REACH :: 5000.0
			end = {unit.x + adx / alen * BULLET_REACH, unit.y + ady / alen * BULLET_REACH}
		}
		sx, sy := physics_sight_stop(unit.x, unit.y, end.x, end.y)
		bullet.target = new_point(sx, sy)
		sprite_rotate_to_instant(bullet, sx, sy)
		if g.automatic do bullet.speed = random_int_from_interval(30, 80)
		else do bullet.speed = 75
		bullet.stop_distance = bullet.speed
		append(&bullets, bullet)
		sprite_rotate_to_instant(unit, sx, sy)
	}
}

// ---------------------------------------------------------------- sprites

Sprite_Kind :: enum u8 { Basic, Hero, Guard, Camera, Door, Bullet }

// `target_rotate`: either a live sprite (hero, a guard, the drag target) or a waypoint.
Rot_Target :: struct {
	sprite: ^Sprite,
	point:  ^Path_Point,
}

rot_none :: Rot_Target{}
rot_sprite :: proc(s: ^Sprite) -> Rot_Target { return {sprite = s} }
rot_point :: proc(p: ^Path_Point) -> Rot_Target { return {point = p} }
rot_set :: proc(r: Rot_Target) -> bool { return r.sprite != nil || r.point != nil }

Sprite :: struct {
	kind:          Sprite_Kind,
	reg_index:     int,
	x, y, rad:     f64,
	target:        ^Path_Point,
	speed:         f64,
	moving, alive: bool,
	radius:        f64,
	health:        int,
	gun:           ^Gun,
	reloading:     bool,
	aim_start:     Point,
	aim_end:       Point,
	can_shoot:     bool,
	shoot_speed:   f64,
	reacting:      bool,
	sprite:        ^Node,
	target_rotate: Rot_Target,
	stop_distance: f64,
	blind_until:   f64,
	reload_speed:  f64,

	// guard
	path:                       Path,
	alarmed_pre, alarmed:       bool,
	being_choked_out:           bool,
	dodge_until, stunned_until: f64,
	blood_trail:                bool,
	blood_trail_size:           f64,
	blood_trail_skip_frequency: f64,
	chasing_hero:               bool,
	idling, started_idling:     bool,
	saw_hero_last_at:           Point,
	accuracy:                   f64,
	knows_heros_face:           bool,
	currently_sees_hero:        bool,
	has_riot_shield:            bool,
	reaction_time_millis:       f64,
	patrol_retry_at:            f64,
	patrol_fail_streak:         int,
	stuck_since:                f64,
	stuck_from_x, stuck_from_y: f64,
	assigned_entry:             int, // -1 = null
	patrol_route_index:         int,
	patrol_leg:                 int,
	feet_clip, sprite_body:     ^Node,
	blind_fx:                   ^Node,
	blind_fx_angle:             f64,
	// squad blackboard WeakMaps
	converge_at:                f64,
	has_converge_at:            bool,
	approach_goal:              int,
	has_approach_goal:          bool,

	// hero
	speed_walk, speed_sprint:   f64,
	masked, gun_out:            bool,
	in_off_limits, lockpicking: bool,
	planting_bomb, in_car:      bool,
	carry:                      ^Sprite,
	spyglass_distance:          f64,
	spyglass_equipped:          bool,
	ability_kick_doors:         bool,
	ability_auto_pickup_ammo:   bool,
	ability_remote_lockpick:    bool,
	ability_timed_bomb:         bool,
	ability_remote_bomb:        bool,
	ability_body_armor:         bool,
	lockpick_speed:             f64,
	ability_toggle_mask_speed:  f64,
	ability_choke_speed:        f64,
	van_suspicious_until:       f64,
	sprite_spyglass:            ^Node,
	sprite_head:                ^Node,
	sprite_animate:             bool,
	sin_, sin_body:             f64,
	last_seen_x, last_seen_y:   f64,

	// security camera
	losx, losy:       f64,
	hacked:           bool,
	swivel_max:       f64,
	swivel_min:       f64,
	wait_time:        f64,
	cam_rotation:     f64,
	increasing:       bool,
	wait_remaining:   f64,

	// door
	unlocked:     bool,
	door_cell:    ^Cell,
	opened:       bool,
	opener_near:  bool,
	broken:       bool,
	horizontal:   bool,
	rot_closed:   f64,
	rot_open:     f64,

	// bullet
	ignore:    ^Sprite,
	glass_hit: [dynamic]int,
}

all_sprites: [dynamic]^Sprite

// jo_sprite(pixiSprite, parent): the base constructor.
new_sprite_obj :: proc(kind: Sprite_Kind, node: ^Node, parent: ^Node) -> ^Sprite {
	s := new(Sprite)
	s.kind = kind
	s.target = null_point()
	s.speed = 1.5
	s.moving = true
	s.alive = true
	s.radius = 19
	s.health = 3
	if kind != .Bullet {
		s.gun = gun_copy(all_gun_prefabs_without_sawed[int(math.floor(random() * 4))])
	}
	s.shoot_speed = 700
	s.stop_distance = 1.5
	s.assigned_entry = -1
	s.patrol_route_index = -1
	s.sprite = node
	if node.kind != .Container {
		node.anchor = {0.5, 0.5}
	}
	add_child(parent != nil ? parent : display_actors, node)
	s.reg_index = len(all_sprites)
	append(&all_sprites, s)
	return s
}

unregister_sprite :: proc(s: ^Sprite) {
	i := s.reg_index
	if i < 0 || i >= len(all_sprites) || all_sprites[i] != s do return
	last := all_sprites[len(all_sprites) - 1]
	all_sprites[i] = last
	last.reg_index = i
	pop(&all_sprites)
	s.reg_index = -1
}

free_bullet :: proc(b: ^Sprite) {
	unregister_sprite(b)
	delete(b.glass_hit)
	free_node(b.sprite)
	free(b)
}

set_path :: proc(s: ^Sprite, p: Path) {
	delete(s.path)
	s.path = p
}

clear_path :: proc(s: ^Sprite) {
	delete(s.path)
	s.path = nil
}

path_shift :: proc(s: ^Sprite) -> ^Path_Point {
	p := s.path[0]
	ordered_remove(&s.path, 0)
	return p
}

sprite_kill_base :: proc(s: ^Sprite) {
	s.alive = false
	s.target = null_point()
}

sprite_kill :: proc(s: ^Sprite, from_x: f64 = 0, from_y: f64 = 0) {
	switch s.kind {
	case .Guard:  guard_kill(s)
	case .Hero:   hero_kill(s, from_x, from_y)
	case .Camera: camera_kill(s)
	case .Basic, .Door, .Bullet: sprite_kill_base(s)
	}
}

// The legacy step-rotation used by move_to_target / rotate_to.
step_rotate :: #force_inline proc(s: ^Sprite, new_rad: f64) {
	diff := new_rad - s.rad
	if abs(diff) <= 0.1 do s.rad = new_rad
	else if diff > math.PI do s.rad -= 0.1
	else if diff < -math.PI do s.rad += 0.1
	else if diff < 0 do s.rad -= 0.1
	else if diff > 0 do s.rad += 0.1
	s.rad = norm_rad(s.rad)
}

sprite_move_to_target :: proc(s: ^Sprite) -> bool {
	if s.target == nil || s.target.null do return false
	c := s.speed
	A := s.target.x - s.x
	B := s.target.y - s.y
	C := math.sqrt(A * A + B * B)
	has_body := physics_has_actor(s)
	if C < s.stop_distance {
		if has_body do physics_stop(s)
		return true
	}
	a := c * A / C
	b := c * B / C
	if has_body {
		if s.moving do physics_steer_towards(s, s.target.x, s.target.y, s.speed, s.stop_distance)
		else do physics_stop(s)
	} else if s.moving {
		s.x += a
		s.y += b
	}
	if !rot_set(s.target_rotate) {
		step_rotate(s, math.atan2(b, a))
	} else {
		rx, ry, ok := rot_target_xy(s.target_rotate)
		if ok do sprite_rotate_to(s, rx, ry)
	}
	return false
}

rot_target_xy :: proc(r: Rot_Target) -> (f64, f64, bool) {
	if r.sprite != nil do return r.sprite.x, r.sprite.y, true
	if r.point != nil && !r.point.null do return r.point.x, r.point.y, true
	return 0, 0, false
}

sprite_rotate_to :: proc(s: ^Sprite, x, y: f64) {
	c := s.speed
	A := x - s.x
	B := y - s.y
	C := math.sqrt(A * A + B * B)
	a := c * A / C
	b := c * B / C
	step_rotate(s, math.atan2(b, a))
}

sprite_rotate_to_instant :: proc(s: ^Sprite, x, y: f64) -> bool {
	c := s.speed
	A := x - s.x
	B := y - s.y
	C := math.sqrt(A * A + B * B)
	if c > C do return true
	a := c * A / C
	b := c * B / C
	s.rad = norm_rad(math.atan2(b, a))
	return false
}

sprite_get_dragged_base :: proc(s: ^Sprite) -> bool {
	if s.target == nil || s.target.null do return false
	c := s.speed
	A := s.target.x - s.x
	B := s.target.y - s.y
	C := math.sqrt(A * A + B * B)
	if C < s.stop_distance do return true
	a := c * A / C
	b := c * B / C
	s.x += a
	s.y += b
	new_rad := norm_rad(math.atan2(b, a) + math.PI)
	step_rotate(s, new_rad)
	return false
}

sprite_get_dragged :: proc(s: ^Sprite) {
	if s.kind == .Guard {
		if s.being_choked_out && s.alive do s.sprite_body.tex = img_guard_choke
		else do s.sprite_body.tex = img_guard_drag
	}
	sprite_get_dragged_base(s)
}

sprite_stop_dragging :: proc(s: ^Sprite) {
	if s.kind == .Guard && !s.alive do s.sprite_body.tex = img_guard_dead
}

sprite_sees_point :: proc(s: ^Sprite, ox, oy: f64) -> bool {
	if s.blind_until != 0 && clock_now() < s.blind_until do return false
	ang := angle_between_relative(s, ox, oy)
	if ang <= 1.22 && ang >= -1.22 {
		return physics_can_see(s.x, s.y, ox, oy)
	}
	return false
}

sprite_sees :: proc(s, other: ^Sprite) -> bool { return sprite_sees_point(s, other.x, other.y) }

angle_between_relative :: proc(s: ^Sprite, ox, oy: f64) -> f64 {
	result := s.sprite.rotation - math.atan2(oy - s.y, ox - s.x)
	if result > math.PI do result -= math.PI * 2
	if result < -math.PI do result += math.PI * 2
	return result
}

sprite_prepare_for_draw :: proc(s: ^Sprite) {
	s.sprite.x = s.x
	s.sprite.y = s.y
	s.sprite.rotation = s.rad
	if s.kind == .Hero && s.sprite_animate {
		if s.gun_out do s.sin_body = 0
		else do s.sin_body -= 0.12
		s.sin_ += 0.1
		s.sprite_head.x = 2 * math.sin(s.sin_)
		s.sprite_body.rotation = math.sin(s.sin_body) / 4
		s.sprite_spyglass.rotation = math.sin(s.sin_body) / 4
	}
}

// ---------------------------------------------------------------- movie clips

feet_frames: []^Texture
alert_frames: []^Texture

make_clip_frames :: proc(prefix: string, n: int) -> []^Texture {
	out := make([]^Texture, n)
	for i in 0 ..< n {
		out[i] = image_tex(fmt.tprintf("movie_clips/%s%d.png", prefix, i))
	}
	return out
}

make_clip :: proc(frames: []^Texture) -> ^Node {
	n := new_movie_clip(frames)
	append(&all_clips, n)
	return n
}

// ---------------------------------------------------------------- hero

new_hero :: proc(body_tex: ^Texture, speed_walk, speed_sprint: f64) -> ^Sprite {
	container := new_container()
	s := new_sprite_obj(.Hero, container, nil)
	s.speed_walk = speed_walk
	s.speed_sprint = speed_sprint
	s.radius = 14
	s.spyglass_distance = 64
	s.gun = gun_copy(&gun_pistol_silenced)
	s.health = 1
	s.lockpick_speed = 5000
	s.reload_speed = 2000
	s.ability_toggle_mask_speed = 500
	s.ability_choke_speed = 4000
	s.ability_timed_bomb = true
	s.last_seen_x = math.nan_f64()
	s.last_seen_y = math.nan_f64()

	s.feet_clip = make_clip(feet_frames)
	s.feet_clip.anchor = {0.5, 0.5}
	s.feet_clip.clip.loop = true
	s.feet_clip.clip.animation_speed = 0.15
	add_child(container, s.feet_clip)

	s.sprite_spyglass = new_sprite(img_spyglass)
	s.sprite_spyglass.anchor = {0, 0}
	s.sprite_spyglass.y = 10
	add_child(container, s.sprite_spyglass)

	s.sprite_body = new_sprite(body_tex)
	s.sprite_body.anchor = {0.5, 0.5}
	add_child(container, s.sprite_body)

	s.sprite_head = new_sprite(img_hero_head)
	s.sprite_head.anchor = {0.5, 0.5}
	add_child(container, s.sprite_head)
	return s
}

hero_will_cause_alert :: proc(h: ^Sprite) -> bool {
	return h.masked || h.gun_out || h.in_off_limits || h.lockpicking || h.planting_bomb || h.carry != nil ||
		hero_drag_target != nil || clock_now() < h.van_suspicious_until
}

hero_mark_van_suspicious :: proc(h: ^Sprite, duration_ms: f64) {
	until := clock_now() + duration_ms
	if until > h.van_suspicious_until do h.van_suspicious_until = until
}

hero_img_mask_on :: proc(h: ^Sprite, put_on: bool) {
	h.sprite_head.tex = put_on ? img_hero_head_masked : img_hero_head
}

// setLastSeen(observer): a guard's sighting is relayed after 2 s if it is still up.
hero_set_last_seen :: proc(h: ^Sprite, observer: ^Sprite) {
	if observer != nil {
		clock_after(2000, proc(data: rawptr, arg: int) {
			observer := cast(^Sprite)data
			h := hero
			if observer.alive && !observer.being_choked_out {
				if h.last_seen_x != observer.saw_hero_last_at.x && h.last_seen_y != observer.saw_hero_last_at.y {
					h.last_seen_x = observer.saw_hero_last_at.x
					h.last_seen_y = observer.saw_hero_last_at.y
					hero_last_seen.x = observer.saw_hero_last_at.x
					hero_last_seen.y = observer.saw_hero_last_at.y
					notify_guards_of_hero_location = true
				}
			}
		}, observer)
	} else {
		if h.last_seen_x != h.x && h.last_seen_y != h.y {
			h.last_seen_x = h.x
			h.last_seen_y = h.y
			hero_last_seen.x = h.x
			hero_last_seen.y = h.y
			notify_guards_of_hero_location = true
		}
	}
}

hero_hurt :: proc(h: ^Sprite, from_x, from_y: f64) {
	if h.ability_body_armor {
		if random_float_from_interval(0, 1) >= .5 {
			new_floating_message("Close Call!", hero.x, hero.y, 0xFFaa00)
			return
		}
	}
	h.health -= 1
	if h.health <= 0 do hero_kill(h, from_x, from_y)
}

hero_kill :: proc(h: ^Sprite, from_x, from_y: f64) {
	hero_is_dead()
	h.alive = false
	h.moving = false
	physics_remove_actor(h)
	clear_path(h)
	h.target = null_point()
	h.sprite_body.tex = img_hero_dead
	remove_child(h.sprite, h.sprite_head)
	set_text(message_game_over, "Press [Esc] to restart!")
	remove_handlers(true)
	store_inc("loses")
	splatter_angle := angle_between_points(from_x, from_y, hero.x, hero.y)
	blood_particle_splatter(splatter_angle, hero.x, hero.y)
}

hero_get_spyglass_pos :: proc(h: ^Sprite) -> Point {
	c := h.spyglass_distance
	A := mouse.x - h.x
	B := mouse.y - h.y
	C := math.sqrt(A * A + B * B)
	a := c * A / C
	b := c * B / C
	return {hero.x + a, hero.y + b}
}

// ---------------------------------------------------------------- guard

new_guard :: proc(body_tex: ^Texture, has_riot_shield: bool) -> ^Sprite {
	container := new_container()
	s := new_sprite_obj(.Guard, container, display_guards)
	s.blood_trail_size = 10
	s.blood_trail_skip_frequency = 1.5
	s.accuracy = 50
	s.has_riot_shield = has_riot_shield
	s.reaction_time_millis = 500
	s.saw_hero_last_at = {math.nan_f64(), math.nan_f64()}

	s.feet_clip = make_clip(feet_frames)
	s.feet_clip.anchor = {0.5, 0.5}
	s.feet_clip.clip.loop = true
	s.feet_clip.clip.animation_speed = 0.1
	clip_goto_and_play(s.feet_clip, 0)
	add_child(container, s.feet_clip)

	s.sprite_body = new_sprite(body_tex)
	s.sprite_body.anchor = {0.5, 0.5}
	add_child(container, s.sprite_body)
	return s
}

STUCK_GRACE_MS :: 1500.0
STUCK_EPSILON_PX :: 4.0

guard_check_stuck :: proc(g: ^Sprite) -> bool {
	if !g.moving || len(g.path) == 0 && g.target.null {
		g.stuck_since = 0
		return false
	}
	moved := get_distance(g.x, g.y, g.stuck_from_x, g.stuck_from_y)
	now := clock_now()
	if moved > STUCK_EPSILON_PX || g.stuck_since == 0 {
		g.stuck_from_x = g.x
		g.stuck_from_y = g.y
		g.stuck_since = now
		return false
	}
	if now - g.stuck_since < STUCK_GRACE_MS do return false
	g.stuck_since = 0
	return true
}

guard_kill :: proc(g: ^Sprite) {
	g.sprite_body.tex = img_guard_dead
	g.alive = false
	physics_remove_actor(g)
	g.moving = true
	clear_path(g)
	g.target = null_point()
	nav_cancel_request(g)
	squad_report_death(g, clock_now())
	squad_remove_guard(g)
	append(&alarming_objects, g)
	remove_child(g.sprite, g.feet_clip)
	drop_gun(g.gun, g.x, g.y)
	g.sprite.visible = true
}

PATROL_MIN_INTERVAL_MS :: 250.0
PATROL_BACKOFF_BASE_MS :: 250.0
PATROL_BACKOFF_MAX_MS :: 3000.0

guard_get_random_patrol_path :: proc(g: ^Sprite) {
	if squad_patrol_path_for(g) do return
	now := clock_now()
	if now < g.patrol_retry_at do return
	if nav_has_pending_request(g) do return
	if g.moving {
		dest, ok := nav_random_destination_near({g.x, g.y})
		if !ok {
			g.patrol_retry_at = now + PATROL_BACKOFF_MAX_MS
			return
		}
		nav_request_path({owner = g, from = {g.x, g.y}, to = dest, radius = g.radius, priority = .Patrol, callback = .Patrol})
		g.patrol_retry_at = now + PATROL_MIN_INTERVAL_MS
	} else {
		g.patrol_retry_at = now + PATROL_MIN_INTERVAL_MS
	}
	g.idling = false
	g.started_idling = false
}

// nav scheduler callbacks
path_ready :: proc(req: Path_Request, path: Path) {
	g := req.owner
	switch req.callback {
	case .Patrol:
		set_path(g, path)
		g.patrol_fail_streak = 0
		g.patrol_retry_at = clock_now() + PATROL_MIN_INTERVAL_MS
	case .Squad_Set_If_Any:
		if len(path) > 0 do set_path(g, path)
		else do delete(path)
	case .None:
		delete(path)
	}
}

path_failed :: proc(req: Path_Request) {
	if req.callback != .Patrol do return
	g := req.owner
	g.patrol_fail_streak += 1
	backoff := PATROL_BACKOFF_BASE_MS * math.pow(2, f64(g.patrol_fail_streak - 1))
	if backoff > PATROL_BACKOFF_MAX_MS do backoff = PATROL_BACKOFF_MAX_MS
	g.patrol_retry_at = clock_now() + backoff + random() * PATROL_BACKOFF_BASE_MS
}

guard_see_alarming_object :: proc(g: ^Sprite) {
	if !g.alarmed_pre && !g.alarmed {
		g.alarmed_pre = true
		clock_after(g.reaction_time_millis, proc(data: rawptr, arg: int) {
			g := cast(^Sprite)data
			guard_become_alarmed(g)
			clear_path(g)
			g.moving = false
			clock_after(2000, proc(data: rawptr, arg: int) {
				g := cast(^Sprite)data
				if g.alive && !g.being_choked_out {
					new_message("All the other guards are on alert!")
					alert_all_guards()
				}
			}, g)
		}, g)
	}
}

guard_become_alarmed :: proc(g: ^Sprite) {
	if g.alive {
		if g.knows_heros_face do g.sprite_body.tex = g.has_riot_shield ? img_guard_riot_knows_face : img_guard_knows_hero_face
		else do g.sprite_body.tex = g.has_riot_shield ? img_guard_riot_alert : img_guard_alert
		g.speed = 3
		g.alarmed = true
	}
}

// ---------------------------------------------------------------- security camera

new_security_camera :: proc(x, y, max_swivel, min_swivel: f64) -> ^Sprite {
	s := new_sprite_obj(.Camera, new_sprite(img_security_camera), nil)
	s.x = x
	s.y = y
	corner := camera_find_corner(s)
	ox, oy := camera_find_offset(corner)
	s.losx = s.x + 40 * ox
	s.losy = s.y + 40 * oy
	s.x += 4 * ox
	s.y += 4 * oy
	s.radius = 14
	s.sprite.anchor.x = 0.35
	s.swivel_max = max_swivel
	s.swivel_min = min_swivel
	s.wait_time = 2000
	s.speed = 0.01
	s.cam_rotation = s.swivel_min
	s.increasing = true
	s.wait_remaining = s.wait_time
	s.rad = s.swivel_min
	return s
}

camera_swivel :: proc(s: ^Sprite, dt: f64) {
	if s.wait_remaining > 0 {
		s.wait_remaining -= dt
		return
	}
	if s.increasing {
		s.cam_rotation += s.speed
		if s.cam_rotation > 2 * math.PI do s.cam_rotation = 0
		if abs(s.cam_rotation - s.swivel_max) <= 0.05 {
			s.wait_remaining = s.wait_time
			s.increasing = false
		}
	} else {
		s.cam_rotation -= s.speed
		if s.cam_rotation < 0 do s.cam_rotation = 2 * math.PI
		if abs(s.cam_rotation - s.swivel_min) <= 0.05 {
			s.wait_remaining = s.wait_time
			s.increasing = true
		}
	}
	s.rad = s.cam_rotation
}

camera_kill :: proc(s: ^Sprite) {
	s.sprite.tex = img_cam_broken
	s.alive = false
	s.target = null_point()
	append(&alarming_objects, s)
}

camera_see_alarming_object :: proc(s: ^Sprite, ox, oy: f64) {
	if !s.alarmed {
		s.alarmed = true
		s.sprite.tex = img_security_camera_alerted
		s.target = new_point(ox, oy)
		clock_after(2000, proc(data: rawptr, arg: int) {
			s := cast(^Sprite)data
			if s.alive {
				new_message("All the other guards are on alert!")
				alert_all_guards()
			}
		}, s)
	}
}

// A corner of -1 (no wall) leaves the JS offset undefined, so x/y become NaN.
camera_find_offset :: proc(corner: int) -> (f64, f64) {
	switch corner {
	case 0: return 1, 1
	case 1: return -1, 1
	case 2: return 1, -1
	case 3: return -1, -1
	}
	return math.nan_f64(), math.nan_f64()
}

camera_find_corner :: proc(s: ^Sprite) -> int {
	cell_at :: proc(x, y: f64) -> ^Cell {
		ix, iy := grid_index_2d(x, y)
		return grid_cell_at(ix, iy)
	}
	corners := [4]^Cell{cell_at(s.x - 1, s.y - 1), cell_at(s.x + 1, s.y - 1), cell_at(s.x - 1, s.y + 1), cell_at(s.x + 1, s.y + 1)}
	corner := -1
	for c, i in corners {
		if c != nil && c.blocks_vision {
			if !c.door do corner = i
		}
	}
	return corner
}

// ---------------------------------------------------------------- door

new_door :: proc(horizontal: bool, cell: ^Cell) -> ^Sprite {
	s := new_sprite_obj(.Door, new_sprite(img_door_closed), display_actors)
	s.sprite.anchor = {0.125, 0}
	s.door_cell = cell
	s.horizontal = horizontal
	if !horizontal {
		s.x += 32
		s.rot_closed = 0
		s.rot_open = 90 * math.PI / 180
	} else {
		s.x += 64
		s.y += 32
		s.rot_closed = 90 * math.PI / 180
		s.rot_open = 0
	}
	s.rad = s.rot_closed
	return s
}

door_open :: proc(s: ^Sprite) {
	if s.broken do return
	if !s.opened {
		s.opened = true
		if get_distance(hero.x, hero.y, s.x, s.y) < 120 do play_sound(.Door_Open)
		s.rad = s.rot_open
		cell_open_door(s.door_cell)
		s.sprite.tex = img_door_open
	}
}

door_close :: proc(s: ^Sprite) {
	if s.broken do return
	if s.opened {
		if get_distance(hero.x, hero.y, s.x, s.y) < 120 do play_sound(.Door_Close)
		s.opened = false
		s.rad = s.rot_closed
		cell_close_door(s.door_cell)
	}
	if !s.unlocked do s.sprite.tex = img_door_closed
}

door_unlock :: proc(s: ^Sprite) {
	hero.lockpicking = false
	if s.broken do return
	s.unlocked = true
	s.sprite.tex = img_door_open
}

// ---------------------------------------------------------------- gun drops / doodads

Gun_Drop :: struct {
	x, y, rad:        f64,
	gun:              ^Gun,
	sprite:           ^Node,
	parent:           ^Node,
	flag_for_removal: bool,
}

new_gun_drop :: proc(node, parent: ^Node, x, y: f64, gun: ^Gun) -> ^Gun_Drop {
	d := new(Gun_Drop)
	d.x = x
	d.y = y
	d.gun = gun
	d.rad = math.PI * 2 * random()
	d.sprite = node
	node.anchor = {0.5, 0.5}
	node.scale = {0.5, 0.5}
	d.parent = parent != nil ? parent : display_actors
	add_child(d.parent, node)
	return d
}

Doodad :: struct {
	x, y, rad: f64,
	sprite:    ^Node,
	parent:    ^Node,
}

new_doodad :: proc(node, parent: ^Node, x, y: f64) {
	d := new(Doodad)
	d.x = x + 32
	d.y = y + 32
	d.rad = math.PI * 2 * random()
	d.sprite = node
	node.anchor = {0.5, 0.5}
	d.parent = parent != nil ? parent : display_actors
	add_child(d.parent, node)
	append(&doodads, d)
}

prepare_simple :: #force_inline proc(n: ^Node, x, y, rad: f64) {
	n.x = x
	n.y = y
	n.rotation = rad
}
