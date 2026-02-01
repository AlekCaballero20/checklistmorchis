/* =============================================================================
  /src/storage.js — Local-first storage + migrations
  - loadSettings / saveSettings
  - loadData / saveData
  - validate + repair
  - basic migration to version 2
  - debounced savers
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
export function createStorage(cfg){
  const {
    storageKey = 'maleta_pwa_v2_data',
    settingsKey = 'maleta_pwa_v2_settings',
    defaultSettings,
    newPreset,
    uid
  } = cfg;

  function loadSettings(){
    try{
      const raw = localStorage.getItem(settingsKey);
      const parsed = raw ? JSON.parse(raw) : {};
      return sanitizeSettings({ ...defaultSettings, ...parsed });
    }catch{
      return sanitizeSettings({ ...defaultSettings });
    }
  }

  function saveSettings(settings){
    try{
      localStorage.setItem(settingsKey, JSON.stringify(sanitizeSettings(settings)));
    }catch{}
  }

  function loadData(settingsOrMode){
    const mode = typeof settingsOrMode === 'string'
      ? settingsOrMode
      : (settingsOrMode?.tripMode || defaultSettings.tripMode);

    try{
      const raw = localStorage.getItem(storageKey);
      if (!raw) return newPreset(mode);

      const parsed = JSON.parse(raw);
      const repaired = repairData(parsed, mode);
      return repaired;
    }catch{
      return newPreset(mode);
    }
  }

  function saveData(data){
    try{
      localStorage.setItem(storageKey, JSON.stringify(repairData(data, data?.mode || defaultSettings.tripMode)));
    }catch{}
  }

  function wipeAllStorage(){
    try{ localStorage.removeItem(storageKey); }catch{}
    try{ localStorage.removeItem(settingsKey); }catch{}
  }

  /* =========================
     Debounced savers
  ========================= */

  function createDebouncedSavers(wait = 220){
    const debSaveSettings = debounce((settings) => saveSettings(settings), wait);
    const debSaveData = debounce((data) => saveData(data), wait);

    return {
      saveSettingsDebounced: debSaveSettings,
      saveDataDebounced: debSaveData
    };
  }

  /* =========================
     Helpers: migrations/repair
  ========================= */

  function sanitizeSettings(s){
    const out = { ...defaultSettings, ...(s || {}) };

    out.tripMode = String(out.tripMode || defaultSettings.tripMode);
    out.motion = !!out.motion;
    out.sound = !!out.sound;

    // streak should be non-negative int
    out.streak = clampInt(out.streak, 0, 999999);

    return out;
  }

  function repairData(d, fallbackMode){
    // If it's not even an object, restart
    if (!d || typeof d !== 'object') return newPreset(fallbackMode);

    // Ensure core shape
    const mode = String(d.mode || fallbackMode || defaultSettings.tripMode);
    const out = {
      version: 2,
      mode,
      cats: Array.isArray(d.cats) ? d.cats.map(repairCat) : null,
      items: Array.isArray(d.items) ? d.items.map(repairItem) : null,
      __completedOnce: !!d.__completedOnce
    };

    // If missing cats/items, regenerate preset for this mode
    if (!out.cats || !out.items) return newPreset(mode);

    // Ensure at least 1 cat; if empty, regenerate
    if (!out.cats.length) return newPreset(mode);

    // Ensure items cat ids exist; if not, push to 'otros' or first cat
    const catIds = new Set(out.cats.map(c => c.id));
    const fallbackCat = catIds.has('otros') ? 'otros' : out.cats[0].id;

    out.items = out.items.map(it => {
      if (!catIds.has(it.cat)) it.cat = fallbackCat;
      return it;
    });

    // Ensure unique IDs
    const seen = new Set();
    out.items.forEach(it => {
      if (!it.id || seen.has(it.id)){
        it.id = makeId();
      }
      seen.add(it.id);
    });

    return out;
  }

  function repairCat(c){
    const id = String(c?.id || 'otros').trim() || 'otros';
    const name = String(c?.name || 'Otros').trim() || 'Otros';
    const emoji = c?.emoji ? String(c.emoji).slice(0, 4) : null;
    return { id, name, emoji };
  }

  function repairItem(it){
    return {
      id: String(it?.id || makeId()),
      cat: String(it?.cat || 'otros'),
      name: String(it?.name || 'Sin nombre').slice(0, 80),
      emoji: it?.emoji ? String(it.emoji).slice(0, 4) : null,
      done: !!it?.done
    };
  }

  function makeId(){
    if (typeof uid === 'function') return String(uid());
    return Math.random().toString(16).slice(2) + Date.now().toString(16);
  }

  return {
    loadSettings,
    saveSettings,
    loadData,
    saveData,
    wipeAllStorage,
    createDebouncedSavers
  };
}

/* =========================
   UTIL
========================= */

function debounce(fn, wait = 200){
  let t = null;
  return function(...args){
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

function clampInt(v, min, max){
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  const i = Math.floor(n);
  return Math.min(max, Math.max(min, i));
}
