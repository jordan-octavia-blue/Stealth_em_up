package physics

import "core:math"

// planck World.ts + Solver.ts (no joints: the game uses none).

Time_Step :: struct {
	dt:                   f64,
	inv_dt:               f64,
	velocity_iterations:  int,
	position_iterations:  int,
	warm_starting:        bool,
	block_solve:          bool,
	inv_dt0:              f64,
	dt_ratio:             f64,
}

time_step_reset :: proc(s: ^Time_Step, dt: f64) {
	if s.dt > 0.0 do s.inv_dt0 = s.inv_dt
	s.dt = dt
	s.inv_dt = dt == 0 ? 0 : 1 / dt
	s.dt_ratio = dt * s.inv_dt0
}

Contact_Callback :: proc(user: rawptr, c: ^Contact)

World :: struct {
	broad_phase:         Broad_Phase,
	contact_list:        ^Contact,
	contact_count:       int,
	body_list:           ^Body,
	body_count:          int,
	step_complete:       bool,
	allow_sleep:         bool,
	gravity:             Vec2,
	clear_forces:        bool,
	new_fixture:         bool,
	locked:              bool,
	warm_starting:       bool,
	continuous_physics:  bool,
	sub_stepping:        bool,
	block_solve:         bool,
	velocity_iterations: int,
	position_iterations: int,
	s_step:              Time_Step,
	s_sub_step:          Time_Step,
	begin_contact:       Contact_Callback,
	end_contact:         Contact_Callback,
	listener_user:       rawptr,
	// solver scratch
	stack:               [dynamic]^Body,
	bodies:              [dynamic]^Body,
	contacts:            [dynamic]^Contact,
}

world_create :: proc() -> ^World {
	w := new(World)
	w.broad_phase.world = w
	w.step_complete = true
	w.allow_sleep = true
	w.clear_forces = true
	w.warm_starting = true
	w.continuous_physics = true
	w.sub_stepping = false
	w.block_solve = true
	w.velocity_iterations = 8
	w.position_iterations = 3
	w.s_step.block_solve = true
	w.s_step.dt_ratio = 1
	w.s_sub_step.block_solve = true
	w.s_sub_step.dt_ratio = 1
	return w
}

world_create_body :: proc(w: ^World, def: Body_Def) -> ^Body {
	if w.locked do return nil
	b := new(Body)
	b.world = w
	b.awake = true
	b.auto_sleep = def.allow_sleep
	b.bullet = def.bullet
	b.fixed_rotation = def.fixed_rotation
	b.active = true
	b.type = def.type
	if b.type == .Dynamic {
		b.mass = 1.0
		b.inv_mass = 1.0
	}
	b.xf.p = def.position
	b.xf.q = rot_from_angle(def.angle)
	sweep_set_transform(&b.sweep, b.xf)
	b.linear_damping = def.linear_damping
	b.angular_damping = def.angular_damping
	b.gravity_scale = 1.0
	// _addBody: push front
	b.prev = nil
	b.next = w.body_list
	if w.body_list != nil do w.body_list.prev = b
	w.body_list = b
	w.body_count += 1
	return b
}

world_destroy_body :: proc(w: ^World, b: ^Body) -> bool {
	if w.locked do return false
	if b.destroyed do return false
	ce := b.contact_list
	for ce != nil {
		ce0 := ce
		ce = ce.next
		world_destroy_contact(w, ce0.contact)
		b.contact_list = ce
	}
	b.contact_list = nil
	f := b.fixture_list
	for f != nil {
		f0 := f
		f = f.next
		fixture_destroy_proxies(f0, &w.broad_phase)
		b.fixture_list = f
		free(f0)
	}
	b.fixture_list = nil
	if b.prev != nil do b.prev.next = b.next
	if b.next != nil do b.next.prev = b.prev
	if b == w.body_list do w.body_list = b.next
	b.destroyed = true
	w.body_count -= 1
	free(b)
	return true
}

world_begin_contact :: proc(w: ^World, c: ^Contact) {
	if w.begin_contact != nil do w.begin_contact(w.listener_user, c)
}

world_end_contact :: proc(w: ^World, c: ^Contact) {
	if w.end_contact != nil do w.end_contact(w.listener_user, c)
}

world_find_new_contacts :: proc(w: ^World) {
	bp_update_pairs(&w.broad_phase)
}

world_create_contact :: proc(w: ^World, proxyA, proxyB: ^Fixture_Proxy) {
	fixtureA := proxyA.fixture
	fixtureB := proxyB.fixture
	bodyA := fixtureA.body
	bodyB := fixtureB.body
	if bodyA == bodyB do return
	for edge := bodyB.contact_list; edge != nil; edge = edge.next {
		if edge.other == bodyA {
			fA := edge.contact.fixtureA
			fB := edge.contact.fixtureB
			if fA == fixtureA && fB == fixtureB do return
			if fA == fixtureB && fB == fixtureA do return
		}
	}
	if !body_should_collide(bodyB, bodyA) do return
	if !fixture_should_collide(fixtureB, fixtureA) do return
	c := contact_create(fixtureA, fixtureB)
	if c == nil do return
	c.prev = nil
	if w.contact_list != nil {
		c.next = w.contact_list
		w.contact_list.prev = c
	}
	w.contact_list = c
	w.contact_count += 1
}

world_update_contacts :: proc(w: ^World) {
	next_c := w.contact_list
	for next_c != nil {
		c := next_c
		next_c = c.next
		fixtureA := c.fixtureA
		fixtureB := c.fixtureB
		bodyA := fixtureA.body
		bodyB := fixtureB.body
		if c.filter_flag {
			if !body_should_collide(bodyB, bodyA) {
				world_destroy_contact(w, c)
				continue
			}
			if !fixture_should_collide(fixtureB, fixtureA) {
				world_destroy_contact(w, c)
				continue
			}
			c.filter_flag = false
		}
		activeA := bodyA.awake && !body_is_static(bodyA)
		activeB := bodyB.awake && !body_is_static(bodyB)
		if !activeA && !activeB do continue
		overlap := aabb_overlap(fixtureA.proxy.proxy.aabb, fixtureB.proxy.proxy.aabb)
		if !overlap {
			world_destroy_contact(w, c)
			continue
		}
		contact_update(c, w)
	}
}

world_destroy_contact :: proc(w: ^World, c: ^Contact) {
	if c.prev != nil do c.prev.next = c.next
	if c.next != nil do c.next.prev = c.prev
	if c == w.contact_list do w.contact_list = c.next
	contact_destroy(c, w)
	w.contact_count -= 1
}

world_step :: proc(w: ^World, time_step: f64, velocity_iterations, position_iterations: int) {
	if w.new_fixture {
		world_find_new_contacts(w)
		w.new_fixture = false
	}
	w.locked = true
	time_step_reset(&w.s_step, time_step)
	w.s_step.velocity_iterations = velocity_iterations
	w.s_step.position_iterations = position_iterations
	w.s_step.warm_starting = w.warm_starting
	w.s_step.block_solve = w.block_solve
	world_update_contacts(w)
	if w.step_complete && time_step > 0.0 {
		solve_world(w, &w.s_step)
		for b := w.body_list; b != nil; b = b.next {
			if !b.island_flag do continue
			if body_is_static(b) do continue
			body_synchronize_fixtures(b)
		}
		world_find_new_contacts(w)
	}
	if w.continuous_physics && time_step > 0.0 {
		solve_world_toi(w, &w.s_step)
	}
	if w.clear_forces {
		for b := w.body_list; b != nil; b = b.next {
			b.force = {}
			b.torque = 0.0
		}
	}
	w.locked = false
}

// --- queries ----------------------------------------------------------------

Query_Callback :: proc(user: rawptr, f: ^Fixture) -> bool

@(private)
Query_Ctx :: struct {
	cb:   Query_Callback,
	user: rawptr,
}

world_query_aabb :: proc(w: ^World, aabb: AABB, cb: Query_Callback, user: rawptr) {
	ctx := Query_Ctx{cb, user}
	tree_query(&w.broad_phase.tree, aabb, proc(data: rawptr, node: ^Tree_Node) -> bool {
		ctx := cast(^Query_Ctx)data
		return ctx.cb(ctx.user, node.user_data.fixture)
	}, &ctx)
}

// (fixture, point, normal, fraction) -> new max fraction, like planck.
Ray_Callback :: proc(user: rawptr, f: ^Fixture, point: Vec2, normal: Vec2, fraction: f64) -> f64

@(private)
Ray_Ctx :: struct {
	cb:   Ray_Callback,
	user: rawptr,
}

world_ray_cast :: proc(w: ^World, p1, p2: Vec2, cb: Ray_Callback, user: rawptr) {
	ctx := Ray_Ctx{cb, user}
	input := Ray_Cast_Input{p1 = p1, p2 = p2, max_fraction = 1.0}
	tree_ray_cast(&w.broad_phase.tree, input, proc(data: rawptr, sub: Ray_Cast_Input, node: ^Tree_Node) -> f64 {
		ctx := cast(^Ray_Ctx)data
		fixture := node.user_data.fixture
		output: Ray_Cast_Output
		if fixture_ray_cast(fixture, &output, sub) {
			fraction := output.fraction
			point := Vec2 {
				(1.0 - fraction) * sub.p1.x + fraction * sub.p2.x,
				(1.0 - fraction) * sub.p1.y + fraction * sub.p2.y,
			}
			return ctx.cb(ctx.user, fixture, point, output.normal, fraction)
		}
		return sub.max_fraction
	}, &ctx)
}

// --- Solver -----------------------------------------------------------------

@(private)
solver_clear :: proc(w: ^World) {
	clear(&w.stack)
	clear(&w.bodies)
	clear(&w.contacts)
}

solve_world :: proc(w: ^World, step: ^Time_Step) {
	for b := w.body_list; b != nil; b = b.next do b.island_flag = false
	for c := w.contact_list; c != nil; c = c.next do c.island_flag = false
	for seed := w.body_list; seed != nil; seed = seed.next {
		if seed.island_flag do continue
		if !seed.awake || !seed.active do continue
		if body_is_static(seed) do continue
		solver_clear(w)
		append(&w.stack, seed)
		seed.island_flag = true
		for len(w.stack) > 0 {
			b := pop(&w.stack)
			append(&w.bodies, b)
			b.awake = true
			if body_is_static(b) do continue
			for ce := b.contact_list; ce != nil; ce = ce.next {
				contact := ce.contact
				if contact.island_flag do continue
				if !contact.enabled || !contact.touching do continue
				if contact.fixtureA.is_sensor || contact.fixtureB.is_sensor do continue
				append(&w.contacts, contact)
				contact.island_flag = true
				other := ce.other
				if other.island_flag do continue
				append(&w.stack, other)
				other.island_flag = true
			}
		}
		solve_island(w, step)
		for b in w.bodies {
			if body_is_static(b) do b.island_flag = false
		}
	}
}

@(private)
integrate_positions :: proc(w: ^World, h: f64, write_sweep: bool) {
	for body in w.bodies {
		c := body.c_position.c
		a := body.c_position.a
		v := body.c_velocity.v
		ww := body.c_velocity.w
		translation := Vec2{h * v.x, h * v.y}
		tlsq := length_sqr(translation)
		if tlsq > MAX_TRANSLATION_SQUARED {
			ratio := MAX_TRANSLATION / math.sqrt(tlsq)
			v.x *= ratio
			v.y *= ratio
		}
		rotation := h * ww
		if rotation * rotation > MAX_ROTATION_SQUARED {
			ratio := MAX_ROTATION / math.abs(rotation)
			ww *= ratio
		}
		c.x += h * v.x
		c.y += h * v.y
		a += h * ww
		body.c_position.c = c
		body.c_position.a = a
		body.c_velocity.v = v
		body.c_velocity.w = ww
		if write_sweep {
			body.sweep.c = c
			body.sweep.a = a
			body.linear_velocity = v
			body.angular_velocity = ww
			body_synchronize_transform(body)
		}
	}
}

solve_island :: proc(w: ^World, step: ^Time_Step) {
	gravity := w.gravity
	h := step.dt
	for body in w.bodies {
		c := body.sweep.c
		a := body.sweep.a
		v := body.linear_velocity
		ww := body.angular_velocity
		body.sweep.c0 = body.sweep.c
		body.sweep.a0 = body.sweep.a
		if body_is_dynamic(body) {
			v.x += h * body.gravity_scale * gravity.x
			v.y += h * body.gravity_scale * gravity.y
			v.x += h * body.inv_mass * body.force.x
			v.y += h * body.inv_mass * body.force.y
			ww += h * body.inv_I * body.torque
			k := 1.0 / (1.0 + h * body.linear_damping)
			v = {k * v.x, k * v.y}
			ww *= 1.0 / (1.0 + h * body.angular_damping)
		}
		body.c_position.c = c
		body.c_position.a = a
		body.c_velocity.v = v
		body.c_velocity.w = ww
	}
	for c in w.contacts do contact_init_constraint(c, step)
	for c in w.contacts do contact_init_velocity_constraint(c, step)
	if step.warm_starting {
		for c in w.contacts do contact_warm_start(c, step)
	}
	for _ in 0 ..< step.velocity_iterations {
		for c in w.contacts do contact_solve_velocity_constraint(c, step)
	}
	for c in w.contacts do contact_store_impulses(c)
	integrate_positions(w, h, false)
	position_solved := false
	for _ in 0 ..< step.position_iterations {
		min_separation := 0.0
		for c in w.contacts {
			separation := contact_solve_position_constraint(c, step, nil, nil)
			min_separation = min(min_separation, separation)
		}
		if min_separation >= -3.0 * LINEAR_SLOP {
			position_solved = true
			break
		}
	}
	for body in w.bodies {
		body.sweep.c = body.c_position.c
		body.sweep.a = body.c_position.a
		body.linear_velocity = body.c_velocity.v
		body.angular_velocity = body.c_velocity.w
		body_synchronize_transform(body)
	}
	if w.allow_sleep {
		min_sleep_time := INF
		for body in w.bodies {
			if body_is_static(body) do continue
			if !body.auto_sleep ||
			   body.angular_velocity * body.angular_velocity > ANGULAR_SLEEP_TOLERANCE_SQR ||
			   length_sqr(body.linear_velocity) > LINEAR_SLEEP_TOLERANCE_SQR {
				body.sleep_time = 0.0
				min_sleep_time = 0.0
			} else {
				body.sleep_time += h
				min_sleep_time = min(min_sleep_time, body.sleep_time)
			}
		}
		if min_sleep_time >= TIME_TO_SLEEP && position_solved {
			for body in w.bodies do body_set_awake(body, false)
		}
	}
}

solve_world_toi :: proc(w: ^World, step: ^Time_Step) {
	if w.step_complete {
		for b := w.body_list; b != nil; b = b.next {
			b.island_flag = false
			b.sweep.alpha0 = 0.0
		}
		for c := w.contact_list; c != nil; c = c.next {
			c.toi_flag = false
			c.island_flag = false
			c.toi_count = 0
			c.toi = 1.0
		}
	}
	for {
		min_contact: ^Contact = nil
		min_alpha := 1.0
		for c := w.contact_list; c != nil; c = c.next {
			if !c.enabled do continue
			if c.toi_count > MAX_SUB_STEPS do continue
			alpha := 1.0
			if c.toi_flag {
				alpha = c.toi
			} else {
				fA := c.fixtureA
				fB := c.fixtureB
				if fA.is_sensor || fB.is_sensor do continue
				bA := fA.body
				bB := fB.body
				activeA := bA.awake && !body_is_static(bA)
				activeB := bB.awake && !body_is_static(bB)
				if !activeA && !activeB do continue
				collideA := bA.bullet || !body_is_dynamic(bA)
				collideB := bB.bullet || !body_is_dynamic(bB)
				if !collideA && !collideB do continue
				alpha0 := bA.sweep.alpha0
				if bA.sweep.alpha0 < bB.sweep.alpha0 {
					alpha0 = bB.sweep.alpha0
					sweep_advance(&bA.sweep, alpha0)
				} else if bB.sweep.alpha0 < bA.sweep.alpha0 {
					alpha0 = bA.sweep.alpha0
					sweep_advance(&bB.sweep, alpha0)
				}
				input: TOI_Input
				proxy_set(&input.proxyA, &fA.shape)
				proxy_set(&input.proxyB, &fB.shape)
				input.sweepA = bA.sweep
				input.sweepB = bB.sweep
				input.t_max = 1.0
				output: TOI_Output
				time_of_impact(&output, &input)
				beta := output.t
				if output.state == .Touching {
					alpha = min(alpha0 + (1.0 - alpha0) * beta, 1.0)
				} else {
					alpha = 1.0
				}
				c.toi = alpha
				c.toi_flag = true
			}
			if alpha < min_alpha {
				min_contact = c
				min_alpha = alpha
			}
		}
		if min_contact == nil || 1.0 - 10.0 * EPSILON < min_alpha {
			w.step_complete = true
			break
		}
		fA := min_contact.fixtureA
		fB := min_contact.fixtureB
		bA := fA.body
		bB := fB.body
		backup1 := bA.sweep
		backup2 := bB.sweep
		body_advance(bA, min_alpha)
		body_advance(bB, min_alpha)
		contact_update(min_contact, w)
		min_contact.toi_flag = false
		min_contact.toi_count += 1
		if !min_contact.enabled || !min_contact.touching {
			min_contact.enabled = false
			bA.sweep = backup1
			bB.sweep = backup2
			body_synchronize_transform(bA)
			body_synchronize_transform(bB)
			continue
		}
		body_set_awake(bA, true)
		body_set_awake(bB, true)
		solver_clear(w)
		append(&w.bodies, bA)
		append(&w.bodies, bB)
		append(&w.contacts, min_contact)
		bA.island_flag = true
		bB.island_flag = true
		min_contact.island_flag = true
		pair := [2]^Body{bA, bB}
		for body in pair {
			if !body_is_dynamic(body) do continue
			for ce := body.contact_list; ce != nil; ce = ce.next {
				contact := ce.contact
				if contact.island_flag do continue
				other := ce.other
				if body_is_dynamic(other) && !body.bullet && !other.bullet do continue
				if contact.fixtureA.is_sensor || contact.fixtureB.is_sensor do continue
				backup := other.sweep
				if !other.island_flag do body_advance(other, min_alpha)
				contact_update(contact, w)
				if !contact.enabled || !contact.touching {
					other.sweep = backup
					body_synchronize_transform(other)
					continue
				}
				contact.island_flag = true
				append(&w.contacts, contact)
				if other.island_flag do continue
				other.island_flag = true
				if !body_is_static(other) do body_set_awake(other, true)
				append(&w.bodies, other)
			}
		}
		sub := &w.s_sub_step
		time_step_reset(sub, (1.0 - min_alpha) * step.dt)
		sub.dt_ratio = 1.0
		sub.position_iterations = 20
		sub.velocity_iterations = step.velocity_iterations
		sub.warm_starting = false
		solve_island_toi(w, sub, bA, bB)
		for body in w.bodies {
			body.island_flag = false
			if !body_is_dynamic(body) do continue
			body_synchronize_fixtures(body)
			for ce := body.contact_list; ce != nil; ce = ce.next {
				ce.contact.toi_flag = false
				ce.contact.island_flag = false
			}
		}
		world_find_new_contacts(w)
		if w.sub_stepping {
			w.step_complete = false
			break
		}
	}
}

solve_island_toi :: proc(w: ^World, sub: ^Time_Step, toiA, toiB: ^Body) {
	for body in w.bodies {
		body.c_position.c = body.sweep.c
		body.c_position.a = body.sweep.a
		body.c_velocity.v = body.linear_velocity
		body.c_velocity.w = body.angular_velocity
	}
	for c in w.contacts do contact_init_constraint(c, sub)
	for _ in 0 ..< sub.position_iterations {
		min_separation := 0.0
		for c in w.contacts {
			separation := contact_solve_position_constraint(c, sub, toiA, toiB)
			min_separation = min(min_separation, separation)
		}
		if min_separation >= -1.5 * LINEAR_SLOP do break
	}
	toiA.sweep.c0 = toiA.c_position.c
	toiA.sweep.a0 = toiA.c_position.a
	toiB.sweep.c0 = toiB.c_position.c
	toiB.sweep.a0 = toiB.c_position.a
	for c in w.contacts do contact_init_velocity_constraint(c, sub)
	for _ in 0 ..< sub.velocity_iterations {
		for c in w.contacts do contact_solve_velocity_constraint(c, sub)
	}
	integrate_positions(w, sub.dt, true)
}
