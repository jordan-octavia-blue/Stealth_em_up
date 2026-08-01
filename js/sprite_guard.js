/*******************************************************\
Copyright 2014,2015, Jordan O'Leary, All rights reserved.
If you would like to copy or use my code, you may contact
me at jdoleary@gmail.com
/*******************************************************/
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
        this.gun_shot_line.graphics.visible = false;
        this.hasRiotShield = hasRiotShield;
        this.reactionTimeMillis = 500;
        //Patrol repath throttling.
        //Without this, a guard with an empty path runs a full A* every single frame, and a
        //destination inside a sealed room (which never yields a path) makes that loop forever.
        this.patrolRetryAt = 0;//timestamp (ms) before which getRandomPatrolPath() is a no-op
        this.patrolFailStreak = 0;//consecutive searches that returned no path, drives the backoff

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
        
        this.kill = function(){
            //play_sound(sound_unit_die);
            this.sprite_body.texture = (img_guard_dead);
            this.alive = false;
            //enable moving so they can be dragged
            this.moving = true;
            this.path = [];
            this.target = {x: null, y:null};                    
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
        //backoff after a search that found no path: 250, 500, 1000, 2000, capped at 3000
        var PATROL_BACKOFF_BASE_MS = 250;
        var PATROL_BACKOFF_MAX_MS = 3000;

        this.getRandomPatrolPath = function(){
            //finds a path to patrol

            var now = performance.now();
            //throttled: too soon since the last search (or still backing off from a failure)
            if(now < this.patrolRetryAt)return;

            //if the sprite is able to move
            if(this.moving){
                //find new patrol path:
                var newCellToPatrolTo = grid.getRandomNonSolidCellIndex();
                var newCellInfo = grid.getInfoFromIndex(newCellToPatrolTo);
                var newCellIndex = {x: newCellInfo.x_index, y: newCellInfo.y_index};
                var currentIndex = grid.getIndexFromCoords_2d(this.x,this.y);
                this.path = grid.getPath(currentIndex,newCellIndex);
                //note: if a path is not found and this.path == [], the guard will idle again.

                if(this.path.length > 0){
                    //found one, drop the backoff
                    this.patrolFailStreak = 0;
                    this.patrolRetryAt = now + PATROL_MIN_INTERVAL_MS;
                }else{
                    //the destination was unreachable (sealed room, or the guard is boxed in).
                    //back off exponentially so we don't burn a full A* per frame retrying.
                    this.patrolFailStreak++;
                    var backoff = PATROL_BACKOFF_BASE_MS * Math.pow(2, this.patrolFailStreak - 1);
                    if(backoff > PATROL_BACKOFF_MAX_MS)backoff = PATROL_BACKOFF_MAX_MS;
                    //jitter so a whole squad of stuck guards doesn't search on the same frame
                    this.patrolRetryAt = now + backoff + Math.random() * PATROL_BACKOFF_BASE_MS;
                }
            }else{
                //can't move right now, check back shortly rather than every frame
                this.patrolRetryAt = now + PATROL_MIN_INTERVAL_MS;
            }
            this.idling = false;
            this.startedIdling = false;

        };
        
        this.pathToCoords = function(x,y){
            //finds a path to patrol
        
            //if the sprite is able to move
            if(this.moving){
                //find new patrol path:
                var newCellToPatrolTo = grid.getIndexFromCoords_2d(x,y);
                newCellToPatrolTo = grid.get1DIndexFrom2DIndex(newCellToPatrolTo.x,newCellToPatrolTo.y);
                var newCellInfo = grid.getInfoFromIndex(newCellToPatrolTo);
                var newCellIndex = {x: newCellInfo.x_index, y: newCellInfo.y_index};
                var currentIndex = grid.getIndexFromCoords_2d(this.x,this.y);
                this.path = grid.getPath(currentIndex,newCellIndex);
            }
        
        };
        
        this.seeAlarmingObject = function(objectOfAlarm){
            if(!this.alarmedPre && !this.alarmed){
                // Guards don't react instantly, they need a second to comprehend what they saw
                // This prevents shield guards from pulling out their shield the moment they see you
                this.alarmedPre = true;
                setTimeout(() => {
                    this.becomeAlarmed()
                    
                    this.path = [];//empty path
                    this.moving = false;//this sprite stop in their tracks when they see otherSprite.
                    
                    //in 3 seconds, if this guard is still alive, alert the others.
                    setTimeout(function(){
                        if(this.alive && !this.being_choked_out){
                            newMessage('All the other guards are on alert!');
                            alert_all_guards();
                        };
                    }.bind(this), 2000);
                }, this.reactionTimeMillis)
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