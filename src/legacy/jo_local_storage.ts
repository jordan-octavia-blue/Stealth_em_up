/*
Stats:
Per Level:
Wins
Loses
In General:
Guards Shot
Guards choked
Time Played
*/
function supports_html5_storage() {
  try {
    return 'localStorage' in window && window['localStorage'] !== null;
  } catch (e) {
    return false;
  }
}
window.storageEnabled = supports_html5_storage();
console.log("\t\t\t\t\t\t\t\t\t\t\tSupports HTML5 Storage: " + storageEnabled);
function jo_store(name,value){
    if(storageEnabled){
        if(localStorage[name]){
            localStorage[name] = value;
            console.log("localStorage: " + name + " is now " + value);
        }else{
            console.log("localStorage " + name + " not found. Making new entry.");
            console.log("localStorage: " + name + " is now " + value);
            localStorage[name] = value;
        }
    }
}
function jo_store_inc(name){

    if(storageEnabled){
        //increment
        if(localStorage[name]){
            localStorage[name]++;
            console.log("inc localStorage: " + name + " is now " + localStorage[name]);
        }else {
                localStorage[name] = 1;
        }
    }
}
function jo_store_get(name){

    if(storageEnabled){
        if(localStorage[name]){
            return localStorage[name];
        }else{
            console.log("localStorage " + name + " not found.");
        }
    }else{
        return "HTML5 Storage Not Enabled";
    }
}

// --- legacy global bridge ---------------------------------------------------
// This file used to be a classic <script> whose top-level declarations landed on
// `window`. It is an ES module now, so the functions below are republished as
// globals for the not-yet-extracted code that still reads them by bare name.
// See src/legacy-bridge.ts. Each extraction deletes another line from here.
Object.assign(window, { supports_html5_storage, jo_store, jo_store_inc, jo_store_get });

export {};
