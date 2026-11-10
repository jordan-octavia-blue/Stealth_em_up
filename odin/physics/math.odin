// A hand port of the subset of planck.js (Box2D v2.4) that Stealth em Up uses.
//
// Everything here mirrors planck's code path for path, including its linked-list
// orders, so that bodies push, slide and settle exactly the way they do in the web
// build. All maths is f64, like JavaScript numbers.
package physics

import "core:math"
import "core:c/libc"

Vec2 :: [2]f64

Rot :: struct {
	s, c: f64,
}

Transform :: struct {
	p: Vec2,
	q: Rot,
}

EPSILON :: 1e-9

// Settings (planck defaults).
LINEAR_SLOP :: 0.005
LINEAR_SLOP_SQUARED :: LINEAR_SLOP * LINEAR_SLOP
POLYGON_RADIUS :: 2.0 * LINEAR_SLOP
AABB_EXTENSION :: 0.1
AABB_MULTIPLIER :: 2.0
MAX_MANIFOLD_POINTS :: 2
MAX_POLYGON_VERTICES :: 12
MAX_SUB_STEPS :: 8
MAX_TOI_ITERATIONS :: 20
MAX_DISTANCE_ITERATIONS :: 20
VELOCITY_THRESHOLD :: 1.0
MAX_LINEAR_CORRECTION :: 0.2
MAX_TRANSLATION :: 2.0
MAX_TRANSLATION_SQUARED :: MAX_TRANSLATION * MAX_TRANSLATION
MAX_ROTATION :: 0.5 * math.PI
MAX_ROTATION_SQUARED :: MAX_ROTATION * MAX_ROTATION
BAUMGARTE :: 0.2
TOI_BAUGARTE :: 0.75
TIME_TO_SLEEP :: 0.5
LINEAR_SLEEP_TOLERANCE :: 0.01
ANGULAR_SLEEP_TOLERANCE :: (2.0 / 180.0) * math.PI
LINEAR_SLEEP_TOLERANCE_SQR :: LINEAR_SLEEP_TOLERANCE * LINEAR_SLEEP_TOLERANCE
ANGULAR_SLEEP_TOLERANCE_SQR :: ANGULAR_SLEEP_TOLERANCE * ANGULAR_SLEEP_TOLERANCE

INF :: math.INF_F64

rot_from_angle :: #force_inline proc(a: f64) -> Rot {
	return Rot{s = math.sin(a), c = math.cos(a)}
}

rot_get_angle :: #force_inline proc(q: Rot) -> f64 {
	return math.atan2(q.s, q.c)
}

dot :: #force_inline proc(a, b: Vec2) -> f64 {return a.x * b.x + a.y * b.y}
cross :: #force_inline proc(a, b: Vec2) -> f64 {return a.x * b.y - a.y * b.x}
// crossVec2Num(v, w) = (w*v.y, -w*v.x)
cross_vs :: #force_inline proc(v: Vec2, w: f64) -> Vec2 {return {w * v.y, -w * v.x}}
// crossNumVec2(w, v) = (-w*v.y, w*v.x)
cross_sv :: #force_inline proc(w: f64, v: Vec2) -> Vec2 {return {-w * v.y, w * v.x}}
length_sqr :: #force_inline proc(v: Vec2) -> f64 {return v.x * v.x + v.y * v.y}
length :: #force_inline proc(v: Vec2) -> f64 {return math.sqrt(v.x * v.x + v.y * v.y)}
dist :: #force_inline proc(a, b: Vec2) -> f64 {
	dx := b.x - a.x
	dy := b.y - a.y
	return math.sqrt(dx * dx + dy * dy)
}
dist_sqr :: #force_inline proc(a, b: Vec2) -> f64 {
	dx := b.x - a.x
	dy := b.y - a.y
	return dx * dx + dy * dy
}
combine2 :: #force_inline proc(am: f64, a: Vec2, bm: f64, b: Vec2) -> Vec2 {
	return {am * a.x + bm * b.x, am * a.y + bm * b.y}
}

normalize :: #force_inline proc(v: Vec2) -> Vec2 {
	l := math.sqrt(v.x * v.x + v.y * v.y)
	if l > 0 {
		inv := 1 / l
		return {v.x * inv, v.y * inv}
	}
	return v
}

normalize_length :: #force_inline proc(v: ^Vec2) -> f64 {
	l := math.sqrt(v.x * v.x + v.y * v.y)
	if l != 0 {
		inv := 1 / l
		v.x *= inv
		v.y *= inv
	}
	return l
}

rot_vec :: #force_inline proc(q: Rot, v: Vec2) -> Vec2 {
	return {q.c * v.x - q.s * v.y, q.s * v.x + q.c * v.y}
}

derot_vec :: #force_inline proc(q: Rot, v: Vec2) -> Vec2 {
	return {q.c * v.x + q.s * v.y, -q.s * v.x + q.c * v.y}
}

rerot_vec :: #force_inline proc(before, after: Rot, v: Vec2) -> Vec2 {
	x0 := before.c * v.x + before.s * v.y
	y0 := -before.s * v.x + before.c * v.y
	return {after.c * x0 - after.s * y0, after.s * x0 + after.c * y0}
}

xf_vec :: #force_inline proc(xf: Transform, v: Vec2) -> Vec2 {
	return {xf.q.c * v.x - xf.q.s * v.y + xf.p.x, xf.q.s * v.x + xf.q.c * v.y + xf.p.y}
}

dexf_vec :: #force_inline proc(xf: Transform, v: Vec2) -> Vec2 {
	px := v.x - xf.p.x
	py := v.y - xf.p.y
	return {xf.q.c * px + xf.q.s * py, -xf.q.s * px + xf.q.c * py}
}

rexf_vec :: #force_inline proc(from, to: Transform, v: Vec2) -> Vec2 {
	x0 := from.q.c * v.x - from.q.s * v.y + from.p.x
	y0 := from.q.s * v.x + from.q.c * v.y + from.p.y
	px := x0 - to.p.x
	py := y0 - to.p.y
	return {to.q.c * px + to.q.s * py, -to.q.s * px + to.q.c * py}
}

// detransformTransform(a, b) = a^-1 * b
dexf_xf :: #force_inline proc(a, b: Transform) -> Transform {
	c := a.q.c * b.q.c + a.q.s * b.q.s
	s := a.q.c * b.q.s - a.q.s * b.q.c
	x := a.q.c * (b.p.x - a.p.x) + a.q.s * (b.p.y - a.p.y)
	y := -a.q.s * (b.p.x - a.p.x) + a.q.c * (b.p.y - a.p.y)
	return Transform{p = {x, y}, q = {s = s, c = c}}
}

clampf :: #force_inline proc(n, lo, hi: f64) -> f64 {
	if n < lo do return lo
	if n > hi do return hi
	return n
}

// planck's `mod(num, min, max)` (JavaScript `%` is fmod, sign of the dividend).
js_mod_range :: proc(num, lo, hi: f64) -> f64 {
	if hi > lo {
		n := libc.fmod(num - lo, hi - lo)
		return n + (n < 0 ? hi : lo)
	} else {
		n := libc.fmod(num - hi, lo - hi)
		return n + (n <= 0 ? lo : hi)
	}
}

// --- AABB -------------------------------------------------------------------

AABB :: struct {
	lower, upper: Vec2,
}

aabb_overlap :: #force_inline proc(a, b: AABB) -> bool {
	d1x := b.lower.x - a.upper.x
	d2x := a.lower.x - b.upper.x
	d1y := b.lower.y - a.upper.y
	d2y := a.lower.y - b.upper.y
	if d1x > 0 || d1y > 0 || d2x > 0 || d2y > 0 do return false
	return true
}

aabb_contains :: #force_inline proc(a, b: AABB) -> bool {
	return a.lower.x <= b.lower.x && a.lower.y <= b.lower.y && b.upper.x <= a.upper.x && b.upper.y <= a.upper.y
}

aabb_combine :: #force_inline proc(a, b: AABB) -> AABB {
	return AABB {
		lower = {min(a.lower.x, b.lower.x), min(a.lower.y, b.lower.y)},
		upper = {max(a.upper.x, b.upper.x), max(a.upper.y, b.upper.y)},
	}
}

aabb_perimeter :: #force_inline proc(a: AABB) -> f64 {
	return 2.0 * (a.upper.x - a.lower.x + a.upper.y - a.lower.y)
}

aabb_combined_perimeter :: #force_inline proc(a, b: AABB) -> f64 {
	lx := min(a.lower.x, b.lower.x)
	ly := min(a.lower.y, b.lower.y)
	ux := max(a.upper.x, b.upper.x)
	uy := max(a.upper.y, b.upper.y)
	return 2.0 * (ux - lx + uy - ly)
}

aabb_extend :: #force_inline proc(a: ^AABB, v: f64) {
	a.lower.x -= v
	a.lower.y -= v
	a.upper.x += v
	a.upper.y += v
}

// --- Sweep ------------------------------------------------------------------

Sweep :: struct {
	local_center: Vec2,
	c:            Vec2,
	a:            f64,
	alpha0:       f64,
	c0:           Vec2,
	a0:           f64,
}

sweep_set_transform :: proc(s: ^Sweep, xf: Transform) {
	t := xf_vec(xf, s.local_center)
	s.c = t
	s.c0 = t
	s.a = math.atan2(xf.q.s, xf.q.c)
	s.a0 = s.a
}

sweep_set_local_center :: proc(s: ^Sweep, lc: Vec2, xf: Transform) {
	s.local_center = lc
	t := xf_vec(xf, s.local_center)
	s.c = t
	s.c0 = t
}

sweep_get_transform :: proc(s: ^Sweep, beta: f64) -> Transform {
	xf: Transform
	xf.q = rot_from_angle((1.0 - beta) * s.a0 + beta * s.a)
	xf.p = combine2(1.0 - beta, s.c0, beta, s.c)
	r := rot_vec(xf.q, s.local_center)
	xf.p.x -= r.x
	xf.p.y -= r.y
	return xf
}

sweep_advance :: proc(s: ^Sweep, alpha: f64) {
	beta := (alpha - s.alpha0) / (1.0 - s.alpha0)
	s.c0 = combine2(beta, s.c, 1 - beta, s.c0)
	s.a0 = beta * s.a + (1 - beta) * s.a0
	s.alpha0 = alpha
}

sweep_normalize :: proc(s: ^Sweep) {
	a0 := js_mod_range(s.a0, -math.PI, math.PI)
	s.a -= s.a0 - a0
	s.a0 = a0
}
