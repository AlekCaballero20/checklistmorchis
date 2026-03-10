/* =============================================================================
  /src/actions.js — App actions (domain logic) — PRO v6.0
  - ✅ NO DOM manipulation inside
  - ✅ Multi-mode robusto + backward compatible
  - ✅ Soporta:
      toggleDone / deleteItem / resetChecks / setAll / createItem
      editItem / duplicateItem / moveItem
      assignItemToModes / toggleItemMode / setItemModes
      changeMode / wipeAll / onCompletedOnce
      createMode / renameMode / updateMode / deleteMode / duplicateMode / openModeEditor
  - ✅ Compat con data shape viejo y nuevo
  - ✅ Unifica completedOnceByMode / __completedOnceByMode
  - ✅ createItem({ targetMode }) crea en la lista elegida
  - ✅ assignItemToModes agrega a otras listas sin romper el item origen
  - ✅ Menos sorpresas con setState y saveData/saveSettings
============================================================================= */

'use strict';

/**
 * Factory: createActions
 * @param {Object} params
 * @param {Function} params.getState   () => state
 * @param {Function} params.setState   (partial | updaterFn, options?) => void
 * @param {Object} params.deps
 */
export function createActions({ getState, setState, deps = {} }) {
  /* =========================
     DEPS
  ========================= */

  const newPreset = deps.newPreset || ((m) => ({
    version: 3,
    mode: m,
    cats: [],
    items: [],
    completedOnceByMode: { [m]: false }
  }));

  const saveSettings = typeof deps.saveSettings === 'function' ? deps.saveSettings : () => {};
  const saveData = typeof deps.saveData === 'function' ? deps.saveData : () => {};
  const uidFn = typeof deps.uid === 'function' ? deps.uid : null;

  const toast = typeof deps.toast === 'function' ? deps.toast : null;
  const haptic = typeof deps.haptic === 'function' ? deps.haptic : null;
  const tickSound = typeof deps.tickSound === 'function' ? deps.tickSound : null;
  const confetti = typeof deps.confetti === 'function' ? deps.confetti : null;

  const safeToast = (msg) => { try { toast?.(msg); } catch {} };
  const safeHaptic = (ms) => { try { haptic?.(ms); } catch {} };
  const safeTick = () => { try { tickSound?.(); } catch {} };
  const safeConfetti = () => { try { confetti?.(); } catch {} };

  /* =========================
     SMALL UTILS
  ========================= */

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
      const k = String(x || '').trim();
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

    return s || 'modo';
  }

  function slugifyCatKey(v) {
    const raw = ensureString(v, 40).toLowerCase();

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
    const e = ensureString(v, 8);
    return e ? e : null;
  }

  function makeId() {
    if (uidFn) return String(uidFn());
    return `${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
  }

  function nowIso() {
    try { return new Date().toISOString(); } catch { return ''; }
  }

  function snap() {
    try { return getState?.() || {}; } catch { return {}; }
  }

  function getActiveMode(state) {
    return String(state?.settings?.tripMode || state?.data?.mode || 'salida');
  }

  function findIndexById(items, id) {
    if (!Array.isArray(items)) return -1;
    return items.findIndex(x => x && String(x.id) === String(id));
  }

  function shallowClone(v) {
    return JSON.parse(JSON.stringify(v));
  }

  function commitState(updater) {
    if (typeof setState !== 'function') return;

    try {
      setState(updater);
      return;
    } catch {}

    try {
      const prev = snap();
      const next = typeof updater === 'function' ? updater(prev) : updater;
      if (next && typeof next === 'object') {
        setState(next);
      }
    } catch {}
  }

  /* =========================
     NORMALIZERS
  ========================= */

  function repairCat_(cat) {
    if (typeof cat === 'string') {
      const key = slugifyCatKey(cat);
      const label = key === 'otros' ? 'Otros' : ensureString(cat, 60) || key;
      return {
        id: key,
        key,
        name: label,
        label,
        emoji: key === 'otros' ? '✨' : null
      };
    }

    if (isPlainObject(cat)) {
      const key = slugifyCatKey(cat.key || cat.id || cat.slug || cat.name || 'otros');
      const label = ensureString(cat.label || cat.name || key || 'Otros', 60) || 'Otros';

      return {
        ...cat,
        id: key,
        key,
        name: label,
        label,
        emoji: normalizeEmoji(cat.emoji)
      };
    }

    return {
      id: 'otros',
      key: 'otros',
      name: 'Otros',
      label: 'Otros',
      emoji: '✨'
    };
  }

  function repairItem_(it) {
    const repairedModes = Array.isArray(it?.modes)
      ? uniq(it.modes.map(x => ensureString(x, 24)).filter(Boolean)).map(slugifyModeKey)
      : null;

    return {
      id: ensureString(it?.id || makeId(), 140),
      cat: slugifyCatKey(it?.cat || 'otros'),
      name: ensureString(it?.name || 'Sin nombre', 80) || 'Sin nombre',
      emoji: it?.emoji ? normalizeEmoji(it.emoji) : null,
      done: !!it?.done,
      modes: repairedModes?.length ? repairedModes : null,
      originId: it?.originId ? ensureString(it.originId, 140) : null
    };
  }

  function repairModeMeta_(key, meta = {}) {
    const fixedKey = slugifyModeKey(key || meta?.key || meta?.name || 'modo');
    const cleanName = ensureString(meta?.name || stripLeadingEmoji(meta?.label) || fixedKey, 60) || fixedKey;
    const cleanLabel = ensureString(meta?.label || `🧳 ${cleanName}`, 60) || `🧳 ${cleanName}`;

    return {
      key: fixedKey,
      name: cleanName,
      label: cleanLabel,
      icon: normalizeEmoji(meta?.icon),
      createdAt: ensureString(meta?.createdAt || '', 60) || nowIso(),
      updatedAt: ensureString(meta?.updatedAt || '', 60) || nowIso()
    };
  }

  function stripLeadingEmoji(text = '') {
    return String(text)
      .replace(/^[^\p{L}\p{N}]+/u, '')
      .trim();
  }

  /* =========================
     DATA SHAPE
  ========================= */

  function ensureModesMap_(data, activeMode) {
    const currentMode = slugifyModeKey(data?.mode || activeMode || 'salida');
    const raw = isPlainObject(data?.modes) ? data.modes : {};
    const out = {};

    for (const [k, v] of Object.entries(raw)) {
      const meta = repairModeMeta_(k, v);
      out[meta.key] = meta;
    }

    const itemModes = isPlainObject(data?.itemsByMode) ? Object.keys(data.itemsByMode) : [];
    const catModes = isPlainObject(data?.catsByMode) ? Object.keys(data.catsByMode) : [];
    const modeKeys = uniq([currentMode, ...itemModes, ...catModes, ...Object.keys(out)]);

    for (const mk of modeKeys) {
      const sk = slugifyModeKey(mk);
      if (!out[sk]) {
        out[sk] = repairModeMeta_(sk, { name: sk, label: `🧳 ${stripLeadingEmoji(sk) || sk}` });
      }
    }

    return out;
  }

  function readCompletedMap_(data, mode) {
    const legacy = isPlainObject(data?.__completedOnceByMode) ? data.__completedOnceByMode : {};
    const modern = isPlainObject(data?.completedOnceByMode) ? data.completedOnceByMode : {};
    const merged = { ...legacy, ...modern };

    if (!(mode in merged)) merged[mode] = !!data?.__completedOnce || false;
    return merged;
  }

  function ensureDataShape_(data, activeMode) {
    const mode = slugifyModeKey(data?.mode || activeMode || 'salida');
    const basePreset = newPreset(mode) || {};

    const cats =
      Array.isArray(data?.cats) ? data.cats
      : Array.isArray(basePreset.cats) ? basePreset.cats
      : [];

    let itemsByMode = {};
    let catsByMode = {};
    let doneByMode = {};

    if (isPlainObject(data?.itemsByMode)) {
      itemsByMode = { ...data.itemsByMode };
      catsByMode = isPlainObject(data?.catsByMode) ? { ...data.catsByMode } : {};
      doneByMode = readCompletedMap_(data, mode);
    } else {
      const legacyItems =
        Array.isArray(data?.items) ? data.items
        : Array.isArray(basePreset.items) ? basePreset.items
        : [];

      itemsByMode = { [mode]: legacyItems };
      catsByMode = { [mode]: cats };
      doneByMode = { [mode]: !!data?.__completedOnce };
    }

    const normalizedItemsByMode = {};
    for (const [mk, arr] of Object.entries(itemsByMode)) {
      const cleanMode = slugifyModeKey(mk);
      normalizedItemsByMode[cleanMode] = Array.isArray(arr) ? arr.map(repairItem_) : [];
    }

    const normalizedCatsByMode = {};
    for (const [mk, arr] of Object.entries(catsByMode)) {
      const cleanMode = slugifyModeKey(mk);
      normalizedCatsByMode[cleanMode] = Array.isArray(arr) ? ensureCatsContainOtros_(arr.map(repairCat_)) : [];
    }

    if (!Array.isArray(normalizedItemsByMode[mode])) {
      normalizedItemsByMode[mode] = [];
    }

    if (!Array.isArray(normalizedCatsByMode[mode])) {
      normalizedCatsByMode[mode] = ensureCatsContainOtros_(
        Array.isArray(cats) ? cats.map(repairCat_) : []
      );
    }

    const modes = ensureModesMap_({
      ...data,
      mode,
      itemsByMode: normalizedItemsByMode,
      catsByMode: normalizedCatsByMode
    }, mode);

    const completedOnceByMode = {};
    for (const mk of Object.keys(modes)) {
      completedOnceByMode[mk] = !!doneByMode[mk];
    }

    return {
      version: 3,
      mode,
      cats: ensureCatsContainOtros_(Array.isArray(cats) ? cats.map(repairCat_) : []),
      catsByMode: normalizedCatsByMode,
      itemsByMode: normalizedItemsByMode,
      modes,
      completedOnceByMode,
      __completedOnceByMode: { ...completedOnceByMode }
    };
  }

  function getModeItems_(data, mode) {
    const m = slugifyModeKey(mode || data?.mode || 'salida');
    if (isPlainObject(data?.itemsByMode) && Array.isArray(data.itemsByMode[m])) return data.itemsByMode[m];
    return [];
  }

  function setModeItems_(data, mode, items) {
    const m = slugifyModeKey(mode || data?.mode || 'salida');
    if (!isPlainObject(data.itemsByMode)) data.itemsByMode = {};
    data.itemsByMode[m] = Array.isArray(items) ? items.map(repairItem_) : [];
  }

  function getModeCats_(data, mode) {
    const m = slugifyModeKey(mode || data?.mode || 'salida');
    if (isPlainObject(data?.catsByMode) && Array.isArray(data.catsByMode[m])) return data.catsByMode[m];
    if (Array.isArray(data?.cats)) return data.cats;
    return [];
  }

  function setModeCats_(data, mode, cats) {
    const m = slugifyModeKey(mode || data?.mode || 'salida');
    if (!isPlainObject(data.catsByMode)) data.catsByMode = {};
    data.catsByMode[m] = ensureCatsContainOtros_(Array.isArray(cats) ? cats.map(repairCat_) : []);
  }

  function getCompletedFlag_(data, mode) {
    const m = slugifyModeKey(mode || data?.mode || 'salida');
    const modern = isPlainObject(data?.completedOnceByMode) ? data.completedOnceByMode : {};
    const legacy = isPlainObject(data?.__completedOnceByMode) ? data.__completedOnceByMode : {};
    return !!(modern[m] ?? legacy[m] ?? false);
  }

  function setCompletedFlag_(data, mode, val) {
    const m = slugifyModeKey(mode || data?.mode || 'salida');
    if (!isPlainObject(data.completedOnceByMode)) data.completedOnceByMode = {};
    if (!isPlainObject(data.__completedOnceByMode)) data.__completedOnceByMode = {};
    data.completedOnceByMode[m] = !!val;
    data.__completedOnceByMode[m] = !!val;
  }

  function ensureModeMeta_(data, mode, extra = {}) {
    const m = slugifyModeKey(mode || data?.mode || 'salida');
    if (!isPlainObject(data.modes)) data.modes = {};

    const prev = data.modes[m] || repairModeMeta_(m, { name: m, label: `🧳 ${m}` });
    const nextMeta = repairModeMeta_(m, {
      ...prev,
      ...extra,
      updatedAt: nowIso()
    });

    data.modes[m] = nextMeta;
    return nextMeta;
  }

  function ensureCatsContainOtros_(cats) {
    const list = Array.isArray(cats) ? cats.map(repairCat_) : [];
    const exists = list.some(c => ensureString(c?.key || c?.id || '', 40) === 'otros');
    if (exists) return list;

    return [
      ...list,
      { id: 'otros', key: 'otros', name: 'Otros', label: 'Otros', emoji: '✨' }
    ];
  }

  function ensureModeInitialized_(data, mode) {
    const m = slugifyModeKey(mode || data?.mode || 'salida');

    if (!isPlainObject(data.itemsByMode)) data.itemsByMode = {};
    if (!isPlainObject(data.catsByMode)) data.catsByMode = {};

    if (!Array.isArray(data.itemsByMode[m])) {
      const p = newPreset(m) || {};
      const presetItems = Array.isArray(p.items) ? p.items.map(repairItem_) : [];
      data.itemsByMode[m] = presetItems;
    } else {
      data.itemsByMode[m] = data.itemsByMode[m].map(repairItem_);
    }

    if (!Array.isArray(data.catsByMode[m])) {
      const p = newPreset(m) || {};
      const presetCats = Array.isArray(p.cats) ? p.cats.map(repairCat_) : [];
      data.catsByMode[m] = ensureCatsContainOtros_(
        presetCats.length ? presetCats : (Array.isArray(data.cats) ? data.cats : [])
      );
    } else {
      data.catsByMode[m] = ensureCatsContainOtros_(data.catsByMode[m]);
    }

    if (!isPlainObject(data.completedOnceByMode)) data.completedOnceByMode = {};
    if (!isPlainObject(data.__completedOnceByMode)) data.__completedOnceByMode = {};

    if (!(m in data.completedOnceByMode)) data.completedOnceByMode[m] = false;
    if (!(m in data.__completedOnceByMode)) data.__completedOnceByMode[m] = !!data.completedOnceByMode[m];

    ensureModeMeta_(data, m);
  }

  function getAllModeKeys_(data) {
    const modeKeys = new Set();

    if (isPlainObject(data?.itemsByMode)) {
      for (const k of Object.keys(data.itemsByMode)) modeKeys.add(String(k));
    }

    if (isPlainObject(data?.catsByMode)) {
      for (const k of Object.keys(data.catsByMode)) modeKeys.add(String(k));
    }

    if (isPlainObject(data?.modes)) {
      for (const k of Object.keys(data.modes)) modeKeys.add(String(k));
    }

    if (data?.mode) modeKeys.add(String(data.mode));

    return Array.from(modeKeys).map(slugifyModeKey);
  }

  function canDeleteMode_(data, mode) {
    const keys = getAllModeKeys_(data);
    return keys.length > 1 && keys.includes(mode);
  }

  function ensureCatExistsInMode_(data, mode, catKey, fallbackLabel = null) {
    const m = slugifyModeKey(mode);
    const cleanCat = slugifyCatKey(catKey);
    ensureModeInitialized_(data, m);

    const cats = getModeCats_(data, m);
    const exists = cats.some(c => ensureString(c?.key || c?.id || '', 40) === cleanCat);
    if (exists) return;

    cats.push(repairCat_({
      key: cleanCat,
      id: cleanCat,
      label: fallbackLabel || cleanCat,
      name: fallbackLabel || cleanCat,
      emoji: cleanCat === 'otros' ? '✨' : null
    }));

    setModeCats_(data, m, cats);
  }

  /**
   * updateData(mutator, opts?)
   */
  function updateData(mutator, opts = {}) {
    const doSave = opts.save !== false;

    commitState((s) => {
      const activeMode = getActiveMode(s);
      const next = { ...s };

      const shaped = ensureDataShape_(s.data, activeMode);

      next.data = {
        ...shaped,
        cats: shaped.cats.map(c => ({ ...c })),
        catsByMode: Object.fromEntries(
          Object.entries(shaped.catsByMode || {}).map(([k, arr]) => [k, arr.map(c => ({ ...c }))])
        ),
        itemsByMode: Object.fromEntries(
          Object.entries(shaped.itemsByMode || {}).map(([k, arr]) => [k, arr.map(i => ({ ...i }))])
        ),
        modes: Object.fromEntries(
          Object.entries(shaped.modes || {}).map(([k, meta]) => [k, { ...meta }])
        ),
        completedOnceByMode: { ...(shaped.completedOnceByMode || {}) },
        __completedOnceByMode: { ...(shaped.__completedOnceByMode || shaped.completedOnceByMode || {}) }
      };

      ensureModeInitialized_(next.data, activeMode);
      mutator(next, { mode: activeMode });

      return next;
    });

    if (doSave) saveData();
  }

  function updateSettings(mutator) {
    commitState((s) => {
      const next = { ...s, settings: { ...(s.settings || {}) } };
      mutator(next);
      return next;
    });
    saveSettings();
  }

  /* =========================
     CORE
  ========================= */

  function toggleDone(id) {
    const cleanId = ensureString(id, 140);
    if (!cleanId) return { ok: false, reason: 'BAD_ID' };

    let ok = false;

    updateData((next, ctx) => {
      const items = getModeItems_(next.data, ctx.mode);
      const idx = findIndexById(items, cleanId);
      if (idx < 0) return;

      items[idx] = { ...items[idx], done: !items[idx].done };
      setModeItems_(next.data, ctx.mode, items);
      setCompletedFlag_(next.data, ctx.mode, false);
      ok = true;
    });

    if (!ok) return { ok: false, reason: 'NOT_FOUND' };

    const s = snap();
    if (s?.settings?.sound) safeTick();
    safeHaptic(12);
    return { ok: true };
  }

  function deleteItem(id) {
    const cleanId = ensureString(id, 140);
    if (!cleanId) return { ok: false, reason: 'BAD_ID' };

    let removed = false;

    updateData((next, ctx) => {
      const items = getModeItems_(next.data, ctx.mode);
      const before = items.length;
      const after = items.filter(x => x && x.id !== cleanId);
      removed = before !== after.length;

      setModeItems_(next.data, ctx.mode, after);
      setCompletedFlag_(next.data, ctx.mode, false);
    });

    if (!removed) return { ok: false, reason: 'NOT_FOUND' };

    safeToast('Item eliminado 🗑️');
    safeHaptic(10);
    return { ok: true };
  }

  function resetChecks() {
    updateData((next, ctx) => {
      const items = getModeItems_(next.data, ctx.mode).map(i => ({ ...i, done: false }));
      setModeItems_(next.data, ctx.mode, items);
      setCompletedFlag_(next.data, ctx.mode, false);
    });

    safeToast('Checklist reiniciado ↺');
    safeHaptic(12);
    return { ok: true };
  }

  function setAll(done) {
    const d = !!done;

    updateData((next, ctx) => {
      const items = getModeItems_(next.data, ctx.mode).map(i => ({ ...i, done: d }));
      setModeItems_(next.data, ctx.mode, items);
      setCompletedFlag_(next.data, ctx.mode, false);
    });

    safeToast(d ? 'Todo marcado ✅' : 'Todo desmarcado ⬜');
    safeHaptic(14);
    return { ok: true };
  }

  function createItem({ name, emoji = null, cat = 'otros', targetMode = null, modes = null } = {}) {
    const cleanName = ensureString(name, 80);
    const cleanCat = slugifyCatKey(cat || 'otros');
    const cleanEmoji = normalizeEmoji(emoji);
    const cleanTargetMode = targetMode ? slugifyModeKey(targetMode) : '';
    const cleanModes = Array.isArray(modes)
      ? uniq(modes.map(x => slugifyModeKey(x)).filter(Boolean))
      : null;

    if (!cleanName) {
      safeToast('Ponle nombre al item 🙃');
      safeHaptic(18);
      return { ok: false, reason: 'EMPTY_NAME' };
    }

    let createdId = '';
    let usedMode = '';

    updateData((next, ctx) => {
      const modeToUse = cleanTargetMode || ctx.mode;
      usedMode = modeToUse;

      ensureModeInitialized_(next.data, modeToUse);
      ensureCatExistsInMode_(next.data, modeToUse, cleanCat, cleanCat);

      const items = getModeItems_(next.data, modeToUse);
      createdId = makeId();

      items.unshift({
        id: createdId,
        cat: cleanCat,
        name: cleanName,
        emoji: cleanEmoji,
        done: false,
        modes: cleanModes?.length ? uniq([modeToUse, ...cleanModes]) : [modeToUse],
        originId: null
      });

      setModeItems_(next.data, modeToUse, items);
      setCompletedFlag_(next.data, modeToUse, false);
    });

    if (createdId && cleanModes?.length) {
      const extraModes = cleanModes.filter(m => m !== usedMode);
      if (extraModes.length) {
        assignItemToModes(createdId, extraModes, { keepDone: false, silent: true, fromMode: usedMode });
      }
    }

    safeToast('Agregado ✅');
    safeHaptic(12);
    return { ok: true, id: createdId, modeKey: usedMode || cleanTargetMode || getActiveMode(snap()) };
  }

  /* =========================
     EDIT / MOVE / DUPLICATE
  ========================= */

  function editItem(id, { name, emoji, cat, modes } = {}) {
    const cleanId = ensureString(id, 140);
    if (!cleanId) return { ok: false, reason: 'BAD_ID' };

    const hasName = name !== undefined;
    const hasEmoji = emoji !== undefined;
    const hasCat = cat !== undefined;
    const hasModes = modes !== undefined;

    const cleanName = hasName ? ensureString(name, 80) : null;
    const cleanEmoji = hasEmoji ? normalizeEmoji(emoji) : null;
    const cleanCat = hasCat ? slugifyCatKey(cat || 'otros') : null;
    const cleanModes = hasModes
      ? (Array.isArray(modes) ? uniq(modes.map(x => slugifyModeKey(x)).filter(Boolean)) : null)
      : null;

    if (hasName && !cleanName) {
      safeToast('Ponle nombre al item 🙃');
      safeHaptic(18);
      return { ok: false, reason: 'EMPTY_NAME' };
    }

    let updated = false;
    let currentMode = '';

    updateData((next, ctx) => {
      currentMode = ctx.mode;
      const items = getModeItems_(next.data, ctx.mode);
      const idx = findIndexById(items, cleanId);
      if (idx < 0) return;

      const it = items[idx];
      const nextIt = { ...it };

      if (hasName) nextIt.name = cleanName;
      if (hasEmoji) nextIt.emoji = cleanEmoji;
      if (hasCat) {
        nextIt.cat = cleanCat;
        ensureCatExistsInMode_(next.data, ctx.mode, cleanCat, cleanCat);
      }
      if (hasModes) {
        nextIt.modes = cleanModes?.length ? uniq([ctx.mode, ...cleanModes]) : [ctx.mode];
      }

      items[idx] = nextIt;
      setModeItems_(next.data, ctx.mode, items);
      setCompletedFlag_(next.data, ctx.mode, false);
      updated = true;
    });

    if (!updated) return { ok: false, reason: 'NOT_FOUND' };

    if (hasModes) {
      const wanted = cleanModes?.length ? uniq([currentMode, ...cleanModes]) : [currentMode];
      const other = wanted.filter(m => m !== currentMode);
      if (other.length) assignItemToModes(cleanId, other, { keepDone: false, silent: true, fromMode: currentMode });
    }

    safeToast('Actualizado ✅');
    safeHaptic(10);
    return { ok: true };
  }

  function moveItem(id, toCat) {
    const cleanId = ensureString(id, 140);
    const cleanCat = slugifyCatKey(toCat || 'otros');
    if (!cleanId) return { ok: false, reason: 'BAD_ID' };

    let moved = false;

    updateData((next, ctx) => {
      const items = getModeItems_(next.data, ctx.mode);
      const idx = findIndexById(items, cleanId);
      if (idx < 0) return;

      if (items[idx].cat === cleanCat) {
        moved = true;
        return;
      }

      ensureCatExistsInMode_(next.data, ctx.mode, cleanCat, cleanCat);

      items[idx] = { ...items[idx], cat: cleanCat };
      setModeItems_(next.data, ctx.mode, items);
      setCompletedFlag_(next.data, ctx.mode, false);
      moved = true;
    });

    if (!moved) return { ok: false, reason: 'NOT_FOUND' };

    safeToast('Movido ✅');
    safeHaptic(10);
    return { ok: true };
  }

  function duplicateItem(id, toCat) {
    const cleanId = ensureString(id, 140);
    const cleanCat = slugifyCatKey(toCat || 'otros');
    if (!cleanId) return { ok: false, reason: 'BAD_ID' };

    let copied = false;

    updateData((next, ctx) => {
      const items = getModeItems_(next.data, ctx.mode);
      const idx = findIndexById(items, cleanId);
      if (idx < 0) return;

      const it = items[idx];
      ensureCatExistsInMode_(next.data, ctx.mode, cleanCat, cleanCat);

      items.unshift({
        id: makeId(),
        cat: cleanCat,
        name: ensureString(it.name, 80) || 'Item',
        emoji: it.emoji || null,
        done: false,
        modes: Array.isArray(it.modes) && it.modes.length ? [...it.modes] : [ctx.mode],
        originId: it.originId || it.id
      });

      setModeItems_(next.data, ctx.mode, items);
      setCompletedFlag_(next.data, ctx.mode, false);
      copied = true;
    });

    if (!copied) return { ok: false, reason: 'NOT_FOUND' };

    safeToast('Copiado ✅');
    safeHaptic(10);
    return { ok: true };
  }

  /* =========================
     MODE ASSIGNMENT
  ========================= */

  function assignItemToModes(id, modes = [], opts = {}) {
    const cleanId = ensureString(id, 140);
    const targets = uniq((modes || []).map(x => slugifyModeKey(x)).filter(Boolean));
    const keepDone = !!opts.keepDone;
    const silent = !!opts.silent;

    if (!cleanId) return { ok: false, reason: 'BAD_ID' };
    if (!targets.length) return { ok: false, reason: 'NO_MODES' };

    const s = snap();
    const fromMode = slugifyModeKey(opts.fromMode || getActiveMode(s));

    const data = ensureDataShape_(s.data, fromMode);
    const fromItems = getModeItems_(data, fromMode);
    const idx = findIndexById(fromItems, cleanId);
    if (idx < 0) return { ok: false, reason: 'NOT_FOUND' };

    const source = repairItem_(fromItems[idx]);
    const originId = source.originId || source.id;
    let createdAny = false;

    updateData((next) => {
      next.data = ensureDataShape_(next.data, fromMode);

      for (const m of targets) {
        if (m === fromMode) continue;

        ensureModeInitialized_(next.data, m);
        ensureCatExistsInMode_(next.data, m, source.cat, source.cat);

        const list = getModeItems_(next.data, m);
        const already = list.some(it => {
          const itOrigin = it?.originId || it?.id;
          return String(itOrigin) === String(originId);
        });

        if (already) continue;

        list.unshift({
          id: makeId(),
          cat: ensureString(source.cat, 40) || 'otros',
          name: ensureString(source.name, 80) || 'Item',
          emoji: source.emoji || null,
          done: keepDone ? !!source.done : false,
          modes: [m],
          originId
        });

        setModeItems_(next.data, m, list);
        setCompletedFlag_(next.data, m, false);
        createdAny = true;
      }
    });

    if (!createdAny) {
      return { ok: false, reason: 'ALREADY_EXISTS' };
    }

    if (!silent) {
      safeToast('Asignado a otras listas ✅');
      safeHaptic(10);
    }

    return { ok: true };
  }

  function setItemModes(id, modes = []) {
    const cleanId = ensureString(id, 140);
    if (!cleanId) return { ok: false, reason: 'BAD_ID' };

    const s = snap();
    const currentMode = getActiveMode(s);
    const wanted = uniq((modes || []).map(x => slugifyModeKey(x)).filter(Boolean));
    const forced = wanted.length ? uniq([currentMode, ...wanted]) : [currentMode];

    let ok = false;

    updateData((next, ctx) => {
      const items = getModeItems_(next.data, ctx.mode);
      const idx = findIndexById(items, cleanId);
      if (idx < 0) return;

      items[idx] = { ...items[idx], modes: forced };
      setModeItems_(next.data, ctx.mode, items);
      setCompletedFlag_(next.data, ctx.mode, false);
      ok = true;
    });

    if (!ok) return { ok: false, reason: 'NOT_FOUND' };

    const other = forced.filter(m => m !== currentMode);
    if (other.length) assignItemToModes(cleanId, other, { keepDone: false, silent: true, fromMode: currentMode });

    safeToast('Listas actualizadas ✅');
    safeHaptic(8);
    return { ok: true, modes: forced };
  }

  function toggleItemMode(id, modeToToggle) {
    const cleanId = ensureString(id, 140);
    const m = slugifyModeKey(modeToToggle);

    if (!cleanId) return { ok: false, reason: 'BAD_ID' };
    if (!m) return { ok: false, reason: 'BAD_MODE' };

    const s = snap();
    const currentMode = getActiveMode(s);

    const shaped = ensureDataShape_(s.data, currentMode);
    const items = getModeItems_(shaped, currentMode);
    const idx = findIndexById(items, cleanId);
    if (idx < 0) return { ok: false, reason: 'NOT_FOUND' };

    const it = repairItem_(items[idx]);
    const cur = Array.isArray(it.modes) && it.modes.length ? uniq(it.modes) : [currentMode];

    const willAdd = !cur.includes(m);
    let nextModes = willAdd ? uniq([...cur, m]) : cur.filter(x => x !== m);
    if (!nextModes.length) nextModes = [currentMode];

    updateData((next, ctx) => {
      const list = getModeItems_(next.data, ctx.mode);
      const i = findIndexById(list, cleanId);
      if (i < 0) return;

      list[i] = { ...list[i], modes: nextModes };
      setModeItems_(next.data, ctx.mode, list);
      setCompletedFlag_(next.data, ctx.mode, false);
    });

    if (willAdd) assignItemToModes(cleanId, [m], { keepDone: false, silent: true, fromMode: currentMode });

    safeToast('Listas actualizadas ✅');
    safeHaptic(8);
    return { ok: true, modes: nextModes };
  }

  /* =========================
     MODE CRUD
  ========================= */

  function createMode(nameOrPayload, maybePayload = {}) {
    const payload = isPlainObject(nameOrPayload)
      ? nameOrPayload
      : { name: nameOrPayload, ...(isPlainObject(maybePayload) ? maybePayload : {}) };

    const cleanName = ensureString(payload?.name || payload?.label || '', 60);
    const cleanIcon = normalizeEmoji(payload?.icon);
    const requestedKey = ensureString(payload?.key || '', 60);

    if (!cleanName) {
      safeToast('Ponle nombre a la lista 🙃');
      safeHaptic(18);
      return { ok: false, reason: 'EMPTY_NAME' };
    }

    let createdKey = '';
    let createdMeta = null;

    updateData((next) => {
      next.data = ensureDataShape_(next.data, getActiveMode(next));

      const baseKey = slugifyModeKey(requestedKey || cleanName);
      let finalKey = baseKey;
      let n = 2;

      while (next.data.modes?.[finalKey] || next.data.itemsByMode?.[finalKey]) {
        finalKey = `${baseKey}-${n++}`;
      }

      ensureModeInitialized_(next.data, finalKey);
      createdMeta = ensureModeMeta_(next.data, finalKey, {
        name: cleanName,
        label: `🧳 ${cleanName}`,
        icon: cleanIcon,
        createdAt: nowIso(),
        updatedAt: nowIso()
      });

      createdKey = finalKey;
      next.data.mode = finalKey;
    });

    updateSettings((next) => {
      next.settings.tripMode = createdKey || next.settings.tripMode || 'salida';
    });

    safeToast('Lista creada ✅');
    safeHaptic(12);
    return { ok: true, modeKey: createdKey, mode: createdMeta };
  }

  function renameMode(modeKey, newName) {
    const key = slugifyModeKey(modeKey);
    const cleanName = ensureString(newName, 60);

    if (!key) return { ok: false, reason: 'BAD_MODE' };
    if (!cleanName) {
      safeToast('Ponle nombre a la lista 🙃');
      safeHaptic(18);
      return { ok: false, reason: 'EMPTY_NAME' };
    }

    let ok = false;

    updateData((next) => {
      next.data = ensureDataShape_(next.data, getActiveMode(next));
      if (!next.data.modes?.[key]) return;

      next.data.modes[key] = repairModeMeta_(key, {
        ...next.data.modes[key],
        name: cleanName,
        label: `🧳 ${cleanName}`,
        updatedAt: nowIso()
      });

      ok = true;
    });

    if (!ok) return { ok: false, reason: 'NOT_FOUND' };

    safeToast('Lista actualizada ✨');
    safeHaptic(10);
    return { ok: true, modeKey: key };
  }

  function updateMode(modeKey, payload = {}) {
    const key = slugifyModeKey(modeKey);
    if (!key) return { ok: false, reason: 'BAD_MODE' };

    const cleanName = payload?.name != null ? ensureString(payload.name, 60) : undefined;
    const cleanLabel = payload?.label != null ? ensureString(payload.label, 60) : undefined;
    const cleanIcon = payload?.icon !== undefined ? normalizeEmoji(payload.icon) : undefined;

    if (payload?.name !== undefined && !cleanName) {
      safeToast('Ponle nombre a la lista 🙃');
      safeHaptic(18);
      return { ok: false, reason: 'EMPTY_NAME' };
    }

    let ok = false;
    let meta = null;

    updateData((next) => {
      next.data = ensureDataShape_(next.data, getActiveMode(next));
      if (!next.data.modes?.[key]) return;

      const prev = next.data.modes[key];
      meta = repairModeMeta_(key, {
        ...prev,
        ...(cleanName !== undefined ? { name: cleanName, label: `🧳 ${cleanName}` } : {}),
        ...(cleanLabel !== undefined ? { label: cleanLabel } : {}),
        ...(cleanIcon !== undefined ? { icon: cleanIcon } : {}),
        updatedAt: nowIso()
      });

      next.data.modes[key] = meta;
      ok = true;
    });

    if (!ok) return { ok: false, reason: 'NOT_FOUND' };

    safeToast('Lista actualizada ✨');
    safeHaptic(10);
    return { ok: true, modeKey: key, mode: meta };
  }

  function duplicateMode(modeKey, newName) {
    const key = slugifyModeKey(modeKey);
    const requestedName = ensureString(newName, 60);

    if (!key) return { ok: false, reason: 'BAD_MODE' };

    const s = snap();
    const shaped = ensureDataShape_(s.data, getActiveMode(s));
    const sourceMeta = shaped.modes?.[key];
    const sourceItems = getModeItems_(shaped, key);
    const sourceCats = getModeCats_(shaped, key);

    if (!sourceMeta) return { ok: false, reason: 'NOT_FOUND' };

    const baseName = requestedName || `${stripLeadingEmoji(sourceMeta.label || sourceMeta.name || key)} copia`;
    let createdKey = '';
    let createdMeta = null;

    updateData((next) => {
      next.data = ensureDataShape_(next.data, getActiveMode(next));

      const baseKey = slugifyModeKey(baseName);
      let finalKey = baseKey;
      let n = 2;

      while (next.data.modes?.[finalKey] || next.data.itemsByMode?.[finalKey]) {
        finalKey = `${baseKey}-${n++}`;
      }

      ensureModeInitialized_(next.data, finalKey);

      const clonedItems = sourceItems.map(it => ({
        ...repairItem_(it),
        id: makeId(),
        done: false,
        originId: it.originId || it.id
      }));

      const clonedCats = sourceCats.map(c => ({ ...repairCat_(c) }));

      setModeItems_(next.data, finalKey, clonedItems);
      setModeCats_(next.data, finalKey, ensureCatsContainOtros_(clonedCats));

      createdMeta = ensureModeMeta_(next.data, finalKey, {
        name: baseName,
        label: `🧳 ${baseName}`,
        icon: sourceMeta.icon || null,
        createdAt: nowIso(),
        updatedAt: nowIso()
      });

      setCompletedFlag_(next.data, finalKey, false);
      createdKey = finalKey;
    });

    safeToast('Lista duplicada ✅');
    safeHaptic(12);
    return { ok: true, modeKey: createdKey, mode: createdMeta };
  }

  function deleteMode(modeKey) {
    const key = slugifyModeKey(modeKey);
    if (!key) return { ok: false, reason: 'BAD_MODE' };

    const s = snap();
    const shaped = ensureDataShape_(s.data, getActiveMode(s));

    if (!shaped.modes?.[key]) return { ok: false, reason: 'NOT_FOUND' };
    if (!canDeleteMode_(shaped, key)) {
      safeToast('Debe quedar al menos una lista 😑');
      safeHaptic(16);
      return { ok: false, reason: 'LAST_MODE' };
    }

    const fallbackMode =
      Object.keys(shaped.modes).find(m => m !== key) ||
      Object.keys(shaped.itemsByMode || {}).find(m => m !== key) ||
      'salida';

    updateData((next) => {
      next.data = ensureDataShape_(next.data, getActiveMode(next));

      delete next.data.itemsByMode[key];
      delete next.data.catsByMode[key];
      delete next.data.modes[key];
      if (isPlainObject(next.data.completedOnceByMode)) delete next.data.completedOnceByMode[key];
      if (isPlainObject(next.data.__completedOnceByMode)) delete next.data.__completedOnceByMode[key];

      if (next.data.mode === key) {
        next.data.mode = fallbackMode;
      }

      ensureModeInitialized_(next.data, next.data.mode || fallbackMode);
    });

    updateSettings((next) => {
      if (next.settings?.tripMode === key) {
        next.settings.tripMode = fallbackMode;
      }
    });

    safeToast('Lista eliminada 🗑️');
    safeHaptic(12);
    return { ok: true, modeKey: key, fallbackMode };
  }

  function openModeEditor(modeKey) {
    const key = slugifyModeKey(modeKey || getActiveMode(snap()));
    const s = snap();
    const shaped = ensureDataShape_(s.data, getActiveMode(s));
    const meta = shaped.modes?.[key] || null;

    if (!meta) return { ok: false, reason: 'NOT_FOUND' };

    return {
      ok: true,
      modeKey: key,
      mode: { ...meta },
      itemsCount: getModeItems_(shaped, key).length
    };
  }

  /* =========================
     MODE SWITCH
  ========================= */

  function changeMode(mode) {
    const m = slugifyModeKey(mode || 'salida') || 'salida';

    commitState((s) => {
      const next = { ...s };
      next.data = ensureDataShape_(s.data, m);
      ensureModeInitialized_(next.data, m);
      next.data.mode = m;
      next.activeCat = 'all';
      next.settings = {
        ...(s.settings || {}),
        tripMode: m
      };
      return next;
    });

    saveSettings();
    saveData();
    return { ok: true, modeKey: m };
  }

  /* =========================
     SETTINGS HELPERS
  ========================= */

  function setMotion(value) {
    updateSettings((next) => {
      next.settings.motion = !!value;
    });
    return { ok: true, value: !!value };
  }

  function setSound(value) {
    updateSettings((next) => {
      next.settings.sound = !!value;
    });
    return { ok: true, value: !!value };
  }

  /* =========================
     WIPE
  ========================= */

  function wipeAll() {
    const baseMode = 'salida';
    const preset = newPreset(baseMode) || {};
    const fresh = ensureDataShape_(preset, baseMode);

    ensureModeInitialized_(fresh, baseMode);
    fresh.mode = baseMode;

    commitState((s) => ({
      ...s,
      activeCat: 'all',
      settings: {
        tripMode: baseMode,
        motion: true,
        sound: true,
        streak: 0
      },
      data: fresh
    }));

    saveSettings();
    saveData();

    safeToast('Todo borrado. Nueva vida, supongo 🧼');
    safeHaptic(14);
    return { ok: true };
  }

  /* =========================
     COMPLETION
  ========================= */

  function onCompletedOnce() {
    const s = snap();
    const mode = getActiveMode(s);
    const data = ensureDataShape_(s.data, mode);
    const items = getModeItems_(data, mode);

    if (!items.length) return { ok: false, reason: 'EMPTY' };

    const done = items.reduce((acc, it) => acc + (it?.done ? 1 : 0), 0);
    const total = items.length;

    if (!total || done !== total) return { ok: false, reason: 'NOT_COMPLETE' };
    if (getCompletedFlag_(data, mode)) return { ok: false, reason: 'ALREADY' };

    updateData((next) => {
      setCompletedFlag_(next.data, mode, true);
    });

    updateSettings((next) => {
      next.settings.streak = (next.settings.streak || 0) + 1;
    });

    if (s?.settings?.motion) safeConfetti();
    safeToast('Checklist completo. Qué adulto responsable ✨');
    safeHaptic(12);

    return { ok: true };
  }

  return {
    // core
    toggleDone,
    deleteItem,
    resetChecks,
    setAll,
    createItem,

    // item ops
    editItem,
    moveItem,
    duplicateItem,

    // item modes
    assignItemToModes,
    setItemModes,
    toggleItemMode,

    // mode ops
    changeMode,
    createMode,
    renameMode,
    updateMode,
    deleteMode,
    duplicateMode,
    openModeEditor,

    // settings helpers
    setMotion,
    setSound,

    // destructive
    wipeAll,

    // completion
    onCompletedOnce,

    // tiny helpers
    _util: {
      ensureString,
      normalizeEmoji,
      uniq,
      slugifyModeKey,
      slugifyCatKey,
      shallowClone
    }
  };
}