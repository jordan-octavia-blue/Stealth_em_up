//Debug Module
function debug_line(){
    //a new debug line should be created for each line that you want to draw
    this.graphics = new PIXI.Graphics();
    this.color = 0x0000ff;
    display_actors.addChild(this.graphics);
    this.draw = function(x1,y1,x2,y2){
        //draw on the screen relative (where upper left corner is 0,0)
        this.graphics.clear();//without clear it wont erase the debug shape from previous frame.
        this.graphics.lineStyle(2, this.color, 1);
		this.graphics.moveTo(x1, y1);
		this.graphics.lineTo(x2, y2);
    }
    this.draw_obj = function(x1,y1,x2,y2){
        //draw on the screen objective (where game origin is 0,0)
        var draw_coords1 = camera.relativePoint({x:x1,y:y1});
        var draw_coords2 = camera.relativePoint({x:x2,y:y2});
        this.graphics.clear();//without clear it wont erase the debug shape from previous frame.
        this.graphics.lineStyle(2, this.color, 1);
		this.graphics.moveTo(draw_coords1.x, draw_coords1.y);
		this.graphics.lineTo(draw_coords2.x, draw_coords2.y);
    }
    this.draw_Ray = function(ray){
        //draw on the screen objective (where game origin is 0,0)
        var draw_coords1 = camera.relativePoint({x:ray.start.x,y:ray.start.y});
        var draw_coords2 = camera.relativePoint({x:ray.end.x,y:ray.end.y});
        this.graphics.clear();//without clear it wont erase the debug shape from previous frame.
        this.graphics.lineStyle(2, 0xcc0000, 1);
		this.graphics.moveTo(draw_coords1.x, draw_coords1.y);
		this.graphics.lineTo(draw_coords2.x, draw_coords2.y);
    }
    this.draw_Ray_without_clear = function(ray,color){
        //draw on the screen objective (where game origin is 0,0)
        var draw_coords1 = camera.relativePoint({x:ray.start.x,y:ray.start.y});
        var draw_coords2 = camera.relativePoint({x:ray.end.x,y:ray.end.y});
        this.graphics.lineStyle(2, color, 1);
		this.graphics.moveTo(draw_coords1.x, draw_coords1.y);
		this.graphics.lineTo(draw_coords2.x, draw_coords2.y);
        
        this.graphics.drawCircle(draw_coords2.x, draw_coords2.y,10);
        
    }
    this.clear = function(){
        this.graphics.clear();//without clear it wont erase the debug shape from previous frame.
    }
}

function debug_circle(parent){
    //a new debug circle should be created for each circle that you want to draw
    this.graphics = new PIXI.Graphics();
    this.graphics.lineStyle(0);
    if(!parent)stage_child.addChild(this.graphics);
    else parent.addChild(this.graphics);
    this.color = 0x990000;
    this.alpha = 0.5;
    this.draw = function(x,y,size,noClear){
        if(!noClear)this.graphics.clear();//without clear it wont erase the debug shape from previous frame.
        this.graphics.beginFill(this.color, this.alpha);
        this.graphics.drawCircle(x, y,size);
    
    }
    this.draw_obj = function(x,y,size){
        var draw_coords = camera.relativePoint({x:x,y:y});
        this.graphics.clear();//without clear it wont erase the debug shape from previous frame.
        this.graphics.beginFill(this.color, this.alpha);
        this.graphics.drawCircle(draw_coords.x, draw_coords.y,size);
    
    }

}

// --- legacy global bridge ---------------------------------------------------
// This file used to be a classic <script> whose top-level declarations landed on
// `window`. It is an ES module now, so the functions below are republished as
// globals for the not-yet-extracted code that still reads them by bare name.
// See src/legacy-bridge.ts. Each extraction deletes another line from here.
Object.assign(window, { debug_line, debug_circle });

export {};
