/**
 * Menu behaviour for `menu.html`.
 *
 * Modelled on Some of You May Die's `src/menu.ts`: one delegated click listener on
 * `document.body` drives everything via data attributes.
 *
 *   - `data-view="name"`   -> `setMenuView('name')` toggles the `menu-{name}` body class
 *                             that CSS uses to show exactly one `.view`.
 *   - `data-fn="menu-act"` + `data-act` + `data-value` -> a switch of menu actions.
 *   - `data-bind` + `.btn.active` -> option buttons reflect their persisted value
 *                             (handled by `runBindings` in ./storage).
 *
 * SoYMD-only screens (compendium, multiplayer, squads, runes, biomes, ...) are omitted.
 * What remains is the generic shell — Play, Settings (Audio + Controls + Other), Stats,
 * Credits — plus a rebindable Controls section, which is the piece SoYMD never shipped a
 * UI for.
 */
import {
  STORAGE_OPTIONS,
  assign,
  getSavedData,
  remove,
  runBindings,
} from './storage';
import type { MenuOptions } from './storage';
import {
  KEY_ACTIONS,
  codeFor,
  keyLabel,
  resetBindings,
  setBinding,
} from '../systems/keybindings';

// The playable missions. Mission Select links straight into game.html for the chosen
// level, carrying the persisted volume. Only bank_1 ships as a real .jomap today; add
// rows here as more maps land.
interface Mission {
  level: string;
  name: string;
  desc: string;
}
const MISSIONS: Mission[] = [
  {
    level: 'bank_1',
    name: 'International Bank',
    desc: 'Crack the vault, grab the cash, and vanish before the alarm goes up.',
  },
];

let currentOptions: MenuOptions;
let currentSettingsCategory = 'controls';

/** Switch which `.view` is shown by swapping the `menu-*` class on <body>. */
function setMenuView(name: string): void {
  const body = document.body;
  for (const cls of Array.from(body.classList)) {
    if (cls.startsWith('menu-')) body.classList.remove(cls);
  }
  body.classList.add(`menu-${name}`);
}

/** Show one settings section and highlight its sidebar tab. */
function selectSettingsCategory(category: string): void {
  currentSettingsCategory = category;
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('.settings-nav-btn'))) {
    el.classList.toggle('active', el.dataset.value === category);
  }
  for (const section of Array.from(
    document.querySelectorAll<HTMLElement>('.settings-section'),
  )) {
    section.style.display = section.dataset.settingsCategory === category ? '' : 'none';
  }
}

/** Read a legacy stat counter (persisted by the game via jo_store_inc), defaulting to 0. */
function stat(name: string): number {
  const raw = (globalThis as any).jo_store_get?.(name);
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : 0;
}

function renderStats(): void {
  const el = document.getElementById('player-stats');
  if (!el) return;
  const rows: Array<[string, number]> = [
    ['Missions Won', stat('wins')],
    ['Missions Failed', stat('loses')],
    ['Guards Shot', stat('guardsShot')],
    ['Guards Choked Out', stat('guardsChoked')],
  ];
  el.innerHTML = rows
    .map(
      ([label, value]) =>
        `<div class="stat-row"><span class="stat-label">${label}</span><span class="stat-value">${value}</span></div>`,
    )
    .join('');
}

function renderMissions(): void {
  const el = document.getElementById('mission-list');
  if (!el) return;
  el.innerHTML = MISSIONS.map(
    (m) => `
      <div class="mission-card btn" data-fn="menu-act" data-act="play" data-value="${m.level}">
        <div class="mission-name">${m.name}</div>
        <div class="mission-desc">${m.desc}</div>
      </div>`,
  ).join('');
}

// --- Keybindings UI --------------------------------------------------------

let listeningAction: string | null = null;

function renderKeybindings(): void {
  const el = document.getElementById('keybindings-list');
  if (!el) return;
  const groups: string[] = [];
  for (const action of KEY_ACTIONS) {
    if (!groups.includes(action.group)) groups.push(action.group);
  }
  el.innerHTML = groups
    .map((group) => {
      const rows = KEY_ACTIONS.filter((a) => a.group === group)
        .map((a) => {
          const listening = listeningAction === a.id;
          const label = listening ? 'Press a key…' : keyLabel(codeFor(a.id));
          return `
            <div class="keybind-row">
              <span class="keybind-label">${a.label}</span>
              <div class="btn btn-key ${listening ? 'listening' : ''}"
                   data-fn="menu-act" data-act="rebind" data-value="${a.id}">${label}</div>
            </div>`;
        })
        .join('');
      return `<div class="keybind-group"><h3>${group}</h3>${rows}</div>`;
    })
    .join('');
}

function stopListening(): void {
  if (listeningAction !== null) {
    window.removeEventListener('keydown', onRebindKey, true);
    listeningAction = null;
  }
}

function onRebindKey(e: KeyboardEvent): void {
  // Capture the key before any game/menu handler sees it.
  e.preventDefault();
  e.stopPropagation();
  const action = listeningAction;
  stopListening();
  if (!action) return;
  const code = e.keyCode || e.which;
  // Esc cancels the rebind rather than binding to Esc (Esc is reserved in-game).
  if (code !== 27) {
    const swapped = setBinding(action, code);
    if (swapped) {
      const swappedLabel = KEY_ACTIONS.find((a) => a.id === swapped)?.label ?? swapped;
      showToast(`"${keyLabel(code)}" was already used — "${swappedLabel}" moved to a free key.`);
    }
  }
  renderKeybindings();
}

function beginRebind(actionId: string): void {
  if (listeningAction === actionId) {
    // Clicking the listening button again cancels.
    stopListening();
    renderKeybindings();
    return;
  }
  stopListening();
  listeningAction = actionId;
  renderKeybindings();
  window.addEventListener('keydown', onRebindKey, true);
}

// --- Small transient toast -------------------------------------------------

let toastTimer: ReturnType<typeof setTimeout> | undefined;
function showToast(message: string): void {
  let el = document.getElementById('menu-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'menu-toast';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el && el.classList.remove('show'), 3200);
}

// --- Actions ---------------------------------------------------------------

function launchMission(level: string): void {
  const volume = currentOptions?.volume ?? 1;
  window.location.href = `game.html?volume=${volume}&level=${encodeURIComponent(level)}`;
}

function handleAction(act: string | null, value: string | null): void {
  switch (act) {
    case 'settings-category':
      if (value) selectSettingsCategory(value);
      break;
    case 'play':
      if (value) launchMission(value);
      break;
    case 'rebind':
      if (value) beginRebind(value);
      break;
    case 'reset-keybinds':
      stopListening();
      resetBindings();
      renderKeybindings();
      showToast('Controls reset to defaults.');
      break;
    case 'reset-all-settings':
      stopListening();
      remove(STORAGE_OPTIONS);
      resetBindings();
      currentOptions = getSavedData();
      applyVolumeToSlider();
      renderKeybindings();
      showToast('All settings reset to defaults.');
      break;
    default:
      // Unknown / navigation-only elements are handled elsewhere.
      break;
  }
}

// --- Volume slider ---------------------------------------------------------

function applyVolumeToSlider(): void {
  const slider = document.getElementById('volume-total') as HTMLInputElement | null;
  if (slider) slider.value = String(Math.round((currentOptions?.volume ?? 1) * 100));
}

function wireVolumeSlider(): void {
  const slider = document.getElementById('volume-total') as HTMLInputElement | null;
  if (!slider) return;
  slider.addEventListener('input', () => {
    const volume = Math.max(0, Math.min(100, Number(slider.value))) / 100;
    currentOptions = assign(STORAGE_OPTIONS, { volume });
  });
}

// --- Bootstrap -------------------------------------------------------------

let started = false;
export function initMenu(): void {
  if (started) return;
  started = true;

  currentOptions = getSavedData();

  document.body.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;

    // Navigation via data-view.
    const viewEl = target.closest('[data-view]') as HTMLElement | null;
    if (viewEl) {
      const view = viewEl.dataset.view;
      if (view) {
        // Leaving a screen mid-rebind should not keep listening for keys.
        stopListening();
        setMenuView(view);
        if (view === 'settings') {
          runBindings(currentOptions as unknown as object);
          selectSettingsCategory(currentSettingsCategory);
          renderKeybindings();
        } else if (view === 'achievements') {
          renderStats();
        }
      }
      return;
    }

    // Actions via data-fn="menu-act".
    const fnEl = target.closest('[data-fn]') as HTMLElement | null;
    if (fnEl && fnEl.dataset.fn === 'menu-act') {
      handleAction(fnEl.dataset.act ?? null, fnEl.dataset.value ?? null);
    }
  });

  wireVolumeSlider();
  applyVolumeToSlider();
  renderMissions();
  renderKeybindings();
  renderStats();
  selectSettingsCategory(currentSettingsCategory);
}
