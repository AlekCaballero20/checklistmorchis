/* =============================================================================
  /src/app.js — Maleta · Checklist — App Orchestrator (NO-PWA for now)
  - Boots store + storage
  - Wires actions + render + UI + gestures + FX
  - Keeps mode theme (data-mode) synced
  - Completion logic (streak + confetti + glow) lives here
============================================================================= */

'use strict';

import { createStore } from './state.js';
import { createStorage } from './storage.js';
import { createActions } from './actions.js';

import {
  setupRenderEvents,
  renderTabs,
  renderAddCategories,
  renderList,
  renderProgress
} from './render.js';

import { initUI } from './ui.js';
import { createFX } from './fx.js';
import { initGestures } from './gestures.js';

/* =========================
   CONFIG / CONSTANTS
========================= */

const STORAGE_KEY  = 'maleta_pwa_v2_data';
const SETTINGS_KEY = 'maleta_pwa_v2_settings';

const DEFAULT_SETTINGS = {
  tripMode: 'salida',
  motion: true,
  sound: true,
  streak: 0
};

const PRESETS = {
  salida: {
    label: '🧳 Salida',
    cats: [
      { id:'tech',  name:'Tecnología',  emoji:'🔌' },
      { id:'docs',  name:'Documentos',  emoji:'🪪' },
      { id:'ropa',  name:'Ropa',        emoji:'👕' },
      { id:'hig',   name:'Higiene',     emoji:'🧼' },
      { id:'otros', name:'Otros',       emoji:'✨' },
    ],
    items: [
      { cat:'tech',  name:'Cargador del celular', emoji:'🔌' },
      { cat:'tech',  name:'Power bank',          emoji:'🔋' },
      { cat:'tech',  name:'Audífonos',           emoji:'🎧' },
      { cat:'docs',  name:'Cédula / documento',  emoji:'🪪' },
      { cat:'docs',  name:'Tarjeta / efectivo',  emoji:'💳' },
      { cat:'ropa',  name:'Chaqueta',            emoji:'🧥' },
      { cat:'hig',   name:'Desodorante',         emoji:'🧴' },
      { cat:'hig',   name:'Cepillo + crema',     emoji:'🪥' },
      { cat:'otros', name:'Llaves',              emoji:'🔑' },
    ]
  },

  viaje: {
    label: '✈️ Viaje',
    cats: [
      { id:'tech',  name:'Tecnología', emoji:'🔌' },
      { id:'docs',  name:'Documentos', emoji:'🧾' },
      { id:'salud', name:'Salud',      emoji:'💊' },
      { id:'ropa',  name:'Ropa',       emoji:'🧳' },
      { id:'otros', name:'Otros',      emoji:'✨' },
    ],
    items: [
      { cat:'docs',  name:'Pasaporte / ID',       emoji:'🛂' },
      { cat:'docs',  name:'Tiquetes / reservas',  emoji:'🎫' },
      { cat:'tech',  name:'Cargadores (todos)',   emoji:'🔌' },
      { cat:'tech',  name:'Adaptador',            emoji:'🔁' },
      { cat:'salud', name:'Medicinas',            emoji:'💊' },
      { cat:'ropa',  name:'Medias extra',         emoji:'🧦' },
    ]
  },

  gira: {
    label: '🎭 Gira',
    cats: [
      { id:'tech',  name:'Tech',  emoji:'🔌' },
      { id:'audio', name:'Audio', emoji:'🎛️' },
      { id:'ropa',  name:'Ropa',  emoji:'👕' },
      { id:'docs',  name:'Docs',  emoji:'🪪' },
      { id:'otros', name:'Otros', emoji:'✨' },
    ],
    items: [
      { cat:'audio', name:'Micrófono / adaptadores', emoji:'🎤' },
      { cat:'audio', name:'Interfaces / cables',     emoji:'🧵' },
      { cat:'tech',  name:'Cargador laptop',         emoji:'💻' },
      { cat:'tech',  name:'USB / backup',            emoji:'💾' },
      { cat:'ropa',  name:'Outfit / cambio',         emoji:'👕' },
      { cat:'docs',  name:'Info del venue',          emoji:'📄' },
    ]
  },

  playa: {
    label: '🏖️ Playa',
    cats: [
      { id:'ropa',  name:'Ropa',  emoji:'🩳' },
      { id:'sol',   name:'Sol',   emoji:'🧴' },
      { id:'tech',  name:'Tech',  emoji:'📱' },
      { id:'otros', name:'Otros', emoji:'✨' },
    ],
    items: [
      { cat:'sol',  name:'Bloqueador',        emoji:'🧴' },
      { cat:'sol',  name:'Gafas',             emoji:'🕶️' },
      { cat:'ropa', name:'Vestido de baño',   emoji:'👙' },
      { cat:'ropa', name:'Toalla',            emoji:'🧻' },
      { cat:'tech', name:'Cargador',          emoji:'🔌' },
    ]
  },

  frio: {
    label: '❄️ Clima frío',
    cats: [
      { id:'ropa',  name:'Ropa',  emoji:'🧥' },
      { id:'salud', name:'Salud', emoji:'🫖' },
      { id:'tech',  name:'Tech',  emoji:'🔌' },
      { id:'otros', name:'Otros', emoji:'✨' },
    ],
    items: [
      { cat:'ropa',  name:'Chaqueta gruesa',     emoji:'🧥' },
      { cat:'ropa',  name:'Guantes',             emoji:'🧤' },
      { cat:'ropa',  name:'Gorro',               emoji:'🧢' },
      { cat:'salud', name:'Humectante / labios', emoji:'💄' },
      { cat:'tech',  name:'Cargador',            emoji:'🔌' },
    ]
  }
};

function presetFor(mode){
  return PRESETS[mode] || PRESETS.salida;
}

function uid(){
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function newPreset(mode){
  const p = presetFor(mode);
  return {
    version: 2,
    mode,
    cats: p.cats.map(x => ({ ...x })),
    items: p.items.map(x => ({
      id: uid(),
      cat: x.cat,
      name: x.name,
      emoji: x.emoji || null,
      done: false
    })),
    __completedOnce: false
  };
}

/* =========================
   DOM
========================= */

const els = {
  desktopBlock: document.getElementById('desktopBlock'),
  app: document.getElementById('app'),

  tabRow: document.getElementById('tabRow'),
  list: document.getElementById('list'),
  toast: document.getElementById('toast'),

  progressFill: document.getElementById('progressFill'),
  progressText: document.getElementById('progressText'),
  progressPct: document.getElementById('progressPct'),

  tripPill: document.getElementById('tripPill'),
  streakChip: document.getElementById('streakChip'),

  btnReset: document.getElementById('btnReset'),
  btnAdd: document.getElementById('btnAdd'),
  btnSettings: document.getElementById('btnSettings'),

  btnSelectAll: document.getElementById('btnSelectAll'),
  btnUncheckAll: document.getElementById('btnUncheckAll'),
  btnShare: document.getElementById('btnShare'),

  settingsOverlay: document.getElementById('settingsOverlay'),
  addOverlay: document.getElementById('addOverlay'),
  btnCloseSettings: document.getElementById('btnCloseSettings'),
  btnCloseAdd: document.getElementById('btnCloseAdd'),

  tripMode: document.getElementById('tripMode'),
  toggleMotion: document.getElementById('toggleMotion'),
  toggleSound: document.getElementById('toggleSound'),
  btnWipe: document.getElementById('btnWipe'),

  newName: document.getElementById('newName'),
  newCat: document.getElementById('newCat'),
  newEmoji: document.getElementById('newEmoji'),
  btnCreate: document.getElementById('btnCreate'),
};

const dom = {
  progressBar: document.querySelector('.progressBar')
};

/* =========================
   Boot
========================= */

boot();

function boot(){
  // Storage
  const storage = createStorage({
    storageKey: STORAGE_KEY,
    settingsKey: SETTINGS_KEY,
    defaultSettings: DEFAULT_SETTINGS,
    newPreset,
    uid
  });

  // Initial load
  const settings = storage.loadSettings();
  const data = storage.loadData(settings);

  // Store
  const store = createStore({
    settings,
    data,
    activeCat: 'all'
  });

  // FX (needs store to exist)
  const fx = createFX({
    toastEl: els.toast,
    getMotion: () => !!store.getState().settings.motion,
    getSound:  () => !!store.getState().settings.sound
  });

  // Debounced persistence
  const { saveSettingsDebounced, saveDataDebounced } = storage.createDebouncedSavers(220);

  store.subscribe((prev, next) => {
    if (prev.settings !== next.settings) saveSettingsDebounced(next.settings);
    if (prev.data !== next.data) saveDataDebounced(next.data);
  });

  // Actions (proper wiring for /src/actions.js signature)
  const actions = createActions({
    getState: store.getState,
    setState: store.setState,
    deps: {
      presetFor,
      newPreset,

      // Persist using debouncers (actions will call these)
      saveSettings: () => saveSettingsDebounced(store.getState().settings),
      saveData: () => saveDataDebounced(store.getState().data),

      // FX plumbing
      toast: fx.toast,
      haptic: fx.haptic,
      tickSound: fx.tickSound,
      confetti: fx.confetti,
      copyText: fx.copyText
    }
  });

  // Theme mode on root
  syncModeTheme(store.getState().settings.tripMode);

  // Render event wiring (tabs + list)
  setupRenderEvents({
    tabRow: els.tabRow,
    list: els.list,
    onTab: (catId) => {
      fx.haptic?.(10);
      store.setState({ activeCat: catId });
      renderOnlyTabsAndList();
      runProgress(); // progress isn't required but feels consistent
    },
    onToggle: (id) => {
      actions.toggleDone(id);
      renderList(store.getState(), els.list);
      runProgress();
    },
    onDelete: (id) => {
      actions.deleteItem(id);
      renderAll();
    }
  });

  // UI module (buttons + modals + settings inputs)
  initUI({
    els,
    store,
    actions,
    fx,
    storage,
    onAfterStateChange: () => {
      renderAll();
    }
  });

  // Gestures (optional)
  initGestures?.({
    listEl: els.list,
    store,
    fx,
    onToggle: (id) => {
      actions.toggleDone(id);
      renderList(store.getState(), els.list);
      runProgress();
    },
    onDelete: (id) => {
      actions.deleteItem(id);
      renderAll();
    }
  });

  // First paint
  renderAll();

  /* =========================
     Render helpers
  ========================= */

  function renderAll(){
    const st = store.getState();

    // Header chips
    const p = presetFor(st.settings.tripMode);
    if (els.tripPill) els.tripPill.textContent = p.label;
    if (els.streakChip) els.streakChip.textContent = `✨ ${st.settings.streak || 0}`;

    // Theme
    syncModeTheme(st.settings.tripMode);

    // Render pieces
    renderTabs(st, els.tabRow);
    renderAddCategories(st, els.newCat);
    renderList(st, els.list);

    runProgress();
  }

  function renderOnlyTabsAndList(){
    const st = store.getState();
    renderTabs(st, els.tabRow);
    renderList(st, els.list);
  }

  function runProgress(){
    const st = store.getState();

    const result = renderProgress(st, {
      progressFill: els.progressFill,
      progressText: els.progressText,
      progressPct: els.progressPct,
      progressBarEl: dom.progressBar
    });

    // Completion logic: streak + confetti + glow ONLY once per full completion
    if (result.completed){
      if (!st.data.__completedOnce){
        store.setState((prev) => ({
          data: { ...prev.data, __completedOnce: true },
          settings: { ...prev.settings, streak: (prev.settings.streak || 0) + 1 }
        }));

        const next = store.getState();
        if (els.streakChip) els.streakChip.textContent = `✨ ${next.settings.streak || 0}`;

        // glow + confetti + toast
        if (dom.progressBar && next.settings.motion){
          dom.progressBar.classList.add('glow');
          setTimeout(() => dom.progressBar.classList.remove('glow'), 900);
        }
        if (next.settings.motion) fx.confetti?.();
        fx.toast?.('Checklist completo. Qué adulto responsable ✨');
      }
    } else {
      // reset flag when it’s not complete anymore
      if (st.data.__completedOnce){
        store.setState((prev) => ({
          data: { ...prev.data, __completedOnce: false }
        }));
      }
    }

    return result;
  }

  function syncModeTheme(mode){
    // Used by theme.css: :root[data-mode="..."]
    document.documentElement.dataset.mode = mode || 'salida';
  }
}
