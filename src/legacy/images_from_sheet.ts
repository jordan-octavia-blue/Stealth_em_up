/*
NOTE: when using a sprite sheet, load with (a) not (b)

            (a)var sprite = new PIXI.Sprite(img_tile_black);
            (b)var sprite = new PIXI.Sprite.fromImage(img_tile_black);
*/

function onAssetsLoaded(){
    console.log('loading finished');
    //INIT GLOBAL IMAGE VARS
    
    window.img_bullet= PIXI.Texture.fromFrame(("bullet3x.png"));
    window.img_bomb= PIXI.Texture.fromFrame(("c4.png"));

    window.img_security_camera= PIXI.Texture.fromFrame(("camera.png"));
    window.img_security_camera_alerted= PIXI.Texture.fromFrame(("camera_alert.png"));
    window.img_cam_broken= PIXI.Texture.fromFrame(("camera_broken.png"));
    window.img_cam_off= PIXI.Texture.fromFrame(("camera_off.png"));

    window.img_computer= PIXI.Texture.fromFrame(("computer.png"));
    window.img_computer_off= PIXI.Texture.fromFrame(("computer_off.png"));
    window.img_door_closed= PIXI.Texture.fromFrame(("door_closed.png"));
    window.img_door_open= PIXI.Texture.fromFrame(("door_open.png"));
    window.img_guard_reg= PIXI.Texture.fromFrame(("guard.png"));
    window.img_guard_riot_reg= PIXI.Texture.fromFrame(("guard_riot.png"));
    window.img_guard_alert= PIXI.Texture.fromFrame(("guard_alert.png"));
    window.img_guard_riot_alert= PIXI.Texture.fromFrame(("guard_riot_alert.png"));
    window.img_guard_knows_hero_face= PIXI.Texture.fromFrame(("guard_alert_knows_face.png"));
    window.img_guard_riot_knows_face = PIXI.Texture.fromFrame(("guard_riot_knows_face.png"));
    window.img_guard_choke= PIXI.Texture.fromFrame(("guard_choke.png"));
    window.img_guard_dead= PIXI.Texture.fromFrame(("guard_dead.png"));
    window.img_guard_drag= PIXI.Texture.fromFrame(("guard_dragging.png"));
    window.img_guard_spawn_icon= PIXI.Texture.fromFrame(("guard_spawn_icon.png"));
    window.img_blue= PIXI.Texture.fromFrame(("hero_body_1.png"));
    window.img_hero_with_money= PIXI.Texture.fromFrame(("hero_body_1_bag.png"));
    //? double hero_body_1_masked
    window.img_masked= PIXI.Texture.fromFrame(("hero_body_1_masked.png"));
    window.img_hero_with_pistol = PIXI.Texture.fromFrame(("hero_body_1_masked.png"));
    window.img_hero_with_pistol_silenced= PIXI.Texture.fromFrame(("hero_body_1_masked_handgun_silenced.png"));
    window.img_hero_with_machine_gun= PIXI.Texture.fromFrame(("hero_body_1_masked_machine.png"));
    window.img_hero_with_shotty= PIXI.Texture.fromFrame(("hero_body_1_masked_shotgun.png"));
    window.img_hero_with_shotty_sawed= PIXI.Texture.fromFrame(("hero_body_1_masked_shotty_sawed.png"));
    window.img_hero_dead= PIXI.Texture.fromFrame(("hero_dead.png"));
    window.img_doodad_lamp= PIXI.Texture.fromFrame(("lamp.png"));
    window.img_lastSeen= PIXI.Texture.fromFrame(("last_seen.png"));
    window.img_gun_machine= PIXI.Texture.fromFrame(("machine-gun2.png"));
    window.img_money= PIXI.Texture.fromFrame(("money.png"));
    window.img_doodad_paper= PIXI.Texture.fromFrame(("papers.png"));
    window.img_gun_pistol= PIXI.Texture.fromFrame(("pistol.png"));
    window.img_player_spawn_icon= PIXI.Texture.fromFrame(("player_spawn_icon.png"));
    window.img_gun_shotgun_sawed= PIXI.Texture.fromFrame(("sawed-shotgun.png"));
    window.img_shard_1= PIXI.Texture.fromFrame(("shard.png"));
    window.img_shard_2= PIXI.Texture.fromFrame(("shard2.png"));
    window.img_shard_3= PIXI.Texture.fromFrame(("shard3.png"));
    window.img_shell= PIXI.Texture.fromFrame(("shell.png"));
    window.img_gun_shotgun= PIXI.Texture.fromFrame(("shotgun.png"));
    window.img_gun_pistol_silenced= PIXI.Texture.fromFrame(("silenced_pistol.png"));

    
    window.img_getawaycar= PIXI.Texture.fromFrame(("van.png"));
    window.img_hero_body = PIXI.Texture.fromFrame("body.png");
    window.img_hero_head = PIXI.Texture.fromFrame(("head.png"));
    window.img_origin = PIXI.Texture.fromFrame(("last_seen.png"));
    window.img_hero_head_masked = PIXI.Texture.fromFrame(("head_masked.png"));
    window.img_spyglass = PIXI.Texture.fromFrame(("spyglass.png"));
    
        //Image based initialization
    window.shardImages = [img_shard_1,img_shard_2,img_shard_3];
    window.currentShard = shardImages[shardType];
    
    startMenu();//init menu
    requestAnimationFrame(animate);//start main loop
    
}
/*
function prepFileNamesObject(){
    //Highlight json and press Ctrl+j to put it on one line
    var json = {"frames": [  { 	"filename": "body.png", 	"frame": {"x":2,"y":1238,"w":21,"h":40}, 	"rotated": true, 	"trimmed": true, 	"spriteSourceSize": {"x":21,"y":10,"w":21,"h":40}, 	"sourceSize": {"w":64,"h":64}, 	"pivot": {"x":0.5,"y":0.5} }, { 	"filename": "bullet3x.png", 	"frame": {"x":91,"y":302,"w":29,"h":6}, 	"rotated": false, 	"trimmed": true, 	"spriteSourceSize": {"x":35,"y":29,"w":29,"h":6}, 	"sourceSize": {"w":64,"h":64}, 	"pivot": {"x":0.5,"y":0.5} }, { 	"filename": "c4.png", 	"frame": {"x":68,"y":921,"w":36,"h":58}, 	"rotated": true, 	"trimmed": true, 	"spriteSourceSize": {"x":12,"y":1,"w":36,"h":58}, 	"sourceSize": {"w":64,"h":64}, 	"pivot": {"x":0.5,"y":0.5} }, { 	"filename": "camera.png", 	"frame": {"x":68,"y":618,"w":58,"h":128}, 	"rotated": false, 	"trimmed": true, 	"spriteSourceSize": {"x":29,"y":0,"w":58,"h":128}, 	"sourceSize": {"w":128,"h":128}, 	"pivot": {"x":0.5,"y":0.5} }, { 	"filename": "camera_alert.png", 	"frame": {"x":68,"y":748,"w":58,"h":128}, 	"rotated": false, 	"trimmed": true, 	"spriteSourceSize": {"x":29,"y":0,"w":58,"h":128}, 	"sourceSize": {"w":128,"h":128}, 	"pivot": {"x":0.5,"y":0.5} }, { 	"filename": "camera_broken.png", 	"frame": {"x":107,"y":1178,"w":36,"h":11}, 	"rotated": true, 	"trimmed": true, 	"spriteSourceSize": {"x":29,"y":59,"w":36,"h":11}, 	"sourceSize": {"w":128,"h":128}, 	"pivot": {"x":0.5,"y":0.5} }, { 	"filename": "camera_off.png", 	"frame": {"x":107,"y":1216,"w":36,"h":11}, 	"rotated": true, 	"trimmed": true, 	"spriteSourceSize": {"x":29,"y":59,"w":36,"h":11}, 	"sourceSize": {"w":128,"h":128}, 	"pivot": {"x":0.5,"y":0.5} }, { 	"filename": "computer.png", 	"frame": {"x":2,"y":608,"w":64,"h":64}, 	"rotated": false, 	"trimmed": false, 	"spriteSourceSize": {"x":0,"y":0,"w":64,"h":64}, 	"sourceSize": {"w":64,"h":64}, 	"pivot": {"x":0.5,"y":0.5} }, { 	"filename": "computer_off.png", 	"frame": {"x":2,"y":674,"w":64,"h":64}, 	"rotated": false, 	"trimmed": false, 	"spriteSourceSize": {"x":0,"y":0,"w":64,"h":64}, 	"sourceSize": {"w":64,"h":64}, 	"pivot": {"x":0.5,"y":0.5} }, { 	"filename": "door_closed.png", 	"frame": {"x":2,"y":1070,"w":17,"h":64}, 	"rotated": true, 	"trimmed": true, 	"spriteSourceSize": {"x":0,"y":0,"w":17,"h":64}, 	"sourceSize": {"w":64,"h":64}, 	"pivot": {"x":0.5,"y":0.5} }, { 	"filename": "door_open.png", 	"frame": {"x":2,"y":1089,"w":17,"h":64}, 	"rotated": true, 	"trimmed": true, 	"spriteSourceSize": {"x":0,"y":0,"w":17,"h":64}, 	"sourceSize": {"w":64,"h":64}, 	"pivot": {"x":0.5,"y":0.5} }, { 	"filename": "guard.png", 	"frame": {"x":91,"y":310,"w":25,"h":40}, 	"rotated": false, 	"trimmed": true, 	"spriteSourceSize": {"x":50,"y":43,"w":25,"h":40}, 	"sourceSize": {"w":128,"h":128}, 	"pivot": {"x":0.5,"y":0.5} }, { 	"filename": "guard_alert.png", 	"frame": {"x":70,"y":575,"w":53,"h":41}, 	"rotated": false, 	"trimmed": true, 	"spriteSourceSize": {"x":50,"y":43,"w":53,"h":41}, 	"sourceSize": {"w":128,"h":128}, 	"pivot": {"x":0.5,"y":0.5} }, { 	"filename": "guard_alert_knows_face.png", 	"frame": {"x":2,"y":311,"w":77,"h":73}, 	"rotated": false, 	"trimmed": true, 	"spriteSourceSize": {"x":26,"y":28,"w":77,"h":73}, 	"sourceSize": {"w":128,"h":128}, 	"pivot": {"x":0.5,"y":0.5} }, { 	"filename": "guard_choke.png", 	"frame": {"x":68,"y":959,"w":37,"h":50}, 	"rotated": true, 	"trimmed": true, 	"spriteSourceSize": {"x":46,"y":39,"w":37,"h":50}, 	"sourceSize": {"w":128,"h":128}, 	"pivot": {"x":0.5,"y":0.5} }, { 	"filename": "guard_dead.png", 	"frame": {"x":2,"y":158,"w":122,"h":49}, 	"rotated": false, 	"trimmed": true, 	"spriteSourceSize": {"x":6,"y":40,"w":122,"h":49}, 	"sourceSize": {"w":128,"h":128}, 	"pivot": {"x":0.5,"y":0.5} }, { 	"filename": "guard_dragging.png", 	"frame": {"x":2,"y":260,"w":87,"h":49}, 	"rotated": false, 	"trimmed": true, 	"spriteSourceSize": {"x":41,"y":40,"w":87,"h":49}, 	"sourceSize": {"w":128,"h":128}, 	"pivot": {"x":0.5,"y":0.5} }, { 	"filename": "guard_spawn_icon.png", 	"frame": {"x":2,"y":520,"w":66,"h":42}, 	"rotated": false, 	"trimmed": true, 	"spriteSourceSize": {"x":37,"y":41,"w":66,"h":42}, 	"sourceSize": {"w":128,"h":128}, 	"pivot": {"x":0.5,"y":0.5} }, { 	"filename": "head.png", 	"frame": {"x":107,"y":1128,"w":23,"h":18}, 	"rotated": true, 	"trimmed": true, 	"spriteSourceSize": {"x":27,"y":24,"w":23,"h":18}, 	"sourceSize": {"w":64,"h":64}, 	"pivot": {"x":0.5,"y":0.5} }, { 	"filename": "head_masked.png", 	"frame": {"x":107,"y":1153,"w":23,"h":18}, 	"rotated": true, 	"trimmed": true, 	"spriteSourceSize": {"x":27,"y":24,"w":23,"h":18}, 	"sourceSize": {"w":64,"h":64}, 	"pivot": {"x":0.5,"y":0.5} }, { 	"filename": "hero_body_1.png", 	"frame": {"x":91,"y":260,"w":29,"h":40}, 	"rotated": false, 	"trimmed": true, 	"spriteSourceSize": {"x":21,"y":10,"w":29,"h":40}, 	"sourceSize": {"w":64,"h":64}, 	"pivot": {"x":0.5,"y":0.5} }, { 	"filename": "hero_body_1_bag.png", 	"frame": {"x":44,"y":1265,"w":41,"h":40}, 	"rotated": true, 	"trimmed": true, 	"spriteSourceSize": {"x":9,"y":10,"w":41,"h":40}, 	"sourceSize": {"w":64,"h":64}, 	"pivot": {"x":0.5,"y":0.5} }, { 	"filename": "hero_body_1_masked.png", 	"frame": {"x":70,"y":531,"w":56,"h":42}, 	"rotated": false, 	"trimmed": true, 	"spriteSourceSize": {"x":48,"y":42,"w":56,"h":42}, 	"sourceSize": {"w":128,"h":128}, 	"pivot": {"x":0.5,"y":0.5} }, { 	"filename": "hero_body_1_masked_handgun_silenced.png", 	"frame": {"x":2,"y":476,"w":67,"h":42}, 	"rotated": false, 	"trimmed": true, 	"spriteSourceSize": {"x":48,"y":42,"w":67,"h":42}, 	"sourceSize": {"w":128,"h":128}, 	"pivot": {"x":0.5,"y":0.5} }, { 	"filename": "hero_body_1_masked_machine.png", 	"frame": {"x":2,"y":431,"w":69,"h":43}, 	"rotated": false, 	"trimmed": true, 	"spriteSourceSize": {"x":47,"y":41,"w":69,"h":43}, 	"sourceSize": {"w":128,"h":128}, 	"pivot": {"x":0.5,"y":0.5} }, { 	"filename": "hero_body_1_masked_shotgun.png", 	"frame": {"x":2,"y":386,"w":72,"h":43}, 	"rotated": false, 	"trimmed": true, 	"spriteSourceSize": {"x":47,"y":41,"w":72,"h":43}, 	"sourceSize": {"w":128,"h":128}, 	"pivot": {"x":0.5,"y":0.5} }, { 	"filename": "hero_body_1_masked_shotty_sawed.png", 	"frame": {"x":81,"y":353,"w":77,"h":43}, 	"rotated": true, 	"trimmed": true, 	"spriteSourceSize": {"x":48,"y":41,"w":77,"h":43}, 	"sourceSize": {"w":128,"h":128}, 	"pivot": {"x":0.5,"y":0.5} }, { 	"filename": "hero_dead.png", 	"frame": {"x":2,"y":209,"w":121,"h":49}, 	"rotated": false, 	"trimmed": true, 	"spriteSourceSize": {"x":7,"y":40,"w":121,"h":49}, 	"sourceSize": {"w":128,"h":128}, 	"pivot": {"x":0.5,"y":0.5} }, { 	"filename": "lamp.png", 	"frame": {"x":73,"y":432,"w":53,"h":52}, 	"rotated": false, 	"trimmed": true, 	"spriteSourceSize": {"x":8,"y":5,"w":53,"h":52}, 	"sourceSize": {"w":64,"h":64}, 	"pivot": {"x":0.5,"y":0.5} }, { 	"filename": "last_seen.png", 	"frame": {"x":86,"y":1265,"w":38,"h":40}, 	"rotated": true, 	"trimmed": true, 	"spriteSourceSize": {"x":12,"y":10,"w":38,"h":40}, 	"sourceSize": {"w":64,"h":64}, 	"pivot": {"x":0.5,"y":0.5} }, { 	"filename": "machine-gun2.png", 	"frame": {"x":68,"y":998,"w":128,"h":48}, 	"rotated": true, 	"trimmed": true, 	"spriteSourceSize": {"x":0,"y":0,"w":128,"h":48}, 	"sourceSize": {"w":128,"h":128}, 	"pivot": {"x":0.5,"y":0.5} }, { 	"filename": "money.png", 	"frame": {"x":71,"y":486,"w":43,"h":53}, 	"rotated": true, 	"trimmed": true, 	"spriteSourceSize": {"x":12,"y":4,"w":43,"h":53}, 	"sourceSize": {"w":64,"h":64}, 	"pivot": {"x":0.5,"y":0.5} }, { 	"filename": "papers.png", 	"frame": {"x":2,"y":1265,"w":40,"h":41}, 	"rotated": false, 	"trimmed": true, 	"spriteSourceSize": {"x":8,"y":14,"w":40,"h":41}, 	"sourceSize": {"w":64,"h":64}, 	"pivot": {"x":0.5,"y":0.5} }, { 	"filename": "pistol.png", 	"frame": {"x":2,"y":564,"w":66,"h":42}, 	"rotated": false, 	"trimmed": true, 	"spriteSourceSize": {"x":0,"y":0,"w":66,"h":42}, 	"sourceSize": {"w":128,"h":128}, 	"pivot": {"x":0.5,"y":0.5} }, { 	"filename": "player_spawn_icon.png", 	"frame": {"x":68,"y":878,"w":58,"h":41}, 	"rotated": false, 	"trimmed": true, 	"spriteSourceSize": {"x":37,"y":41,"w":58,"h":41}, 	"sourceSize": {"w":128,"h":128}, 	"pivot": {"x":0.5,"y":0.5} }, { 	"filename": "sawed-shotgun.png", 	"frame": {"x":2,"y":119,"w":123,"h":37}, 	"rotated": false, 	"trimmed": true, 	"spriteSourceSize": {"x":3,"y":4,"w":123,"h":37}, 	"sourceSize": {"w":128,"h":128}, 	"pivot": {"x":0.5,"y":0.5} }, { 	"filename": "selector.png", 	"frame": {"x":2,"y":740,"w":64,"h":64}, 	"rotated": false, 	"trimmed": false, 	"spriteSourceSize": {"x":0,"y":0,"w":64,"h":64}, 	"sourceSize": {"w":64,"h":64}, 	"pivot": {"x":0.5,"y":0.5} }, { 	"filename": "shard.png", 	"frame": {"x":118,"y":328,"w":8,"h":11}, 	"rotated": false, 	"trimmed": true, 	"spriteSourceSize": {"x":3,"y":3,"w":8,"h":11}, 	"sourceSize": {"w":16,"h":16}, 	"pivot": {"x":0.5,"y":0.5} }, { 	"filename": "shard2.png", 	"frame": {"x":107,"y":1254,"w":9,"h":9}, 	"rotated": false, 	"trimmed": true, 	"spriteSourceSize": {"x":2,"y":4,"w":9,"h":9}, 	"sourceSize": {"w":16,"h":16}, 	"pivot": {"x":0.5,"y":0.5} }, { 	"filename": "shard3.png", 	"frame": {"x":118,"y":341,"w":10,"h":7}, 	"rotated": true, 	"trimmed": true, 	"spriteSourceSize": {"x":2,"y":6,"w":10,"h":7}, 	"sourceSize": {"w":16,"h":16}, 	"pivot": {"x":0.5,"y":0.5} }, { 	"filename": "shell.png", 	"frame": {"x":118,"y":310,"w":8,"h":16}, 	"rotated": false, 	"trimmed": true, 	"spriteSourceSize": {"x":4,"y":0,"w":8,"h":16}, 	"sourceSize": {"w":16,"h":16}, 	"pivot": {"x":0.5,"y":0.5} }, { 	"filename": "shotgun.png", 	"frame": {"x":2,"y":2,"w":123,"h":115}, 	"rotated": false, 	"trimmed": true, 	"spriteSourceSize": {"x":2,"y":4,"w":123,"h":115}, 	"sourceSize": {"w":128,"h":128}, 	"pivot": {"x":0.5,"y":0.5} }, { 	"filename": "silenced_pistol.png", 	"frame": {"x":63,"y":1128,"w":128,"h":42}, 	"rotated": true, 	"trimmed": true, 	"spriteSourceSize": {"x":0,"y":0,"w":128,"h":42}, 	"sourceSize": {"w":128,"h":128}, 	"pivot": {"x":0.5,"y":0.5} }, { 	"filename": "tile_black.png", 	"frame": {"x":2,"y":806,"w":64,"h":64}, 	"rotated": false, 	"trimmed": false, 	"spriteSourceSize": {"x":0,"y":0,"w":64,"h":64}, 	"sourceSize": {"w":64,"h":64}, 	"pivot": {"x":0.5,"y":0.5} }, { 	"filename": "tile_brown.png", 	"frame": {"x":2,"y":872,"w":64,"h":64}, 	"rotated": false, 	"trimmed": false, 	"spriteSourceSize": {"x":0,"y":0,"w":64,"h":64}, 	"sourceSize": {"w":64,"h":64}, 	"pivot": {"x":0.5,"y":0.5} }, { 	"filename": "tile_red.png", 	"frame": {"x":2,"y":938,"w":64,"h":64}, 	"rotated": false, 	"trimmed": false, 	"spriteSourceSize": {"x":0,"y":0,"w":64,"h":64}, 	"sourceSize": {"w":64,"h":64}, 	"pivot": {"x":0.5,"y":0.5} }, { 	"filename": "tile_white.png", 	"frame": {"x":2,"y":1004,"w":64,"h":64}, 	"rotated": false, 	"trimmed": false, 	"spriteSourceSize": {"x":0,"y":0,"w":64,"h":64}, 	"sourceSize": {"w":64,"h":64}, 	"pivot": {"x":0.5,"y":0.5} }, { 	"filename": "van.png", 	"frame": {"x":2,"y":1108,"w":128,"h":59}, 	"rotated": true, 	"trimmed": true, 	"spriteSourceSize": {"x":0,"y":0,"w":128,"h":59}, 	"sourceSize": {"w":128,"h":128}, 	"pivot": {"x":0.5,"y":0.5} }], "meta": { 	"app": "http://www.codeandweb.com/texturepacker", 	"version": "1.0", 	"image": "spritesheet.png", 	"format": "RGBA8888", 	"size": {"w":128,"h":1311}, 	"scale": "1", 	"smartupdate": "$TexturePacker:SmartUpdate:36ea991511b37259d0b0dbfe1ca25dbe:621c89c1c8e2d7ee551b5ec85dfc6d89:729adc6043343cfda41c447ce8f464d6$" } };
    for(var i in json.frames){
        fileNames[json.frames[i].filename] = json.frames[i];
    }
}
function getImageRectangleFromTexturePacker(filename){

    var fileInfo = fileNames[filename];
    var rect;
    if(!fileInfo.rotated)rect = new PIXI.Rectangle(fileInfo.frame.x,fileInfo.frame.y,fileInfo.frame.w,fileInfo.frame.h);
    else rect = new PIXI.Rectangle(fileInfo.frame.x,fileInfo.frame.y,fileInfo.frame.h,fileInfo.frame.w);
    console.log('loaded: ' + filename + " : " + rect.x + " " + rect.y + " " + rect.width + " " + rect.height);
    return rect;
}
function getFileInfoFromTexturePacker(filename){
    return fileNames[filename];
}
function getTextureFromTexturePacker(filename){
    var newTex = new PIXI.Texture(spriteSheet.baseTexture, getImageRectangleFromTexturePacker(filename));
    newTex.rotated = getFileInfoFromTexturePacker(filename).rotated;
    return newTex;
}*/

// --- legacy global bridge ---------------------------------------------------
// This file used to be a classic <script> whose top-level declarations landed on
// `window`. It is an ES module now, so the functions below are republished as
// globals for the not-yet-extracted code that still reads them by bare name.
// See src/legacy-bridge.ts. Each extraction deletes another line from here.
Object.assign(window, { onAssetsLoaded });

export {};
