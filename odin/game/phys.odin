package game

// src/physics/{constants,world,index,car}.ts: the game's view of the planck world.
// Pixels outside, metres inside (PPM 32); one static body for the map with a box per
// solid cell, a box + 76px trigger circle per door, a dynamic circle per actor and a
// dynamic box for the van.

import "core:math"
import ph "../physics"

PPM :: 32.0

CAT_WALL           :: u32(0x0001)
CAT_DOOR           :: u32(0x0002)
CAT_HERO           :: u32(0x0004)
CAT_GUARD          :: u32(0x0008)
CAT_CAR            :: u32(0x0010)
CAT_TRIGGER        :: u32(0x0020)
CAT_VISION_BLOCKER :: u32(0x0040)

ACTOR_MASK   :: CAT_WALL | CAT_DOOR | CAT_HERO | CAT_GUARD | CAT_CAR | CAT_TRIGGER
STATIC_MASK  :: CAT_HERO | CAT_GUARD | CAT_CAR
TRIGGER_MASK :: CAT_HERO | CAT_GUARD | CAT_CAR
VISION_MASK  :: CAT_VISION_BLOCKER
BULLET_MASK  :: CAT_VISION_BLOCKER | CAT_HERO | CAT_GUARD | CAT_CAR

PHYSICS_STEP_S      :: 1.0 / 60.0
VELOCITY_ITERATIONS :: 8
POSITION_ITERATIONS :: 3
TICKS_PER_SECOND    :: 60.0

DOOR_SENSOR_RADIUS_PX :: 76.0

Fixture_Kind :: enum int { Cell = 1, Door, Trigger, Actor, Car, Smoke }

Car_Controls :: struct {
	throttle:  f64,
	steer:     f64,
	handbrake: bool,
}

Car_Tuning :: struct {
	wheelbase, max_steer_low_speed, max_steer_high_speed, steer_rate, steer_return_rate: f64,
	acceleration, brake_deceleration, reverse_acceleration, max_speed, max_reverse_speed: f64,
	engine_brake, grip_decay, handbrake_grip_decay, linear_damping, angular_damping, density: f64,
}

DEFAULT_CAR_TUNING :: Car_Tuning {
	wheelbase            = 2.1,
	max_steer_low_speed  = 0.55,
	max_steer_high_speed = 0.14,
	steer_rate           = 3.5,
	steer_return_rate    = 7,
	acceleration         = 11,
	brake_deceleration   = 30,
	reverse_acceleration = 7,
	max_speed            = 24,
	max_reverse_speed    = 8,
	engine_brake         = 5,
	grip_decay           = 45,
	handbrake_grip_decay = 2.5,
	linear_damping       = 0.05,
	angular_damping      = 2.5,
	density              = 300,
}

IDLE_CONTROLS :: Car_Controls{}

Actor_Record :: struct {
	body:    ^ph.Body,
	fixture: ^ph.Fixture,
	radius:  f64,
}

Car_Record :: struct {
	body:    ^ph.Body,
	fixture: ^ph.Fixture,
	tuning:  Car_Tuning,
	steer:   f64,
	driven:  bool,
}

Car_State :: struct {
	x, y, angle, vx, vy, speed, steer: f64,
}

Car_Contact :: struct {
	is_actor: bool,
	owner:    ^Sprite,
	cell:     int,
	speed:    f64,
}

Ray_Hit :: struct {
	x, y:     f64,
	fraction: f64,
	category: u32,
	owner:    ^Sprite,
	cell:     int,
}

// A JS Set: insertion ordered, no duplicates.
Owner_Set :: [dynamic]^Sprite

set_add :: proc(s: ^Owner_Set, o: ^Sprite) {
	for x in s do if x == o do return
	append(s, o)
}
set_delete :: proc(s: ^Owner_Set, o: ^Sprite) {
	for x, i in s do if x == o {
		ordered_remove(s, i)
		return
	}
}

Physics :: struct {
	world:            ^ph.World,
	built:            bool,
	map_body:         ^ph.Body,
	cell_fixtures:    map[int]^ph.Fixture,
	door_fixtures:    map[int]^ph.Fixture,
	trigger_overlaps: map[int]Owner_Set,
	actors:           map[^Sprite]Actor_Record,
	actor_order:      [dynamic]^Sprite,
	cars:             map[^Sprite]Car_Record,
	car_contacts:     [dynamic]Car_Contact,
	pending_destroy:  [dynamic]^ph.Fixture,
	smoke_bodies:     map[int]^ph.Body,
	next_smoke_id:    int,
	grid_width:       int,
	cell_size:        f64,
}

physics: Physics

physics_init :: proc() {
	physics.world = ph.world_create()
	physics.world.begin_contact = proc(user: rawptr, c: ^ph.Contact) {phys_on_contact(c, true)}
	physics.world.end_contact = proc(user: rawptr, c: ^ph.Contact) {phys_on_contact(c, false)}
	physics.cell_size = 64
	physics.next_smoke_id = 1
}

V :: proc(x, y: f64) -> ph.Vec2 { return {x, y} }

physics_build :: proc() {
	physics_reset()
	physics.grid_width = grid.width
	physics.cell_size = f64(grid.cell_size)
	bd := ph.default_body_def()
	bd.type = .Static
	physics.map_body = ph.world_create_body(physics.world, bd)
	for i in 0 ..< len(grid.cells) {
		cell := grid.cells[i]
		if cell == nil do continue
		if cell.door {
			phys_create_door(i, cell.solid, cell.blocks_vision)
		} else if cell.solid {
			phys_create_cell(i, cell.blocks_vision)
		}
	}
	physics.built = true
}

physics_reset :: proc() {
	w := physics.world
	if physics.map_body != nil do ph.world_destroy_body(w, physics.map_body)
	for _, r in physics.actors do ph.world_destroy_body(w, r.body)
	for _, r in physics.cars do ph.world_destroy_body(w, r.body)
	for _, b in physics.smoke_bodies do ph.world_destroy_body(w, b)
	clear(&physics.smoke_bodies)
	physics.next_smoke_id = 1
	physics.map_body = nil
	clear(&physics.cell_fixtures)
	clear(&physics.door_fixtures)
	for _, &s in physics.trigger_overlaps do delete(s)
	clear(&physics.trigger_overlaps)
	clear(&physics.actors)
	clear(&physics.actor_order)
	clear(&physics.cars)
	clear(&physics.car_contacts)
	clear(&physics.pending_destroy)
	physics.built = false
}

physics_step :: proc(dt_ms: f64) {
	if !physics.built do return
	dt := dt_ms / 1000
	// flushDestroys
	if len(physics.pending_destroy) > 0 {
		for f in physics.pending_destroy {
			if physics.map_body != nil do ph.body_destroy_fixture(physics.map_body, f)
		}
		clear(&physics.pending_destroy)
	}
	for _, &r in physics.cars {
		if !r.driven do drive_car_body(r.body, IDLE_CONTROLS, r.tuning, &r.steer, dt)
		r.driven = false
	}
	ph.world_step(physics.world, dt, VELOCITY_ITERATIONS, POSITION_ITERATIONS)
}

physics_sync_actors :: proc() {
	if !physics.built do return
	for owner in physics.actor_order {
		r := physics.actors[owner]
		p := ph.body_get_position(r.body)
		owner.x = p.x * PPM
		owner.y = p.y * PPM
	}
}

phys_add_actor :: proc(owner: ^Sprite, radius: f64, category: u32) {
	if owner in physics.actors do return
	bd := ph.default_body_def()
	bd.type = .Dynamic
	bd.position = V(owner.x / PPM, owner.y / PPM)
	bd.fixed_rotation = true
	bd.allow_sleep = false
	body := ph.world_create_body(physics.world, bd)
	fd := ph.default_fixture_def()
	fd.density = 1
	fd.friction = 0
	fd.restitution = 0
	fd.category_bits = category
	fd.mask_bits = ACTOR_MASK
	fixture := ph.body_create_fixture(body, ph.make_circle(radius / PPM), fd)
	fixture.user = {kind = int(Fixture_Kind.Actor), cell = -1, owner = owner, set = true}
	physics.actors[owner] = {body, fixture, radius}
	append(&physics.actor_order, owner)
}

physics_add_hero :: proc(owner: ^Sprite, radius: f64) { phys_add_actor(owner, radius, CAT_HERO) }
physics_add_guard :: proc(owner: ^Sprite, radius: f64) { phys_add_actor(owner, radius, CAT_GUARD) }

physics_remove_actor :: proc(owner: ^Sprite) {
	r, ok := physics.actors[owner]
	if !ok do return
	ph.world_destroy_body(physics.world, r.body)
	delete_key(&physics.actors, owner)
	for o, i in physics.actor_order do if o == owner {
		ordered_remove(&physics.actor_order, i)
		break
	}
	for _, &s in physics.trigger_overlaps do set_delete(&s, owner)
}

physics_has_actor :: proc(owner: ^Sprite) -> bool { return owner in physics.actors }

phys_set_velocity :: proc(owner: ^Sprite, vx, vy: f64) {
	r, ok := physics.actors[owner]
	if !ok do return
	ph.body_set_linear_velocity(r.body, V(vx / PPM, vy / PPM))
}

physics_get_velocity :: proc(owner: ^Sprite) -> (f64, f64) {
	r, ok := physics.actors[owner]
	if !ok do return 0, 0
	v := r.body.linear_velocity
	return v.x * PPM, v.y * PPM
}

physics_steer_towards :: proc(owner: ^Sprite, tx, ty, speed_px_per_tick, stop_distance: f64) -> bool {
	dx := tx - owner.x
	dy := ty - owner.y
	distance := math.sqrt(dx * dx + dy * dy)
	if distance < stop_distance || distance == 0 {
		phys_set_velocity(owner, 0, 0)
		return true
	}
	speed := speed_px_per_tick * TICKS_PER_SECOND
	phys_set_velocity(owner, (dx / distance) * speed, (dy / distance) * speed)
	return false
}

physics_stop :: proc(owner: ^Sprite) { phys_set_velocity(owner, 0, 0) }
physics_set_velocity :: proc(owner: ^Sprite, vx, vy: f64) { phys_set_velocity(owner, vx, vy) }

physics_scale_velocity :: proc(owner: ^Sprite, factor: f64) {
	vx, vy := physics_get_velocity(owner)
	phys_set_velocity(owner, vx * factor, vy * factor)
}

physics_teleport :: proc(owner: ^Sprite, x, y: f64) {
	r, ok := physics.actors[owner]
	if !ok do return
	ph.body_set_transform(r.body, V(x / PPM, y / PPM), 0)
	ph.body_set_linear_velocity(r.body, V(0, 0))
	owner.x = x
	owner.y = y
}

physics_add_car :: proc(owner: ^Sprite, length_px, width_px, angle: f64, tuning := DEFAULT_CAR_TUNING) {
	if owner in physics.cars do return
	bd := ph.default_body_def()
	bd.type = .Dynamic
	bd.position = V(owner.x / PPM, owner.y / PPM)
	bd.angle = angle
	bd.bullet = true
	bd.linear_damping = tuning.linear_damping
	bd.angular_damping = tuning.angular_damping
	bd.allow_sleep = false
	body := ph.world_create_body(physics.world, bd)
	fd := ph.default_fixture_def()
	fd.density = tuning.density
	fd.friction = 0.3
	fd.restitution = 0.1
	fd.category_bits = CAT_CAR
	fd.mask_bits = ACTOR_MASK
	fixture := ph.body_create_fixture(body, ph.make_box(length_px / 2 / PPM, width_px / 2 / PPM), fd)
	fixture.user = {kind = int(Fixture_Kind.Car), cell = -1, owner = owner, set = true}
	physics.cars[owner] = {body = body, fixture = fixture, tuning = tuning}
}

physics_remove_car :: proc(owner: ^Sprite) {
	r, ok := physics.cars[owner]
	if !ok do return
	ph.world_destroy_body(physics.world, r.body)
	delete_key(&physics.cars, owner)
}

physics_has_car :: proc(owner: ^Sprite) -> bool { return owner in physics.cars }

physics_drive_car :: proc(owner: ^Sprite, controls: Car_Controls) {
	r, ok := &physics.cars[owner]
	if !ok do return
	drive_car_body(r.body, controls, r.tuning, &r.steer, PHYSICS_STEP_S)
	r.driven = true
}

physics_get_car_state :: proc(owner: ^Sprite) -> (Car_State, bool) {
	r, ok := physics.cars[owner]
	if !ok do return {}, false
	p := ph.body_get_position(r.body)
	v := r.body.linear_velocity
	vx := v.x * PPM
	vy := v.y * PPM
	return {
		x = p.x * PPM,
		y = p.y * PPM,
		angle = ph.body_get_angle(r.body),
		vx = vx,
		vy = vy,
		speed = math.sqrt(vx * vx + vy * vy),
		steer = r.steer,
	}, true
}

physics_teleport_car :: proc(owner: ^Sprite, x, y, angle: f64) {
	r, ok := &physics.cars[owner]
	if !ok do return
	ph.body_set_transform(r.body, V(x / PPM, y / PPM), angle)
	ph.body_set_linear_velocity(r.body, V(0, 0))
	ph.body_set_angular_velocity(r.body, 0)
	r.steer = 0
	owner.x = x
	owner.y = y
}

// Returns this step's contacts; the caller must not keep the slice past the next step.
physics_drain_car_contacts :: proc() -> []Car_Contact {
	if len(physics.car_contacts) == 0 do return nil
	out := make([]Car_Contact, len(physics.car_contacts), context.temp_allocator)
	copy(out, physics.car_contacts[:])
	clear(&physics.car_contacts)
	return out
}

Spot_Query :: struct {
	mask:  u32,
	clear: bool,
}

phys_spot_clear :: proc(x, y, radius_px: f64, mask: u32) -> bool {
	if physics.map_body == nil do return true
	r := radius_px / PPM
	cx := x / PPM
	cy := y / PPM
	q := Spot_Query{mask, true}
	ph.world_query_aabb(physics.world, {V(cx - r, cy - r), V(cx + r, cy + r)}, proc(user: rawptr, f: ^ph.Fixture) -> bool {
		q := cast(^Spot_Query)user
		if f.is_sensor do return true
		if f.category_bits & q.mask == 0 do return true
		q.clear = false
		return false
	}, &q)
	return q.clear
}

physics_spot_clear_for_actor :: proc(x, y, radius_px: f64) -> bool {
	return phys_spot_clear(x, y, radius_px, CAT_WALL | CAT_DOOR | CAT_HERO | CAT_GUARD)
}

phys_set_cell_solid :: proc(cell: int, opaque: bool) {
	if physics.map_body == nil do return
	if cell in physics.door_fixtures do return
	if existing, ok := physics.cell_fixtures[cell]; ok do ph.body_destroy_fixture(physics.map_body, existing)
	phys_create_cell(cell, opaque)
}

phys_clear_cell :: proc(cell: int) {
	fixture, ok := physics.cell_fixtures[cell]
	if !ok do fixture, ok = physics.door_fixtures[cell]
	if !ok do return
	delete_key(&physics.cell_fixtures, cell)
	delete_key(&physics.door_fixtures, cell)
	if s, sok := physics.trigger_overlaps[cell]; sok {
		delete(s)
		delete_key(&physics.trigger_overlaps, cell)
	}
	append(&physics.pending_destroy, fixture)
}

physics_add_vision_blocker :: proc(circles: [][3]f64) -> int {
	if !physics.built do return -1
	bd := ph.default_body_def()
	bd.type = .Static
	body := ph.world_create_body(physics.world, bd)
	for c in circles {
		fd := ph.default_fixture_def()
		fd.is_sensor = true
		fd.category_bits = CAT_VISION_BLOCKER
		fd.mask_bits = 0
		ph.body_create_fixture(body, ph.make_circle(c[2] / PPM, V(c[0] / PPM, c[1] / PPM)), fd)
	}
	id := physics.next_smoke_id
	physics.next_smoke_id += 1
	physics.smoke_bodies[id] = body
	return id
}

physics_remove_vision_blocker :: proc(id: int) {
	if id < 0 do return
	body, ok := physics.smoke_bodies[id]
	if !ok do return
	ph.world_destroy_body(physics.world, body)
	delete_key(&physics.smoke_bodies, id)
}

physics_set_door_open :: proc(cell: int, open: bool) {
	fixture, ok := physics.door_fixtures[cell]
	if !ok do return
	ph.fixture_set_sensor(fixture, open)
	ph.fixture_set_filter_data(fixture, 0, open ? CAT_DOOR : CAT_DOOR | CAT_VISION_BLOCKER, STATIC_MASK)
}

physics_openers_near :: proc(cell: int) -> []^Sprite {
	if s, ok := physics.trigger_overlaps[cell]; ok do return s[:]
	return nil
}

Ray_Query :: struct {
	mask:   u32,
	ignore: ^Sprite,
	reject: u32,
	best:   Ray_Hit,
	has:    bool,
}

phys_ray_cast :: proc(x0, y0, x1, y1: f64, mask: u32, ignore: ^Sprite = nil, reject: u32 = 0) -> (Ray_Hit, bool) {
	if physics.map_body == nil do return {}, false
	if x0 == x1 && y0 == y1 do return {}, false
	q := Ray_Query{mask = mask, ignore = ignore, reject = reject}
	ph.world_ray_cast(physics.world, V(x0 / PPM, y0 / PPM), V(x1 / PPM, y1 / PPM), proc(user: rawptr, f: ^ph.Fixture, point, normal: ph.Vec2, fraction: f64) -> f64 {
		q := cast(^Ray_Query)user
		category := f.category_bits
		if f.is_sensor && category & CAT_VISION_BLOCKER == 0 do return -1
		if category & q.mask == 0 do return -1
		if q.reject != 0 && category & q.reject != 0 do return -1
		owner: ^Sprite = f.user.set ? cast(^Sprite)f.user.owner : nil
		if q.ignore != nil && f.user.set && owner == q.ignore do return -1
		if q.has && fraction >= q.best.fraction do return q.best.fraction
		q.best = {
			x        = point.x * PPM,
			y        = point.y * PPM,
			fraction = fraction,
			category = category,
			owner    = owner,
			cell     = f.user.set ? f.user.cell : -1,
		}
		q.has = true
		return fraction
	}, &q)
	return q.best, q.has
}

physics_bullet_hit :: proc(x0, y0, x1, y1: f64, shooter: ^Sprite, mask: u32 = BULLET_MASK) -> (Ray_Hit, bool) {
	return phys_ray_cast(x0, y0, x1, y1, mask, shooter)
}

physics_sight_stop :: proc(x0, y0, x1, y1: f64) -> (f64, f64) {
	hit, ok := phys_ray_cast(x0, y0, x1, y1, VISION_MASK)
	if ok do return hit.x, hit.y
	return x1, y1
}

physics_can_see :: proc(x0, y0, x1, y1: f64) -> bool {
	_, hit := phys_ray_cast(x0, y0, x1, y1, VISION_MASK)
	return !hit
}

physics_can_see_ignoring_doors :: proc(x0, y0, x1, y1: f64) -> bool {
	_, hit := phys_ray_cast(x0, y0, x1, y1, VISION_MASK, nil, CAT_DOOR)
	return !hit
}

phys_cell_center :: proc(cell: int) -> ph.Vec2 {
	half := physics.cell_size / 2
	x := f64(cell % physics.grid_width) * physics.cell_size + half
	y := f64(cell / physics.grid_width) * physics.cell_size + half
	return V(x / PPM, y / PPM)
}

phys_create_cell :: proc(cell: int, opaque: bool) {
	body := physics.map_body
	if body == nil do return
	half := physics.cell_size / 2 / PPM
	fd := ph.default_fixture_def()
	fd.category_bits = opaque ? CAT_WALL | CAT_VISION_BLOCKER : CAT_WALL
	fd.mask_bits = STATIC_MASK
	fixture := ph.body_create_fixture(body, ph.make_box(half, half, phys_cell_center(cell)), fd)
	fixture.user = {kind = int(Fixture_Kind.Cell), cell = cell, set = true}
	physics.cell_fixtures[cell] = fixture
}

phys_create_door :: proc(cell: int, solid, opaque: bool) {
	body := physics.map_body
	if body == nil do return
	half := physics.cell_size / 2 / PPM
	center := phys_cell_center(cell)
	fd := ph.default_fixture_def()
	fd.is_sensor = !solid
	fd.category_bits = opaque ? CAT_DOOR | CAT_VISION_BLOCKER : CAT_DOOR
	fd.mask_bits = STATIC_MASK
	fixture := ph.body_create_fixture(body, ph.make_box(half, half, center), fd)
	fixture.user = {kind = int(Fixture_Kind.Door), cell = cell, set = true}
	physics.door_fixtures[cell] = fixture
	td := ph.default_fixture_def()
	td.is_sensor = true
	td.category_bits = CAT_TRIGGER
	td.mask_bits = TRIGGER_MASK
	trigger := ph.body_create_fixture(body, ph.make_circle(DOOR_SENSOR_RADIUS_PX / PPM, center), td)
	trigger.user = {kind = int(Fixture_Kind.Trigger), cell = cell, set = true}
	physics.trigger_overlaps[cell] = make(Owner_Set)
}

phys_on_contact :: proc(c: ^ph.Contact, begin: bool) {
	fa := c.fixtureA
	fb := c.fixtureB
	a := fa.user
	b := fb.user
	if !a.set || !b.set do return
	CAR :: int(Fixture_Kind.Car)
	TRIGGER :: int(Fixture_Kind.Trigger)
	if begin && (a.kind == CAR || b.kind == CAR) && !fa.is_sensor && !fb.is_sensor {
		car_f := a.kind == CAR ? fa : fb
		other_f := a.kind == CAR ? fb : fa
		other := a.kind == CAR ? b : a
		is_actor := other.kind == int(Fixture_Kind.Actor) && other.owner != nil
		is_cell := other.kind == int(Fixture_Kind.Cell) || other.kind == int(Fixture_Kind.Door)
		if is_actor || is_cell {
			cv := car_f.body.linear_velocity
			ov := other_f.body.linear_velocity
			dx := (cv.x - ov.x) * PPM
			dy := (cv.y - ov.y) * PPM
			append(&physics.car_contacts, Car_Contact {
				is_actor = is_actor,
				owner = is_actor ? cast(^Sprite)other.owner : nil,
				cell = is_cell ? other.cell : -1,
				speed = math.sqrt(dx * dx + dy * dy),
			})
		}
	}
	trigger: ph.Fixture_User
	other: ph.Fixture_User
	if a.kind == TRIGGER {
		trigger, other = a, b
	} else if b.kind == TRIGGER {
		trigger, other = b, a
	} else {
		return
	}
	if (other.kind != int(Fixture_Kind.Actor) && other.kind != CAR) || other.owner == nil do return
	s, ok := &physics.trigger_overlaps[trigger.cell]
	if !ok do return
	if begin do set_add(s, cast(^Sprite)other.owner)
	else do set_delete(s, cast(^Sprite)other.owner)
}

// Geometry change from nav:dirty / cell:destroyed.
physics_on_geometry_changed :: proc(index: int, walkable: bool) {
	if !physics.built do return
	if walkable do phys_clear_cell(index)
	else do phys_set_cell_solid(index, true)
}

// src/physics/car.ts driveCarBody
drive_car_body :: proc(body: ^ph.Body, controls: Car_Controls, tuning: Car_Tuning, steer: ^f64, dt: f64) {
	v := body.linear_velocity
	forward := ph.body_get_world_vector(body, V(1, 0))
	right := ph.body_get_world_vector(body, V(0, 1))
	mass := body.mass
	center := ph.body_get_world_center(body)
	forward_speed := v.x * forward.x + v.y * forward.y
	speed_abs := abs(forward_speed)
	speed_t := min(speed_abs / tuning.max_speed, 1)
	max_steer := tuning.max_steer_low_speed + (tuning.max_steer_high_speed - tuning.max_steer_low_speed) * speed_t
	target := controls.steer * max_steer
	rate := controls.steer != 0 ? tuning.steer_rate : tuning.steer_return_rate
	max_delta := rate * dt
	delta := target - steer^
	steer^ += abs(delta) <= max_delta ? delta : js_sign(delta) * max_delta
	ph.body_set_angular_velocity(body, (forward_speed / tuning.wheelbase) * math.tan(steer^))
	decay := controls.handbrake ? tuning.handbrake_grip_decay : tuning.grip_decay
	lateral := v.x * right.x + v.y * right.y
	scrub := -lateral * (1 - math.exp(-decay * dt)) * mass
	ph.body_apply_linear_impulse(body, V(right.x * scrub, right.y * scrub), center, true)
	accel := 0.0
	if controls.throttle > 0 {
		if forward_speed < -0.3 do accel = tuning.brake_deceleration
		else if forward_speed < tuning.max_speed do accel = tuning.acceleration * controls.throttle
	} else if controls.throttle < 0 {
		if forward_speed > 0.3 do accel = -tuning.brake_deceleration
		else if forward_speed > -tuning.max_reverse_speed do accel = tuning.reverse_acceleration * controls.throttle
	} else if speed_abs > 1e-3 {
		accel = -js_sign(forward_speed) * min(tuning.engine_brake, speed_abs / dt)
	}
	f := accel * mass
	ph.body_apply_force_to_center(body, V(forward.x * f, forward.y * f), true)
}

js_sign :: proc(x: f64) -> f64 {
	if x > 0 do return 1
	if x < 0 do return -1
	return x
}

// Debug overlay support: every fixture with its world-space shape.
Debug_Shape :: struct {
	kind:     Fixture_Kind,
	sensor:   bool,
	category: u32,
	is_circle: bool,
	cx, cy, r: f64,
	poly:     [8]f64,
	poly_n:   int,
}

physics_for_each_fixture :: proc(visit: proc(s: Debug_Shape)) {
	if !physics.built do return
	for body := physics.world.body_list; body != nil; body = body.next {
		t := ph.body_get_position(body)
		for f := body.fixture_list; f != nil; f = f.next {
			d: Debug_Shape
			d.kind = f.user.set ? Fixture_Kind(f.user.kind) : .Cell
			d.sensor = f.is_sensor
			d.category = f.category_bits
			if f.shape.type == .Circle {
				d.is_circle = true
				d.cx = (t.x + f.shape.p.x) * PPM
				d.cy = (t.y + f.shape.p.y) * PPM
				d.r = f.shape.radius * PPM
			} else {
				n := min(f.shape.count, 4)
				for i in 0 ..< n {
					d.poly[i * 2] = (t.x + f.shape.vertices[i].x) * PPM
					d.poly[i * 2 + 1] = (t.y + f.shape.vertices[i].y) * PPM
				}
				d.poly_n = n
			}
			visit(d)
		}
	}
}
