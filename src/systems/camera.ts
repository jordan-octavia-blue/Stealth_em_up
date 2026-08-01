/**
 * Camera system (roadmap §2.2 strangler step, Phase 2).
 *
 * Owns the per-frame camera: smooth zoom, the loose mouse-led follow, map-edge
 * clamping, shake, and shot kickback. Moved verbatim out of main.ts; still reads
 * the shared world state (`camera`, `stage_child`, `hero`, `mouse`, ...) as window
 * globals until those gain owners of their own.
 *
 * Kickback arrives over the event bus ('camera:kickback') rather than by direct
 * call — the first use of the FX seam the later phases build on.
 */
import { events } from '../core/events';

//Tuning constants. Only this module reads them (they were window globals in main.ts).
var kickback_speed = 5;
var kickback_amount = 30;

export function updateCamera(deltaTime){
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

function changeFontSizes(){
    tooltip.style.font = 30/stage_child.scale.x + "px Arial";
}

//Punch the camera back away from the muzzle when the hero fires.
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

//FX seam: shooters announce the shot; the camera decides what to do about it.
events.on('camera:kickback', kickback);
