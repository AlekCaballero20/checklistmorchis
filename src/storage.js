/* =============================================================================
  /src/storage.js — Local-first storage + migrations — PRO v5.0
  - ✅ loadSettings / saveSettings (sanitiza + defaults + versionado suave)
  - ✅ loadData / saveData (repair + migraciones + compat)
  - ✅ Soporta formato moderno:
      envelope = {
        version: 4,
        currentMode,
        savedAt,
        byMode: {
          [mode]: {
            version: 3,
            mode,
            cats,
            itemsByMode,
            modes,
            __completedOnceByMode
          }
        }
      }
  - ✅ Soporta formatos legacy:
      v1: { mode, cats, items, __completedOnce }
      v2/v3: variantes con itemsByMode / envelope parcial
      y objetos medio vueltos nada porque humanos
  - ✅ Validate + repair:
      IDs únicos, strings recortados, cats válidas, modes válidos,
      compat de cats con {id,name} y {key,label}
  - ✅ Debounced savers con cancel/flush
============================================================================= */

'use strict';

/**
 * createStorage
 * @param {Object} cfg
 * @param {string} cfg.storageKey
 * @param {string} cfg.settingsKey
 * @param {Object} cfg.defaultSettings
 * @param {Function} cfg.newPreset (mode) => data
 * @param {Function} cfg.uid () => string (optional)
 */
export function createStorage(cfg) {
  const {
    storageKey = 'maleta_pwa_v4_data',
    settingsKey = 'maleta_pwa_v4_settings',
    defaultSettings = {},
    newPreset,
    uid
  } = cfg || {};

  const SETTINGS_SCHEMA = 2;
  const DATA_SCHEMA = 4;

  /* =========================
     SETTINGS
  ========================= */

  function loadSettings() {
    const base = sanitizeSettings({ ...defaultSettings });

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
    try {
      const clean = sanitizeSettings(settings);
      const payload = {
        version: SETTINGS_SCHEMA,
        savedAt: nowIso(),
        data: clean
      };
      localStorage.setItem(settingsKey, JSON.stringify(payload));
    } catch {}
  }

  /* =========================
     DATA
  ========================= */

  /**
   * loadData
   * @param {Object|string} settingsOrMode
   * @returns {Object} normalized data for that mode
   */
  function loadData(settingsOrMode) {
    const mode = resolveMode(settingsOrMode);

    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) {
        const fresh = repairData(newPresetSafe(mode), mode);
        persistModeIntoEnvelope(fresh, mode);
        return fresh;
      }

      const parsed = safeParse(raw);
      const env = migrateToEnvelope(parsed, mode);

      if (!env.byMode[mode]) {
        env.byMode[mode] = repairData(newPresetSafe(mode), mode);
      }

      const repaired = repairData(env.byMode[mode], mode);

      try {
        env.byMode[mode] = repaired;
        env.currentMode = mode;
        env.version = DATA_SCHEMA;
        env.savedAt = nowIso();
        localStorage.setItem(storageKey, JSON.stringify(env));
      } catch {}

      return repaired;
    } catch {
      const fresh = repairData(newPresetSafe(mode), mode);
      try { persistModeIntoEnvelope(fresh, mode); } catch {}
      return fresh;
    }
  }

  /**
   * saveData
   * Accepts:
   *  - data object with .mode
   *  - or { mode, data }
   */
  function saveData(dataOrPack) {
    try {
      const pack = normalizeSavePayload(dataOrPack);
      const mode = resolveMode(pack.mode || pack?.data?.mode);

      const currentRaw = localStorage.getItem(storageKey);
      const currentParsed = currentRaw ? safeParse(currentRaw) : null;
      const env = migrateToEnvelope(currentParsed, mode);

      const cleaned = repairData(pack.data, mode);

      env.byMode[mode] = cleaned;
      env.currentMode = mode;
      env.version = DATA_SCHEMA;
      env.savedAt = nowIso();

      localStorage.setItem(storageKey, JSON.stringify(env));
    } catch {}
  }

  function loadEnvelope(preferredMode) {
    const mode = resolveMode(preferredMode);

    try {
      const raw = localStorage.getItem(storageKey);
      const parsed = raw ? safeParse(raw) : null;
      return migrateToEnvelope(parsed, mode);
    } catch {
      return createFreshEnvelope(mode);
    }
  }

  function saveEnvelope(envelope, preferredMode) {
    try {
      const mode = resolveMode(preferredMode);
      const normalized = migrateToEnvelope(envelope, mode);
      normalized.version = DATA_SCHEMA;
      normalized.currentMode = resolveMode(normalized.currentMode || mode);
      normalized.savedAt = nowIso();
      localStorage.setItem(storageKey, JSON.stringify(normalized));
    } catch {}
  }

  function wipeAllStorage() {
    try { localStorage.removeItem(storageKey); } catch {}
    try { localStorage.removeItem(settingsKey); } catch {}
  }

  /* =========================
     Debounced savers
  ========================= */

  function createDebouncedSavers(wait = 220) {
    const saveSettingsDebounced = debounce((settings) => saveSettings(settings), wait);
    const saveDataDebounced = debounce((data) => saveData(data), wait);
    const saveEnvelopeDebounced = debounce((envelope, preferredMode) => saveEnvelope(envelope, preferredMode), wait);

    function flushAll() {
      saveSettingsDebounced.flush();
      saveDataDebounced.flush();
      saveEnvelopeDebounced.flush();
    }

    function cancelAll() {
      saveSettingsDebounced.cancel();
      saveDataDebounced.cancel();
      saveEnvelopeDebounced.cancel();
    }

    return {
      saveSettingsDebounced,
      saveDataDebounced,
      saveEnvelopeDebounced,
      flushAll,
      cancelAll
    };
  }

  /* =========================
     Internals: sanitize/repair/migrate
  ========================= */

  function sanitizeSettings(s) {
    const base = isPlainObject(defaultSettings) ? { ...defaultSettings } : {};
    const out = { ...base, ...(isPlainObject(s) ? s : {}) };

    out.tripMode = slugifyModeKey(out.tripMode || base.tripMode || 'salida');
    out.motion = !!out.motion;
    out.sound = !!out.sound;
    out.streak = clampInt(out.streak, 0, 999999);

    return out;
  }

  function repairData(d, fallbackMode) {
    const mode = slugifyModeKey(
      d?.mode ||
      fallbackMode ||
      defaultSettings.tripMode ||
      'salida'
    );

    if (!isPlainObject(d)) {
      return repairData(newPresetSafe(mode), mode);
    }

    // Legacy single-list shape: { mode, cats, items, __completedOnce }
    if (!isPlainObject(d.itemsByMode)) {
      const legacyCats = repairCatsArray(Array.isArray(d.cats) ? d.cats : []);
      const legacyItems = repairItemsArray(Array.isArray(d.items) ? d.items : [], legacyCats);

      const normalized = {
        version: 3,
        mode,
        cats: legacyCats,
        itemsByMode: {
          [mode]: legacyItems
        },
        modes: {
          [mode]: repairModeMeta(mode, d?.modes?.[mode] || {
            key: mode,
            name: labelFromMode(mode),
            label: labelFromMode(mode)
          })
        },
        __completedOnceByMode: {
          [mode]: !!d.__completedOnce
        }
      };

      return finalizeData(normalized, mode);
    }

    const cats = repairCatsArray(Array.isArray(d.cats) ? d.cats : []);
    const catIndex = createCatIndex(cats);

    const rawItemsByMode = isPlainObject(d.itemsByMode) ? d.itemsByMode : {};
    const itemsByMode = {};

    for (const [mk, arr] of Object.entries(rawItemsByMode)) {
      const key = slugifyModeKey(mk);
      itemsByMode[key] = ensureUniqueItemIds(
        repairItemsArray(Array.isArray(arr) ? arr : [], cats)
      );
    }

    if (!itemsByMode[mode]) {
      const preset = newPresetSafe(mode);
      const presetItems =
        Array.isArray(preset?.itemsByMode?.[mode]) ? preset.itemsByMode[mode] :
        Array.isArray(preset?.items) ? preset.items :
        [];

      itemsByMode[mode] = ensureUniqueItemIds(repairItemsArray(presetItems, cats));
    }

    const rawModes = isPlainObject(d.modes) ? d.modes : {};
    const allModeKeys = uniq([
      mode,
      ...Object.keys(itemsByMode).map(slugifyModeKey),
      ...Object.keys(rawModes).map(slugifyModeKey)
    ]);

    const modes = {};
    for (const mk of allModeKeys) {
      const meta = rawModes[mk] || rawModes[String(mk)] || {};
      modes[mk] = repairModeMeta(mk, meta);
    }

    const rawCompleted = isPlainObject(d.__completedOnceByMode)
      ? d.__completedOnceByMode
      : {};

    const out = {
      version: 3,
      mode,
      cats,
      itemsByMode,
      modes,
      __completedOnceByMode: {}
    };

    for (const mk of allModeKeys) {
      out.__completedOnceByMode[mk] = !!rawCompleted[mk];
      out.itemsByMode[mk] = normalizeItemsCats(out.itemsByMode[mk], catIndex);
    }

    return finalizeData(out, mode);
  }

  function finalizeData(data, preferredMode) {
    const mode = slugifyModeKey(data?.mode || preferredMode || 'salida');
    const cats = repairCatsArray(Array.isArray(data?.cats) ? data.cats : []);
    const catIndex = createCatIndex(cats);

    const out = {
      version: 3,
      mode,
      cats,
      itemsByMode: {},
      modes: {},
      __completedOnceByMode: {}
    };

    const allModeKeys = uniq([
      mode,
      ...(isPlainObject(data?.itemsByMode) ? Object.keys(data.itemsByMode).map(slugifyModeKey) : []),
      ...(isPlainObject(data?.modes) ? Object.keys(data.modes).map(slugifyModeKey) : [])
    ]);

    if (!allModeKeys.length) allModeKeys.push(mode);

    for (const mk of allModeKeys) {
      const rawItems = Array.isArray(data?.itemsByMode?.[mk]) ? data.itemsByMode[mk] : [];
      const fixedItems = ensureUniqueItemIds(
        normalizeItemsCats(
          repairItemsArray(rawItems, cats),
          catIndex
        )
      );

      out.itemsByMode[mk] = fixedItems;
      out.modes[mk] = repairModeMeta(mk, data?.modes?.[mk] || {});
      out.__completedOnceByMode[mk] = !!data?.__completedOnceByMode?.[mk];
    }

    if (!out.itemsByMode[mode]) out.itemsByMode[mode] = [];
    if (!out.modes[mode]) out.modes[mode] = repairModeMeta(mode, {});
    if (!(mode in out.__completedOnceByMode)) out.__completedOnceByMode[mode] = false;

    return out;
  }

  function repairCatsArray(cats) {
    const source = Array.isArray(cats) ? cats : [];
    const out = [];
    const seen = new Set();

    for (const raw of source) {
      const c = repairCat(raw);

      let id = slugifyCatKey(c.id || c.key || c.label || c.name || 'otros');
      if (!id) id = 'otros';

      if (seen.has(id)) {
        id = `${id}_${makeId().slice(0, 4)}`;
      }
      seen.add(id);

      const label = ensureString(c.name || c.label || id, 60) || 'Otros';
      const emoji = c.emoji ? normalizeEmoji(c.emoji) : null;

      out.push(makeCompatCat({
        id,
        name: label,
        emoji
      }));
    }

    if (!out.length) {
      out.push(makeCompatCat({
        id: 'otros',
        name: 'Otros',
        emoji: null
      }));
    }

    if (!out.some(c => c.id === 'otros')) {
      out.push(makeCompatCat({
        id: 'otros',
        name: 'Otros',
        emoji: null
      }));
    }

    return out;
  }

  function repairItemsArray(items, cats) {
    return (Array.isArray(items) ? items : []).map((it) => repairItem(it, cats));
  }

  function ensureUniqueItemIds(items) {
    const seen = new Set();

    return (Array.isArray(items) ? items : []).map((it) => {
      const fixed = { ...it };
      let id = ensureString(fixed.id, 140) || makeId();

      if (seen.has(id)) {
        id = makeId();
      }

      fixed.id = id;
      seen.add(id);
      return fixed;
    });
  }

  function repairCat(c) {
    if (typeof c === 'string') {
      const id = slugifyCatKey(c) || 'otros';
      const name = ensureString(c, 60) || 'Otros';
      return makeCompatCat({ id, name, emoji: null });
    }

    const id = slugifyCatKey(
      c?.id ||
      c?.key ||
      c?.slug ||
      c?.value ||
      c?.name ||
      c?.label ||
      'otros'
    ) || 'otros';

    const name = ensureString(
      c?.name ||
      c?.label ||
      c?.title ||
      c?.text ||
      id,
      60
    ) || 'Otros';

    const emoji = c?.emoji ? normalizeEmoji(c.emoji) : null;

    return makeCompatCat({ id, name, emoji });
  }

  function repairItem(it, cats) {
    const rawModes = Array.isArray(it?.modes)
      ? uniq(it.modes.map(x => slugifyModeKey(x)).filter(Boolean))
      : null;

    const rawCat = ensureString(
      it?.cat ||
      it?.category ||
      it?.catId ||
      it?.categoryId ||
      'otros',
      60
    ) || 'otros';

    const fixed = {
      id: ensureString(it?.id || makeId(), 140) || makeId(),
      cat: rawCat,
      name: ensureString(it?.name || it?.title || 'Sin nombre', 120) || 'Sin nombre',
      emoji: it?.emoji ? normalizeEmoji(it.emoji) : null,
      done: !!it?.done,
      modes: rawModes,
      originId: it?.originId ? ensureString(it.originId, 140) : null
    };

    // primera pasada: slug básico
    fixed.cat = slugifyCatKey(fixed.cat) || 'otros';

    // segunda pasada: si hay cats, compatibiliza contra IDs reales
    if (Array.isArray(cats) && cats.length) {
      const catIndex = createCatIndex(cats);
      fixed.cat = resolveExistingCatId(fixed.cat, catIndex);
    }

    return fixed;
  }

  function repairModeMeta(key, meta) {
    const fixedKey = slugifyModeKey(key || meta?.key || meta?.name || 'salida');
    const label = ensureString(meta?.label || meta?.name || labelFromMode(fixedKey), 60) || labelFromMode(fixedKey);

    return {
      key: fixedKey,
      name: label,
      label,
      icon: meta?.icon ? normalizeEmoji(meta.icon) : null,
      createdAt: ensureString(meta?.createdAt || '', 40) || nowIso(),
      updatedAt: ensureString(meta?.updatedAt || '', 40) || nowIso()
    };
  }

  /**
   * migrateToEnvelope
   * Accepts:
   * - null
   * - legacy single data object
   * - legacy envelope { byMode:{} }
   * - weird partial objects
   */
  function migrateToEnvelope(parsed, preferredMode) {
    const mode = resolveMode(preferredMode);

    if (!isPlainObject(parsed)) {
      const env = createFreshEnvelope(mode);
      env.byMode[mode] = repairData(newPresetSafe(mode), mode);
      return env;
    }

    // Envelope actual o medio actual
    if (isPlainObject(parsed.byMode)) {
      const env = createFreshEnvelope(mode);

      for (const [mk, rawModeData] of Object.entries(parsed.byMode)) {
        const key = slugifyModeKey(mk);
        env.byMode[key] = repairData(rawModeData, key);
      }

      env.currentMode = resolveMode(parsed.currentMode || mode);
      env.version = DATA_SCHEMA;
      env.savedAt = ensureString(parsed.savedAt || '', 40) || nowIso();

      if (!env.byMode[env.currentMode]) {
        env.byMode[env.currentMode] = repairData(newPresetSafe(env.currentMode), env.currentMode);
      }

      return env;
    }

    // Caso raro: parsed ya tiene varios modos incrustados
    if (isPlainObject(parsed.itemsByMode) || isPlainObject(parsed.modes)) {
      const singleMode = resolveMode(parsed.mode || mode);
      const env = createFreshEnvelope(singleMode);
      env.currentMode = singleMode;
      env.byMode[singleMode] = repairData(parsed, singleMode);
      return env;
    }

    // Single-object legacy
    const legacyMode = resolveMode(parsed.mode || mode);
    const env = createFreshEnvelope(legacyMode);
    env.currentMode = legacyMode;
    env.byMode[legacyMode] = repairData(parsed, legacyMode);
    return env;
  }

  function createFreshEnvelope(mode) {
    const cleanMode = resolveMode(mode);

    return {
      version: DATA_SCHEMA,
      currentMode: cleanMode,
      savedAt: nowIso(),
      byMode: Object.create(null)
    };
  }

  function normalizeSavePayload(dataOrPack) {
    if (isPlainObject(dataOrPack) && 'data' in dataOrPack && 'mode' in dataOrPack) {
      return {
        mode: dataOrPack.mode,
        data: dataOrPack.data
      };
    }

    const d = isPlainObject(dataOrPack) ? dataOrPack : {};
    return {
      mode: d.mode,
      data: d
    };
  }

  function resolveMode(settingsOrMode) {
    if (typeof settingsOrMode === 'string' && settingsOrMode.trim()) {
      return slugifyModeKey(settingsOrMode.trim());
    }

    const s = isPlainObject(settingsOrMode) ? settingsOrMode : {};
    return slugifyModeKey(s.tripMode || defaultSettings.tripMode || 'salida');
  }

  function newPresetSafe(mode) {
    try {
      if (typeof newPreset === 'function') {
        const preset = newPreset(mode);
        if (isPlainObject(preset)) return preset;
      }
    } catch {}

    return {
      version: 3,
      mode,
      cats: [makeCompatCat({ id: 'otros', name: 'Otros', emoji: null })],
      itemsByMode: { [mode]: [] },
      modes: {
        [mode]: repairModeMeta(mode, { name: labelFromMode(mode), label: labelFromMode(mode) })
      },
      __completedOnceByMode: { [mode]: false }
    };
  }

  function persistModeIntoEnvelope(data, preferredMode) {
    const mode = resolveMode(preferredMode || data?.mode);
    const env = loadEnvelope(mode);
    env.byMode[mode] = repairData(data, mode);
    env.currentMode = mode;
    env.version = DATA_SCHEMA;
    env.savedAt = nowIso();
    localStorage.setItem(storageKey, JSON.stringify(env));
  }

  function makeId() {
    try {
      if (typeof uid === 'function') {
        const v = String(uid());
        if (v) return v;
      }
    } catch {}
    return `${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
  }

  return {
    loadSettings,
    saveSettings,
    loadData,
    saveData,
    loadEnvelope,
    saveEnvelope,
    wipeAllStorage,
    createDebouncedSavers,

    // útiles para debug/migración
    _internals: {
      sanitizeSettings,
      repairData,
      migrateToEnvelope,
      resolveMode,
      repairCat,
      repairItem,
      repairCatsArray,
      repairItemsArray
    }
  };
}

/* =========================
   UTIL
========================= */

function safeParse(raw) {
  try { return JSON.parse(raw); }
  catch { return null; }
}

function debounce(fn, wait = 200) {
  let t = null;
  let lastArgs = null;

  function wrapped(...args) {
    lastArgs = args;
    clearTimeout(t);
    t = setTimeout(() => {
      t = null;
      const argsToUse = lastArgs;
      lastArgs = null;
      fn(...argsToUse);
    }, wait);
  }

  wrapped.cancel = () => {
    clearTimeout(t);
    t = null;
    lastArgs = null;
  };

  wrapped.flush = () => {
    if (!t) return;
    clearTimeout(t);
    t = null;
    if (lastArgs) {
      const argsToUse = lastArgs;
      lastArgs = null;
      fn(...argsToUse);
    }
  };

  return wrapped;
}

function clampInt(v, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  const i = Math.floor(n);
  return Math.min(max, Math.max(min, i));
}

function ensureString(v, maxLen = 80) {
  const s = String(v ?? '').trim();
  return maxLen ? s.slice(0, maxLen) : s;
}

function isPlainObject(v) {
  return v != null && typeof v === 'object' &&
    (v.constructor === Object || Object.getPrototypeOf(v) === Object.prototype);
}

function uniq(arr) {
  const out = [];
  const seen = new Set();

  for (const x of arr || []) {
    const k = String(x ?? '').trim();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }

  return out;
}

function slugifyModeKey(v) {
  const raw = ensureString(v, 60).toLowerCase();

  const s = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s_-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '');

  return s || 'salida';
}

function slugifyCatKey(v) {
  const raw = ensureString(v, 60).toLowerCase();

  const s = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s_-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '');

  return s || 'otros';
}

function normalizeEmoji(v) {
  const e = ensureString(v, 12);
  return e || null;
}

function nowIso() {
  try { return new Date().toISOString(); }
  catch { return ''; }
}

function labelFromMode(mode) {
  const key = slugifyModeKey(mode);

  const map = {
    salida: 'Salida',
    viaje: 'Viaje',
    gira: 'Gira',
    playa: 'Playa',
    frio: 'Frío'
  };

  return map[key] || toTitle(key.replace(/-/g, ' '));
}

function toTitle(v) {
  return ensureString(v, 80)
    .split(/\s+/)
    .filter(Boolean)
    .map(x => x.charAt(0).toUpperCase() + x.slice(1))
    .join(' ') || 'Sin nombre';
}

function makeCompatCat({ id, name, emoji = null }) {
  const safeId = slugifyCatKey(id || name || 'otros') || 'otros';
  const safeName = ensureString(name, 60) || 'Otros';

  return {
    // forma moderna/canónica
    id: safeId,
    name: safeName,
    emoji,

    // aliases de compat
    key: safeId,
    label: safeName
  };
}

function createCatIndex(cats) {
  const map = new Map();

  for (const c of Array.isArray(cats) ? cats : []) {
    const id = slugifyCatKey(c?.id || c?.key || c?.name || c?.label || 'otros') || 'otros';
    const name = ensureString(c?.name || c?.label || id, 60) || 'Otros';

    const aliases = uniq([
      id,
      c?.id,
      c?.key,
      c?.name,
      c?.label,
      slugifyCatKey(name),
      slugifyCatKey(id)
    ].filter(Boolean));

    for (const alias of aliases) {
      map.set(String(alias).trim().toLowerCase(), id);
      map.set(slugifyCatKey(alias), id);
    }
  }

  if (!map.has('otros')) {
    map.set('otros', 'otros');
  }

  return map;
}

function resolveExistingCatId(rawCat, catIndex) {
  const raw = ensureString(rawCat, 60) || 'otros';
  const byRaw = catIndex.get(raw.toLowerCase());
  if (byRaw) return byRaw;

  const slug = slugifyCatKey(raw);
  const bySlug = catIndex.get(slug);
  if (bySlug) return bySlug;

  return 'otros';
}

function normalizeItemsCats(items, catIndex) {
  return (Array.isArray(items) ? items : []).map((it) => ({
    ...it,
    cat: resolveExistingCatId(it?.cat, catIndex)
  }));
}