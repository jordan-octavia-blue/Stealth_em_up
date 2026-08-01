
function moveToTarget(x,y,targx,targy,speed){
    //this function uses similar triangles with sides a,b,c and A,B,C where c and C are the hypotenuse
    //the movement of x and y (a,b) are found with the formulas: A/C = a/c and B/C = b/c
    var a,b;
    var c = speed;
    var A = targx-x;
    var B = targy-y;
    var C = Math.sqrt(A*A+B*B);
    if(c>C) return {x: targx,y: targy} // the object is close enough, snap to target
    a = c*A/C;
    b = c*B/C;
    var movement = {x: x+a,y: y+b, ang: Math.atan2(b,a)};
    return movement;

}
//used for guns to randomize angle of fire
function rotate_point_about_axis(axis,angle,p)
{
    //angle is in degrees
    
    //convert from deg to rad:
    angle *= Math.PI/180;
    var orig = {x:p.x,y:p.y};
    //console.log('start: ' + p.x + "," + p.y);
    var s = Math.sin(angle);
    var c = Math.cos(angle);

    // translate point back to origin:
    p.x -= axis.x;
    p.y -= axis.y;

    // rotate point
    var xnew = p.x * c - p.y * s;
    var ynew = p.x * s + p.y * c;

    // translate point back:
    p.x = xnew + axis.x;
    p.y = ynew + axis.y;
    //console.log('rotation change: ' + (180/Math.PI)*Math.atan2(get_distance(orig.x,orig.y,p.x,p.y),get_distance(orig.x,orig.y,axis.x,axis.y)));
    //console.log('end: ' + p.x + "," + p.y);
    return p;
}
function randomIntFromInterval(min,max)
{
    //console.log(min + "," + max);
    return Math.floor(Math.random()*(max-min)+min);
}

function biasTest(min,max,bias){
    var sum = 0;
    var highest = 0;
    for(var i = 0; i < 1000; i++){
        var r = randomFloatWithBias2(min,max);
        //var r = randomFloatFromInterval(min,max);
        sum += r;
        if(r > highest)highest = r;

    }
    return sum/1000;
}
//higher bias yields lower numbers more often
function randomFloatWithBias2(min,max){
    return (Math.random() * Math.random() * max) + min;
    
}
//higher bias yields lower numbers more often
function randomFloatWithBias(min,max){
    /*var rand = Math.random();
    rand = Math.pow(rand,bias);
    return (rand*(max-min)+min);*/
    return (Math.random() * Math.random() * max) + min;
    
}
function randomFloatFromInterval(min,max)
{
    //console.log(min + "," + max);
    return (Math.random()*(max-min)+min);
}

// --- legacy global bridge ---------------------------------------------------
// This file used to be a classic <script> whose top-level declarations landed on
// `window`. It is an ES module now, so the functions below are republished as
// globals for the not-yet-extracted code that still reads them by bare name.
// See src/legacy-bridge.ts. Each extraction deletes another line from here.
Object.assign(window, { moveToTarget, rotate_point_about_axis, randomIntFromInterval, biasTest, randomFloatWithBias2, randomFloatWithBias, randomFloatFromInterval });

export {};
