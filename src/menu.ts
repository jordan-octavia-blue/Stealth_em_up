/**
 * Menu entry point (`menu.html`).
 *
 * `jo_local_storage` is imported for its side effect: it republishes the `jo_store*`
 * localStorage helpers onto `window`, which the Stats screen reads (wins/loses/guards).
 * `initMenu` wires up the whole menu — the SoYMD-style view switching, settings, and the
 * rebindable Controls screen — once the DOM is ready.
 */
import './legacy/jo_local_storage';
import { initMenu } from './menu/menu';

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initMenu);
} else {
  initMenu();
}
