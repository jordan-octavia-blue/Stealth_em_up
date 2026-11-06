package game

// Placeholders until the network layer lands.
net_is_host_or_offline :: proc() -> bool { return true }
net_on_game_over :: proc(won: bool) {}
net_host_apply_remote_inputs :: proc() {}
net_host_after_step :: proc() {}
net_hero_is_client_driven :: proc(i: int) -> bool { return false }
net_host_apply_remote_position :: proc(i: int) {}
