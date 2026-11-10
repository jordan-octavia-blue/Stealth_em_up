package game

// systems/car.ts (the getaway van) and systems/melee.ts (sprint knockback).

import "core:math"
import "core:fmt"

CAR_LENGTH_PX :: 108.0
CAR_WIDTH_PX :: 58.0
CAR_ART_OFFSET :: math.PI / 2
WHEEL_LENGTH_PX :: 18.0
WHEEL_WIDTH_PX :: 7.0
AXLE_Y_PX :: CAR_WIDTH_PX / 2 - 6
ENTER_DISTANCE_PX :: 96.0
RUN_OVER_SPEED_PX :: 120.0
KNOCKBACK_SPEED_PX :: 420.0
KNOCKBACK_MS :: 300.0
BREACH_SPEED_PX :: 100.0
BREACH_DAMAGE_PER_SPEED :: 0.05
BREACH_DAMAGE_MAX :: 20.0
CAR_MAX_HEALTH :: 12
DRIVER_HIT_CHANCE :: 0.04
DODGE_MS :: 500.0
DODGE_CONE_DOT :: 0.5
DODGE_TIME_TO_IMPACT_S :: 1.2
DODGE_RANGE_PX :: 240.0
DODGE_DISTANCE_PX :: 60.0
DODGE_MIN_SPEED_PX :: 80.0
NOISE_INTERVAL_MS :: 700.0
NOISE_MIN_SPEED_PX :: 60.0
VAN_SUSPICION_MS :: 2500.0
CAR_ZOOM_OUT :: 1 / 1.3
CAR_LOOKAHEAD_S :: 0.5
CAR_CAM_SMOOTH :: 0.12

Knockback :: struct {
	sprite: ^Sprite,
	vx, vy: f64,
	ttl:    f64,
}

car: struct {
	van:           ^Sprite,
	active:        bool, // someone is driving
	driver:        int,  // player index of the driver while active
	last_noise_at: f64,
	health:        int,
	outline:       ^Node,
	front_wheels:  [2]^Node,
	cam_lead:      Point,
	knockbacks:    [dynamic]Knockback,
}

car_axle_x_px :: proc() -> f64 { return DEFAULT_CAR_TUNING.wheelbase * PPM / 2 }
car_max_speed_px :: proc() -> f64 { return DEFAULT_CAR_TUNING.max_speed * PPM }

car_init :: proc(owner: ^Sprite, angle: f64) {
	car.van = owner
	car.active = false
	car.health = CAR_MAX_HEALTH
	owner.sprite.visible = false
	physics_add_car(owner, CAR_LENGTH_PX, CAR_WIDTH_PX, angle)
	owner.rad = angle + CAR_ART_OFFSET
	car_build_outline()
	car_sync_outline(owner.x, owner.y, angle, 0)
	car.cam_lead = {owner.x, owner.y}
}

car_build_outline :: proc() {
	if car.outline != nil do remove_from_parent(car.outline)
	g := new_graphics()
	hl := CAR_LENGTH_PX / 2
	hw := CAR_WIDTH_PX / 2
	axle_x := car_axle_x_px()
	g_line_style(g, 2, 0xff5252, 0.95)
	g_draw_rect(g, -hl, -hw, CAR_LENGTH_PX, CAR_WIDTH_PX)
	g_move_to(g, 0, 0)
	g_line_to(g, hl + 10, 0)
	g_line_style(g, 2, 0xbbbbbb, 0.9)
	for side in ([2]f64{-1, 1}) {
		g_draw_rect(g, -axle_x - WHEEL_LENGTH_PX / 2, side * AXLE_Y_PX - WHEEL_WIDTH_PX / 2, WHEEL_LENGTH_PX, WHEEL_WIDTH_PX)
	}
	for side, i in ([2]f64{-1, 1}) {
		w := new_graphics()
		g_line_style(w, 2, 0xffee58, 0.95)
		g_draw_rect(w, -WHEEL_LENGTH_PX / 2, -WHEEL_WIDTH_PX / 2, WHEEL_LENGTH_PX, WHEEL_WIDTH_PX)
		w.x = axle_x
		w.y = side * AXLE_Y_PX
		add_child(g, w)
		car.front_wheels[i] = w
	}
	add_child(display_actors, g)
	car.outline = g
}

car_sync_outline :: proc(x, y, angle, steer: f64) {
	if car.outline == nil do return
	car.outline.x = x
	car.outline.y = y
	car.outline.rotation = angle
	for w in car.front_wheels do w.rotation = steer
}

car_reset :: proc() {
	engine_stop()
	car.outline = nil
	car.front_wheels = {}
	car.van = nil
	car.active = false
	car.health = CAR_MAX_HEALTH
	car.last_noise_at = math.inf_f64(-1)
	clear(&car.knockbacks)
}

car_is_active :: proc() -> bool { return car.active }

// Runs fn with the driver's state bound (no-op binding when nobody drives).
with_car_driver :: proc(fn: proc()) {
	if !car.active {
		fn()
		return
	}
	prev := player_switch(car.driver)
	fn()
	player_switch(prev)
}

// The van wins the heist if any robber inside it carries the loot.
car_carries_loot :: proc() -> bool {
	for p in players do if p.active && p.hero != nil && p.hero.in_car && p.hero.carry != nil do return true
	return false
}

// E for the bound robber: driver gets out; a passenger gets out; outside, take the wheel
// if it is free, otherwise ride along.
car_toggle :: proc() {
	if car.van == nil do return
	if hero.in_car {
		if car.active && car.driver == bound_player do car_exit()
		else do car_passenger_exit()
	} else {
		if !hero.alive do return
		if get_distance(hero.x, hero.y, car.van.x, car.van.y) <= ENTER_DISTANCE_PX {
			if car.active do car_passenger_enter()
			else do car_enter()
		} else {
			new_floating_message("Get closer to the van", hero.x, hero.y, 0xFFaa00)
		}
	}
}

car_passenger_enter :: proc() {
	hero.in_car = true
	hero.gun_out = false
	set_hero_image()
	physics_remove_actor(hero)
	hero.sprite.visible = false
	hero.x = car.van.x
	hero.y = car.van.y
	new_message("Riding along in the van. (E to get out)")
}

car_passenger_exit :: proc() {
	spot, found := car_exit_spot()
	if !found {
		new_floating_message("No room to get out!", car.van.x, car.van.y, 0xFFaa00)
		return
	}
	hero.in_car = false
	hero.x = spot.x
	hero.y = spot.y
	physics_add_hero(hero, hero.radius)
	physics_teleport(hero, spot.x, spot.y)
	hero.sprite.visible = true
	hero.moving = true
}

car_enter :: proc() {
	car.active = true
	car.driver = bound_player
	hero.in_car = true
	hero.gun_out = false
	set_hero_image()
	physics_remove_actor(hero)
	hero.sprite.visible = false
	hero.x = car.van.x
	hero.y = car.van.y
	engine_start()
	new_message(hero.carry != nil ? "You're in the van with the loot — drive to the escape zone!" : "You're in the van! (E to get out)")
}

car_exit_spot :: proc() -> (Point, bool) {
	st, ok := physics_get_car_state(car.van)
	angle := ok ? st.angle : car.van.rad - CAR_ART_OFFSET
	fx := math.cos(angle)
	fy := math.sin(angle)
	px := -fy
	py := fx
	side := CAR_WIDTH_PX / 2 + hero.radius + 6
	ends := CAR_LENGTH_PX / 2 + hero.radius + 6
	v := car.van
	spots := [4]Point{
		{v.x + px * side, v.y + py * side},
		{v.x - px * side, v.y - py * side},
		{v.x - fx * ends, v.y - fy * ends},
		{v.x + fx * ends, v.y + fy * ends},
	}
	for s in spots {
		if physics_spot_clear_for_actor(s.x, s.y, hero.radius) do return s, true
	}
	return {}, false
}

car_exit :: proc() {
	v := car.van
	spot, found := car_exit_spot()
	if !found {
		new_floating_message("No room to get out!", v.x, v.y, 0xFFaa00)
		return
	}
	car.active = false
	hero.in_car = false
	engine_stop()
	hero.x = spot.x
	hero.y = spot.y
	physics_add_hero(hero, hero.radius)
	physics_teleport(hero, spot.x, spot.y)
	hero.sprite.visible = true
	hero.moving = true
	new_message("Out of the van.")
}

car_hit_by_bullet :: proc(from_x, from_y: f64) {
	if !car.active || car.van == nil do return
	prev := player_switch(car.driver)
	defer player_switch(prev)
	if !hero.alive do return
	if random() < DRIVER_HIT_CHANCE {
		car_kill_driver(from_x, from_y, "The driver is hit!")
		return
	}
	car.health -= 1
	if car.health <= 0 {
		car_kill_driver(from_x, from_y, "The van is wrecked!")
		return
	}
	new_floating_message(fmt.tprintf("Van hit! (%d)", car.health), car.van.x, car.van.y, 0xFFaa00)
}

car_kill_driver :: proc(from_x, from_y: f64, reason: string) {
	car.active = false
	hero.in_car = false
	engine_stop()
	hero.x = car.van.x
	hero.y = car.van.y
	hero.sprite.visible = true
	new_floating_message(reason, car.van.x, car.van.y, 0xcc0000)
	kill_hero(from_x, from_y)
}

car_update_pre_step :: proc() {
	if car.van == nil || !car.active do return
	physics_drive_car(car.van, {
		throttle = keys.w ? 1 : keys.s ? -1 : 0,
		steer = keys.d ? 1 : keys.a ? -1 : 0,
		handbrake = keys.space,
	})
	st, ok := physics_get_car_state(car.van)
	if !ok do return
	hero.x = st.x
	hero.y = st.y
	if st.speed >= NOISE_MIN_SPEED_PX {
		now := clock_now()
		if now - car.last_noise_at >= NOISE_INTERVAL_MS {
			car.last_noise_at = now
			hero_set_last_seen(hero, nil)
		}
	}
	car_trigger_dodges(st)
}

car_trigger_dodges :: proc(st: Car_State) {
	if st.speed < DODGE_MIN_SPEED_PX do return
	fx := st.vx / st.speed
	fy := st.vy / st.speed
	now := clock_now()
	for guard in guards {
		if !guard.alive || guard.being_choked_out do continue
		dx := guard.x - st.x
		dy := guard.y - st.y
		dist := math.sqrt(dx * dx + dy * dy)
		if dist > DODGE_RANGE_PX || dist < 1 do continue
		ahead := dx * fx + dy * fy
		if ahead <= 0 do continue
		if ahead / dist < DODGE_CONE_DOT do continue
		if ahead / st.speed > DODGE_TIME_TO_IMPACT_S do continue
		perp_x := -fy
		perp_y := fx
		side := dx * perp_x + dy * perp_y >= 0 ? 1.0 : -1.0
		guard.dodge_until = now + DODGE_MS
		guard.target = new_point(guard.x + perp_x * side * DODGE_DISTANCE_PX, guard.y + perp_y * side * DODGE_DISTANCE_PX)
		guard.moving = true
		clear_path(guard)
	}
}

car_update_post_step :: proc(dt_ms: f64) {
	if car.van == nil do return
	st, ok := physics_get_car_state(car.van)
	if ok {
		car.van.x = st.x
		car.van.y = st.y
		car.van.rad = st.angle + CAR_ART_OFFSET
		car_sync_outline(st.x, st.y, st.angle, st.steer)
		for p in players {
			if p.active && p.hero != nil && p.hero.in_car {
				p.hero.x = st.x
				p.hero.y = st.y
			}
		}
		if car.active {
			engine_update(min(st.speed / car_max_speed_px(), 1))
			car.cam_lead.x += (st.x + st.vx * CAR_LOOKAHEAD_S - car.cam_lead.x) * CAR_CAM_SMOOTH
			car.cam_lead.y += (st.y + st.vy * CAR_LOOKAHEAD_S - car.cam_lead.y) * CAR_CAM_SMOOTH
		}
	}
	// resolveCarContacts
	contacts := physics_drain_car_contacts()
	driving := ok ? st.speed : 0
	for c in contacts {
		if c.is_actor && c.owner != nil {
			if c.owner.alive && driving >= RUN_OVER_SPEED_PX do car_run_over(c.owner, st, ok)
		} else if !c.is_actor && c.cell >= 0 && c.speed >= BREACH_SPEED_PX {
			if car.active do hero_mark_van_suspicious(players[car.driver].hero, VAN_SUSPICION_MS)
			amount := min(c.speed * BREACH_DAMAGE_PER_SPEED, BREACH_DAMAGE_MAX)
			grid_damage_cell(c.cell, amount, .Car)
		}
	}
	// advanceKnockbacks
	dt := dt_ms / 1000
	for i := len(car.knockbacks) - 1; i >= 0; i -= 1 {
		k := &car.knockbacks[i]
		k.sprite.x += k.vx * dt
		k.sprite.y += k.vy * dt
		k.vx *= 0.85
		k.vy *= 0.85
		k.ttl -= dt_ms
		if k.ttl <= 0 do ordered_remove(&car.knockbacks, i)
	}
}

car_run_over :: proc(guard: ^Sprite, st: Car_State, has_st: bool) {
	dir_x := has_st && st.speed > 0 ? st.vx / st.speed : 0
	dir_y := has_st && st.speed > 0 ? st.vy / st.speed : 0
	if car.active do hero_mark_van_suspicious(players[car.driver].hero, VAN_SUSPICION_MS)
	blood_particle_splatter(math.atan2(dir_y, dir_x), guard.x, guard.y)
	guard_kill(guard)
	append(&car.knockbacks, Knockback{guard, dir_x * KNOCKBACK_SPEED_PX, dir_y * KNOCKBACK_SPEED_PX, KNOCKBACK_MS})
	new_floating_message("Splat!", guard.x, guard.y, 0xcc0000)
}

// The camera leads the van while the local robber rides in it.
car_camera_target :: proc() -> (Point, bool) {
	return car.cam_lead, car.active && hero != nil && hero.in_car
}

// ---------------------------------------------------------------- melee.ts

MELEE_KNOCKBACK_SPEED_PX_S :: 850.0
STUN_MS :: 1000.0
MIN_HERO_SPEED_PX_S :: 300.0
CONTACT_MARGIN_PX :: 6.0
KNOCKBACK_DECAY :: 0.9

is_stunned :: #force_inline proc(g: ^Sprite, now: f64) -> bool {
	return g.stunned_until != 0 && now < g.stunned_until
}

tick_stunned :: proc(g: ^Sprite) -> bool {
	if !is_stunned(g, clock_now()) do return false
	if physics_has_actor(g) do physics_scale_velocity(g, KNOCKBACK_DECAY)
	return true
}

sprint_knockback :: proc(h: ^Sprite, guards: []^Sprite, sprinting: bool) {
	if !sprinting || !h.alive do return
	if !physics_has_actor(h) do return
	hvx, hvy := physics_get_velocity(h)
	speed := math.sqrt(hvx * hvx + hvy * hvy)
	if speed < MIN_HERO_SPEED_PX_S do return
	now := clock_now()
	for g in guards {
		if !g.alive || g.being_choked_out do continue
		if is_stunned(g, now) do continue
		if !physics_has_actor(g) do continue
		dx := g.x - h.x
		dy := g.y - h.y
		dist := math.sqrt(dx * dx + dy * dy)
		if dist > h.radius + g.radius + CONTACT_MARGIN_PX do continue
		nx, ny: f64
		if dist > 0.001 {
			nx = dx / dist
			ny = dy / dist
		} else {
			nx = hvx / speed
			ny = hvy / speed
		}
		physics_set_velocity(g, nx * MELEE_KNOCKBACK_SPEED_PX_S, ny * MELEE_KNOCKBACK_SPEED_PX_S)
		g.stunned_until = now + STUN_MS
		clear_path(g)
		g.target = null_point()
	}
}
