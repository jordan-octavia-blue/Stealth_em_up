/*******************************************************\
Copyright 2014,2015, Jordan O'Leary, All rights reserved.
If you would like to copy or use my code, you may contact
me at jdoleary@gmail.com
/*******************************************************/
function jo_movie_clip(path, name, frames, type){
    //returns a movie_clip, pass paramaters of clip "explosion_7.png" as jo_movie_clip("movie_clips\","explosion_",7,".png");
    var movie_textures = [];
    
    for (var i=0; i < frames; i++) 
    {
        var texture = PIXI.Texture.fromImage(path + name + (i) + type);
        movie_textures.push(texture);
    };
    return new PIXI.extras.MovieClip(movie_textures);
}






// --- legacy global bridge ---------------------------------------------------
// This file used to be a classic <script> whose top-level declarations landed on
// `window`. It is an ES module now, so the functions below are republished as
// globals for the not-yet-extracted code that still reads them by bare name.
// See src/legacy-bridge.ts. Each extraction deletes another line from here.
Object.assign(window, { jo_movie_clip });

export {};
