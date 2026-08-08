import { events } from '../core/events';
import { tileDef, materialTakesDamage } from '../map/tileset';
import { DOOR_TYPE_DEFAULTS } from '../map/doors';
import { refreshAutotileAround } from '../render/autotile';

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
    //Phase 10 (map editor): per-door metadata (type, group, hp/lockpick overrides), keyed by
    //flat cell index. A door cell with no entry defaults to `locked` — the pre-Phase-10
    //behaviour — so bank_1.jomap is unchanged. Consumed by applyDoorType() below.
    this.doorTypes = (map.doorTypes && typeof map.doorTypes === 'object') ? map.doorTypes : {};

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
            //nav derives walkability from these flags, so it has to hear about the change
            //(this runs after nav.build(): the van and the security computer seal the
            //ground under themselves once they are placed).
            events.emit('nav:dirty', {index: this.get1DIndexFrom2DIndex(grid_index.x,grid_index.y), walkable: false});

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
    //Patrol destinations used to be sampled from anywhere on the map with a
    //rejection loop (`getRandomNonSolidCellIndex`), which is how a guard ended up
    //asking for a cell inside a sealed room and re-running a full A* every frame
    //forever. `nav.randomDestinationNear` samples the requester's own connected
    //region instead, so every destination is reachable by construction (§4).

     //private
    this.make_door = function(door, horizontal){
            this.doors.push(door);
            var door_sprite = new sprite_door_wrapper(new PIXI.Sprite(img_door_closed),horizontal,door,display_actors);
            //+= because door sprites have an offest calculated in the constructor
            door_sprite.x += door.x;
            door_sprite.y += door.y;
            this.door_sprites.push(door_sprite);
            //Phase 10: back-reference so applyDoorType() can reach the sprite from the wall.
            door.doorSprite = door_sprite;

    };

    //Phase 10 (map editor): apply a door cell's type (from `doorTypes`, default `locked`).
    //Sets the material/hp (vault is steel = indestructible; reinforced is tougher), the
    //lockpick time and multi-cell group used by the lockpick channel, and pre-unlocks an
    //`unlocked` door so the hero can walk through it without picking. Called after the generic
    //tileset hp/material attach so the door type wins for door cells.
    this.applyDoorType = function(index, wall){
        var spec = this.doorTypes[index] || this.doorTypes[String(index)] || { type: 'locked' };
        var type = DOOR_TYPE_DEFAULTS[spec.type] ? spec.type : 'locked';
        var def = DOOR_TYPE_DEFAULTS[type];
        wall.doorType = type;
        wall.groupId = (spec.group !== undefined) ? spec.group : index;
        wall.lockpickMs = (spec.lockpickMs !== undefined) ? spec.lockpickMs : def.lockpickMs;
        wall.material = def.material;
        wall.hp = (spec.hp !== undefined) ? spec.hp : def.hp;
        wall.maxHp = wall.hp;
        if(def.startsUnlocked && wall.doorSprite){ wall.doorSprite.unlocked = true; }
    };

    //Phase 10: unlock every door cell sharing a group id (a 3-wide vault opens as one). For a
    //normal door the group is just its own index, so only that door unlocks.
    this.unlockDoorGroup = function(groupId){
        for(var k = 0; k < this.doors.length; k++){
            if(this.doors[k].groupId === groupId && this.door_sprites[k]){
                this.door_sprites[k].unlock();
            }
        }
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
        //Attach destructible-wall data (roadmap §6.1): the material and hp for this tile
        //code come from data/tileset.json; a map may override a single cell's starting hp
        //via `hpOverrides`. Floors have no tileset entry and stay material:null / hp:0, so
        //damageCell treats them as nothing to break.
        var def = tileDef(tile_type);
        var cell = this.cells[i];
        if(def){
            cell.material = def.material;
            cell.hp = def.hp;
            cell.rubbleTile = def.rubbleTile;
        }
        if(map.hpOverrides && map.hpOverrides[i] !== undefined){
            cell.hp = map.hpOverrides[i];
        }
        //Remember the starting hp so the wall-destruction debug overlay (H key) can draw a
        //bar as a fraction of full health. Damage only ever lowers cell.hp, never maxHp.
        cell.maxHp = cell.hp;
        //Phase 10 (map editor): a door cell's material/hp/lockpick come from its door type,
        //overriding the tileset default set just above. Runs after make_door so the sprite
        //exists (an `unlocked` door pre-unlocks its sprite here).
        if(cell.door){
            this.applyDoorType(i, cell);
        }
    }
    delete this.map_data;

    //Map a tile code to the image_number changeImage() draws. Used to pick the floor a
    //breach leaves behind (the cell's `rubbleTile`).
    this.imageForTileCode = function(tileCode){
        switch(tileCode){
            case 1: return 0; //black wall
            case 2: return 1; //white floor
            case 3: return 2; //brown
            case 4: return 3; //red
            case 5:
            case 6: return 4; //door / red
            default: return 1;
        }
    };

    //Roadmap §6.2 — the ONE damage entry point. Bullets, the bomb, frag grenades and (in
    //Phase 7) a car crash all call this; nothing destroys a wall any other way. `amount` is
    //hit points removed, `type` is what is doing the damage (bullet/bomb/frag/car), which
    //decides whether this material takes damage at all.
    this.damageCell = function(index, amount, type){
        var cell = this.cells[index];
        if(!cell)return;
        //Nothing to break: already destroyed, or a floor to begin with.
        if(!cell.solid && !cell.door)return;
        //Map-border cells stay indestructible — the outer ring is what keeps guards and the
        //blast from escaping the map (preserved from the old bomb code).
        var info = this.getInfoFromIndex(index);
        if(info.x_index === 0 || info.x_index === this.width-1 || info.y_index === 0 || info.y_index === this.height-1)return;
        //Steel is indestructible; other materials only take damage from the right source
        //(a bullet does nothing to brick, a car stops dead against concrete, ...).
        var material = cell.material || 'brick';
        if(!materialTakesDamage(material, type))return;
        cell.hp -= amount;
        if(cell.hp > 0)return;
        this.destroyCell(index);
    };

    //Roadmap §6.2 — the destroy pipeline. Runs once, when a cell's hp hits zero. Step 1
    //(grid flags + the rubble sprite + retiring a blown-away door) and step 5 (re-tiling
    //the breach's edges) happen here; steps 2-4 (nav, physics, fog) and 6-7 (FX, AI) are
    //the ordered listeners on `cell:destroyed`. Grid flags are set BEFORE the event so every
    //listener — and the autotile pass — sees the hole, not the wall.
    this.destroyCell = function(index){
        var cell = this.cells[index];
        if(!cell)return;

        //Step 1: grid flags. The cell stops being solid, opaque and a door all at once.
        cell.solid = false;
        cell.blocks_vision = false;
        cell.door = false;

        //Rubble sprite: a breach next to a staff-only (restricted) tile shows the red floor,
        //matching the surroundings; otherwise the cell's `rubbleTile` (a plain floor). This
        //reproduces the old bomb's restricted check.
        var makeRestricted = false;
        if(this.isTileRestricted_coords(cell.x-64,cell.y))makeRestricted = true;
        if(this.isTileRestricted_coords(cell.x+64,cell.y))makeRestricted = true;
        if(this.isTileRestricted_coords(cell.x,cell.y-64))makeRestricted = true;
        if(this.isTileRestricted_coords(cell.x,cell.y+64))makeRestricted = true;
        if(makeRestricted)cell.changeImage(4);
        else cell.changeImage(this.imageForTileCode(cell.rubbleTile || 2));

        //A door whose cell is blown away must stop opening and closing itself, or the next
        //guard walking past would flip solid/blocks_vision back on and put a phantom wall in
        //the hole. `broken` is the door's existing "kicked down" state; open()+close() honour it.
        for(var ds = 0; ds < this.door_sprites.length; ds++){
            var door_sprite = this.door_sprites[ds];
            if(door_sprite.relatedDoorWall.cellIndex() === index){
                door_sprite.open();
                door_sprite.broken = true;
            }
        }

        //Step 5: re-tile the breach's edges (the neighbours' wall sprites change shape).
        refreshAutotileAround(this, index);

        //Steps 2-4 (nav walkable + regions + flow fields, physics destroyFixture, fog
        //occluder cache) and steps 6-7 (debris/dust/sound FX, AI danger + breach entry) are
        //the ordered listeners on this event.
        events.emit('cell:destroyed', index);
    };

    ////////////////////////////////////////////////////////////////////////////
    // Pathfinding lives in src/nav/ (roadmap §4).
    //
    // This file used to own an A* graph built once from the cell flags and never
    // updated again — which is why a wall the bomb blew open stayed impassable to
    // guards for the rest of the run. `nav` derives its layers from these same flags
    // at build time and is told about changes through the `nav:dirty` event, so a
    // breach is pathable immediately. The shortcut/string-pulling code moved to
    // src/nav/smooth.ts, where it is unit-tested against the grid flags instead of
    // the 40-step DDA raycaster.
    ////////////////////////////////////////////////////////////////////////////

    //Pure math, no grid state — it only lives on the grid for historical reasons. The
    //shortcut code that used to be its main caller is gone; the blood-splatter code in
    //main.ts and sprite_hero.ts still uses it.
    this.angleBetweenPoints = function (ax,ay,bx,by){
        //in radians
        var deltaY = by - ay;
        var deltaX = bx - ax;
        return Math.atan2(deltaY,deltaX);
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
