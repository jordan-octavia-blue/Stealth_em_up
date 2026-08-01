//sets the upgrades as a global variable so that the game can init from the player's upgrades
//These values are loaded into sprite_hero.js
window.upgrades = {
    "hero_health":1,//jo_store_get("hero_health"),//implemented
    "kick_doors":0,//jo_store_get("kick_doors"),
    "auto_pickup_ammo":false,//jo_store_get("auto_pickup_ammo"),
    "NumOfGunsHold":1,//jo_store_get("NumOfGunsHold"),
    "RemoteLockpick":false,//jo_store_get("RemoteLockpick"),
    "Run_speed":8,//jo_store_get("Run_speed"),//implemented
    "Lockpick_speed":5000,//jo_store_get("Lockpick_speed"),//implemented
    "Reload_speed":2000,//jo_store_get("Reload_speed"),//implemented
    "Toggle_mask":500,//jo_store_get("Toggle_mask"),//implemented
    "Choke_speed":4000,//jo_store_get("Choke_speed"),//implemented
    "Drag_body_speed":4,//jo_store_get("Drag_body_speed"),//implemented
    "Timed_bomb":false,//jo_store_get("Timed_bomb"),
    "Remote_bomb":jo_store_get("Remote_bomb"),
    "Body_armor":jo_store_get("Body_armor"),
    "Plastic_surgery":jo_store_get("Plastic_surgery")
};
//convert sting to bool if bool string
for(var key in upgrades){
    if(upgrades[key]==="false")upgrades[key]=false;
    if(upgrades[key]==="true")upgrades[key]=true;
}

// --- legacy global bridge ---------------------------------------------------
// This file used to be a classic <script> whose top-level declarations landed on
// `window`. It is an ES module now, so the functions below are republished as
// globals for the not-yet-extracted code that still reads them by bare name.
// See src/legacy-bridge.ts. Each extraction deletes another line from here.
// (no top-level function declarations in this file)

export {};
