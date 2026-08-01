/**
 * Particle system (roadmap §2.2 strangler step, Phase 2).
 *
 * Shell casings, wall shards and blood droplets: spawned by the splatter/eject
 * functions, advanced once per fixed step by updateParticles(). Moved verbatim out
 * of main.ts; still reads the shared world state (`shells`, `grid`,
 * `particle_container`, sprite-sheet handles, ...) as window globals until those
 * gain owners of their own. Per-tick motion constants are correct here because the
 * gameloop runs at a fixed 60 Hz.
 */

//Tuning constants. Only this module reads them (they were window globals in main.ts).
var shell_speed = 10;
var blood_speed = 1;
var shard_limit = 2000;
//Which shard image the next shard uses; images_from_sheet.ts reads it at load time to
//pick the initial `currentShard`, so it stays a window global.
window.shardType = 0;

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

//Advance every live particle one fixed step; called from gameloop().
export function updateParticles(deltaTime){
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
}

export function shardParticleSplatter(angle,target){
    var shardAmount = randomIntFromInterval(6,30);
        angle += Math.PI/2;//I don't know why it's off by Pi/2 but it is.
    for(var i = 0; i < shardAmount; i++){
        var shard = new PIXI.Sprite(currentShard);


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
        window.shardType++;
        window.shardType %= shardImages.length;
        window.currentShard = shardImages[shardType];

        if(shards.length > shard_limit)return;
    }

}
export function bloodParticleSplatter(angle,target){
    //var bloodAmount = randomIntFromInterval(15,30);
    var bloodAmount = randomIntFromInterval(30,60);
    angle += Math.PI/2;//I don't know why it's off by Pi/2 but it is.
    var bloodSplat;
    for(var i = 0; i < bloodAmount; i++){
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
export function ejectShell(source){

    var shell = new PIXI.Sprite(img_shell);


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
