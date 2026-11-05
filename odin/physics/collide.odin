package physics

import "core:math"

Manifold_Type :: enum i8 {
	Unset  = -1,
	Circles = 0,
	FaceA  = 1,
	FaceB  = 2,
}

FEATURE_UNSET :: -1
FEATURE_VERTEX :: 0
FEATURE_FACE :: 1

Contact_ID :: struct {
	key:          int,
	indexA:       int,
	indexB:       int,
	typeA, typeB: int,
}

id_set_features :: #force_inline proc(id: ^Contact_ID, ia, ta, ib, tb: int) {
	id.indexA = ia
	id.indexB = ib
	id.typeA = ta
	id.typeB = tb
	id.key = ia + ib * 4 + ta * 16 + tb * 64
}

id_swap :: proc(id: ^Contact_ID) {
	id_set_features(id, id.indexB, id.typeB, id.indexA, id.typeA)
}

id_recycle :: proc(id: ^Contact_ID) {
	id^ = Contact_ID {
		key   = -1,
		typeA = FEATURE_UNSET,
		typeB = FEATURE_UNSET,
	}
}

Manifold_Point :: struct {
	local_point:     Vec2,
	normal_impulse:  f64,
	tangent_impulse: f64,
	id:              Contact_ID,
}

Manifold :: struct {
	type:         Manifold_Type,
	local_normal: Vec2,
	local_point:  Vec2,
	points:       [2]Manifold_Point,
	point_count:  int,
}

manifold_recycle :: proc(m: ^Manifold) {
	m.type = .Unset
	m.local_normal = {}
	m.local_point = {}
	m.point_count = 0
	for &p in m.points {
		p.local_point = {}
		p.normal_impulse = 0
		p.tangent_impulse = 0
		id_recycle(&p.id)
	}
}

World_Manifold :: struct {
	normal:      Vec2,
	points:      [2]Vec2,
	separations: [2]f64,
	point_count: int,
}

manifold_get_world :: proc(m: ^Manifold, wm: ^World_Manifold, xfA: Transform, radiusA: f64, xfB: Transform, radiusB: f64) {
	if m.point_count == 0 do return
	wm.point_count = m.point_count
	switch m.type {
	case .Circles:
		wm.normal = {1.0, 0.0}
		pointA := xf_vec(xfA, m.local_point)
		pointB := xf_vec(xfB, m.points[0].local_point)
		d := pointB - pointA
		lsq := length_sqr(d)
		if lsq > EPSILON * EPSILON {
			l := math.sqrt(lsq)
			wm.normal = {(1 / l) * d.x, (1 / l) * d.y}
		}
		cA := combine2(1, pointA, radiusA, wm.normal)
		cB := combine2(1, pointB, -radiusB, wm.normal)
		wm.points[0] = combine2(0.5, cA, 0.5, cB)
		wm.separations[0] = dot(cB - cA, wm.normal)
	case .FaceA:
		wm.normal = rot_vec(xfA.q, m.local_normal)
		plane_point := xf_vec(xfA, m.local_point)
		for i in 0 ..< m.point_count {
			clip := xf_vec(xfB, m.points[i].local_point)
			cA := combine2(1, clip, radiusA - dot(clip - plane_point, wm.normal), wm.normal)
			cB := combine2(1, clip, -radiusB, wm.normal)
			wm.points[i] = combine2(0.5, cA, 0.5, cB)
			wm.separations[i] = dot(cB - cA, wm.normal)
		}
	case .FaceB:
		wm.normal = rot_vec(xfB.q, m.local_normal)
		plane_point := xf_vec(xfB, m.local_point)
		for i in 0 ..< m.point_count {
			clip := xf_vec(xfA, m.points[i].local_point)
			cB := combine2(1, clip, radiusB - dot(clip - plane_point, wm.normal), wm.normal)
			cA := combine2(1, clip, -radiusA, wm.normal)
			wm.points[i] = combine2(0.5, cA, 0.5, cB)
			wm.separations[i] = dot(cA - cB, wm.normal)
		}
		wm.normal = {-wm.normal.x, -wm.normal.y}
	case .Unset:
	}
}

Clip_Vertex :: struct {
	v:  Vec2,
	id: Contact_ID,
}

clip_segment_to_line :: proc(vOut: ^[2]Clip_Vertex, vIn: ^[2]Clip_Vertex, normal: Vec2, offset: f64, vertex_index_a: int) -> int {
	num_out := 0
	distance0 := dot(normal, vIn[0].v) - offset
	distance1 := dot(normal, vIn[1].v) - offset
	if distance0 <= 0.0 {
		vOut[num_out] = vIn[0]
		num_out += 1
	}
	if distance1 <= 0.0 {
		vOut[num_out] = vIn[1]
		num_out += 1
	}
	if distance0 * distance1 < 0.0 {
		interp := distance0 / (distance0 - distance1)
		vOut[num_out].v = combine2(1 - interp, vIn[0].v, interp, vIn[1].v)
		id_set_features(&vOut[num_out].id, vertex_index_a, FEATURE_VERTEX, vIn[0].id.indexB, FEATURE_FACE)
		num_out += 1
	}
	return num_out
}

collide_circles :: proc(m: ^Manifold, a: ^Shape, xfA: Transform, b: ^Shape, xfB: Transform) {
	m.point_count = 0
	pA := xf_vec(xfA, a.p)
	pB := xf_vec(xfB, b.p)
	dsq := dist_sqr(pB, pA)
	radius := a.radius + b.radius
	if dsq > radius * radius do return
	m.type = .Circles
	m.local_point = a.p
	m.local_normal = {}
	m.point_count = 1
	m.points[0].local_point = b.p
	id_set_features(&m.points[0].id, 0, FEATURE_VERTEX, 0, FEATURE_VERTEX)
}

collide_polygon_circle :: proc(m: ^Manifold, poly: ^Shape, xfA: Transform, circle: ^Shape, xfB: Transform) {
	m.point_count = 0
	c_local := rexf_vec(xfB, xfA, circle.p)
	normal_index := 0
	separation := -INF
	radius := poly.radius + circle.radius
	vertex_count := poly.count
	for i in 0 ..< vertex_count {
		s := dot(poly.normals[i], c_local) - dot(poly.normals[i], poly.vertices[i])
		if s > radius do return
		if s > separation {
			separation = s
			normal_index = i
		}
	}
	vi1 := normal_index
	vi2 := vi1 + 1 < vertex_count ? vi1 + 1 : 0
	v1 := poly.vertices[vi1]
	v2 := poly.vertices[vi2]
	if separation < EPSILON {
		m.point_count = 1
		m.type = .FaceA
		m.local_normal = poly.normals[normal_index]
		m.local_point = combine2(0.5, v1, 0.5, v2)
		m.points[0].local_point = circle.p
		id_set_features(&m.points[0].id, 0, FEATURE_VERTEX, 0, FEATURE_VERTEX)
		return
	}
	u1 := dot(c_local, v2) - dot(c_local, v1) - dot(v1, v2) + dot(v1, v1)
	u2 := dot(c_local, v1) - dot(c_local, v2) - dot(v2, v1) + dot(v2, v2)
	if u1 <= 0.0 {
		if dist_sqr(c_local, v1) > radius * radius do return
		m.point_count = 1
		m.type = .FaceA
		m.local_normal = normalize(c_local - v1)
		m.local_point = v1
		m.points[0].local_point = circle.p
		id_set_features(&m.points[0].id, 0, FEATURE_VERTEX, 0, FEATURE_VERTEX)
	} else if u2 <= 0.0 {
		if dist_sqr(c_local, v2) > radius * radius do return
		m.point_count = 1
		m.type = .FaceA
		m.local_normal = normalize(c_local - v2)
		m.local_point = v2
		m.points[0].local_point = circle.p
		id_set_features(&m.points[0].id, 0, FEATURE_VERTEX, 0, FEATURE_VERTEX)
	} else {
		face_center := combine2(0.5, v1, 0.5, v2)
		sep := dot(c_local, poly.normals[vi1]) - dot(face_center, poly.normals[vi1])
		if sep > radius do return
		m.point_count = 1
		m.type = .FaceA
		m.local_normal = poly.normals[vi1]
		m.local_point = face_center
		m.points[0].local_point = circle.p
		id_set_features(&m.points[0].id, 0, FEATURE_VERTEX, 0, FEATURE_VERTEX)
	}
}

@(private)
find_max_separation :: proc(poly1: ^Shape, xf1: Transform, poly2: ^Shape, xf2: Transform) -> (f64, int) {
	xf := dexf_xf(xf2, xf1)
	best_index := 0
	max_sep := -INF
	for i in 0 ..< poly1.count {
		n := rot_vec(xf.q, poly1.normals[i])
		v1 := xf_vec(xf, poly1.vertices[i])
		si := INF
		for j in 0 ..< poly2.count {
			sij := dot(n, poly2.vertices[j]) - dot(n, v1)
			if sij < si do si = sij
		}
		if si > max_sep {
			max_sep = si
			best_index = i
		}
	}
	return max_sep, best_index
}

@(private)
find_incident_edge :: proc(cv: ^[2]Clip_Vertex, poly1: ^Shape, xf1: Transform, edge1: int, poly2: ^Shape, xf2: Transform) {
	normal1 := rerot_vec(xf2.q, xf1.q, poly1.normals[edge1])
	index := 0
	min_dot := INF
	for i in 0 ..< poly2.count {
		d := dot(normal1, poly2.normals[i])
		if d < min_dot {
			min_dot = d
			index = i
		}
	}
	i1 := index
	i2 := i1 + 1 < poly2.count ? i1 + 1 : 0
	cv[0].v = xf_vec(xf2, poly2.vertices[i1])
	id_set_features(&cv[0].id, edge1, FEATURE_FACE, i1, FEATURE_VERTEX)
	cv[1].v = xf_vec(xf2, poly2.vertices[i2])
	id_set_features(&cv[1].id, edge1, FEATURE_FACE, i2, FEATURE_VERTEX)
}

collide_polygons :: proc(m: ^Manifold, polyA: ^Shape, xfA: Transform, polyB: ^Shape, xfB: Transform) {
	m.point_count = 0
	total_radius := polyA.radius + polyB.radius
	separationA, edgeA := find_max_separation(polyA, xfA, polyB, xfB)
	if separationA > total_radius do return
	separationB, edgeB := find_max_separation(polyB, xfB, polyA, xfA)
	if separationB > total_radius do return
	poly1, poly2: ^Shape
	xf1, xf2: Transform
	edge1: int
	flip: bool
	k_tol := 0.1 * LINEAR_SLOP
	if separationB > separationA + k_tol {
		poly1 = polyB
		poly2 = polyA
		xf1 = xfB
		xf2 = xfA
		edge1 = edgeB
		m.type = .FaceB
		flip = true
	} else {
		poly1 = polyA
		poly2 = polyB
		xf1 = xfA
		xf2 = xfB
		edge1 = edgeA
		m.type = .FaceA
		flip = false
	}
	incident: [2]Clip_Vertex
	id_recycle(&incident[0].id)
	id_recycle(&incident[1].id)
	find_incident_edge(&incident, poly1, xf1, edge1, poly2, xf2)
	count1 := poly1.count
	iv1 := edge1
	iv2 := edge1 + 1 < count1 ? edge1 + 1 : 0
	v11 := poly1.vertices[iv1]
	v12 := poly1.vertices[iv2]
	local_tangent := normalize(v12 - v11)
	local_normal := cross_vs(local_tangent, 1.0)
	plane_point := combine2(0.5, v11, 0.5, v12)
	tangent := rot_vec(xf1.q, local_tangent)
	normal := cross_vs(tangent, 1.0)
	v11 = xf_vec(xf1, v11)
	v12 = xf_vec(xf1, v12)
	front_offset := dot(normal, v11)
	side_offset1 := -dot(tangent, v11) + total_radius
	side_offset2 := dot(tangent, v12) + total_radius
	clip1, clip2: [2]Clip_Vertex
	for i in 0 ..< 2 {
		id_recycle(&clip1[i].id)
		id_recycle(&clip2[i].id)
	}
	np1 := clip_segment_to_line(&clip1, &incident, Vec2{-tangent.x, -tangent.y}, side_offset1, iv1)
	if np1 < 2 do return
	np2 := clip_segment_to_line(&clip2, &clip1, tangent, side_offset2, iv2)
	if np2 < 2 do return
	m.local_normal = local_normal
	m.local_point = plane_point
	point_count := 0
	for i in 0 ..< 2 {
		sep := dot(normal, clip2[i].v) - front_offset
		if sep <= total_radius {
			cp := &m.points[point_count]
			cp.local_point = dexf_vec(xf2, clip2[i].v)
			cp.id = clip2[i].id
			if flip do id_swap(&cp.id)
			point_count += 1
		}
	}
	m.point_count = point_count
}
