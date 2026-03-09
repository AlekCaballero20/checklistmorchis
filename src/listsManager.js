/* =============================================================================
  /src/listsManager.js — Multi-mode list helpers — PRO v1.0
  - ✅ Sin DOM
  - ✅ Compatibilidad con data legacy
  - ✅ Normaliza:
      data.items                -> data.itemsByMode[activeMode]
      data.__completedOnce      -> data.__completedOnceByMode[activeMode]
  - ✅ Gestiona:
      modos
      items por modo
      metadatos de modos
      flags de completado
  - ✅ Listo para usarse desde app.js / render.js / actions.js
============================================================================= */

'use strict';

/* =========================
   Small utils
========================= */

function ensureString(v, maxLen = 80){
  const s = String(v ?? '').trim();
  return maxLen ? s.slice(0, maxLen) : s;
}

function isPlainObject(v){
  return v != null && typeof v === 'object' &&
    (v.constructor === Object || Object.getPrototypeOf(v) === Object.prototype);
}

function uniq(arr){
  const out = [];
  const seen = new Set();

  for (const x of arr || []){
    const k = String(x || '').trim();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }

  return out;
}

function slugifyModeKey(v){
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

function normalizeEmoji(v){
  const e = ensureString(v, 8);
  return e ? e : null;
}

function makeId(){
  return `${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
}

function nowIso(){
  try { return new Date().toISOString(); }
  catch { return ''; }
}

/* =========================
   Repair helpers
========================= */

function repairCat(cat){
  if (typeof cat === 'string'){
    return {
      key: ensureString(cat, 40) || 'otros',
      label: ensureString(cat, 60) || 'Otros'
    };
  }

  if (isPlainObject(cat)){
    return {
      ...cat,
      key: ensureString(cat.key || cat.id || cat.slug || cat.name || 'otros', 40) || 'otros',
      label: ensureString(cat.label || cat.name || cat.key || 'Otros', 60) || 'Otros'
    };
  }

  return {
    key: 'otros',
    label: 'Otros'
  };
}

function repairItem(it){
  return {
    id: ensureString(it?.id || makeId(), 140),
    cat: ensureString(it?.cat || 'otros', 40) || 'otros',
    name: ensureString(it?.name || 'Sin nombre', 60) || 'Sin nombre',
    emoji: it?.emoji ? normalizeEmoji(it.emoji) : null,
    done: !!it?.done,
    modes: Array.isArray(it?.modes) ? uniq(it.modes.map(x => ensureString(x, 24)).filter(Boolean)) : null,
    originId: it?.originId ? ensureString(it.originId, 140) : null
  };
}

function repairModeMeta(key, meta = {}){
  const fixedKey = slugifyModeKey(key || meta?.key || meta?.name || 'salida');
  const label = ensureString(meta?.label || meta?.name || fixedKey, 60) || fixedKey;

  return {
    key: fixedKey,
    name: label,
    label,
    icon: normalizeEmoji(meta?.icon),
    createdAt: ensureString(meta?.createdAt || '', 40) || nowIso(),
    updatedAt: ensureString(meta?.updatedAt || '', 40) || nowIso()
  };
}

/* =========================
   Core normalization
========================= */

export function getActiveModeFromState(state){
  return String(state?.settings?.tripMode || state?.data?.mode || 'salida');
}

export function ensureDataShape(data, activeMode = 'salida'){
  const mode = slugifyModeKey(data?.mode || activeMode || 'salida');

  const cats = Array.isArray(data?.cats)
    ? data.cats.map(repairCat)
    : [];

  let itemsByMode = {};
  let completedByMode = {};

  if (isPlainObject(data?.itemsByMode)){
    for (const [mk, arr] of Object.entries(data.itemsByMode)){
      itemsByMode[String(mk)] = Array.isArray(arr) ? arr.map(repairItem) : [];
    }
    completedByMode = isPlainObject(data?.__completedOnceByMode)
      ? { ...data.__completedOnceByMode }
      : {};
  } else {
    const legacyItems = Array.isArray(data?.items) ? data.items.map(repairItem) : [];
    itemsByMode = { [mode]: legacyItems };
    completedByMode = { [mode]: !!data?.__completedOnce };
  }

  if (!Array.isArray(itemsByMode[mode])){
    itemsByMode[mode] = [];
  }

  const modes = ensureModesMap({
    ...data,
    mode,
    itemsByMode
  }, mode);

  return {
    version: 3,
    mode,
    cats,
    itemsByMode,
    modes,
    __completedOnceByMode: { ...completedByMode }
  };
}

export function ensureModesMap(data, activeMode = 'salida'){
  const currentMode = slugifyModeKey(data?.mode || activeMode || 'salida');
  const raw = isPlainObject(data?.modes) ? data.modes : {};
  const out = {};

  for (const [k, v] of Object.entries(raw)){
    const meta = repairModeMeta(k, v);
    out[meta.key] = meta;
  }

  const itemModes = isPlainObject(data?.itemsByMode) ? Object.keys(data.itemsByMode) : [];
  const keys = uniq([currentMode, ...itemModes, ...Object.keys(out)]);

  for (const k of keys){
    if (!out[k]){
      out[k] = repairModeMeta(k, { name: k, label: k });
    }
  }

  return out;
}

export function ensureModeInitialized(data, mode){
  const shaped = ensureDataShape(data, mode);
  const m = slugifyModeKey(mode || shaped.mode || 'salida');

  if (!Array.isArray(shaped.itemsByMode[m])){
    shaped.itemsByMode[m] = [];
  }

  if (!isPlainObject(shaped.__completedOnceByMode)){
    shaped.__completedOnceByMode = {};
  }

  if (!(m in shaped.__completedOnceByMode)){
    shaped.__completedOnceByMode[m] = false;
  }

  if (!isPlainObject(shaped.modes)){
    shaped.modes = {};
  }

  if (!shaped.modes[m]){
    shaped.modes[m] = repairModeMeta(m, { name: m, label: m });
  }

  shaped.mode = m;
  return shaped;
}

/* =========================
   Getters
========================= */

export function getModeKeys(data){
  const shaped = ensureDataShape(data);
  return Object.keys(shaped.modes || {});
}

export function getModesList(data){
  const shaped = ensureDataShape(data);
  return getModeKeys(shaped).map(key => shaped.modes[key]);
}

export function getModeMeta(data, mode){
  const shaped = ensureDataShape(data, mode);
  const key = slugifyModeKey(mode || shaped.mode);
  return shaped.modes?.[key] || null;
}

export function getModeItems(data, mode){
  const shaped = ensureDataShape(data, mode);
  const key = slugifyModeKey(mode || shaped.mode);
  return Array.isArray(shaped.itemsByMode?.[key]) ? shaped.itemsByMode[key] : [];
}

export function getCompletedFlag(data, mode){
  const shaped = ensureDataShape(data, mode);
  const key = slugifyModeKey(mode || shaped.mode);
  return !!shaped.__completedOnceByMode?.[key];
}

export function getCats(data){
  const shaped = ensureDataShape(data);
  return Array.isArray(shaped.cats) ? shaped.cats : [];
}

export function getCatsForMode(data, mode){
  const items = getModeItems(data, mode);
  const explicitCats = getCats(data);

  const fromItems = uniq(items.map(it => ensureString(it?.cat, 40)).filter(Boolean))
    .map(key => ({ key, label: key }));

  const merged = [...explicitCats, ...fromItems];
  const seen = new Set();

  return merged.filter(cat => {
    const key = ensureString(cat?.key || cat?.label, 40);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function findItemById(data, mode, id){
  const items = getModeItems(data, mode);
  const cleanId = ensureString(id, 140);
  if (!cleanId) return null;
  return items.find(it => it?.id === cleanId) || null;
}

export function findItemIndexById(data, mode, id){
  const items = getModeItems(data, mode);
  const cleanId = ensureString(id, 140);
  if (!cleanId) return -1;
  return items.findIndex(it => it?.id === cleanId);
}

export function getModeSummary(data, mode){
  const items = getModeItems(data, mode);
  const total = items.length;
  const done = items.reduce((acc, it) => acc + (it?.done ? 1 : 0), 0);
  const pending = Math.max(0, total - done);
  const pct = total ? Math.round((done / total) * 100) : 0;

  return {
    mode: slugifyModeKey(mode || ensureDataShape(data).mode),
    total,
    done,
    pending,
    pct,
    isComplete: total > 0 && done === total
  };
}

export function getAllModesSummary(data){
  const shaped = ensureDataShape(data);
  return getModeKeys(shaped).map(mode => ({
    ...getModeSummary(shaped, mode),
    meta: getModeMeta(shaped, mode)
  }));
}

/* =========================
   Immutable writers
========================= */

export function setModeItems(data, mode, items){
  const shaped = ensureModeInitialized(data, mode);
  const key = slugifyModeKey(mode || shaped.mode);

  return {
    ...shaped,
    itemsByMode: {
      ...shaped.itemsByMode,
      [key]: Array.isArray(items) ? items.map(repairItem) : []
    },
    modes: {
      ...shaped.modes,
      [key]: {
        ...repairModeMeta(key, shaped.modes?.[key] || { name: key, label: key }),
        updatedAt: nowIso()
      }
    }
  };
}

export function setCompletedFlag(data, mode, value){
  const shaped = ensureModeInitialized(data, mode);
  const key = slugifyModeKey(mode || shaped.mode);

  return {
    ...shaped,
    __completedOnceByMode: {
      ...shaped.__completedOnceByMode,
      [key]: !!value
    }
  };
}

export function setModeMeta(data, mode, patch = {}){
  const shaped = ensureModeInitialized(data, mode);
  const key = slugifyModeKey(mode || shaped.mode);
  const prev = shaped.modes?.[key] || repairModeMeta(key, { name: key, label: key });

  return {
    ...shaped,
    modes: {
      ...shaped.modes,
      [key]: repairModeMeta(key, {
        ...prev,
        ...patch,
        updatedAt: nowIso()
      })
    }
  };
}

export function addMode(data, payload = {}){
  const shaped = ensureDataShape(data);
  const cleanName = ensureString(payload?.name || payload?.label || '', 60);
  const icon = normalizeEmoji(payload?.icon);
  const requestedKey = ensureString(payload?.key || '', 60);

  if (!cleanName){
    return { ok:false, reason:'EMPTY_NAME', data: shaped };
  }

  const baseKey = slugifyModeKey(requestedKey || cleanName);
  let finalKey = baseKey;
  let n = 2;

  while (shaped.modes?.[finalKey] || shaped.itemsByMode?.[finalKey]){
    finalKey = `${baseKey}-${n++}`;
  }

  const next = ensureModeInitialized({
    ...shaped,
    mode: finalKey,
    modes: {
      ...shaped.modes,
      [finalKey]: repairModeMeta(finalKey, {
        name: cleanName,
        label: cleanName,
        icon,
        createdAt: nowIso(),
        updatedAt: nowIso()
      })
    }
  }, finalKey);

  return {
    ok: true,
    modeKey: finalKey,
    data: next
  };
}

export function updateModeMeta(data, mode, patch = {}){
  const shaped = ensureModeInitialized(data, mode);
  const key = slugifyModeKey(mode || shaped.mode);

  if (!shaped.modes?.[key]){
    return { ok:false, reason:'NOT_FOUND', data: shaped };
  }

  const cleanName = patch?.name != null ? ensureString(patch.name, 60) : undefined;
  if (patch?.name !== undefined && !cleanName){
    return { ok:false, reason:'EMPTY_NAME', data: shaped };
  }

  const next = setModeMeta(shaped, key, {
    ...(cleanName !== undefined ? { name: cleanName, label: cleanName } : {}),
    ...(patch?.label !== undefined ? { label: ensureString(patch.label, 60) } : {}),
    ...(patch?.icon !== undefined ? { icon: normalizeEmoji(patch.icon) } : {})
  });

  return {
    ok: true,
    modeKey: key,
    data: next
  };
}

export function renameMode(data, mode, newName){
  return updateModeMeta(data, mode, { name: newName });
}

export function duplicateMode(data, mode, newName){
  const shaped = ensureModeInitialized(data, mode);
  const key = slugifyModeKey(mode || shaped.mode);

  if (!shaped.modes?.[key]){
    return { ok:false, reason:'NOT_FOUND', data: shaped };
  }

  const sourceMeta = shaped.modes[key];
  const sourceItems = getModeItems(shaped, key);
  const baseName = ensureString(newName, 60) || `${sourceMeta.label || sourceMeta.name || key} copia`;

  const created = addMode(shaped, {
    name: baseName,
    icon: sourceMeta.icon || null
  });

  if (!created?.ok){
    return created;
  }

  const clonedItems = sourceItems.map(it => ({
    ...repairItem(it),
    id: makeId(),
    done: false,
    originId: it?.originId || it?.id
  }));

  let next = setModeItems(created.data, created.modeKey, clonedItems);
  next = setCompletedFlag(next, created.modeKey, false);

  return {
    ok: true,
    modeKey: created.modeKey,
    data: next
  };
}

export function removeMode(data, mode, fallbackMode = null){
  const shaped = ensureDataShape(data, mode);
  const key = slugifyModeKey(mode || shaped.mode);
  const keys = getModeKeys(shaped);

  if (!shaped.modes?.[key]){
    return { ok:false, reason:'NOT_FOUND', data: shaped };
  }

  if (keys.length <= 1){
    return { ok:false, reason:'LAST_MODE', data: shaped };
  }

  const safeFallback =
    slugifyModeKey(
      fallbackMode ||
      keys.find(m => m !== key) ||
      'salida'
    );

  const nextModes = { ...shaped.modes };
  const nextItemsByMode = { ...shaped.itemsByMode };
  const nextCompleted = { ...shaped.__completedOnceByMode };

  delete nextModes[key];
  delete nextItemsByMode[key];
  delete nextCompleted[key];

  const next = ensureModeInitialized({
    ...shaped,
    mode: shaped.mode === key ? safeFallback : shaped.mode,
    modes: nextModes,
    itemsByMode: nextItemsByMode,
    __completedOnceByMode: nextCompleted
  }, shaped.mode === key ? safeFallback : shaped.mode);

  return {
    ok: true,
    removedMode: key,
    fallbackMode: next.mode,
    data: next
  };
}

/* =========================
   Factory opcional
========================= */

export function createListsManager({ getState, setState } = {}){
  function readState(){
    return getState?.() || {};
  }

  function writeData(nextData){
    if (typeof setState !== 'function') return;
    setState((prev) => ({
      ...prev,
      data: ensureDataShape(nextData, getActiveModeFromState(prev))
    }));
  }

  return {
    getData(){
      const state = readState();
      return ensureDataShape(state?.data, getActiveModeFromState(state));
    },

    getActiveMode(){
      const state = readState();
      return getActiveModeFromState(state);
    },

    getModes(){
      return getModesList(this.getData());
    },

    getItems(mode){
      return getModeItems(this.getData(), mode || this.getActiveMode());
    },

    getSummary(mode){
      return getModeSummary(this.getData(), mode || this.getActiveMode());
    },

    createMode(payload){
      const res = addMode(this.getData(), payload);
      if (res?.ok) writeData(res.data);
      return res;
    },

    updateMode(mode, patch){
      const res = updateModeMeta(this.getData(), mode, patch);
      if (res?.ok) writeData(res.data);
      return res;
    },

    renameMode(mode, newName){
      const res = renameMode(this.getData(), mode, newName);
      if (res?.ok) writeData(res.data);
      return res;
    },

    duplicateMode(mode, newName){
      const res = duplicateMode(this.getData(), mode, newName);
      if (res?.ok) writeData(res.data);
      return res;
    },

    removeMode(mode, fallbackMode){
      const res = removeMode(this.getData(), mode, fallbackMode);
      if (res?.ok) writeData(res.data);
      return res;
    },

    setItems(mode, items){
      const next = setModeItems(this.getData(), mode, items);
      writeData(next);
      return { ok:true, data: next };
    }
  };
}

/* =========================
   Tiny util export
========================= */

export const listsManagerUtil = {
  ensureString,
  normalizeEmoji,
  uniq,
  slugifyModeKey,
  repairItem,
  repairModeMeta
};