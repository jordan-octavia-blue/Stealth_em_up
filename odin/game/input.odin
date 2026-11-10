package game

// systems/input.ts. Key codes are the browser's keyCode values so the handler below is
// a line-for-line port; key-repeat events are forwarded too, because the browser fires
// keydown on auto-repeat and several bindings (P, R, Shift) depend on that.

import sapp "sokol:app"

key_handlers_enabled: bool
mouse_handlers_enabled: bool

sapp_to_keycode :: proc(k: sapp.Keycode) -> int {
	#partial switch k {
	case .W: return 87
	case .A: return 65
	case .S: return 83
	case .D: return 68
	case .E: return 69
	case .P: return 80
	case .G: return 71
	case .R: return 82
	case .N: return 78
	case .B: return 66
	case .H: return 72
	case .F: return 70
	case .V: return 86
	case ._3: return 51
	case ._4: return 52
	case ._5: return 53
	case .SPACE: return 32
	case .LEFT_SHIFT, .RIGHT_SHIFT: return 16
	case .ESCAPE: return 27
	}
	return -1
}

add_key_handlers :: proc() {
	key_handlers_enabled = true
	mouse_handlers_enabled = true
}

remove_handlers :: proc(exclude_key_handlers: bool) {
	keys = {}
	if !exclude_key_handlers do key_handlers_enabled = false
	mouse_handlers_enabled = false
}

on_key_down :: proc(code: int) {
	if !key_handlers_enabled do return
	if hero.alive && hero.in_car {
		if code == 87 do keys.w = true
		if code == 65 do keys.a = true
		if code == 83 do keys.s = true
		if code == 68 do keys.d = true
		if code == 32 do keys.space = true
		if code == 69 {
			if !keys.e do car_toggle()
			keys.e = true
		}
	} else if hero.alive {
		if code == 87 do keys.w = true
		if code == 65 do keys.a = true
		if code == 83 do keys.s = true
		if code == 68 do keys.d = true
		if code == 80 {
			hero.spyglass_equipped = !hero.spyglass_equipped
			if hero.spyglass_equipped {
				hero.gun_out = false
				set_hero_image()
			}
		}
		if code == 71 {
			if !keys.g {
				hero.gun_out = !hero.gun_out
				set_hero_image()
				if hero.gun_out do hero.spyglass_equipped = false
			}
			keys.g = true
		}
		if code == 51 {
			if !keys.k3 do throw_grenade("frag", mouse)
			keys.k3 = true
		}
		if code == 52 {
			if !keys.k4 do throw_grenade("smoke", mouse)
			keys.k4 = true
		}
		if code == 53 {
			if !keys.k5 do throw_grenade("flash", mouse)
			keys.k5 = true
		}
		if code == 82 {
			keys.r = true
			if !hero.reloading do gun_reload(hero.gun, hero)
		}
		if code == 78 {
			if !keys.n && bound_is_local() do local_message(fmt_join("Nav overlay: ", nav_debug_cycle()))
			keys.n = true
		}
		if code == 66 {
			if !keys.b && bound_is_local() do local_message(fmt_join("Physics overlay: ", physics_debug_cycle()))
			keys.b = true
		}
		if code == 72 {
			if !keys.h && bound_is_local() do local_message(fmt_join("Wall overlay: ", breach_debug_cycle()))
			keys.h = true
		}
		if code == 70 {
			if !keys.f && !bomb.sprite.visible {
				if hero.ability_remote_bomb {
					hero.moving = false
					prog_reset(hero.x, hero.y, 1500, .Bomb_Remote)
					hero.planting_bomb = true
					bombs_left -= 1
				} else if hero.ability_timed_bomb {
					if bombs_left > 0 {
						hero.moving = false
						prog_reset(hero.x, hero.y, 1500, .Bomb_Timed)
						hero.planting_bomb = true
						bombs_left -= 1
					} else {
						new_floating_message("No Bombs Left", hero.x, hero.y, 0xFFaa00)
					}
				}
			}
			if !keys.f && bomb.sprite.visible {
				if hero.ability_remote_bomb do set_bomb(500)
			}
			keys.f = true
		}
		if code == 86 {
			if !keys.v do prog_hero_mask(hero.ability_toggle_mask_speed, !hero.masked)
			keys.v = true
		}
		if code == 16 {
			keys.shift = true
			if hero_drag_target == nil do hero.speed = hero.speed_sprint
		}
		if code == 32 {
			was_down := keys.space
			keys.space = true
			// Space while sprinting is the drop kick; otherwise it interacts as before
			if !was_down && kick_wanted() && kick_start() do return
			if hero_drag_target == nil && !grid.a_door_is_being_unlocked {
				if space_interact() do return
			}
		}
		if code == 69 {
			if !keys.e do car_toggle()
			keys.e = true
		}
	}
	if code == 27 {
		if bound_is_local() {
			// hosting: everyone goes back to the lobby; the crew stays together
			if net_is_host() do net_host_to_lobby()
			pending_action = .Start_Menu
		}
		return
	}
	hero_move_animation_check()
}

// The Space branch of onkeydown. Returns true where the JS handler returns early.
space_interact :: proc() -> bool {
	cs := f64(grid.cell_size)
	for door, i in grid.doors {
		if door.solid && get_distance(hero.x, hero.y, door.x + cs / 2, door.y + cs / 2) <= hero.radius * 5 {
			grid.a_door_is_being_unlocked = true
			hero.lockpicking = true
			prog_reset(door.x + cs / 2, door.y + cs / 2, hero.lockpick_speed, .Unlock, nil, grid.door_sprites[i])
			if !hero.ability_remote_lockpick {
				prog_bar.cancel_target = {door.x, door.y}
				prog_bar.has_cancel_target = true
			}
			return true
		}
	}
	for guard in guards {
		if get_distance(hero.x, hero.y, guard.x, guard.y) <= hero.radius * drag_distance {
			if !guard.alive {
				hero.speed = hero.speed / 2
				hero_drag_target = guard
				guard.speed = hero.speed
				guard.stop_distance = hero.radius * 2
			} else {
				new_message("You are choking out a guard!")
				store_inc("guardsChoked")
				guard.moving = true
				clear_path(guard)
				guard.target = null_point()
				guard.being_choked_out = true
				physics_remove_actor(guard)
				hero.speed = hero.speed_walk / 2
				hero_drag_target = guard
				guard.speed = hero.speed
				guard.stop_distance = hero.radius * 2
				clock_after(hero.ability_choke_speed, proc(data: rawptr, arg: int) {
					g := cast(^Sprite)data
					prev := player_switch(arg)
					defer player_switch(prev)
					if hero_drag_target == g {
						new_message("The guard is dispached!")
						guard_kill(g)
						if !keys.space {
							sprite_stop_dragging(hero_drag_target)
							hero_drag_target = nil
							hero.speed = hero.speed_walk
						}
					}
				}, guard, bound_player)
				return true
			}
		}
	}
	for cam in security_cameras {
		if hero.alive && get_distance(hero.x, hero.y, cam.x, cam.y) <= hero.radius * drag_distance do cam.hacked = true
	}
	c := computer_for_security_cameras
	if !cameras_disabled && get_distance(hero.x, hero.y, c.x, c.y) <= hero.radius * 4 {
		cameras_disabled = true
		new_message("All security cameras have been disabled!")
		c.sprite.tex = img_computer_off
		for cam in security_cameras do cam.sprite.tex = img_cam_off
	}
	return false
}

on_key_up :: proc(code: int) {
	if !key_handlers_enabled do return
	switch code {
	case 87: keys.w = false
	case 65: keys.a = false
	case 83: keys.s = false
	case 68: keys.d = false
	case 70: keys.f = false
	case 71: keys.g = false
	case 69: keys.e = false
	case 82: keys.r = false
	case 78: keys.n = false
	case 66: keys.b = false
	case 72: keys.h = false
	case 51: keys.k3 = false
	case 52: keys.k4 = false
	case 53: keys.k5 = false
	case 86: keys.v = false
	case 16:
		keys.shift = false
		if hero_drag_target == nil do hero.speed = hero.speed_walk
	case 32:
		keys.space = false
		if hero_drag_target != nil && !hero_drag_target.alive {
			sprite_stop_dragging(hero_drag_target)
			hero_drag_target = nil
			hero.speed = hero.speed_walk
		}
		if grid.a_door_is_being_unlocked && !hero.ability_remote_lockpick {
			prog_stop()
			hero.lockpicking = false
		}
		grid.a_door_is_being_unlocked = false
	}
	hero_move_animation_check()
}

on_mouse_down :: proc(button: sapp.Mousebutton) {
	if !mouse_handlers_enabled do return
	if button == .LEFT {
		if hero_drag_target != nil {
			new_floating_message("You cannot shoot while dragging a body!", hero.x, hero.y, 0xFFaa00)
			return
		}
		keys.lmb = true
		if hero.gun_out {
			local := bound_is_local()
			if hero.gun.ammo > 0 && local do cam_start_shake(10, 0)
			if !hero.gun.automatic {
				if hero.gun.ammo > 0 {
					if local do camera.shake_decay = 1.5
					hero_fire()
				}
			}
			if hero.gun.ammo <= 0 {
				new_floating_message("Press 'r' to reload!", hero.x, hero.y, 0xFF0000)
				if local do play_sound(.Dry_Fire)
			}
		}
	} else if button == .RIGHT {
		keys.rmb = true
		old := hero.gun
		for d in gun_drops {
			if get_distance(hero.x, hero.y, d.x, d.y) <= hero.radius * drag_distance {
				pick_up_gun_drop(d)
				break
			}
		}
		if old != hero.gun {
			drop_gun(old, hero.x, hero.y)
			set_hero_image()
		}
	}
}

// onmouseup is never removed by removeHandlers.
on_mouse_up :: proc(button: sapp.Mousebutton) {
	if state != .Gameplay do return
	if button == .LEFT {
		keys.lmb = false
		if bound_is_local() do camera.shake_decay = 1.5
	} else if button == .RIGHT {
		keys.rmb = false
	}
}

on_mouse_wheel :: proc(dy: f32) {
	if !mouse_handlers_enabled do return
	delta := 0.0
	if dy > 0 do delta = 1
	else if dy < 0 do delta = -1
	if delta < 0 && zoom > 0.1 {
		zoom += delta * 0.05
	} else if delta > 0 {
		zoom += delta * 0.05
	}
}

hero_moving_anim: bool

hero_move_animation_check :: proc() {
	was := hero_moving_anim
	hero_moving_anim = keys.w || keys.a || keys.s || keys.d
	if hero_moving_anim && !was {
		clip_goto_and_play(hero.feet_clip, 0)
		hero.sprite_animate = true
	}
	if !hero_moving_anim {
		clip_goto_and_stop(hero.feet_clip, 0)
		hero.sprite_animate = false
	}
}

fmt_join :: proc(a, b: string) -> string { return concat2(a, b) }
