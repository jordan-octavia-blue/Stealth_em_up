package game

// Packet transports for co-op. Two backends behind one tiny interface:
//   - Steam: ISteamNetworkingMessages (P2P through Steam's relays, NAT-friendly), loaded at
//     runtime from steam_api64.dll / libsteam_api.so so the game still runs without Steam.
//   - UDP: plain sockets for LAN and local testing (no reliability layer: fine on a LAN or
//     localhost, not meant for the internet).
// Peers are u64: a SteamID, or a small id the UDP backend hands out per address.

import cnet "core:net"
import "core:dynlib"
import "core:os"
import "core:fmt"
import "core:strings"
import "base:runtime"

Transport_Kind :: enum u8 { None, Udp, Steam }

Net_Packet :: struct {
	peer: u64,
	data: []u8, // temp allocator
}

transport: struct {
	kind: Transport_Kind,
	// udp
	sock:      cnet.UDP_Socket,
	is_server: bool,
	server_ep: cnet.Endpoint,
	udp_peers: [dynamic]cnet.Endpoint, // peer id = index + 1
}

UDP_DEFAULT_PORT :: 27015
NET_CHANNEL :: 0

transport_udp_host :: proc(port: int) -> bool {
	sock, err := cnet.make_bound_udp_socket(cnet.IP4_Any, port)
	if err != nil {
		fmt.eprintln("udp: could not bind port", port, err)
		return false
	}
	cnet.set_blocking(sock, false)
	transport.kind = .Udp
	transport.sock = sock
	transport.is_server = true
	clear(&transport.udp_peers)
	return true
}

// Returns the host's peer id (always 1 for UDP clients).
transport_udp_join :: proc(addr: string) -> (u64, bool) {
	ep, ok := cnet.parse_endpoint(addr)
	if !ok {
		ip, ok4 := cnet.parse_ip4_address(addr)
		if !ok4 do return 0, false
		ep = {ip, UDP_DEFAULT_PORT}
	}
	if ep.port == 0 do ep.port = UDP_DEFAULT_PORT
	sock, err := cnet.make_unbound_udp_socket(.IP4)
	if err != nil do return 0, false
	cnet.set_blocking(sock, false)
	transport.kind = .Udp
	transport.sock = sock
	transport.is_server = false
	transport.server_ep = ep
	return 1, true
}

transport_send :: proc(peer: u64, data: []u8, reliable: bool) {
	switch transport.kind {
	case .None:
	case .Udp:
		ep: cnet.Endpoint
		if transport.is_server {
			i := int(peer) - 1
			if i < 0 || i >= len(transport.udp_peers) do return
			ep = transport.udp_peers[i]
		} else {
			ep = transport.server_ep
		}
		cnet.send_udp(transport.sock, data, ep)
	case .Steam:
		steam_send(peer, data, reliable)
	}
}

transport_poll :: proc(out: ^[dynamic]Net_Packet) {
	switch transport.kind {
	case .None:
	case .Udp:
		buf: [65536]u8
		for {
			n, from, err := cnet.recv_udp(transport.sock, buf[:])
			if err != nil || n <= 0 do break
			peer: u64 = 1
			if transport.is_server {
				peer = 0
				for p, i in transport.udp_peers do if p == from do peer = u64(i + 1)
				if peer == 0 {
					append(&transport.udp_peers, from)
					peer = u64(len(transport.udp_peers))
				}
			}
			data := make([]u8, n, context.temp_allocator)
			copy(data, buf[:n])
			append(out, Net_Packet{peer, data})
		}
	case .Steam:
		steam_poll(out)
	}
}

transport_close :: proc() {
	switch transport.kind {
	case .None:
	case .Udp:
		cnet.close(transport.sock)
	case .Steam:
		steam_close_sessions()
	}
	transport.kind = .None
	clear(&transport.udp_peers)
}

// ---------------------------------------------------------------- Steam (flat API via dynlib)

Steam_Networking_Identity :: struct #packed {
	type:    i32,
	cb_size: i32,
	data:    [128]u8,
}
#assert(size_of(Steam_Networking_Identity) == 136)

// The leading fields of SteamNetworkingMessage_t (pack 8). We only read these.
Steam_Networking_Message :: struct {
	data:          rawptr,
	size:          i32,
	conn:          u32,
	identity_peer: Steam_Networking_Identity,
}

Steam_Callback_Msg :: struct {
	user:     i32,
	callback: i32,
	param:    [^]u8,
	param_sz: i32,
}

Steam_API :: struct {
	__handle: dynlib.Library,
	SteamAPI_InitFlat:                                       proc "c" (err_msg: [^]u8) -> i32,
	SteamAPI_Shutdown:                                       proc "c" (),
	SteamAPI_GetHSteamPipe:                                  proc "c" () -> i32,
	SteamAPI_ManualDispatch_Init:                            proc "c" (),
	SteamAPI_ManualDispatch_RunFrame:                        proc "c" (pipe: i32),
	SteamAPI_ManualDispatch_GetNextCallback:                 proc "c" (pipe: i32, msg: ^Steam_Callback_Msg) -> bool,
	SteamAPI_ManualDispatch_FreeLastCallback:                proc "c" (pipe: i32),
	SteamAPI_ManualDispatch_GetAPICallResult:                proc "c" (pipe: i32, call: u64, out: rawptr, size: i32, expected: i32, failed: ^bool) -> bool,
	SteamAPI_SteamUser_v023:                                 proc "c" () -> rawptr,
	SteamAPI_ISteamUser_GetSteamID:                          proc "c" (self: rawptr) -> u64,
	SteamAPI_SteamFriends_v018:                              proc "c" () -> rawptr,
	SteamAPI_ISteamFriends_GetPersonaName:                   proc "c" (self: rawptr) -> cstring,
	SteamAPI_ISteamFriends_GetFriendPersonaName:             proc "c" (self: rawptr, id: u64) -> cstring,
	SteamAPI_ISteamFriends_ActivateGameOverlayInviteDialog:  proc "c" (self: rawptr, lobby: u64),
	SteamAPI_SteamMatchmaking_v009:                          proc "c" () -> rawptr,
	SteamAPI_ISteamMatchmaking_CreateLobby:                  proc "c" (self: rawptr, type: i32, max_members: i32) -> u64,
	SteamAPI_ISteamMatchmaking_JoinLobby:                    proc "c" (self: rawptr, lobby: u64) -> u64,
	SteamAPI_ISteamMatchmaking_LeaveLobby:                   proc "c" (self: rawptr, lobby: u64),
	SteamAPI_ISteamMatchmaking_GetLobbyOwner:                proc "c" (self: rawptr, lobby: u64) -> u64,
	SteamAPI_ISteamMatchmaking_SetLobbyData:                 proc "c" (self: rawptr, lobby: u64, key, value: cstring) -> bool,
	SteamAPI_SteamNetworkingMessages_SteamAPI_v002:          proc "c" () -> rawptr,
	SteamAPI_ISteamNetworkingMessages_SendMessageToUser:     proc "c" (self: rawptr, id: ^Steam_Networking_Identity, data: rawptr, size: u32, flags: i32, channel: i32) -> i32,
	SteamAPI_ISteamNetworkingMessages_ReceiveMessagesOnChannel: proc "c" (self: rawptr, channel: i32, out: [^]^Steam_Networking_Message, max: i32) -> i32,
	SteamAPI_ISteamNetworkingMessages_AcceptSessionWithUser: proc "c" (self: rawptr, id: ^Steam_Networking_Identity) -> bool,
	SteamAPI_ISteamNetworkingMessages_CloseSessionWithUser:  proc "c" (self: rawptr, id: ^Steam_Networking_Identity) -> bool,
	SteamAPI_SteamNetworkingUtils_SteamAPI_v004:             proc "c" () -> rawptr,
	SteamAPI_ISteamNetworkingUtils_InitRelayNetworkAccess:   proc "c" (self: rawptr),
	SteamAPI_SteamNetworkingIdentity_SetSteamID64:           proc "c" (self: ^Steam_Networking_Identity, id: u64),
	SteamAPI_SteamNetworkingMessage_t_Release:               proc "c" (msg: ^Steam_Networking_Message),
}

// Steam callback ids (k_iCallback) and sizes we handle.
CB_GAME_LOBBY_JOIN_REQUESTED :: 333 // GameLobbyJoinRequested_t { CSteamID lobby, friend }
CB_LOBBY_ENTER :: 504 // LobbyEnter_t { u64 lobby, u32 perms, bool locked, u32 response }
CB_LOBBY_CREATED :: 513 // LobbyCreated_t { EResult result, u64 lobby }
CB_API_CALL_COMPLETED :: 703 // SteamAPICallCompleted_t { u64 call, i32 callback, u32 size }
CB_NET_MESSAGES_SESSION_REQUEST :: 1251 // { SteamNetworkingIdentity remote }

STEAM_SEND_UNRELIABLE_NO_DELAY :: 0 | 4 | 1
STEAM_SEND_RELIABLE :: 8
STEAM_LOBBY_FRIENDS_ONLY :: 1

steam: struct {
	api:        Steam_API,
	loaded:     bool,
	ok:         bool,
	pipe:       i32,
	user, friends, matchmaking, messages, utils: rawptr,
	self_id:    u64,
	lobby:      u64,
	err:        string,
}

STEAM_DEFAULT_APP_ID :: "480" // Valve's Spacewar test app; set STEAM_APP_ID for the real one

steam_init :: proc() -> bool {
	if steam.ok do return true
	// the library loads once; SteamAPI_Init is retried each time (Steam may start later)
	if !steam.loaded && !steam_load_library() do return false
	return steam_start()
}

steam_load_library :: proc() -> bool {
	when ODIN_OS == .Windows {
		lib_name := "steam_api64.dll"
	} else when ODIN_OS == .Darwin {
		lib_name := "libsteam_api.dylib"
	} else {
		lib_name := "libsteam_api.so"
	}
	exe_dir := os.args[0]
	for i := len(exe_dir) - 1; i >= 0; i -= 1 {
		if exe_dir[i] == '/' || exe_dir[i] == '\\' {
			exe_dir = exe_dir[:i]
			break
		}
	}
	candidates := [2]string{strings.concatenate({exe_dir, "/", lib_name}, context.temp_allocator), lib_name}
	loaded := false
	for c in candidates {
		if _, ok := dynlib.initialize_symbols(&steam.api, c, ""); ok {
			loaded = true
			break
		}
	}
	if !loaded {
		steam.err = "Steam library not found next to the game"
		return false
	}
	steam.loaded = true
	return true
}

steam_start :: proc() -> bool {
	app_id := os.get_env("STEAM_APP_ID", context.temp_allocator)
	if app_id == "" do app_id = STEAM_DEFAULT_APP_ID
	os.set_env("SteamAppId", app_id)
	os.set_env("SteamGameId", app_id)
	errbuf: [1024]u8
	if steam.api.SteamAPI_InitFlat(&errbuf[0]) != 0 {
		steam.err = strings.clone(string(cstring(&errbuf[0])))
		if steam.err == "" do steam.err = "Steam is not running"
		return false
	}
	steam.api.SteamAPI_ManualDispatch_Init()
	steam.pipe = steam.api.SteamAPI_GetHSteamPipe()
	steam.user = steam.api.SteamAPI_SteamUser_v023()
	steam.friends = steam.api.SteamAPI_SteamFriends_v018()
	steam.matchmaking = steam.api.SteamAPI_SteamMatchmaking_v009()
	steam.messages = steam.api.SteamAPI_SteamNetworkingMessages_SteamAPI_v002()
	steam.utils = steam.api.SteamAPI_SteamNetworkingUtils_SteamAPI_v004()
	steam.self_id = steam.api.SteamAPI_ISteamUser_GetSteamID(steam.user)
	steam.api.SteamAPI_ISteamNetworkingUtils_InitRelayNetworkAccess(steam.utils)
	steam.ok = true
	return true
}

steam_shutdown :: proc() {
	if steam.ok {
		if steam.lobby != 0 do steam.api.SteamAPI_ISteamMatchmaking_LeaveLobby(steam.matchmaking, steam.lobby)
		steam.api.SteamAPI_Shutdown()
	}
	steam.ok = false
}

steam_identity :: proc(id: u64) -> Steam_Networking_Identity {
	ident: Steam_Networking_Identity
	steam.api.SteamAPI_SteamNetworkingIdentity_SetSteamID64(&ident, id)
	return ident
}

// The SteamID inside an identity (type k_ESteamNetworkingIdentityType_SteamID = 16).
steam_identity_id :: proc(ident: ^Steam_Networking_Identity) -> u64 {
	return (^u64)(&ident.data[0])^
}

steam_send :: proc(peer: u64, data: []u8, reliable: bool) {
	if !steam.ok do return
	ident := steam_identity(peer)
	flags := i32(reliable ? STEAM_SEND_RELIABLE : STEAM_SEND_UNRELIABLE_NO_DELAY)
	steam.api.SteamAPI_ISteamNetworkingMessages_SendMessageToUser(steam.messages, &ident, raw_data(data), u32(len(data)), flags, NET_CHANNEL)
}

steam_poll :: proc(out: ^[dynamic]Net_Packet) {
	if !steam.ok do return
	msgs: [64]^Steam_Networking_Message
	for {
		n := steam.api.SteamAPI_ISteamNetworkingMessages_ReceiveMessagesOnChannel(steam.messages, NET_CHANNEL, &msgs[0], len(msgs))
		if n <= 0 do break
		for m in msgs[:n] {
			data := make([]u8, int(m.size), context.temp_allocator)
			copy(data, ([^]u8)(m.data)[:m.size])
			append(out, Net_Packet{steam_identity_id(&m.identity_peer), data})
			steam.api.SteamAPI_SteamNetworkingMessage_t_Release(m)
		}
		if n < len(msgs) do break
	}
}

steam_close_sessions :: proc() {
	if !steam.ok do return
	for p in net.peers {
		if p.id == 0 do continue
		ident := steam_identity(p.id)
		steam.api.SteamAPI_ISteamNetworkingMessages_CloseSessionWithUser(steam.messages, &ident)
	}
	if steam.lobby != 0 {
		steam.api.SteamAPI_ISteamMatchmaking_LeaveLobby(steam.matchmaking, steam.lobby)
		steam.lobby = 0
	}
}

steam_persona :: proc(id: u64) -> string {
	if !steam.ok do return "?"
	if id == steam.self_id do return string(steam.api.SteamAPI_ISteamFriends_GetPersonaName(steam.friends))
	return string(steam.api.SteamAPI_ISteamFriends_GetFriendPersonaName(steam.friends, id))
}

steam_create_lobby :: proc() {
	if !steam.ok do return
	steam.api.SteamAPI_ISteamMatchmaking_CreateLobby(steam.matchmaking, STEAM_LOBBY_FRIENDS_ONLY, MAX_PLAYERS)
}

steam_join_lobby :: proc(lobby: u64) {
	if !steam.ok do return
	steam.api.SteamAPI_ISteamMatchmaking_JoinLobby(steam.matchmaking, lobby)
}

steam_invite_dialog :: proc() {
	if !steam.ok || steam.lobby == 0 do return
	steam.api.SteamAPI_ISteamFriends_ActivateGameOverlayInviteDialog(steam.friends, steam.lobby)
}

// Pumps Steam callbacks; call once per frame.
steam_run_callbacks :: proc() {
	if !steam.ok do return
	api := &steam.api
	api.SteamAPI_ManualDispatch_RunFrame(steam.pipe)
	msg: Steam_Callback_Msg
	for api.SteamAPI_ManualDispatch_GetNextCallback(steam.pipe, &msg) {
		switch msg.callback {
		case CB_API_CALL_COMPLETED:
			call := (^u64)(msg.param)^
			expected := (^i32)(msg.param[8:])^
			size := (^u32)(msg.param[12:])^
			buf: [256]u8
			failed: bool
			if size <= len(buf) && api.SteamAPI_ManualDispatch_GetAPICallResult(steam.pipe, call, &buf[0], i32(size), expected, &failed) && !failed {
				steam_on_call_result(expected, buf[:size])
			}
		case CB_LOBBY_ENTER:
			lobby := (^u64)(msg.param)^
			steam_on_lobby_entered(lobby)
		case CB_GAME_LOBBY_JOIN_REQUESTED:
			lobby := (^u64)(msg.param)^
			steam_join_lobby(lobby)
		case CB_NET_MESSAGES_SESSION_REQUEST:
			ident := (^Steam_Networking_Identity)(msg.param)
			// Accept only lobby members when hosting; any request while we are a client is the host.
			if net_steam_should_accept(steam_identity_id(ident)) {
				api.SteamAPI_ISteamNetworkingMessages_AcceptSessionWithUser(steam.messages, ident)
			}
		}
		api.SteamAPI_ManualDispatch_FreeLastCallback(steam.pipe)
	}
}

steam_on_call_result :: proc(callback: i32, data: []u8) {
	switch callback {
	case CB_LOBBY_CREATED:
		// LobbyCreated_t { EResult; uint64 lobby }: Steam packs callbacks to 8 bytes on
		// Windows and 4 elsewhere, so the id sits at 8 or 4.
		LOBBY_ID_AT :: 8 when ODIN_OS == .Windows else 4
		result := (^i32)(&data[0])^
		lobby := (^u64)(&data[LOBBY_ID_AT])^
		if result == 1 { // k_EResultOK
			steam.lobby = lobby
			steam.api.SteamAPI_ISteamMatchmaking_SetLobbyData(steam.matchmaking, lobby, "stealth_host", fmt.ctprintf("%v", steam.self_id))
			net_on_lobby_ready()
		} else {
			net_set_status(fmt.tprintf("Could not create a Steam lobby (error %v)", result))
		}
	case CB_LOBBY_ENTER:
		lobby := (^u64)(&data[0])^
		steam_on_lobby_entered(lobby)
	}
}

steam_on_lobby_entered :: proc(lobby: u64) {
	owner := steam.api.SteamAPI_ISteamMatchmaking_GetLobbyOwner(steam.matchmaking, lobby)
	steam.lobby = lobby
	if owner == steam.self_id do return // our own lobby
	net_join_steam_host(owner)
}

// A "+connect_lobby <id>" launch argument: Steam starts the game this way when a friend
// accepts an invite while the game isn't running.
steam_lobby_from_args :: proc() -> u64 {
	args := os.args
	for i in 0 ..< len(args) - 1 {
		if args[i] == "+connect_lobby" {
			id: u64
			for ch in args[i + 1] {
				if ch < '0' || ch > '9' do return 0
				id = id * 10 + u64(ch - '0')
			}
			return id
		}
	}
	return 0
}

_ :: runtime
