//NOTE: to be batched, I think all images in spritebatch have to be the same sprite:
window.tile_container_black ??= undefined;
window.tile_container_white ??= undefined;
window.tile_container_brown ??= undefined;
window.tile_container_red ??= undefined;
window.tile_container_purple ??= undefined;
window.tile_containers ??= undefined;

function jo_grid(map){
    //set up sprite batches:
    /*
    tile_container_black = new PIXI.ParticleContainer(10000, [false, true, false, false, false]);//for efficiency!
    tile_container_white = new PIXI.ParticleContainer(10000, [false, true, false, false, false]);//for efficiency!
    tile_container_brown = new PIXI.ParticleContainer(10000, [false, true, false, false, false]);//for efficiency!
    tile_container_red = new PIXI.ParticleContainer(10000, [false, true, false, false, false]);//for efficiency!
    tile_container_purple = new PIXI.ParticleContainer(10000, [false, true, false, false, false]);//for efficiency!*/
    tile_container_black = new PIXI.Container();
    tile_container_white = new PIXI.Container();
    tile_container_brown = new PIXI.Container();
    tile_container_red = new PIXI.Container();
    tile_container_purple = new PIXI.Container();
    tile_containers = [tile_container_black,tile_container_white,tile_container_brown,tile_container_red,tile_container_purple];

    //Debug lines for shortcut pathing
    /*
    this.debug3 = new debug_line();
    this.debug3.color = 0xff0000;
    this.debug4 = new debug_line();
    this.debug4.color = 0xff0000;
    this.debugbounds = new debug_circle();*/
    
    //2d array:
    this.width = map.width;
    this.height = map.height;
    this.cell_size = 64

    //this is the map, fill it will walls!
    this.map_data = map.data;
    
    this.cells = [];
    
    this.doors = [];//list of doors allows for lockpicking
    this.door_sprites = [];//list of door sprite objects which correspond to doors
    this.a_door_is_being_unlocked = false;
    
    this.getInfoFromIndex = function(index){
        //gets the 2d index from the 1d index
        var x_index = index%this.width;
        var y_index = Math.floor(index/this.width);
        return {x_index: x_index, y_index: y_index};
    };
    
    this.getCellFromIndex = function(row, col){
        //gets 1d index from 2d index
        //NOTE: I had to reverse col and row, usually the formula is width * row + col, but
        //because of the way that the 2d array works I had to reverse it.
        if(row < 0 || col < 0)return undefined;
        if(row >= this.width || col >= this.height)return undefined;
        return this.cells[this.width * col + row];
    };
    
    this.get1DIndexFrom2DIndex = function(row, col){
        return this.width * col + row;
    };
    
    this.getIndexFromCoords_2d = function(x,y){
        //returns the index of the cell that coords are within
        var indexX = Math.floor(x/this.cell_size);
        var indexY = Math.floor(y/this.cell_size);
        return {x: indexX, y: indexY};
    }
    this.isWallSightBlocking_coords = function(x,y){
        //used for ray casting
        //returns true if the wall that the (x,y) coords are within blocks vision:
        
        //return if coords are outside of map bounds:
        if(x < 0 || y < 0)return false;//do not accept negative values;
        if(x > this.cell_size*this.width || y > this.cell_size*this.height)return false;//coord out of bounds
        var grid_index = this.getIndexFromCoords_2d(x,y);
        var cell = this.getCellFromIndex(grid_index.x,grid_index.y);
        
        if(cell && cell.blocks_vision){
            //cell.image_sprite.texture = (img_tile_brown);Turns cell green for debug so I can see which cell the coords are in.
            return true;
        }
        else return false;
        
    }
    this.isWallPathBlocking_coords = function(x,y){
        //returns true if the wall that the (x,y) coords are within is path blocking (solid but not door):
        
        //return if coords are outside of map bounds:
        if(x < 0 || y < 0)return false;//do not accept negative values;
        if(x > this.cell_size*this.width || y > this.cell_size*this.height)return false;//coord out of bounds
        var grid_index = this.getIndexFromCoords_2d(x,y);
        var cell = this.getCellFromIndex(grid_index.x,grid_index.y);
        
        if(cell && cell.solid && !cell.door){
            //cell.image_sprite.texture = (img_tile_brown);Turns cell green for debug so I can see which cell the coords are in.
            return true;
        }
        else return false;
    
    }
    this.isWallDoor_coords = function(x,y){
        //returns true if the wall that the (x,y) coords are within is solid BUT the cell is not a door:
        
        //return if coords are outside of map bounds:
        if(x < 0 || y < 0)return false;//do not accept negative values;
        if(x > this.cell_size*this.width || y > this.cell_size*this.height)return false;//coord out of bounds
        var grid_index = this.getIndexFromCoords_2d(x,y);
        var cell = this.getCellFromIndex(grid_index.x,grid_index.y);
        
        if(cell && cell.door){
            //cell.image_sprite.texture = (img_tile_brown);Turns cell green for debug so I can see which cell the coords are in.
            return true;
        }
        else return false;
        
    }
    this.isWallSolidAndNotDoor_coords = function(x,y){
        //returns true if the wall that the (x,y) coords are within is solid BUT the cell is not a door:
        
        //return if coords are outside of map bounds:
        if(x < 0 || y < 0)return false;//do not accept negative values;
        if(x > this.cell_size*this.width || y > this.cell_size*this.height)return false;//coord out of bounds
        var grid_index = this.getIndexFromCoords_2d(x,y);
        var cell = this.getCellFromIndex(grid_index.x,grid_index.y);
        
        if(cell && cell.solid && !cell.door){
            //cell.image_sprite.texture = (img_tile_brown);Turns cell green for debug so I can see which cell the coords are in.
            return true;
        }
        else return false;
        
    }
    this.isWallSolid_coords = function(x,y){
        //returns true if the wall that the (x,y) coords are within is solid:
        
        //return if coords are outside of map bounds:
        if(x < 0 || y < 0)return false;//do not accept negative values;
        if(x > this.cell_size*this.width || y > this.cell_size*this.height)return false;//coord out of bounds
        var grid_index = this.getIndexFromCoords_2d(x,y);
        var cell = this.getCellFromIndex(grid_index.x,grid_index.y);
        
        if(cell && cell.solid){
            //cell.image_sprite.texture = (img_tile_brown);Turns cell green for debug so I can see which cell the coords are in.
            return true;
        }
        else return false;
        
    }
    
    //useful for an object that makes the cell beneath it solid:
    this.makeWallSolid = function(x,y){
        
        //return if coords are outside of map bounds:
        if(x < 0 || y < 0)return;//do not accept negative values;
        if(x > this.cell_size*this.width || y > this.cell_size*this.height){
            //console.log("error2");
            return;//coord out of bounds
        }
        var grid_index = this.getIndexFromCoords_2d(x,y);
        var cell = this.getCellFromIndex(grid_index.x,grid_index.y);
        
        if(cell){
            
            cell.solid = true;
            cell.blocks_vision = true;
            
        }else{
            //console.log('error');
        }
        
    }

    this.isTileRestricted_coords = function(x,y){
        //returns true if the wall that the (x,y) coords are within is restricted:
        
        //return if coords are outside of map bounds:
        if(x < 0 || y < 0)return false;//do not accept negative values;
        if(x > this.cell_size*this.width || y > this.cell_size*this.height)return false;//coord out of bounds
        var grid_index = this.getIndexFromCoords_2d(x,y);
        var cell = this.getCellFromIndex(grid_index.x,grid_index.y);
        
        if(cell && cell.restricted){
            //cell.image_sprite.texture = (img_tile_brown);Turns cell green for debug so I can see which cell the coords are in.
            return true;
        }
        else return false;
        
    }
    this.getWallCoords = function(wall_type,x_index,y_index){
        //returns the objective coordinates of a wall based on its type and index.
        //this should work even for non-square walls.
        
        //the type simply specifies where the position of the vertices will be, it does not correlate, necessarily, with the image in that cell.
        
        var startx = x_index*this.cell_size;
        var starty = y_index*this.cell_size;
        switch(wall_type){
            case 'square':
                //square
                return [{x:startx,y:starty},{x:startx+this.cell_size,y:starty},{x:startx+this.cell_size,y:starty+this.cell_size},{x:startx,y:starty+this.cell_size}];
                break;
            default:
                //square
                return [{x:startx,y:starty},{x:startx+this.cell_size,y:starty},{x:startx+this.cell_size,y:starty+this.cell_size},{x:startx,y:starty+this.cell_size}];
                break;
        }
    
    };
    //used for random patrol paths:
    this.getRandomNonSolidCellIndex = function(){
    
        var cell;
        var randomCellIndex;
        do{
            //random number between                           max           and  min
            randomCellIndex = Math.floor(Math.random() * this.cells.length) + 0;
            cell = this.cells[randomCellIndex];
        
        }while(cell.solid);
        return randomCellIndex;
    
    }
    this.getRandomNonSolid_NonRestricted_CellIndex = function(){
        //for civilian wander
        var cell;
        var randomCellIndex;
        do{
            //random number between                           max           and  min
            randomCellIndex = Math.floor(Math.random() * this.cells.length) + 0;
            cell = this.cells[randomCellIndex];
        
        }while(cell.solid || cell.restricted);
        return randomCellIndex;
    
    }
     //private
    this.make_door = function(door, horizontal){
            this.doors.push(door);
            var door_sprite = new sprite_door_wrapper(new PIXI.Sprite(img_door_closed),horizontal,door,display_actors);
            //+= because door sprites have an offest calculated in the constructor
            door_sprite.x += door.x;
            door_sprite.y += door.y;
            this.door_sprites.push(door_sprite);
    
    };
    
    //create map:
    for(var i = 0; i < this.map_data.length; i++){
        var tile_type = this.map_data[i];
        var info = this.getInfoFromIndex(i);
        var x_index = info.x_index;
        var y_index = info.y_index;
        switch(tile_type) {
        case 1:
            //black
            this.cells.push(new jo_wall(0,true,true,false,this.getWallCoords('square',x_index,y_index),x_index,y_index));
            break;
        case 2:
            //white
            this.cells.push(new jo_wall(1,false,false,false,this.getWallCoords('square',x_index,y_index),x_index,y_index));
            break;
        case 3:
            //brown
            this.cells.push(new jo_wall(2,true,false,false,this.getWallCoords('square',x_index,y_index),x_index,y_index));
            break;
        case 4:
            //red
            this.cells.push(new jo_wall(3,false,false,true,this.getWallCoords('square',x_index,y_index),x_index,y_index));
            break;
        case 5:
            //purple (door vertical)
            var door = new jo_wall(4,true,true,true,this.getWallCoords('square',x_index,y_index),x_index,y_index);
            door.door = true;
            this.cells.push(door);
            this.make_door(door, false);
            break;
        
        case 6:
            //purple (door horizontal)
            var door = new jo_wall(4,true,true,true,this.getWallCoords('square',x_index,y_index),x_index,y_index);
            door.door = true;
            this.cells.push(door);
            this.make_door(door, true);
            break;
        default:
            console.log('here');
            this.cells.push(new jo_wall(1,false,false,false,this.getWallCoords('square',x_index,y_index),x_index,y_index));
            break;
        };
    }
    delete this.map_data;
    
    /////////////////////////////
    ////////////A STAR///////////
    /////////////////////////////
    
    this.cells_astar = [];//astar.js requires an actual 2d array so this variable will be made from cells as a 2D array
    //the below for loop turns this.cells into a 2d array and puts it in this.cells_astar
    for(var i = 0; i < this.height; i++){
        var slice = this.cells.slice(i*this.width,i*this.width+this.width);
        for(var j = 0; j < slice.length; j++){
            //convert tile codes into 0 for wall and 1 for floor:
            if(slice[j].solid && !slice[j].door){
                //Note: doors can be walked through by guards
                slice[j] = 0;
            }else{
                slice[j] = 1;
            }
        }
        //console.log('map ' , i , ' ' , slice);
        this.cells_astar.push(slice);
    }
    this.cells_astar = new Graph(this.cells_astar);//convert to astar graph
    
    
    this.reducePathWithShortcut = function(path,radius){
        //checks if there are any angled shortcuts along this path:
        var startPoint = path[0];
        //magic number 3 is set to reduce the amount of times that guards walk through the corners of walls.
        if(path.length <= 1)return path;
        var lastPointIndex;
        for(var i = 1; i < path.length; i++){
            //ignore vertical and horizontal shortcuts
            if(startPoint.x == path[i].x || startPoint.y == path[i].y)continue;
            if(this.isShortcutOK(startPoint,path[i],radius)){
                lastPointIndex = i;
                //console.log("lastPointIndex: " + i);
            }else break;
        
        }
        //if lastpoint is found, splice up until that point:
        if(lastPointIndex != undefined){
            path.splice(1,lastPointIndex-1);
        }

    }
    this.getPath = function(start,end){
        //start/end in format {x: #,y: #} # representing cell indices.
        //because of how I read 2d arrays I have to treat all the y's as x's and all the x's as y's in the astar lib
        //                      y   x
        var start = this.cells_astar.nodes[start.y][start.x];//remember x and y are switched for the astar lib
        var end = this.cells_astar.nodes[end.y][end.x];//remember x and y are switched for the astar lib
        var result = astar.search(this.cells_astar.nodes, start, end);
        var path = [];
        for(var i = 0; i < result.length; i++){
            path.push({x: result[i].y*this.cell_size+this.cell_size/2, y: result[i].x*this.cell_size+this.cell_size/2});//return path in obj pixel location, index*64-32 will center the pixel on the correct index cell
            //console.log(result[i].y , ',' , result[i].x);
        }
        
        
        
        
        //console.log('grid return path: ');
        //console.log(path);
        return path; //path is an array of points
    
    };
    
    /*
    The following functions are all to resolve if a path can take a shortcut.
    At first I tested if a line between the mover and a list of next points intersects any walls.
    Now im testing if the line between the point at the mover's normal vector of its direction with a magnitude of the movers
    radius intersects any walls.  I do this for both sides of the bounds circle
    */
    this.angleBetweenPoints = function (ax,ay,bx,by){
        //in radians
        var deltaY = by - ay;
        var deltaX = bx - ax;
        return Math.atan2(deltaY,deltaX);
    }
    this.getPointOnCirlceAtAngle = function (cx,cy,radius,angle){
        //angle in radians
        var x = cx + radius * Math.cos(angle);
        var y = cy + radius * Math.sin(angle);
        return {x:x,y:y};
    
    }
    this.isShortcutOK = function(startPoint,endPoint,radius){
    
        //this.debugbounds.draw_obj(startPoint.x,startPoint.y,radius);
        
        var newPoint = this.getPointOnCirlceAtAngle(startPoint.x,startPoint.y,radius,this.angleBetweenPoints(endPoint.x,endPoint.y,startPoint.x,startPoint.y)+(Math.PI/2));
        var difX = newPoint.x - startPoint.x;
        var difY = newPoint.y - startPoint.y;
        
        var newPoint2 = this.getPointOnCirlceAtAngle(startPoint.x,startPoint.y,radius,this.angleBetweenPoints(endPoint.x,endPoint.y,startPoint.x,startPoint.y)-(Math.PI/2));
        var difX2 = newPoint2.x - startPoint.x;
        var difY2 = newPoint2.y - startPoint.y;
        
        if(isLineOKForPath(endPoint.x+difX2,endPoint.y+difY2,newPoint2.x,newPoint2.y) && isLineOKForPath(endPoint.x+difX,endPoint.y+difY,newPoint.x,newPoint.y)){
            /*this.debug3.color = 0x00ff00;
            this.debug4.color = 0x00ff00;
            this.debug3.draw_obj(endPoint.x+difX,endPoint.y+difY,newPoint.x,newPoint.y);
            this.debug4.draw_obj(endPoint.x+difX2,endPoint.y+difY2,newPoint2.x,newPoint2.y);*/
            return true;
        
        }else{
            /*this.debug3.color = 0xff0000;
            this.debug4.color = 0xff0000;
            this.debug3.draw_obj(endPoint.x+difX,endPoint.y+difY,newPoint.x,newPoint.y);
            this.debug4.draw_obj(endPoint.x+difX2,endPoint.y+difY2,newPoint2.x,newPoint2.y);*/
            return false;  
        }
    }
    this.setImagesForTiles = function(){
        for(var i = 0; i < this.cells.length; i++){
            //set the tile image:
            this.cells[i].changeImage(this.cells[i].image_number);
        }
    }
   
        


}

// --- legacy global bridge ---------------------------------------------------
// This file used to be a classic <script> whose top-level declarations landed on
// `window`. It is an ES module now, so the functions below are republished as
// globals for the not-yet-extracted code that still reads them by bare name.
// See src/legacy-bridge.ts. Each extraction deletes another line from here.
Object.assign(window, { jo_grid });

export {};
