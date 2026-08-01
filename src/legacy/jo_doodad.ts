/*******************************************************\
Copyright 2014,2015, Jordan O'Leary, All rights reserved.
If you would like to copy or use my code, you may contact
me at jdoleary@gmail.com
/*******************************************************/
function jo_doodad(pixiSprite, parent, xx, yy){
    //utility variables, these do not affect the actual sprite, but are used for camera and such, see prepare_for_draw()
    this.x = xx+32;//32 is half of one grid cell
    this.y = yy+32;
    this.rad = Math.PI*2*Math.random();
    /*var random_rot = Math.round(Math.random() * (4 - 1) + 1);
    
    switch(random_rot){
        case 1:
            this.rad = Math.PI/2;
            break;
        case 2:
            this.rad = Math.PI;
            break;
        case 3:
            this.rad = 3*Math.PI/2;
            break;
        case 4:
            this.rad = 2*Math.PI;
            break;
    }*/
    //this.rad = rad;//radians (rotation)

    this.sprite = pixiSprite;
    //center the image:
    this.sprite.anchor.x = 0.5;
    this.sprite.anchor.y = 0.5;
    if(parent){
        parent.addChild(this.sprite);
        this.parent = parent;
    }else{
        display_actors.addChild(this.sprite);
        this.parent = display_actors;
    }

 
    this.prepare_for_draw = function(){
        this.sprite.position.x = this.x;
        this.sprite.position.y = this.y;
        this.sprite.rotation = this.rad;
    };
    
    //add to doodads array:
    doodads.push(this);
}


// --- legacy global bridge ---------------------------------------------------
// This file used to be a classic <script> whose top-level declarations landed on
// `window`. It is an ES module now, so the functions below are republished as
// globals for the not-yet-extracted code that still reads them by bare name.
// See src/legacy-bridge.ts. Each extraction deletes another line from here.
Object.assign(window, { jo_doodad });

export {};
