/*******************************************************\
Copyright 2014,2015, Jordan O'Leary, All rights reserved.
If you would like to copy or use my code, you may contact
me at jdoleary@gmail.com
/*******************************************************/
import { physics } from '../physics';
import { gunDef } from '../systems/weapons';
function jo_gun(name,clip_size, silenced, automatic, bullets_per_shot, spread){
    this.name = name;
    //Data-driven stats (roadmap §8.2, Phase 8): guns now live in data/weapons.json. `id`
    //links an instance back to its table row; `damage`/`loudness` are read from there.
    //Kills are still one-shot (guards have no hitpoints), so `damage` is carried as data.
    this.id = null;
    this.damage = 100;
    this.loudness = silenced ? 2 : 8;
    //Clip_size is the amount of ammo per clip
    this.clip_size = clip_size;
    //ammo is how much ammo is in the current clip
    this.ammo = clip_size;
    //
    this.silenced = silenced;
    //automatic: if you can hold down to fire
    this.automatic = automatic;
    //bullets_per_shot: a shotgun has many bullets per shot, a pistol does not.
    this.bullets_per_shot = bullets_per_shot;
    //spread: how far apart the bullets per shot are.
    this.spread = spread;
    
    this.make_copy = function(){
        var copy = new jo_gun(this.name, this.clip_size, this.silenced, this.automatic, this.bullets_per_shot, this.spread);
        copy.id = this.id;
        copy.damage = this.damage;
        copy.loudness = this.loudness;
        return copy;
    }
    this.reload = function(unit){
        unit.reloading = true;
        var reload_speed = 2000;
        if(unit.reload_speed)reload_speed = unit.reload_speed;
        //reload the gun in 2 seconds
        circProgBar.reset(hero.x,hero.y,reload_speed,function(){ 
            //add ammo to gun's ammo
            this.ammo = this.clip_size;
            //set reloadingn to false so unit can reload again if they need to
            unit.reloading = false;
        }.bind(this));
        circProgBar.follow = hero;
    }
    //unit is the unit doing the shooting:
    this.shoot = function(unit){
        for(var b = 0; b < this.bullets_per_shot; b++){
            
            //make bullet (all assets in main.js):
            var bullet = new jo_sprite(new PIXI.Sprite(img_bullet));
            bullet.ignore = unit;//don't kill the shooter with own bullet
            bullet.x = unit.x;
            bullet.y = unit.y;
            //if spread is 30 deg, the randomRot will be between -15 and 15
            var randomRot = randomIntFromInterval(-this.spread/2,this.spread/2);
            //console.log('random rot: ' + randomRot);
            var endPoint = rotate_point_about_axis({x:unit.x,y:unit.y},randomRot,{x:unit.aim.end.x,y:unit.aim.end.y});
            //A bullet keeps flying until it hits something — it must not stop at the point
            //under the cursor. `aim.end` reaches only as far as the mouse (or the first wall),
            //so extend the shot's direction well past the map and let sightStop find the wall
            //it actually runs into. gameloop_bullets raycasts each step, so anyone standing in
            //the way is still hit before the bullet ever reaches that far wall.
            var aimDX = endPoint.x - unit.x;
            var aimDY = endPoint.y - unit.y;
            var aimLen = Math.sqrt(aimDX*aimDX + aimDY*aimDY);
            if(aimLen > 0){
                var BULLET_REACH = 5000;//comfortably beyond the map's diagonal; the border walls stop the ray
                endPoint = {x: unit.x + aimDX/aimLen*BULLET_REACH, y: unit.y + aimDY/aimLen*BULLET_REACH};
            }
            //where this shot stops if nobody is in the way; gameloop_bullets
            //raycasts each step to find out who actually is
            bullet.target = physics.sightStop(unit.x,unit.y,endPoint.x,endPoint.y);
            bullet.rotate_to_instant(bullet.target.x,bullet.target.y);
            if(this.automatic == true)bullet.speed = randomIntFromInterval(30,80);
            else bullet.speed = 75;
            //bullet.speed = 10;//slow motion bullets!
            bullet.stop_distance = bullet.speed;
            bullets.push(bullet);
            
            //end make bullet
            
            
            unit.rotate_to_instant(bullet.target.x,bullet.target.y);
        }
    
    }
   
}
//these are prefabs only, instances should be made with make_copy();
//Each prefab is tagged with its data/weapons.json id, then its damage/loudness are read
//from that table (roadmap §8.2). The shooting numbers (clip/spread/etc.) still come from
//the constructor for now; the id is the seam that lets a future editor drive it all.
function withStats(gun, id){
    var def = gunDef(id);
    gun.id = id;
    if(def){ gun.damage = def.damage; gun.loudness = def.loudness; }
    return gun;
}
window.gun_shotgun = withStats(new jo_gun("Shotgun", 6,false,false,8,30), "shotgun");
window.gun_shotgun_sawed_off = withStats(new jo_gun("Sawed-Off Shotty", 6,false,false,8,90), "shotgun_sawed_off");
window.gun_pistol = withStats(new jo_gun("Handgun",8,false,false,1,0), "pistol");
window.gun_pistol_silenced = withStats(new jo_gun("Silenced Handgun",8,true,false,1,0), "pistol_silenced");
window.gun_machine = withStats(new jo_gun("Machine Gun", 600,false,true,1,3), "machine_gun");
window.all_gun_prefabs = [gun_shotgun,gun_shotgun_sawed_off,gun_pistol,gun_pistol_silenced,gun_machine];
window.all_gun_prefabs_without_sawed = [gun_shotgun,gun_pistol,gun_pistol_silenced,gun_machine];

//Phase 10 (map editor): find a gun prefab by its data/weapons.json id (the seam the withStats
//comment above anticipated). Returns the prefab, or null for an unknown id — the caller keeps
//the constructor's random gun in that case, so a stray id never crashes a spawn.
function gunPrefabById(id){
    for(var g = 0; g < all_gun_prefabs.length; g++){
        if(all_gun_prefabs[g].id === id) return all_gun_prefabs[g];
    }
    return null;
}
window.gunPrefabById = gunPrefabById;


// --- legacy global bridge ---------------------------------------------------
// This file used to be a classic <script> whose top-level declarations landed on
// `window`. It is an ES module now, so the functions below are republished as
// globals for the not-yet-extracted code that still reads them by bare name.
// See src/legacy-bridge.ts. Each extraction deletes another line from here.
Object.assign(window, { jo_gun });

export {};
