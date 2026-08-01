/*******************************************************\
Copyright 2014,2015, Jordan O'Leary, All rights reserved.
If you would like to copy or use my code, you may contact
me at jdoleary@gmail.com
/*******************************************************/
function circle_linesetment_intersect(circle,linestart,lineend){
    //http://stackoverflow.com/questions/1073336/circle-line-collision-detection
    //linestart and lineend in form {x: #, y: #}
    var E = linestart;
    var L = lineend;
    var C = circle.center;
    var r = circle.radius;
    
    var d = {x: L.x - E.x, y: L.y - E.y};
    var f = {x: E.x - C.x, y: E.y - C.y};
    
    var a = dot([d.x,d.y],[d.x,d.y]);
    var b = 2*dot([f.x,f.y],[d.x,d.y]);
    var c = dot([f.x,f.y],[f.x,f.y]) - r*r;
    var discriminant = b*b-4*a*c;
    if (discriminant < 0){
        //no intersection
        return false;
    }
    else{
        discriminant = Math.sqrt(discriminant);
        var t1 = (-b - discriminant)/(2*a);
        var t2 = (-b + discriminant)/(2*a);
        
        
        // 3x HIT cases:
        //          -o->             --|-->  |            |  --|->
        // Impale(t1 hit,t2 hit), Poke(t1 hit,t2>1), ExitWound(t1<0, t2 hit), 

        // 3x MISS cases:
        //       ->  o                     o ->              | -> |
        // FallShort (t1>1,t2>1), Past (t1<0,t2<0), CompletelyInside(t1<0, t2>1)

        if( t1 >= 0 && t1 <= 1 )
        {
        // t1 is the intersection, and it's closer than t2
        // (since t1 uses -b - discriminant)
        // Impale, Poke
        return true;
        }

        // here t1 didn't intersect so we are either started
        // inside the sphere or completely past it
        if( t2 >= 0 && t2 <= 1 )
        {
        // ExitWound
        return true;
        }

        // no intn: FallShort, Past, CompletelyInside
        return false;
    }
    
    
    function dot(a,b) {
        var n = 0, lim = Math.min(a.length,b.length);
        for (var i = 0; i < lim; i++) n += a[i] * b[i];
        return n;
    }
    
}

//var cir = {'center': {x:50,y:50}, 'radius': 10};
//var ray = {'start': {x:0,y:0}, 'end': {x:40,y:39}};

function Ray(x1,y1,x2,y2){
    this.start = {x:x1,y:y1};
    this.end = {x:x2,y:y2};
    this.set = function(x1,y1,x2,y2){
        this.start.x = x1;
        this.start.y = y1;
        this.end.x = x2;
        this.end.y = y2;
    };
}

function get_distance(x1,y1,x2,y2){
    return Math.sqrt((x1-x2)*(x1-x2)+(y1-y2)*(y1-y2));
}

function findAngleBetweenPoints(start,end){
    var opp = end.y - start.y;
    var adj = end.x - start.x;
    var ang = Math.atan2(opp,adj);
    return ang; //In radians
}
function angleInArcRad(arcAngle,arcSize,angle){
    arcAngle = arcAngle*180/Math.PI;
    arcSize = arcSize*180/Math.PI;
    angle = angle*180/Math.PI;
    return angleInArc(arcAngle,arcSize,angle);
}
function angleInArc(arcAngle,arcSize,angle){
/*
Example: angleInArc(45,25,40) returns true because
(45,25 represents an arc of 25 degrees centered at the angle 45 degrees.
Since 40 degrees is along that arc, it returns true.
*/
    return angle_between(angle,arcAngle-arcSize/2,arcAngle+arcSize/2);
}
function angle_between(n, a, b) {
    //console.log(n + ' ' + a + ' ' + b);
	n = (360 + (n % 360)) % 360;
	a = (3600000 + a) % 360;
	b = (3600000 + b) % 360;
    //console.log(Math.round(n) + ' ' + Math.round(a) + ' ' + Math.round(b));

	if (a < b){
        return a <= n && n <= b;
    }else{
        return a <= n || n <= b;
    }
}
function positionInCircle(circle,x,y){
    /*function lineDistance( point1, point2 )
    {
      var xs = 0;
      var ys = 0;
     
      xs = point2.x - point1.x;
      xs = xs * xs;
     
      ys = point2.y - point1.y;
      ys = ys * ys;
     
      return Math.sqrt( xs + ys );
    }
    //distance inside circle, not used currently
    var dist = lineDistance(circle,{x:x,y:y});*/
    var angle = Math.atan2(y-circle.y,x-circle.x)*180/Math.PI;
    return angle;

}
////////////////////////////////////////////////////////////
//////////////////////QUICK SORT for LOS///////////////////////////
////////////////////////////////////////////////////////////
function quickSort(items, left, right) {

    var index;

    if (items.length > 1) {

        index = partition(items, left, right);

        if (left < index - 1) {
            quickSort(items, left, index - 1);
        }

        if (index < right) {
            quickSort(items, index, right);
        }

    }

    return items;
}
function partition(items, left, right) {

    var pivot   = items[Math.floor((right + left) / 2)].angle,
        i       = left,
        j       = right;


    while (i <= j) {

        while (items[i].angle < pivot) {
            i++;
        }

        while (items[j].angle > pivot) {
            j--;
        }

        if (i <= j) {
            swap(items, i, j);
            i++;
            j--;
        }
    }

    return i;
}
function swap(items, firstIndex, secondIndex){
    var temp = items[firstIndex];
    items[firstIndex] = items[secondIndex];
    items[secondIndex] = temp;
}

// --- legacy global bridge ---------------------------------------------------
// This file used to be a classic <script> whose top-level declarations landed on
// `window`. It is an ES module now, so the functions below are republished as
// globals for the not-yet-extracted code that still reads them by bare name.
// See src/legacy-bridge.ts. Each extraction deletes another line from here.
Object.assign(window, { circle_linesetment_intersect, Ray, get_distance, findAngleBetweenPoints, angleInArcRad, angleInArc, angle_between, positionInCircle, quickSort, partition, swap });

export {};
