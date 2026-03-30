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

/* ============================================================================
  CONFIG
============================================================================ */

const STORAGE_KEY = 'checklist_lists_data';
const SETTINGS_KEY = 'checklist_lists_settings';

const DEFAULT_SETTINGS = {
  motion: true,
  sound: true,
  streak: 0
};

function uid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

/* ============================================================================
  DOM
============================================================================ */

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

  toggleMotion: document.getElementById('toggleMotion'),
  toggleSound: document.getElementById('toggleSound'),
  btnWipe: document.getElementById('btnWipe'),

  btnManageModes: document.getElementById('btnManageModes'),

  tripMode: document.getElementById('tripMode'),

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

/* ============================================================================
  SINGLE BOOT GUARD
============================================================================ */

if (!window.__CHECKLIST_APP_BOOTED__) {
  window.__CHECKLIST_APP_BOOTED__ = true;
  boot();
}

/* ============================================================================
  BOOT
============================================================================ */

function boot() {
  const storage = createStorage({
    storageKey: STORAGE_KEY,
    settingsKey: SETTINGS_KEY,
    defaultSettings: DEFAULT_SETTINGS,
    uid
  });

  const initialState = storage.loadState();

  const store = createStore({
    ...initialState,
    activeCat: ensureString(initialState?.activeCat || 'all', 60) || 'all'
  });

  const fx = createFX({
    toastEl: els.toast,
    getMotion: () => !!store.getState().settings?.motion,
    getSound: () => !!store.getState().settings?.sound
  });

  const {
    saveStateDebounced,
    saveSettingsDebounced,
    flushAll
  } = storage.createDebouncedSavers(180);

  store.subscribe((prev, next) => {
    if (!next) return;

    if (prev !== next) {
      saveStateDebounced(extractPersistentState(next));
    }

    if (prev?.settings !== next?.settings) {
      saveSettingsDebounced(next.settings || DEFAULT_SETTINGS);
    }
  });

  const actions = createActions({
    getState: store.getState,
    setState: store.setState,
    deps: {
      uid,
      saveState: (state) => {
        saveStateDebounced(extractPersistentState(state || store.getState()));
      },
      saveSettings: (settings) => {
        saveSettingsDebounced(settings || store.getState().settings || DEFAULT_SETTINGS);
      },
      toast: fx.toast,
      haptic: fx.haptic,
      tickSound: fx.tickSound,
      confetti: () => {}
    }
  });

  const ui = initUI({
    els,
    store,
    actions,
    fx,
    storage,
    onAfterStateChange: () => scheduleRender()
  });

  let renderScheduled = false;

  function scheduleRender() {
    if (renderScheduled) return;
    renderScheduled = true;

    requestAnimationFrame(() => {
      renderScheduled = false;
      normalizeAppState();
      renderApp();
    });
  }

  function normalizeAppState() {
    ensureHydratedState();
    ensureValidActiveList();
    ensureActiveCatStillExists();
  }

  function renderApp() {
    const st = store.getState();

    syncListTheme(getCurrentListId(st));
    syncPrimaryListSelect(getCurrentListId(st));

    renderHeader(st);
    renderListSelects(st);
    renderTabs(st, els.tabRow);
    renderCategorySelects(st);
    renderList(st, els.list);
    renderProgressSection(st);
    renderListManager(st);
  }

  normalizeAppState();

  setupRenderEvents({
    tabRow: els.tabRow,
    list: els.list,

    onTab: (catId) => {
      store.setState({
        ...store.getState(),
        activeCat: normalizeCatId(catId || 'all')
      });

      fx.haptic?.(8);
      scheduleRender();
    },

    onToggle: (id) => {
      const result = actions.toggleDone?.(id);

      if (!result?.ok) {
        fx.toast?.('No se pudo marcar ese ítem 🙃');
        fx.haptic?.(14);
        return;
      }

      scheduleRender();
    },

    onDelete: (id) => {
      const result = actions.deleteItem?.(id);

      if (!result?.ok) {
        fx.toast?.('No se pudo eliminar ese ítem 🙃');
        fx.haptic?.(14);
        return;
      }

      ensureActiveCatStillExists();
      scheduleRender();
    },

    onEdit: (id) => {
      openEditById(id);
    }
  });

  bindPrimaryControls();
  bindEditModal();
  bindAddEnhancements();
  bindLightListManagerSync();

  bindOnce(window, 'beforeunload', () => {
    try {
      flushAll?.();
    } catch {}
  }, 'beforeunload-flush');

  bindOnce(document, 'visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      try {
        flushAll?.();
      } catch {}
    }
  }, 'visibilitychange-flush');

  renderApp();

  /* ==========================================================================
    RENDER HELPERS
  ========================================================================== */

  function renderHeader(st) {
    const currentList = getCurrentList(st);
    const currentName = currentList?.name || 'Mi lista';
    const currentIcon = currentList?.icon || '🧾';
    const streak = Number(st?.settings?.streak || 0);

    if (els.tripPill) {
      els.tripPill.textContent = `${currentIcon} ${currentName}`;
    }

    if (els.streakChip) {
      els.streakChip.textContent = `✨ Racha: ${streak}`;
      els.streakChip.setAttribute('aria-label', `Racha actual: ${streak}`);
      els.streakChip.title = `Racha actual: ${streak}`;
    }

    syncNativeToggleInput(els.toggleMotion, !!st?.settings?.motion);
    syncNativeToggleInput(els.toggleSound, !!st?.settings?.sound);
  }

  function renderCategorySelects(st = store.getState()) {
    renderAddCategories(st, els.newCat);
    renderAddCategories(st, els.editCat);

    if (!els.editCat) return;

    const currentCat = normalizeCatId(els.editCat.value || 'general');
    const categories = getCategoriesForCurrentList(st);

    const exists = categories.some((cat) => {
      const id = normalizeCatId(cat?.id || cat?.key || cat);
      return id === currentCat;
    });

    if (!exists && categories.length) {
      const first = categories[0];
      els.editCat.value = normalizeCatId(first?.id || first?.key || first || 'general');
    }
  }

  function renderListSelects(st = store.getState()) {
    const lists = getListEntries(st);
    const currentListId = getCurrentListId(st);
    const editorListId = ensureString(els.modeEditorSelect?.value, 120) || currentListId;

    fillListSelect(els.tripMode, lists, currentListId);
    fillListSelect(els.newModeTarget, lists, currentListId);
    fillListSelect(els.dupMode, lists, currentListId);
    fillListSelect(
      els.modeEditorSelect,
      lists,
      hasList(editorListId, st) ? editorListId : currentListId
    );
  }

  function renderListManager(st = store.getState()) {
    if (!els.modesList) return;

    const currentEditorListId =
      ensureString(els.modeEditorSelect?.value, 120) || getCurrentListId(st);

    const lists = getListEntries(st);
    const currentItems = getItemsForList(currentEditorListId, st);

    if (els.newModeName) {
      const selectedList = getListById(currentEditorListId, st);
      if (document.activeElement !== els.newModeName) {
        els.newModeName.value = selectedList?.name || '';
      }
    }

    if (els.modeItemsCount) {
      els.modeItemsCount.textContent = String(currentItems.length);
    }

    if (els.btnDeleteMode) {
      const canDelete = lists.length > 1;
      els.btnDeleteMode.disabled = !canDelete;
      els.btnDeleteMode.setAttribute('aria-disabled', String(!canDelete));
    }

    const html = lists.map(({ key, label, icon }) => {
      const isActive = key === getCurrentListId(st);
      const isEditing = key === currentEditorListId;
      const count = getItemsForList(key, st).length;

      return `
        <button
          type="button"
          class="modeChip${isActive ? ' isActive' : ''}${isEditing ? ' isEditing' : ''}"
          data-list-pick="${escapeHtmlAttr(key)}"
          aria-label="Seleccionar lista ${escapeHtmlAttr(label)}"
          title="${escapeHtmlAttr(label)}"
        >
          <span class="modeChipLabel">${escapeHtml(`${icon} ${label}`)}</span>
          <span class="modeChipMeta">${count}</span>
        </button>
      `;
    }).join('');

    if (els.modesList.innerHTML !== html) {
      els.modesList.innerHTML = html;
    }
  }

  function renderProgressSection(st = store.getState()) {
    renderProgress(st, {
      progressFill: els.progressFill,
      progressText: els.progressText,
      progressPct: els.progressPct,
      progressBarEl: els.progressBar
    });
  }

  /* ==========================================================================
    STATE HELPERS
  ========================================================================== */

  function extractPersistentState(state) {
    const source = state || store.getState();

    return {
      version: source.version || 1,
      savedAt: nowIso(),
      currentListId: source.currentListId || null,
      settings: {
        motion: !!source.settings?.motion,
        sound: !!source.settings?.sound,
        streak: Number.isFinite(Number(source.settings?.streak))
          ? Number(source.settings.streak)
          : 0
      },
      lists: Array.isArray(source.lists)
        ? source.lists.map((list) => ({ ...list }))
        : [],
      itemsByListId: clone(source.itemsByListId || {})
    };
  }

  function ensureHydratedState() {
    const st = store.getState();
    const next = extractPersistentState(st);

    let changed = false;

    if (!Array.isArray(next.lists)) {
      next.lists = [];
      changed = true;
    }

    if (
      !next.itemsByListId ||
      typeof next.itemsByListId !== 'object' ||
      Array.isArray(next.itemsByListId)
    ) {
      next.itemsByListId = {};
      changed = true;
    }

    if (
      !next.settings ||
      typeof next.settings !== 'object' ||
      Array.isArray(next.settings)
    ) {
      next.settings = { ...DEFAULT_SETTINGS };
      changed = true;
    }

    if (!next.lists.length) {
      const created = actions._util?.createListRecord
        ? actions._util.createListRecord({ name: 'Mi lista', icon: '🧾' })
        : {
            id: uid(),
            name: 'Mi lista',
            icon: '🧾',
            createdAt: nowIso(),
            updatedAt: nowIso()
          };

      next.lists = [created];
      next.currentListId = created.id;
      next.itemsByListId[created.id] = [];
      changed = true;
    }

    const seenListIds = new Set();
    const sanitizedLists = [];

    for (const rawList of next.lists) {
      const list = actions._util?.createListRecord
        ? actions._util.createListRecord(rawList)
        : {
            id: ensureString(rawList?.id, 120) || uid(),
            name: ensureString(rawList?.name, 80) || 'Mi lista',
            icon: ensureString(rawList?.icon, 16) || '🧾',
            createdAt: ensureString(rawList?.createdAt, 40) || nowIso(),
            updatedAt: ensureString(rawList?.updatedAt, 40) || nowIso()
          };

      if (!list.id || seenListIds.has(list.id)) {
        changed = true;
        continue;
      }

      seenListIds.add(list.id);
      sanitizedLists.push(list);

      if (!Array.isArray(next.itemsByListId[list.id])) {
        next.itemsByListId[list.id] = [];
        changed = true;
      }
    }

    if (!sanitizedLists.length) {
      const created = actions._util?.createListRecord
        ? actions._util.createListRecord({ name: 'Mi lista', icon: '🧾' })
        : {
            id: uid(),
            name: 'Mi lista',
            icon: '🧾',
            createdAt: nowIso(),
            updatedAt: nowIso()
          };

      sanitizedLists.push(created);
      next.itemsByListId[created.id] = [];
      next.currentListId = created.id;
      changed = true;
    }

    next.lists = sanitizedLists;

    const validIds = new Set(next.lists.map((list) => list.id));
    for (const key of Object.keys(next.itemsByListId)) {
      if (!validIds.has(key)) {
        delete next.itemsByListId[key];
        changed = true;
      }
    }

    if (
      !next.currentListId ||
      !next.lists.some((list) => list.id === next.currentListId)
    ) {
      next.currentListId = next.lists[0]?.id || null;
      changed = true;
    }

    if (changed) {
      store.setState({
        ...store.getState(),
        ...next
      });
    }
  }

  function ensureValidActiveList() {
    const st = store.getState();
    const current = getCurrentListId(st);

    if (current && hasList(current, st)) return;

    const first = getListEntries(st)[0]?.key || null;

    if (first) {
      store.setState({
        ...st,
        currentListId: first
      });
    }
  }

  function getCurrentList(state = store.getState()) {
    return getListById(state?.currentListId, state);
  }

  function getCurrentListId(state = store.getState()) {
    return ensureString(state?.currentListId, 120) || null;
  }

  function getListById(listId, state = store.getState()) {
    const cleanId = ensureString(listId, 120);
    return (Array.isArray(state?.lists) ? state.lists : []).find((list) => list.id === cleanId) || null;
  }

  function getListEntries(state = store.getState()) {
    const lists = Array.isArray(state?.lists) ? state.lists : [];

    return lists.map((list) => ({
      key: list.id,
      label: list.name || 'Lista',
      icon: list.icon || '🧾'
    }));
  }

  function hasList(listId, state = store.getState()) {
    return !!getListById(listId, state);
  }

  function getItemsForCurrentList(state = store.getState()) {
    return getItemsForList(getCurrentListId(state), state);
  }

  function getItemsForList(listId, state = store.getState()) {
    const cleanId = ensureString(listId, 120);
    const map =
      state?.itemsByListId && typeof state.itemsByListId === 'object'
        ? state.itemsByListId
        : {};

    return Array.isArray(map[cleanId]) ? map[cleanId] : [];
  }

  function getCategoriesForCurrentList(state = store.getState()) {
    const items = getItemsForCurrentList(state);
    const bucket = new Map();

    for (const item of items) {
      const key = normalizeCatId(item?.category || 'general');

      if (!bucket.has(key)) {
        bucket.set(key, {
          id: key,
          key,
          name: prettifyCategory(key),
          label: prettifyCategory(key)
        });
      }
    }

    if (!bucket.size) {
      bucket.set('general', {
        id: 'general',
        key: 'general',
        name: 'General',
        label: 'General'
      });
    }

    return Array.from(bucket.values());
  }

  function getItemById(id) {
    const wanted = ensureString(id, 120);
    if (!wanted) return null;

    const items = getItemsForCurrentList();
    return items.find((item) => item?.id === wanted) || null;
  }

  function ensureActiveCatStillExists() {
    const st = store.getState();
    const active = ensureString(st?.activeCat || 'all', 60);

    if (active === 'all') return;

    const cats = getCategoriesForCurrentList(st);
    const exists = cats.some((cat) => {
      const id = normalizeCatId(cat?.id || cat?.key || cat);
      return id === normalizeCatId(active);
    });

    if (!exists) {
      store.setState({
        ...store.getState(),
        activeCat: 'all'
      });
    }
  }

  /* ==========================================================================
    PRIMARY CONTROLS
  ========================================================================== */

  function bindPrimaryControls() {
    bindOnce(els.tripMode, 'change', (e) => {
      const listId = ensureString(e.target.value, 120);
      if (!listId) return;
      changeList(listId);
    }, 'primary-list-change');

    bindOnce(els.btnReset, 'click', () => {
      actions.resetChecks?.();
      scheduleRender();
    }, 'btn-reset');

    bindOnce(els.btnSelectAll, 'click', () => {
      actions.setAll?.(true);
      scheduleRender();
    }, 'btn-select-all');

    bindOnce(els.btnUncheckAll, 'click', () => {
      actions.setAll?.(false);
      scheduleRender();
    }, 'btn-uncheck-all');

    bindOnce(els.toggleMotion, 'change', (e) => {
      actions.setMotion?.(!!e.target.checked);
      scheduleRender();
    }, 'toggle-motion');

    bindOnce(els.toggleSound, 'change', (e) => {
      actions.setSound?.(!!e.target.checked);
      scheduleRender();
    }, 'toggle-sound');

    bindOnce(els.btnWipe, 'click', () => {
      actions.wipeAll?.();

      store.setState({
        ...store.getState(),
        activeCat: 'all'
      });

      scheduleRender();
    }, 'wipe-all');
  }

  function changeList(listId) {
    const cleanId = ensureString(listId, 120);
    const st = store.getState();

    if (!hasList(cleanId, st)) {
      fx.toast?.('Esa lista no existe 🙃');
      fx.haptic?.(14);
      renderListSelects(st);
      return;
    }

    const result = actions.selectList?.(cleanId);

    if (!result?.ok) {
      fx.toast?.('No se pudo cambiar de lista 🙃');
      fx.haptic?.(14);
      renderListSelects(st);
      return;
    }

    store.setState({
      ...store.getState(),
      activeCat: 'all'
    });

    syncListTheme(cleanId);
    ensureActiveCatStillExists();
    fx.haptic?.(8);
    scheduleRender();
  }

  function syncListTheme(listId) {
    const list = getListById(listId);
    const key = slugifyListName(list?.name || 'lista');
    document.documentElement.dataset.mode = key || 'lista';
  }

  function syncPrimaryListSelect(listId) {
    if (els.tripMode && els.tripMode.value !== listId) {
      els.tripMode.value = listId;
    }
  }

  function syncNativeToggleInput(inputEl, checked) {
    if (!inputEl) return;

    const nextChecked = !!checked;
    if (inputEl.checked !== nextChecked) {
      inputEl.checked = nextChecked;
    }
  }

  /* ==========================================================================
    ADD MODAL SUPPORT
  ========================================================================== */

  function bindAddEnhancements() {
    const syncAddTarget = () => {
      const current = getCurrentListId();

      if (els.newModeTarget) {
        renderListSelects(store.getState());
        els.newModeTarget.value = current || '';
      }
    };

    bindOnce(els.btnAdd, 'click', syncAddTarget, 'btn-add-sync-target');

    bindOnce(els.addOverlay, 'click', (e) => {
      if (e.target === els.addOverlay) {
        syncAddTarget();
      }
    }, 'add-overlay-sync-target');

    bindOnce(els.btnCreate, 'click', () => {
      if (!els.newModeTarget) return;

      const targetListId =
        ensureString(els.newModeTarget.value, 120) || getCurrentListId();

      if (targetListId) {
        els.newModeTarget.value = targetListId;
      }
    }, 'btn-create-normalize-target');
  }

  /* ==========================================================================
    EDIT MODAL
  ========================================================================== */

  function openEditById(id) {
    const item = getItemById(id);
    if (!item || !els.editOverlay) return;

    renderCategorySelects(store.getState());
    renderListSelects(store.getState());

    els.editOverlay.dataset.editingId = String(item.id || '');

    if (els.editName) els.editName.value = item.text || '';
    if (els.editEmoji) els.editEmoji.value = item.emoji || '';
    if (els.editCat) els.editCat.value = item.category || 'general';
    if (els.dupMode) els.dupMode.value = getCurrentListId() || '';

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
    bindOnce(els.btnCloseEdit, 'click', () => {
      closeEdit();
    }, 'close-edit-btn');

    bindOnce(els.editOverlay, 'click', (e) => {
      if (e.target === els.editOverlay) {
        closeEdit();
      }
    }, 'edit-overlay-close');

    bindOnce(window, 'keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (els.editOverlay?.classList.contains('show')) {
        closeEdit();
      }
    }, 'escape-edit-overlay');

    bindOnce(els.btnSaveEdit, 'click', () => {
      const id = ensureString(els.editOverlay?.dataset?.editingId, 120);
      if (!id) return;

      const payload = {
        text: ensureString(els.editName?.value, 180),
        emoji: ensureString(els.editEmoji?.value, 16),
        category: ensureString(els.editCat?.value, 60)
      };

      const result = actions.editItem?.(id, payload);

      if (!result?.ok) {
        fx.toast?.('No se pudo guardar. Revisa el nombre 🙃');
        fx.haptic?.(14);
        return;
      }

      ensureActiveCatStillExists();
      closeEdit();
      scheduleRender();
    }, 'save-edit');

    bindOnce(els.btnAddToMode, 'click', () => {
      const id = ensureString(els.editOverlay?.dataset?.editingId, 120);
      const targetListId = ensureString(els.dupMode?.value, 120);

      if (!id || !targetListId) {
        fx.toast?.('Falta escoger una lista 🙃');
        fx.haptic?.(14);
        return;
      }

      if (targetListId === getCurrentListId()) {
        fx.toast?.('Ese ítem ya está en esta lista 😌');
        fx.haptic?.(8);
        return;
      }

      const result =
        typeof actions.copyItemToList === 'function'
          ? actions.copyItemToList(id, targetListId)
          : { ok: false };

      if (!result?.ok) {
        fx.toast?.('No se pudo agregar a esa lista 🙃');
        fx.haptic?.(14);
        return;
      }

      fx.toast?.('Agregado a la otra lista ✅');
      fx.haptic?.(10);
      scheduleRender();
    }, 'add-to-other-list');

    bindOnce(els.editName, 'keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        els.btnSaveEdit?.click();
      }
    }, 'edit-name-enter');
  }

  /* ==========================================================================
    LIST MANAGER
  ========================================================================== */

  function bindLightListManagerSync() {
    bindOnce(els.modesOverlay, 'click', (e) => {
      const pickBtn = e.target?.closest?.('[data-list-pick]');
      if (!pickBtn) return;

      const listId = ensureString(pickBtn.getAttribute('data-list-pick'), 120);
      if (!listId) return;

      if (els.modeEditorSelect) {
        els.modeEditorSelect.value = listId;
      }

      scheduleRender();
    }, 'lists-overlay-pick');

    bindOnce(els.modeEditorSelect, 'change', () => {
      scheduleRender();
    }, 'list-editor-select-change-light');
  }
}

/* ============================================================================
  UTILS
============================================================================ */

function bindOnce(target, eventName, handler, bindingKey = '') {
  if (!target || !eventName || typeof handler !== 'function') return;

  const key = `__bound_${eventName}_${bindingKey || 'default'}`;
  if (target[key]) return;

  target[key] = true;
  target.addEventListener(eventName, handler);
}

function nowIso() {
  try {
    return new Date().toISOString();
  } catch {
    return '';
  }
}

function ensureString(value, maxLen = 100) {
  const out = String(value ?? '').trim();
  return maxLen > 0 ? out.slice(0, maxLen) : out;
}

function normalizeCatId(value) {
  const raw = ensureString(value, 60).toLowerCase();

  if (raw === 'all') return 'all';

  const clean = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s_-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '');

  return clean || 'general';
}

function prettifyCategory(value) {
  const clean = normalizeCatId(value).replace(/[-_]+/g, ' ');

  return clean
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || 'General';
}

function slugifyListName(value) {
  const raw = ensureString(value, 80).toLowerCase();

  const clean = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s_-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '');

  return clean || 'lista';
}

function clone(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return {};
  }
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

function fillListSelect(selectEl, lists, selected = '') {
  if (!selectEl) return;

  const currentValue = ensureString(selected, 120);

  const html = (Array.isArray(lists) ? lists : []).map(({ key, label, icon }) => {
    const isSelected = key === currentValue ? ' selected' : '';
    return `<option value="${escapeHtmlAttr(key)}"${isSelected}>${escapeHtml(`${icon || '🧾'} ${label}`)}</option>`;
  }).join('');

  if (selectEl.innerHTML !== html) {
    selectEl.innerHTML = html;
  }

  if (currentValue && selectEl.value !== currentValue) {
    selectEl.value = currentValue;
  }
}