package physics

import "core:math"

Shape_Type :: enum u8 {
	Circle,
	Polygon,
}

Shape :: struct {
	type:     Shape_Type,
	radius:   f64,
	// circle
	p:        Vec2,
	// polygon
	centroid: Vec2,
	vertices: [MAX_POLYGON_VERTICES]Vec2,
	normals:  [MAX_POLYGON_VERTICES]Vec2,
	count:    int,
}

Mass_Data :: struct {
	mass:   f64,
	center: Vec2,
	I:      f64,
}

Ray_Cast_Input :: struct {
	p1, p2:       Vec2,
	max_fraction: f64,
}

Ray_Cast_Output :: struct {
	normal:   Vec2,
	fraction: f64,
}

make_circle :: proc(radius: f64, center: Vec2 = {0, 0}) -> Shape {
	return Shape{type = .Circle, radius = radius, p = center}
}

// planck `Box(hx, hy, center?)` (no angle is ever used here).
make_box :: proc(hx, hy: f64, center: Maybe(Vec2) = nil) -> Shape {
	s := Shape {
		type   = .Polygon,
		radius = POLYGON_RADIUS,
		count  = 4,
	}
	s.vertices[0] = {hx, -hy}
	s.vertices[1] = {hx, hy}
	s.vertices[2] = {-hx, hy}
	s.vertices[3] = {-hx, -hy}
	s.normals[0] = {1, 0}
	s.normals[1] = {0, 1}
	s.normals[2] = {-1, 0}
	s.normals[3] = {0, -1}
	if c, ok := center.?; ok {
		s.centroid = c
		xf := Transform {
			p = c,
			q = rot_from_angle(0),
		}
		for i in 0 ..< 4 {
			s.vertices[i] = xf_vec(xf, s.vertices[i])
			s.normals[i] = rot_vec(xf.q, s.normals[i])
		}
	}
	return s
}

shape_ray_cast :: proc(s: ^Shape, output: ^Ray_Cast_Output, input: Ray_Cast_Input, xf: Transform) -> bool {
	switch s.type {
	case .Circle:
		rp := rot_vec(xf.q, s.p)
		position := Vec2{xf.p.x + rp.x, xf.p.y + rp.y}
		sv := input.p1 - position
		b := dot(sv, sv) - s.radius * s.radius
		r := input.p2 - input.p1
		c := dot(sv, r)
		rr := dot(r, r)
		sigma := c * c - rr * b
		if sigma < 0.0 || rr < EPSILON do return false
		a := -(c + math.sqrt(sigma))
		if 0.0 <= a && a <= input.max_fraction * rr {
			a /= rr
			output.fraction = a
			output.normal = normalize(Vec2{sv.x + a * r.x, sv.y + a * r.y})
			return true
		}
		return false
	case .Polygon:
		p1 := derot_vec(xf.q, input.p1 - xf.p)
		p2 := derot_vec(xf.q, input.p2 - xf.p)
		d := p2 - p1
		lower := 0.0
		upper := input.max_fraction
		index := -1
		for i in 0 ..< s.count {
			numerator := dot(s.normals[i], s.vertices[i] - p1)
			denominator := dot(s.normals[i], d)
			if denominator == 0.0 {
				if numerator < 0.0 do return false
			} else {
				if denominator < 0.0 && numerator < lower * denominator {
					lower = numerator / denominator
					index = i
				} else if denominator > 0.0 && numerator < upper * denominator {
					upper = numerator / denominator
				}
			}
			if upper < lower do return false
		}
		if index >= 0 {
			output.fraction = lower
			output.normal = rot_vec(xf.q, s.normals[index])
			return true
		}
		return false
	}
	return false
}

shape_compute_aabb :: proc(s: ^Shape, xf: Transform) -> AABB {
	switch s.type {
	case .Circle:
		p := xf_vec(xf, s.p)
		return AABB{lower = {p.x - s.radius, p.y - s.radius}, upper = {p.x + s.radius, p.y + s.radius}}
	case .Polygon:
		min_x, min_y := INF, INF
		max_x, max_y := -INF, -INF
		for i in 0 ..< s.count {
			v := xf_vec(xf, s.vertices[i])
			min_x = min(min_x, v.x)
			max_x = max(max_x, v.x)
			min_y = min(min_y, v.y)
			max_y = max(max_y, v.y)
		}
		return AABB {
			lower = {min_x - s.radius, min_y - s.radius},
			upper = {max_x + s.radius, max_y + s.radius},
		}
	}
	return {}
}

shape_compute_mass :: proc(s: ^Shape, density: f64) -> Mass_Data {
	md: Mass_Data
	switch s.type {
	case .Circle:
		md.mass = density * math.PI * s.radius * s.radius
		md.center = s.p
		md.I = md.mass * (0.5 * s.radius * s.radius + length_sqr(s.p))
	case .Polygon:
		center := Vec2{0, 0}
		area := 0.0
		I := 0.0
		sv := Vec2{0, 0}
		for i in 0 ..< s.count {
			sv.x += s.vertices[i].x
			sv.y += s.vertices[i].y
		}
		inv := 1.0 / f64(s.count)
		sv = {inv * sv.x, inv * sv.y}
		k_inv3 := 1.0 / 3.0
		for i in 0 ..< s.count {
			e1 := s.vertices[i] - sv
			e2 := i + 1 < s.count ? s.vertices[i + 1] - sv : s.vertices[0] - sv
			D := cross(e1, e2)
			triangle_area := 0.5 * D
			area += triangle_area
			t := combine2(triangle_area * k_inv3, e1, triangle_area * k_inv3, e2)
			center.x += t.x
			center.y += t.y
			ex1, ey1 := e1.x, e1.y
			ex2, ey2 := e2.x, e2.y
			intx2 := ex1 * ex1 + ex2 * ex1 + ex2 * ex2
			inty2 := ey1 * ey1 + ey2 * ey1 + ey2 * ey2
			I += 0.25 * k_inv3 * D * (intx2 + inty2)
		}
		md.mass = density * area
		ia := 1.0 / area
		center = {ia * center.x, ia * center.y}
		md.center = {center.x + sv.x, center.y + sv.y}
		md.I = density * I
		md.I += md.mass * (dot(md.center, md.center) - dot(center, center))
	}
	return md
}

// --- Distance proxy ---------------------------------------------------------

Distance_Proxy :: struct {
	vertices: [MAX_POLYGON_VERTICES]Vec2,
	count:    int,
	radius:   f64,
}

proxy_set :: proc(p: ^Distance_Proxy, s: ^Shape) {
	switch s.type {
	case .Circle:
		p.vertices[0] = s.p
		p.count = 1
		p.radius = s.radius
	case .Polygon:
		for i in 0 ..< s.count do p.vertices[i] = s.vertices[i]
		p.count = s.count
		p.radius = s.radius
	}
}

proxy_get_support :: proc(p: ^Distance_Proxy, d: Vec2) -> int {
	best_index := -1
	best_value := -INF
	for i in 0 ..< p.count {
		value := dot(p.vertices[i], d)
		if value > best_value {
			best_index = i
			best_value = value
		}
	}
	return best_index
}
