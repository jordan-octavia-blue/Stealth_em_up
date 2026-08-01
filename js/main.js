/*******************************************************\
Copyright 2014,2015, Jordan O'Leary, All rights reserved.
If you would like to copy or use my code, you may contact
me at jdoleary@gmail.com
/*******************************************************/
////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////
/*
Window Setup
*/
////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////
var stats;
var stage;
var window_properties;
var renderer;
var mouse_relative = {x:0,y:0};
const enableLOS = false

var wabbitTexture = new PIXI.Texture.fromImage("../images/shell.png")
var	particle_container;	
var shell1;
var shell2;
var shell3;
var shell4;
var shell5;
var shell_speed = 10;
var blood_speed = 1;

var	shellTextures = [];
var	shellType = 2;
var shells;
var shards;
var bloods;
var	currentTexture;

//

var pause = false;
//show tooltips:
var show_sprite_tooltips = false;
var debug_on = false;

function getColor(x,y){
    return {r:50,g:50,b:50,a:1};
}
function mouseMove(e){
    mouse_relative.x = e.pageX;
    mouse_relative.y = e.pageY;
    
}
function windowSetup(){
    //Mr Doob's Stats.js:
    stats = new Stats();
    stats.domElement.style.position = 'absolute';
    stats.domElement.style.left = '8px';
    stats.domElement.style.top = '8px';
    document.body.appendChild( stats.domElement );

    window.onmousemove = mouseMove;


    //make sure that width value is the same in index.html's style
    //var window_properties = {width: 620*2, height: 400*2};

    window_properties = {width: window.innerWidth, height: window.innerHeight};

    // create a renderer instance.
    var renderOptions = {
        resolution:window.devicePixelRatio
    };
    renderer = PIXI.autoDetectRenderer(window_properties.width, window_properties.height,renderOptions);
    // add the renderer view element to the DOM

    document.getElementById("canvas_holder").appendChild(renderer.view);
    //document.body.appendChild(renderer.view);

    PIXI.loader
    .add('images/spritesheet.json')
    .load(onAssetsLoaded);
    
    console.log(PIXI.loader);

    
}


function fullscreen() {
    var
          el = document.documentElement
        , rfs =
               el.requestFullScreen
            || el.webkitRequestFullscreen
            || el.mozRequestFullScreen
            || el.msRequestFullscreen
    ;
    // Temporarily disable full screen
    // rfs.call(el);
    startGame();
}






var mouse;
var keys;
var clickEvent;

var stage_child;


/*
New LOS Graphics:
*/
var losTexture;
var losSprite;
//a big transparent rectangle of black that covers the whole grid
var losShade;
var losShadeContainer;
//the mask for losShade which will be rendered on to losTexture
var losPathGraphics;
var losPathGraphicsContainer;

var spyglassPos;
//
//Change to hero.losPoints: var losPoints;//the constantly updated list of points and angles that allows for drawing the losPath;

var grid_width;
var grid_height;

var gun_drops;

//zoom:
var zoom;
var zoom_magnitude;


var look_sensitivity;

//display object containers that hold the layers of everything.
var display_tiles;
var display_blood;
var display_effects;
var display_actors;
var display_guards;
var display_tiles_walls;


////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////
/*
Map / Game Object Setup
*/
////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////    


//doodads
var doodads;

//bomb
var bomb;
var bombs_left;
var bomb_fuse_start;
var bomb_fuse;
var bomb_ticking;//true while the fuse is counting down in the game loop
var bomb_scale_variety;//phase of the bomb tooltip's pulsing scale
var bomb_tooltip;
var bomb_radius_debug;
var bomb_radius;

var blood_trail;
//Blood splats are drawn into blood_trail's PIXI.Graphics with noClear, so its draw-command
//list grew without bound for the whole run. Instead we periodically bake the accumulated
//splats into a RenderTexture and clear the Graphics, so the live command list stays small.
var blood_trail_texture;
var blood_trail_sprite;
var blood_trail_pending = 0;
var BLOOD_TRAIL_BAKE_EVERY = 200;//splats buffered in the Graphics before baking
//Draw one blood splat onto the persistent trail, baking down to the RenderTexture when the
//live Graphics has buffered enough of them.
function drawBloodTrail(x,y,size){
    blood_trail.draw(x,y,size,true);
    blood_trail_pending++;
    if(blood_trail_pending >= BLOOD_TRAIL_BAKE_EVERY)bakeBloodTrail();
}
function bakeBloodTrail(){
    if(!blood_trail_texture)return;
    //clear:false so the texture keeps everything baked before this
    blood_trail_texture.render(blood_trail.graphics,null,false);
    blood_trail.graphics.clear();
    blood_trail_pending = 0;
}


//grid/map
var grid;


//camera/debug
var camera;
var cameras_disabled;
//var //test_cone;
//var hero_cir;

//visible bullets:
var bullets;


			//make sprites
            var hero;
            var hero_last_seen;
            var hero_end_aim_coord;
            var starburst;
            var debug_LOS_starburst = false; 
            var starburst_ray;
            var starburst_angles;
            
			
			var hero_drag_target; // a special var reserved for when the hero is dragging something.
			var guards;
            var guard_backup_spawn;
            var numOfBackupGuards;
            var backupCalled;//true when backup has been called so it cannot be called again
			

			
			var computer_for_security_cameras;
			
			//security camera
			var security_cameras;

var alarmingObjects;//guards will sound alarm if they see an alarming object (dead bodies)


			//Loot and Getaway car:
			var getawaycar;
			var loot;

  
//UI text.  Use newMessage() to add a message.
var message;
var messageText;
var messageGameOver;

//floating messages:
var messages_floating;

//Tooltip text:
var tooltip;
var tooltipshown;

//MOVIE CLIPS:
var alert_clip;

var latestAlert;//the last unit to be alerted (used to show alert icon)

//effects:
var static_effect_sprites;

//how far hero has to be from something to drag it:
var dragDistance;


var states = {"StartMenu":0,"Gameplay":1};
var state;

//circular progress bar:
var circProgBar;

//notify guards of new hero location flag
var notifyGuardsOfHeroLocation = false;



function getUrlVars()
{
    var vars = [], hash;
    var hashes = window.location.href.slice(window.location.href.indexOf('?') + 1).split('&');
    for(var i = 0; i < hashes.length; i++)
    {
        hash = hashes[i].split('=');
        vars.push(hash[0]);
        vars[hash[0]] = hash[1];
    }
    return vars;
}
////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////
/*
Entry Point
*/
////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////
var url_queryString = getUrlVars();
if(url_queryString["volume"]){
    var newVol = url_queryString["volume"];
    volume_master = newVol;
    readjustVolumes();
}

var mapName;
if(url_queryString["level"]){
    mapName = url_queryString["level"];
    getMapInfo("maps", mapName + ".jomap");
}else{
    getMapInfo("maps", "bank_1.jomap");
}

        
function removeAllChildren(obj){
    if(obj){
        for (var i = obj.children.length - 1; i >= 0; i--) {
            obj.removeChild(obj.children[i]);
        };
    }
}
function clearStage(){
    for(var i = 0; i < buttons.length; i++){
        var button = buttons[i];
        //for menu:
        if(button){
            button.interactive = false;
            button.click = null;
            button = null;
        }
    }
    //clear all timeouts
    var id = window.setTimeout(function() {}, 0);
    while (id--) {
        window.clearTimeout(id); // will do nothing if no timeout with id is present
    }

    //removeHandlers:
    console.log('clear stage');
    removeHandlers();
    //remove all children:
    removeAllChildren(display_tiles);
    removeAllChildren(display_blood);
    removeAllChildren(display_effects);
    removeAllChildren(display_actors);
    removeAllChildren(display_guards);
    removeAllChildren(display_tiles_walls);
    removeAllChildren(stage_child);
    removeAllChildren(stage);
    stage = new PIXI.Container();
    stage.interactive = true;
}


function startMenu(){
/////MENU/////

    $('#instructions-container').show();
        console.log("start menu");
        clearStage();
        state = states["StartMenu"];
        //addButton("Play",200,200,startGame);
        //addButton("Fullscreen",200,400,fullscreen);
        //set music to "unmasked"
        if(music_masked && music_unmasked){
            changeVolume(music_masked,0.0);
            changeVolume(music_unmasked,1.0);
            changeVolume(music_hero_dead,0.0);
        }
        
        
}
function startGame(){
    $('#instructions-container').hide();
    //the the menu or any other previous children
    console.log("start game");
    clearStage();
    
    state = states["Gameplay"];
    
    //initialize variables:
    keys = {w: false, a: false, s: false, d: false, r: false, f: false, v: false, g:false, space:false, shift:false, LMB:false, RMB:false};
    stage_child = new PIXI.Container();//replaces stage for scaling
    stage.addChild(stage_child);
    
    gun_drops = [];
    shells = [];
    shards = [];
    bloods = [];


    
    
    //zoom:
    zoom = 1;
    zoom_magnitude = 0.02;
    
    //look sensitivity: This affects how far the camera stretches when the player moves the mouse around;
    //1.5: very far, all the way to the mouse
    //2: a lot
    //3: not much
    look_sensitivity = 2.5;
    
    
    //display object containers that hold the layers of everything.
    display_tiles = new PIXI.Container();
    display_blood = new PIXI.Container();
    display_effects = new PIXI.Container();
    display_tiles_walls = new PIXI.Container();
    particle_container = new PIXI.ParticleContainer(200000, [false, true, false, false, false]);
    display_actors = new PIXI.Container();
    display_guards = new PIXI.Container();
    stage_child.addChild(display_tiles);
    stage_child.addChild(display_blood);    
    stage_child.addChild(particle_container);
    stage_child.addChild(display_effects);
    stage_child.addChild(display_tiles_walls);//wall tiles are higher than effects and blood
    // Make sure guards render below hero
    stage_child.addChild(display_guards);
    stage_child.addChild(display_actors);
    
    
    
    
    ///////////////////////
    ///////////////////////
    /*
    Map / Game Object Setup
    */
    ///////////////////////
    ///////////////////////    
    //setup_map(map_diamond_store);
    
    doodads = [];
    
    
    bomb = new jo_sprite(new PIXI.Sprite(img_bomb));
    bomb.sprite.visible = false;
    bomb.sprite.scale.x = 0.35;
    bomb.sprite.scale.y = 0.35;
    bomb.rad = Math.PI/6;
    
    bombs_left = 1;
    
    bomb_fuse_start = 5000;//this is now set inside of setBomb
    bomb_fuse = bomb_fuse_start;
    bomb_ticking = false;
    bomb_scale_variety = 0;
    //bomb_tooltip text:
    bomb_tooltip = new PIXI.Text("Bomb Tooltip", { font: "45px Arial", fill: "#000000", align:"left", stroke: "#FFFFFF", strokeThickness: 2 });
    bomb_tooltip.anchor.x = 0.5;//centered
    bomb_tooltip.anchor.y = 0.5;//centered
    bomb_tooltip.objX = 0;
    bomb_tooltip.objY = 0;
    bomb_tooltip.visible = false;
    stage_child.addChild(bomb_tooltip);
    
    bomb_radius_debug = new debug_circle();
    bomb_radius_debug.alpha = 1.0;
    bomb_radius = 200;
    
    blood_trail = new debug_circle(display_blood);
    blood_trail.alpha = 1.0;
    
    //store string references to maps here so that query string can choose maps:
    //mapData = {"diamondStore":map_diamond_store,"bank1":map_bank_1};
    //test temp todo
    setup_map(map_json);
    /*if(mapName){
        setup_map(mapData[mapName]);
    }else{
        //if no map is in query string, default to bank 1
        setup_map(map_bank_1);
    }*/

    //camera/debug
    camera = new jo_cam(window_properties);
    cameras_disabled = false;
    //test_cone = new debug_line();
    //hero_cir = new debug_circle();

    //make a new bullet with: new jo_sprite(new PIXI.Sprite(img_bullet));
    bullets = [];
    
  
            
alarmingObjects = [];//guards will sound alarm if they see an alarming object (dead bodies)


            
            //UI text.  Use newMessage() to add a message.
            message = new PIXI.Text("", { font: "20px Arial", fill: "#000000", align: "left", stroke: "#FFFFFF", strokeThickness: 3 });
            message.position.x = 0;
            message.position.y = window_properties.height;
            message.anchor.y = 1;
            messageText = [];
            stage.addChild(message);
            
            messageGameOver = new PIXI.Text("", { font: "30px Arial", fill: "#000000", align: "left", stroke: "#FFFFFF", strokeThickness: 2 });
            messageGameOver.position.x = window_properties.width/2;
            messageGameOver.position.y = window_properties.height/2;
            messageGameOver.anchor.x = 0.5;
            stage.addChild(messageGameOver);
            
            messages_floating = []
            
            //Tooltip text:
            tooltip = new PIXI.Text("Tooltip", { font: "30px Arial", fill: "#000000", align:"left", stroke: "#FFFFFF", strokeThickness: 2 });
            tooltip.anchor.x = 0.5;//centered
            tooltip.objX = 0;
            tooltip.objY = 0;
            stage_child.addChild(tooltip);
            
            alert_clip = new jo_sprite(jo_movie_clip("movie_clips/","alert_",12,".png"),display_actors);
            alert_clip.sprite.loop = false;
            alert_clip.sprite.visible = false;
            alert_clip.sprite.scale.x = 0.4;
            alert_clip.sprite.scale.y = 0.4;
            alert_clip.sprite.animationSpeed = 0.8;//slow it down

            //effects:
            static_effect_sprites = [];
            
            dragDistance = 5;
            
            addKeyHandlers();
            
            
            //circular progress bar:
            circProgBar = new circularProgressBar(400,400,60,15);
            
            //TODO shells
             shell1 = new PIXI.Texture(wabbitTexture.baseTexture, new PIXI.Rectangle(0,0,16,16));
             shell2 = new PIXI.Texture(wabbitTexture.baseTexture, new PIXI.Rectangle(0,0,16,16));
             shell3 = new PIXI.Texture(wabbitTexture.baseTexture, new PIXI.Rectangle(0,0,16,16));
             shell4 = new PIXI.Texture(wabbitTexture.baseTexture, new PIXI.Rectangle(0,0,16,16));
             shell5 = new PIXI.Texture(wabbitTexture.baseTexture, new PIXI.Rectangle(0,0,16,16));
             
             
            shellTextures = [shell1, shell2, shell3, shell4, shell5,img_shell];
            shellType = 2;
            currentTexture = shellTextures[shellType];
            currentTexture = img_shell;
            
}
function setup_map(map){
    console.log('map:');
    console.log(map);
    //grid/map
    grid = new jo_grid(map);
    grid.setImagesForTiles();
    
    
    //whole map width and height:
    grid_width = grid.width*grid.cell_size;
    grid_height = grid.height*grid.cell_size;

    //Baked blood trail: sits underneath blood_trail's live Graphics so freshly drawn splats
    //still render on top of the already-baked ones.
    blood_trail_texture = new PIXI.RenderTexture(renderer,grid_width,grid_height);
    blood_trail_sprite = new PIXI.Sprite(blood_trail_texture);
    display_blood.addChildAt(blood_trail_sprite,0);
    blood_trail_pending = 0;

    /*
    New LOS Graphics:
    */
    losTexture = new PIXI.RenderTexture(renderer,grid.width*grid.cell_size,grid.height*grid.cell_size);
    losSprite = new PIXI.Sprite(losTexture);
	stage_child.addChild(losSprite);
    
    losShade = new PIXI.Graphics();
    //draw the shade:
    losShade.clear();
    losShade.alpha = 0.7;
    losShade.beginFill(0);
    losShade.drawPolygon([0,0,grid_width,0,grid_width,grid_height,0,grid_height,0,0]);
    
    losShadeContainer = new PIXI.Container();
    
    if(enableLOS){
        losPathGraphics = new PIXI.Graphics();
        losPathGraphicsContainer = new PIXI.Container();
        losPathGraphicsContainer.addChild(losPathGraphics);
    }
    
    //new for V3
    losShadeContainer.addChild(losShade);
    stage_child.addChild(losShadeContainer);//for line of sight
    
    //add the mask:
	losShadeContainer.mask = losSprite;
    
    
    display_tiles_walls.addChild(tile_containers[0]);//add ParticleContaineres, black walls
    display_tiles_walls.addChild(tile_containers[2]);//add ParticleContaineres, brown furnature
    display_tiles.addChild(tile_containers[1]);//add ParticleContaineres
    display_tiles.addChild(tile_containers[3]);//add ParticleContaineres
    display_tiles.addChild(tile_containers[4]);//add ParticleContaineres
    
    
            //make sprites:
			hero = new sprite_hero_wrapper(new PIXI.Sprite(img_hero_body),4,8);
            hero.losPath = [];
            hero.losPoints = [];
			//hero_end_aim_coord;
            starburst = new debug_line();
            starburst_ray = new Ray(0,0,0,0);

            hero.x = map.objects.hero[0];
            hero.y = map.objects.hero[1];
			hero.speed = hero.speed_walk;
            hero_drag_target = null; // a special var reserved for when the hero is dragging something.

            
            
			hero_last_seen = new jo_sprite(new PIXI.Sprite(img_lastSeen));
            hero_last_seen.sprite.visible = false;
            
            
			guards = [];
            for(var i = 0; i < map.objects.guards.length; i++){
                var hasRiotShield = randomIntFromInterval(0,2);
                var guard_img = hasRiotShield ? img_guard_riot_reg : img_guard_reg;
                var guard_inst = new sprite_guard_wrapper(new PIXI.Sprite(guard_img),hasRiotShield);
                guard_inst.x = map.objects.guards[i][0];
                guard_inst.y = map.objects.guards[i][1];
                guard_inst.getRandomPatrolPath();
                guards.push(guard_inst);
            }

            guard_backup_spawn = {'x':map.objects.guard_backup_spawn[0],'y':map.objects.guard_backup_spawn[1]};
            numOfBackupGuards = 7;
            backupCalled = false;
            
			computer_for_security_cameras = new jo_sprite(new PIXI.Sprite(img_computer));
			computer_for_security_cameras.x = map.objects.computer[0];
			computer_for_security_cameras.y = map.objects.computer[1];
            grid.makeWallSolid(computer_for_security_cameras.x,computer_for_security_cameras.y);//makes the ground under the car solid
			
			//security camera
			security_cameras = [];
            for(var i = 0; i < map.objects.security_cams.length; i++){
                var cam_inst = new security_camera_wrapper(new PIXI.Sprite(img_security_camera),map.objects.security_cams[i].pos[0],map.objects.security_cams[i].pos[1],map.objects.security_cams[i].swivel_max,map.objects.security_cams[i].swivel_min);
                cam_inst.setupLOS();//finds the points for the camera to consider when drawing los
                security_cameras.push(cam_inst);
            }
            
			//Loot and Getaway car:
			getawaycar = new jo_sprite(new PIXI.Sprite(img_getawaycar));
			getawaycar.sprite.anchor.y = 0.0;
			getawaycar.sprite.anchor.x = 0.5;
			getawaycar.x = map.objects.van[0];
			getawaycar.y = map.objects.van[1];
            grid.makeWallSolid(getawaycar.x,getawaycar.y);//makes the ground under the car solid
            grid.makeWallSolid(getawaycar.x,getawaycar.y-64);//makes the ground under the car solid
			getawaycar.rad = -Math.PI/2;
			loot = [];
			var money = new jo_sprite(new PIXI.Sprite(img_money));
			money.x = map.objects.loot[0];
			money.y = map.objects.loot[1];
            loot.push(money);

            
            
            // Finds the points for the camera to consider when drawing los
            if(enableLOS){
                hero.setupLOS();
            }

}
////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////
/*
Animate Loop
*/
////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////
var lastTimeStamp;
var deltaTime;
function animate(time) {
    if(state == 0){
    }else if(state == 1){
        /////Game/////
        if(!lastTimeStamp) lastTimeStamp = time;
        deltaTime = time - lastTimeStamp;
        lastTimeStamp = time;
        //console.log('delta: ' + deltaTime);
        //console.log('time: ' + time);
        
        
        stats.begin();//Mr Doob's Stats.js
        if(!pause)gameloop(deltaTime);
        stats.end();//Mr Doob's Stats.js
        
        
    }
    
    // render the stage
    renderer.render(stage);
    //request another animate call
    requestAnimationFrame(animate);	

    
}



////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////
/*
Game Loop
*/
////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////
function reactionTimeout(){
    //allow sprite to shoot again if he still sees hero
    if(this.doesSpriteSeeSprite(hero))this.can_shoot = true;
    this.reacting = false;
}
function gameloop_guards(deltaTime){
    for(var i = 0; i < guards.length; i++){
        var guard = guards[i];
        if(guard.alive){
            if(enableLOS){
                // Only limit showing guards when LOS / fog of war is on
                // --
                //Only show the gaurds if they are within vision of the hero or a hacked camera:
                //if(guard.isRaycastUnobstructedBetweenTheseIgnoreDoor(hero){
                //if the spyglass is in a door, the raycast should ignore the door
                if(hero.spyglass_equipped && spyglassPos.inDoor && guard.isRaycastUnobstructedBetweenTheseIgnoreDoor({x:spyglassPos.x,y:spyglassPos.y})){
                    guard.sprite.visible = true;
                //else it should not ignore doors:
                }else if(guard.isRaycastUnobstructedBetweenThese({x:spyglassPos.x,y:spyglassPos.y})){
                    guard.sprite.visible = true;
                }else{
                    guard.sprite.visible = false;
                }
                for(var s = 0; s < security_cameras.length; s++){
                    var cam = security_cameras[s];
                    if(cam.hacked && cam.alive && cam.doesSpriteSeeSprite(guard))guard.sprite.visible = true;
                }

            }
            
            guard.currentlySeesHero = guard.doesSpriteSeeSprite(hero);
        
                //shooting
            //guards aim can be off by up to guard.accuracy pixels:
            var aim_x_offset = Math.floor(Math.random() * guard.accuracy);
            var aim_y_offset = Math.floor(Math.random() * guard.accuracy);
            //only set aim if they are able to shoot again, don't reset aim every loop
            if(guard.can_shoot){
                
                //take the ray from guard to hero and make it go all the way to the wall:
                var guard_aim_to_wall = getRaycastPoint(guard.x,guard.y,hero.x+aim_x_offset,hero.y+aim_y_offset);
                guard.aim.set(guard.x,guard.y,guard_aim_to_wall.x,guard_aim_to_wall.y);
            }
            
            
            //if guard are not already alarmed
            if(!guard.alarmed  && !guard.being_choked_out){
                //check if guard sees alarming objects:
                for(var j = 0; j < alarmingObjects.length; j++){
                    if(guard.doesSpriteSeeSprite(alarmingObjects[j])){
                        newMessage('A guard has seen something alarming!');
                        guard.seeAlarmingObject(alarmingObjects[j]);
                    }
                }
                //check if guard sees hero:
                if(!guard.being_choked_out && guard.currentlySeesHero){
                    if(hero.willCauseAlert() || guard.knowsHerosFace){
                        //guard will remember hero's face unless hero is masked:
                        if(!hero.masked){
                            guard.knowsHerosFace = true;
                        }
                        newMessage('A guard has seen you being suspicious!');
                        //alarm if hero is seen masked
                        guard.seeAlarmingObject(hero);
                        
                        //show alert icon for this guard:
                        set_latestAlert(guard);
                        
                        //rotate guard to face hero:
                        guard.target_rotate = hero;
                        
                        //set lastSeen for investigating hero
                        hero.setLastSeen(guard);
                        guard.sawHeroLastAt = {x:hero.x,y:hero.y};
                    }
                    
                }else{
                    //guard doesn't see hero so set target_rotate to null so guard can rotate where he moves again
                    guard.target_rotate = null;
                }
            }else{
                //guard is alarmed:
                if(!guard.being_choked_out && guard.currentlySeesHero){
                    //guard is not being choked out and sees hero
                    if((hero.willCauseAlert() || guard.knowsHerosFace) && hero.alive){
                        //guard will remember hero's face unless hero is masked:
                        if(!hero.masked){
                            guard.knowsHerosFace = true;
                            guard.sprite_body.texture = guard.hasRiotShield ? img_guard_riot_knows_face : img_guard_knows_hero_face;//show that this guard knows your face:
                        }
                        //reset target
                        guard.moving = false;
                        guard.target_rotate = hero;
                        
                        if(guard.can_shoot){
                            
                            doGunShotEffects(guard, false);//plays sound
                            
                            guard.shoot();
                            ejectShell(guard);
                            
                            //increase guard's accuracy every time they shoot, for gameplay reasons
                            if(guard.accuracy > 10)guard.accuracy -= 10;
                            else guard.accuracy = 0;
                            
            
                            
                        }else{
                            //if guard can't shoot yet (reaction time)
                            if(!guard.reacting){
                                guard.reacting = true;
                                setTimeout(reactionTimeout.bind(guard), guard.shoot_speed);
                            }
                        }
                        
                        //show alert icon for this guard:
                        set_latestAlert(guard);
                        
                        //set lastSeen for investigating hero
                        hero.setLastSeen(guard);
                        guard.sawHeroLastAt = {x:hero.x,y:hero.y};
                    }
                }else{
                    
                    //if guard is alarmed rotate to the next waypoint so they peer around corners.
                    //~guard doesn't see hero so set target_rotate to null so guard can rotate where he moves again
                    //don't change rotation unless the guard is close to the point (this keeps them from walking backwards [bug])
                    if(guard.path[0] && get_distance(guard.x,guard.y,guard.path[0].x,guard.path[0].y) < 100)guard.target_rotate = guard.path[0];
                
                    //if alarmed move to last place hero was seen
                    if(notifyGuardsOfHeroLocation || !guard.chasingHero && hero.lastSeenX && hero.lastSeenY){
                        //this is only called once due to .chasingHero
                        //repath to hero pos
                        guard.moving = true;
                        guard.pathToCoords(hero.lastSeenX,hero.lastSeenY);
                        guard.chasingHero = true;
                    }
                }
            }
            //if guard has a path
            if(guard.path.length > 0){
                //if guard does not have a target:
                if(guard.target.x == null || guard.target.y == null){
                    grid.reducePathWithShortcut(guard.path,guard.radius);
                    guard.target = guard.path.shift();//get the first element.
                }
                
            }else{
                guard.getRandomPatrolPath();
               /* //set the rotation point when guard first starts idling
                if(!guard.startedIdling){
                    guard.idleRotateRad = guard.rad+Math.PI;
                    guard.startedIdling = true;
                }
                //if guard does not have a path, wait a little while, then move
                var wait_max = 4000;
                var wait_min = 300;
                if(!guard.idling){
                    var random_idle = Math.random() * (wait_max - wait_min) + wait_min;
                    console.log('random idle: ' + random_idle);
                    setTimeout(this.getRandomPatrolPath, random_idle);
                    guard.idling = true;
                }else{
                    //note: if a path is not found and this.path == [], the guard will idle again.
                    //guard idling
                    if(!guard.target_rotate){
                        if(guard.rotate_to_rad(guard.idleRotateRad+Math.PI)){
                            guard.idling = false;
                        }
                    }
                }
                guard.idling = true;*/
                
            }
            //call move to target, if target is reached, it will return true and set target to null
            if(guard.move_to_target()){
                guard.target.x = null;
                guard.target.y = null;
            }
            
        }
        guard.prepare_for_draw();
        
        //collide with other guards so they don't overlap:
        //start at i+1 so it checks all the guards who haven't already been checked for collision
        for(var other_guard_index = i+1; other_guard_index < guards.length; other_guard_index++){
            if(guard.alive && guards[other_guard_index].alive){
                guard.unit_to_unit_collide({x:guards[other_guard_index].x-1,y:guards[other_guard_index].y-1},10);
            }
        }
    }
}
function gameloop_security_cams(deltaTime){
    //////////////////////
    //Security Cameras
    //////////////////////
    for(var i = 0; i < security_cameras.length; i++){
        var cam = security_cameras[i];
        
        if(!cameras_disabled && cam.alive){
            cam.swivel(deltaTime);
            
            
            //if security_cameras are not already alarmed
            if(!cam.alarmed){
                //check if cam sees alarming objects:
                for(var j = 0; j < alarmingObjects.length; j++){
                    if(cam.doesSpriteSeeSprite(alarmingObjects[j])){
                        newMessage('A security camera has seen something alarming!');
                        cam.seeAlarmingObject(alarmingObjects[j]);
                    }
                }
                //check if security_camera sees hero:
                if(cam.doesSpriteSeeSprite(hero)){
                    //alarm if hero is seen masked
                    if(hero.willCauseAlert()){
                        newMessage('A security camera has seen you being suspicious!');
                        cam.seeAlarmingObject(hero);
                        
                        //THIS DOESN"T WORK YET:
                        //rotate cam to face hero:
                        cam.rotate_to(hero.x,hero.y);
                        //
                        
                        set_latestAlert(cam);
                        //set lastSeen for investigating hero
                        hero.setLastSeen(null);
                        
                        
                        
                    }
                }
            }else{
                //if camera is already alarmed, check to update hero position:
                 //check if security_camera sees hero:
                if(cam.doesSpriteSeeSprite(hero)){
                    //alarm if hero is seen masked
                    if(hero.masked){
                        
                        set_latestAlert(cam);
                        //set lastSeen for investigating hero
                        hero.setLastSeen(null);
                        
                    }
                }
            }
            
        }
        //Hack camera tooltip
        if(hero.alive && cam.alive && !cam.hacked && get_distance(hero.x,hero.y,cam.x,cam.y) <= hero.radius*dragDistance){
            tooltip.visible = true;
            tooltipshown = true;
            tooltip.text = ("[Space] to bug camera");
            tooltip.objX = cam.x;
            tooltip.objY = cam.y - 32;
        }
        cam.prepare_for_draw();
    }
    
    //show tooltip when close enough to computer
    if(get_distance(hero.x,hero.y,computer_for_security_cameras.x,computer_for_security_cameras .y) <= hero.radius*4){        
        //if hero is near a door and masked, show tooltip to open door
        if(hero.alive && !cameras_disabled){
            tooltip.visible = true;
            tooltipshown = true;
            tooltip.text = ("[Space] to deactivate cameras");
            tooltip.objX = computer_for_security_cameras.x;
            tooltip.objY = computer_for_security_cameras.y;
        }
    }
    computer_for_security_cameras.prepare_for_draw();
    
}
function gameloop_bullets(deltaTime){
    //////////////////////
    //Bullets
    //////////////////////
    bulletLoop:
    for(var b = 0; b < bullets.length; b++){
        var bullet = bullets[b];
        bullet.prepare_for_draw();
        //call move to target, if target is reached, it should remove the bullet
        
        var bulletPosBeforeMove = {x:bullet.x,y:bullet.y};//to check if a bullet kills a target, check if the prev position to the move position intersects the target
        //continued: this is because bullet path between frames looks like      a--------x------b
        //a: bullet start pos, b: bullet end pos, x: target  
        
        if(bullet.move_to_target()){
            //if true, bullet hits wall
            
            //TODO old, replace with particles:
            //play gun spark against wall where gun shot hits:
            //bullet.target.x.y
            var splatter_angle = grid.angleBetweenPoints(bullet.x,bullet.y,bullet.target.x,bullet.target.y)
            shardParticleSplatter(-splatter_angle,bullet.target);
            
            //destroy bullet
            display_actors.removeChild(bullet.sprite);
            bullets.splice(b,1);
            continue bulletLoop;
        }
        bullet.rotate_to_instant(bullet.target.x,bullet.target.y);
        
        
        //Who does the bullet kill:
            //bullets shot by hero can kill:
                //cameras, guards
            //bullets shot by guards can kill:
                //hero, cameras, hero_drag_target
            
        //if the hero shot the bullet check if bullet intersects guard:
        if(bullet.ignore == hero){
            for(var i = 0; i < guards.length; i++){
                var guard = guards[i];
                    
                if(bullet.ignore == guard)continue;//don't kill the shooter with his own bullet
                if(guard.alive && circle_linesetment_intersect(guard.getCircleInfoForUtilityLib(),bulletPosBeforeMove,{x:bullet.x,y:bullet.y})){
                    var guardDies = true;
                    var splatter_angle = grid.angleBetweenPoints(hero.x,hero.y,guard.x,guard.y);
                    
                    if(guard.hasRiotShield && guard.alarmed){
                        // check to see if riot shield blocks bullet:
                        // Riot shield is only active when the guard is alarmed
                        var angleInArc = angleInArcRad(guard.rad,Math.PI/2,Math.PI+splatter_angle)
                        if(angleInArc){
                            guardDies = false;
                            shardParticleSplatter(splatter_angle,guard);
                        }
                        
                    }
                    if(guardDies){
                        guard.kill(hero.x,hero.y);
                        //make blood splatter:
                        //The angle is hero and not bullet, because if the bullet hits the guard off to the side it causes a strange splatter
                        bloodParticleSplatter(splatter_angle,guard);
                        //make blood trail:
                        guard.blood_trail = true;
                        
                        if(guard.alarmed && !backupCalled)newMessage("You dispatch the guard before he can get the word out!");
                        
                        
                        //add to stats:
                        jo_store_inc("guardsShot");
                    }
                    
                    //destroy bullet
                    display_actors.removeChild(bullet.sprite);
                    bullets.splice(b,1);
                    continue bulletLoop;

                }
            
            }
        }else{
            //check if bullet intersects hero_drag_target
            if(hero_drag_target && circle_linesetment_intersect(hero_drag_target.getCircleInfoForUtilityLib(),bulletPosBeforeMove,{x:bullet.x,y:bullet.y})){
                if(hero_drag_target.alive)hero_drag_target.kill();
                //splatter
                var splatter_angle = grid.angleBetweenPoints(bulletPosBeforeMove.x,bulletPosBeforeMove.y,hero_drag_target.x,hero_drag_target.y);
                bloodParticleSplatter(splatter_angle,hero_drag_target);
                //destroy bullet
                display_actors.removeChild(bullet.sprite);
                bullets.splice(b,1);
                continue bulletLoop;

            }
            //check if bullet intersects with hero
                //ignore:: //don't kill the shooter with his own bullet
            if(bullet.ignore != hero && hero.alive && circle_linesetment_intersect(hero.getCircleInfoForUtilityLib(),bulletPosBeforeMove,{x:bullet.x,y:bullet.y})){
                hero.hurt(bullet.ignore.x,bullet.ignore.y);
                
                //destroy bullet
                display_actors.removeChild(bullet.sprite);
                bullets.splice(b,1);
                continue bulletLoop;

            }
        }
        //check if bullet intersects camera:
        for(var i = 0; i < security_cameras.length; i++){
            if(circle_linesetment_intersect(security_cameras[i].getCircleInfoForUtilityLib(),bulletPosBeforeMove,{x:bullet.x,y:bullet.y})){
                security_cameras[i].kill();
            }
        
        }
    }
    
}
function gameloop_doors(deltaTime){
    //////////////////////
    //Doors
    //////////////////////
    for(var d = 0; d < grid.door_sprites.length; d++){
        var door_inst = grid.door_sprites[d];
        //door is anchored at top, so account for offset when checking distance
        var door_center_y_offset = 32;
        var door_center_x_offset = 0;
        if(door_inst.horizontal){
            door_center_y_offset = 0;
            door_center_x_offset = -32;
        }
        door_inst.openerNear = false; 
        for(var g = 0; g < guards.length; g++){
        //check if any guard is near door_inst, open door_inst:
            //this radius is very important!  If door_inst doesn't detect unit close enough, the "wall" tile that it is on will be solid and unit won't be able to get close enough
            if(get_distance(door_inst.x+door_center_x_offset,door_inst.y+door_center_y_offset,guards[g].x,guards[g].y) <= guards[g].radius*4){
               door_inst.openerNear = true;
            }
        }
        //if hero can open door_inst:
        //this radius is very important!  If door_inst doesn't detect unit close enough, the "wall" tile that it is on will be solid and unit won't be able to get close enough
        if(get_distance(door_inst.x+door_center_x_offset,door_inst.y+door_center_y_offset,hero.x,hero.y) <= hero.radius*4){
            if(door_inst.unlocked)door_inst.openerNear = true;
            //if hero is sprinting and able to kick down doors:
            if(hero.ability_kick_doors && keys['shift']){
                door_inst.open();
                door_inst.broken = true;
            }
            
            
            //if hero is near a door, show tooltip to open door
            if(hero.alive){
                tooltip.visible = true;
                tooltipshown = true;
                tooltip.text = ("[Space]");
                tooltip.objX = door_inst.x;
                tooltip.objY = door_inst.y - 32;
            }
        }
        if(door_inst.openerNear){
            door_inst.open();
        
        }else{
            door_inst.close();
        
        }
    }
}
function gameloop_dragtarget(deltaTime){
    //////////////////////
    //Drag Target
    //////////////////////
    //show tooltip if hero is close enough to drag a guard:
    for(var i = 0; i < guards.length; i++){
        var guard = guards[i];
        if(hero.alive && guard.alive  && !guard.being_choked_out && get_distance(hero.x,hero.y,guard.x,guard.y) <= hero.radius*dragDistance){
            tooltip.visible = true;
            tooltipshown = true;
            tooltip.text = ("[Space]");
            tooltip.objX = guard.x;
            tooltip.objY = guard.y - 32;
        }
    }
    if(!tooltipshown){
        tooltip.visible = false;
        //if hero is not wearing mask, show instructions for how to put on mask
        if(!hero.masked){
            tooltip.visible = true;
            tooltipshown = true;
            // tooltip.text = ("Hold [v] to put on your mask");
            tooltip.text = (Math.round(mouse.x) + ',' + Math.round(mouse.y));
            tooltip.objX = hero.x;
            tooltip.objY = hero.y + grid.cell_size;
            
        }
    }
    
    //move sprite/item which the hero is dragging.
    if(hero_drag_target){
        hero_drag_target.target = {x: hero.x , y: hero.y};//the drag target is "following" the hero.
        hero_drag_target.get_dragged();
        //leaves blood trail behind as you drag.
        if(hero_drag_target.blood_trail){
            //Blood trail with random variation for prettiness
            var blood_x_mod = randomFloatWithBias2(-10,10);
            var blood_y_mod = randomFloatWithBias2(-10,10);
            var blood_size_mod = randomFloatWithBias2(1,hero_drag_target.blood_trail_size);
            var skip_blood_draw = randomFloatFromInterval(0,hero_drag_target.blood_trail_skip_frequency);
            //blood drip frequency and size decreases the longer that unit is dragged.
            if(hero_drag_target.blood_trail_size > 3)hero_drag_target.blood_trail_size-=0.01;
            hero_drag_target.blood_trail_skip_frequency+=0.01;
            
            if(skip_blood_draw <= 1)drawBloodTrail(hero_drag_target.x+blood_x_mod,hero_drag_target.y+blood_y_mod,blood_size_mod);
        }
    }
}
function gameloop_messages_and_tooltip(deltaTime){
    //////////////////////
    //Tooltip
    //////////////////////
        //I didn't want to create a whole new class for tooltip so I'm using a shorthand of prepare_for_draw
        //and I added two new memebers to the PIXI.Text object (objX and objY)
    var objPos = camera.relativePoint({x:tooltip.objX,y:tooltip.objY});
    tooltip.x = objPos.x;
    tooltip.y = objPos.y;
    
    var objPos2 = camera.relativePoint({x:bomb_tooltip.objX,y:bomb_tooltip.objY});
    bomb_tooltip.x = objPos2.x;
    bomb_tooltip.y = objPos2.y;
    
    //////////////////////
    //floating messages:
    //////////////////////
    for(var m_f = 0; m_f < messages_floating.length; m_f++){
        //prepare for draw:
        var drawPos = camera.relativePoint({x:messages_floating[m_f].objX,y:messages_floating[m_f].objY});
        messages_floating[m_f].x = drawPos.x;
        messages_floating[m_f].y = drawPos.y;
        var startFloatSpeed = 0.1*deltaTime/stage_child.scale.x;//stage_child.scale.x to account for camera zoom
        
        if(!messages_floating[m_f].lastFloatSpeed){
            messages_floating[m_f].objY -= startFloatSpeed;
            messages_floating[m_f].lastFloatSpeed = startFloatSpeed;
        }else{
            messages_floating[m_f].objY -= messages_floating[m_f].lastFloatSpeed;
        }
        messages_floating[m_f].lastFloatSpeed *= 0.98;//reduce the float speed
        if(messages_floating[m_f].lastFloatSpeed <= startFloatSpeed*0.5)messages_floating[m_f].alpha -= 0.0007*deltaTime;//fade out
        if(messages_floating[m_f].alpha <= 0){
            //remove it:
            
            stage_child.removeChild(messages_floating[m_f]);
            messages_floating.splice(m_f,1);
        }
    }
}
function gameloop_zoom_and_camera(deltaTime){
    //////////////////////
    //Camera
    //////////////////////
    
 
    //////////////////////
    //Zoom / Scale
    //////////////////////
    //this code allows the zoom / scale to change smoothly based on the mouse wheel input
    
   if(stage_child.scale.x < zoom - 0.05){//the 0.05 is close enough to desired value to stop so the zoom doesn't bounce back and forth.
        stage_child.scale.x += zoom_magnitude;
        stage_child.scale.y += zoom_magnitude;
        changeFontSizes();
    }else if(stage_child.scale.x > zoom + 0.05){//the 0.05 is close enough to desired value to stop so the zoom doesn't bounce back and forth.
        stage_child.scale.x -= zoom_magnitude;
        stage_child.scale.y -= zoom_magnitude;
        changeFontSizes();
    
    }
    
    //loose camera
    camera.x = hero.x + (mouse.x - hero.x)/look_sensitivity;
    camera.y = hero.y + (mouse.y - hero.y)/look_sensitivity;
    //don't let camera show out of bounds:
    var cam_width = window_properties.width*(1/stage_child.scale.x);
    var cam_height = window_properties.height*(1/stage_child.scale.y);
    var cam_adjust_x = camera.x;
    var cam_adjust_y = camera.y;
    
    
    if(camera.x < 0+cam_width/2){
        cam_adjust_x = 0+cam_width/2;
    }
    if(camera.y < 0+cam_height/2){
        cam_adjust_y = 0+cam_height/2;
    }
    
    if(camera.x >= grid_width-cam_width/2){
        cam_adjust_x = grid_width-cam_width/2;
    }
    if(camera.y >= grid_height-cam_height/2){
        cam_adjust_y = grid_height-cam_height/2;
    }
    
    //check both:
    if(cam_width > grid_width){
        //if both out of left and right limit, put camera in middle
        cam_adjust_x = grid_width/2;
    }
    if(cam_height > grid_height){
        //if both out of top and bottom limit, put camera in middle
        cam_adjust_y = grid_height/2;
    }
    
    camera.x = cam_adjust_x;
    camera.y = cam_adjust_y;
    
    
    if(camera.shaking){
        camera.posBeforeShakex = cam_adjust_x;
        camera.posBeforeShakey = cam_adjust_y;    
    }
    camera.shake();
    
    
    
    /*
    //The below commented block is for smooth camera
    //press space to look around
    if(keys['space']){
        //camera floats between hero and mouse
        //smooth camera
        camera.following = true;
        camera.target = {x: hero.x + (mouse.x - hero.x)/2, y: hero.y + (mouse.y - hero.y)/2};
    }else{
        //set camera target to hero
        if(camera.following){
            //return to hero
            camera.target = hero;
        }else{
            //stick to hero
            camera.x = hero.x; 
            camera.y = hero.y;
        }
    }
    //if the camera is set to following, move it to target, otherwise, don't because it is sticking to target.
    if(camera.following && camera.move_to_target()){
        if(camera.target == hero){
            camera.following = false;//when camera reaches it's target, turn off following so it can just stick.
        }
    }*/
    //set the stage_child to the correct position, the stage_child now acts as the camera.
    //stage_child.x = (-camera.x+cam_width/2)*stage_child.scale.x;
    //stage_child.y = (-camera.y+cam_height/2)*stage_child.scale.y;
    //camera with kickback:
    if(stage_child.kickx != null && stage_child.kicky != null){
        var movement = moveToTarget(stage_child.kickx,stage_child.kicky,camera.x,camera.y,kickback_speed);
        //set kickback to null if it reaches its target:
        if(movement.x == camera.x && movement.y == camera.y){
            stage_child.kickx = null;
            stage_child.kicky = null;
        }else{
            //move kickback to where it should be:
            stage_child.kickx = movement.x;
            stage_child.kicky = movement.y;
            stage_child.x = (-stage_child.kickx+cam_width/2)*stage_child.scale.x;
            stage_child.y = (-stage_child.kicky+cam_height/2)*stage_child.scale.y;
        }
    }else{
        //camera without kickback
        stage_child.x = (-camera.x+cam_width/2)*stage_child.scale.x;
        stage_child.y = (-camera.y+cam_height/2)*stage_child.scale.y;
        
    }
    
    
}
function scaleStageChild(a){
    stage_child.scale.x = a;
    stage_child.scale.y = a;
    console.log(stage_child.x + "," + stage_child.y);
    var cam_width = window_properties.width*(1/stage_child.scale.x);
    var cam_height = window_properties.height*(1/stage_child.scale.y);
    console.log(cam_width + "," + cam_height);
}
function changeFontSizes(){
    tooltip.style.font = 30/stage_child.scale.x + "px Arial";      
}
function gameloop_getawaycar_and_loot(deltaTime){
    //////////////////////
    //Getaway Car and Loot
    //////////////////////
    getawaycar.prepare_for_draw();
    for(var i = 0; i < loot.length; i++){
        loot[i].prepare_for_draw();
    }
    
    //pickup loot if close enough
    if(!hero.carry){
        //check if hero is close enough to the loot to pick it up
        for(var i = 0; i < loot.length; i++){
            if(get_distance(hero.x,hero.y,loot[i].x,loot[i] .y) <= hero.radius*2){
                hero.carry = loot[i];
                loot[i].sprite.visible = false;
                //hero.sprite.texture = (img_hero_with_money);
                newMessage("You've got the money!  Get it to the escape vehicle!");
                break;
            }
        }
        
    //check distance between the loot-carrying hero and the escape van, if he is close enough, deposit the loot.
    }else{
        //console.log("ggg: " + getawaycar.radius*5 + " " + get_distance(hero.x,hero.y,getawaycar.x,getawaycar.y));
        if(get_distance(hero.x,hero.y,getawaycar.x,getawaycar.y) <= getawaycar.radius*5){
            //deposite money in car:
            newMessage("The money is safe!");
            //add button for win condition
            addButton("Back to Hub",window.innerWidth/2,window.innerHeight/2,function(){location.href='/stealth/menu.html';});
            
            
            //add to stats:
            jo_store_inc("wins");
            
            //add 5 gold:
            jo_store("money",jo_store_get('money')+5);
            
            
            hero.carry = null;
            
        }
    }
}
function gameloop_alert_animation(deltaTime){
    //////////////////////
    //Alert Animation
    //////////////////////
    if(latestAlert){
        if(!latestAlert.doesSpriteSeeSprite(hero) || !latestAlert.alive){
            //don't show alert_clip if latestAlert cannot see hero.
            alert_clip.sprite.visible = false;
            latestAlert = null;
        }else{
            //update alert_clip position
            var distFromHero = 400; //dist that alert will be displayed
            var difX = -hero.x + latestAlert.x;
            var difY = -hero.y + latestAlert.y;
            var CCC = Math.sqrt(difX*difX+difY*difY);
            alert_clip.x = hero.x + difX*(distFromHero/CCC);
            alert_clip.y = hero.y + difY*(distFromHero/CCC);
            if(distFromHero >= CCC){
                alert_clip.x = latestAlert.x;
                alert_clip.y = latestAlert.y - 64;
            }
        }
    }
}
function pickUpGunDrop(gunDrop){
    // pick up
    hero.gun = gunDrop.gun;
    setHeroImage(); 
    newFloatingMessage("You picked up: " + gunDrop.gun.name + "!",{x:hero.x,y:hero.y},"#FFaa00");
    //remove gun drop
    gunDrop.remove_from_parent();//remove from parent
    gunDrop.flag_for_removal = true;

}
//called every loop to recheck LOS
//limit angle limits the view range of the los by limitAngle from the units rotation
function make_starburst(unit,limitAngle){
    if(!enableLOS){
        return
    }
    starburst.clear();
    var raycast;
    var first = {};

    unit.losPath.push(unit.x,unit.y);
    var lastPoint;
    var relevantCorner = false;
    for(var i = 0; i < unit.losPoints.length; i++){
        //update angle:
        unit.losPoints[i].angle = findAngleBetweenPoints(unit.losPoints[i].true_point,unit);
    }
    
    //sort unit.losPoints by angle:
    unit.losPoints = quickSort(unit.losPoints,0,unit.losPoints.length-1);
    
    var noray;
    var true_point;
    var true_point_angle;
    if(limitAngle!=undefined){
        //raycast point:
        //test_cone.graphics.clear();
        //hero_cir.graphics.clear();
        var dx = 10000*Math.cos(unit.rotation-limitAngle/2);
        var dy = 10000*Math.sin(unit.rotation-limitAngle/2);
        
        //console.log('-----------------------');
        //console.log((unit.rotation-limitAngle/2)*180/Math.PI);
        //console.log((unit.rotation+limitAngle/2)*180/Math.PI);
        var ray = getRaycastPoint(unit.x,unit.y,dx+unit.x,dy+unit.y);
        //test_cone.draw_Ray_without_clear({start:{x:unit.x,y:unit.y},end:{x:ray.x,y:ray.y}},0xaa0000);
        
        //Push the CCW most side of the camera's view
        unit.losPath.push(ray.x,ray.y); 
        //first.x = ray.x;
        // first.y = ray.y;
        
        //reorder starting with leftmost:
        var firstMostAngle = findAngleBetweenPoints({x:ray.x,y:ray.y},unit);
        var max = unit.losPoints.length;
        for(var i = 0; i < max; i++){
            //test_cone.draw_Ray_without_clear({start:{x:unit.x,y:unit.y},end:{x:unit.losPoints[i].true_point.x,y:unit.losPoints[i].true_point.y}},0x0000aa);
            if(unit.losPoints[i].angle < firstMostAngle){
                //move point to back of the array:
                var moveToBack = unit.losPoints.splice(i,1)[0];
                unit.losPoints.push(moveToBack);
                i--;
                max--;
            }
        }
        
        
    }
    
    //Use the losPoints to update the losPath(which is refreshed every loop
    for(var i = 0; i < unit.losPoints.length; i++){
        //TODO 5/9/2015
        true_point = unit.losPoints[i].true_point;
        noray = unit.losPoints[i].noray;
        true_point_angle = unit.losPoints[i].angle;
        
        
        raycast = getRaycastPoint(unit.x,unit.y,true_point.x,true_point.y);
        //if raycast point if farther away from unit than true point, then add the true point as a draw point:
        var ray_to_unit = get_distance(unit.x,unit.y,raycast.x,raycast.y);
        var ray_to_true = get_distance(unit.x,unit.y,true_point.x,true_point.y);
        relevantCorner = false;

        //find the corners that are visible to the unit
        //possible room for optimization in the getRaycastPoint function
        if(ray_to_true < ray_to_unit || (Math.abs(ray_to_unit - ray_to_true) < 100)){
            //NOTE: at steep angles, the second part of this if statement may not evaluate to true.  Just change 100 to a greater number if this happens.
            relevantCorner = true;
        }
        if(debug_LOS_starburst){
            starburst_ray.set(unit.x,unit.y,raycast.x,raycast.y);
            if(relevantCorner){
                if(!noray){
                    //normal
                    starburst_ray.set(unit.x,unit.y,raycast.x,raycast.y);
                    starburst.draw_Ray_without_clear(starburst_ray,0xff0000);
                }else{
                    starburst_ray.set(unit.x,unit.y,true_point.x,true_point.y);
                    starburst.draw_Ray_without_clear(starburst_ray,0x00ff00);
                }
                
            }//else if(noray)starburst.draw_Ray_without_clear(starburst_ray,0xff0000);
        
        }
        
        //how you draw the triangle poly:
        //A B C A C D A D F A F
        //create unit.losPath
        if(i >= 1){
            //start point between every two other points
            if(relevantCorner){
             
                if(noray){
                    //if this starburst is being limited within an angle range (like a security camera):
                    if(limitAngle!=undefined){
                        //and it is within that arc (The + Math.PI is just needed for some reason, the cameras rotation is backwards for the algorithm)
                        if(angleInArcRad(unit.rotation+Math.PI,limitAngle,true_point_angle)){
                            unit.losPath.push(true_point.x,true_point.y,unit.x,unit.y,true_point.x,true_point.y); 
                            //test_cone.draw_Ray_without_clear({start:{x:unit.x,y:unit.y},end:{x:true_point.x,y:true_point.y}},0xff00aa);
                            lastPoint = true_point;
                
                        }
                    }else{
                        unit.losPath.push(true_point.x,true_point.y,unit.x,unit.y,true_point.x,true_point.y); 
                        lastPoint = true_point;
                    }
        
                }else{
                    
                    //if this starburst is being limited within an angle range (like a security camera):
                    if(limitAngle!=undefined){
                        //and it is within that arc (The + Math.PI is just needed for some reason, the cameras rotation is backwards for the algorithm)
                        if(angleInArcRad(unit.rotation+Math.PI,limitAngle,true_point_angle)){                            
                            //console.log(true);
                            unit.losPath.push(raycast.x,raycast.y,unit.x,unit.y,raycast.x,raycast.y); 
                            //test_cone.draw_Ray_without_clear({start:{x:unit.x,y:unit.y},end:{x:raycast.x,y:raycast.y}},0x00ffaa);
                            lastPoint = raycast;
                        }
                    }else{
                        unit.losPath.push(raycast.x,raycast.y,unit.x,unit.y,raycast.x,raycast.y); 
                        lastPoint = raycast;
                    }
                }
            }
            //unit.losPath.push(raycast.x,raycast.y,unit.x,unit.y,raycast.x,raycast.y); 
            
            
        }
        if(Object.keys(first).length == 0){
            //if this starburst is being limited within an angle range (like a security camera):
            if(limitAngle!=undefined){
                //and it is within that arc (The + Math.PI is just needed for some reason, the cameras rotation is backwards for the algorithm)
                if(angleInArcRad(unit.rotation+Math.PI,limitAngle,true_point_angle)){                   
                            //console.log(true);
                    unit.losPath.push(raycast.x,raycast.y); 
                    //test_cone.draw_Ray_without_clear({start:{x:unit.x,y:unit.y},end:{x:raycast.x,y:raycast.y}},0x0000aa);
                    first.x = raycast.x;
                    first.y = raycast.y;
                    //hero_cir.draw(moveToBack.true_point.x,moveToBack.true_point.y,50,true);
                }
            }else{
                unit.losPath.push(raycast.x,raycast.y); 
                first.x = raycast.x;
                first.y = raycast.y;
            }
            
        }
        
            
    }
    
    if(limitAngle!=undefined){
        //raycast point:
        
        var dx2 = 10000*Math.cos(unit.rotation+limitAngle/2);
        var dy2 = 10000*Math.sin(unit.rotation+limitAngle/2);
        var ray2 = getRaycastPoint(unit.x,unit.y,dx2+unit.x,dy2+unit.y);
        //test_cone.draw_Ray_without_clear({start:{x:unit.x,y:unit.y},end:{x:ray2.x,y:ray2.y}},0x00aa00);
        unit.losPath.push(ray2.x,ray2.y,unit.x,unit.y,ray2.x,ray2.y); 
        
    }
    //if the first point exists, finish the losPath by drawing back to hero
    if(first.length != 0 && limitAngle==undefined)unit.losPath.push(first.x,first.y,unit.x,unit.y);
    //test show losPath (big red transparent circles
    //for(var i = 0; i < unit.losPath.length-1; i+=2){
        //hero_cir.draw(unit.losPath[i],unit.losPath[i+1],i,true);
    //}
    
}
function make_starburst_with_modified_view(unit,newX,newY){
    //calls make_starburst_without_limit() but with a faked x and y
    //this is useful for a spyglass tool that changes the starburst perspective of 
    //the unit;
    var realX = unit.x;
    var realY = unit.y;
    unit.x = newX;
    unit.y = newY;
    make_starburst_without_limit(unit);
    unit.x = realX;
    unit.y = realY;
}
//360 degrees of view:
function make_starburst_without_limit(unit){
    if(!enableLOS){
        return
    }
    starburst.clear();
    var raycast;
    var first = {};

    unit.losPath.push(unit.x,unit.y);
    var lastPoint;
    var relevantCorner = false;
    for(var i = 0; i < unit.losPoints.length; i++){
        //update angle:
        unit.losPoints[i].angle = findAngleBetweenPoints(unit.losPoints[i].true_point,unit);
    }
    
    //sort unit.losPoints by angle:
    unit.losPoints = quickSort(unit.losPoints,0,unit.losPoints.length-1);
    
    var noray;
    var true_point;
    for(var i = 0; i < unit.losPoints.length; i++){
        true_point = unit.losPoints[i].true_point;
        noray = unit.losPoints[i].noray;
        
        
        raycast = getRaycastPoint(unit.x,unit.y,true_point.x,true_point.y);
        //if raycast point if farther away from unit than true point, then add the true point as a draw point:
        var ray_to_unit = get_distance(unit.x,unit.y,raycast.x,raycast.y);
        var ray_to_true = get_distance(unit.x,unit.y,true_point.x,true_point.y);
        relevantCorner = false;

        //find the corners that are visible to the unit
        //possible room for optimization in the getRaycastPoint function
        if(ray_to_true < ray_to_unit || (Math.abs(ray_to_unit - ray_to_true) < 10)){
            relevantCorner = true;
        }
        if(debug_LOS_starburst){
            starburst_ray.set(unit.x,unit.y,raycast.x,raycast.y);
            if(relevantCorner){
                if(!noray){
                    //normal
                    starburst_ray.set(unit.x,unit.y,raycast.x,raycast.y);
                    starburst.draw_Ray_without_clear(starburst_ray,0x0000ff);
                }else{
                    starburst_ray.set(unit.x,unit.y,true_point.x,true_point.y);
                    starburst.draw_Ray_without_clear(starburst_ray,0x00ff00);
                }
                
            }//else if(noray)starburst.draw_Ray_without_clear(starburst_ray,0xff0000);
        
        }
        
        //how you draw the triangle poly:
        //A B C A C D A D F A F
        //create unit.losPath
        if(i > 1){
            //start point between every two other points
            if(relevantCorner){
             
                if(noray){
                    unit.losPath.push(true_point.x,true_point.y,unit.x,unit.y,true_point.x,true_point.y); 
                    lastPoint = true_point;
        
                }else{
                    unit.losPath.push(raycast.x,raycast.y,unit.x,unit.y,raycast.x,raycast.y); 
                    lastPoint = raycast;
                }
            }
            //unit.losPath.push(raycast.x,raycast.y,unit.x,unit.y,raycast.x,raycast.y); 
            
            
        }
        if(i==0){
            unit.losPath.push(raycast.x,raycast.y); 
            first.x = raycast.x;
            first.y = raycast.y;
            
        }
        
            
    }
    unit.losPath.push(first.x,first.y,unit.x,unit.y);
   
}


function gameloop(deltaTime){
    //////////////////////
    //update Mouse
    //////////////////////
    if(mouse_relative.x != -10000)mouse = camera.getMouse(mouse_relative);//only set mouse position if the mouse is on the stage
      
    //////////////////////
    //Hero Movement and Aim
    //////////////////////
    
    //get raycast for hero aim:
    hero_end_aim_coord = getRaycastPoint(hero.x,hero.y,mouse.x,mouse.y);
    
    //update hero directions based on keys:
    if(keys.w){
        hero.target.y = hero.y - 100;
    }else if(keys.s){
        hero.target.y = hero.y + 100;
    }else hero.target.y = hero.y;
    if(keys.d){
        hero.target.x = hero.x + 100;
    }else if(keys.a){
        hero.target.x = hero.x - 100;
    }else hero.target.x = hero.x;
    
    //Shoot if LMB is held down:
    if(hero.gunOut && keys['LMB'] && hero.gun.automatic){
        //you can only shoot if hero is masked
        //if(hero.gunDrawn && hero.gun.ammo > 0){
        if(hero.gun.ammo > 0){
        
            hero.gun.ammo--;
            doGunShotEffects(hero, hero.gun.silenced);//plays sound and shows affects
            //kickback camera
            kickback();
            ejectShell(hero);
            hero.shoot();
            if(!hero.gun.silenced)unsilenced_gun();//make noise (not real sound, but noise for guards) which draws guards
            mouse_click_obj = camera.objectivePoint_ignore_shake(clickEvent);  //uses clickEvent's .x and .y to find objective click
            
            
        }else{
            //set shake decay if out of bullets
            camera.shakeDecay = 1.5;
        }
    }
 
 
    
    //////////////////////
    //update all sprites:
    //////////////////////
    
    
    tooltipshown = false;  //hero is not close enough to any doors/guards, toggle visiblity off.

    
    //update effects:
    for(var i = 0; i < static_effect_sprites.length; i++){
        static_effect_sprites[i].prepare_for_draw();
    }
    alert_clip.prepare_for_draw();
    
    //update circularProgressBar:
    if(circProgBar.visible){
        circProgBar.increment(deltaTime);
        circProgBar.prepare_for_draw();
        circProgBar.draw();
    }
    
    //update door:
    for(var i = 0; i < grid.door_sprites.length; i++){
        grid.door_sprites[i].prepare_for_draw();
    }
    
    //////////////////////
    //update Hero
    //////////////////////
    
    hero.move_to_target();
    if(hero.alive && hero.gunOut){
        hero.aim.set(hero.x,hero.y,hero_end_aim_coord.x,hero_end_aim_coord.y);
    }
    
    
    //make_starburst_without_limit(hero);
    //SPYGLASS:
    //The below section changes the hero LOS starburst to be source from
    //a bit away from him so he can peak under doors and around corners
    spyglassPos = hero.getSpyglassPos();
    var spyglassInWall = grid.isWallSolidAndNotDoor_coords(spyglassPos.x,spyglassPos.y);
    if(grid.isWallDoor_coords(spyglassPos.x,spyglassPos.y))spyglassPos.inDoor = true;
    else spyglassPos.inDoor = false;
    if(!hero.alive || (!hero.spyglass_equipped || spyglassInWall)){
        spyglassPos.x = hero.x;
        spyglassPos.y = hero.y;
        hero.sprite_spyglass.visible = false;
    }else{
        hero.sprite_spyglass.visible = true;
    }

    
    make_starburst_with_modified_view(hero,spyglassPos.x,spyglassPos.y);
    //end spyglass
    
    for(var i = 0; i < security_cameras.length; i++){
        var cam = security_cameras[i];
        if(cam.hacked && cam.alive)make_starburst(cam,2*Math.PI/3);

    }
    

    
    //////////////////////
    //update particles
    //////////////////////
    for(var i = 0; i < shells.length; i++){
        if(tickParticle(shells[i],20,true)){
            shells.splice(i,1);
            i--;
        }
    }
    for(var i = 0; i < shards.length; i++){
        if(tickParticle(shards[i],20,true)){
            shards.splice(i,1);
            i--;
        }
    }
    for(var i = 0; i < bloods.length; i++){
        var blood = bloods[i];
        //shrink blood particle:
        blood.scale.x*=0.7;
        blood.scale.y*=0.7;
        
        
        var blood_x_mod = randomFloatWithBias2(-10,10);
        var blood_y_mod = randomFloatWithBias2(-10,10);
        var blood_size_mod = randomFloatWithBias2(1,blood.scale.y*20);
        //var skip_blood_draw = randomIntFromInterval(0,3);
        drawBloodTrail(blood.position.x+blood_x_mod,blood.position.y+blood_y_mod,blood_size_mod);
        
        //remove when done ticking
        if(tickParticle(blood,7,false)){
            bloods.splice(i,1);
            i--;
        }
        
    }
    

    
    
    if(grid.isTileRestricted_coords(hero.x,hero.y)){
        if(hero.alive)hero.inOffLimits = true;
    }else{
        hero.inOffLimits = false;
    }
    
    //check collisions and prepare to draw walls:
    for(var i = 0; i < grid.cells.length; i++){
        var cell = grid.cells[i];
        if(cell.solid){
            hero.collide(cell.v2);
            hero.collide(cell.v4);
            hero.collide(cell.v6);
            hero.collide(cell.v8);
            hero.collide_with_wall_sides(cell);
        }
        
        //draw:
        //cell.draw();//debug
        cell.prepare_for_draw();
    }
    if(hero.alive && !hero_drag_target){
        hero.target_rotate = mouse;
        hero.rotate_to_instant(mouse.x,mouse.y);
    }else if(hero_drag_target){
        hero.target_rotate = hero_drag_target;
    }else{
        hero.target_rotate = null;
    }
    hero.prepare_for_draw();
    
    bomb.prepare_for_draw();
    if(bomb.sprite.visible)bomb_radius_debug.draw_obj(bomb.x,bomb.y,bomb_radius);
    else bomb_radius_debug.graphics.clear();
    
    //don't show hero_last_seen if it is too close to hero:
    if(backupCalled){
        if(Math.sqrt(Math.pow(hero.x-hero_last_seen.x,2)+Math.pow(hero.y-hero_last_seen.y,2))<=hero.radius){
            hero_last_seen.sprite.visible = false;
        }else{
            hero_last_seen.sprite.visible = true;
        }
    }
    hero_last_seen.prepare_for_draw();
    
    gameloop_guards(deltaTime);
    
    if(notifyGuardsOfHeroLocation)console.log("Repath all guards to hero last seen");
    notifyGuardsOfHeroLocation = false;
    

    gameloop_security_cams(deltaTime);
    
    gameloop_alert_animation(deltaTime);
    
    gameloop_bullets(deltaTime);

    gameloop_bomb(deltaTime);
    
    gameloop_getawaycar_and_loot(deltaTime);

    gameloop_doors(deltaTime);
    
    gameloop_dragtarget(deltaTime);
    
    gameloop_messages_and_tooltip(deltaTime);
    
    for(var i = 0; i < doodads.length; i++){
        doodads[i].prepare_for_draw();
    }
    //dropped guns:
    for(var i = 0; i < gun_drops.length; i++){
        var gun_drop = gun_drops[i];
        if(gun_drop.flag_for_removal){            
            gun_drops.splice(i,1);
            i--;
            continue;
        }
        gun_drop.prepare_for_draw();
        //check if hero is close enough to pick up:
        if(get_distance(hero.x,hero.y,gun_drop.x,gun_drop.y) <= hero.radius*dragDistance){
            if(hero.ability_auto_pickup_ammo){
                pickUpGunDrop(gun_drop);
                break;
            }
                
            //show tooltip
            tooltip.visible = true;
            tooltipshown = true;
            tooltip.text = ("[Right Click] to pick up gun.");
            tooltip.objX = gun_drop.x;
            tooltip.objY = gun_drop.y;
        }
        
    }
    
    gameloop_zoom_and_camera(deltaTime);
    //causing slowdown?
    if(debug_on)updateDebugInfo();
    
    
    if(enableLOS){
        //Update LOS:    
        losPathGraphics.clear();
        
        losPathGraphics.beginFill(0xffffff);
        losPathGraphics.drawPolygon([0,0,grid_width,0,grid_width,grid_height,0,grid_height,0,0]);
        losPathGraphics.beginFill(0);
        losPathGraphics.drawPolygon(hero.losPath);
        
        //clear out the LOS paths:
        hero.losPath = [];
        for(var i = 0; i < security_cameras.length; i++){
            var sec_camera = security_cameras[i];
            losPathGraphics.beginFill(0);
            losPathGraphics.drawPolygon(sec_camera.losPath);
            sec_camera.losPath = [];
        }

        
        //reset the losSprite texture
        losTexture.render(losPathGraphicsContainer, null, false);
    }

}
var debug_info = $('#debug_info');
function updateDebugInfo(){
    if(hero.willCauseAlert())debug_info.css('color', 'red');
    else debug_info.css('color', 'green');
    
        var screenCorner = camera.objScreenCorner();
    debug_info.html(
        "Hero Ammo: " + hero.gun.ammo + "<br>" +
        "Clip Size: " + hero.gun.clip_size +  "<br>" +
        "Health: " + hero.health + "<br>" +
        "Gun: " + hero.gun.name + "<br>" +
        "Alert Causes: " + "<br>" +
        "Masked: " + hero.masked + "<br>" +
        "gunOut: " + hero.gunOut + "<br>" +
        "inOffLimits: " + hero.inOffLimits + "<br>" +
        "lockpicking: " + hero.lockpicking + "<br>" +
        "Dragging: " + hero_drag_target + "<br>" +
        "gotMoney: " + hero.carry + "<br>" +
        "mouse: " + Math.round(mouse.x) + "," + Math.round(mouse.y) + "<br>" +
        "corner: " + screenCorner.x + "," + screenCorner.y + "<br>"
    );
}
//Controls the behavior of a particle during one game tick
function tickParticle(particle,tick_max,bounce){
    //particle should have .dy .dx .dr. and tick
    particle.position.y += particle.dy;
    //check the y to see if it has gone into a wall
    if(grid.isWallSolid_coords(particle.position.x,particle.position.y)){
        particle.position.y -= particle.dy*2;
        particle.dy *= -1;
    }
    particle.position.x -= particle.dx;
        //check the x to see if it has gone into a wall
        if(grid.isWallSolid_coords(particle.position.x,particle.position.y)){
            // if particle should bounce off walls
            if(bounce){
                    particle.position.x += particle.dx*2;
                    particle.dx *= -1;
            }else{
                return true;
            }
        }
    
    particle.dx *= 0.9;
    particle.dy *= 0.9;
    particle.rotation += particle.dr;
    particle.tick++;
    //remove from array once it is done moving (OPTIMIZATION)
    if(particle.tick > tick_max){
        return true;//remove it from array
    }
    return false;
}
////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////
/*
Key Handlers
*/
////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////

function addKeyHandlers(){
    //override right click:
    if (document.addEventListener) {
        document.addEventListener('contextmenu', function(e){
            e.preventDefault();
        }, false);
    } else {
        document.attachEvent('oncontextmenu', function() {
            window.event.returnValue = false;
        });
    }
    window.onkeydown = function(e){
        //this function is called every frame that said key is down
        var code = e.keyCode ? e.keyCode : e.which;
        //keyinfo[code] = String.fromCharCode(code);
        if(hero.alive){
            /*
            if(code == 49){hero.changeGun(0);}//key 1
            if(code == 50){hero.changeGun(1);}//key 2
            if(code == 51){hero.changeGun(2);}//key 3
            if(code == 52){hero.changeGun(3);}//key 4
            if(code == 53){hero.changeGun(4);}//key 5
            if(code == 54){hero.changeGun(5);}//key 6
            */
            if(code == 87){keys['w'] = true;}
            if(code == 65){keys['a'] = true;}
            if(code == 83){keys['s'] = true;}
            if(code == 68){keys['d'] = true;}
            if(code == 80){
                //key p
                hero.spyglass_equipped = !hero.spyglass_equipped;
                
                if(hero.spyglass_equipped){
                    hero.gunOut = false;
                    if(!hero.gunOut)hero.gun_shot_line.graphics.clear();
                    setHeroImage();
                }
            
            }
            if(code == 71){
                // !keys['g'] makes it so that it will only be called once for a single press of the letter
                if(!keys['g']){
                    hero.gunOut = !hero.gunOut;
                    if(!hero.gunOut)hero.gun_shot_line.graphics.clear();
                    setHeroImage();
                    
                    if(hero.gunOut){
                        hero.spyglass_equipped = false;
                    }
                }
                keys['g'] = true;
            }
            /*if(code == 80){
                //'p'
                pause = !pause;
            }*/
            if(code == 82){
                keys['r'] = true;
                hero.reload();
            }
            if(code == 70){
                //plant bomb
                if(!keys['f'] && !bomb.sprite.visible){
                
                    if(hero.ability_remote_bomb){
                        //remote bomb
                        hero.moving = false;
                        circProgBar.reset(hero.x,hero.y,1500,function(){
                            plantBomb();
                            bomb_tooltip.text = ("Press 'f' to detonate");
                        });
                        bombs_left--;
                    }else if(hero.ability_timed_bomb){
                        //timed bomb
                        //if f isn't already pressed and bomb isn't already set
                        if(bombs_left>0){
                            hero.moving = false;
                            circProgBar.reset(hero.x,hero.y,1500,function(){plantBomb();setBomb(5000);});
                            bombs_left--;
                        }else{
                            newFloatingMessage("No Bombs Left",{x:hero.x,y:hero.y},"#FFaa00");
                        }
                    }
                     
                }
                if(!keys['f'] && bomb.sprite.visible){
                    if(hero.ability_remote_bomb){
                        //set remote bomb
                        setBomb(500);
                    }
                }
                keys['f'] = true;
            
            }
            if(code == 86){
                // !keys['v'] makes it so that it will only be called once for a single press of the letter
                if(!keys['v']){
                    circProgBar.heroMaskProg(hero.ability_toggle_mask_speed,useMask,!hero.masked);
                    
                    
                }
                keys['v'] = true;
            }
            if(code == 16){
                keys['shift'] = true;
                //cannot sprint while dragging something
                if(!hero_drag_target){
                    hero.speed = hero.speed_sprint;
                }
            
            }
            if(code == 32){
                keys['space'] = true;
                if(!hero_drag_target){
                    if(!grid.a_door_is_being_unlocked){
                            //lockpick door:
                    
                        for(var i = 0; i < grid.doors.length; i++){
                            var door = grid.doors[i];
                            if(door.solid && get_distance(hero.x,hero.y,door.x+grid.cell_size/2,door.y+grid.cell_size/2) <= hero.radius*5){
                                //if door isn't solid, then it is already unlocked.
                                grid.a_door_is_being_unlocked = true;
                                
                                //timer
                                var unlockTimeRemaining = hero.lockpick_speed;
                                hero.lockpicking = true;
                                circProgBar.reset(door.x+grid.cell_size/2,door.y+grid.cell_size/2,unlockTimeRemaining,grid.door_sprites[i].unlock.bind(grid.door_sprites[i]));
                                //cancel unlocking if hero moves away from door, unless hero has unlocked remote unlock
                                if(!hero.ability_remote_lockpick)circProgBar.distanceCancelTarget = {x:door.x,y:door.y};
                                
                                return;//unlocking doors succeeds loot interactions.  (Hero can unlock door while holding loot).
                            }
                        }
                    
                        //check if any dead guards are close enough to be dragged.
                        for(var i = 0; i < guards.length; i++){
                            var guard = guards[i];
                            if(get_distance(hero.x,hero.y,guard.x,guard.y) <= hero.radius*dragDistance){
                            
                                //check if any dead guards are close enough to be dragged.
                                if(!guard.alive){
                                    //hero is dragging a dead body
                                    
                                    //slow down hero speed because he just started dragging something.
                                    hero.speed = hero.speed/2;
                                    hero_drag_target = guard;
                                    hero_drag_target.speed = hero.speed;
                                    hero_drag_target.stop_distance = hero.radius*2;//I don't know why but the stop distance here seems to need to be bigger by a factor of 10
                                    //return;//don't return, this allows choking out a guard to have higher precedence than dragging a body
                                }else{
                                    //hero is choking out a live guard who is not already alarmed:
                                    newMessage('You are choking out a guard!');
                                    //play_sound(sound_guard_choke);
                                            
                                            
                                    //add to stats:
                                    jo_store_inc("guardsChoked");
                                    
                                    guard.moving = true;
                                    guard.path = [];
                                    guard.target = {x: null, y:null}; 
                                    guard.being_choked_out = true;
                                    //slow down hero speed because he just started dragging something.
                                    hero.speed = hero.speed_walk/2;
                                    hero_drag_target = guard;
                                    hero_drag_target.speed = hero.speed;
                                    hero_drag_target.stop_distance = hero.radius*2;//I don't know why but the stop distance here seems to need to be bigger by a factor of 10
                                    setTimeout(function(){
                                        //check that the guard is still being choked out, if not, he's not dead so don't kill() him
                                        if(hero_drag_target == this){
                                            newMessage('The guard is dispached!');
                                            this.kill();
                                            //if space isn't still being held release body:
                                            if(!keys['space']){
                                                //drag is a toggle action so release current drag target.
                                                hero_drag_target.stop_dragging();
                                                hero_drag_target = null;
                                                //bring hero speed back to normal
                                                hero.speed = hero.speed_walk;
                                            }
                                        }
                                    }.bind(guard), hero.ability_choke_speed);
                                    return;
                                }

                            }
                            
                                
                            
                        }
                        
                        //check if hero is close enough to bug a camera:
                        for(var s = 0; s < security_cameras.length; s++){           
                            var cam = security_cameras[s];
                            if(hero.alive && get_distance(hero.x,hero.y,cam.x,cam.y) <= hero.radius*dragDistance){
                                cam.hacked = true;
                            }
                        }
                    
                        //note: dragging guards takes precedence over all the following actions.
                        
                        //check if hero is close enough to the security camera computer to disable cameras:
                        if(!cameras_disabled && get_distance(hero.x,hero.y,computer_for_security_cameras.x,computer_for_security_cameras .y) <= hero.radius*4){
                            cameras_disabled = true;
                            newMessage('All security cameras have been disabled!');
                            computer_for_security_cameras.sprite.texture = (img_computer_off);
                            for(var i = 0; i < security_cameras.length; i++){
                                security_cameras[i].sprite.texture = (img_cam_off);
                            
                            }
                        }
                    }
                    
                }
                
            }
        }
        
        if(code == 27){
            //esc
            startMenu();
        }
        
        hero_move_animation_check();
    };
    window.onkeyup = function(e){
        var code = e.keyCode ? e.keyCode : e.which;
        if(code == 87){keys['w'] = false;}
        if(code == 65){keys['a'] = false;}
        if(code == 83){keys['s'] = false;}
        if(code == 68){keys['d'] = false;}
        if(code == 70){keys['f'] = false;}
        if(code == 71){keys['g'] = false;}
        if(code == 82){keys['r'] = false;}
        if(code == 86){
            //on release of key only
            //if(keys['v'])circProgBar.stop();//stop putting on mask
            keys['v'] = false;
        }
        if(code == 16){
            keys['shift'] = false;
            if(hero_drag_target==null){
                hero.speed = hero.speed_walk;
            }
        }
        if(code == 32){
            keys['space'] = false;
            //if hero was dragging something, drop it. (Don't drop a guard while he's being choked
            if(hero_drag_target && !hero_drag_target.alive){
                //drag is a toggle action so release current drag target.
                hero_drag_target.stop_dragging();
                hero_drag_target = null;
                //bring hero speed back to normal
                hero.speed = hero.speed_walk;
            }
            //allow user to abort unlocking door:
            if(grid.a_door_is_being_unlocked && !hero.ability_remote_lockpick){
                circProgBar.stop();
                hero.lockpicking = false;
            }
            
            grid.a_door_is_being_unlocked = false;//unlocking stops when space is released
        }
        hero_move_animation_check();
        
    };
    // IE9, Chrome, Safari, Opera
    window.addEventListener("mousewheel", mouseWheelHandler, false);
    // Firefox
    window.addEventListener("DOMMouseScroll", mouseWheelHandler, false);

    onmousedown = function(e){
        clickEvent = e;
        if(clickEvent.which === 1){
            //LMB
            if(hero_drag_target){
                newFloatingMessage("You cannot shoot while dragging a body!",{x:hero.x,y:hero.y},"#FFaa00");
                return;
            }
            keys['LMB'] = true;
            //hero can only shoot if gun is out
            if(hero.gunOut){
                    //very minor camera shake:
                if(hero.gun.ammo > 0)camera.startShake(10,0);
                
                if(!hero.gun.automatic){
                    if(hero.gun.ammo > 0){
                        //very minor camera shake:
                        camera.shakeDecay = 1.5;
                    
                        hero.gun.ammo--;
                        //newFloatingMessage("Ammo: " + hero.gun.ammo + "/6",{x:hero.x,y:hero.y},"#FFaa00");
                        doGunShotEffects(hero, hero.gun.silenced);//plays sound and shows affects
                        //kickback camera
                        kickback();
                        ejectShell(hero);
                        
                        hero.shoot();
                        if(!hero.gun.silenced)unsilenced_gun();//make noise (not real sound, but noise for guards) which draws guards
                        mouse_click_obj = camera.objectivePoint_ignore_shake(clickEvent);  //uses clickEvent's .x and .y to find objective click
                        
                        
                    }
                }
                if(hero.gun.ammo<=0){
                    newFloatingMessage("Press 'r' to reload!",{x:hero.x,y:hero.y},"#FF0000");
                    play_sound(sound_dry_fire);
                }
            }
        }else if(clickEvent.which === 3){
            //RMB
            keys['RMB'] = true;
            var oldgun = hero.gun;
            for(var i = 0; i < gun_drops.length; i++){
                var gun_drop = gun_drops[i];
                //if close to gun_drop, pick it up:
                if(get_distance(hero.x,hero.y,gun_drop.x,gun_drop.y) <= hero.radius*dragDistance){
                    pickUpGunDrop(gun_drop);
                    break;
                }
            }
            if(oldgun != hero.gun){
              // if hero picked up a gun:
              drop_gun(oldgun,hero.x,hero.y);
              setHeroImage(); 
            }
        }

    }
    onmouseup = function(e){
        clickEvent = e;
        if(clickEvent.which === 1){
            keys['LMB'] = false;
            //set shakeDecay so that when automatic gun is done firing it will stop the shake.
            camera.shakeDecay = 1.5;
        }else if(clickEvent.which === 3){
            //RMB
            keys['RMB'] = false;
        }
    }
}
function mouseWheelHandler(e){
    // cross-browser wheel delta
    var e = window.event || e; // old IE support
    var delta = Math.max(-1, Math.min(1, (e.wheelDelta || -e.detail)));
    
    //limit amount that cam can zoom out
    if(delta < 0 && zoom > 0.1){
        zoom += delta * 0.05;
    }else if (delta >0){
        zoom += delta * 0.05;
    }
}
function removeHandlers(excludeKeyHandlers){
    keys = {w: false, a: false, s: false, d: false, r: false, f: false, v: false, g:false, space:false, shift:false, LMB:false};
    
    //if excludeKeyDown is true, don't remove the onkeydown and onkeyup listeners
    if(!excludeKeyHandlers)window.onkeydown = null;
    if(!excludeKeyHandlers)window.onkeyup = null;
    window.removeEventListener("mousewheel",mouseWheelHandler);
    window.removeEventListener("DOMMouseScroll",mouseWheelHandler);
    onmousedown = null;
}
////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////
/*
Other
*/
////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////
function newMessage(mess){
    //console.log(mess);
    messageText.push(mess);
    if(messageText.length > 3)messageText.shift();
    updateMessage();
}
function newFloatingMessage(mess,pos,color){
    //Color in format of "#000000"
    var m = new PIXI.Text(mess, { font: 30/stage_child.scale.x + "px Arial", fill: color, align: "left", stroke: "#FFFFFF", strokeThickness: 3 });
    m.objX = pos.x;
    m.objY = pos.y;
    m.anchor.y = 1;
    messages_floating.push(m);
    stage_child.addChild(m);
}
function updateMessage(){
    var textForMessage = "";
    for(var i = 0; i < messageText.length; i++){
        textForMessage += messageText[i] + "\n";
    }
    message.text = (textForMessage);
};
function spawn_backup(){
    newMessage("The police have arrived!");
    
    for(var backup = 0; backup < numOfBackupGuards; backup++){
        setTimeout(spawn_individual_backup,1000*backup);//wait an extra second for each guard
    }
}
function spawn_individual_backup(){
    var hasRiotShield = randomIntFromInterval(0,2);
    var newGuard = new sprite_guard_wrapper(new PIXI.Sprite(img_guard_alert),hasRiotShield);
    newGuard.x = guard_backup_spawn.x;
    newGuard.y = guard_backup_spawn.y;
    //if(newGuard.alive)newGuard.becomeAlarmed();
    guards.push(newGuard);

}
function alert_all_guards(){
    for(var z = 0; z < guards.length; z++){
        //alert the other living guards that are 500 distance away
        if(guards[z].alive && get_distance(hero.x,hero.y,guards[z].x,guards[z].y)<500)guards[z].becomeAlarmed();
    }
    if(!backupCalled){
        //this part cannot repeat in the same game
        backupCalled = true;
        //spawn backup:
        spawn_backup();
        
    }
    
}
function unsilenced_gun(){
    //makes a sound and draws all guards:
    alert_all_guards();
    //set lastSeen for investigating hero
    hero.setLastSeen(null);

}


function setHeroImage(){
    if(hero.gunOut){
        switch(hero.gun.name){
            case "Shotgun":
                hero.sprite_body.texture = (img_hero_with_shotty);
                break;
            case "Sawed-Off Shotty":
                hero.sprite_body.texture = (img_hero_with_shotty_sawed);
                break;
            case "Handgun":
                hero.sprite_body.texture = (img_hero_with_pistol);
                break;
            case "Silenced Handgun":
                hero.sprite_body.texture = (img_hero_with_pistol_silenced);
                break;
            case "Machine Gun":
                hero.sprite_body.texture = (img_hero_with_machine_gun);
                break;
            default:
                hero.imgMaskOn(true);
                break;
            
        }
    }else{
        hero.sprite_body.texture = (img_hero_body);
        
    }

}
function useMask(toggle){
    hero.masked = toggle;
    if(hero.masked == undefined)hero.masked = false;

    if(toggle){
        if(hero.carry){
            //mask and bag of money
            hero.sprite.texture = (img_hero_with_money);
        }else{
            hero.imgMaskOn(true);
        }
        //switch music
        if(music_masked && music_unmasked){
            changeVolume(music_masked,0.4);
            changeVolume(music_unmasked,0.0);
        }
    }else{
        //take off mask
        hero.imgMaskOn(false);
        //switch music
        if(music_masked && music_unmasked){
            changeVolume(music_masked,0.0);
            changeVolume(music_unmasked,1.0);
        }
        //hero just took off his mask, check if any guards can see him DO IT:
        for(var i = 0; i < guards.length; i++){
            var guard = guards[i];
            if(guard.alive){
                //check if guard sees hero:
                if(!guard.being_choked_out && guard.doesSpriteSeeSprite(hero)){
                    //guard will remember hero's face unless hero is masked:
                    guard.knowsHerosFace = true;
                    
                    newMessage('A guard has seen you taking off your mask!');
                    //alarm if hero is seen masked
                    guard.seeAlarmingObject(hero);
                    
                    //show alert icon for this guard:
                    set_latestAlert(guard);
                    
                    //rotate guard to face hero:
                    guard.target_rotate = hero;
                    
                    //set lastSeen for investigating hero
                    hero.setLastSeen(guard);
                    guard.sawHeroLastAt = {x:hero.x,y:hero.y};
             
                    
                }
            }
        }
        
    }
}
function hero_is_dead(){

    play_sound(music_hero_dead);
    changeVolume(music_unmasked,0.0);
    changeVolume(music_masked,0.0);
    changeVolume(music_hero_dead,1.0);
}
//plays sound
function doGunShotEffects(unit, silenced){
    //gun_shot sound:
    if(silenced)play_sound(sound_gun_shot_silenced);
    else{
        play_sound_many(sound_gun_shots);
    }
}
var hero_moving = false;
function hero_move_animation_check(){
        var hero_was = hero_moving;
        if(keys['w'] || keys['a'] || keys['s'] || keys['d'])hero_moving = true;
        else hero_moving = false;
        if(hero_moving && !hero_was){
            hero.feet_clip.gotoAndPlay(0);
            hero.sprite_animate = true;
        }
        if(!hero_moving){
            hero.feet_clip.gotoAndStop(0);
            hero.sprite_animate = false;
        }
}

//show alert icon
function set_latestAlert(unit){
    //don't show alert unless the enemies don't know where you are.
    if(hero_last_seen.sprite.visible == true || backupCalled == false){
        //if latestAlert doesn't already equal this unit, play it and set it && don't reset alert until animation is done playing
        if(latestAlert!=unit && (alert_clip.sprite.currentFrame == alert_clip.sprite.totalFrames-1 || alert_clip.sprite.currentFrame == 0)){
            latestAlert = unit;
            alert_clip.sprite.visible = true;
            alert_clip.sprite.gotoAndPlay(0);
            
            //turn off the alert after 3.5 second
            setTimeout(function(){
                
                alert_clip.sprite.visible = false;

            }, 3500);
        }
    }
    
    
}
//blow up bomb
//The fuse used to run on a 10ms setInterval, which ignored pause, kept ticking after the
//hero died, and drifted from the render loop. It is now driven by gameloop_bomb(deltaTime).
function setBomb(fuseStart){

    bomb_fuse_start = fuseStart;
    bomb_fuse = bomb_fuse_start;
    bomb_scale_variety = 0;
    bomb_ticking = true;
}
//counts the fuse down once per frame; called from gameloop()
function gameloop_bomb(deltaTime){
    if(!bomb_ticking)return;

    bomb_tooltip.text = ((bomb_fuse/1000.0).toFixed(1));
    bomb_fuse -= deltaTime;
    var percent_till_explode = 1-bomb_fuse/bomb_fuse_start;
    if(percent_till_explode>=0.95)bomb_tooltip.style.fill = "#ff0000";
    else bomb_tooltip.style.fill = "#" + Math.round(percent_till_explode*16).toString(16) +  Math.round(percent_till_explode*16).toString(16) + "0000";
    bomb_tooltip.scale.x = 0.1*Math.sin(bomb_scale_variety)+1;
    bomb_tooltip.scale.y = 0.1*Math.sin(bomb_scale_variety)+1;
    //the old interval added 0.1 every 10ms; keep that pulse rate independent of framerate
    bomb_scale_variety += deltaTime*0.01;
    if(bomb_fuse<=0){
        bomb_ticking = false;
        explodeBomb();
    }
}
function explodeBomb(){
    play_sound(sound_explosion);

    camera.startShake(300,12);
    bomb.sprite.visible = false;
    bomb_tooltip.visible = false;
    
    //set last seen:
    
        alert_all_guards();
        hero.lastSeenX = bomb.x;
        hero.lastSeenY = bomb.y;
        hero_last_seen.x = bomb.x;
        hero_last_seen.y = bomb.y;
        //repath alert guards to hero
        notifyGuardsOfHeroLocation = true;
    
    //destroy nearby walls:
    for(var w = 0; w < grid.cells.length; w++){
        if(get_distance(bomb.x,bomb.y,grid.cells[w].x,grid.cells[w].y) < bomb_radius){
            var wallInfo = grid.getInfoFromIndex(w);
            //do not blow through map bounds walls
            if(wallInfo.x_index != 0 && wallInfo.x_index != grid.width-1 && wallInfo.y_index != 0 && wallInfo.y_index != grid.height-1){
                
                //test if any surrounding tiles are restricted:
                var makeRestricted = false;
                if(grid.isTileRestricted_coords(grid.cells[w].x-64,grid.cells[w].y))makeRestricted = true;
                if(grid.isTileRestricted_coords(grid.cells[w].x+64,grid.cells[w].y))makeRestricted = true;
                if(grid.isTileRestricted_coords(grid.cells[w].x,grid.cells[w].y-64))makeRestricted = true;
                if(grid.isTileRestricted_coords(grid.cells[w].x,grid.cells[w].y+64))makeRestricted = true;
                
                if(makeRestricted)grid.cells[w].changeImage(4);
                else{
                    if(grid.cells[w].image_number != 1 && grid.cells[w].image_number != 3 && grid.cells[w].image_number != 4)grid.cells[w].changeImage(1);
                }
                
                grid.cells[w].solid = false;
                grid.cells[w].blocks_vision = false;
                grid.cells[w].door = false;
            
            }
        
        }
    }
    
    //see if it kills anyone:
    for(var g = 0; g < guards.length; g++){
        var guard = guards[g];
        if(get_distance(bomb.x,bomb.y,guard.x,guard.y) < bomb_radius){
            guard.kill(bomb.x,bomb.y);
        
        }
    
    }
    //remove doodads in range:
    for(var d = 0; d < doodads.length; d++){
        if(get_distance(bomb.x,bomb.y,doodads[d].x,doodads[d].y) < bomb_radius+32){
            doodads[d].parent.removeChild(doodads[d].sprite);
            doodads.splice(d,1);
            d--;
        
        }
    
    }
    
    //The burn mark doodad used to be created here, but images/burn_mark.png is not in the
    //spritesheet (or on disk) any more, so img_burn_mark was undefined and every explosion
    //threw right here - which meant the hero was never checked against the blast below.
    //Restore the doodad once the art exists again.

    if(get_distance(bomb.x,bomb.y,hero.x,hero.y)<bomb_radius){
        killHero(bomb.x,bomb.y);

    }
}
function plantBomb(){
    //like set bomb, but doesn't start the fuse
    
    //allow hero to move again:
    hero.moving = true;
    
    bomb.sprite.visible = true;
    bomb.x = hero.x;
    bomb.y = hero.y;
    bomb_tooltip.objX = bomb.x;
    bomb_tooltip.objY = bomb.y-32;
    bomb_tooltip.visible = true;
}
function drop_gun(gun,x,y){
    var image;
    switch(gun.name){
        case "Shotgun":
            image = img_gun_shotgun;
            break;
        case "Handgun":
            image = img_gun_pistol;
            break;
        case "Sawed-Off Shotty":
            image = img_gun_shotgun_sawed;
            break;
        case "Silenced Handgun":
            image = img_gun_pistol_silenced;
            break;
        case "Machine Gun":
            image = img_gun_machine;
            break;
    }
    gun_drops.push(new jo_gun_drop(new PIXI.Sprite(image),display_effects,x,y,gun));
}
function killHero(fromX,fromY){
    hero.kill(fromX,fromY);
    //clear gun shot
    hero.gun_shot_line.graphics.clear();
}
window.onresize = function (event){
    var w = window.innerWidth;
    var h = window.innerHeight;
    //reset window_properties for camera code:
    window_properties.width = w;
    window_properties.height = h;
    //this part resizes the canvas but keeps ratio the same
    renderer.view.style.width = w + "px";
    renderer.view.style.height = h + "px";
    //this part adjusts the ratio:
    renderer.resize(w,h);


}
var shard_limit = 2000;
var shardType = 0;
//Shart images inited at images_from_sheet.js
function shardParticleSplatter(angle,target){
    var shardAmount = randomIntFromInterval(6,30);
        angle += Math.PI/2;//I don't know why it's off by Pi/2 but it is.
    for(var i = 0; i < shardAmount; i++){
        //make new bunnies
        shard = new PIXI.Sprite(currentShard);
        //shard = new PIXI.Sprite(img_shell);
        
        
        shard.anchor.x = 0.5;
        shard.anchor.y = 0.5;
        shard.position.x = target.x;
        shard.position.y = target.y;
        var randScale = randomFloatFromInterval(0.3,1);
        shard.scale.x = randScale;
        shard.scale.y = randScale;
        var randSpeed = randomFloatWithBias(0.1,shell_speed*2);
        var randRotationOffset = randomFloatFromInterval(-Math.PI/6,Math.PI/6);
        shard.dr = randomFloatFromInterval(-0.3,0.3);//change in rotation
        shard.dx = randSpeed*Math.sin(angle+randRotationOffset);
        shard.dy = randSpeed*Math.cos(angle+randRotationOffset);
        shard.tick = 0;//the amount of times that it has moved;
        shard.rotation = (angle);

        shards.push(shard);
        particle_container.addChild(shard);
        
        //rotate to next image:
        shardType++
        shardType %= shardImages.length;
        currentShard = shardImages[shardType];
        
        if(shards.length > shard_limit)return;
    }
    
}
function bloodParticleSplatter(angle,target){
    //var bloodAmount = randomIntFromInterval(15,30);
    var bloodAmount = randomIntFromInterval(30,60);
    angle += Math.PI/2;//I don't know why it's off by Pi/2 but it is.    
    var bloodSplat;
    for(var i = 0; i < bloodAmount; i++){
        //make new bunnies
        bloodSplat = new PIXI.Sprite();
        
        
        bloodSplat.anchor.x = 0.5;
        bloodSplat.anchor.y = 0.5;
        /*var randScale = randomFloatFromInterval(1,2);
        bloodSplat.scale.x = randScale;
        bloodSplat.scale.y = randScale;*/
        var randSpeed = randomFloatWithBias(0.7,blood_speed);
        var randRotationOffset = randomFloatWithBias(0,Math.PI/4);
        var negativeRotationOffset = randomIntFromInterval(0,2);
        if(negativeRotationOffset)randRotationOffset *= -1;
        bloodSplat.dr = randomFloatFromInterval(-0.3,0.3);//change in rotation
        bloodSplat.dx = -randSpeed*Math.sin(angle+randRotationOffset)*15;
        bloodSplat.dy = -randSpeed*Math.cos(angle+randRotationOffset)*15;
        //start the blood off a little away from target
        bloodSplat.position.x = target.x+Math.sin(angle)*20;
        bloodSplat.position.y = target.y+Math.cos(angle)*20;
        bloodSplat.tick = 0;//the amount of times that it has moved;
        bloodSplat.rotation = (angle);

        bloods.push(bloodSplat);
    }
    
}
function ejectShell(source){
    
    //make new bunnies
    shell = new PIXI.Sprite(img_shell);
    
    
    shell.anchor.x = 0.5;
    shell.anchor.y = 0.5;
    shell.position.x = source.x;
    shell.position.y = source.y;
    shell.scale.x = 0.5;
    shell.scale.y = 0.5;
    var randSpeed = randomFloatWithBias(shell_speed*0.6,shell_speed*2);
    var randRotationOffset = randomFloatFromInterval(-Math.PI/6,Math.PI/6);
    shell.dr = randomFloatFromInterval(-0.3,0.3);//change in rotation
    shell.dx = randSpeed*Math.sin(source.sprite.rotation+randRotationOffset);
    shell.dy = randSpeed*Math.cos(source.sprite.rotation+randRotationOffset);
    shell.tick = 0;//the amount of times that it has moved;
    shell.rotation = (source.sprite.rotation);

    shells.push(shell);
    particle_container.addChild(shell);
    //cycle shell texture
	/*shellType++
	shellType %= 5;
	currentTexture = shellTextures[shellType];*/
    //
}
var kickback_speed = 5;
var kickback_amount = 30;
function kickback(){
    var d = get_distance(hero.x,hero.y,mouse.x,mouse.y);
    var kickback_mod = randomFloatFromInterval(0,20);
    var c = kickback_amount+kickback_mod;
    var xx = -(c/d)*(mouse.x-hero.x);
    var yy = -(c/d)*(mouse.y - hero.y);
    //set stage_child kickx so that the camera will kick back
    stage_child.kickx = xx+camera.x;
    stage_child.kicky = yy+camera.y;

}
/*Get map from server:*/
var map_json = "";
function getMapInfo(subdir, fileName){
    $.get(subdir + "/" + fileName, function(result) {
        if (result == 'ON') {
            console.log('ON');
        } else if (result == 'OFF') {
            console.log('OFF');
        } else {
            //you will have "Uncaught SyntaxError: Unexpected token e" here if the JSON does not parse correctly.
            var map = JSON.parse(result);
            map_json = map;
            console.log("map loaded from server: " + map_json);
            windowSetup();
            //mapData.push(map);
        }
    }).fail(function(){
        alert("Map file " + fileName + " was not found.");
    });
}
    /*
    //get info from php:
    var fileNames;
    var mapData = [];
    var oReq = new XMLHttpRequest(); //New request object
    oReq.onload = function() {
        //This is where you handle what to do with the response.
        //The actual data is found on this.responseText
        console.log(this.responseText); 
        fileNames = JSON.parse(this.responseText);
        for(var i = 0; i < fileNames.length; i++){
            console.log("get file: " + fileNames[i]);
            //getMapInfo("community_maps", fileNames[i]);
        }
    };
    oReq.open("get", "community_maps/get-data.php", true);
    //                                              ^ Don't block the rest of the execution.
    //                                 Don't wait until the request finishes to 
    //                                 continue.
    oReq.send();*/


