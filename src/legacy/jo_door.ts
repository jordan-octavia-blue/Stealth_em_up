function sprite_door_wrapper(pixiSprite,horizontal,doorwall,parent){
    function sprite_door(){

        this.sprite.anchor.x = 0.125;
        this.sprite.anchor.y = 0;
        this.unlocked = false;
        this.relatedDoorWall = doorwall;//a reference to the door wall object for changing "solidness" and line of sight
        this.opened = false;
        this.openerNear = false;//true if a person able to open it is near
        this.broken = false;
        
        this.horizontal = horizontal;
        this.rotClosed;
        this.rotOpen;
        if(!horizontal){
            this.x += 32;
            this.rotClosed = 0;
            this.rotOpen = 90 * Math.PI/180;
        }else{
            this.x += 64;
            this.y += 32;
            this.rotClosed = 90 * Math.PI/180;
            this.rotOpen = 0;
        }
        //set initial rotation
        this.rad = this.rotClosed;
        
        this.open = function(){
            if(this.broken)return;
            if(!this.opened){
                this.opened = true;
                if(get_distance(hero.x,hero.y,this.x,this.y) < 120){
                  play_sound(sound_door_open);
                }
                this.rad = this.rotOpen;
                this.relatedDoorWall.openDoor();//for changing "solidness" and line of sight
                
                //change color:
                this.sprite.texture = (img_door_open);
            }
        
        }
        this.close = function(){
            if(this.broken)return;
            if(this.opened){
                if(get_distance(hero.x,hero.y,this.x,this.y) < 120){
                  play_sound(sound_door_close);
                }
                this.opened = false;
                this.rad = this.rotClosed;
                this.relatedDoorWall.closeDoor();//for changing "solidness" and line of sight
            }
            
            
                //change color: (unlocked doors stay green)
                if(!this.unlocked)this.sprite.texture = (img_door_closed);
        
        }
        this.unlock = function(){
            hero.lockpicking = false;
            if(this.broken)return;
            this.unlocked = true;
            //change color:
            this.sprite.texture = (img_door_open);
        }
   


        
    }
    sprite_door.prototype = new jo_sprite(pixiSprite,parent);
    return new sprite_door();
}

// --- legacy global bridge ---------------------------------------------------
// This file used to be a classic <script> whose top-level declarations landed on
// `window`. It is an ES module now, so the functions below are republished as
// globals for the not-yet-extracted code that still reads them by bare name.
// See src/legacy-bridge.ts. Each extraction deletes another line from here.
Object.assign(window, { sprite_door_wrapper });

export {};
