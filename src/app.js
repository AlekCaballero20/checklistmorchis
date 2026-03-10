/* =============================================================================
  /src/app.js — Maleta · Checklist — App Orchestrator — IMPROVED v8
  - ✅ Boots store + storage
  - ✅ Wires actions + render + UI + gestures + FX
  - ✅ Keeps mode theme (data-mode) synced
  - ✅ Completion logic via actions.onCompletedOnce (mode-aware)
  - ✅ Edit modal plumbing aligned with new HTML
  - ✅ Supports "Lista destino" on Add modal
  - ✅ Supports "Agregar también a otra lista" on Edit modal
  - ✅ Modes manager cleaned: save/rename/create/delete modes
  - ✅ Safer mode switching + persistence flush on unload
  - ✅ Fallbacks for legacy data shapes and missing action handlers
  - ✅ Guards against duplicate bindings / boot duplication
  - ✅ More defensive rendering and modal sync
  - ✅ FIX: boot guard moved below constants to avoid TDZ on STORAGE_KEY
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

const STORAGE_KEY = 'maleta_pwa_v4_data';
const SETTINGS_KEY = 'maleta_pwa_v4_settings';

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
      { id: 'tech',  name: 'Tecnología', emoji: '🔌' },
      { id: 'docs',  name: 'Documentos', emoji: '🪪' },
      { id: 'ropa',  name: 'Ropa',       emoji: '👕' },
      { id: 'hig',   name: 'Higiene',    emoji: '🧼' },
      { id: 'otros', name: 'Otros',      emoji: '✨' }
    ],
    items: [
      { cat: 'tech',  name: 'Cargador del celular', emoji: '🔌' },
      { cat: 'tech',  name: 'Power bank',           emoji: '🔋' },
      { cat: 'tech',  name: 'Audífonos',            emoji: '🎧' },
      { cat: 'docs',  name: 'Cédula / documento',   emoji: '🪪' },
      { cat: 'docs',  name: 'Tarjeta / efectivo',   emoji: '💳' },
      { cat: 'ropa',  name: 'Chaqueta',             emoji: '🧥' },
      { cat: 'hig',   name: 'Desodorante',          emoji: '🧴' },
      { cat: 'hig',   name: 'Cepillo + crema',      emoji: '🪥' },
      { cat: 'otros', name: 'Llaves',               emoji: '🔑' }
    ]
  },

  viaje: {
    label: '✈️ Viaje',
    cats: [
      { id: 'tech',  name: 'Tecnología', emoji: '🔌' },
      { id: 'docs',  name: 'Documentos', emoji: '🧾' },
      { id: 'salud', name: 'Salud',      emoji: '💊' },
      { id: 'ropa',  name: 'Ropa',       emoji: '🧳' },
      { id: 'otros', name: 'Otros',      emoji: '✨' }
    ],
    items: [
      { cat: 'docs',  name: 'Pasaporte / ID',      emoji: '🛂' },
      { cat: 'docs',  name: 'Tiquetes / reservas', emoji: '🎫' },
      { cat: 'tech',  name: 'Cargadores (todos)',  emoji: '🔌' },
      { cat: 'tech',  name: 'Adaptador',           emoji: '🔁' },
      { cat: 'salud', name: 'Medicinas',           emoji: '💊' },
      { cat: 'ropa',  name: 'Medias extra',        emoji: '🧦' }
    ]
  },

  gira: {
    label: '🎭 Gira',
    cats: [
      { id: 'tech',  name: 'Tech',  emoji: '🔌' },
      { id: 'audio', name: 'Audio', emoji: '🎛️' },
      { id: 'ropa',  name: 'Ropa',  emoji: '👕' },
      { id: 'docs',  name: 'Docs',  emoji: '🪪' },
      { id: 'otros', name: 'Otros', emoji: '✨' }
    ],
    items: [
      { cat: 'audio', name: 'Micrófono / adaptadores', emoji: '🎤' },
      { cat: 'audio', name: 'Interfaces / cables',     emoji: '🧵' },
      { cat: 'tech',  name: 'Cargador laptop',         emoji: '💻' },
      { cat: 'tech',  name: 'USB / backup',            emoji: '💾' },
      { cat: 'ropa',  name: 'Outfit / cambio',         emoji: '👕' },
      { cat: 'docs',  name: 'Info del venue',          emoji: '📄' }
    ]
  },

  playa: {
    label: '🏖️ Playa',
    cats: [
      { id: 'ropa',  name: 'Ropa',  emoji: '🩳' },
      { id: 'sol',   name: 'Sol',   emoji: '🧴' },
      { id: 'tech',  name: 'Tech',  emoji: '📱' },
      { id: 'otros', name: 'Otros', emoji: '✨' }
    ],
    items: [
      { cat: 'sol',  name: 'Bloqueador',      emoji: '🧴' },
      { cat: 'sol',  name: 'Gafas',           emoji: '🕶️' },
      { cat: 'ropa', name: 'Vestido de baño', emoji: '👙' },
      { cat: 'ropa', name: 'Toalla',          emoji: '🧻' },
      { cat: 'tech', name: 'Cargador',        emoji: '🔌' }
    ]
  },

  frio: {
    label: '❄️ Clima frío',
    cats: [
      { id: 'ropa',  name: 'Ropa',  emoji: '🧥' },
      { id: 'salud', name: 'Salud', emoji: '🫖' },
      { id: 'tech',  name: 'Tech',  emoji: '🔌' },
      { id: 'otros', name: 'Otros', emoji: '✨' }
    ],
    items: [
      { cat: 'ropa',  name: 'Chaqueta gruesa',     emoji: '🧥' },
      { cat: 'ropa',  name: 'Guantes',             emoji: '🧤' },
      { cat: 'ropa',  name: 'Gorro',               emoji: '🧢' },
      { cat: 'salud', name: 'Humectante / labios', emoji: '💄' },
      { cat: 'tech',  name: 'Cargador',            emoji: '🔌' }
    ]
  }
};

function presetFor(mode) {
  return PRESETS[mode] || null;
}

function uid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

/**
 * newPreset(mode)
 * Se deja en shape simple porque storage.js ya lo normaliza.
 */
function newPreset(mode) {
  const p = presetFor(mode) || {
    label: `🧳 ${prettyModeLabel(mode)}`,
    cats: [
      { id: 'tech',  name: 'Tecnología', emoji: '🔌' },
      { id: 'ropa',  name: 'Ropa',       emoji: '👕' },
      { id: 'otros', name: 'Otros',      emoji: '✨' }
    ],
    items: []
  };

  return {
    version: 3,
    mode,
    cats: p.cats.map(x => ({ ...x })),
    items: p.items.map(x => ({
      id: uid(),
      cat: x.cat,
      name: x.name,
      emoji: x.emoji || null,
      done: false
    })),
    completedOnceByMode: { [mode]: false },
    __completedOnceByMode: { [mode]: false }
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
  progressBar: document.getElementById('progressBar'),

  tripPill: document.getElementById('tripPill'),
  streakChip: document.getElementById('streakChip'),

  btnReset: document.getElementById('btnReset'),
  btnAdd: document.getElementById('btnAdd'),
  btnSettings: document.getElementById('btnSettings'),

  btnSelectAll: document.getElementById('btnSelectAll'),
  btnUncheckAll: document.getElementById('btnUncheckAll'),

  settingsOverlay: document.getElementById('settingsOverlay'),
  addOverlay: document.getElementById('addOverlay'),
  editOverlay: document.getElementById('editOverlay'),
  modesOverlay: document.getElementById('modesOverlay'),

  btnCloseSettings: document.getElementById('btnCloseSettings'),
  btnCloseAdd: document.getElementById('btnCloseAdd'),
  btnCloseEdit: document.getElementById('btnCloseEdit'),
  btnCloseModes: document.getElementById('btnCloseModes'),

  tripMode: document.getElementById('tripMode'),
  toggleMotion: document.getElementById('toggleMotion'),
  toggleSound: document.getElementById('toggleSound'),
  btnWipe: document.getElementById('btnWipe'),

  btnManageModes: document.getElementById('btnManageModes'),
  modeEditorSelect: document.getElementById('modeEditorSelect'),
  newModeName: document.getElementById('newModeName'),
  modeItemsCount: document.getElementById('modeItemsCount'),
  btnCreateMode: document.getElementById('btnCreateMode'),
  btnDeleteMode: document.getElementById('btnDeleteMode'),
  modesList: document.getElementById('modesList'),

  newName: document.getElementById('newName'),
  newCat: document.getElementById('newCat'),
  newEmoji: document.getElementById('newEmoji'),
  newModeTarget: document.getElementById('newModeTarget'),
  btnCreate: document.getElementById('btnCreate'),

  editName: document.getElementById('editName'),
  editCat: document.getElementById('editCat'),
  editEmoji: document.getElementById('editEmoji'),
  dupMode: document.getElementById('dupMode'),
  btnSaveEdit: document.getElementById('btnSaveEdit'),
  btnAddToMode: document.getElementById('btnAddToMode')
};

/* =========================
   SINGLE BOOT GUARD
========================= */

if (!window.__MALETA_APP_BOOTED__) {
  window.__MALETA_APP_BOOTED__ = true;
  boot();
}

/* =========================
   BOOT
========================= */

function boot() {
  const storage = createStorage({
    storageKey: STORAGE_KEY,
    settingsKey: SETTINGS_KEY,
    defaultSettings: DEFAULT_SETTINGS,
    newPreset,
    uid
  });

  const settings = storage.loadSettings();
  const data = storage.loadData(settings);

  const store = createStore({
    settings,
    data,
    activeCat: 'all'
  });

  const fx = createFX({
    toastEl: els.toast,
    getMotion: () => !!store.getState().settings.motion,
    getSound: () => !!store.getState().settings.sound
  });

  const savers = storage.createDebouncedSavers(220);
  const {
    saveSettingsDebounced,
    saveDataDebounced,
    flushAll
  } = savers;

  store.subscribe((prev, next) => {
    if (prev.settings !== next.settings) {
      saveSettingsDebounced(next.settings);
    }
    if (prev.data !== next.data) {
      saveDataDebounced(next.data);
    }
  });

  const actions = createActions({
    getState: store.getState,
    setState: store.setState,
    deps: {
      presetFor,
      newPreset,
      uid,

      saveSettings: () => saveSettingsDebounced(store.getState().settings),
      saveData: () => saveDataDebounced(store.getState().data),

      toast: fx.toast,
      haptic: fx.haptic,
      tickSound: fx.tickSound,
      confetti: fx.confetti,
      copyText: fx.copyText
    }
  });

  ensureDataHydrated();
  ensureValidSelectedMode();
  syncModeTheme(store.getState().settings.tripMode);

  /* =========================
     RENDER SCHEDULER
  ========================= */

  const renderState = {
    scheduled: false,
    flags: {
      all: false,
      header: false,
      tabs: false,
      list: false,
      progress: false,
      selects: false,
      modeSelects: false,
      modeManager: false
    }
  };

  function scheduleRender(part = 'all') {
    if (part === 'all') {
      resetRenderFlags();
      renderState.flags.all = true;
    } else if (part in renderState.flags) {
      renderState.flags[part] = true;
    } else {
      renderState.flags.all = true;
    }

    if (renderState.scheduled) return;
    renderState.scheduled = true;

    requestAnimationFrame(() => {
      renderState.scheduled = false;
      const st = store.getState();

      if (renderState.flags.all) {
        resetRenderFlags();
        renderAll(st);
        return;
      }

      if (renderState.flags.header) {
        renderHeader(st);
        renderState.flags.header = false;
      }

      if (renderState.flags.tabs) {
        renderTabs(st, els.tabRow);
        renderState.flags.tabs = false;
      }

      if (renderState.flags.selects) {
        renderCategorySelects(st);
        renderState.flags.selects = false;
      }

      if (renderState.flags.modeSelects) {
        renderModeSelects(st);
        renderState.flags.modeSelects = false;
      }

      if (renderState.flags.list) {
        renderList(st, els.list);
        renderState.flags.list = false;
      }

      if (renderState.flags.progress) {
        runProgress(st);
        renderState.flags.progress = false;
      }

      if (renderState.flags.modeManager) {
        renderModeManager(st);
        renderState.flags.modeManager = false;
      }
    });
  }

  function resetRenderFlags() {
    for (const k of Object.keys(renderState.flags)) {
      renderState.flags[k] = false;
    }
  }

  /* =========================
     UI INIT
  ========================= */

  const ui = initUI({
    els,
    store,
    actions,
    fx,
    storage,
    onAfterStateChange: () => scheduleRender('all')
  });

  /* =========================
     RENDER EVENTS
  ========================= */

  setupRenderEvents({
    tabRow: els.tabRow,
    list: els.list,

    onTab: (catId) => {
      fx.haptic?.(10);
      store.setState({ activeCat: catId || 'all' });
      scheduleRender('tabs');
      scheduleRender('list');
      scheduleRender('progress');
    },

    onToggle: (id) => {
      actions.toggleDone?.(id);
      scheduleRender('list');
      scheduleRender('progress');
      scheduleRender('header');
      scheduleRender('modeManager');
    },

    onDelete: (id) => {
      actions.deleteItem?.(id);
      ensureActiveCatStillExists();
      scheduleRender('all');
    },

    onEdit: (id) => {
      openEditById(id);
    }
  });

  /* =========================
     GESTURES
  ========================= */

  initGestures?.({
    listEl: els.list,
    store,
    fx,
    onToggle: (id) => {
      actions.toggleDone?.(id);
      scheduleRender('list');
      scheduleRender('progress');
      scheduleRender('header');
      scheduleRender('modeManager');
    },
    onDelete: (id) => {
      actions.deleteItem?.(id);
      ensureActiveCatStillExists();
      scheduleRender('all');
    }
  });

  /* =========================
     EDIT MODAL
  ========================= */

  bindEditModal();
  bindModesManager();
  bindAddEnhancements();

  /* =========================
     MODE SWITCH
  ========================= */

  bindOnce(els.tripMode, 'change', (e) => {
    const mode = String(e.target.value || 'salida');
    changeMode(mode);
  }, 'trip-mode-change');

  /* =========================
     LIFECYCLE / SAFETY
  ========================= */

  bindOnce(window, 'beforeunload', () => {
    try { flushAll?.(); } catch {}
  }, 'beforeunload-flush');

  bindOnce(document, 'visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      try { flushAll?.(); } catch {}
    }
  }, 'visibilitychange-flush');

  /* =========================
     FIRST PAINT
  ========================= */

  renderAll(store.getState());

  /* =========================
     HELPERS
  ========================= */

  function renderAll() {
    ensureDataHydrated();
    ensureValidSelectedMode();

    const fresh = store.getState();

    syncModeTheme(fresh.settings.tripMode);
    syncModeSelect(fresh.settings.tripMode);

    renderHeader(fresh);
    renderModeSelects(fresh);
    renderTabs(fresh, els.tabRow);
    renderCategorySelects(fresh);
    renderList(fresh, els.list);
    runProgress(fresh);
    renderModeManager(fresh);
  }

  function renderHeader(st) {
    const mode = String(st?.settings?.tripMode || 'salida');
    const modesMap = getModesMap(st);
    const label = modesMap?.[mode]?.label || (presetFor(mode)?.label) || `🧳 ${prettyModeLabel(mode)}`;

    if (els.tripPill) {
      els.tripPill.textContent = label;
    }

    if (els.streakChip) {
      els.streakChip.textContent = `✨ ${st?.settings?.streak || 0}`;
    }
  }

  function renderCategorySelects(st = store.getState()) {
    renderAddCategories(st, els.newCat);
    renderAddCategories(st, els.editCat);

    const currentCat = normalizeCatId(els.editCat?.value || 'otros');
    const cats = getCatsForCurrentMode();
    const exists = cats.some(c => normalizeCatId(c?.id || c?.key || '') === currentCat);

    if (els.editCat && !exists && cats.length) {
      els.editCat.value = normalizeCatId(cats[0]?.id || 'otros');
    }
  }

  function renderModeSelects(st = store.getState()) {
    const modes = getModesEntries(st);
    const currentMode = getCurrentMode();
    const editingMode = String(els.modeEditorSelect?.value || currentMode);

    fillModeSelect(els.tripMode, modes, currentMode);
    fillModeSelect(els.newModeTarget, modes, currentMode);
    fillModeSelect(els.dupMode, modes, currentMode);
    fillModeSelect(els.modeEditorSelect, modes, editingMode);

    if (els.modeEditorSelect && !hasMode(editingMode, st)) {
      els.modeEditorSelect.value = currentMode;
    }
  }

  function renderModeManager(st = store.getState()) {
    if (!els.modesList) return;

    const currentEditorMode = String(els.modeEditorSelect?.value || getCurrentMode());
    const modes = getModesEntries(st);
    const currentItems = getItemsForMode(currentEditorMode);

    if (els.newModeName) {
      const selectedMeta = getModeMeta(currentEditorMode, st);
      const labelText = stripLeadingEmoji(selectedMeta?.label || prettyModeLabel(currentEditorMode));
      if (document.activeElement !== els.newModeName) {
        els.newModeName.value = labelText || '';
      }
    }

    if (els.modeItemsCount) {
      els.modeItemsCount.textContent = String(currentItems.length);
    }

    const canDelete = modes.length > 1;
    if (els.btnDeleteMode) {
      els.btnDeleteMode.disabled = !canDelete;
      els.btnDeleteMode.setAttribute('aria-disabled', String(!canDelete));
    }

    els.modesList.innerHTML = modes.map(({ key, label }) => {
      const isActive = key === getCurrentMode();
      const isEditing = key === currentEditorMode;
      const count = getItemsForMode(key).length;

      return `
        <button
          type="button"
          class="modeChip${isActive ? ' isActive' : ''}${isEditing ? ' isEditing' : ''}"
          data-mode-pick="${escapeHtmlAttr(key)}"
          aria-label="Seleccionar lista ${escapeHtmlAttr(label)}"
          title="${escapeHtmlAttr(label)}"
        >
          <span class="modeChipLabel">${escapeHtml(label)}</span>
          <span class="modeChipMeta">${count}</span>
        </button>
      `;
    }).join('');
  }

  function runProgress(st = store.getState()) {
    const result = renderProgress(st, {
      progressFill: els.progressFill,
      progressText: els.progressText,
      progressPct: els.progressPct,
      progressBarEl: els.progressBar
    });

    if (result?.completed) {
      const ok = actions.onCompletedOnce?.();

      if (ok?.ok) {
        const next = store.getState();

        if (els.streakChip) {
          els.streakChip.textContent = `✨ ${next.settings.streak || 0}`;
        }

        if (els.progressBar && next.settings.motion) {
          els.progressBar.classList.add('glow');
          setTimeout(() => els.progressBar?.classList.remove('glow'), 900);
        }
      }
    }

    return result;
  }

  function syncModeTheme(mode) {
    document.documentElement.dataset.mode = mode || 'salida';
  }

  function syncModeSelect(mode) {
    if (els.tripMode && els.tripMode.value !== mode) {
      els.tripMode.value = mode;
    }
  }

  function changeMode(mode) {
    const nextMode = normalizeModeKey(mode || 'salida');
    const st = store.getState();

    if (!hasMode(nextMode, st)) {
      fx.toast?.('Esa lista no existe 🙃');
      fx.haptic?.(14);
      renderModeSelects(st);
      return;
    }

    if (actions.changeMode) {
      actions.changeMode(nextMode);
    } else {
      store.setState({
        settings: {
          ...st.settings,
          tripMode: nextMode
        }
      });
    }

    syncModeTheme(nextMode);
    store.setState({ activeCat: 'all' });

    ensureActiveCatStillExists();
    scheduleRender('all');
    fx.haptic?.(10);
  }

  function getCurrentMode() {
    const st = store.getState();
    return normalizeModeKey(st?.settings?.tripMode || st?.data?.mode || 'salida');
  }

  function getModeMeta(mode, st = store.getState()) {
    const key = normalizeModeKey(mode);
    const modes = getModesMap(st);
    return modes[key] || null;
  }

  function getModesMap(st = store.getState()) {
    const dataModes = st?.data?.modes;
    if (dataModes && typeof dataModes === 'object' && !Array.isArray(dataModes)) {
      return dataModes;
    }

    const fallback = {};
    for (const key of Object.keys(PRESETS)) {
      fallback[key] = { label: PRESETS[key].label };
    }
    return fallback;
  }

  function getModesEntries(st = store.getState()) {
    const modesMap = getModesMap(st);

    return Object.keys(modesMap).map((key) => ({
      key,
      label: String(modesMap[key]?.label || prettyModeLabel(key))
    }));
  }

  function hasMode(mode, st = store.getState()) {
    const key = normalizeModeKey(mode);
    const modes = getModesMap(st);
    return !!modes[key];
  }

  function getItemsForCurrentMode() {
    return getItemsForMode(getCurrentMode());
  }

  function getItemsForMode(mode) {
    const st = store.getState();
    const key = normalizeModeKey(mode);

    if (st?.data?.itemsByMode && typeof st.data.itemsByMode === 'object') {
      const arr = st.data.itemsByMode[key];
      return Array.isArray(arr) ? arr : [];
    }

    if (key === getCurrentMode() && Array.isArray(st?.data?.items)) {
      return st.data.items;
    }

    return [];
  }

  function getCatsForCurrentMode() {
    return getCatsForMode(getCurrentMode());
  }

  function getCatsForMode(mode) {
    const st = store.getState();
    const key = normalizeModeKey(mode);

    if (st?.data?.catsByMode && typeof st.data.catsByMode === 'object') {
      const arr = st.data.catsByMode[key];
      if (Array.isArray(arr)) return arr;
    }

    if (key === getCurrentMode() && Array.isArray(st?.data?.cats)) {
      return st.data.cats;
    }

    return [];
  }

  function normalizeCatId(v) {
    const raw = String(v ?? '').trim().toLowerCase();

    const s = raw
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s_-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^[-_]+|[-_]+$/g, '');

    return s || 'otros';
  }

  function normalizeModeKey(v) {
    const raw = String(v ?? '').trim().toLowerCase();

    const s = raw
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s_-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^[-_]+|[-_]+$/g, '');

    return s || 'salida';
  }

  function prettyModeLabel(mode) {
    const key = normalizeModeKey(mode);
    if (PRESETS[key]?.label) return stripLeadingEmoji(PRESETS[key].label);
    return key
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, (m) => m.toUpperCase());
  }

  function getItemById(id) {
    const wanted = String(id || '');
    if (!wanted) return null;

    const items = getItemsForCurrentMode();
    return items.find(x => x && String(x.id) === wanted) || null;
  }

  function ensureActiveCatStillExists() {
    const st = store.getState();
    const active = String(st?.activeCat || 'all');

    if (active === 'all') return;

    const cats = getCatsForCurrentMode();
    const exists = cats.some((c) => {
      const id = normalizeCatId(c?.id || c?.key || '');
      return id === normalizeCatId(active);
    });

    if (!exists) {
      store.setState({ activeCat: 'all' });
    }
  }

  function ensureDataHydrated() {
    const st = store.getState();
    const nextData = clone(st.data || {});
    let changed = false;

    if (!nextData.modes || typeof nextData.modes !== 'object' || Array.isArray(nextData.modes)) {
      nextData.modes = {};
      changed = true;
    }

    if (!nextData.itemsByMode || typeof nextData.itemsByMode !== 'object' || Array.isArray(nextData.itemsByMode)) {
      nextData.itemsByMode = {};
      changed = true;
    }

    if (!nextData.catsByMode || typeof nextData.catsByMode !== 'object' || Array.isArray(nextData.catsByMode)) {
      nextData.catsByMode = {};
      changed = true;
    }

    if (!nextData.completedOnceByMode || typeof nextData.completedOnceByMode !== 'object' || Array.isArray(nextData.completedOnceByMode)) {
      nextData.completedOnceByMode = {};
      changed = true;
    }

    if (!nextData.__completedOnceByMode || typeof nextData.__completedOnceByMode !== 'object' || Array.isArray(nextData.__completedOnceByMode)) {
      nextData.__completedOnceByMode = { ...(nextData.completedOnceByMode || {}) };
      changed = true;
    }

    const legacyMode = normalizeModeKey(st?.settings?.tripMode || nextData.mode || 'salida');

    if (Array.isArray(nextData.items) || Array.isArray(nextData.cats)) {
      if (!Array.isArray(nextData.itemsByMode[legacyMode])) {
        nextData.itemsByMode[legacyMode] = Array.isArray(nextData.items)
          ? nextData.items.map(cloneItem)
          : [];
        changed = true;
      }

      if (!Array.isArray(nextData.catsByMode[legacyMode])) {
        nextData.catsByMode[legacyMode] = Array.isArray(nextData.cats)
          ? nextData.cats.map(x => ({ ...x }))
          : (newPreset(legacyMode).cats || []).map(x => ({ ...x }));
        changed = true;
      }

      if (!nextData.modes[legacyMode]) {
        nextData.modes[legacyMode] = {
          label: (presetFor(legacyMode)?.label) || `🧳 ${prettyModeLabel(legacyMode)}`
        };
        changed = true;
      }
    }

    const modeKeys = new Set([
      ...Object.keys(nextData.modes || {}),
      ...Object.keys(nextData.itemsByMode || {}),
      ...Object.keys(nextData.catsByMode || {}),
      ...Object.keys(PRESETS)
    ]);

    for (const rawKey of modeKeys) {
      const key = normalizeModeKey(rawKey);
      if (!key) continue;

      if (!nextData.modes[key]) {
        nextData.modes[key] = {
          label: (presetFor(key)?.label) || `🧳 ${prettyModeLabel(key)}`
        };
        changed = true;
      }

      if (!Array.isArray(nextData.catsByMode[key])) {
        nextData.catsByMode[key] = (newPreset(key).cats || []).map(x => ({ ...x }));
        changed = true;
      }

      if (!Array.isArray(nextData.itemsByMode[key])) {
        nextData.itemsByMode[key] = (newPreset(key).items || []).map(cloneItem);
        changed = true;
      }

      if (typeof nextData.completedOnceByMode[key] !== 'boolean') {
        nextData.completedOnceByMode[key] = false;
        changed = true;
      }

      if (typeof nextData.__completedOnceByMode[key] !== 'boolean') {
        nextData.__completedOnceByMode[key] = !!nextData.completedOnceByMode[key];
        changed = true;
      }
    }

    if (changed) {
      store.setState({ data: nextData });
    }
  }

  function ensureValidSelectedMode() {
    const st = store.getState();
    const current = normalizeModeKey(st?.settings?.tripMode || 'salida');

    if (!hasMode(current, st)) {
      const first = getModesEntries(st)[0]?.key || 'salida';
      store.setState({
        settings: {
          ...st.settings,
          tripMode: first
        }
      });
    }
  }

  function applyDataMutator(mutator) {
    const st = store.getState();
    const nextData = clone(st.data || {});
    ensureContainers(nextData);
    mutator(nextData, st);
    store.setState({ data: nextData });
    return nextData;
  }

  function ensureContainers(data) {
    if (!data.modes || typeof data.modes !== 'object' || Array.isArray(data.modes)) data.modes = {};
    if (!data.itemsByMode || typeof data.itemsByMode !== 'object' || Array.isArray(data.itemsByMode)) data.itemsByMode = {};
    if (!data.catsByMode || typeof data.catsByMode !== 'object' || Array.isArray(data.catsByMode)) data.catsByMode = {};
    if (!data.completedOnceByMode || typeof data.completedOnceByMode !== 'object' || Array.isArray(data.completedOnceByMode)) data.completedOnceByMode = {};
    if (!data.__completedOnceByMode || typeof data.__completedOnceByMode !== 'object' || Array.isArray(data.__completedOnceByMode)) {
      data.__completedOnceByMode = { ...(data.completedOnceByMode || {}) };
    }
  }

  function ensureModeInitialized(data, mode, options = {}) {
    ensureContainers(data);

    const key = normalizeModeKey(mode);
    const templateMode = normalizeModeKey(options.templateMode || key);
    const templateItems = Array.isArray(data.itemsByMode[templateMode]) ? data.itemsByMode[templateMode] : null;
    const templateCats = Array.isArray(data.catsByMode[templateMode]) ? data.catsByMode[templateMode] : null;

    if (!data.modes[key]) {
      const baseLabel = options.label || data.modes[templateMode]?.label || (presetFor(key)?.label) || `🧳 ${prettyModeLabel(key)}`;
      data.modes[key] = { label: String(baseLabel) };
    }

    if (!Array.isArray(data.catsByMode[key])) {
      if (templateCats && templateMode !== key) {
        data.catsByMode[key] = templateCats.map(x => ({ ...x }));
      } else {
        data.catsByMode[key] = (newPreset(key).cats || []).map(x => ({ ...x }));
      }
    }

    if (!Array.isArray(data.itemsByMode[key])) {
      if (templateItems && templateMode !== key) {
        data.itemsByMode[key] = templateItems.map(x => ({
          ...cloneItem(x),
          id: uid(),
          done: false
        }));
      } else {
        data.itemsByMode[key] = [];
      }
    }

    if (typeof data.completedOnceByMode[key] !== 'boolean') {
      data.completedOnceByMode[key] = false;
    }

    if (typeof data.__completedOnceByMode[key] !== 'boolean') {
      data.__completedOnceByMode[key] = !!data.completedOnceByMode[key];
    }

    return key;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function cloneItem(item) {
    return {
      id: String(item?.id || uid()),
      cat: normalizeCatId(item?.cat || 'otros'),
      name: String(item?.name || '').trim(),
      emoji: item?.emoji ? String(item.emoji) : null,
      done: !!item?.done
    };
  }

  function stripLeadingEmoji(text = '') {
    return String(text)
      .replace(/^[^\p{L}\p{N}]+/u, '')
      .trim();
  }

  function escapeHtml(text = '') {
    return String(text)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function escapeHtmlAttr(text = '') {
    return escapeHtml(text);
  }

  function fillModeSelect(selectEl, modes, selected = '') {
    if (!selectEl) return;

    const currentValue = String(selected || '');
    const html = modes.map(({ key, label }) => {
      const isSelected = key === currentValue ? ' selected' : '';
      return `<option value="${escapeHtmlAttr(key)}"${isSelected}>${escapeHtml(label)}</option>`;
    }).join('');

    if (selectEl.innerHTML !== html) {
      selectEl.innerHTML = html;
    }
    if (currentValue && selectEl.value !== currentValue) {
      selectEl.value = currentValue;
    }
  }

  function bindOnce(target, eventName, handler, bindingKey = '') {
    if (!target || !eventName || typeof handler !== 'function') return;
    const key = `__bound_${eventName}_${bindingKey || 'default'}`;
    if (target[key]) return;
    target[key] = true;
    target.addEventListener(eventName, handler);
  }

  /* =========================
     ADD MODAL SUPPORT
  ========================= */

  function bindAddEnhancements() {
    const syncAddTarget = () => {
      const current = getCurrentMode();
      if (els.newModeTarget) {
        renderModeSelects(store.getState());
        els.newModeTarget.value = current;
      }
    };

    bindOnce(els.btnAdd, 'click', syncAddTarget, 'btn-add-sync-target');

    bindOnce(els.addOverlay, 'click', (e) => {
      if (e.target === els.addOverlay) {
        syncAddTarget();
      }
    }, 'overlay-sync-target');

    bindOnce(els.btnCreate, 'click', () => {
      if (!els.newModeTarget) return;
      const targetMode = normalizeModeKey(els.newModeTarget.value || getCurrentMode());
      if (els.newModeTarget.value !== targetMode) {
        els.newModeTarget.value = targetMode;
      }
    }, 'btn-create-normalize-target');
  }

  /* =========================
     EDIT MODAL
  ========================= */

  function openEditById(id) {
    const it = getItemById(id);
    if (!it || !els.editOverlay) return;

    renderCategorySelects(store.getState());
    renderModeSelects(store.getState());

    els.editOverlay.dataset.editingId = String(it.id || '');

    if (els.editName) els.editName.value = it.name || '';
    if (els.editEmoji) els.editEmoji.value = it.emoji || '';
    if (els.editCat) els.editCat.value = it.cat || 'otros';
    if (els.dupMode) els.dupMode.value = getCurrentMode();

    if (ui?.openEdit) {
      ui.openEdit({ returnFocusEl: document.activeElement });
    } else {
      els.editOverlay.classList.add('show');
      els.editOverlay.setAttribute('aria-hidden', 'false');
      setTimeout(() => els.editName?.focus(), 60);
    }

    fx.haptic?.(8);
  }

  function closeEdit() {
    if (!els.editOverlay) return;

    if (ui?.closeEdit) {
      ui.closeEdit();
    } else {
      els.editOverlay.classList.remove('show');
      els.editOverlay.setAttribute('aria-hidden', 'true');
    }

    els.editOverlay.dataset.editingId = '';
  }

  function bindEditModal() {
    bindOnce(els.btnCloseEdit, 'click', () => closeEdit(), 'close-edit-btn');

    bindOnce(els.editOverlay, 'click', (e) => {
      if (e.target === els.editOverlay) closeEdit();
    }, 'edit-overlay-close');

    bindOnce(window, 'keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (els.editOverlay?.classList.contains('show')) closeEdit();
      if (els.modesOverlay?.classList.contains('show')) closeModesManager();
    }, 'escape-overlays');

    bindOnce(els.btnSaveEdit, 'click', () => {
      const id = String(els.editOverlay?.dataset?.editingId || '');
      if (!id) return;

      const payload = {
        name: (els.editName?.value || '').trim(),
        emoji: (els.editEmoji?.value || '').trim(),
        cat: String(els.editCat?.value || 'otros')
      };

      const res = actions.editItem?.(id, payload);

      if (res?.ok) {
        ensureActiveCatStillExists();
        closeEdit();
        scheduleRender('all');
      } else {
        fx.toast?.('No se pudo guardar. Revisa el nombre 🙃');
        fx.haptic?.(14);
      }
    }, 'save-edit');

    bindOnce(els.btnAddToMode, 'click', () => {
      const id = String(els.editOverlay?.dataset?.editingId || '');
      const targetMode = normalizeModeKey(els.dupMode?.value || '');

      if (!id || !targetMode) {
        fx.toast?.('Falta escoger una lista 🙃');
        fx.haptic?.(14);
        return;
      }

      if (targetMode === getCurrentMode()) {
        fx.toast?.('Ese item ya está en esta lista 😌');
        fx.haptic?.(8);
        return;
      }

      let res = null;

      if (typeof actions.assignItemToModes === 'function') {
        res = actions.assignItemToModes(id, [targetMode]);
      } else {
        res = fallbackAddItemToMode(id, targetMode);
      }

      if (res?.ok) {
        fx.toast?.('Agregado a la otra lista ✅');
        fx.haptic?.(10);
        scheduleRender('all');
      } else if (res?.reason === 'ALREADY_EXISTS') {
        fx.toast?.('Ese item ya existe en esa lista 😌');
        fx.haptic?.(8);
      } else {
        fx.toast?.('No se pudo agregar a esa lista 🙃');
        fx.haptic?.(14);
      }
    }, 'add-to-mode');

    bindOnce(els.editName, 'keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        els.btnSaveEdit?.click();
      }
    }, 'edit-name-enter');
  }

  function fallbackAddItemToMode(id, targetMode) {
    const source = getItemById(id);
    if (!source) return { ok: false, reason: 'NOT_FOUND' };

    let created = false;

    applyDataMutator((data) => {
      const currentMode = getCurrentMode();
      ensureModeInitialized(data, currentMode);
      ensureModeInitialized(data, targetMode, { templateMode: currentMode });

      const targetItems = data.itemsByMode[targetMode];
      const exists = targetItems.some((it) =>
        normalizeCatId(it?.cat) === normalizeCatId(source.cat) &&
        String(it?.name || '').trim().toLowerCase() === String(source.name || '').trim().toLowerCase()
      );

      if (exists) return;

      targetItems.unshift({
        id: uid(),
        cat: normalizeCatId(source.cat || 'otros'),
        name: String(source.name || '').trim(),
        emoji: source.emoji || null,
        done: false
      });

      created = true;
    });

    return created ? { ok: true } : { ok: false, reason: 'ALREADY_EXISTS' };
  }

  /* =========================
     MODES MANAGER
  ========================= */

  function openModesManager() {
    renderModeSelects(store.getState());

    if (els.modeEditorSelect) {
      els.modeEditorSelect.value = getCurrentMode();
    }

    renderModeManager(store.getState());

    if (ui?.closeSettings) {
      try { ui.closeSettings(); } catch {}
    } else if (els.settingsOverlay?.classList.contains('show')) {
      els.settingsOverlay.classList.remove('show');
      els.settingsOverlay.setAttribute('aria-hidden', 'true');
    }

    if (els.modesOverlay) {
      els.modesOverlay.classList.add('show');
      els.modesOverlay.setAttribute('aria-hidden', 'false');
      setTimeout(() => els.newModeName?.focus(), 60);
    }

    scheduleRender('modeManager');
    fx.haptic?.(8);
  }

  function closeModesManager() {
    if (!els.modesOverlay) return;
    els.modesOverlay.classList.remove('show');
    els.modesOverlay.setAttribute('aria-hidden', 'true');
  }

  function bindModesManager() {
    bindOnce(els.btnManageModes, 'click', () => openModesManager(), 'open-modes-manager');
    bindOnce(els.btnCloseModes, 'click', () => closeModesManager(), 'close-modes-manager');

    bindOnce(els.modesOverlay, 'click', (e) => {
      if (e.target === els.modesOverlay) {
        closeModesManager();
        return;
      }

      const pickBtn = e.target?.closest?.('[data-mode-pick]');
      if (pickBtn) {
        const key = normalizeModeKey(pickBtn.getAttribute('data-mode-pick') || '');
        if (!key) return;
        if (els.modeEditorSelect) els.modeEditorSelect.value = key;
        scheduleRender('modeManager');
      }
    }, 'modes-overlay-click');

    bindOnce(els.modeEditorSelect, 'change', () => {
      scheduleRender('modeManager');
    }, 'mode-editor-select-change');

    bindOnce(els.newModeName, 'keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        els.btnCreateMode?.click();
      }
    }, 'new-mode-name-enter');

    bindOnce(els.btnCreateMode, 'click', () => {
      const baseMode = normalizeModeKey(els.modeEditorSelect?.value || getCurrentMode());
      const typedLabelRaw = String(els.newModeName?.value || '').trim();

      if (!typedLabelRaw) {
        fx.toast?.('Ponle nombre a la lista 🙃');
        fx.haptic?.(14);
        els.newModeName?.focus();
        return;
      }

      const nextKey = normalizeModeKey(typedLabelRaw);
      const selectedMeta = getModeMeta(baseMode);
      const selectedLabelText = stripLeadingEmoji(selectedMeta?.label || prettyModeLabel(baseMode));
      const isRename = nextKey === baseMode || typedLabelRaw.toLowerCase() === selectedLabelText.toLowerCase();

      if (isRename) {
        applyDataMutator((data) => {
          ensureModeInitialized(data, baseMode, { label: `🧳 ${typedLabelRaw}` });
          data.modes[baseMode].label = `🧳 ${typedLabelRaw}`;
        });

        fx.toast?.('Lista guardada ✅');
        fx.haptic?.(10);

        if (getCurrentMode() === baseMode) {
          scheduleRender('header');
        }

        scheduleRender('modeSelects');
        scheduleRender('modeManager');
        return;
      }

      const st = store.getState();

      if (hasMode(nextKey, st)) {
        applyDataMutator((data) => {
          ensureModeInitialized(data, nextKey);
          data.modes[nextKey].label = `🧳 ${typedLabelRaw}`;
        });

        if (els.modeEditorSelect) els.modeEditorSelect.value = nextKey;

        fx.toast?.('Lista actualizada ✅');
        fx.haptic?.(10);
        scheduleRender('all');
        return;
      }

      applyDataMutator((data) => {
        ensureModeInitialized(data, nextKey, {
          templateMode: baseMode,
          label: `🧳 ${typedLabelRaw}`
        });

        data.modes[nextKey].label = `🧳 ${typedLabelRaw}`;

        const sourceItems = Array.isArray(data.itemsByMode[baseMode]) ? data.itemsByMode[baseMode] : [];
        if (!Array.isArray(data.itemsByMode[nextKey]) || data.itemsByMode[nextKey].length === 0) {
          data.itemsByMode[nextKey] = sourceItems.map((it) => ({
            ...cloneItem(it),
            id: uid(),
            done: false
          }));
        }

        const sourceCats = Array.isArray(data.catsByMode[baseMode]) ? data.catsByMode[baseMode] : [];
        if (!Array.isArray(data.catsByMode[nextKey]) || data.catsByMode[nextKey].length === 0) {
          data.catsByMode[nextKey] = sourceCats.map((cat) => ({ ...cat }));
        }

        data.completedOnceByMode[nextKey] = false;
        data.__completedOnceByMode[nextKey] = false;
      });

      if (els.modeEditorSelect) els.modeEditorSelect.value = nextKey;

      fx.toast?.('Lista creada ✅');
      fx.haptic?.(10);
      scheduleRender('all');
    }, 'create-mode');

    bindOnce(els.btnDeleteMode, 'click', () => {
      const key = normalizeModeKey(els.modeEditorSelect?.value || getCurrentMode());
      const modes = getModesEntries(store.getState());

      if (modes.length <= 1) {
        fx.toast?.('Tiene que quedar al menos una lista 😌');
        fx.haptic?.(14);
        return;
      }

      const fallbackKey = modes.find((m) => m.key !== key)?.key || 'salida';

      applyDataMutator((data) => {
        delete data.modes[key];
        delete data.itemsByMode[key];
        delete data.catsByMode[key];
        delete data.completedOnceByMode[key];
        delete data.__completedOnceByMode[key];
      });

      const st = store.getState();
      const current = getCurrentMode();

      if (current === key) {
        if (actions.changeMode) {
          actions.changeMode(fallbackKey);
        } else {
          store.setState({
            settings: {
              ...st.settings,
              tripMode: fallbackKey
            }
          });
        }
      }

      if (els.modeEditorSelect) els.modeEditorSelect.value = fallbackKey;

      fx.toast?.('Lista eliminada 🗑️');
      fx.haptic?.(10);
      scheduleRender('all');
    }, 'delete-mode');
  }
}