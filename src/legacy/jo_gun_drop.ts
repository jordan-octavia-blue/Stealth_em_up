/*******************************************************\
Copyright 2014,2015, Jordan O'Leary, All rights reserved.
If you would like to copy or use my code, you may contact
me at jdoleary@gmail.com
/*******************************************************/
function jo_gun_drop(pixiSprite, parent, xx, yy, gun){
    this.x = xx;//32 is half of one grid cell
    this.y = yy;
    this.gun = gun;
    this.rad = Math.PI*2*Math.random();
    this.sprite = pixiSprite;
    //center the image:
    this.sprite.anchor.x = 0.5;
    this.sprite.anchor.y = 0.5;
    this.sprite.scale.x = 0.5;
    this.sprite.scale.y = 0.5;
    
    this.flag_for_removal = false;
    
    if(parent){
        parent.addChild(this.sprite);
        this.parent = parent;
    }else{
        display_actors.addChild(this.sprite);
        this.parent = display_actors;
    }

    this.remove_from_parent = function(){
        this.parent.removeChild(this.sprite);
    }
 
    this.prepare_for_draw = function(){
        this.sprite.position.x = this.x;
        this.sprite.position.y = this.y;
        this.sprite.rotation = this.rad;
    };
}


// --- legacy global bridge ---------------------------------------------------
// This file used to be a classic <script> whose top-level declarations landed on
// `window`. It is an ES module now, so the functions below are republished as
// globals for the not-yet-extracted code that still reads them by bare name.
// See src/legacy-bridge.ts. Each extraction deletes another line from here.
Object.assign(window, { jo_gun_drop });

export {};
