package physics

import "core:math"

// GJK distance and conservative-advancement time of impact (planck Distance.ts,
// TimeOfImpact.ts).

Simplex_Cache :: struct {
	metric: f64,
	indexA: [3]int,
	indexB: [3]int,
	count:  int,
}

Distance_Input :: struct {
	proxyA, proxyB:         Distance_Proxy,
	transformA, transformB: Transform,
	use_radii:              bool,
}

Distance_Output :: struct {
	pointA, pointB: Vec2,
	distance:       f64,
	iterations:     int,
}

Simplex_Vertex :: struct {
	wA:     Vec2,
	indexA: int,
	wB:     Vec2,
	indexB: int,
	w:      Vec2,
	a:      f64,
}

Simplex :: struct {
	v:     [3]Simplex_Vertex,
	count: int,
}

simplex_read_cache :: proc(
	s: ^Simplex,
	cache: ^Simplex_Cache,
	proxyA: ^Distance_Proxy,
	xfA: Transform,
	proxyB: ^Distance_Proxy,
	xfB: Transform,
) {
	s.count = cache.count
	for i in 0 ..< s.count {
		v := &s.v[i]
		v.indexA = cache.indexA[i]
		v.indexB = cache.indexB[i]
		v.wA = xf_vec(xfA, proxyA.vertices[v.indexA])
		v.wB = xf_vec(xfB, proxyB.vertices[v.indexB])
		v.w = v.wB - v.wA
		v.a = 0.0
	}
	if s.count > 1 {
		metric1 := cache.metric
		metric2 := simplex_get_metric(s)
		if metric2 < 0.5 * metric1 || 2.0 * metric1 < metric2 || metric2 < EPSILON {
			s.count = 0
		}
	}
	if s.count == 0 {
		v := &s.v[0]
		v.indexA = 0
		v.indexB = 0
		v.wA = xf_vec(xfA, proxyA.vertices[0])
		v.wB = xf_vec(xfB, proxyB.vertices[0])
		v.w = v.wB - v.wA
		v.a = 1.0
		s.count = 1
	}
}

simplex_write_cache :: proc(s: ^Simplex, cache: ^Simplex_Cache) {
	cache.metric = simplex_get_metric(s)
	cache.count = s.count
	for i in 0 ..< s.count {
		cache.indexA[i] = s.v[i].indexA
		cache.indexB[i] = s.v[i].indexB
	}
}

simplex_get_search_direction :: proc(s: ^Simplex) -> Vec2 {
	v1 := &s.v[0]
	v2 := &s.v[1]
	switch s.count {
	case 1:
		return {-v1.w.x, -v1.w.y}
	case 2:
		e12 := v2.w - v1.w
		sgn := -cross(e12, v1.w)
		if sgn > 0.0 {
			return {-e12.y, e12.x}
		} else {
			return {e12.y, -e12.x}
		}
	}
	return {0, 0}
}

simplex_get_closest_point :: proc(s: ^Simplex) -> Vec2 {
	switch s.count {
	case 1:
		return s.v[0].w
	case 2:
		return combine2(s.v[0].a, s.v[0].w, s.v[1].a, s.v[1].w)
	}
	return {0, 0}
}

simplex_get_witness_points :: proc(s: ^Simplex) -> (pA, pB: Vec2) {
	v1 := &s.v[0]
	v2 := &s.v[1]
	v3 := &s.v[2]
	switch s.count {
	case 1:
		pA = v1.wA
		pB = v1.wB
	case 2:
		pA = combine2(v1.a, v1.wA, v2.a, v2.wA)
		pB = combine2(v1.a, v1.wB, v2.a, v2.wB)
	case 3:
		pA = {
			v1.a * v1.wA.x + v2.a * v2.wA.x + v3.a * v3.wA.x,
			v1.a * v1.wA.y + v2.a * v2.wA.y + v3.a * v3.wA.y,
		}
		pB = pA
	}
	return
}

simplex_get_metric :: proc(s: ^Simplex) -> f64 {
	switch s.count {
	case 2:
		return dist(s.v[0].w, s.v[1].w)
	case 3:
		return cross(s.v[1].w - s.v[0].w, s.v[2].w - s.v[0].w)
	}
	return 0.0
}

simplex_solve2 :: proc(s: ^Simplex) {
	w1 := s.v[0].w
	w2 := s.v[1].w
	e12 := w2 - w1
	d12_2 := -dot(w1, e12)
	if d12_2 <= 0.0 {
		s.v[0].a = 1.0
		s.count = 1
		return
	}
	d12_1 := dot(w2, e12)
	if d12_1 <= 0.0 {
		s.v[1].a = 1.0
		s.count = 1
		s.v[0] = s.v[1]
		return
	}
	inv_d12 := 1.0 / (d12_1 + d12_2)
	s.v[0].a = d12_1 * inv_d12
	s.v[1].a = d12_2 * inv_d12
	s.count = 2
}

simplex_solve3 :: proc(s: ^Simplex) {
	w1 := s.v[0].w
	w2 := s.v[1].w
	w3 := s.v[2].w
	e12 := w2 - w1
	w1e12 := dot(w1, e12)
	w2e12 := dot(w2, e12)
	d12_1 := w2e12
	d12_2 := -w1e12
	e13 := w3 - w1
	w1e13 := dot(w1, e13)
	w3e13 := dot(w3, e13)
	d13_1 := w3e13
	d13_2 := -w1e13
	e23 := w3 - w2
	w2e23 := dot(w2, e23)
	w3e23 := dot(w3, e23)
	d23_1 := w3e23
	d23_2 := -w2e23
	n123 := cross(e12, e13)
	d123_1 := n123 * cross(w2, w3)
	d123_2 := n123 * cross(w3, w1)
	d123_3 := n123 * cross(w1, w2)
	if d12_2 <= 0.0 && d13_2 <= 0.0 {
		s.v[0].a = 1.0
		s.count = 1
		return
	}
	if d12_1 > 0.0 && d12_2 > 0.0 && d123_3 <= 0.0 {
		inv := 1.0 / (d12_1 + d12_2)
		s.v[0].a = d12_1 * inv
		s.v[1].a = d12_2 * inv
		s.count = 2
		return
	}
	if d13_1 > 0.0 && d13_2 > 0.0 && d123_2 <= 0.0 {
		inv := 1.0 / (d13_1 + d13_2)
		s.v[0].a = d13_1 * inv
		s.v[2].a = d13_2 * inv
		s.count = 2
		s.v[1] = s.v[2]
		return
	}
	if d12_1 <= 0.0 && d23_2 <= 0.0 {
		s.v[1].a = 1.0
		s.count = 1
		s.v[0] = s.v[1]
		return
	}
	if d13_1 <= 0.0 && d23_1 <= 0.0 {
		s.v[2].a = 1.0
		s.count = 1
		s.v[0] = s.v[2]
		return
	}
	if d23_1 > 0.0 && d23_2 > 0.0 && d123_1 <= 0.0 {
		inv := 1.0 / (d23_1 + d23_2)
		s.v[1].a = d23_1 * inv
		s.v[2].a = d23_2 * inv
		s.count = 2
		s.v[0] = s.v[2]
		return
	}
	inv := 1.0 / (d123_1 + d123_2 + d123_3)
	s.v[0].a = d123_1 * inv
	s.v[1].a = d123_2 * inv
	s.v[2].a = d123_3 * inv
	s.count = 3
}

distance :: proc(output: ^Distance_Output, cache: ^Simplex_Cache, input: ^Distance_Input) {
	proxyA := &input.proxyA
	proxyB := &input.proxyB
	xfA := input.transformA
	xfB := input.transformB
	simplex: Simplex
	simplex_read_cache(&simplex, cache, proxyA, xfA, proxyB, xfB)
	saveA, saveB: [3]int
	save_count := 0
	iter := 0
	for iter < MAX_DISTANCE_ITERATIONS {
		save_count = simplex.count
		for i in 0 ..< save_count {
			saveA[i] = simplex.v[i].indexA
			saveB[i] = simplex.v[i].indexB
		}
		switch simplex.count {
		case 2:
			simplex_solve2(&simplex)
		case 3:
			simplex_solve3(&simplex)
		}
		if simplex.count == 3 do break
		d := simplex_get_search_direction(&simplex)
		if length_sqr(d) < EPSILON * EPSILON do break
		vertex := &simplex.v[simplex.count]
		vertex.indexA = proxy_get_support(proxyA, derot_vec(xfA.q, Vec2{-d.x, -d.y}))
		vertex.wA = xf_vec(xfA, proxyA.vertices[vertex.indexA])
		vertex.indexB = proxy_get_support(proxyB, derot_vec(xfB.q, d))
		vertex.wB = xf_vec(xfB, proxyB.vertices[vertex.indexB])
		vertex.w = vertex.wB - vertex.wA
		iter += 1
		duplicate := false
		for i in 0 ..< save_count {
			if vertex.indexA == saveA[i] && vertex.indexB == saveB[i] {
				duplicate = true
				break
			}
		}
		if duplicate do break
		simplex.count += 1
	}
	output.pointA, output.pointB = simplex_get_witness_points(&simplex)
	output.distance = dist(output.pointA, output.pointB)
	output.iterations = iter
	simplex_write_cache(&simplex, cache)
	if input.use_radii {
		rA := proxyA.radius
		rB := proxyB.radius
		if output.distance > rA + rB && output.distance > EPSILON {
			output.distance -= rA + rB
			normal := normalize(output.pointB - output.pointA)
			output.pointA += Vec2{rA * normal.x, rA * normal.y}
			output.pointB -= Vec2{rB * normal.x, rB * normal.y}
		} else {
			p := output.pointA - output.pointB
			output.pointA = p
			output.pointB = p
			output.distance = 0.0
		}
	}
}

test_overlap :: proc(shapeA: ^Shape, shapeB: ^Shape, xfA, xfB: Transform) -> bool {
	input: Distance_Input
	proxy_set(&input.proxyA, shapeA)
	proxy_set(&input.proxyB, shapeB)
	input.transformA = xfA
	input.transformB = xfB
	input.use_radii = true
	cache: Simplex_Cache
	output: Distance_Output
	distance(&output, &cache, &input)
	return output.distance < 10.0 * EPSILON
}

// --- Time of impact ---------------------------------------------------------

TOI_State :: enum {
	Unset,
	Unknown,
	Failed,
	Overlapped,
	Touching,
	Separated,
}

TOI_Input :: struct {
	proxyA, proxyB: Distance_Proxy,
	sweepA, sweepB: Sweep,
	t_max:          f64,
}

TOI_Output :: struct {
	state: TOI_State,
	t:     f64,
}

Sep_Type :: enum {
	Unset,
	Points,
	FaceA,
	FaceB,
}

Separation_Function :: struct {
	proxyA, proxyB: ^Distance_Proxy,
	sweepA, sweepB: ^Sweep,
	type:           Sep_Type,
	local_point:    Vec2,
	axis:           Vec2,
	indexA, indexB: int,
}

sep_initialize :: proc(
	f: ^Separation_Function,
	cache: ^Simplex_Cache,
	proxyA: ^Distance_Proxy,
	sweepA: ^Sweep,
	proxyB: ^Distance_Proxy,
	sweepB: ^Sweep,
	t1: f64,
) {
	count := cache.count
	f.proxyA = proxyA
	f.proxyB = proxyB
	f.sweepA = sweepA
	f.sweepB = sweepB
	xfA := sweep_get_transform(sweepA, t1)
	xfB := sweep_get_transform(sweepB, t1)
	if count == 1 {
		f.type = .Points
		pointA := xf_vec(xfA, proxyA.vertices[cache.indexA[0]])
		pointB := xf_vec(xfB, proxyB.vertices[cache.indexB[0]])
		f.axis = pointB - pointA
		normalize_length(&f.axis)
	} else if cache.indexA[0] == cache.indexA[1] {
		f.type = .FaceB
		lb1 := proxyB.vertices[cache.indexB[0]]
		lb2 := proxyB.vertices[cache.indexB[1]]
		f.axis = normalize(cross_vs(lb2 - lb1, 1.0))
		normal := rot_vec(xfB.q, f.axis)
		f.local_point = combine2(0.5, lb1, 0.5, lb2)
		pointB := xf_vec(xfB, f.local_point)
		pointA := xf_vec(xfA, proxyA.vertices[cache.indexA[0]])
		s := dot(pointA, normal) - dot(pointB, normal)
		if s < 0.0 {
			f.axis = {-f.axis.x, -f.axis.y}
		}
	} else {
		f.type = .FaceA
		la1 := proxyA.vertices[cache.indexA[0]]
		la2 := proxyA.vertices[cache.indexA[1]]
		f.axis = normalize(cross_vs(la2 - la1, 1.0))
		normal := rot_vec(xfA.q, f.axis)
		f.local_point = combine2(0.5, la1, 0.5, la2)
		pointA := xf_vec(xfA, f.local_point)
		pointB := xf_vec(xfB, proxyB.vertices[cache.indexB[0]])
		s := dot(pointB, normal) - dot(pointA, normal)
		if s < 0.0 {
			f.axis = {-f.axis.x, -f.axis.y}
		}
	}
}

sep_compute :: proc(f: ^Separation_Function, find: bool, t: f64) -> f64 {
	xfA := sweep_get_transform(f.sweepA, t)
	xfB := sweep_get_transform(f.sweepB, t)
	switch f.type {
	case .Points:
		if find {
			axisA := derot_vec(xfA.q, f.axis)
			axisB := derot_vec(xfB.q, Vec2{-f.axis.x, -f.axis.y})
			f.indexA = proxy_get_support(f.proxyA, axisA)
			f.indexB = proxy_get_support(f.proxyB, axisB)
		}
		pointA := xf_vec(xfA, f.proxyA.vertices[f.indexA])
		pointB := xf_vec(xfB, f.proxyB.vertices[f.indexB])
		return dot(pointB, f.axis) - dot(pointA, f.axis)
	case .FaceA:
		normal := rot_vec(xfA.q, f.axis)
		pointA := xf_vec(xfA, f.local_point)
		if find {
			axisB := derot_vec(xfB.q, Vec2{-normal.x, -normal.y})
			f.indexA = -1
			f.indexB = proxy_get_support(f.proxyB, axisB)
		}
		pointB := xf_vec(xfB, f.proxyB.vertices[f.indexB])
		return dot(pointB, normal) - dot(pointA, normal)
	case .FaceB:
		normal := rot_vec(xfB.q, f.axis)
		pointB := xf_vec(xfB, f.local_point)
		if find {
			axisA := derot_vec(xfA.q, Vec2{-normal.x, -normal.y})
			f.indexB = -1
			f.indexA = proxy_get_support(f.proxyA, axisA)
		}
		pointA := xf_vec(xfA, f.proxyA.vertices[f.indexA])
		return dot(pointA, normal) - dot(pointB, normal)
	case .Unset:
		if find {
			f.indexA = -1
			f.indexB = -1
		}
	}
	return 0.0
}

time_of_impact :: proc(output: ^TOI_Output, input: ^TOI_Input) {
	output.state = .Unknown
	output.t = input.t_max
	proxyA := &input.proxyA
	proxyB := &input.proxyB
	sweepA := &input.sweepA
	sweepB := &input.sweepB
	sweep_normalize(sweepA)
	sweep_normalize(sweepB)
	t_max := input.t_max
	total_radius := proxyA.radius + proxyB.radius
	target := max(LINEAR_SLOP, total_radius - 3.0 * LINEAR_SLOP)
	tolerance := 0.25 * LINEAR_SLOP
	t1 := 0.0
	iter := 0
	cache: Simplex_Cache
	dinput: Distance_Input
	dinput.proxyA = proxyA^
	dinput.proxyB = proxyB^
	dinput.use_radii = false
	doutput: Distance_Output
	fn: Separation_Function
	for {
		dinput.transformA = sweep_get_transform(sweepA, t1)
		dinput.transformB = sweep_get_transform(sweepB, t1)
		distance(&doutput, &cache, &dinput)
		if doutput.distance <= 0.0 {
			output.state = .Overlapped
			output.t = 0.0
			break
		}
		if doutput.distance < target + tolerance {
			output.state = .Touching
			output.t = t1
			break
		}
		sep_initialize(&fn, &cache, proxyA, sweepA, proxyB, sweepB, t1)
		done := false
		t2 := t_max
		push_back_iter := 0
		for {
			s2 := sep_compute(&fn, true, t2)
			if s2 > target + tolerance {
				output.state = .Separated
				output.t = t_max
				done = true
				break
			}
			if s2 > target - tolerance {
				t1 = t2
				break
			}
			s1 := sep_compute(&fn, false, t1)
			if s1 < target - tolerance {
				output.state = .Failed
				output.t = t1
				done = true
				break
			}
			if s1 <= target + tolerance {
				output.state = .Touching
				output.t = t1
				done = true
				break
			}
			root_iter := 0
			a1 := t1
			a2 := t2
			for {
				t: f64
				if root_iter & 1 != 0 {
					t = a1 + ((target - s1) * (a2 - a1)) / (s2 - s1)
				} else {
					t = 0.5 * (a1 + a2)
				}
				root_iter += 1
				s := sep_compute(&fn, false, t)
				if math.abs(s - target) < tolerance {
					t2 = t
					break
				}
				if s > target {
					a1 = t
					s1 = s
				} else {
					a2 = t
					s2 = s
				}
				if root_iter == 50 do break
			}
			push_back_iter += 1
			if push_back_iter == MAX_POLYGON_VERTICES do break
		}
		iter += 1
		if done do break
		if iter == MAX_TOI_ITERATIONS {
			output.state = .Failed
			output.t = t1
			break
		}
	}
}
