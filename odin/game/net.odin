package game

// Co-op netcode: host-authoritative, 2-4 players.
//
// The host runs the full single-player simulation with every robber in it (players.odin).
// Clients run no AI or game rules. Each client:
//   - moves its own robber locally every tick (so walking feels exactly like single player)
//     and sends its position + mouse to the host (unreliable, every tick);
//   - forwards key and mouse-button presses to the host (reliable), which replays them
//     through the same input handlers with that player's state bound;
//   - draws the world from host snapshots (unreliable, 30 Hz, smoothed), plus a reliable
//     stream of events for one-shot things: sounds, messages, particles, bullets, wall
//     damage, grenades, explosions, alerts and the end of the heist.
//
// Performance: the host serialises ~1-2 KB per snapshot every other tick and replays a
// handful of events; clients skip the whole AI/nav/squad update. Offline play never touches
// any of this beyond a few `net.role == .Host` checks on effect calls.

import "core:fmt"
import "core:math"
import "core:math/rand"
import "core:strings"
import "core:os"
import "core:mem"

NET_VERSION :: 1
SNAPSHOT_EVERY_TICKS :: 2
PEER_TIMEOUT_MS :: 10000.0
HELLO_RESEND_MS :: 500.0
PING_EVERY_MS :: 1000.0 // keeps quiet connections (the lobby) from timing out

Net_Role :: enum u8 { Offline, Host, Client }

Msg :: enum u8 {
	Hello = 1, Welcome, Reject, Lobby, Start, Input, Keys, Snapshot, Events, To_Lobby, Bye, Ping,
}

Ev :: enum u8 {
	Sound = 1, Gunshot, Msg, Float, Bullet, Bullet_End, Blood, Shard, Shell, Blast, Trail,
	Cell, Shake, Alert, Explosion, Grenade, Grenade_Det, Grenade_Done, End,
}

Net_Peer :: struct {
	id:         u64,
	slot:       int,
	name:       string,
	last_heard: f64,
	// host: the latest input from this client
	mouse:      Point,
	pos:        Point,
	has_pos:    bool,
}

Client_Target :: struct { x, y, rad: f64, valid: bool }

net: struct {
	role:        Net_Role,
	via_steam:   bool,
	peers:       [dynamic]Net_Peer,
	host_peer:   u64,
	slot_names:  [MAX_PLAYERS]string,
	in_lobby:    bool,
	status:      string,
	seed:        u64,
	tick:        u32,
	clock_ms:    f64,
	mute:        int, // >0: effects being produced by something the client replays itself
	events:      [dynamic]u8,
	welcomed:    bool,
	hello_at:    f64,
	ping_at:     f64,
	my_name:     string,
	// client
	snap:        [dynamic]u8,
	have_snap:   bool,
	key_events:  [dynamic]u8,
	key_count:   int,
	guard_t:     [dynamic]Client_Target,
	hero_t:      [MAX_PLAYERS]Client_Target,
	car_t:       Client_Target,
	car_steer:   f64,
	bullets:     map[u32]^Sprite,
	grenades_by: map[u32]^Grenade,
	drop_ids:    [dynamic]u32,
	next_id:     u32,
	game_over:   bool,
}

net_is_client :: #force_inline proc() -> bool { return net.role == .Client }
net_is_host :: #force_inline proc() -> bool { return net.role == .Host }
net_is_host_or_offline :: proc() -> bool { return net.role != .Client }

// Host only, outside replayed effects, and only while there is someone to tell.
net_emitting :: #force_inline proc() -> bool {
	return net.role == .Host && net.mute == 0 && len(net.peers) > 0 && state == .Gameplay
}
net_emitting_world :: #force_inline proc() -> bool {
	return net.role == .Host && len(net.peers) > 0 && state == .Gameplay
}

net_set_status :: proc(s: string) {
	delete(net.status)
	net.status = strings.clone(s)
	menu_refresh()
}

// ---------------------------------------------------------------- byte buffers

w_u8 :: proc(b: ^[dynamic]u8, v: u8) { append(b, v) }
w_u16 :: proc(b: ^[dynamic]u8, v: u16) { append(b, u8(v), u8(v >> 8)) }
w_u32 :: proc(b: ^[dynamic]u8, v: u32) { append(b, u8(v), u8(v >> 8), u8(v >> 16), u8(v >> 24)) }
w_u64 :: proc(b: ^[dynamic]u8, v: u64) { w_u32(b, u32(v)); w_u32(b, u32(v >> 32)) }
w_i16 :: proc(b: ^[dynamic]u8, v: int) { w_u16(b, u16(i16(clamp(v, -32768, 32767)))) }
w_f32 :: proc(b: ^[dynamic]u8, v: f64) { w_u32(b, transmute(u32)f32(v)) }
w_str :: proc(b: ^[dynamic]u8, s: string) {
	n := min(len(s), 1000)
	w_u16(b, u16(n))
	append(b, ..transmute([]u8)s[:n])
}

Reader :: struct {
	data: []u8,
	pos:  int,
	ok:   bool,
}
reader :: proc(data: []u8) -> Reader { return {data, 0, true} }
r_need :: proc(r: ^Reader, n: int) -> bool {
	if !r.ok || r.pos + n > len(r.data) {
		r.ok = false
		return false
	}
	return true
}
r_u8 :: proc(r: ^Reader) -> u8 {
	if !r_need(r, 1) do return 0
	v := r.data[r.pos]
	r.pos += 1
	return v
}
r_u16 :: proc(r: ^Reader) -> u16 {
	if !r_need(r, 2) do return 0
	v := u16(r.data[r.pos]) | u16(r.data[r.pos + 1]) << 8
	r.pos += 2
	return v
}
r_u32 :: proc(r: ^Reader) -> u32 {
	if !r_need(r, 4) do return 0
	d := r.data[r.pos:]
	r.pos += 4
	return u32(d[0]) | u32(d[1]) << 8 | u32(d[2]) << 16 | u32(d[3]) << 24
}
r_u64 :: proc(r: ^Reader) -> u64 { lo := r_u32(r); hi := r_u32(r); return u64(lo) | u64(hi) << 32 }
r_i16 :: proc(r: ^Reader) -> int { return int(i16(r_u16(r))) }
r_f32 :: proc(r: ^Reader) -> f64 { return f64(transmute(f32)r_u32(r)) }
r_str :: proc(r: ^Reader) -> string {
	n := int(r_u16(r))
	if !r_need(r, n) do return ""
	s := string(r.data[r.pos:r.pos + n])
	r.pos += n
	return s
}

// ---------------------------------------------------------------- texture ids

net_tex: [dynamic]^Texture
net_tex_index: map[^Texture]u8

net_register_textures :: proc() {
	clear(&net_tex)
	clear(&net_tex_index)
	all := [?]^Texture{
		nil, img_guard_reg, img_guard_riot_reg, img_guard_alert, img_guard_riot_alert, img_guard_knows_hero_face,
		img_guard_riot_knows_face, img_guard_choke, img_guard_dead, img_guard_drag,
		img_hero_body, img_hero_with_money, img_hero_with_pistol, img_hero_with_pistol_silenced,
		img_hero_with_machine_gun, img_hero_with_shotty, img_hero_with_shotty_sawed, img_hero_dead,
		img_hero_head, img_hero_head_masked,
		img_security_camera, img_security_camera_alerted, img_cam_broken, img_cam_off,
		img_computer, img_computer_off,
	}
	for t in all {
		net_tex_index[t] = u8(len(net_tex))
		append(&net_tex, t)
	}
}
tex_id :: proc(t: ^Texture) -> u8 { return net_tex_index[t] or_else 0 }
tex_of :: proc(id: u8) -> ^Texture {
	if int(id) >= len(net_tex) do return nil
	return net_tex[id]
}

GUN_NAMES := [?]string{"Handgun", "Silenced Handgun", "Shotgun", "Sawed-Off Shotty", "Machine Gun"}
gun_index :: proc(g: ^Gun) -> u8 {
	if g == nil do return 255
	for n, i in GUN_NAMES do if n == g.name do return u8(i)
	return 255
}
gun_by_index :: proc(i: u8) -> ^Gun {
	switch i {
	case 0: return &gun_pistol
	case 1: return &gun_pistol_silenced
	case 2: return &gun_shotgun
	case 3: return &gun_shotgun_sawed_off
	case 4: return &gun_machine
	}
	return nil
}

// ---------------------------------------------------------------- sessions

net_reset :: proc() {
	transport_close()
	clear(&net.peers)
	net.role = .Offline
	net.via_steam = false
	net.in_lobby = false
	net.welcomed = false
	net.host_peer = 0
	net.game_over = false
	for &n in net.slot_names {
		delete(n)
		n = ""
	}
	session_slots = {true, false, false, false}
	local_player = 0
	bound_player = 0
}

net_my_name :: proc() -> string {
	if steam.ok do return steam_persona(steam.self_id)
	n := os.get_env("USER", context.temp_allocator)
	if n == "" do n = os.get_env("USERNAME", context.temp_allocator)
	if n == "" do n = "Robber"
	return n
}

net_host_begin :: proc(use_steam: bool) -> bool {
	net_reset()
	if use_steam {
		if !steam_init() {
			net_set_status(fmt.tprintf("Couldn't reach Steam. Is it running and signed in? (%s)", steam.err))
			return false
		}
		transport.kind = .Steam
		net.via_steam = true
		steam_create_lobby()
		net_set_status("Creating a Steam lobby...")
	} else {
		port := UDP_DEFAULT_PORT
		if !transport_udp_host(port) {
			net_set_status("Could not open UDP port 27015")
			return false
		}
		net_set_status(fmt.tprintf("Hosting on UDP port %v. Friends join with STEALTH_JOIN=<your ip>", port))
	}
	net.role = .Host
	net.in_lobby = true
	local_player = 0
	net.slot_names[0] = strings.clone(net_my_name())
	session_slots = {true, false, false, false}
	menu_refresh()
	return true
}

net_on_lobby_ready :: proc() {
	net_set_status("Lobby ready. Invite friends through the Steam overlay.")
	steam_invite_dialog()
}

net_join_udp :: proc(addr: string) -> bool {
	net_reset()
	peer, ok := transport_udp_join(addr)
	if !ok {
		net_set_status(fmt.tprintf("Bad address: %s", addr))
		return false
	}
	net.role = .Client
	net.host_peer = peer
	net.in_lobby = true
	append(&net.peers, Net_Peer{id = peer, slot = 0, last_heard = net_now()})
	net_set_status(fmt.tprintf("Connecting to %s...", addr))
	return true
}

net_join_steam_host :: proc(host: u64) {
	lobby := steam.lobby
	transport_close()
	clear(&net.peers)
	net.role = .Client
	net.via_steam = true
	transport.kind = .Steam
	steam.lobby = lobby
	net.host_peer = host
	net.in_lobby = true
	net.welcomed = false
	append(&net.peers, Net_Peer{id = host, slot = 0, last_heard = net_now()})
	net_set_status(fmt.tprintf("Joining %s's heist...", steam_persona(host)))
	if state == .Gameplay do pending_action = .Start_Menu
}

net_steam_should_accept :: proc(id: u64) -> bool {
	if net.role == .Client do return id == net.host_peer
	return net.role == .Host && net.via_steam
}

net_leave :: proc() {
	if net.role != .Offline {
		bye: [dynamic]u8
		defer delete(bye)
		w_u8(&bye, u8(Msg.Bye))
		for p in net.peers do transport_send(p.id, bye[:], true)
	}
	net_reset()
}

net_now :: proc() -> f64 { return net.clock_ms }

net_send :: proc(peer: u64, b: []u8, reliable: bool) { transport_send(peer, b, reliable) }

net_broadcast :: proc(b: []u8, reliable: bool) {
	for p in net.peers do transport_send(p.id, b, reliable)
}

net_send_lobby :: proc() {
	b := make([dynamic]u8, context.temp_allocator)
	w_u8(&b, u8(Msg.Lobby))
	mask: u8
	for s, i in session_slots do if s do mask |= 1 << uint(i)
	w_u8(&b, mask)
	for n in net.slot_names do w_str(&b, n)
	net_broadcast(b[:], true)
}

// Host: start (or restart) the heist for everyone in the lobby.
net_host_start :: proc() {
	net.seed = u64(rand.uint64())
	net.game_over = false
	b := make([dynamic]u8, context.temp_allocator)
	for p in net.peers {
		clear(&b)
		w_u8(&b, u8(Msg.Start))
		w_u64(&b, net.seed)
		mask: u8
		for s, i in session_slots do if s do mask |= 1 << uint(i)
		w_u8(&b, mask)
		w_u8(&b, u8(p.slot))
		transport_send(p.id, b[:], true)
	}
	net.in_lobby = false
	rand.reset_u64(net.seed)
	pending_action = .Start_Game
}

net_host_to_lobby :: proc() {
	b := make([dynamic]u8, context.temp_allocator)
	w_u8(&b, u8(Msg.To_Lobby))
	net_broadcast(b[:], true)
	net.in_lobby = true
}

// ---------------------------------------------------------------- per frame

// Called once per rendered frame before the simulation: pumps Steam, reads packets.
net_frame :: proc(delta_ms: f64) {
	net.clock_ms += delta_ms
	if steam.ok do steam_run_callbacks()
	if net.role == .Offline do return
	packets := make([dynamic]Net_Packet, context.temp_allocator)
	transport_poll(&packets)
	for p in packets {
		if net.role == .Host do net_host_receive(p)
		else if net.role == .Client do net_client_receive(p)
	}
	now := net_now()
	if now - net.ping_at >= PING_EVERY_MS {
		net.ping_at = now
		ping := [1]u8{u8(Msg.Ping)}
		net_broadcast(ping[:], false)
	}
	if net.role == .Client {
		if !net.welcomed && now - net.hello_at >= HELLO_RESEND_MS {
			net.hello_at = now
			b := make([dynamic]u8, context.temp_allocator)
			w_u8(&b, u8(Msg.Hello))
			w_u16(&b, NET_VERSION)
			w_str(&b, net_my_name())
			net_send(net.host_peer, b[:], true)
		}
		if len(net.peers) > 0 && net.welcomed && now - net.peers[0].last_heard > PEER_TIMEOUT_MS {
			net_reset()
			net_set_status("Lost the connection to the host.")
			pending_action = .Start_Menu
		}
	} else if net.role == .Host {
		for i := len(net.peers) - 1; i >= 0; i -= 1 {
			if now - net.peers[i].last_heard > PEER_TIMEOUT_MS do net_host_drop(i, "timed out")
		}
	}
}

net_host_drop :: proc(i: int, why: string) {
	p := net.peers[i]
	if p.slot > 0 && p.slot < MAX_PLAYERS {
		name := net.slot_names[p.slot]
		if state == .Gameplay {
			new_message(fmt.tprintf("%s left the heist (%s).", name, why))
			// their robber stays where it is, unmoving
		} else {
			session_slots[p.slot] = false
		}
		delete(net.slot_names[p.slot])
		net.slot_names[p.slot] = ""
	}
	ordered_remove(&net.peers, i)
	if state != .Gameplay do net_send_lobby()
	menu_refresh()
}

net_find_peer :: proc(id: u64) -> int {
	for p, i in net.peers do if p.id == id do return i
	return -1
}

net_host_receive :: proc(pk: Net_Packet) {
	r := reader(pk.data)
	kind := Msg(r_u8(&r))
	pi := net_find_peer(pk.peer)
	if pi >= 0 do net.peers[pi].last_heard = net_now()
	#partial switch kind {
	case .Hello:
		version := r_u16(&r)
		name := r_str(&r)
		reply := make([dynamic]u8, context.temp_allocator)
		if version != NET_VERSION {
			w_u8(&reply, u8(Msg.Reject))
			w_str(&reply, "Different game version")
			net_send(pk.peer, reply[:], true)
			return
		}
		if pi < 0 {
			if state == .Gameplay {
				w_u8(&reply, u8(Msg.Reject))
				w_str(&reply, "The heist already started")
				net_send(pk.peer, reply[:], true)
				return
			}
			slot := -1
			for s, i in session_slots do if !s {
				slot = i
				break
			}
			if slot < 0 {
				w_u8(&reply, u8(Msg.Reject))
				w_str(&reply, "The crew is full")
				net_send(pk.peer, reply[:], true)
				return
			}
			session_slots[slot] = true
			net.slot_names[slot] = strings.clone(name)
			append(&net.peers, Net_Peer{id = pk.peer, slot = slot, name = net.slot_names[slot], last_heard = net_now()})
			pi = len(net.peers) - 1
			menu_refresh()
		}
		w_u8(&reply, u8(Msg.Welcome))
		w_u8(&reply, u8(net.peers[pi].slot))
		net_send(pk.peer, reply[:], true)
		net_send_lobby()
	case .Input:
		if pi < 0 do return
		p := &net.peers[pi]
		_ = r_u32(&r)
		mx, my := r_f32(&r), r_f32(&r)
		hx, hy := r_f32(&r), r_f32(&r)
		flags := r_u8(&r)
		if !r.ok do return
		p.mouse = {mx, my}
		p.pos = {hx, hy}
		p.has_pos = flags & 1 != 0
	case .Keys:
		if pi < 0 || state != .Gameplay do return
		slot := net.peers[pi].slot
		n := int(r_u8(&r))
		for _ in 0 ..< n {
			k := r_u8(&r)
			code := int(r_u8(&r))
			mx, my := r_f32(&r), r_f32(&r)
			if !r.ok do break
			net_host_replay_input(slot, k, code, {mx, my})
		}
	case .Bye:
		if pi >= 0 do net_host_drop(pi, "left")
	}
}

// Runs a client's key or button press through the normal handlers as that player.
net_host_replay_input :: proc(slot: int, kind: u8, code: int, at: Point) {
	if slot < 0 || slot >= MAX_PLAYERS || !players[slot].active do return
	prev := player_switch(slot)
	defer player_switch(prev)
	mouse = at
	switch kind {
	case 0: if code != 27 && code != 78 && code != 66 && code != 72 do on_key_down(code)
	case 1: on_key_up(code)
	case 2: on_mouse_down(code == 0 ? .LEFT : .RIGHT)
	case 3:
		if code == 0 {
			keys.lmb = false
		} else {
			keys.rmb = false
		}
	}
}

// Start of each host tick: the latest mouse of every remote robber.
net_host_apply_remote_inputs :: proc() {
	if net.role != .Host do return
	for p in net.peers {
		if p.slot <= 0 || p.slot >= MAX_PLAYERS || !players[p.slot].active do continue
		if p.slot == bound_player do mouse = p.mouse
		else do players[p.slot].mouse = p.mouse
	}
}

net_hero_is_client_driven :: proc(i: int) -> bool {
	return net.role == .Host && i != local_player
}

// A remote robber walks on its own machine; the host takes its reported position.
net_host_apply_remote_position :: proc(i: int) {
	h := hero
	for p in net.peers {
		if p.slot != i || !p.has_pos do continue
		if !h.alive || h.in_car do return
		h.x = p.pos.x
		h.y = p.pos.y
		physics_teleport(h, h.x, h.y)
		physics_stop(h)
		return
	}
}

// End of each host tick: flush events, and every other tick a snapshot.
net_host_after_step :: proc() {
	if net.role != .Host do return
	net.tick += 1
	if len(net.peers) == 0 {
		clear(&net.events)
		return
	}
	if len(net.events) > 0 {
		b := make([dynamic]u8, 0, len(net.events) + 1, context.temp_allocator)
		w_u8(&b, u8(Msg.Events))
		append(&b, ..net.events[:])
		net_broadcast(b[:], true)
		clear(&net.events)
	}
	if net.tick % SNAPSHOT_EVERY_TICKS == 0 {
		b := make([dynamic]u8, 0, 4096, context.temp_allocator)
		net_write_snapshot(&b)
		net_broadcast(b[:], false)
	}
}

net_on_game_over :: proc(won: bool) {
	net.game_over = true
	if !net_emitting_world() do return
	w_u8(&net.events, u8(Ev.End))
	w_u8(&net.events, won ? 1 : 0)
}

// ---------------------------------------------------------------- event emitters (host)

ev_begin :: #force_inline proc(e: Ev) -> ^[dynamic]u8 {
	w_u8(&net.events, u8(e))
	return &net.events
}

net_ev_sound :: proc(id: Sound_Id) {
	if !net_emitting() || id == .Door_Open || id == .Door_Close do return
	b := ev_begin(.Sound)
	w_u8(b, u8(id))
}
net_ev_gunshot :: proc() {
	if !net_emitting() do return
	ev_begin(.Gunshot)
}
net_ev_msg :: proc(m: string) {
	if !net_emitting() do return
	b := ev_begin(.Msg)
	w_str(b, m)
}
net_ev_float :: proc(m: string, x, y: f64, color: u32) {
	if !net_emitting() do return
	b := ev_begin(.Float)
	w_str(b, m)
	w_f32(b, x)
	w_f32(b, y)
	w_u32(b, color)
}
net_ev_splatter :: proc(e: Ev, angle, x, y: f64) {
	if !net_emitting() do return
	b := ev_begin(e)
	w_f32(b, angle)
	w_f32(b, x)
	w_f32(b, y)
}
net_ev_shell :: proc(s: ^Sprite) {
	if !net_emitting() do return
	b := ev_begin(.Shell)
	w_f32(b, s.x)
	w_f32(b, s.y)
	w_f32(b, s.sprite.rotation)
}
net_ev_blast :: proc(x, y, r: f64, tint: u32) {
	if !net_emitting() do return
	b := ev_begin(.Blast)
	w_f32(b, x)
	w_f32(b, y)
	w_f32(b, r)
	w_u32(b, tint)
}
net_ev_trail :: proc(x, y, size: f64) {
	if !net_emitting() do return
	b := ev_begin(.Trail)
	w_f32(b, x)
	w_f32(b, y)
	w_f32(b, size)
}
net_ev_shake :: proc(intensity, decay: f64) {
	if !net_emitting() do return
	b := ev_begin(.Shake)
	w_f32(b, intensity)
	w_f32(b, decay)
}
net_ev_cell :: proc(index: int, amount: f64, type: Damage_Type) {
	if !net_emitting_world() do return
	b := ev_begin(.Cell)
	w_u32(b, u32(index))
	w_f32(b, amount)
	w_u8(b, u8(type))
}
net_ev_alert :: proc(unit: ^Sprite) {
	if !net_emitting_world() || unit == nil do return
	idx := -1
	if unit.kind == .Guard {
		for g, i in guards do if g == unit do idx = i
	} else if unit.kind == .Camera {
		for c, i in security_cameras do if c == unit do idx = i
	}
	if idx < 0 do return
	b := ev_begin(.Alert)
	w_u8(b, unit.kind == .Guard ? 0 : 1)
	w_u16(b, u16(idx))
}
net_ev_explosion :: proc(x, y: f64) {
	if !net_emitting_world() do return
	b := ev_begin(.Explosion)
	w_f32(b, x)
	w_f32(b, y)
}
net_ev_bullet :: proc(s: ^Sprite) {
	if !net_emitting_world() do return
	net.next_id += 1
	s.net_id = net.next_id
	b := ev_begin(.Bullet)
	w_u32(b, s.net_id)
	w_f32(b, s.x)
	w_f32(b, s.y)
	w_f32(b, s.target.x)
	w_f32(b, s.target.y)
	w_f32(b, s.speed)
}
net_ev_bullet_end :: proc(s: ^Sprite) {
	if !net_emitting_world() || s.net_id == 0 do return
	b := ev_begin(.Bullet_End)
	w_u32(b, s.net_id)
}
GRENADE_TYPES := [3]string{"frag", "smoke", "flash"}
net_ev_grenade :: proc(g: ^Grenade) {
	if !net_emitting_world() do return
	net.next_id += 1
	g.net_id = net.next_id
	t: u8 = 0
	for n, i in GRENADE_TYPES do if n == g.def.id do t = u8(i)
	b := ev_begin(.Grenade)
	w_u32(b, g.net_id)
	w_u8(b, t)
	w_f32(b, g.start.x)
	w_f32(b, g.start.y)
	w_f32(b, g.target.x)
	w_f32(b, g.target.y)
}
net_ev_grenade_phase :: proc(g: ^Grenade, e: Ev) {
	if !net_emitting_world() || g.net_id == 0 do return
	b := ev_begin(e)
	w_u32(b, g.net_id)
}

// ---------------------------------------------------------------- snapshots (host)

P_ALIVE :: 1 << 0
P_MASKED :: 1 << 1
P_GUN_OUT :: 1 << 2
P_IN_CAR :: 1 << 3
P_CARRY :: 1 << 4
P_SPYGLASS :: 1 << 5
P_ANIMATE :: 1 << 6
P_MOVING :: 1 << 7
P_PROG :: 1 << 8
P_VISIBLE :: 1 << 9
P_DRAGGING :: 1 << 10
P_HEAD :: 1 << 11

G_ALIVE :: 1 << 0
G_MOVING :: 1 << 1
G_BLIND :: 1 << 2
G_RIOT :: 1 << 3
G_FEET :: 1 << 4
G_PHYS :: 1 << 5

net_write_snapshot :: proc(b: ^[dynamic]u8) {
	w_u8(b, u8(Msg.Snapshot))
	w_u32(b, net.tick)
	flags: u8
	if has_won do flags |= 1
	if cameras_disabled do flags |= 2
	if backup_called do flags |= 4
	if bomb.sprite.visible do flags |= 8
	if bomb_ticking do flags |= 16
	if hero_last_seen.sprite.visible do flags |= 32
	if car.active do flags |= 64
	if bomb_tooltip.visible do flags |= 128
	w_u8(b, flags)
	w_u8(b, u8(max(0, bombs_left)))
	w_f32(b, bomb.x)
	w_f32(b, bomb.y)
	w_f32(b, bomb_fuse)
	w_f32(b, bomb_fuse_start)
	w_f32(b, hero_last_seen.x)
	w_f32(b, hero_last_seen.y)
	// van
	w_f32(b, car.van.x)
	w_f32(b, car.van.y)
	st, ok := physics_get_car_state(car.van)
	w_f32(b, ok ? st.angle : car.van.rad - CAR_ART_OFFSET)
	w_f32(b, ok ? st.steer : 0)
	w_f32(b, ok ? min(st.speed / car_max_speed_px(), 1) : 0)
	w_u8(b, u8(car.driver))
	// loot
	w_u8(b, u8(len(loot)))
	for l in loot {
		w_f32(b, l.x)
		w_f32(b, l.y)
		w_u8(b, l.sprite.visible ? 1 : 0)
	}
	// robbers (all player state lives in players[] except the bound one's)
	player_save()
	w_u8(b, u8(player_count()))
	for p, i in players {
		if !p.active do continue
		h := p.hero
		w_u8(b, u8(i))
		w_f32(b, h.x)
		w_f32(b, h.y)
		w_f32(b, h.rad)
		w_f32(b, h.speed)
		f: u16
		if h.alive do f |= P_ALIVE
		if h.masked do f |= P_MASKED
		if h.gun_out do f |= P_GUN_OUT
		if h.in_car do f |= P_IN_CAR
		if h.carry != nil do f |= P_CARRY
		if h.sprite_spyglass.visible do f |= P_SPYGLASS
		if h.sprite_animate do f |= P_ANIMATE
		if h.moving do f |= P_MOVING
		if p.prog.visible do f |= P_PROG
		if h.sprite.visible do f |= P_VISIBLE
		if p.drag_target != nil do f |= P_DRAGGING
		if h.sprite_head.parent != nil do f |= P_HEAD
		w_u16(b, f)
		w_u8(b, tex_id(h.sprite_body.tex))
		w_u8(b, tex_id(h.sprite_head.tex))
		w_u8(b, gun_index(h.gun))
		w_i16(b, h.gun != nil ? h.gun.ammo : 0)
		w_f32(b, p.prog.draw_x)
		w_f32(b, p.prog.draw_y)
		w_f32(b, p.prog.percent)
	}
	// guards
	w_u16(b, u16(len(guards)))
	for g in guards {
		w_f32(b, g.x)
		w_f32(b, g.y)
		w_f32(b, g.rad)
		f: u8
		if g.alive do f |= G_ALIVE
		if g.moving do f |= G_MOVING
		if g.blind_until != 0 && clock_now() < g.blind_until do f |= G_BLIND
		if g.has_riot_shield do f |= G_RIOT
		if g.feet_clip != nil && g.feet_clip.parent != nil do f |= G_FEET
		if physics_has_actor(g) do f |= G_PHYS
		w_u8(b, f)
		w_u8(b, tex_id(g.sprite_body.tex))
	}
	// cameras
	w_u8(b, u8(len(security_cameras)))
	for c in security_cameras {
		w_f32(b, c.rad)
		f: u8
		if c.alive do f |= 1
		if c.hacked do f |= 2
		w_u8(b, f)
		w_u8(b, tex_id(c.sprite.tex))
	}
	w_u8(b, tex_id(computer_for_security_cameras.sprite.tex))
	// doors
	w_u16(b, u16(len(grid.door_sprites)))
	for d in grid.door_sprites {
		f: u8
		if d.opened do f |= 1
		if d.broken do f |= 2
		w_u8(b, f)
	}
	// gun drops
	w_u8(b, u8(min(len(gun_drops), 255)))
	for d, i in gun_drops {
		if i >= 255 do break
		w_u32(b, d.net_id)
		w_f32(b, d.x)
		w_f32(b, d.y)
		w_f32(b, d.rad)
		w_u8(b, gun_index(d.gun))
	}
}

// ---------------------------------------------------------------- client

net_client_receive :: proc(pk: Net_Packet) {
	if pk.peer != net.host_peer do return
	if len(net.peers) > 0 do net.peers[0].last_heard = net_now()
	r := reader(pk.data)
	kind := Msg(r_u8(&r))
	#partial switch kind {
	case .Welcome:
		local_player = int(r_u8(&r))
		net.welcomed = true
		net_set_status("In the crew. Waiting for the host to start the heist...")
	case .Reject:
		why := r_str(&r)
		msg := fmt.tprintf("The host turned us away: %s", why)
		net_reset()
		net_set_status(msg)
	case .Lobby:
		mask := r_u8(&r)
		for i in 0 ..< MAX_PLAYERS {
			name := r_str(&r)
			delete(net.slot_names[i])
			net.slot_names[i] = strings.clone(name)
			session_slots[i] = mask & (1 << uint(i)) != 0
		}
		net.welcomed = true
		menu_refresh()
	case .Start:
		net.seed = r_u64(&r)
		mask := r_u8(&r)
		local_player = int(r_u8(&r))
		for i in 0 ..< MAX_PLAYERS do session_slots[i] = mask & (1 << uint(i)) != 0
		net.welcomed = true
		net.in_lobby = false
		net.game_over = false
		rand.reset_u64(net.seed)
		start_game()
		net_client_on_start()
	case .To_Lobby:
		net.in_lobby = true
		pending_action = .Start_Menu
	case .Snapshot:
		if state != .Gameplay do return
		clear(&net.snap)
		append(&net.snap, ..pk.data)
		net.have_snap = true
	case .Events:
		if state != .Gameplay do return
		net_client_apply_events(&r)
	case .Bye:
		net_reset()
		net_set_status("The host ended the session.")
		pending_action = .Start_Menu
	}
}

net_client_on_start :: proc() {
	net.have_snap = false
	clear(&net.guard_t)
	net.hero_t = {}
	net.car_t = {}
	clear(&net.bullets)
	clear(&net.grenades_by)
	clear(&net.drop_ids)
	clear(&net.key_events)
	net.key_count = 0
	// gun drops created by setup are the host's too; ids are assigned by the host only
	for d in gun_drops {
		remove_child(d.parent, d.sprite)
	}
	clear(&gun_drops)
}

// Local input on a client: keep our own keys for walking, and queue the press for the host.
net_client_queue_input :: proc(kind: u8, code: int) {
	if net.key_count >= 60 do return
	w_u8(&net.key_events, kind)
	w_u8(&net.key_events, u8(code))
	w_f32(&net.key_events, mouse.x)
	w_f32(&net.key_events, mouse.y)
	net.key_count += 1
}

net_client_key_down :: proc(code: int) {
	if code == 27 {
		// a client leaving mid-heist leaves the crew (no rejoining a heist in progress)
		net_leave()
		net_set_status("You left the heist.")
		pending_action = .Start_Menu
		return
	}
	if code == 78 || code == 66 || code == 72 {
		// debug overlays are local
		switch code {
		case 78: new_message(fmt_join("Nav overlay: ", nav_debug_cycle()))
		case 66: new_message(fmt_join("Physics overlay: ", physics_debug_cycle()))
		case 72: new_message(fmt_join("Wall overlay: ", breach_debug_cycle()))
		}
		return
	}
	net_client_track_key(code, true)
	net_client_queue_input(0, code)
}

net_client_key_up :: proc(code: int) {
	net_client_track_key(code, false)
	net_client_queue_input(1, code)
}

net_client_track_key :: proc(code: int, down: bool) {
	switch code {
	case 87: keys.w = down
	case 65: keys.a = down
	case 83: keys.s = down
	case 68: keys.d = down
	case 16: keys.shift = down
	case 32: keys.space = down
	}
	if hero != nil && hero.alive do hero_move_animation_check()
}

net_client_mouse :: proc(button: int, down: bool) {
	if down {
		if button == 0 && hero != nil && hero.alive && hero.gun_out && hero.gun != nil && hero.gun.ammo > 0 {
			cam_start_shake(10, 0)
			if !hero.gun.automatic do camera_kickback()
		}
		net_client_queue_input(2, button)
	} else {
		camera.shake_decay = 1.5
		net_client_queue_input(3, button)
	}
}

net_client_send_input :: proc() {
	if len(net.key_events) > 0 {
		b := make([dynamic]u8, context.temp_allocator)
		w_u8(&b, u8(Msg.Keys))
		w_u8(&b, u8(net.key_count))
		append(&b, ..net.key_events[:])
		net_send(net.host_peer, b[:], true)
		clear(&net.key_events)
		net.key_count = 0
	}
	b := make([dynamic]u8, context.temp_allocator)
	w_u8(&b, u8(Msg.Input))
	w_u32(&b, net.tick)
	w_f32(&b, mouse.x)
	w_f32(&b, mouse.y)
	w_f32(&b, hero.x)
	w_f32(&b, hero.y)
	w_u8(&b, hero.alive && !hero.in_car ? 1 : 0)
	net_send(net.host_peer, b[:], false)
}

net_client_apply_events :: proc(r: ^Reader) {
	for r.ok && r.pos < len(r.data) {
		e := Ev(r_u8(r))
		switch e {
		case .Sound:
			play_sound(Sound_Id(r_u8(r)))
		case .Gunshot:
			play_gun_shots()
		case .Msg:
			new_message(r_str(r))
		case .Float:
			m := r_str(r)
			x, y := r_f32(r), r_f32(r)
			c := r_u32(r)
			new_floating_message(m, x, y, c)
		case .Blood:
			a, x, y := r_f32(r), r_f32(r), r_f32(r)
			blood_particle_splatter(a, x, y)
		case .Shard:
			a, x, y := r_f32(r), r_f32(r), r_f32(r)
			shard_particle_splatter(a, x, y)
		case .Shell:
			x, y, rot := r_f32(r), r_f32(r), r_f32(r)
			tmp: Sprite
			node: Node
			node.rotation = rot
			tmp.x = x
			tmp.y = y
			tmp.sprite = &node
			eject_shell(&tmp)
		case .Blast:
			x, y, rad := r_f32(r), r_f32(r), r_f32(r)
			tint := r_u32(r)
			grenade_blast_particles(x, y, rad, tint)
		case .Trail:
			x, y, s := r_f32(r), r_f32(r), r_f32(r)
			draw_blood_trail(x, y, s)
		case .Shake:
			i, d := r_f32(r), r_f32(r)
			cam_start_shake(i, d)
		case .Cell:
			idx := int(r_u32(r))
			amount := r_f32(r)
			t := Damage_Type(r_u8(r))
			grid_damage_cell(idx, amount, t)
		case .Alert:
			k := r_u8(r)
			idx := int(r_u16(r))
			if k == 0 && idx < len(guards) do set_latest_alert(guards[idx])
			if k == 1 && idx < len(security_cameras) do set_latest_alert(security_cameras[idx])
		case .Explosion:
			x, y := r_f32(r), r_f32(r)
			play_sound(.Explosion)
			cam_start_shake(300, 12)
			for d := 0; d < len(doodads); d += 1 {
				dd := doodads[d]
				if get_distance(x, y, dd.x, dd.y) < bomb_radius + 32 {
					remove_child(dd.parent, dd.sprite)
					ordered_remove(&doodads, d)
					d -= 1
				}
			}
		case .Bullet:
			id := r_u32(r)
			x, y, tx, ty, speed := r_f32(r), r_f32(r), r_f32(r), r_f32(r), r_f32(r)
			bl := new_sprite_obj(.Bullet, new_sprite(img_bullet), nil)
			bl.x = x
			bl.y = y
			bl.target = new_point(tx, ty)
			bl.speed = speed
			bl.stop_distance = speed
			bl.net_id = id
			sprite_rotate_to_instant(bl, tx, ty)
			append(&bullets, bl)
			net.bullets[id] = bl
		case .Bullet_End:
			id := r_u32(r)
			if bl, ok := net.bullets[id]; ok {
				for b2, i in bullets do if b2 == bl {
					remove_bullet(i)
					break
				}
				delete_key(&net.bullets, id)
			}
		case .Grenade:
			id := r_u32(r)
			t := r_u8(r)
			sx, sy, tx, ty := r_f32(r), r_f32(r), r_f32(r), r_f32(r)
			name := GRENADE_TYPES[min(int(t), 2)]
			if g := grenade_spawn(name, {sx, sy}, {tx, ty}); g != nil {
				g.net_id = id
				g.cosmetic = true
				net.grenades_by[id] = g
			}
		case .Grenade_Det:
			id := r_u32(r)
			if g, ok := net.grenades_by[id]; ok do grenade_detonate_cosmetic(g)
		case .Grenade_Done:
			id := r_u32(r)
			if g, ok := net.grenades_by[id]; ok {
				grenade_tear_down_smoke(g)
				g.phase = .Done
				delete_key(&net.grenades_by, id)
			}
		case .End:
			won := r_u8(r) != 0
			net.game_over = true
			has_won = won
			if won {
				store_inc("wins")
			} else {
				set_text(message_game_over, "The crew is down. Press [Esc] for the menu.")
				store_inc("loses")
			}
		}
	}
}

// Fixed-step update on a client: our own robber walks locally, the rest follows snapshots.
client_gameloop :: proc(dt: f64) {
	clock_update(dt)
	net.tick += 1
	if mouse_relative.x != -10000 do mouse = cam_get_mouse(mouse_relative)
	if net.have_snap {
		net_client_apply_snapshot()
		net.have_snap = false
	}
	smooth := 1 - math.exp(-dt / 60)
	tooltip_shown = false
	tooltip.visible = false
	// our robber
	h := hero
	if h.alive && !h.in_car {
		hero_end_aim.x, hero_end_aim.y = physics_sight_stop(h.x, h.y, mouse.x, mouse.y)
		if keys.w do h.target.y = h.y - 100
		else if keys.s do h.target.y = h.y + 100
		else do h.target.y = h.y
		if keys.d do h.target.x = h.x + 100
		else if keys.a do h.target.x = h.x - 100
		else do h.target.x = h.x
		h.target.null = false
		sprite_move_to_target(h)
	}
	// everyone else glides to the latest snapshot
	for i in 0 ..< MAX_PLAYERS {
		if i == local_player || !players[i].active do continue
		t := net.hero_t[i]
		if !t.valid do continue
		o := players[i].hero
		o.x += (t.x - o.x) * smooth
		o.y += (t.y - o.y) * smooth
		o.rad = lerp_angle(o.rad, t.rad, smooth)
		if physics_has_actor(o) do physics_teleport(o, o.x, o.y)
	}
	if h.in_car {
		h.x = car.van.x
		h.y = car.van.y
	}
	for g, i in guards {
		if i >= len(net.guard_t) do break
		t := net.guard_t[i]
		g.x += (t.x - g.x) * smooth
		g.y += (t.y - g.y) * smooth
		g.rad = lerp_angle(g.rad, t.rad, smooth)
		if physics_has_actor(g) do physics_teleport(g, g.x, g.y)
	}
	if net.car_t.valid {
		v := car.van
		v.x += (net.car_t.x - v.x) * smooth
		v.y += (net.car_t.y - v.y) * smooth
		ang := lerp_angle(v.rad - CAR_ART_OFFSET, net.car_t.rad, smooth)
		v.rad = ang + CAR_ART_OFFSET
		physics_teleport_car(v, v.x, v.y, ang)
		car_sync_outline(v.x, v.y, ang, net.car_steer)
	}
	physics_step(dt)
	physics_sync_actors()
	// facing, spyglass, aim
	if h.alive && !h.in_car {
		h.aim_point = {x = mouse.x, y = mouse.y}
		h.target_rotate = rot_point(&h.aim_point)
		sprite_rotate_to_instant(h, mouse.x, mouse.y)
		if h.gun_out {
			h.aim_start = {h.x, h.y}
			h.aim_end = hero_end_aim
		}
	}
	spyglass_pos = hero_get_spyglass_pos(h)
	spyglass_valid = true
	spyglass_in_wall := is_wall_solid_and_not_door(spyglass_pos.x, spyglass_pos.y)
	spyglass_in_door = is_wall_door(spyglass_pos.x, spyglass_pos.y)
	if !h.alive || (!h.spyglass_equipped || spyglass_in_wall) {
		spyglass_pos = {h.x, h.y}
		h.sprite_spyglass.visible = false
	} else {
		h.sprite_spyglass.visible = true
	}
	// visuals that the host drives in its own loop
	sprite_prepare_for_draw(alert_clip)
	for d in grid.door_sprites do sprite_prepare_for_draw(d)
	update_particles(dt)
	for c in grid.cells do cell_prepare_for_draw(c)
	sprite_prepare_for_draw(bomb)
	g_clear(bomb_radius_debug)
	if bomb.sprite.visible {
		g_begin_fill(bomb_radius_debug, 0x990000, 1.0)
		g_draw_circle(bomb_radius_debug, bomb.x, bomb.y, bomb_radius)
	}
	sprite_prepare_for_draw(hero_last_seen)
	for p in players do if p.active do sprite_prepare_for_draw(p.hero)
	for g in guards {
		update_guard_blind_fx(g)
		guard_update_visibility(g)
		sprite_prepare_for_draw(g)
	}
	for c in security_cameras do sprite_prepare_for_draw(c)
	sprite_prepare_for_draw(computer_for_security_cameras)
	gameloop_alert_animation(dt)
	client_bullets_step()
	for gr in grenades do if gr.phase == .Flying || gr.phase == .Fuse do grenade_step(gr, dt)
	sprite_prepare_for_draw(getawaycar)
	for l in loot do sprite_prepare_for_draw(l)
	for i in 0 ..< MAX_PLAYERS {
		if !players[i].active do continue
		prev := player_switch(i)
		if prog_bar.visible do prog_draw()
		else do g_clear(prog_bar.graphics)
		player_switch(prev)
	}
	if !tooltip_shown && h.alive && !h.masked {
		show_tooltip(fmt.tprintf("%v,%v", js_round(mouse.x), js_round(mouse.y)), h.x, h.y + f64(grid.cell_size))
	}
	nav_debug_draw()
	gameloop_messages_and_tooltip(dt)
	for d in doodads do prepare_simple(d.sprite, d.x, d.y, d.rad)
	for d in gun_drops do prepare_simple(d.sprite, d.x, d.y, d.rad)
	update_camera(dt)
	physics_debug_draw()
	breach_debug_draw()
	net_client_send_input()
	points_maybe_sweep()
}

client_bullets_step :: proc() {
	for i := 0; i < len(bullets); i += 1 {
		bl := bullets[i]
		sprite_prepare_for_draw(bl)
		if sprite_move_to_target(bl) {
			delete_key(&net.bullets, bl.net_id)
			remove_bullet(i)
			i -= 1
		}
	}
}

lerp_angle :: proc(a, b, t: f64) -> f64 {
	d := math.mod(b - a + math.PI * 3, math.PI * 2) - math.PI
	return a + d * t
}

net_client_apply_snapshot :: proc() {
	r := reader(net.snap[:])
	_ = r_u8(&r)
	_ = r_u32(&r)
	flags := r_u8(&r)
	has_won = flags & 1 != 0
	was_disabled := cameras_disabled
	cameras_disabled = flags & 2 != 0
	backup_called = flags & 4 != 0
	bomb.sprite.visible = flags & 8 != 0
	bomb_ticking = flags & 16 != 0
	hero_last_seen.sprite.visible = flags & 32 != 0
	car_active := flags & 64 != 0
	bomb_tooltip.visible = flags & 128 != 0
	bombs_left = int(r_u8(&r))
	bomb.x, bomb.y = r_f32(&r), r_f32(&r)
	bomb_fuse, bomb_fuse_start = r_f32(&r), r_f32(&r)
	hero_last_seen.x, hero_last_seen.y = r_f32(&r), r_f32(&r)
	if bomb_tooltip.visible {
		bomb_tooltip_obj = {bomb.x, bomb.y - 32}
		if bomb_ticking {
			set_text(bomb_tooltip, fmt.tprintf("%.1f", max(bomb_fuse, 0) / 1000.0))
			p := bomb_fuse_start > 0 ? 1 - bomb_fuse / bomb_fuse_start : 0
			if p >= 0.95 {
				bomb_tooltip.text.fill = 0xff0000
			} else {
				d := u32(js_round(p * 16)) & 0xF
				bomb_tooltip.text.fill = (d * 0x11) << 16
			}
		}
	}
	_ = was_disabled
	// van
	net.car_t = {r_f32(&r), r_f32(&r), r_f32(&r), true}
	net.car_steer = r_f32(&r)
	speed_ratio := r_f32(&r)
	car.driver = int(r_u8(&r))
	if car_active != car.active {
		car.active = car_active
		if car_active do engine_start()
		else do engine_stop()
	}
	if car.active do engine_update(speed_ratio)
	// loot
	n_loot := int(r_u8(&r))
	for i in 0 ..< n_loot {
		x, y := r_f32(&r), r_f32(&r)
		vis := r_u8(&r) != 0
		if i < len(loot) {
			loot[i].x = x
			loot[i].y = y
			loot[i].sprite.visible = vis
		}
	}
	// robbers
	n_players := int(r_u8(&r))
	for _ in 0 ..< n_players {
		i := int(r_u8(&r))
		x, y, rad, speed := r_f32(&r), r_f32(&r), r_f32(&r), r_f32(&r)
		f := r_u16(&r)
		body, head, gun := r_u8(&r), r_u8(&r), r_u8(&r)
		ammo := r_i16(&r)
		px, py, pct := r_f32(&r), r_f32(&r), r_f32(&r)
		if !r.ok || i < 0 || i >= MAX_PLAYERS || !players[i].active do continue
		prev := player_switch(i)
		h := hero
		local := i == local_player
		alive := f & P_ALIVE != 0
		if !local || !alive || f & P_IN_CAR != 0 || f & P_DRAGGING != 0 {
			net.hero_t[i] = {x, y, rad, true}
		}
		if local {
			// we walk our own robber; snap back only if the host disagrees a lot
			if !alive || f & P_IN_CAR != 0 || get_distance(h.x, h.y, x, y) > 160 {
				h.x = x
				h.y = y
				if physics_has_actor(h) do physics_teleport(h, x, y)
			}
			dragging := f & P_DRAGGING != 0
			if dragging || !keys.shift do h.speed = speed
			else do h.speed = h.speed_sprint
			h.moving = f & P_MOVING != 0
		} else {
			h.speed = speed
			h.moving = f & P_MOVING != 0
			if f & P_ANIMATE != 0 && !h.sprite_animate {
				clip_goto_and_play(h.feet_clip, 0)
				h.sprite_animate = true
			} else if f & P_ANIMATE == 0 && h.sprite_animate {
				clip_goto_and_stop(h.feet_clip, 0)
				h.sprite_animate = false
			}
			h.sprite_spyglass.visible = f & P_SPYGLASS != 0
		}
		if h.alive && !alive {
			h.alive = false
			physics_remove_actor(h)
			if local do set_text(message_game_over, "You're down. Watching the crew...")
		}
		h.masked = f & P_MASKED != 0
		h.gun_out = f & P_GUN_OUT != 0
		if h.in_car != (f & P_IN_CAR != 0) {
			h.in_car = f & P_IN_CAR != 0
			if h.in_car {
				physics_remove_actor(h)
			} else if alive {
				h.x = x
				h.y = y
				physics_add_hero(h, h.radius)
				physics_teleport(h, x, y)
			}
		}
		h.carry = f & P_CARRY != 0 && len(loot) > 0 ? loot[0] : nil
		h.sprite.visible = f & P_VISIBLE != 0
		if f & P_HEAD == 0 && h.sprite_head.parent != nil do remove_child(h.sprite, h.sprite_head)
		if t := tex_of(body); t != nil do h.sprite_body.tex = t
		if t := tex_of(head); t != nil do h.sprite_head.tex = t
		if g := gun_by_index(gun); g != nil && (h.gun == nil || h.gun.name != g.name) {
			h.gun = gun_copy(g)
		}
		if h.gun != nil do h.gun.ammo = ammo
		prog_bar.visible = f & P_PROG != 0
		prog_bar.follow = nil
		prog_bar.target_follow = nil
		prog_bar.draw_x = px
		prog_bar.draw_y = py
		prog_bar.percent = pct
		player_switch(prev)
	}
	// guards
	n_guards := int(r_u16(&r))
	for i in 0 ..< n_guards {
		x, y, rad := r_f32(&r), r_f32(&r), r_f32(&r)
		f := r_u8(&r)
		body := r_u8(&r)
		if !r.ok do break
		if i >= len(guards) {
			// backup arrived on the host
			g := new_guard(img_guard_alert, f & G_RIOT != 0)
			g.x = x
			g.y = y
			g.rad = rad
			physics_add_guard(g, g.radius)
			append(&guards, g)
		}
		for len(net.guard_t) <= i do append(&net.guard_t, Client_Target{})
		net.guard_t[i] = {x, y, rad, true}
		g := guards[i]
		if !net.guard_t[i].valid || get_distance(g.x, g.y, x, y) > 300 {
			g.x = x
			g.y = y
		}
		g.moving = f & G_MOVING != 0
		g.blind_until = f & G_BLIND != 0 ? clock_now() + 1000 : 0
		g.alive = f & G_ALIVE != 0
		if f & G_FEET == 0 && g.feet_clip != nil && g.feet_clip.parent != nil do remove_child(g.sprite, g.feet_clip)
		if f & G_PHYS == 0 && physics_has_actor(g) do physics_remove_actor(g)
		if t := tex_of(body); t != nil do g.sprite_body.tex = t
	}
	// cameras
	n_cams := int(r_u8(&r))
	for i in 0 ..< n_cams {
		rad := r_f32(&r)
		f := r_u8(&r)
		t := r_u8(&r)
		if !r.ok || i >= len(security_cameras) do continue
		c := security_cameras[i]
		c.rad = rad
		c.alive = f & 1 != 0
		c.hacked = f & 2 != 0
		if tx := tex_of(t); tx != nil do c.sprite.tex = tx
	}
	if tx := tex_of(r_u8(&r)); tx != nil do computer_for_security_cameras.sprite.tex = tx
	// doors
	n_doors := int(r_u16(&r))
	for i in 0 ..< n_doors {
		f := r_u8(&r)
		if !r.ok || i >= len(grid.door_sprites) do continue
		d := grid.door_sprites[i]
		open := f & 1 != 0
		if !d.broken {
			if open do door_open(d)
			else do door_close(d)
		}
		d.broken = f & 2 != 0
	}
	// gun drops: rebuild when the set changes
	n_drops := int(r_u8(&r))
	ids := make([]u32, n_drops, context.temp_allocator)
	xs := make([][4]f64, n_drops, context.temp_allocator)
	for i in 0 ..< n_drops {
		ids[i] = r_u32(&r)
		xs[i] = {r_f32(&r), r_f32(&r), r_f32(&r), f64(r_u8(&r))}
	}
	if !r.ok do return
	same := len(ids) == len(net.drop_ids)
	if same {
		for id, i in ids do if net.drop_ids[i] != id do same = false
	}
	if !same {
		for d in gun_drops do remove_child(d.parent, d.sprite)
		clear(&gun_drops)
		clear(&net.drop_ids)
		for id, i in ids {
			g := gun_by_index(u8(xs[i][3]))
			if g == nil do continue
			drop_gun(gun_copy(g), xs[i][0], xs[i][1])
			gun_drops[len(gun_drops) - 1].rad = xs[i][2]
			append(&net.drop_ids, id)
		}
	}
}

_ :: mem
