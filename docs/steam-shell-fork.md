# Forking Golems-Electron-Build for Stealth_em_up multiplayer

The game's Steam multiplayer codes against the template's existing IPC bridge
(`electronSettings.p2pSend`, `steamworks.subscribeToP2PMessages`, the lobby
handlers) — most of the shell works as-is. Nine small changes are needed in a
fork of `Golems-Electron-Build`. Each change below shows the exact current code
(verified against the template at the time of writing) and its replacement.

The game runs fine with **zero** shell changes except #1 and #8 (it detects a
missing `reliable` flag / `getLobbyOwner` and degrades: everything rides the
reliable channel, and the host is inferred when the lobby has 2 members). For
smooth 3–4 player play under packet loss, apply them all.

---

## 1. Wire this game's build output (required)

`package.json` — replace the Spellmasons build-copy script:

```json
"get-latest-from-golems-repo": "rm -rf src/build && (cd ../Golems && npm run build --workspace=@spellmasons/core --workspace=spellmasons) && cp -r ../Golems/build src && cp -r ../Golems/headless-server-build src && rm -rf src/build/spellmasons-mods/node_modules",
```

with (adjust the relative path to where Stealth_em_up is checked out):

```json
"get-latest-from-stealth-repo": "rm -rf src/build && (cd ../Stealth_em_up && npm run build) && cp -r ../Stealth_em_up/dist src/build",
```

and update `"start"` to call the new script name. The `headless-server-build`
copy is Spellmasons-only — drop it (the `localServer` IPC is then unused, which
is fine).

`src/index.js` — the game page is `game.html`, not `index.html`:

```js
  mainWindow.loadFile('/build/index.html');
```
→
```js
  mainWindow.loadFile('/build/game.html');
```

(The file-protocol interceptor that rewrites vite's absolute `/assets/...` URLs
already handles the rest.)

## 2. App id (required for dev testing)

`src/index.js` (in `setupSteamworks()`):

```js
    client = steamworks.init(1618380);
```
→
```js
    // 480 = Spacewar, Valve's shared test appid — replace with the game's own
    // appid once it has a Steam page.
    const APP_ID = Number(process.env.STEAM_APP_ID || 480);
    client = steamworks.init(APP_ID);
```

`src/steam_appid.txt` → `480` (dev only; this file is already excluded from
packaged builds).

## 3. Lobby size

`src/index.js`:

```js
const MAX_LOBBY_PLAYERS = 20;
```
→
```js
const MAX_LOBBY_PLAYERS = 4;
```

## 4. Only accept P2P sessions from lobby members (security)

`src/index.js` — the current handler accepts anyone:

```js
  client.callback.register(SteamCallback.P2PSessionRequest, (args) => {
    const {remote} = args;
      console.log(`P2PSessionRequest from ${remote}`)
      sendToRenderer('log', `PiePeer: Accepted peer session from: ${remote.toString()}`);
      client.networking.acceptP2PSession(remote)
  });
```
→
```js
  client.callback.register(SteamCallback.P2PSessionRequest, (args) => {
    const {remote} = args;
    const members = lobby ? lobby.getMembers() : [];
    const isMember = members.some(m => m.steamId64.toString() === remote.toString());
    if (!isMember) {
      console.warn(`P2PSessionRequest from ${remote} rejected: not in our lobby`);
      return;
    }
    console.log(`P2PSessionRequest from ${remote}`)
    sendToRenderer('log', `PiePeer: Accepted peer session from: ${remote.toString()}`);
    client.networking.acceptP2PSession(remote)
  });
```

## 5. Remove the broken persona-name call

steamworks.js 0.4.0 has **no `friends` namespace**; this line always throws
into its catch. Player names travel inside the game's own HELLO handshake, so
delete the lookup. `src/index.js` (LobbyChatUpdate handler):

```js
        let name = undefined;
        try {
          name = client.friends.getFriendPersonaName(arg.user_changed);
        } catch (e) {
          // Best effort only — the game resolves names later via its own player-config sync
        }
```
→
```js
        // steamworks.js has no `friends` namespace — names travel in the game's
        // own HELLO handshake instead.
        let name = undefined;
```

## 6. Reliability flag on p2pSend (recommended — smooth play under loss)

The game sends two kinds of traffic: reliable control/events, and 20–30Hz
state packets that must be allowed to drop (Steam classic P2P: unreliable
≤1200 bytes). `src/index.js`:

```js
  handleValidated('p2pSend', (e, [peerSteamId64, message]) => {
    if (client) {
      client.networking.sendP2PPacket(peerSteamId64, client.networking.SendType.Reliable, message)
    } else {
      console.log('Warn: No steamworks client')
    }
  });
```
→
```js
  handleValidated('p2pSend', (e, [peerSteamId64, message, reliable]) => {
    if (client) {
      const sendType = reliable === false
        ? client.networking.SendType.Unreliable
        : client.networking.SendType.Reliable;
      const buf = Buffer.isBuffer(message) ? message : Buffer.from(message);
      client.networking.sendP2PPacket(peerSteamId64, sendType, buf)
    } else {
      console.log('Warn: No steamworks client')
    }
  });
```

`src/preload.js`:

```js
    p2pSend: (peerSteamId, message) => {
        // console.log('p2pSend', peerSteamId, typeof message, message);
        return ipcRenderer.invoke('p2pSend', [peerSteamId, message]);
    },
```
→
```js
    p2pSend: (peerSteamId, message, reliable) => {
        return ipcRenderer.invoke('p2pSend', [peerSteamId, message, reliable]);
    },
```

(`p2pSendMany` can stay as-is — the game doesn't use it.)

## 7. Expose the lobby owner (recommended — reliable host discovery)

A guest needs to know which member is the host. `src/index.js`, next to the
`getLobbyMembers` handler:

```js
  handleValidated('getLobbyOwner', () => {
    if (lobby) {
      return lobby.getOwner().steamId64.toString();
    }
    return null;
  });
```

`src/preload.js`, inside the `electronSettings` object:

```js
    getLobbyOwner: () => {
        return ipcRenderer.invoke('getLobbyOwner');
    },
```

## 8. Single-instance lock (recommended)

A `+connect_lobby` cold launch while the game is already running currently
spawns a second process. `src/index.js`, near the top of the app lifecycle
(before `app.whenReady()`):

```js
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    // Steam relaunched us with an invite — forward it to the running instance.
    let lobbyId = undefined;
    const argIndex = argv.indexOf('+connect_lobby');
    if (argIndex !== -1 && argv[argIndex + 1]) lobbyId = argv[argIndex + 1];
    const combined = argv.find(a => a.startsWith('+connect_lobby '));
    if (!lobbyId && combined) lobbyId = combined.split(' ')[1];
    if (lobbyId) joinFriendLobby(BigInt(lobbyId));
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}
```

## 9. Do NOT touch

- `steamworks.electronEnableSteamOverlay(true)` and the
  `disable-direct-composition` / `in-process-gpu` switches — the overlay (and
  the invite dialog the game uses) depends on them.
- The borderless-fullscreen emulation in `createWindow()` — load-bearing
  against Alt-Tab ghost windows.
- `handleValidated` / `validateSender` — register the new `getLobbyOwner`
  channel through `handleValidated` like every other channel.
- The fullscreen toggle's `app.relaunch()` — the game treats a relaunch as a
  disconnect, which is the correct behavior.

---

## Testing the packaged build (two machines / two Steam accounts)

1. Both machines: Steam running and logged in, appid 480 (Spacewar) — any
   account can use it.
2. `npm run get-latest-from-stealth-repo && npm run start-no-build` (or a
   packaged build).
3. Machine A: **Host Co-op Heist** → **Invite Friends** → invite B via the
   overlay.
4. Machine B accepts (game running → joins live; game closed → launches with
   `+connect_lobby` and lands in the lobby).
5. A presses **Start Game**: both load, B reports READY, A answers GO.
6. Checklist: guards visible and patrolling on B; movement smooth both ways;
   mask/suspicion/alarms propagate; choke/drag/lockpick/loot/bomb/guns; downed
   + revive; the van (either driver); the escape-drive win for the whole crew;
   B quits mid-run (A sees the leave); A quits mid-run (B lands on the menu
   with the host-lost message); version mismatch (edit APP_BUILD in
   `src/systems/netplay.ts` on one side) shows the friendly rejection.
