/*******************************************************\
Copyright 2014,2015, Jordan O'Leary, All rights reserved.
If you would like to copy or use my code, you may contact
me at jdoleary@gmail.com
/*******************************************************/
import { gameClock } from '../core/clock';
import { events } from '../core/events';
import { nav, PathPriority } from '../nav';
import { physics } from '../physics';
import { GuardBrain, GuardState, ai } from '../ai';
function sprite_guard_wrapper(pixiSprite, hasRiotShield){
    function sprite_guard(hasRiotShield){
        this.path = [];//path applies to AI following a path;
        // The pre-state when a guard is about to get alarmed
        this.alarmedPre = false;
        this.alarmed = false;
        this.being_choked_out = false;
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

        //Phase 6: a hierarchical FSM + perception replaces the alarmedPre/alarmed/chasing
        //flag soup (roadmap §5). The brain owns the awareness meter, the decaying memory
        //and the current GuardState; gameloop_guards feeds it perception each fixed step
        //and drives the effects off the state it returns. `alarmed` survives as a compat
        //flag other code still reads (riot-shield bullet check, textures), kept in sync
        //with the state by the loop.
        this.brain = new GuardBrain();
        //Health model (roadmap §5.4): guards get hp and one damage entry point,
        //`takeDamage`. Default weapon damage one-shots (preserving the current feel) until
        //Phase 8's data-driven weapon table gives grenades partial damage.
        this.hp = 100;
        this.maxHp = 100;
        //Nearest audible sound this tick, set by the hearing pass in gameloop_guards and
        //consumed by the brain. Null when the guard heard nothing.
        this.heardPos = null;
        //Set true by the path-follow code when the guard reaches the point it was moving
        //to investigate — drives the INVESTIGATE → SEARCH transition.
        this.reachedGoal = false;
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

        //Health model entry point (roadmap §5.4). All damage funnels through here: bullets
        //(one-shot by default), the bomb, and — in Phase 8 — the frag grenade. `amount`
        //and `type` come from the caller; the weapon table that sets them lands in Phase 8.
        this.takeDamage = function(amount, type, fromX, fromY){
            if(!this.alive)return;
            this.hp -= amount;
            if(this.hp <= 0)this.kill(fromX,fromY);
        };

        this.kill = function(){
            //play_sound(sound_unit_die);
            this.sprite_body.texture = (img_guard_dead);
            this.alive = false;
            this.hp = 0;
            //The FSM is terminal once dead; the brain stops producing transitions.
            this.brain.markDead();
            //An ally death is a morale hit that feeds the squad FLEE utility (roadmap §5.3):
            //any living guard who could see this spot has now witnessed a death.
            ai.squad.recordDeath();
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
            //one at a time. Phase 6's squad logic scales these deposits by what each
            //guard actually witnessed.
            events.emit('nav:danger', {x: this.x, y: this.y, amount: 6, radius: 2});
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
        
        //A guard sees a standalone alarming object — in practice a dead body (the hero is
        //handled by the brain's perception now). Bodies are not covered by the awareness
        //meter, so this is the one remaining place that seeds an alarm from a sighting: it
        //records where the body is, telegraphs, then after the reaction delay raises the
        //squad. The 2 s "alert the others" chain is unchanged.
        this.seeAlarmingObject = function(objectOfAlarm){
            if(!this.alarmedPre && !this.alarmed){
                // Guards don't react instantly, they need a second to comprehend what they saw
                // This prevents shield guards from pulling out their shield the moment they see you
                this.alarmedPre = true;
                var where = {x:objectOfAlarm.x, y:objectOfAlarm.y};
                this.brain.adoptBelief(where, {x:0,y:0}, gameClock.now());
                ai.squad.reportSighting(where, {x:0,y:0}, gameClock.now());
                ai.raiseSuspicious();
                gameClock.after(this.reactionTimeMillis, () => {
                    this.becomeAlarmed()

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

        //Told of an alarming event (a squad alert, a heard gunshot, a seen body). Raises
        //the global alert level, adopts the shared belief so this guard heads for the
        //hero's last-known position without having seen the hero itself, and pushes a calm
        //guard into an active search. Texture/speed are the immediate visual; the guard
        //loop is authoritative and keeps them in sync with the FSM state.
        this.becomeAlarmed = function(){
            if(this.alive){
                if(this.knowsHerosFace)this.sprite_body.texture = this.hasRiotShield ? img_guard_riot_knows_face : (img_guard_knows_hero_face);//show that this guard knows your face:
                else this.sprite_body.texture = this.hasRiotShield ? img_guard_riot_alert : img_guard_alert;
                this.speed = 3;//speed up when alarmed.
                this.alarmed = true;
                ai.raiseAlarmed();
                var belief = ai.squad.belief;
                if(belief.pos)this.brain.adoptBelief(belief.pos, belief.vel, gameClock.now());
                if(this.brain.state === GuardState.Patrol || this.brain.state === GuardState.Suspicious){
                    this.brain.state = GuardState.Search;
                    this.brain.stateSince = gameClock.now();
                }
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
