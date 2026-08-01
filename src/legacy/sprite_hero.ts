/*******************************************************\
Copyright 2014,2015, Jordan O'Leary, All rights reserved.
If you would like to copy or use my code, you may contact
me at jdoleary@gmail.com
/*******************************************************/
function sprite_hero_wrapper(pixiSprite,speed_walk,speed_sprint){
    function sprite_hero(){
        this.speed_walk = speed_walk;
        this.speed_sprint = speed_sprint;
        
        
        this.radius = 14;
        //alert causing bools:
        this.masked = false;
        this.gunOut = false;
        this.inOffLimits = false;
        this.lockpicking = false;
        this.carry = null;
        this.spyglass_distance = 64;
        this.spyglass_equipped = false;
        
        
        /*this.guns = [
            gun_pistol.make_copy(),
            gun_pistol_silenced.make_copy(),
            gun_shotgun.make_copy(),
            gun_shotgun_sawed_off.make_copy(),
            gun_machine.make_copy()
        ];*/
        this.gun_index = 0;
        this.gun = gun_pistol_silenced.make_copy(),//this.guns[this.gun_index];
        //These were read from the `upgrades` object, which the metagame shop wrote into
        //localStorage. That system is gone; every run now starts from the same loadout,
        //so the shop's starting values are simply the values.
        this.health = 1;
        this.ability_kick_doors = 0;
        this.ability_auto_pickup_ammo = false;
        this.ability_num_guns_hold = 1;//how many guns the player can hold
        this.ability_remote_lockpick = false;
        //speed_walk / speed_sprint keep the constructor's values: the shop's defaults for
        //Drag_body_speed and Run_speed were 4 and 8, which is exactly what the call site
        //already passes, so those two overrides never did anything.
        this.lockpick_speed = 5000;
        this.reload_speed = 2000;
        this.ability_toggle_mask_speed = 500;
        this.ability_choke_speed = 4000;
        this.ability_timed_bomb = false;
        this.ability_remote_bomb = false;
        this.ability_body_armor = false;
        
        //debug info
        this.draw_los_circles = false;
        
        this.willCauseAlert = function(){
            if(this.masked || this.gunOut || this.inOffLimits || this.lockpicking || this.carry !== null || hero_drag_target !== null)return true;
            else return false;
        }
        
        //Add all sprites to sprite container
        this.feet_clip = jo_movie_clip("movie_clips/","feet_",8,".png")
        this.feet_clip.anchor.x = 0.5;
        this.feet_clip.anchor.y = 0.5;
        this.feet_clip.loop = true;
        this.feet_clip.animationSpeed = 0.15;//slow it down
        spriteContainer.addChild(this.feet_clip);
        
        this.sprite_spyglass = new PIXI.Sprite(img_spyglass);
        this.sprite_spyglass.anchor.x = 0;
        this.sprite_spyglass.anchor.y = 0;
        this.sprite_spyglass.position.y = 10;
        spriteContainer.addChild(this.sprite_spyglass);
        
        this.sprite_body = pixiSprite;
        this.sprite_body.anchor.x = 0.5;
        this.sprite_body.anchor.y = 0.5;
        spriteContainer.addChild(this.sprite_body);
    
        var spriteHead = new PIXI.Sprite(img_hero_head);
        //extra draw components:
        this.sprite_head = spriteHead;
        //center the image:
        spriteHead.anchor.x = 0.5;
        spriteHead.anchor.y = 0.5;
        spriteContainer.addChild(this.sprite_head);
        this.sprite_animate = false;
        
        this.sin = 0;
        this.sin_body = 0;
        
        
        
        this.prepare_for_draw = function(){
            this.sprite.position.x = this.x;
            this.sprite.position.y = this.y;
            this.sprite.rotation = this.rad;
            if(this.sprite_animate){
                if(this.gunOut){
                  // Shoulders don't sway when you have a gun out
                  this.sin_body = 0;
                }else{
                  this.sin_body -= 0.12;
                  
                }
                this.sin += 0.1;
                this.sprite_head.position.x = 2*Math.sin(this.sin);
                this.sprite_body.rotation = Math.sin(this.sin_body)/4;
                this.sprite_spyglass.rotation = Math.sin(this.sin_body)/4;
  
                
            }

        };
        
        this.imgMaskOn = function(putOn){
            if(putOn){
                this.sprite_head.texture = (img_hero_head_masked);
                
            }else{
                this.sprite_head.texture = (img_hero_head);
                
            }
        }
        //this.currentlySeen = false;
        
        //pos where hero was last seen by guards or camera
        this.lastSeenX;
        this.lastSeenY;
        this.setLastSeen = function(observer){
            if(observer){
                //if the observer is still alive after 2 seconds and not being choked out, alert the others
                setTimeout(function(){
                    if(observer.alive && !observer.being_choked_out){
                        if(this.lastSeenX != observer.sawHeroLastAt.x && this.lastSeenY != observer.sawHeroLastAt.y){
                            this.lastSeenX = observer.sawHeroLastAt.x;
                            this.lastSeenY = observer.sawHeroLastAt.y;
                            hero_last_seen.x = observer.sawHeroLastAt.x;
                            hero_last_seen.y = observer.sawHeroLastAt.y;
                            //repath alert guards to hero
                            notifyGuardsOfHeroLocation = true;
                            //newMessage("Last seen " + observer.sawHeroLastAt.x + "," + observer.sawHeroLastAt.y);
                        }
                    };
                }.bind(this), 2000);
            }else{
                //if observer is null, everyone is notified immediately (gunshot or camera or something).
                if(this.lastSeenX != this.x && this.lastSeenY != this.y){
                    this.lastSeenX = this.x;
                    this.lastSeenY = this.y;
                    hero_last_seen.x = this.x;
                    hero_last_seen.y = this.y;
                    //repath alert guards to hero
                    notifyGuardsOfHeroLocation = true;
                    //newMessage("Last seen " + this.x + "," + this.y);
                }
            }
            
        }
        this.changeGun = function(index){
            if(this.gun_index === index)return;
            if(index >= this.guns.length)return;
            this.gun_index = index;
            this.gun = this.guns[this.gun_index];
            setHeroImage();
        }
        
        this.hurt = function(fromX,fromY){
            if(this.ability_body_armor){
                var chance = randomFloatFromInterval(0,1);
                if(chance >=.5){
                    newFloatingMessage("Close Call!",{x:hero.x,y:hero.y},"#FFaa00");
                    return;
                }
            }
            this.health--;
            if(this.health <= 0)this.kill(fromX,fromY);
        }
        this.kill = function(fromX,fromY){
            hero_is_dead();
            
            //clear laser sight
            // this.gun_shot_line.graphics.clear();
        
            //display_actors.removeChild(this.sprite_head);
            this.alive = false;
            //enable moving so they can be dragged
            this.moving = false;
            this.path = [];
            this.target = {x: null, y:null};
            
            this.sprite_body.texture = (img_hero_dead);
            this.sprite.removeChild(this.sprite_head);
            
            messageGameOver.text = ('Press [Esc] to restart!');
            
            //remove key handlers so hero can no longer move around
            removeHandlers(true);//don't remove key handlers when you die (only mouse stuff)
            //add to stats:
            jo_store_inc("loses");
            
            
            var splatter_angle = grid.angleBetweenPoints(fromX,fromY,hero.x,hero.y);
            bloodParticleSplatter(splatter_angle,hero);
            
            
            //addButton("menu.png","menu2.png",startMenu);
        }

        if(this.draw_los_circles){
            var circle = new debug_circle();
            circle.alpha = 1.0;
        }
        //called once, gets points to iterate for LOS
        this.setupLOS = function showCornersForVisionMasking(){
            var true_corners = 0;
            for(var c = 0; c < grid.cells.length; c++){
                /*var array = [grid.cells[c].v2,grid.cells[c].v4,grid.cells[c].v6,grid.cells[c].v8];
                for(var a = 0; a < array.length; a++){
                    //get all 4 cells on the corner of this point:
                }*/
                //i should only have to use v2 to avoid duplication:
                var cell = grid.cells[c];
                var index = grid.getIndexFromCoords_2d(cell.v2.x-1,cell.v2.y-1);
                var northwest = grid.getCellFromIndex(index.x,index.y);
                
                index = grid.getIndexFromCoords_2d(cell.v2.x+1,cell.v2.y+1);
                var southeast = grid.getCellFromIndex(index.x,index.y);
                
                index = grid.getIndexFromCoords_2d(cell.v2.x-1,cell.v2.y+1);
                var southwest = grid.getCellFromIndex(index.x,index.y);
                
                index = grid.getIndexFromCoords_2d(cell.v2.x+1,cell.v2.y-1);
                var northeast = grid.getCellFromIndex(index.x,index.y);
                
                var corner_cells = [northwest,northeast,southwest,southeast];
                var number_of_blocks_vision = 0;
                var corner = -1;
                var touching_door = false;
                for(var i = 0; i < corner_cells.length; i++){
                    if(corner_cells[i] != undefined){
                        if(corner_cells[i].blocks_vision){
                            number_of_blocks_vision++;
                            //determines which block is blocking vision, only applicable if there is only one blocking block
                            //mark the corner if it isn't a door:
                            if(!corner_cells[i].door)corner = i;
                        }
                        if(corner_cells[i].door){
                            touching_door = true;
                        }
                    }
                }
                //allows for corner on closed doors
                if(number_of_blocks_vision == 2 && touching_door)number_of_blocks_vision--;
                //if not even, it is a true corner point used for vision masking:
                if(number_of_blocks_vision%2!=0){
                    //later,circle.color = 0x00ff00;
                    //later, to account for offset: circle.draw(cell.v2.x,cell.v2.y,5);
                    /*        
                    {
                        true_point: {x,y},
                        angle: 234
                    }*/
                    //if it is an outer corner, add two points, one that will cast a ray, and another that uses the true corner
                    if(number_of_blocks_vision == 1){
                        var offsetx = 0;
                        var offsety = 0;
                        switch(corner){
                            case 0:
                                //NW
                                offsetx = 1;
                                offsety = 1;
                                break;
                            case 1:
                                offsetx = -1;
                                offsety = 1;
                                //NE
                                break;
                            case 2:
                                offsetx = 1;
                                offsety = -1;
                                //SW
                                break;
                            case 3:
                                offsetx = -1;
                                offsety = -1;
                                //SE
                                break;
                        }
                        this.losPoints.push({noray:true,true_point:{x:cell.v2.x-offsetx,y:cell.v2.y-offsety},angle:0});//for rendering LOS
                        this.losPoints.push({true_point:{x:cell.v2.x+offsetx,y:cell.v2.y+offsety},angle:0});//for rendering LOS
                        if(this.draw_los_circles){
                            circle.color = 0x00ff00;
                            circle.draw(cell.v2.x+offsetx,cell.v2.y+offsety,4,true);
                        }
                    }else{
                        this.losPoints.push({true_point:{x:cell.v2.x,y:cell.v2.y},angle:0});//for rendering LOS
                        if(this.draw_los_circles){
                            circle.color = 0xff0000;
                            circle.draw(cell.v2.x,cell.v2.y,4,true);
                        }
                    }
                    true_corners++;
                    /*
                    True corners are decided once when the game starts.  Relevant corners are decided at runtime and are using to draw the LOS polygon
                    */
                }
            }
        };
        this.getSpyglassPos = function(){
            //when hero is using the spyglass, the position of the spyglass is
            //calculated with this function.
            var a,b;
            var c = this.spyglass_distance;
            var A = mouse.x-this.x;
            var B = mouse.y-this.y;
            var C = Math.sqrt(A*A+B*B);
            a = c*A/C;
            b = c*B/C;
            return {x:hero.x+a,y:hero.y+b};
        }

        
    }
    var spriteContainer = new PIXI.Container();

    sprite_hero.prototype = new jo_sprite(spriteContainer);
    return new sprite_hero();
}

// --- legacy global bridge ---------------------------------------------------
// This file used to be a classic <script> whose top-level declarations landed on
// `window`. It is an ES module now, so the functions below are republished as
// globals for the not-yet-extracted code that still reads them by bare name.
// See src/legacy-bridge.ts. Each extraction deletes another line from here.
Object.assign(window, { sprite_hero_wrapper });

export {};
