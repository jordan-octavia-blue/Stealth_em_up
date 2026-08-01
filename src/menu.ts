/**
 * Menu entry point (`menu.html`).
 *
 * The hub page used to preload every game script so the browser had them cached before
 * `game.html` asked for them. That is pointless now the game is a bundle, so only the
 * one module the page actually calls into — the localStorage helpers behind the upgrade
 * shop — is loaded here. It publishes `jo_store*` onto `window` for the page's inline
 * scripts and `onclick=` handlers.
 */
import './legacy/jo_local_storage';
