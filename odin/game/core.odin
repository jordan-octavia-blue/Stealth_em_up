package game

// src/core/clock.ts, src/legacy/jo_math.ts, src/legacy/jo_utility.ts.

import "core:math"
import "core:math/rand"
import "core:c/libc"

// ---------------------------------------------------------------- GameClock

Clock_Fn :: proc(data: rawptr, arg: int)

Timer :: struct {
	id:          int,
	due_at:      f64,
	interval_ms: f64,
	fn:          Clock_Fn,
	data:        rawptr,
	arg:         int,
	cancelled:   bool,
}

Clock_Handle :: int

Game_Clock :: struct {
	time_ms: f64,
	timers:  [dynamic]Timer,
	next_id: int,
}

game_clock: Game_Clock

clock_now :: proc() -> f64 { return game_clock.time_ms }

clock_after :: proc(ms: f64, fn: Clock_Fn, data: rawptr = nil, arg: int = 0) -> Clock_Handle {
	return clock_add(game_clock.time_ms + max(0, ms), 0, fn, data, arg)
}

clock_every :: proc(ms: f64, fn: Clock_Fn, data: rawptr = nil, arg: int = 0) -> Clock_Handle {
	assert(ms > 0)
	return clock_add(game_clock.time_ms + ms, ms, fn, data, arg)
}

clock_add :: proc(due_at, interval_ms: f64, fn: Clock_Fn, data: rawptr, arg: int) -> Clock_Handle {
	game_clock.next_id += 1
	append(&game_clock.timers, Timer{game_clock.next_id, due_at, interval_ms, fn, data, arg, false})
	return game_clock.next_id
}

clock_cancel :: proc(h: Clock_Handle) {
	for &t in game_clock.timers do if t.id == h {
		t.cancelled = true
		return
	}
}

clock_done :: proc(h: Clock_Handle) -> bool {
	for t in game_clock.timers do if t.id == h do return t.cancelled
	return true
}

clock_clear :: proc() {
	clear(&game_clock.timers)
}

clock_update :: proc(dt: f64) {
	if dt < 0 do return
	game_clock.time_ms += dt
	snapshot_limit := game_clock.next_id // timers added from here on wait for the next update
	for {
		best := -1
		for t, i in game_clock.timers {
			if t.cancelled || t.id > snapshot_limit || t.due_at > game_clock.time_ms do continue
			if best == -1 || t.due_at < game_clock.timers[best].due_at do best = i
		}
		if best == -1 do break
		t := &game_clock.timers[best]
		if t.interval_ms > 0 {
			t.due_at += t.interval_ms
		} else {
			t.cancelled = true
		}
		fn, data, arg := t.fn, t.data, t.arg
		fn(data, arg)
	}
	j := 0
	for t in game_clock.timers {
		if !t.cancelled {
			game_clock.timers[j] = t
			j += 1
		}
	}
	resize(&game_clock.timers, j)
}

// ---------------------------------------------------------------- random / math

random :: proc() -> f64 { return rand.float64() }

// JavaScript's % on numbers (C fmod: exact, sign of the dividend).
js_mod :: proc(a, b: f64) -> f64 { return libc.fmod(a, b) }

random_int_from_interval :: proc(lo, hi: f64) -> f64 {
	return math.floor(random() * (hi - lo) + lo)
}

random_float_with_bias :: proc(lo, hi: f64) -> f64 {
	return random() * random() * hi + lo
}

random_float_from_interval :: proc(lo, hi: f64) -> f64 {
	return random() * (hi - lo) + lo
}

get_distance :: proc(x1, y1, x2, y2: f64) -> f64 {
	return math.sqrt((x1 - x2) * (x1 - x2) + (y1 - y2) * (y1 - y2))
}

Point :: struct { x, y: f64 }

Move_Result :: struct { x, y, ang: f64, snapped: bool }

move_to_target_xy :: proc(x, y, targx, targy, speed: f64) -> Move_Result {
	c := speed
	A := targx - x
	B := targy - y
	C := math.sqrt(A * A + B * B)
	if c > C do return {targx, targy, 0, true}
	a := c * A / C
	b := c * B / C
	return {x + a, y + b, math.atan2(b, a), false}
}

// angle in degrees
rotate_point_about_axis :: proc(axis: Point, angle_deg: f64, p: Point) -> Point {
	angle := angle_deg * math.PI / 180
	s := math.sin(angle)
	c := math.cos(angle)
	px := p.x - axis.x
	py := p.y - axis.y
	xnew := px * c - py * s
	ynew := px * s + py * c
	return {xnew + axis.x, ynew + axis.y}
}

circle_linesegment_intersect :: proc(cx, cy, r: f64, e, l: Point) -> bool {
	dx := l.x - e.x
	dy := l.y - e.y
	fx := e.x - cx
	fy := e.y - cy
	a := dx * dx + dy * dy
	b := 2 * (fx * dx + fy * dy)
	c := fx * fx + fy * fy - r * r
	disc := b * b - 4 * a * c
	if disc < 0 do return false
	disc = math.sqrt(disc)
	t1 := (-b - disc) / (2 * a)
	t2 := (-b + disc) / (2 * a)
	if t1 >= 0 && t1 <= 1 do return true
	if t2 >= 0 && t2 <= 1 do return true
	return false
}

angle_between :: proc(n, a, b: f64) -> bool {
	n := js_mod(360 + js_mod(n, 360), 360)
	a := js_mod(3600000 + a, 360)
	b := js_mod(3600000 + b, 360)
	if a < b do return a <= n && n <= b
	return a <= n || n <= b
}

angle_in_arc_rad :: proc(arc_angle, arc_size, angle: f64) -> bool {
	aa := arc_angle * 180 / math.PI
	as := arc_size * 180 / math.PI
	an := angle * 180 / math.PI
	return angle_between(an, aa - as / 2, aa + as / 2)
}

// The legacy "keep it between -PI and PI" pair, verbatim (it is not a no-op in floating
// point, so it is reproduced rather than simplified).
norm_rad :: #force_inline proc(r: f64) -> f64 {
	r := r
	if r < math.PI do r += math.PI * 2
	if r > math.PI do r -= math.PI * 2
	return r
}
