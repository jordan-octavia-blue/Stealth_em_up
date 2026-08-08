/*******************************************************\
Copyright 2014,2015, Jordan O'Leary, All rights reserved.
If you would like to copy or use my code, you may contact
me at jdoleary@gmail.com
/*******************************************************/
import { squad } from '../ai/squad';
import { gameClock } from '../core/clock';
import { nav, PathPriority } from '../nav';
import { physics } from '../physics';
function sprite_guard_wrapper(pixiSprite, hasRiotShield){
    function sprite_guard(hasRiotShield){
        this.path = [];//path applies to AI following a path;
        // The pre-state when a guard is about to get alarmed
        this.alarmedPre = false;
        this.alarmed = false;
        this.being_choked_out = false;
        //gameClock time (ms) until which this guard is diving clear of the van (Phase 7).
        //While it holds, the guard ignores its normal AI and runs to `target`.
        this.dodgeUntil = 0;
        //gameClock time (ms) until which this guard is stunned from being run into by a
        //sprinting hero (src/systems/melee.ts). While it holds, the guard skips its AI and
        //coasts on the decaying knockback velocity instead of steering.
        this.stunnedUntil = 0;
        this.blood_trail;
        this.blood_trail_size = 10;
        this.blood_trail_skip_frequency = 1.5;
        this.chasingHero = false;
        this.idling = false;//if guard is just standing
        this.startedIdling = false;
        this.idleRotateRad;//radians to rotate to while idling (changes each time)
        this.ammo = 6;
        this.sawHeroLastAt = {x:null,y:null};
        this.accuracy = 50;
        this.knowsHerosFace = false;//if guard knows hero's face, mask becomes irrelevant
        this.currentlySeesHero = false;//updated every loop;
        this.gun_shot_line.graphics.visible = false;
        this.hasRiotShield = hasRiotShield;
        this.reactionTimeMillis = 500;
        //Patrol repath throttling.
        //Phase 3 moved the real fix into src/nav: destinations are sampled from this
        //guard's own connected region (so they are always reachable) and searches run
        //through the nav scheduler under a per-frame budget. This throttle survives as
        //the pacing knob — a guard that just finished a patrol leg waits a beat before
        //asking for the next one instead of asking on the very next tick.
        this.patrolRetryAt = 0;//gameClock time (ms) before which getRandomPatrolPath() is a no-op
        this.patrolFailStreak = 0;//consecutive searches that returned no path, drives the backoff
        //Stuck detection (Phase 4). Guards used to walk through walls and each other, so
        //a waypoint was always eventually reached and `target` always cleared. Now they
        //are solid bodies: two guards can wedge in a doorway, or a path can be blocked by
        //a squadmate who stopped to shoot. Without this a wedged guard would hold its
        //target forever and never ask for another route.
        this.stuckSince = 0;//gameClock time the guard stopped making progress, 0 = moving
        this.stuckFromX = 0;
        this.stuckFromY = 0;

        //Phase 6b squad coordination (src/ai/squad.ts). The blackboard writes these:
        //`assignedEntry` is the nav cell of the doorway/gap this guard is told to approach
        //(null = converge directly / patrol); the patrol fields track which named route
        //(if the map has any) this guard walks and how far along it is.
        this.assignedEntry = null;
        this.patrolRouteIndex = -1;
        this.patrolLeg = 0;

        //Phase 10 (map editor): per-guard patrol behaviour + the "bank manager" flag. The map
        //loader/spawn code overwrites these from the guard's entry; the defaults here match a
        //legacy guard (random wander, ordinary guard). `behavior` is read by
        //getRandomPatrolPath below; `isBankManager` is checked in kill() to hand over the key.
        this.behavior = { kind: 'random' };
        this.isBankManager = false;

        //Add all sprites to sprite container
        this.feet_clip = jo_movie_clip("movie_clips/","feet_",8,".png")
        this.feet_clip.anchor.x = 0.5;
        this.feet_clip.anchor.y = 0.5;
        this.feet_clip.loop = true;
        this.feet_clip.animationSpeed = 0.1;//slow it down
        this.feet_clip.gotoAndPlay(0);
        spriteContainer.addChild(this.feet_clip);
        
        this.sprite_body = pixiSprite;
        this.sprite_body.anchor.x = 0.5;
        this.sprite_body.anchor.y = 0.5;
        spriteContainer.addChild(this.sprite_body);
        
        //A guard who is on their way somewhere but has not actually moved for a while is
        //jammed against geometry or a squadmate. Returns true once per jam; the caller
        //drops the path so the guard asks nav for a new one.
        var STUCK_GRACE_MS = 1500;
        var STUCK_EPSILON_PX = 4;
        this.checkStuck = function(){
            if(!this.moving || this.path.length === 0 && this.target.x == null){
                this.stuckSince = 0;
                return false;
            }
            var moved = get_distance(this.x,this.y,this.stuckFromX,this.stuckFromY);
            var now = gameClock.now();
            if(moved > STUCK_EPSILON_PX || this.stuckSince === 0){
                this.stuckFromX = this.x;
                this.stuckFromY = this.y;
                this.stuckSince = now;
                return false;
            }
            if(now - this.stuckSince < STUCK_GRACE_MS)return false;
            this.stuckSince = 0;
            return true;
        };

        this.kill = function(){
            //play_sound(sound_unit_die);
            this.sprite_body.texture = (img_guard_dead);
            this.alive = false;
            //Phase 10 (map editor): downing the bank manager (shot or choked out — both reach
            //here) hands the hero the vault key, so a vault door then opens on approach without
            //the long lockpick.
            if(this.isBankManager && hero && !hero.hasVaultKey){
                hero.hasVaultKey = true;
                newFloatingMessage("Got the vault key!", {x: hero.x, y: hero.y}, "#f1c40f");
            }
            //A corpse is a prop to be dragged, not an obstacle: drop the body out of the
            //physics world so the drag code can move it directly and the living can walk
            //over it, exactly as they did before Phase 4.
            physics.removeActor(this);
            //enable moving so they can be dragged
            this.moving = true;
            this.path = [];
            this.target = {x: null, y:null};
            //a dead guard has no use for the path he asked for
            nav.cancelRequest(this);
            //Wherever guards die is dangerous: the nav danger layer decays over ~8s and
            //is summed into path costs, so the squad stops filing into the same doorway
            //one at a time. Phase 6b's squad logic scales this deposit by how many living
            //guards saw the death and whether it landed at a chokepoint, then routes the
            //survivors around it. reportDeath must run before removeGuard so the dead
            //guard's squadmates are still counted as witnesses.
            squad.reportDeath(this, gameClock.now());
            squad.removeGuard(this);
            alarmingObjects.push(this);//add body to alarming objects so if it is see they will sound alarm
            
            
            //make sure the dead body sprite is on top of the blood trail and below other people
            spriteContainer.removeChild(this.feet_clip);
            //display_effects.addChild(this.sprite_body);
            
            //drop gun
            drop_gun(this.gun,this.x,this.y);
            
            //show sprite when dead:
            this.sprite.visible = true;
                
        }
        
        //minimum gap between two patrol searches for one guard, even when they succeed
        var PATROL_MIN_INTERVAL_MS = 250;
        //backoff after a request that came back with no path: 250, 500, 1000, 2000,
        //capped at 3000. Region sampling makes this nearly unreachable now (a guard
        //sealed alone in a cupboard is the remaining case), but it costs nothing.
        var PATROL_BACKOFF_BASE_MS = 250;
        var PATROL_BACKOFF_MAX_MS = 3000;

        this.getRandomPatrolPath = function(){
            //queue a patrol path. The search itself runs inside nav, under the
            //scheduler's per-frame budget — this call never performs one.

            //Phase 10 (map editor): honour the guard's authored patrol behaviour.
            //  'stay'    — hold post: never queue a patrol path (combat/alarm is unaffected).
            //  'random'  — always region-safe random wander, ignoring named routes.
            //  'route'   — walk the assigned named route (via squad.patrolPathFor).
            //  (default) — legacy: routes if the map has them, else wander.
            var behaviorKind = (this.behavior && this.behavior.kind) ? this.behavior.kind : null;
            if(behaviorKind === 'stay'){
                this.idling = true;
                this.startedIdling = true;
                this.patrolRetryAt = gameClock.now() + PATROL_MIN_INTERVAL_MS;
                return;
            }
            //Phase 6b: if the map defines named patrol routes, walk the one assigned to this
            //guard instead of wandering. A 'random' guard skips this so it never picks up a
            //route even on a map that defines them. Falls through to random wander otherwise.
            if(behaviorKind !== 'random' && squad.patrolPathFor(this))return;

            //game time, not wall time: the backoff must not burn down while paused
            var now = gameClock.now();
            //throttled: too soon since the last request (or still backing off)
            if(now < this.patrolRetryAt)return;
            //already waiting on one; re-asking would just cancel and re-queue it
            if(nav.hasPendingRequest(this))return;

            if(this.moving){
                var destination = nav.randomDestinationNear({x:this.x,y:this.y});
                if(!destination){
                    //nowhere to go (boxed in) — check back later, don't spin
                    this.patrolRetryAt = now + PATROL_BACKOFF_MAX_MS;
                    return;
                }
                var guard = this;
                //Patrol is the lowest priority: a guard chasing the hero jumps this queue.
                nav.requestPath({
                    owner: this,
                    from: {x:this.x,y:this.y},
                    to: destination,
                    radius: this.radius,
                    priority: PathPriority.Patrol,
                    onReady: function(path){
                        guard.path = path;
                        guard.patrolFailStreak = 0;
                        guard.patrolRetryAt = gameClock.now() + PATROL_MIN_INTERVAL_MS;
                    },
                    onFail: function(){
                        guard.patrolFailStreak++;
                        var backoff = PATROL_BACKOFF_BASE_MS * Math.pow(2, guard.patrolFailStreak - 1);
                        if(backoff > PATROL_BACKOFF_MAX_MS)backoff = PATROL_BACKOFF_MAX_MS;
                        //jitter so a whole squad of stuck guards doesn't retry in lockstep
                        guard.patrolRetryAt = gameClock.now() + backoff + Math.random() * PATROL_BACKOFF_BASE_MS;
                    },
                });
                //don't re-ask before the request has had a chance to run
                this.patrolRetryAt = now + PATROL_MIN_INTERVAL_MS;
            }else{
                //can't move right now, check back shortly rather than every frame
                this.patrolRetryAt = now + PATROL_MIN_INTERVAL_MS;
            }
            this.idling = false;
            this.startedIdling = false;

        };

        this.pathToCoords = function(x,y){
            //Converge on a shared target (in practice: the hero's last known position).
            //
            //This is the case the flow field exists for — the whole squad wants a route
            //to the same cell, so nav runs ONE reverse Dijkstra and every guard reads
            //its route out of the direction table. 15 guards converge for the price of
            //one search, where the old code ran 15 full A*s on the same frame.
            if(this.moving){
                var path = nav.convergeTo({x:this.x,y:this.y},{x:x,y:y},this.radius);
                if(path.length > 0)this.path = path;
            }

        };
        
        this.seeAlarmingObject = function(objectOfAlarm){
            if(!this.alarmedPre && !this.alarmed){
                // Guards don't react instantly, they need a second to comprehend what they saw
                // This prevents shield guards from pulling out their shield the moment they see you
                this.alarmedPre = true;
                gameClock.after(this.reactionTimeMillis, () => {
                    this.becomeAlarmed()

                    this.path = [];//empty path
                    this.moving = false;//this sprite stop in their tracks when they see otherSprite.

                    //in 2 seconds, if this guard is still alive, alert the others.
                    gameClock.after(2000, function(){
                        if(this.alive && !this.being_choked_out){
                            newMessage('All the other guards are on alert!');
                            alert_all_guards();
                        };
                    }.bind(this));
                })
            }

            
        };
        
        this.becomeAlarmed = function(){
            if(this.alive){
                //when a guard is told of an alarming event.
                if(this.knowsHerosFace)this.sprite_body.texture = this.hasRiotShield ? img_guard_riot_knows_face : (img_guard_knows_hero_face);//show that this guard knows your face:
                else this.sprite_body.texture = this.hasRiotShield ? img_guard_riot_alert : img_guard_alert;
                this.speed = 3;//speed up when alarmed.
                this.alarmed = true;
            }
        
        };
        
        this.get_dragged_parent = this.get_dragged;
        //modify and call parent function
        this.get_dragged = function(){
            //if not being choked out, set texture to drag
            if(this.being_choked_out && this.alive)this.sprite_body.texture = (img_guard_choke);
            else this.sprite_body.texture = (img_guard_drag);
            this.get_dragged_parent();
   
        
        }
        this.stop_dragging = function(){
            if(!this.alive)this.sprite_body.texture = (img_guard_dead);
        }
        
        
    }
    var spriteContainer = new PIXI.Container();
    
    sprite_guard.prototype = new jo_sprite(spriteContainer, display_guards);
    return new sprite_guard(hasRiotShield);
}

// --- legacy global bridge ---------------------------------------------------
// This file used to be a classic <script> whose top-level declarations landed on
// `window`. It is an ES module now, so the functions below are republished as
// globals for the not-yet-extracted code that still reads them by bare name.
// See src/legacy-bridge.ts. Each extraction deletes another line from here.
Object.assign(window, { sprite_guard_wrapper });

export {};
