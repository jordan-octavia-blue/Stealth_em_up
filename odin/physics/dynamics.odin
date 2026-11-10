package physics

import "core:math"

// Bodies, fixtures and contacts (planck Body.ts, Fixture.ts, Contact.ts).

Body_Type :: enum u8 {
	Static,
	Kinematic,
	Dynamic,
}

Body_Def :: struct {
	type:             Body_Type,
	position:         Vec2,
	angle:            f64,
	linear_damping:   f64,
	angular_damping:  f64,
	fixed_rotation:   bool,
	bullet:           bool,
	allow_sleep:      bool,
}

default_body_def :: proc() -> Body_Def {
	return Body_Def{allow_sleep = true}
}

Velocity :: struct {
	v: Vec2,
	w: f64,
}

Position :: struct {
	c: Vec2,
	a: f64,
}

Body :: struct {
	world:            ^World,
	awake:            bool,
	auto_sleep:       bool,
	bullet:           bool,
	fixed_rotation:   bool,
	active:           bool,
	island_flag:      bool,
	type:             Body_Type,
	mass, inv_mass:   f64,
	I, inv_I:         f64,
	xf:               Transform,
	sweep:            Sweep,
	c_velocity:       Velocity,
	c_position:       Position,
	force:            Vec2,
	torque:           f64,
	linear_velocity:  Vec2,
	angular_velocity: f64,
	linear_damping:   f64,
	angular_damping:  f64,
	gravity_scale:    f64,
	sleep_time:       f64,
	contact_list:     ^Contact_Edge,
	fixture_list:     ^Fixture,
	prev, next:       ^Body,
	destroyed:        bool,
	user_data:        rawptr,
}

Fixture_Def :: struct {
	friction:      f64,
	restitution:   f64,
	density:       f64,
	is_sensor:     bool,
	group_index:   int,
	category_bits: u32,
	mask_bits:     u32,
}

default_fixture_def :: proc() -> Fixture_Def {
	return Fixture_Def{friction = 0.2, category_bits = 0x0001, mask_bits = 0xffff}
}

Fixture_Proxy :: struct {
	aabb:     AABB,
	fixture:  ^Fixture,
	proxy:    ^Tree_Node,
}

// What the game hangs off a fixture (planck's userData).
Fixture_User :: struct {
	kind:  int,
	cell:  int,
	owner: rawptr,
	set:   bool,
}

Fixture :: struct {
	body:          ^Body,
	friction:      f64,
	restitution:   f64,
	density:       f64,
	is_sensor:     bool,
	group_index:   int,
	category_bits: u32,
	mask_bits:     u32,
	shape:         Shape,
	next:          ^Fixture,
	proxy:         Fixture_Proxy,
	proxy_count:   int,
	user:          Fixture_User,
}

Contact_Edge :: struct {
	contact:    ^Contact,
	prev, next: ^Contact_Edge,
	other:      ^Body,
}

Velocity_Constraint_Point :: struct {
	rA, rB:          Vec2,
	normal_impulse:  f64,
	tangent_impulse: f64,
	normal_mass:     f64,
	tangent_mass:    f64,
	velocity_bias:   f64,
}

Mat22 :: struct {
	ex, ey: Vec2,
}

Contact :: struct {
	nodeA, nodeB:     Contact_Edge,
	fixtureA:         ^Fixture,
	fixtureB:         ^Fixture,
	manifold:         Manifold,
	prev, next:       ^Contact,
	toi:              f64,
	toi_count:        int,
	toi_flag:         bool,
	friction:         f64,
	restitution:      f64,
	tangent_speed:    f64,
	enabled:          bool,
	island_flag:      bool,
	touching:         bool,
	filter_flag:      bool,
	eval:             proc(m: ^Manifold, xfA: Transform, fA: ^Fixture, xfB: Transform, fB: ^Fixture),
	v_points:         [2]Velocity_Constraint_Point,
	v_normal:         Vec2,
	v_normal_mass:    Mat22,
	v_K:              Mat22,
	v_point_count:    int,
	v_tangent_speed:  f64,
	v_friction:       f64,
	v_restitution:    f64,
	v_inv_massA:      f64,
	v_inv_massB:      f64,
	v_inv_IA:         f64,
	v_inv_IB:         f64,
	p_local_points:   [2]Vec2,
	p_local_normal:   Vec2,
	p_local_point:    Vec2,
	p_local_centerA:  Vec2,
	p_local_centerB:  Vec2,
	p_type:           Manifold_Type,
	p_radiusA:        f64,
	p_radiusB:        f64,
	p_point_count:    int,
	p_inv_massA:      f64,
	p_inv_massB:      f64,
	p_inv_IA:         f64,
	p_inv_IB:         f64,
}

// --- Body -------------------------------------------------------------------

body_is_static :: #force_inline proc(b: ^Body) -> bool {return b.type == .Static}
body_is_dynamic :: #force_inline proc(b: ^Body) -> bool {return b.type == .Dynamic}

body_set_awake :: proc(b: ^Body, flag: bool) {
	if flag {
		b.awake = true
		b.sleep_time = 0.0
	} else {
		b.awake = false
		b.sleep_time = 0.0
		b.linear_velocity = {}
		b.angular_velocity = 0.0
		b.force = {}
		b.torque = 0.0
	}
}

body_set_transform :: proc(b: ^Body, position: Vec2, angle: f64) {
	if b.world.locked do return
	b.xf.p = position
	b.xf.q = rot_from_angle(angle)
	sweep_set_transform(&b.sweep, b.xf)
	for f := b.fixture_list; f != nil; f = f.next {
		fixture_synchronize(f, &b.world.broad_phase, b.xf, b.xf)
	}
	body_set_awake(b, true)
}

body_synchronize_transform :: proc(b: ^Body) {
	b.xf = sweep_get_transform(&b.sweep, 1)
}

body_synchronize_fixtures :: proc(b: ^Body) {
	xf := sweep_get_transform(&b.sweep, 0)
	for f := b.fixture_list; f != nil; f = f.next {
		fixture_synchronize(f, &b.world.broad_phase, xf, b.xf)
	}
}

body_advance :: proc(b: ^Body, alpha: f64) {
	sweep_advance(&b.sweep, alpha)
	b.sweep.c = b.sweep.c0
	b.sweep.a = b.sweep.a0
	b.xf = sweep_get_transform(&b.sweep, 1)
}

body_get_position :: #force_inline proc(b: ^Body) -> Vec2 {return b.xf.p}
body_get_angle :: #force_inline proc(b: ^Body) -> f64 {return b.sweep.a}
body_get_world_center :: #force_inline proc(b: ^Body) -> Vec2 {return b.sweep.c}

body_set_linear_velocity :: proc(b: ^Body, v: Vec2) {
	if b.type == .Static do return
	if dot(v, v) > 0.0 do body_set_awake(b, true)
	b.linear_velocity = v
}

body_set_angular_velocity :: proc(b: ^Body, w: f64) {
	if b.type == .Static do return
	if w * w > 0.0 do body_set_awake(b, true)
	b.angular_velocity = w
}

body_reset_mass_data :: proc(b: ^Body) {
	b.mass = 0.0
	b.inv_mass = 0.0
	b.I = 0.0
	b.inv_I = 0.0
	b.sweep.local_center = {}
	if b.type == .Static || b.type == .Kinematic {
		b.sweep.c0 = b.xf.p
		b.sweep.c = b.xf.p
		b.sweep.a0 = b.sweep.a
		return
	}
	local_center := Vec2{0, 0}
	for f := b.fixture_list; f != nil; f = f.next {
		if f.density == 0.0 do continue
		md := shape_compute_mass(&f.shape, f.density)
		b.mass += md.mass
		local_center.x += md.mass * md.center.x
		local_center.y += md.mass * md.center.y
		b.I += md.I
	}
	if b.mass > 0.0 {
		b.inv_mass = 1.0 / b.mass
		local_center = {b.inv_mass * local_center.x, b.inv_mass * local_center.y}
	} else {
		b.mass = 1.0
		b.inv_mass = 1.0
	}
	if b.I > 0.0 && !b.fixed_rotation {
		b.I -= b.mass * dot(local_center, local_center)
		b.inv_I = 1.0 / b.I
	} else {
		b.I = 0.0
		b.inv_I = 0.0
	}
	old_center := b.sweep.c
	sweep_set_local_center(&b.sweep, local_center, b.xf)
	shift := b.sweep.c - old_center
	b.linear_velocity += cross_sv(b.angular_velocity, shift)
}

body_apply_force_to_center :: proc(b: ^Body, force: Vec2, wake := true) {
	if b.type != .Dynamic do return
	if wake && !b.awake do body_set_awake(b, true)
	if b.awake do b.force += force
}

body_apply_linear_impulse :: proc(b: ^Body, impulse: Vec2, point: Vec2, wake := true) {
	if b.type != .Dynamic do return
	if wake && !b.awake do body_set_awake(b, true)
	if b.awake {
		b.linear_velocity.x += b.inv_mass * impulse.x
		b.linear_velocity.y += b.inv_mass * impulse.y
		b.angular_velocity += b.inv_I * cross(point - b.sweep.c, impulse)
	}
}

body_get_world_vector :: #force_inline proc(b: ^Body, v: Vec2) -> Vec2 {return rot_vec(b.xf.q, v)}

body_should_collide :: #force_inline proc(a, b: ^Body) -> bool {
	if a.type != .Dynamic && b.type != .Dynamic do return false
	return true
}

body_create_fixture :: proc(b: ^Body, shape: Shape, def: Fixture_Def) -> ^Fixture {
	if b.world.locked do return nil
	f := new(Fixture)
	f.body = b
	f.friction = def.friction
	f.restitution = def.restitution
	f.density = def.density
	f.is_sensor = def.is_sensor
	f.group_index = def.group_index
	f.category_bits = def.category_bits
	f.mask_bits = def.mask_bits
	f.shape = shape
	f.proxy.fixture = f
	if b.active {
		fixture_create_proxies(f, &b.world.broad_phase, b.xf)
	}
	f.next = b.fixture_list
	b.fixture_list = f
	if f.density > 0.0 do body_reset_mass_data(b)
	b.world.new_fixture = true
	return f
}

body_destroy_fixture :: proc(b: ^Body, fixture: ^Fixture) {
	if b.world.locked do return
	if b.fixture_list == fixture {
		b.fixture_list = fixture.next
	} else {
		for node := b.fixture_list; node != nil; node = node.next {
			if node.next == fixture {
				node.next = fixture.next
				break
			}
		}
	}
	edge := b.contact_list
	for edge != nil {
		c := edge.contact
		edge = edge.next
		if fixture == c.fixtureA || fixture == c.fixtureB {
			world_destroy_contact(b.world, c)
		}
	}
	if b.active {
		fixture_destroy_proxies(fixture, &b.world.broad_phase)
	}
	fixture.body = nil
	fixture.next = nil
	free(fixture)
	body_reset_mass_data(b)
}

// --- Fixture ----------------------------------------------------------------

fixture_create_proxies :: proc(f: ^Fixture, bp: ^Broad_Phase, xf: Transform) {
	f.proxy_count = 1
	f.proxy.aabb = shape_compute_aabb(&f.shape, xf)
	f.proxy.proxy = bp_create_proxy(bp, f.proxy.aabb, &f.proxy)
}

fixture_destroy_proxies :: proc(f: ^Fixture, bp: ^Broad_Phase) {
	if f.proxy_count > 0 {
		bp_destroy_proxy(bp, f.proxy.proxy)
		f.proxy.proxy = nil
	}
	f.proxy_count = 0
}

fixture_synchronize :: proc(f: ^Fixture, bp: ^Broad_Phase, xf1, xf2: Transform) {
	if f.proxy_count == 0 do return
	a1 := shape_compute_aabb(&f.shape, xf1)
	a2 := shape_compute_aabb(&f.shape, xf2)
	f.proxy.aabb = aabb_combine(a1, a2)
	disp := xf2.p - xf1.p
	bp_move_proxy(bp, f.proxy.proxy, f.proxy.aabb, disp)
}

fixture_set_sensor :: proc(f: ^Fixture, sensor: bool) {
	if sensor != f.is_sensor {
		body_set_awake(f.body, true)
		f.is_sensor = sensor
	}
}

fixture_set_filter_data :: proc(f: ^Fixture, group_index: int, category_bits, mask_bits: u32) {
	f.group_index = group_index
	f.category_bits = category_bits
	f.mask_bits = mask_bits
	fixture_refilter(f)
}

fixture_refilter :: proc(f: ^Fixture) {
	if f.body == nil do return
	for edge := f.body.contact_list; edge != nil; edge = edge.next {
		c := edge.contact
		if c.fixtureA == f || c.fixtureB == f do c.filter_flag = true
	}
	if f.proxy_count > 0 do bp_touch_proxy(&f.body.world.broad_phase, f.proxy.proxy)
}

fixture_should_collide :: proc(this, that: ^Fixture) -> bool {
	if that.group_index == this.group_index && that.group_index != 0 {
		return that.group_index > 0
	}
	collideA := (that.mask_bits & this.category_bits) != 0
	collideB := (that.category_bits & this.mask_bits) != 0
	return collideA && collideB
}

fixture_ray_cast :: proc(f: ^Fixture, output: ^Ray_Cast_Output, input: Ray_Cast_Input) -> bool {
	return shape_ray_cast(&f.shape, output, input, f.body.xf)
}

// --- Contact ----------------------------------------------------------------

mix_friction :: #force_inline proc(a, b: f64) -> f64 {
	return math.sqrt(a * b)
}

mix_restitution :: #force_inline proc(a, b: f64) -> f64 {
	return a > b ? a : b
}

eval_circles :: proc(m: ^Manifold, xfA: Transform, fA: ^Fixture, xfB: Transform, fB: ^Fixture) {
	collide_circles(m, &fA.shape, xfA, &fB.shape, xfB)
}
eval_polygon_circle :: proc(m: ^Manifold, xfA: Transform, fA: ^Fixture, xfB: Transform, fB: ^Fixture) {
	collide_polygon_circle(m, &fA.shape, xfA, &fB.shape, xfB)
}
eval_polygons :: proc(m: ^Manifold, xfA: Transform, fA: ^Fixture, xfB: Transform, fB: ^Fixture) {
	collide_polygons(m, &fA.shape, xfA, &fB.shape, xfB)
}

contact_create :: proc(fixtureA, fixtureB: ^Fixture) -> ^Contact {
	fA, fB := fixtureA, fixtureB
	tA := fA.shape.type
	tB := fB.shape.type
	eval: proc(m: ^Manifold, xfA: Transform, fA: ^Fixture, xfB: Transform, fB: ^Fixture)
	// Registered pairs: circle/circle, polygon/circle, polygon/polygon.
	if tA == .Circle && tB == .Circle {
		eval = eval_circles
	} else if tA == .Polygon && tB == .Circle {
		eval = eval_polygon_circle
	} else if tA == .Polygon && tB == .Polygon {
		eval = eval_polygons
	} else {
		// circle/polygon: planck swaps so the polygon is A
		fA, fB = fB, fA
		eval = eval_polygon_circle
	}
	c := new(Contact)
	c.toi = 1.0
	c.enabled = true
	c.manifold.type = .Unset
	for &p in c.manifold.points do id_recycle(&p.id)
	c.fixtureA = fA
	c.fixtureB = fB
	c.eval = eval
	c.friction = mix_friction(fA.friction, fB.friction)
	c.restitution = mix_restitution(fA.restitution, fB.restitution)
	c.p_type = .Unset

	bodyA := fA.body
	bodyB := fB.body
	c.nodeA.contact = c
	c.nodeA.other = bodyB
	c.nodeA.prev = nil
	c.nodeA.next = bodyA.contact_list
	if bodyA.contact_list != nil do bodyA.contact_list.prev = &c.nodeA
	bodyA.contact_list = &c.nodeA

	c.nodeB.contact = c
	c.nodeB.other = bodyA
	c.nodeB.prev = nil
	c.nodeB.next = bodyB.contact_list
	if bodyB.contact_list != nil do bodyB.contact_list.prev = &c.nodeB
	bodyB.contact_list = &c.nodeB

	if !fA.is_sensor && !fB.is_sensor {
		body_set_awake(bodyA, true)
		body_set_awake(bodyB, true)
	}
	return c
}

contact_destroy :: proc(c: ^Contact, world: ^World) {
	fA := c.fixtureA
	fB := c.fixtureB
	bodyA := fA.body
	bodyB := fB.body
	if c.touching do world_end_contact(world, c)
	if c.nodeA.prev != nil do c.nodeA.prev.next = c.nodeA.next
	if c.nodeA.next != nil do c.nodeA.next.prev = c.nodeA.prev
	if &c.nodeA == bodyA.contact_list do bodyA.contact_list = c.nodeA.next
	if c.nodeB.prev != nil do c.nodeB.prev.next = c.nodeB.next
	if c.nodeB.next != nil do c.nodeB.next.prev = c.nodeB.prev
	if &c.nodeB == bodyB.contact_list do bodyB.contact_list = c.nodeB.next
	if c.manifold.point_count > 0 && !fA.is_sensor && !fB.is_sensor {
		body_set_awake(bodyA, true)
		body_set_awake(bodyB, true)
	}
	free(c)
}

contact_update :: proc(c: ^Contact, world: ^World) {
	fA := c.fixtureA
	fB := c.fixtureB
	bodyA := fA.body
	bodyB := fB.body
	c.enabled = true
	touching := false
	was_touching := c.touching
	sensor := fA.is_sensor || fB.is_sensor
	xfA := bodyA.xf
	xfB := bodyB.xf
	if sensor {
		touching = test_overlap(&fA.shape, &fB.shape, xfA, xfB)
		c.manifold.point_count = 0
	} else {
		old := c.manifold
		manifold_recycle(&c.manifold)
		c.eval(&c.manifold, xfA, fA, xfB, fB)
		touching = c.manifold.point_count > 0
		for i in 0 ..< c.manifold.point_count {
			nmp := &c.manifold.points[i]
			nmp.normal_impulse = 0.0
			nmp.tangent_impulse = 0.0
			for j in 0 ..< old.point_count {
				omp := &old.points[j]
				if omp.id.key == nmp.id.key {
					nmp.normal_impulse = omp.normal_impulse
					nmp.tangent_impulse = omp.tangent_impulse
					break
				}
			}
		}
		if touching != was_touching {
			body_set_awake(bodyA, true)
			body_set_awake(bodyB, true)
		}
	}
	c.touching = touching
	if !was_touching && touching do world_begin_contact(world, c)
	if was_touching && !touching do world_end_contact(world, c)
}

contact_init_constraint :: proc(c: ^Contact, step: ^Time_Step) {
	fA := c.fixtureA
	fB := c.fixtureB
	bodyA := fA.body
	bodyB := fB.body
	m := &c.manifold
	point_count := m.point_count
	c.v_inv_massA = bodyA.inv_mass
	c.v_inv_massB = bodyB.inv_mass
	c.v_inv_IA = bodyA.inv_I
	c.v_inv_IB = bodyB.inv_I
	c.v_friction = c.friction
	c.v_restitution = c.restitution
	c.v_tangent_speed = c.tangent_speed
	c.v_point_count = point_count
	c.v_K = {}
	c.v_normal_mass = {}
	c.p_inv_massA = bodyA.inv_mass
	c.p_inv_massB = bodyB.inv_mass
	c.p_inv_IA = bodyA.inv_I
	c.p_inv_IB = bodyB.inv_I
	c.p_local_centerA = bodyA.sweep.local_center
	c.p_local_centerB = bodyB.sweep.local_center
	c.p_radiusA = fA.shape.radius
	c.p_radiusB = fB.shape.radius
	c.p_type = m.type
	c.p_local_normal = m.local_normal
	c.p_local_point = m.local_point
	c.p_point_count = point_count
	for j in 0 ..< MAX_MANIFOLD_POINTS {
		c.v_points[j] = {}
		c.p_local_points[j] = {}
	}
	for j in 0 ..< point_count {
		cp := &m.points[j]
		vcp := &c.v_points[j]
		if step.warm_starting {
			vcp.normal_impulse = step.dt_ratio * cp.normal_impulse
			vcp.tangent_impulse = step.dt_ratio * cp.tangent_impulse
		}
		c.p_local_points[j] = cp.local_point
	}
}

@(private)
xf_from_center :: #force_inline proc(local_center: Vec2, c: Vec2, a: f64) -> Transform {
	xf: Transform
	xf.q = rot_from_angle(a)
	r := rot_vec(xf.q, local_center)
	xf.p = {c.x - r.x, c.y - r.y}
	return xf
}

contact_solve_position_constraint :: proc(c: ^Contact, step: ^Time_Step, toiA: ^Body, toiB: ^Body) -> f64 {
	toi := toiA != nil && toiB != nil
	min_separation := 0.0
	bodyA := c.fixtureA.body
	bodyB := c.fixtureB.body
	positionA := &bodyA.c_position
	positionB := &bodyB.c_position
	mA, iA := 0.0, 0.0
	if !toi || bodyA == toiA || bodyA == toiB {
		mA = c.p_inv_massA
		iA = c.p_inv_IA
	}
	mB, iB := 0.0, 0.0
	if !toi || bodyB == toiA || bodyB == toiB {
		mB = c.p_inv_massB
		iB = c.p_inv_IB
	}
	cA := positionA.c
	aA := positionA.a
	cB := positionB.c
	aB := positionB.a
	for j in 0 ..< c.p_point_count {
		xfA := xf_from_center(c.p_local_centerA, cA, aA)
		xfB := xf_from_center(c.p_local_centerB, cB, aB)
		separation: f64
		normal, point: Vec2
		switch c.p_type {
		case .Circles:
			pointA := xf_vec(xfA, c.p_local_point)
			pointB := xf_vec(xfB, c.p_local_points[0])
			normal = normalize(pointB - pointA)
			point = combine2(0.5, pointA, 0.5, pointB)
			separation = dot(pointB, normal) - dot(pointA, normal) - c.p_radiusA - c.p_radiusB
		case .FaceA:
			normal = rot_vec(xfA.q, c.p_local_normal)
			plane_point := xf_vec(xfA, c.p_local_point)
			clip_point := xf_vec(xfB, c.p_local_points[j])
			separation = dot(clip_point, normal) - dot(plane_point, normal) - c.p_radiusA - c.p_radiusB
			point = clip_point
		case .FaceB:
			normal = rot_vec(xfB.q, c.p_local_normal)
			plane_point := xf_vec(xfB, c.p_local_point)
			clip_point := xf_vec(xfA, c.p_local_points[j])
			separation = dot(clip_point, normal) - dot(plane_point, normal) - c.p_radiusA - c.p_radiusB
			point = clip_point
			normal = {-normal.x, -normal.y}
		case .Unset:
			return min_separation
		}
		rA := point - cA
		rB := point - cB
		min_separation = min(min_separation, separation)
		baumgarte := toi ? TOI_BAUGARTE : BAUMGARTE
		C := clampf(baumgarte * (separation + LINEAR_SLOP), -MAX_LINEAR_CORRECTION, 0.0)
		rnA := cross(rA, normal)
		rnB := cross(rB, normal)
		K := mA + mB + iA * rnA * rnA + iB * rnB * rnB
		impulse := K > 0.0 ? -C / K : 0.0
		P := Vec2{impulse * normal.x, impulse * normal.y}
		cA.x -= mA * P.x
		cA.y -= mA * P.y
		aA -= iA * cross(rA, P)
		cB.x += mB * P.x
		cB.y += mB * P.y
		aB += iB * cross(rB, P)
	}
	positionA.c = cA
	positionA.a = aA
	positionB.c = cB
	positionB.a = aB
	return min_separation
}

contact_init_velocity_constraint :: proc(c: ^Contact, step: ^Time_Step) {
	bodyA := c.fixtureA.body
	bodyB := c.fixtureB.body
	velocityA := &bodyA.c_velocity
	velocityB := &bodyB.c_velocity
	positionA := &bodyA.c_position
	positionB := &bodyB.c_position
	radiusA := c.p_radiusA
	radiusB := c.p_radiusB
	m := &c.manifold
	mA := c.v_inv_massA
	mB := c.v_inv_massB
	iA := c.v_inv_IA
	iB := c.v_inv_IB
	cA := positionA.c
	aA := positionA.a
	vA := velocityA.v
	wA := velocityA.w
	cB := positionB.c
	aB := positionB.a
	vB := velocityB.v
	wB := velocityB.w
	xfA := xf_from_center(c.p_local_centerA, cA, aA)
	xfB := xf_from_center(c.p_local_centerB, cB, aB)
	wm: World_Manifold
	manifold_get_world(m, &wm, xfA, radiusA, xfB, radiusB)
	c.v_normal = wm.normal
	for j in 0 ..< c.v_point_count {
		vcp := &c.v_points[j]
		wmp := wm.points[j]
		vcp.rA = wmp - cA
		vcp.rB = wmp - cB
		rnA := cross(vcp.rA, c.v_normal)
		rnB := cross(vcp.rB, c.v_normal)
		k_normal := mA + mB + iA * rnA * rnA + iB * rnB * rnB
		vcp.normal_mass = k_normal > 0.0 ? 1.0 / k_normal : 0.0
		tangent := cross_vs(c.v_normal, 1.0)
		rtA := cross(vcp.rA, tangent)
		rtB := cross(vcp.rB, tangent)
		k_tangent := mA + mB + iA * rtA * rtA + iB * rtB * rtB
		vcp.tangent_mass = k_tangent > 0.0 ? 1.0 / k_tangent : 0.0
		vcp.velocity_bias = 0.0
		v_rel := 0.0
		v_rel += dot(c.v_normal, vB)
		v_rel += dot(c.v_normal, cross_sv(wB, vcp.rB))
		v_rel -= dot(c.v_normal, vA)
		v_rel -= dot(c.v_normal, cross_sv(wA, vcp.rA))
		if v_rel < -VELOCITY_THRESHOLD {
			vcp.velocity_bias = -c.v_restitution * v_rel
		}
	}
	if c.v_point_count == 2 && step.block_solve {
		vcp1 := &c.v_points[0]
		vcp2 := &c.v_points[1]
		rn1A := cross(vcp1.rA, c.v_normal)
		rn1B := cross(vcp1.rB, c.v_normal)
		rn2A := cross(vcp2.rA, c.v_normal)
		rn2B := cross(vcp2.rB, c.v_normal)
		k11 := mA + mB + iA * rn1A * rn1A + iB * rn1B * rn1B
		k22 := mA + mB + iA * rn2A * rn2A + iB * rn2B * rn2B
		k12 := mA + mB + iA * rn1A * rn2A + iB * rn1B * rn2B
		k_max_condition_number := 1000.0
		if k11 * k11 < k_max_condition_number * (k11 * k22 - k12 * k12) {
			c.v_K.ex = {k11, k12}
			c.v_K.ey = {k12, k22}
			a := c.v_K.ex.x
			b := c.v_K.ey.x
			cc := c.v_K.ex.y
			d := c.v_K.ey.y
			det := a * d - b * cc
			if det != 0.0 do det = 1.0 / det
			c.v_normal_mass.ex.x = det * d
			c.v_normal_mass.ey.x = -det * b
			c.v_normal_mass.ex.y = -det * cc
			c.v_normal_mass.ey.y = det * a
		} else {
			c.v_point_count = 1
		}
	}
	positionA.c = cA
	positionA.a = aA
	velocityA.v = vA
	velocityA.w = wA
	positionB.c = cB
	positionB.a = aB
	velocityB.v = vB
	velocityB.w = wB
}

contact_warm_start :: proc(c: ^Contact, step: ^Time_Step) {
	bodyA := c.fixtureA.body
	bodyB := c.fixtureB.body
	velocityA := &bodyA.c_velocity
	velocityB := &bodyB.c_velocity
	mA := c.v_inv_massA
	iA := c.v_inv_IA
	mB := c.v_inv_massB
	iB := c.v_inv_IB
	vA := velocityA.v
	wA := velocityA.w
	vB := velocityB.v
	wB := velocityB.w
	normal := c.v_normal
	tangent := cross_vs(normal, 1.0)
	for j in 0 ..< c.v_point_count {
		vcp := &c.v_points[j]
		P := combine2(vcp.normal_impulse, normal, vcp.tangent_impulse, tangent)
		wA -= iA * cross(vcp.rA, P)
		vA.x -= mA * P.x
		vA.y -= mA * P.y
		wB += iB * cross(vcp.rB, P)
		vB.x += mB * P.x
		vB.y += mB * P.y
	}
	velocityA.v = vA
	velocityA.w = wA
	velocityB.v = vB
	velocityB.w = wB
}

contact_store_impulses :: proc(c: ^Contact) {
	for j in 0 ..< c.v_point_count {
		c.manifold.points[j].normal_impulse = c.v_points[j].normal_impulse
		c.manifold.points[j].tangent_impulse = c.v_points[j].tangent_impulse
	}
}

@(private)
rel_vel :: #force_inline proc(vA: Vec2, wA: f64, rA: Vec2, vB: Vec2, wB: f64, rB: Vec2) -> Vec2 {
	// dv = vB + cross(wB, rB) - vA - cross(wA, rA), accumulated in planck's order
	dv := Vec2{0, 0}
	dv += vB
	dv += cross_sv(wB, rB)
	dv -= vA
	dv -= cross_sv(wA, rA)
	return dv
}

contact_solve_velocity_constraint :: proc(c: ^Contact, step: ^Time_Step) {
	bodyA := c.fixtureA.body
	bodyB := c.fixtureB.body
	velocityA := &bodyA.c_velocity
	velocityB := &bodyB.c_velocity
	mA := c.v_inv_massA
	iA := c.v_inv_IA
	mB := c.v_inv_massB
	iB := c.v_inv_IB
	vA := velocityA.v
	wA := velocityA.w
	vB := velocityB.v
	wB := velocityB.w
	normal := c.v_normal
	tangent := cross_vs(normal, 1.0)
	friction := c.v_friction
	for j in 0 ..< c.v_point_count {
		vcp := &c.v_points[j]
		dv := rel_vel(vA, wA, vcp.rA, vB, wB, vcp.rB)
		vt := dot(dv, tangent) - c.v_tangent_speed
		lambda := vcp.tangent_mass * -vt
		max_friction := friction * vcp.normal_impulse
		new_impulse := clampf(vcp.tangent_impulse + lambda, -max_friction, max_friction)
		lambda = new_impulse - vcp.tangent_impulse
		vcp.tangent_impulse = new_impulse
		P := Vec2{lambda * tangent.x, lambda * tangent.y}
		vA.x -= mA * P.x
		vA.y -= mA * P.y
		wA -= iA * cross(vcp.rA, P)
		vB.x += mB * P.x
		vB.y += mB * P.y
		wB += iB * cross(vcp.rB, P)
	}
	if c.v_point_count == 1 || !step.block_solve {
		for i in 0 ..< c.v_point_count {
			vcp := &c.v_points[i]
			dv := rel_vel(vA, wA, vcp.rA, vB, wB, vcp.rB)
			vn := dot(dv, normal)
			lambda := -vcp.normal_mass * (vn - vcp.velocity_bias)
			new_impulse := max(vcp.normal_impulse + lambda, 0.0)
			lambda = new_impulse - vcp.normal_impulse
			vcp.normal_impulse = new_impulse
			P := Vec2{lambda * normal.x, lambda * normal.y}
			vA.x -= mA * P.x
			vA.y -= mA * P.y
			wA -= iA * cross(vcp.rA, P)
			vB.x += mB * P.x
			vB.y += mB * P.y
			wB += iB * cross(vcp.rB, P)
		}
	} else {
		vcp1 := &c.v_points[0]
		vcp2 := &c.v_points[1]
		a := Vec2{vcp1.normal_impulse, vcp2.normal_impulse}
		dv1 := rel_vel(vA, wA, vcp1.rA, vB, wB, vcp1.rB)
		dv2 := rel_vel(vA, wA, vcp2.rA, vB, wB, vcp2.rB)
		vn1 := dot(dv1, normal)
		vn2 := dot(dv2, normal)
		b := Vec2{vn1 - vcp1.velocity_bias, vn2 - vcp2.velocity_bias}
		b.x -= c.v_K.ex.x * a.x + c.v_K.ey.x * a.y
		b.y -= c.v_K.ex.y * a.x + c.v_K.ey.y * a.y
		x: Vec2
		apply := false
		for {
			x.x = -(c.v_normal_mass.ex.x * b.x + c.v_normal_mass.ey.x * b.y)
			x.y = -(c.v_normal_mass.ex.y * b.x + c.v_normal_mass.ey.y * b.y)
			if x.x >= 0.0 && x.y >= 0.0 {
				apply = true
				break
			}
			x.x = -vcp1.normal_mass * b.x
			x.y = 0.0
			vn1 = 0.0
			vn2 = c.v_K.ex.y * x.x + b.y
			if x.x >= 0.0 && vn2 >= 0.0 {
				apply = true
				break
			}
			x.x = 0.0
			x.y = -vcp2.normal_mass * b.y
			vn1 = c.v_K.ey.x * x.y + b.x
			vn2 = 0.0
			if x.y >= 0.0 && vn1 >= 0.0 {
				apply = true
				break
			}
			x.x = 0.0
			x.y = 0.0
			vn1 = b.x
			vn2 = b.y
			if vn1 >= 0.0 && vn2 >= 0.0 {
				apply = true
				break
			}
			break
		}
		if apply {
			d := x - a
			P1 := Vec2{d.x * normal.x, d.x * normal.y}
			P2 := Vec2{d.y * normal.x, d.y * normal.y}
			// combine3Vec2(vA, -mA, P1, -mA, P2, 1, vA)
			vA = {-mA * P1.x + -mA * P2.x + 1 * vA.x, -mA * P1.y + -mA * P2.y + 1 * vA.y}
			wA -= iA * (cross(vcp1.rA, P1) + cross(vcp2.rA, P2))
			vB = {mB * P1.x + mB * P2.x + 1 * vB.x, mB * P1.y + mB * P2.y + 1 * vB.y}
			wB += iB * (cross(vcp1.rB, P1) + cross(vcp2.rB, P2))
			vcp1.normal_impulse = x.x
			vcp2.normal_impulse = x.y
		}
	}
	velocityA.v = vA
	velocityA.w = wA
	velocityB.v = vB
	velocityB.w = wB
}
