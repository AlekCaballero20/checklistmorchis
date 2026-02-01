/* =============================================================================
  /src/actions.js — App actions (domain logic)
  - No DOM manipulation inside (pure-ish actions)
  - Talks to storage + fx via injected deps
  - Returns actions used by UI layer (app.js)
============================================================================= */

'use strict';

/**
 * Factory: createActions
 * @param {Object} params
 * @param {Function} params.getState   () => state
 * @param {Function} params.setState   (partial | updaterFn) => void
 * @param {Object} params.deps
 * @param {Function} params.deps.presetFor (mode) => preset
 * @param {Function} params.deps.newPreset (mode) => data shape
 * @param {Function} params.deps.saveSettings () => void (debounced ok)
 * @param {Function} params.deps.saveData () => void (debounced ok)
 * @param {Function} params.deps.toast (msg) => void
 * @param {Function} params.deps.haptic (ms) => void
 * @param {Function} params.deps.tickSound () => void
 * @param {Function} params.deps.confetti () => void
 * @param {Function} params.deps.copyText (text) => Promise<void>
 */
export function createActions({ getState, setState, deps = {} }){
  // Defensive deps (so missing fx methods don't crash the app)
  const presetFor   = deps.presetFor   || ((m) => ({ label: String(m || '🧳') }));
  const newPreset   = deps.newPreset   || ((m) => ({ version:2, mode:m, cats:[], items:[], __completedOnce:false }));
  const saveSettings = deps.saveSettings || (() => {});
  const saveData     = deps.saveData     || (() => {});
  const toast       = typeof deps.toast === 'function' ? deps.toast : null;
  const haptic      = typeof deps.haptic === 'function' ? deps.haptic : null;
  const tickSound   = typeof deps.tickSound === 'function' ? deps.tickSound : null;
  const confetti    = typeof deps.confetti === 'function' ? deps.confetti : null;
  const copyText    = typeof deps.copyText === 'function' ? deps.copyText : null;

  /* =========================
     MUTATION HELPERS
  ========================= */

  function updateData(mutator){
    setState((s) => {
      const next = { ...s, data: { ...(s.data || {}) } };
      next.data.items = Array.isArray(next.data.items) ? [...next.data.items] : [];
      next.data.cats  = Array.isArray(next.data.cats)  ? [...next.data.cats]  : [];
      mutator(next);
      return next;
    });
    saveData();
  }

  function updateSettings(mutator){
    setState((s) => {
      const next = { ...s, settings: { ...(s.settings || {}) } };
      mutator(next);
      return next;
    });
    saveSettings();
  }

  /* =========================
     SAFE FX HELPERS
  ========================= */

  function safeToast(msg){
    try{ toast?.(msg); }catch{}
  }
  function safeHaptic(ms){
    try{ haptic?.(ms); }catch{}
  }
  function safeTick(){
    try{ tickSound?.(); }catch{}
  }

  /* =========================
     SMALL UTILS
  ========================= */

  function ensureString(v, maxLen = 80){
    const s = String(v ?? '').trim();
    return maxLen ? s.slice(0, maxLen) : s;
  }

  function normalizeEmoji(v){
    // Keep it small (emojis can be multi-codepoint; we just cap chars)
    const e = ensureString(v, 4);
    return e || null;
  }

  function makeId(uid){
    if (typeof uid === 'function') return String(uid());
    return Math.random().toString(16).slice(2) + Date.now().toString(16);
  }

  function getSnapshot(){
    try{ return getState(); }catch{ return {}; }
  }

  /* =========================
     ACTIONS
  ========================= */

  function toggleDone(id){
    const cleanId = ensureString(id, 120);
    if (!cleanId) return;

    updateData((next) => {
      const it = next.data.items.find(x => x.id === cleanId);
      if (!it) return;
      it.done = !it.done;
      next.data.__completedOnce = false;
    });

    const s = getSnapshot();
    if (s?.settings?.sound) safeTick();
    safeHaptic(12);
  }

  function deleteItem(id){
    const cleanId = ensureString(id, 120);
    if (!cleanId) return;

    updateData((next) => {
      next.data.items = next.data.items.filter(x => x.id !== cleanId);
      next.data.__completedOnce = false;
    });

    safeToast('Item eliminado 🗑️');
    safeHaptic(10);
  }

  function resetChecks(){
    updateData((next) => {
      next.data.items.forEach(i => { i.done = false; });
      next.data.__completedOnce = false;
    });

    safeToast('Checklist reiniciado ↺');
    safeHaptic(12);
  }

  function setAll(done){
    updateData((next) => {
      next.data.items.forEach(i => { i.done = !!done; });
      next.data.__completedOnce = false;
    });

    safeToast(done ? 'Todo marcado ✅' : 'Todo desmarcado ⬜');
    safeHaptic(14);
  }

  function createItem({ name, emoji = null, cat = 'otros', uid } = {}){
    const cleanName = ensureString(name, 60);
    const cleanEmoji = normalizeEmoji(emoji);
    const cleanCat = ensureString(cat, 40) || 'otros';

    if (!cleanName){
      safeToast('Ponle nombre al item 🙃');
      safeHaptic(18);
      return { ok:false, reason:'EMPTY_NAME' };
    }

    updateData((next) => {
      next.data.items.unshift({
        id: makeId(uid),
        cat: cleanCat,
        name: cleanName,
        emoji: cleanEmoji,
        done: false
      });
      next.data.__completedOnce = false;
    });

    safeToast('Agregado ✅');
    safeHaptic(12);
    return { ok:true };
  }

  function changeMode(mode){
    const m = ensureString(mode, 24) || 'salida';

    // Update settings first
    updateSettings((next) => {
      next.settings.tripMode = m;
    });

    // Swap dataset to fresh preset
    setState((s) => ({
      ...s,
      activeCat: 'all',
      data: newPreset(m)
    }));
    saveData();

    safeToast('Modo cambiado ✅');
    safeHaptic(12);
  }

  function wipeAll(){
    // Reset state; UI may additionally clear localStorage via storage.wipeAllStorage()
    setState((s) => ({
      ...s,
      activeCat: 'all',
      settings: {
        tripMode: 'salida',
        motion: true,
        sound: true,
        streak: 0
      },
      data: newPreset('salida')
    }));
    saveSettings();
    saveData();

    safeToast('Todo borrado. Nueva vida, supongo 🧼');
    safeHaptic(14);
  }

  async function shareList(){
    const s = getSnapshot();
    const items = Array.isArray(s?.data?.items) ? s.data.items : [];
    const cats  = Array.isArray(s?.data?.cats) ? s.data.cats : [];
    const p = presetFor(s?.settings?.tripMode);

    // Group by category for nicer share output
    const byCat = new Map();
    for (const it of items){
      const key = it.cat || 'otros';
      if (!byCat.has(key)) byCat.set(key, []);
      byCat.get(key).push(it);
    }

    function catLabel(catId){
      const c = cats.find(x => x.id === catId);
      if (!c) return `🏷️ ${catId}`;
      return `${c.emoji ? c.emoji + ' ' : ''}${c.name}`;
    }

    const blocks = [];
    for (const [catId, arr] of byCat.entries()){
      const lines = arr.map(i => `${i.done ? '✅' : '⬜'} ${i.emoji ? i.emoji + ' ' : ''}${ensureString(i.name, 80)}`);
      blocks.push(`${catLabel(catId)}\n${lines.join('\n')}`);
    }

    const titleLine = `${p?.label || '🧳'} · Checklist`;
    const text = `${titleLine}\n\n${blocks.join('\n\n')}`.trim();

    try{
      if (navigator.share){
        await navigator.share({ title: 'Maleta · Checklist', text });
        safeToast('Compartido 📤');
      } else {
        if (!copyText) throw new Error('NO_COPYTEXT');
        await copyText(text);
        safeToast('Copiado al portapapeles 📋');
      }
      safeHaptic(10);
      return { ok:true };
    }catch{
      try{
        if (!copyText) throw new Error('NO_COPYTEXT');
        await copyText(text);
        safeToast('Copiado 📋');
        return { ok:true, fallback:true };
      }catch{
        safeToast('No se pudo compartir. La vida insiste 🙄');
        return { ok:false };
      }
    }
  }

  /**
   * Optional helper (if you ever want completion logic centralized here)
   * Currently app.js handles completion to control glow/confetti timing.
   */
  function onCompletedOnce(){
    const s = getSnapshot();
    if (!Array.isArray(s?.data?.items) || !s.data.items.length) return;

    const done = s.data.items.filter(i => i.done).length;
    const total = s.data.items.length;
    if (!total || done !== total) return;
    if (s.data.__completedOnce) return;

    updateData((next) => { next.data.__completedOnce = true; });

    updateSettings((next) => {
      next.settings.streak = (next.settings.streak || 0) + 1;
    });

    if (s?.settings?.motion) {
      try{ confetti?.(); }catch{}
    }
    safeToast('Checklist completo. Qué adulto responsable ✨');
  }

  return {
    toggleDone,
    deleteItem,
    resetChecks,
    setAll,
    createItem,
    changeMode,
    wipeAll,
    shareList,
    onCompletedOnce
  };
}
