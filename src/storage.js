/* ============================================================================
  /src/storage.js
  Storage local-first para el sistema nuevo de listas

  MODELO NUEVO
  {
    version: 1,
    savedAt: "...",
    currentListId: "list_xxx",
    settings: {
      motion: true,
      sound: true,
      streak: 0
    },
    lists: [
      {
        id: "list_xxx",
        name: "Viaje",
        icon: "🧳",
        createdAt: "...",
        updatedAt: "..."
      }
    ],
    itemsByListId: {
      "list_xxx": [
        {
          id: "item_xxx",
          text: "Cargador",
          checked: false,
          category: "tech",
          emoji: "🔌",
          notes: "",
          createdAt: "...",
          updatedAt: "..."
        }
      ]
    }
  }

  COMPAT
  - Migra desde el sistema viejo basado en:
    - currentMode
    - byMode
    - itemsByMode
    - catsByMode
    - modes
  - También intenta rescatar formatos legacy raros.
============================================================================ */

'use strict';

export function createStorage(cfg = {}) {
  const {
    storageKey = 'checklist_lists_data',
    settingsKey = 'checklist_lists_settings',
    defaultSettings = {
      motion: true,
      sound: true,
      streak: 0
    },
    defaultListName = 'Mi lista',
    uid
  } = cfg;

  const DATA_SCHEMA = 1;
  const SETTINGS_SCHEMA = 1;

  function loadSettings() {
    const base = sanitizeSettings(defaultSettings);

    try {
      const raw = localStorage.getItem(settingsKey);
      if (!raw) return base;

      const parsed = safeParse(raw);
      if (!isPlainObject(parsed)) return base;

      const payload = isPlainObject(parsed.data) ? parsed.data : parsed;
      return sanitizeSettings({ ...base, ...payload });
    } catch {
      return base;
    }
  }

  function saveSettings(settings) {
    const clean = sanitizeSettings(settings);

    try {
      localStorage.setItem(
        settingsKey,
        JSON.stringify({
          version: SETTINGS_SCHEMA,
          savedAt: nowIso(),
          data: clean
        })
      );
    } catch {}
  }

  function loadState() {
    const fallback = createEmptyState();

    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) {
        const fresh = ensureAtLeastOneList(fallback);
        persistState(fresh);
        return fresh;
      }

      const parsed = safeParse(raw);
      const migrated = migrateAnyToCurrent(parsed);
      const repaired = repairState(migrated);

      persistState(repaired);
      return repaired;
    } catch {
      const fresh = ensureAtLeastOneList(fallback);
      persistState(fresh);
      return fresh;
    }
  }

  function saveState(state) {
    const repaired = repairState(state);
    persistState(repaired);
    return repaired;
  }

  function resetState() {
    const fresh = ensureAtLeastOneList(createEmptyState());
    persistState(fresh);
    return fresh;
  }

  function wipeAllStorage() {
    try {
      localStorage.removeItem(storageKey);
    } catch {}

    try {
      localStorage.removeItem(settingsKey);
    } catch {}
  }

  function createDebouncedSavers(wait = 180) {
    const saveStateDebounced = debounce((state) => saveState(state), wait);
    const saveSettingsDebounced = debounce((settings) => saveSettings(settings), wait);

    return {
      saveStateDebounced,
      saveSettingsDebounced,
      flushAll() {
        saveStateDebounced.flush();
        saveSettingsDebounced.flush();
      },
      cancelAll() {
        saveStateDebounced.cancel();
        saveSettingsDebounced.cancel();
      }
    };
  }

  function createEmptyState() {
    return {
      version: DATA_SCHEMA,
      savedAt: nowIso(),
      currentListId: null,
      settings: sanitizeSettings(defaultSettings),
      lists: [],
      itemsByListId: {}
    };
  }

  function createList(name = defaultListName, icon = '🧾') {
    const now = nowIso();
    return {
      id: makeId('list'),
      name: sanitizeListName(name),
      icon: normalizeEmoji(icon) || '🧾',
      createdAt: now,
      updatedAt: now
    };
  }

  function createItem(partial = {}) {
    const now = nowIso();

    return {
      id: makeId('item'),
      text: ensureString(
        partial.text ?? partial.name ?? partial.title ?? '',
        180
      ) || 'Nuevo ítem',
      checked: !!partial.checked,
      category: sanitizeCategory(partial.category ?? partial.cat ?? 'general'),
      emoji: normalizeEmoji(partial.emoji) || null,
      notes: ensureString(partial.notes, 500) || '',
      createdAt: ensureString(partial.createdAt, 40) || now,
      updatedAt: ensureString(partial.updatedAt, 40) || now
    };
  }

  function ensureAtLeastOneList(state) {
    const repaired = repairState(state);

    if (repaired.lists.length > 0) {
      return repaired;
    }

    const firstList = createList(defaultListName, '🧾');

    repaired.lists = [firstList];
    repaired.currentListId = firstList.id;
    repaired.itemsByListId[firstList.id] = [];

    repaired.savedAt = nowIso();
    return repaired;
  }

  function repairState(input) {
    const base = createEmptyState();
    const raw = isPlainObject(input) ? input : {};

    const settings = sanitizeSettings({
      ...defaultSettings,
      ...(isPlainObject(raw.settings) ? raw.settings : {})
    });

    const rawLists = Array.isArray(raw.lists) ? raw.lists : [];
    const repairedLists = [];
    const seenListIds = new Set();

    for (const entry of rawLists) {
      const list = repairList(entry);
      if (!list) continue;
      if (seenListIds.has(list.id)) continue;

      seenListIds.add(list.id);
      repairedLists.push(list);
    }

    const rawItemsByListId = isPlainObject(raw.itemsByListId) ? raw.itemsByListId : {};
    const repairedItemsByListId = {};

    for (const list of repairedLists) {
      const rawItems = Array.isArray(rawItemsByListId[list.id])
        ? rawItemsByListId[list.id]
        : [];

      repairedItemsByListId[list.id] = repairItemsArray(rawItems);
    }

    let currentListId = ensureString(raw.currentListId, 120) || null;
    if (!currentListId || !repairedLists.some((list) => list.id === currentListId)) {
      currentListId = repairedLists[0]?.id || null;
    }

    const out = {
      version: DATA_SCHEMA,
      savedAt: nowIso(),
      currentListId,
      settings,
      lists: repairedLists,
      itemsByListId: repairedItemsByListId
    };

    return ensureAtLeastOneListWithoutLoop(out);
  }

  function ensureAtLeastOneListWithoutLoop(state) {
    if (Array.isArray(state.lists) && state.lists.length > 0) {
      if (!state.currentListId || !state.lists.some((list) => list.id === state.currentListId)) {
        state.currentListId = state.lists[0].id;
      }

      for (const list of state.lists) {
        if (!Array.isArray(state.itemsByListId[list.id])) {
          state.itemsByListId[list.id] = [];
        }
      }

      return state;
    }

    const firstList = createList(defaultListName, '🧾');

    state.lists = [firstList];
    state.currentListId = firstList.id;
    state.itemsByListId = {
      [firstList.id]: []
    };
    state.savedAt = nowIso();

    return state;
  }

  function repairList(entry) {
    if (!isPlainObject(entry)) return null;

    const id = ensureString(entry.id, 120) || makeId('list');
    const name = sanitizeListName(
      entry.name ?? entry.label ?? entry.title ?? defaultListName
    );

    const icon =
      normalizeEmoji(entry.icon) ||
      normalizeEmoji(extractLeadingEmoji(entry.label)) ||
      '🧾';

    const createdAt = ensureString(entry.createdAt, 40) || nowIso();
    const updatedAt = ensureString(entry.updatedAt, 40) || nowIso();

    return {
      id,
      name,
      icon,
      createdAt,
      updatedAt
    };
  }

  function repairItemsArray(items) {
    const source = Array.isArray(items) ? items : [];
    const seen = new Set();
    const out = [];

    for (const raw of source) {
      const item = createItem(raw);
      if (seen.has(item.id)) {
        item.id = makeId('item');
      }
      seen.add(item.id);
      out.push(item);
    }

    return out;
  }

  function persistState(state) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(state));
    } catch {}
  }

  function migrateAnyToCurrent(parsed) {
    if (!isPlainObject(parsed)) {
      return createEmptyState();
    }

    if (looksLikeCurrentState(parsed)) {
      return parsed;
    }

    if (looksLikeOldEnvelope(parsed)) {
      return migrateFromOldEnvelope(parsed);
    }

    if (looksLikeOldSingleMode(parsed)) {
      return migrateFromOldSingleMode(parsed);
    }

    return createEmptyState();
  }

  function looksLikeCurrentState(obj) {
    return (
      isPlainObject(obj) &&
      Array.isArray(obj.lists) &&
      isPlainObject(obj.itemsByListId)
    );
  }

  function looksLikeOldEnvelope(obj) {
    return isPlainObject(obj) && isPlainObject(obj.byMode);
  }

  function looksLikeOldSingleMode(obj) {
    return (
      isPlainObject(obj) &&
      (
        isPlainObject(obj.itemsByMode) ||
        isPlainObject(obj.modes) ||
        Array.isArray(obj.items) ||
        Array.isArray(obj.cats) ||
        typeof obj.mode === 'string'
      )
    );
  }

  function migrateFromOldEnvelope(oldEnv) {
    const next = createEmptyState();
    const byMode = isPlainObject(oldEnv.byMode) ? oldEnv.byMode : {};
    const oldCurrentMode = ensureString(oldEnv.currentMode, 80) || null;

    const modeKeyToListId = {};
    const lists = [];
    const itemsByListId = {};

    for (const [modeKeyRaw, modePayload] of Object.entries(byMode)) {
      const modeKey = sanitizeModeKey(modeKeyRaw);
      const normalized = normalizeOldModePayload(modePayload, modeKey);

      const list = createListFromOldMode(modeKey, normalized);
      modeKeyToListId[modeKey] = list.id;
      lists.push(list);
      itemsByListId[list.id] = normalized.items;
    }

    next.lists = lists;
    next.itemsByListId = itemsByListId;

    if (oldCurrentMode && modeKeyToListId[oldCurrentMode]) {
      next.currentListId = modeKeyToListId[oldCurrentMode];
    } else {
      next.currentListId = lists[0]?.id || null;
    }

    return next;
  }

  function migrateFromOldSingleMode(oldData) {
    const next = createEmptyState();

    if (isPlainObject(oldData.itemsByMode)) {
      const fakeEnvelope = {
        currentMode: oldData.mode || null,
        byMode: {}
      };

      const itemsByMode = isPlainObject(oldData.itemsByMode) ? oldData.itemsByMode : {};
      const modes = isPlainObject(oldData.modes) ? oldData.modes : {};
      const catsByMode = isPlainObject(oldData.catsByMode) ? oldData.catsByMode : {};

      const modeKeys = uniqueStrings([
        ...Object.keys(itemsByMode),
        ...Object.keys(modes),
        ...Object.keys(catsByMode),
        oldData.mode
      ].filter(Boolean));

      for (const key of modeKeys) {
        fakeEnvelope.byMode[key] = {
          mode: key,
          itemsByMode,
          modes,
          catsByMode,
          cats: Array.isArray(oldData.cats) ? oldData.cats : []
        };
      }

      return migrateFromOldEnvelope(fakeEnvelope);
    }

    const modeKey = sanitizeModeKey(oldData.mode || 'lista');
    const normalized = normalizeOldModePayload(oldData, modeKey);
    const list = createListFromOldMode(modeKey, normalized);

    next.lists = [list];
    next.currentListId = list.id;
    next.itemsByListId[list.id] = normalized.items;

    return next;
  }

  function normalizeOldModePayload(payload, fallbackModeKey) {
    const modeKey = sanitizeModeKey(
      payload?.mode ||
      fallbackModeKey ||
      'lista'
    );

    const modeMeta = isPlainObject(payload?.modes?.[modeKey])
      ? payload.modes[modeKey]
      : {};

    const modeName =
      ensureString(modeMeta.name, 80) ||
      stripLeadingEmoji(ensureString(modeMeta.label, 80)) ||
      prettifyModeName(modeKey);

    const modeIcon =
      normalizeEmoji(modeMeta.icon) ||
      normalizeEmoji(extractLeadingEmoji(modeMeta.label)) ||
      guessIconFromMode(modeKey);

    let rawItems = [];

    if (Array.isArray(payload?.itemsByMode?.[modeKey])) {
      rawItems = payload.itemsByMode[modeKey];
    } else if (Array.isArray(payload?.items)) {
      rawItems = payload.items;
    }

    const items = rawItems.map((item) => migrateOldItem(item));

    return {
      modeKey,
      name: modeName,
      icon: modeIcon,
      items
    };
  }

  function createListFromOldMode(modeKey, normalized) {
    const now = nowIso();

    return {
      id: makeId('list'),
      name: sanitizeListName(normalized.name || prettifyModeName(modeKey)),
      icon: normalizeEmoji(normalized.icon) || guessIconFromMode(modeKey),
      createdAt: now,
      updatedAt: now
    };
  }

  function migrateOldItem(oldItem) {
    const text = ensureString(
      oldItem?.text ??
      oldItem?.name ??
      oldItem?.title ??
      '',
      180
    ) || 'Nuevo ítem';

    return {
      id: ensureString(oldItem?.id, 120) || makeId('item'),
      text,
      checked: !!(oldItem?.checked ?? oldItem?.done),
      category: sanitizeCategory(
        oldItem?.category ??
        oldItem?.cat ??
        oldItem?.catId ??
        'general'
      ),
      emoji: normalizeEmoji(oldItem?.emoji) || null,
      notes: ensureString(oldItem?.notes, 500) || '',
      createdAt: ensureString(oldItem?.createdAt, 40) || nowIso(),
      updatedAt: ensureString(oldItem?.updatedAt, 40) || nowIso()
    };
  }

  function sanitizeSettings(settings) {
    const source = isPlainObject(settings) ? settings : {};

    return {
      motion: !!source.motion,
      sound: !!source.sound,
      streak: clampInt(source.streak, 0, 999999)
    };
  }

  function sanitizeListName(value) {
    const clean = ensureString(value, 80);
    return clean || defaultListName;
  }

  function sanitizeCategory(value) {
    const clean = ensureString(value, 60)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s_-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^[-_]+|[-_]+$/g, '');

    return clean || 'general';
  }

  function sanitizeModeKey(value) {
    const clean = ensureString(value, 60)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s_-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^[-_]+|[-_]+$/g, '');

    return clean || 'lista';
  }

  function makeId(prefix = 'id') {
    try {
      if (typeof uid === 'function') {
        const external = String(uid()).trim();
        if (external) return external;
      }
    } catch {}

    return `${prefix}_${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
  }

  return {
    loadSettings,
    saveSettings,
    loadState,
    saveState,
    resetState,
    wipeAllStorage,
    createDebouncedSavers,

    _internals: {
      createEmptyState,
      createList,
      createItem,
      repairState,
      migrateAnyToCurrent,
      migrateFromOldEnvelope,
      migrateFromOldSingleMode,
      normalizeOldModePayload,
      sanitizeSettings,
      sanitizeListName,
      sanitizeCategory
    }
  };
}

/* ============================================================================
  UTILIDADES
============================================================================ */

function safeParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function debounce(fn, wait = 180) {
  let timer = null;
  let lastArgs = null;

  function wrapped(...args) {
    lastArgs = args;

    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const argsToUse = lastArgs;
      lastArgs = null;
      fn(...argsToUse);
    }, wait);
  }

  wrapped.cancel = () => {
    clearTimeout(timer);
    timer = null;
    lastArgs = null;
  };

  wrapped.flush = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;

    if (lastArgs) {
      const argsToUse = lastArgs;
      lastArgs = null;
      fn(...argsToUse);
    }
  };

  return wrapped;
}

function nowIso() {
  try {
    return new Date().toISOString();
  } catch {
    return '';
  }
}

function clampInt(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  const i = Math.floor(n);
  return Math.min(max, Math.max(min, i));
}

function ensureString(value, maxLen = 100) {
  const out = String(value ?? '').trim();
  return maxLen > 0 ? out.slice(0, maxLen) : out;
}

function isPlainObject(value) {
  return (
    value != null &&
    typeof value === 'object' &&
    (value.constructor === Object || Object.getPrototypeOf(value) === Object.prototype)
  );
}

function uniqueStrings(arr) {
  const seen = new Set();
  const out = [];

  for (const value of Array.isArray(arr) ? arr : []) {
    const str = String(value ?? '').trim();
    if (!str || seen.has(str)) continue;
    seen.add(str);
    out.push(str);
  }

  return out;
}

function normalizeEmoji(value) {
  const clean = ensureString(value, 16);
  return clean || null;
}

function stripLeadingEmoji(text = '') {
  return String(text)
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .trim();
}

function extractLeadingEmoji(text = '') {
  const value = String(text ?? '').trim();
  const match = value.match(/^[^\p{L}\p{N}]+/u);
  return match ? match[0].trim() : '';
}

function prettifyModeName(modeKey) {
  const raw = ensureString(modeKey, 80).replace(/[-_]+/g, ' ').trim();
  if (!raw) return 'Lista';

  return raw
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function guessIconFromMode(modeKey) {
  const key = ensureString(modeKey, 80).toLowerCase();

  const map = {
    salida: '🧳',
    viaje: '✈️',
    gira: '🎤',
    playa: '🏖️',
    frio: '🧥',
    camping: '🏕️',
    mercado: '🛒',
    estudio: '🎒',
    trabajo: '💼'
  };

  return map[key] || '🧾';
}