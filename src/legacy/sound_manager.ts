/*******************************************************\
Copyright 2014,2015, Jordan O'Leary, All rights reserved.
If you would like to copy or use my code, you may contact
me at jdoleary@gmail.com
/*******************************************************/

//NOTE: When you add a new sound, be sure to use changeVolume under readjustVolumes

window.volume_master = 1.0;
console.log("Master Volume: " + volume_master);

window.sound_dry_fire = new Audio("sound/dryfiregun.wav");
window.sound_gun_shot = new Audio("sound/gun_shot.mp3");

window.sound_gun_shots = {"index": 0,"array":[]};
sound_gun_shots["array"].push(new Audio("sound/gun_shot.mp3"));
sound_gun_shots["array"].push(new Audio("sound/gun_shot.mp3"));
sound_gun_shots["array"].push(new Audio("sound/gun_shot.mp3"));
sound_gun_shots["array"].push(new Audio("sound/gun_shot.mp3"));
sound_gun_shots["array"].push(new Audio("sound/gun_shot.mp3"));
sound_gun_shots["array"].push(new Audio("sound/gun_shot.mp3"));
sound_gun_shots["array"].push(new Audio("sound/gun_shot.mp3"));

window.sound_gun_shot_silenced = new Audio("sound/gun_shot_silenced.mp3");
window.sound_guard_choke = new Audio("sound/guard_choke.wav");
window.sound_door_open = new Audio("sound/door-2-open.mp3");
window.sound_door_close = new Audio("sound/door-3-close.wav");
window.sound_explosion = new Audio("sound/explosion.wav");
window.music_hero_dead ??= undefined;
window.music_masked ??= undefined;
window.music_unmasked ??= undefined;
//force_buffer_sound("sound/Hidden_Agenda.mp3", 1.0, function(audio){music_unmasked = audio;});
//force_buffer_sound("sound/Volatile_Reaction.mp3", 0.0, function(audio){music_masked = audio;});
//force_buffer_sound("sound/Vanes.mp3", 0.0, function(audio){music_hero_dead = audio;});

readjustVolumes();//call once automatically:

function readjustVolumes(){
    changeVolume(sound_door_open,0.2);
    changeVolume(sound_door_close,0.2);
    changeVolume(sound_gun_shot,0.2);
    changeVolume(sound_gun_shot_silenced,1.0);
    changeVolume(sound_guard_choke,1.0);
    changeVolume(sound_dry_fire,1.0);
    changeVolume(sound_explosion,1.0);
    
    for(var i = 0; i < sound_gun_shots["array"].length; i++)changeVolume(sound_gun_shots["array"][i],0.2);
}
    

function changeVolume(clip,newVolume){
    if(clip != null)clip.volume = newVolume*volume_master;
}

function play_sound(sound){
    if(sound == undefined)return;
    //chrome / firefox discrepancy:
    if (window.chrome) sound.load()
    sound.play()
}

function play_sound_many(sound_array){
    //if a sound has .play() called while its still playing it will start over.  But if I use an array of the same sound
    //and cycle it whenever I want a sound to play, it is likely that the sound will finish by the time a new one is started.
    if(sound_array["index"] >= sound_array["array"].length)sound_array["index"] = 0;
    play_sound(sound_array["array"][sound_array["index"]++]);
    //console.log('play index ' + sound_array["index"] + ' size: ' + sound_array["array"].length);
}

function pause_sound(sound){
    sound.pause();
}

function force_buffer_sound(url, vol, callback_return){
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.responseType = 'blob';
    xhr.onload = function(e) {
      if (this.status == 200) {
        //got it
        var myBlob = this.response;
        var sound = (window.webkitURL ? webkitURL : URL).createObjectURL(myBlob);

        var aud = new Audio();
        aud.src = sound;
        changeVolume(aud,vol)
        //repeat music
        aud.addEventListener('ended', function() {
            this.currentTime = 0;
            this.play();
        }.bind(aud));
        aud.play();
        callback_return(aud);
        
       }
      }

    xhr.send();
}

// --- legacy global bridge ---------------------------------------------------
// This file used to be a classic <script> whose top-level declarations landed on
// `window`. It is an ES module now, so the functions below are republished as
// globals for the not-yet-extracted code that still reads them by bare name.
// See src/legacy-bridge.ts. Each extraction deletes another line from here.
Object.assign(window, { readjustVolumes, changeVolume, play_sound, play_sound_many, pause_sound, force_buffer_sound });

export {};
