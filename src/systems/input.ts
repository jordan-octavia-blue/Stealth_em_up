/**
 * Input system (roadmap §2.2 strangler step, Phase 2).
 *
 * Owns the raw DOM handlers: keyboard state, mouse buttons, wheel zoom, and the
 * gameplay actions bound directly to them (interact, bomb, mask, drag/choke, ...).
 * Moved verbatim out of main.ts; still reads the shared world state (`hero`,
 * `keys`, `grid`, ...) as window globals until those gain owners of their own.
 *
 * The one behavioural dependency taken as an import is the GameClock: the choke
 * countdown used to be a raw setTimeout that kept running while paused.
 */
import { gameClock } from '../core/clock';
import { events } from '../core/events';
import { ejectShell } from './particles';

export function mouseMove(e){
    //Viewport coords, not document coords: camera.getMouse wants the position within the
    //canvas, and the canvas sits at the top-left of an unscrolled page. pageX/pageY add
    //the scroll offset, which silently skewed aim whenever the page could scroll at all.
    mouse_relative.x = e.clientX;
    mouse_relative.y = e.clientY;

}

export function addKeyHandlers(){
    //override right click:
    if (document.addEventListener) {
        document.addEventListener('contextmenu', function(e){
            e.preventDefault();
        }, false);
    } else {
        (document as any).attachEvent('oncontextmenu', function() {
            window.event.returnValue = false;
        });
    }
    window.onkeydown = function(e){
        //this function is called every frame that said key is down
        var code = e.keyCode ? e.keyCode : e.which;
        //keyinfo[code] = String.fromCharCode(code);
        if(hero.alive){
            /*
            if(code == 49){hero.changeGun(0);}//key 1
            if(code == 50){hero.changeGun(1);}//key 2
            if(code == 51){hero.changeGun(2);}//key 3
            if(code == 52){hero.changeGun(3);}//key 4
            if(code == 53){hero.changeGun(4);}//key 5
            if(code == 54){hero.changeGun(5);}//key 6
            */
            if(code == 87){keys['w'] = true;}
            if(code == 65){keys['a'] = true;}
            if(code == 83){keys['s'] = true;}
            if(code == 68){keys['d'] = true;}
            if(code == 80){
                //key p
                hero.spyglass_equipped = !hero.spyglass_equipped;

                if(hero.spyglass_equipped){
                    hero.gunOut = false;
                    if(!hero.gunOut)hero.gun_shot_line.graphics.clear();
                    setHeroImage();
                }

            }
            if(code == 71){
                // !keys['g'] makes it so that it will only be called once for a single press of the letter
                if(!keys['g']){
                    hero.gunOut = !hero.gunOut;
                    if(!hero.gunOut)hero.gun_shot_line.graphics.clear();
                    setHeroImage();

                    if(hero.gunOut){
                        hero.spyglass_equipped = false;
                    }
                }
                keys['g'] = true;
            }
            /*if(code == 80){
                //'p'
                pause = !pause;
            }*/
            if(code == 82){
                keys['r'] = true;
                hero.reload();
            }
            if(code == 70){
                //plant bomb
                if(!keys['f'] && !bomb.sprite.visible){

                    if(hero.ability_remote_bomb){
                        //remote bomb
                        hero.moving = false;
                        circProgBar.reset(hero.x,hero.y,1500,function(){
                            plantBomb();
                            bomb_tooltip.text = ("Press 'f' to detonate");
                        });
                        bombs_left--;
                    }else if(hero.ability_timed_bomb){
                        //timed bomb
                        //if f isn't already pressed and bomb isn't already set
                        if(bombs_left>0){
                            hero.moving = false;
                            circProgBar.reset(hero.x,hero.y,1500,function(){plantBomb();setBomb(5000);});
                            bombs_left--;
                        }else{
                            newFloatingMessage("No Bombs Left",{x:hero.x,y:hero.y},"#FFaa00");
                        }
                    }

                }
                if(!keys['f'] && bomb.sprite.visible){
                    if(hero.ability_remote_bomb){
                        //set remote bomb
                        setBomb(500);
                    }
                }
                keys['f'] = true;

            }
            if(code == 86){
                // !keys['v'] makes it so that it will only be called once for a single press of the letter
                if(!keys['v']){
                    circProgBar.heroMaskProg(hero.ability_toggle_mask_speed,useMask,!hero.masked);


                }
                keys['v'] = true;
            }
            if(code == 16){
                keys['shift'] = true;
                //cannot sprint while dragging something
                if(!hero_drag_target){
                    hero.speed = hero.speed_sprint;
                }

            }
            if(code == 32){
                keys['space'] = true;
                if(!hero_drag_target){
                    if(!grid.a_door_is_being_unlocked){
                            //lockpick door:

                        for(var i = 0; i < grid.doors.length; i++){
                            var door = grid.doors[i];
                            if(door.solid && get_distance(hero.x,hero.y,door.x+grid.cell_size/2,door.y+grid.cell_size/2) <= hero.radius*5){
                                //if door isn't solid, then it is already unlocked.
                                grid.a_door_is_being_unlocked = true;

                                //timer
                                var unlockTimeRemaining = hero.lockpick_speed;
                                hero.lockpicking = true;
                                circProgBar.reset(door.x+grid.cell_size/2,door.y+grid.cell_size/2,unlockTimeRemaining,grid.door_sprites[i].unlock.bind(grid.door_sprites[i]));
                                //cancel unlocking if hero moves away from door, unless hero has unlocked remote unlock
                                if(!hero.ability_remote_lockpick)circProgBar.distanceCancelTarget = {x:door.x,y:door.y};

                                return;//unlocking doors succeeds loot interactions.  (Hero can unlock door while holding loot).
                            }
                        }

                        //check if any dead guards are close enough to be dragged.
                        for(var i = 0; i < guards.length; i++){
                            var guard = guards[i];
                            if(get_distance(hero.x,hero.y,guard.x,guard.y) <= hero.radius*dragDistance){

                                //check if any dead guards are close enough to be dragged.
                                if(!guard.alive){
                                    //hero is dragging a dead body

                                    //slow down hero speed because he just started dragging something.
                                    hero.speed = hero.speed/2;
                                    hero_drag_target = guard;
                                    hero_drag_target.speed = hero.speed;
                                    hero_drag_target.stop_distance = hero.radius*2;//I don't know why but the stop distance here seems to need to be bigger by a factor of 10
                                    //return;//don't return, this allows choking out a guard to have higher precedence than dragging a body
                                }else{
                                    //hero is choking out a live guard who is not already alarmed:
                                    newMessage('You are choking out a guard!');
                                    //play_sound(sound_guard_choke);


                                    //add to stats:
                                    jo_store_inc("guardsChoked");

                                    guard.moving = true;
                                    guard.path = [];
                                    guard.target = {x: null, y:null};
                                    guard.being_choked_out = true;
                                    //slow down hero speed because he just started dragging something.
                                    hero.speed = hero.speed_walk/2;
                                    hero_drag_target = guard;
                                    hero_drag_target.speed = hero.speed;
                                    hero_drag_target.stop_distance = hero.radius*2;//I don't know why but the stop distance here seems to need to be bigger by a factor of 10
                                    gameClock.after(hero.ability_choke_speed, function(){
                                        //check that the guard is still being choked out, if not, he's not dead so don't kill() him
                                        if(hero_drag_target == this){
                                            newMessage('The guard is dispached!');
                                            this.kill();
                                            //if space isn't still being held release body:
                                            if(!keys['space']){
                                                //drag is a toggle action so release current drag target.
                                                hero_drag_target.stop_dragging();
                                                hero_drag_target = null;
                                                //bring hero speed back to normal
                                                hero.speed = hero.speed_walk;
                                            }
                                        }
                                    }.bind(guard));
                                    return;
                                }

                            }



                        }

                        //check if hero is close enough to bug a camera:
                        for(var s = 0; s < security_cameras.length; s++){
                            var cam = security_cameras[s];
                            if(hero.alive && get_distance(hero.x,hero.y,cam.x,cam.y) <= hero.radius*dragDistance){
                                cam.hacked = true;
                            }
                        }

                        //note: dragging guards takes precedence over all the following actions.

                        //check if hero is close enough to the security camera computer to disable cameras:
                        if(!cameras_disabled && get_distance(hero.x,hero.y,computer_for_security_cameras.x,computer_for_security_cameras .y) <= hero.radius*4){
                            cameras_disabled = true;
                            newMessage('All security cameras have been disabled!');
                            computer_for_security_cameras.sprite.texture = (img_computer_off);
                            for(var i = 0; i < security_cameras.length; i++){
                                security_cameras[i].sprite.texture = (img_cam_off);

                            }
                        }
                    }

                }

            }
        }

        if(code == 27){
            //esc
            startMenu();
        }

        hero_move_animation_check();
    };
    window.onkeyup = function(e){
        var code = e.keyCode ? e.keyCode : e.which;
        if(code == 87){keys['w'] = false;}
        if(code == 65){keys['a'] = false;}
        if(code == 83){keys['s'] = false;}
        if(code == 68){keys['d'] = false;}
        if(code == 70){keys['f'] = false;}
        if(code == 71){keys['g'] = false;}
        if(code == 82){keys['r'] = false;}
        if(code == 86){
            //on release of key only
            //if(keys['v'])circProgBar.stop();//stop putting on mask
            keys['v'] = false;
        }
        if(code == 16){
            keys['shift'] = false;
            if(hero_drag_target==null){
                hero.speed = hero.speed_walk;
            }
        }
        if(code == 32){
            keys['space'] = false;
            //if hero was dragging something, drop it. (Don't drop a guard while he's being choked
            if(hero_drag_target && !hero_drag_target.alive){
                //drag is a toggle action so release current drag target.
                hero_drag_target.stop_dragging();
                hero_drag_target = null;
                //bring hero speed back to normal
                hero.speed = hero.speed_walk;
            }
            //allow user to abort unlocking door:
            if(grid.a_door_is_being_unlocked && !hero.ability_remote_lockpick){
                circProgBar.stop();
                hero.lockpicking = false;
            }

            grid.a_door_is_being_unlocked = false;//unlocking stops when space is released
        }
        hero_move_animation_check();

    };
    // IE9, Chrome, Safari, Opera
    window.addEventListener("mousewheel", mouseWheelHandler, false);
    // Firefox
    window.addEventListener("DOMMouseScroll", mouseWheelHandler, false);

    onmousedown = function(e){
        clickEvent = e;
        if(clickEvent.which === 1){
            //LMB
            if(hero_drag_target){
                newFloatingMessage("You cannot shoot while dragging a body!",{x:hero.x,y:hero.y},"#FFaa00");
                return;
            }
            keys['LMB'] = true;
            //hero can only shoot if gun is out
            if(hero.gunOut){
                    //very minor camera shake:
                if(hero.gun.ammo > 0)camera.startShake(10,0);

                if(!hero.gun.automatic){
                    if(hero.gun.ammo > 0){
                        //very minor camera shake:
                        camera.shakeDecay = 1.5;

                        hero.gun.ammo--;
                        //newFloatingMessage("Ammo: " + hero.gun.ammo + "/6",{x:hero.x,y:hero.y},"#FFaa00");
                        doGunShotEffects(hero, hero.gun.silenced);//plays sound and shows affects
                        //kickback camera
                        events.emit('camera:kickback');
                        ejectShell(hero);

                        hero.shoot();
                        if(!hero.gun.silenced)unsilenced_gun();//make noise (not real sound, but noise for guards) which draws guards
                        window.mouse_click_obj = camera.objectivePoint_ignore_shake(clickEvent);  //uses clickEvent's .x and .y to find objective click


                    }
                }
                if(hero.gun.ammo<=0){
                    newFloatingMessage("Press 'r' to reload!",{x:hero.x,y:hero.y},"#FF0000");
                    play_sound(sound_dry_fire);
                }
            }
        }else if(clickEvent.which === 3){
            //RMB
            keys['RMB'] = true;
            var oldgun = hero.gun;
            for(var i = 0; i < gun_drops.length; i++){
                var gun_drop = gun_drops[i];
                //if close to gun_drop, pick it up:
                if(get_distance(hero.x,hero.y,gun_drop.x,gun_drop.y) <= hero.radius*dragDistance){
                    pickUpGunDrop(gun_drop);
                    break;
                }
            }
            if(oldgun != hero.gun){
              // if hero picked up a gun:
              drop_gun(oldgun,hero.x,hero.y);
              setHeroImage();
            }
        }

    }
    onmouseup = function(e){
        clickEvent = e;
        if(clickEvent.which === 1){
            keys['LMB'] = false;
            //set shakeDecay so that when automatic gun is done firing it will stop the shake.
            camera.shakeDecay = 1.5;
        }else if(clickEvent.which === 3){
            //RMB
            keys['RMB'] = false;
        }
    }
}
function mouseWheelHandler(e){
    // cross-browser wheel delta
    var e = window.event || e; // old IE support
    var delta = Math.max(-1, Math.min(1, (e.wheelDelta || -e.detail)));

    //limit amount that cam can zoom out
    if(delta < 0 && zoom > 0.1){
        zoom += delta * 0.05;
    }else if (delta >0){
        zoom += delta * 0.05;
    }
}
export function removeHandlers(excludeKeyHandlers?){
    keys = {w: false, a: false, s: false, d: false, r: false, f: false, v: false, g:false, space:false, shift:false, LMB:false};

    //if excludeKeyDown is true, don't remove the onkeydown and onkeyup listeners
    if(!excludeKeyHandlers)window.onkeydown = null;
    if(!excludeKeyHandlers)window.onkeyup = null;
    window.removeEventListener("mousewheel",mouseWheelHandler);
    window.removeEventListener("DOMMouseScroll",mouseWheelHandler);
    onmousedown = null;
}

//Whether a movement key is held; drives the hero's walk animation.
var hero_moving = false;
function hero_move_animation_check(){
        var hero_was = hero_moving;
        if(keys['w'] || keys['a'] || keys['s'] || keys['d'])hero_moving = true;
        else hero_moving = false;
        if(hero_moving && !hero_was){
            hero.feet_clip.gotoAndPlay(0);
            hero.sprite_animate = true;
        }
        if(!hero_moving){
            hero.feet_clip.gotoAndStop(0);
            hero.sprite_animate = false;
        }
}
