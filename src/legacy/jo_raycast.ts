//http://www.permadi.com/tutorial/raycast/rayc7.html

//var ray_debug;


function raycast_horiz(point,angle){
//returns the first point along the ray where the line intersects with the horizontal lines of the coordinate plane
//nextPointAlongRay is then used along with Xa and Ya to find the next point along the ray.
    /*
    (Ax,Ay) are the coordinates of the first intersection between the ray and the horizontal line.
    Xa and Ya are the difference between Ax,Ay and the next point.  So for example the next point is
    (Ax+Xa,Ay+Ya)
    */
    if(angle > Math.PI || angle < -Math.PI){
        console.log("Error, angle must be between 180 and -180 degrees");
        return;
    }
    
    if (angle < 0){
        var Ya = -grid.cell_size;
        var Xa = -grid.cell_size/Math.tan(angle);
        var Ay = Math.floor(point.y/grid.cell_size) * grid.cell_size - 1;
    }else{
        Ya = grid.cell_size;
        Xa = grid.cell_size/Math.tan(angle);
        Ay = Math.floor(point.y/grid.cell_size) * grid.cell_size + grid.cell_size;
    }
    
    var Ax = point.x + (Ay - point.y) / Math.tan(angle);
    return {x:Ax,y:Ay,dx:Xa,dy:Ya};
}
function nextPointAlongRay(firstPointAlongRay,index){
    //the index'th point
    var nextX = firstPointAlongRay.x+firstPointAlongRay.dx*index;
    var nextY = firstPointAlongRay.y+firstPointAlongRay.dy*index;
    return {x:nextX,y:nextY};
}

function raycast_virt(point,angle){
//returns the first point along the ray where the line intersects with the vertical lines of the coordinate plane
//nextPointAlongRay is then used along with Xa and Ya to find the next point along the ray.
    if(angle > Math.PI || angle < -Math.PI){
        console.log("Error, angle must be between 180 and -180 degrees");
        return;
    }
    
    if( angle > -Math.PI/2 && angle < Math.PI/2){
        var Bx = Math.floor(point.x/grid.cell_size)*(grid.cell_size)+grid.cell_size;
        var Xa = grid.cell_size;
        var Ya = grid.cell_size*Math.tan(angle);
        
    }else{
        Bx = Math.floor(point.x/grid.cell_size) * (grid.cell_size) - 1;
        Xa = -grid.cell_size;
        Ya = -grid.cell_size*Math.tan(angle);
    
    }
    var By = point.y + (Bx-point.x)*Math.tan(angle);
    
    return {x:Bx,y:By,dx:Xa,dy:Ya};

}
//returns true if there is a valid line of sight between the points (ignoring doors) (doors don't block line of sight)
function lineOfSightIgnoreDoor(ax,ay,bx,by){
    var circle = new debug_circle();
    circle.alpha = 0.5;
    //but only if there are no walls between them:
    var raycast = getRaycastPointIgnoreDoor(ax,ay,bx,by);
    
    if(Math.round(get_distance(ax,ay,raycast.x,raycast.y))>=Math.round(get_distance(ax,ay,bx,by))){
        return true;
    }else{
        return false;
    }
}
            
function lineOfSight(ax,ay,bx,by){
    var circle = new debug_circle();
    circle.alpha = 0.5;
    //but only if there are no walls between them:
    var raycast = getRaycastPoint(ax,ay,bx,by);
    
    if(Math.round(get_distance(ax,ay,raycast.x,raycast.y))>=Math.round(get_distance(ax,ay,bx,by))){
        return true;
    }else{
        return false;
    }
}
function getRaycastPoint(startx,starty,endx,endy){
//sets the point at which the hero's aim runs into a solid wall
        var ray_angle = findAngleBetweenPoints({x:startx,y:starty},{x:endx,y:endy});
        //get the first point on the horizontal lines
        var rayh = raycast_horiz({x:startx,y:starty},ray_angle);
        var ray_h_closest;
        
        //find the closest point that touches a wall
        for(var i = 0; i < 40; i++){
            var nextPoint_h = nextPointAlongRay(rayh,i);
            
            if(grid.isWallSightBlocking_coords(nextPoint_h.x,nextPoint_h.y)){
                ray_h_closest = nextPoint_h;
                break; // [i] is the end of the raycast
            }
     
        }
        //get the first point on the vertical lines
        var rayv = raycast_virt({x:startx,y:starty},ray_angle);
        var ray_v_closest;
        
        
        //find the closest point that touches a wall
        for(var i = 0; i < 40; i++){
            var nextPoint_v = nextPointAlongRay(rayv,i);
            
            if(grid.isWallSightBlocking_coords(nextPoint_v.x,nextPoint_v.y)){
                ray_v_closest = nextPoint_v;
                break; // [i] is the end of the raycast
            }
     
        }
        
        //find closest out of the two closest points:
        var ray_closest;
        //if one of the rays doesn't exist
        if(!ray_h_closest && ray_v_closest){
            ray_closest = ray_v_closest;
            
        }else if(!ray_v_closest && ray_h_closest){
            ray_closest = ray_h_closest;
            
        }else if (ray_h_closest && ray_v_closest){
            //if both rays contain a close point touching a wall, pick the closest.
            var h_dist = get_distance(startx,starty,ray_h_closest.x,ray_h_closest.y);
            var v_dist = get_distance(startx,starty,ray_v_closest.x,ray_v_closest.y);
            if(h_dist < v_dist){
                ray_closest = ray_h_closest;
            }else{
                ray_closest = ray_v_closest;
            }
        }else if(!ray_v_closest && !ray_h_closest){
            console.log('ray out of range, try increasing the value of i if you wish to raycast further.'  + " ," +  startx  + " ," +  starty  + " ," +  endx  + " ," +  endy);
            //returns endx,endy so as to not cause errors in all the places that use this function if the ray is null
            //it returns the end point of the linesegment passed in, having detected no walls.
            
            ray_closest = {x: endx, y: endy};
        }
        //ray_debug.x = ray_closest.x;
        //ray_debug.y = ray_closest.y;
        //ray_debug.prepare_for_draw();
        
        return {x:ray_closest.x,y:ray_closest.y};
        
}
function getRaycastPointIgnoreDoor(startx,starty,endx,endy){
//sets the point at which the hero's aim runs into a solid wall
        var ray_angle = findAngleBetweenPoints({x:startx,y:starty},{x:endx,y:endy});
        //get the first point on the horizontal lines
        var rayh = raycast_horiz({x:startx,y:starty},ray_angle);
        var ray_h_closest;
        
        //find the closest point that touches a wall
        for(var i = 0; i < 40; i++){
            var nextPoint_h = nextPointAlongRay(rayh,i);
            
            if(grid.isWallSolidAndNotDoor_coords(nextPoint_h.x,nextPoint_h.y)){
                ray_h_closest = nextPoint_h;
                break; // [i] is the end of the raycast
            }
     
        }
        //get the first point on the vertical lines
        var rayv = raycast_virt({x:startx,y:starty},ray_angle);
        var ray_v_closest;
        
        
        //find the closest point that touches a wall
        for(var i = 0; i < 40; i++){
            var nextPoint_v = nextPointAlongRay(rayv,i);
            
            if(grid.isWallSolidAndNotDoor_coords(nextPoint_v.x,nextPoint_v.y)){
                ray_v_closest = nextPoint_v;
                break; // [i] is the end of the raycast
            }
     
        }
        
        //find closest out of the two closest points:
        var ray_closest;
        //if one of the rays doesn't exist
        if(!ray_h_closest && ray_v_closest){
            ray_closest = ray_v_closest;
            
        }else if(!ray_v_closest && ray_h_closest){
            ray_closest = ray_h_closest;
            
        }else if (ray_h_closest && ray_v_closest){
            //if both rays contain a close point touching a wall, pick the closest.
            var h_dist = get_distance(startx,starty,ray_h_closest.x,ray_h_closest.y);
            var v_dist = get_distance(startx,starty,ray_v_closest.x,ray_v_closest.y);
            if(h_dist < v_dist){
                ray_closest = ray_h_closest;
            }else{
                ray_closest = ray_v_closest;
            }
        }else if(!ray_v_closest && !ray_h_closest){
            console.log('ray out of range, try increasing the value of i if you wish to raycast further.'  + " ," +  startx  + " ," +  starty  + " ," +  endx  + " ," +  endy);
            //returns endx,endy so as to not cause errors in all the places that use this function if the ray is null
            //it returns the end point of the linesegment passed in, having detected no walls.
            
            ray_closest = {x: endx, y: endy};
        }
        //ray_debug.x = ray_closest.x;
        //ray_debug.y = ray_closest.y;
        //ray_debug.prepare_for_draw();
        
        return {x:ray_closest.x,y:ray_closest.y};
        
}
// `isLineOKForPath` lived here: a copy of getRaycastPoint used only by
// jo_grid's path-shortcut test. Phase 3 moved string pulling into
// src/nav/smooth.ts, which checks the grid flags directly, so it had no
// callers left. The rest of this file goes in Phase 4, when vision and
// bullets become physics raycasts.

// --- legacy global bridge ---------------------------------------------------
// This file used to be a classic <script> whose top-level declarations landed on
// `window`. It is an ES module now, so the functions below are republished as
// globals for the not-yet-extracted code that still reads them by bare name.
// See src/legacy-bridge.ts. Each extraction deletes another line from here.
Object.assign(window, { raycast_horiz, nextPointAlongRay, raycast_virt, lineOfSightIgnoreDoor, lineOfSight, getRaycastPoint, getRaycastPointIgnoreDoor });

export {};
