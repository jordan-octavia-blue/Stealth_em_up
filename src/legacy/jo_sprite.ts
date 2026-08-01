/*******************************************************\
Copyright 2014,2015, Jordan O'Leary, All rights reserved.
If you would like to copy or use my code, you may contact
me at jdoleary@gmail.com
/*******************************************************/
import { physics } from '../physics';
function jo_sprite(pixiSprite, parent){
    //utility variables, these do not affect the actual sprite, but are used for camera and such, see prepare_for_draw()
    this.x = 0;
    this.y = 0;
    this.rad = 0;//radians (rotation)
    this.target = {x: null, y:null};//the target that this sprite moves twords
    this.speed = 1.5;
    this.moving = true;
    this.alive = true;
    this.radius = 19;
    //moved to sprite_hero.js:://this.carry = null;//object hero is carrying (loot)
    this.health = 3;//1;
    
    
    var rand_gun = all_gun_prefabs_without_sawed[Math.floor(Math.random() * all_gun_prefabs_without_sawed.length)];
    this.gun = rand_gun.make_copy();//give random gun
    
    this.reloading = false;
    
    this.gun_shot_line = new debug_line();
    this.gun_shot_line.graphics.visible = true;
    this.aim = new Ray(0,0,0,0);
    this.can_shoot = false;
    this.shoot_speed = 700;//shoots every 0.7 seconds
    this.reacting = false;//reacting to be able to "can_shoot"
    
    this.sprite = pixiSprite;
    //center the image:
    if(this.sprite.anchor){
        this.sprite.anchor.x = 0.5;
        this.sprite.anchor.y = 0.5;
    }
    if(parent)parent.addChild(this.sprite);
	else display_actors.addChild(this.sprite);
    
    /*CAUSING SUPER SLOW DOWN ON FIRE FOX!:
    //sprite tooltip
    this.tooltip = new PIXI.Text("Tooltip", { font: "30px Arial", fill: "#000000", align:"left", stroke: "#FFFFFF", strokeThickness: 2 });
    this.tooltip.anchor.x = 0.5;//centered
    if(show_sprite_tooltips)this.tooltip.visible = true;
    else this.tooltip.visible = false;
    this.tooltip.text = "";
    stage_child.addChild(this.tooltip);*/
    
    this.kill = function(fromX,fromY){
        //play_sound(sound_unit_die);
        this.alive = false;
        this.target = {x: null, y:null};
    }
    this.hurt = function(fromX,fromY){
        this.health--;
        if(this.health <= 0)this.kill(fromX,fromY);
    }
    
    this.reload = function(){
        if(!this.reloading)this.gun.reload(this);
    }
    
    this.shoot = function(){
        this.gun.shoot(this);
        this.can_shoot = false; //so the guards don't shoot way too fast
    }

    //Sprites that own a physics body (the hero and living guards) are moved by the
    //solver: this sets a velocity and lets contacts do the rest, which is what deleted
    //the hand-rolled corner/side pushout further down this file. Everything else —
    //bullets, dead bodies being dragged, doors — keeps the original direct-move path.
    this.move_to_target = function(){
        //this function uses similar triangles with sides a,b,c and A,B,C where c and C are the hypotenuse
        //the movement of this.x and this.y (a,b) are found with the formulas: A/C = a/c and B/C = b/c
        if(this.target.x == null || this.target.y == null )return;//no target
        var a,b;
        var c = this.speed;
        var A = this.target.x-this.x;
        var B = this.target.y-this.y;
        var C = Math.sqrt(A*A+B*B);
        var hasBody = physics.hasActor(this);
        if(C<this.stop_distance){
            if(hasBody)physics.stop(this);
            return true; // the object is close enough that it need not move
        }
        a = c*A/C;
        b = c*B/C;
        if(hasBody){
            //only move the sprite if they are set to moving, for example when guards see hero they will stop in their tracks
            if(this.moving)physics.steerTowards(this,this.target.x,this.target.y,this.speed,this.stop_distance);
            else physics.stop(this);
        }else if(this.moving){
            this.x += a;
            this.y += b;
        }
        if(!this.target_rotate){
            //rotate to face direction of movement
            var newRad = Math.atan2(b,a);
            var diff = newRad - this.rad;
            if(Math.abs(diff) <= 0.1)this.rad = newRad;
            else if(diff > Math.PI)this.rad -= 0.1;
            else if(diff < -Math.PI)this.rad += 0.1;
            else if(diff < 0)this.rad -= 0.1;
            else if(diff > 0)this.rad += 0.1;
            if(this.rad < Math.PI)this.rad += Math.PI*2; //keep it between -PI and PI
            if(this.rad > Math.PI)this.rad -= Math.PI*2; //keep it between -PI and PI
        }else{
            this.rotate_to(this.target_rotate.x, this.target_rotate.y);
        }
        
    };
    
    this.rotate_to = function(x,y){
        //this function uses similar triangles with sides a,b,c and A,B,C where c and C are the hypotenuse
        //the movement of this.x and this.y (a,b) are found with the formulas: A/C = a/c and B/C = b/c
        if(x == null || y == null )return;//no target
        var a,b;
        var c = this.speed;
        var A = x-this.x;
        var B = y-this.y;
        var C = Math.sqrt(A*A+B*B);

        a = c*A/C;
        b = c*B/C;
        
        //rotate to face direction of movement
        var newRad = Math.atan2(b,a);
        var diff = newRad - this.rad;
        if(Math.abs(diff) <= 0.1)this.rad = newRad;
        else if(diff > Math.PI)this.rad -= 0.1;
        else if(diff < -Math.PI)this.rad += 0.1;
        else if(diff < 0)this.rad -= 0.1;
        else if(diff > 0)this.rad += 0.1;
        if(this.rad < Math.PI)this.rad += Math.PI*2; //keep it between -PI and PI
        if(this.rad > Math.PI)this.rad -= Math.PI*2; //keep it between -PI and PI
        
    };
    this.rotate_to_rad = function(rad){
    
        //sanitize:
        if(rad >= Math.PI*2)rad = rad%Math.PI*2;
        if(rad <= Math.PI*2)rad = rad%Math.PI*2;
        //console.log('rot from' + Math.round(this.rad*360/(Math.PI*2)) + ' to ' + Math.round(rad*360/(Math.PI*2)));
        
        //rotate to face direction of movement
        var diff = rad - this.rad;
        var rotSpeed = 0.03;
        if(Math.abs(diff) <= rotSpeed*3){
            this.rad = rad;
            return true;
        }
        else if(diff > Math.PI)this.rad -= rotSpeed;
        else if(diff < -Math.PI)this.rad += rotSpeed;
        else if(diff < 0)this.rad -= rotSpeed;
        else if(diff > 0)this.rad += rotSpeed;
        if(this.rad < Math.PI)this.rad += Math.PI*2; //keep it between -PI and PI
        if(this.rad > Math.PI)this.rad -= Math.PI*2; //keep it between -PI and PI
        
    };

    
    //instantly rotate to target (not incrementally)
    this.rotate_to_instant = function(x,y){
        //console.log('rotate to inst: ' + x + ' ' + y);
        //this function uses similar triangles with sides a,b,c and A,B,C where c and C are the hypotenuse
        //the movement of this.x and this.y (a,b) are found with the formulas: A/C = a/c and B/C = b/c
        if(x == null || y == null )return;//no target
        var a,b;
        var c = this.speed;
        var A = x-this.x;
        var B = y-this.y;
        var C = Math.sqrt(A*A+B*B);
        if(c>C){        
            return true; //The distance that it would travel, is greater than the distance to the target, snap to target.
        }
        a = c*A/C;
        b = c*B/C;
        
        //rotate to face direction of movement
        var newRad = Math.atan2(b,a);
        this.rad = newRad;
        if(this.rad < Math.PI)this.rad += Math.PI*2; //keep it between -PI and PI
        if(this.rad > Math.PI)this.rad -= Math.PI*2; //keep it between -PI and PI
        
    };
    this.stop_distance = 1.5;
    this.get_dragged = function(){
        //get_dragged is the same as move_to_target except with extra rotation code
    
        //this function uses similar triangles with sides a,b,c and A,B,C where c and C are the hypotenuse
        //the movement of this.x and this.y (a,b) are found with the formulas: A/C = a/c and B/C = b/c
        if(this.target.x == null || this.target.y == null )return;//no target
        var a,b;
        var c = this.speed;
        var A = this.target.x-this.x;
        var B = this.target.y-this.y;
        var C = Math.sqrt(A*A+B*B);
        if(C<this.stop_distance){        
            return true; // the object is close enough that it need not move
        }
        a = c*A/C;
        b = c*B/C;
        this.x += a;
        this.y += b;
        //rotate to face direction of movement
        var newRad = Math.atan2(b,a) + Math.PI;
        if(newRad < Math.PI)newRad += Math.PI*2; //keep it between -PI and PI
        if(newRad > Math.PI)newRad -= Math.PI*2; //keep it between -PI and PI
        
        var diff = newRad - this.rad;
        if(Math.abs(diff) <= 0.1)this.rad = newRad;
        else if(diff > Math.PI)this.rad -= 0.1;
        else if(diff < -Math.PI)this.rad += 0.1;
        else if(diff < 0)this.rad -= 0.1;
        else if(diff > 0)this.rad += 0.1;
        if(this.rad < Math.PI)this.rad += Math.PI*2; //keep it between -PI and PI
        if(this.rad > Math.PI)this.rad -= Math.PI*2; //keep it between -PI and PI
        
    }
    
    //Line of sight is a physics raycast now (roadmap §3.2): the same VISION_BLOCKER
    //fixtures that stop bullets, filtered the same way. The grid-DDA raycaster this
    //replaced walked 40 cell boundaries and silently returned "no wall" past that, so
    //a long diagonal sightline could report clear through a building.
    this.doesSpriteSeeSprite = function(otherSprite){
        //Check if this sprite sees otherSprite
        var visionConeAngleForotherSprite = this.angleBetweenSprites_relativeToThis(otherSprite);
        if(visionConeAngleForotherSprite <= 1.22 && visionConeAngleForotherSprite >= -1.22){
            //if the otherSprite is within the guard's vision cone (1.22 rad ~== 70 degrees)
            //then this sprite will turn red, face otherSprite, and stop moving
            //the otherSprite then only has a few seconds before guard calls backup

            //but only if there are no walls between them:
            return physics.canSee(this.x,this.y,otherSprite.x,otherSprite.y);
        }else return false;

    };
    this.isRaycastUnobstructedBetweenThese = function(otherSprite){
        //returns true if there are no walls between these sprites.
        return physics.canSee(this.x,this.y,otherSprite.x,otherSprite.y);
    }
    this.isRaycastUnobstructedBetweenTheseIgnoreDoor = function(otherSprite){
        //returns true if there are no walls (doors excepted) between these sprites.
        return physics.canSeeIgnoringDoors(this.x,this.y,otherSprite.x,otherSprite.y);
    }
    this.prepare_for_draw = function(){
        //var draw_coords = camera.relativePoint(this);
        this.sprite.position.x = this.x;
        this.sprite.position.y = this.y;
        this.sprite.rotation = this.rad;
        /*
        //tooltip
        this.tooltip.x = draw_coords.x;
        this.tooltip.y = draw_coords.y;
        var dist = get_distance(this.x,this.y,hero.x,hero.y);
        this.tooltip.text = ("dFromHero: " + Math.round(dist));*/
    };
    this.getCircleInfoForUtilityLib = function(){
        return {'center': {x:this.x,y:this.y}, 'radius':this.radius};
    };
    this.angleBetweenSprites = function(otherSprite){
        var deltax = otherSprite.x - this.x;
        var deltay = otherSprite.y - this.y;
        //return -Math.atan2(deltay,deltax)*180/3.14159 //in degrees
        return -Math.atan2(deltay,deltax); // in radians
    };
    this.angleBetweenSprites_relativeToThis = function(otherSprite){
        //this function uses the "this" sprite's current rotation as the origin axis for the angle
        var deltax = otherSprite.x - this.x;
        var deltay = otherSprite.y - this.y;
        //return -Math.atan2(deltay,deltax)*180/3.14159 //in degrees
        var result = this.sprite.rotation-Math.atan2(deltay,deltax); // in radians
        if(result > Math.PI)result -= Math.PI*2;
        if(result < -Math.PI)result += Math.PI*2;
        return result;
    };
    ////////////////////////////////////////////////////////////////////////////
    // Collision lives in src/physics/ (roadmap §3.2).
    //
    // Three functions used to be here and are all gone:
    //   collide()                 — corner pushout, run by the hero against the four
    //                               vertices of every one of the 1600 cells, every frame.
    //   collide_with_wall_sides() — the flat-side half of the same pushout.
    //   unit_to_unit_collide()    — O(n^2) guard separation.
    // Box2D's broadphase is the spatial partition this codebase never had, its contact
    // solver does the pushout, and guards finally collide with walls instead of trusting
    // the path they were handed.
    ////////////////////////////////////////////////////////////////////////////

}


// --- legacy global bridge ---------------------------------------------------
// This file used to be a classic <script> whose top-level declarations landed on
// `window`. It is an ES module now, so the functions below are republished as
// globals for the not-yet-extracted code that still reads them by bare name.
// See src/legacy-bridge.ts. Each extraction deletes another line from here.
Object.assign(window, { jo_sprite });

export {};
