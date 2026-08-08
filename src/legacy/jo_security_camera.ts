/*******************************************************\
Copyright 2014,2015, Jordan O'Leary, All rights reserved.
If you would like to copy or use my code, you may contact
me at jdoleary@gmail.com
/*******************************************************/
import { gameClock } from '../core/clock';
function security_camera_wrapper(pixiSprite,x,y,maxswivel,minswivel){
    function jo_security_camera(x,y,maxswivel,minswivel){
        
        this.x = x;
        this.y = y;
        //bumb cameras away from wall:
        var corner = findCorner(this).corner;
        var offset = findOffset(corner);
        //The camera must pretend to be pushed away from the wall in order for the los Points to calculate correctly:
        this.losx = this.x + 40*offset.x;
        this.losy = this.y + 40*offset.y;
        //And the camera itself needs to be bumped out from the wall a little:
        this.x += 4*offset.x;
        this.y += 4*offset.y;
        
        //if the hero has hacked the camera and it works for him
        this.hacked = false;
        
        this.radius = 14;
        this.alarmed = false;
        //change anchor:
        this.sprite.anchor.x = 0.35;
        
        //camera specific stuff:
        this.max = maxswivel;//-Math.PI/2;//max swivel
        this.min = minswivel;//Math.PI/2;//max swivel
        this.wait_time = 2000;
        this.speed = 0.01;
        this.rotation = this.min;
        this.increasing = true;
        //Milliseconds left to pause at the end of a sweep. Was a pair of `new Date()` calls
        //per camera per frame; now it's a plain countdown fed by the loop's deltaTime, so it
        //also respects pause.
        this.wait_remaining = this.wait_time;
        
        this.rad = this.min;//set rotation to min swivel
        
        
        /*
        The range of motion of rotation is 0 - 360
        
        */
        this.swivel = function(deltaTime){
            if(this.wait_remaining > 0){
                this.wait_remaining -= deltaTime;
                return;
            }

            if(this.increasing){
                this.rotation += this.speed;
                //allows rotation to loop around from 360deg to 0
                if(this.rotation > 2*Math.PI)this.rotation = 0;
                //reached limit, wait, then loop back
                if(Math.abs(this.rotation-this.max) <= 0.05){
                    this.wait_remaining = this.wait_time;
                    this.increasing = false;
                }
            }else{
                this.rotation -= this.speed;
                //allows rotation to loop around from 0 to 360deg
                if(this.rotation < 0)this.rotation = 2*Math.PI;
                //reached limit, wait, then loop back
                if(Math.abs(this.rotation-this.min) <= 0.05){
                    this.wait_remaining = this.wait_time;
                    this.increasing = true;
                }

            }
            this.rad = this.rotation;
        }
        this.kill = function(){
            this.sprite.texture = (img_cam_broken);
            this.alive = false;
            this.target = {x: null, y:null};
            alarmingObjects.push(this);//add body to alarming objects so if it is see they will sound alarm
                    
        };

        this.seeAlarmingObject = function(objectOfAlarm){
            //when a sprite first sees something alarming, they become alarmed but will not spread the alarm for several seconds:
            if(!this.alarmed){
                    this.alarmed = true;
                    //when a sprite first sees something alarming, they become alarmed but will not spread the alarm for several seconds:
                    this.sprite.texture = (img_security_camera_alerted);
                    this.target = {x:objectOfAlarm.x,y:objectOfAlarm.y};
                    
                    //in 2 seconds, if this camera is still alive, alert the others.
                    gameClock.after(2000, function(){
                        if(this.alive){
                            newMessage('All the other guards are on alert!');
                            //the radius is centred on the camera that saw something
                            alert_all_guards(this);
                        };
                    }.bind(this));
                }
            
        };
        function findOffset(corner){
            var offset: any = {};
            switch(corner){
                case 0:
                    //NW
                    offset.x = 1;
                    offset.y = 1;
                    break;
                case 1:
                    offset.x = -1;
                    offset.y = 1;
                    //NE
                    break;
                case 2:
                    offset.x = 1;
                    offset.y = -1;
                    //SW
                    break;
                case 3:
                    offset.x = -1;
                    offset.y = -1;
                    //SE
                    break;
            }
            return offset;
        }
        function findCorner(object){
                
            var index = grid.getIndexFromCoords_2d(object.x-1,object.y-1);
            var northwest = grid.getCellFromIndex(index.x,index.y);
            
            index = grid.getIndexFromCoords_2d(object.x+1,object.y+1);
            var southeast = grid.getCellFromIndex(index.x,index.y);
            
            index = grid.getIndexFromCoords_2d(object.x-1,object.y+1);
            var southwest = grid.getCellFromIndex(index.x,index.y);
            
            index = grid.getIndexFromCoords_2d(object.x+1,object.y-1);
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
            return {corner:corner,touching_door:touching_door,number_of_blocks_vision:number_of_blocks_vision};
        }
        //`setupLOS()` lived here: for every one of the 1600 cells it decided whether
        //the cell's north-west corner was a "true corner" and, if the camera could see
        //it, cached it for the starburst. Cached once, at map load — so a camera's
        //visible area could never react to a door, let alone a wall coming down. The fog
        //renderer sweeps live occluders instead (src/fog/), and a hacked camera just
        //asks for a cone-limited polygon.

    }
    jo_security_camera.prototype = new jo_sprite(pixiSprite);
    return new jo_security_camera(x,y,maxswivel,minswivel);
}

// --- legacy global bridge ---------------------------------------------------
// This file used to be a classic <script> whose top-level declarations landed on
// `window`. It is an ES module now, so the functions below are republished as
// globals for the not-yet-extracted code that still reads them by bare name.
// See src/legacy-bridge.ts. Each extraction deletes another line from here.
Object.assign(window, { security_camera_wrapper });

export {};
