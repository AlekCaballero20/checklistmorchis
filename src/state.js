/* =============================================================================
  /src/state.js — Tiny state store (Vanilla) — PRO v3.1
  - getState / setState / replaceState
  - subscribe (pub/sub) with safe emit + unsubscribe safety
  - setState supports:
      ✅ setState(partialObj)  (top-level shallow merge)
      ✅ setState(fn) where fn(prev) => partialObj OR fullState (opt-in)
  - select(selector, onChange, equal?) to reduce re-renders
  - batch(fn): group multiple setState calls into a single emit
  - transaction(fn): like batch but returns fn result
  - Optional devFreeze to catch accidental mutations
  - Extras:
      ✅ reset() back to initial snapshot
      ✅ once(fn) subscribe-once
      ✅ notify() force emit (rare, but useful)
      ✅ setState(..., { replace:true }) to hard replace safely
============================================================================= */

'use strict';

export function createStore(initialState = {}, opts = {}){
  const {
    devFreeze = false,
    // If true: updater functions may return a FULL state replacement (plain object),
    // otherwise we merge by default (safer for evolving state shapes).
    allowFullReplaceFromUpdater = true,
  } = opts;

  const initialSnapshot = cloneState(initialState);

  let state = cloneState(initialSnapshot);
  if (devFreeze) deepFreezeSafe(state);

  const listeners = new Set();

  // batching
  let batchDepth = 0;
  let pendingPrev = null;
  let pendingNext = null;

  function getState(){
    return state;
  }

  /**
   * setState(update, options?)
   * - setState(partialObj)
   * - setState(updaterFn)
   * options:
   *   - { replace: true } -> hard replace state (like replaceState)
   */
  function setState(update, options = null){
    const prev = state;
    const next = computeNext(prev, update, options);

    if (next === prev) return;

    state = next;
    if (devFreeze) deepFreezeSafe(state);
    emit(prev, next);
  }

  /**
   * replaceState(nextState)
   * Hard replace of entire state object.
   */
  function replaceState(nextState){
    const prev = state;
    const next = cloneState(nextState || {});
    state = next;
    if (devFreeze) deepFreezeSafe(state);
    emit(prev, state);
  }

  /**
   * reset()
   * Reset back to the initial snapshot passed at creation time.
   */
  function reset(){
    replaceState(initialSnapshot);
  }

  /**
   * notify()
   * Force a re-emit using the same object reference (use sparingly).
   */
  function notify(){
    emit(state, state);
  }

  /**
   * subscribe(fn)
   * @param {(prev, next) => void} fn
   * @returns {() => void} unsubscribe
   */
  function subscribe(fn){
    if (typeof fn !== 'function') return () => {};
    listeners.add(fn);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      listeners.delete(fn);
    };
  }

  /**
   * once(fn)
   * Subscribe once (auto-unsub after first call).
   */
  function once(fn){
    if (typeof fn !== 'function') return () => {};
    const off = subscribe((prev, next) => {
      try{ fn(prev, next); }catch{}
      off();
    });
    return off;
  }

  /**
   * select(selector, onChange, equal?)
   * Subscribe to a slice of state; fires only when slice changes.
   * @param {(state) => any} selector
   * @param {(slice, prevSlice, nextState, prevState) => void} onChange
   * @param {(a,b) => boolean} [equal] equality function (default: Object.is)
   * @returns {() => void} unsubscribe
   */
  function select(selector, onChange, equal = Object.is){
    if (typeof selector !== 'function') return () => {};

    let prevSlice;
    try{ prevSlice = selector(state); }catch{ prevSlice = undefined; }

    return subscribe((prev, next) => {
      let nextSlice;
      try{ nextSlice = selector(next); }catch{ nextSlice = undefined; }

      if (!equal(prevSlice, nextSlice)){
        const old = prevSlice;
        prevSlice = nextSlice;
        try{ onChange?.(nextSlice, old, next, prev); }catch{}
      }
    });
  }

  /**
   * batch(fn)
   * Groups multiple setState/replaceState calls into one emit.
   */
  function batch(fn){
    transaction(fn);
  }

  /**
   * transaction(fn)
   * Like batch, but returns fn result.
   */
  function transaction(fn){
    if (typeof fn !== 'function') return;

    batchDepth++;
    try{
      return fn();
    } finally {
      batchDepth--;
      if (batchDepth === 0 && pendingPrev !== null && pendingNext !== null){
        const p = pendingPrev;
        const n = pendingNext;
        pendingPrev = null;
        pendingNext = null;

        // emit once
        for (const l of listeners){
          try{ l(p, n); }catch{}
        }
      }
    }
  }

  function emit(prev, next){
    if (batchDepth > 0){
      // store first prev, keep last next
      if (pendingPrev === null) pendingPrev = prev;
      pendingNext = next;
      return;
    }

    // Snapshot listeners to avoid issues if someone unsubscribes during emit
    const snapshot = Array.from(listeners);
    for (const fn of snapshot){
      if (!listeners.has(fn)) continue; // unsubbed mid-flight
      try{ fn(prev, next); } catch {}
    }
  }

  function computeNext(prev, update, options){
    const replace = !!(options && options.replace);

    // replace path
    if (replace){
      if (isPlainObject(update)) return cloneState(update);
      if (typeof update === 'function'){
        let out;
        try{ out = update(prev); }catch{ out = null; }
        return isPlainObject(out) ? cloneState(out) : prev;
      }
      return prev;
    }

    // merge path (default)
    let next = prev;

    if (typeof update === 'function'){
      let out;
      try{ out = update(prev); }catch{ out = null; }

      // Updater can return:
      // - partial merge (plain object)
      // - full replacement (plain object) if allowFullReplaceFromUpdater and out.__replace === true
      //   or if user passes {replace:true} which we already handled above.
      if (isPlainObject(out)){
        const wantsReplace = allowFullReplaceFromUpdater && out.__replace === true;
        if (wantsReplace){
          const copy = { ...out };
          delete copy.__replace;
          next = copy;
        } else {
          next = { ...prev, ...out };
        }
      } else {
        next = prev;
      }
    } else if (isPlainObject(update)){
      next = { ...prev, ...update };
    }

    if (next === prev) return prev;

    // If values identical top-level, skip
    if (shallowEqual(prev, next)) return prev;

    return next;
  }

  return {
    getState,
    setState,
    replaceState,
    reset,
    notify,
    subscribe,
    once,
    select,
    batch,
    transaction
  };
}

/* =========================
   HELPERS
========================= */

function isPlainObject(v){
  return v != null && typeof v === 'object' &&
    (v.constructor === Object || Object.getPrototypeOf(v) === Object.prototype);
}

function cloneState(obj){
  // Enough for our JSON-ish state.
  try{
    return JSON.parse(JSON.stringify(obj));
  }catch{
    if (Array.isArray(obj)) return obj.slice();
    return isPlainObject(obj) ? { ...obj } : obj;
  }
}

function shallowEqual(a, b){
  if (a === b) return true;
  if (!isPlainObject(a) || !isPlainObject(b)) return false;

  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;

  for (let i = 0; i < ak.length; i++){
    const k = ak[i];
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!Object.is(a[k], b[k])) return false;
  }
  return true;
}

function deepFreezeSafe(obj){
  try{ deepFreeze(obj); }catch{}
}

function deepFreeze(obj){
  if (!obj || typeof obj !== 'object') return obj;
  Object.freeze(obj);
  for (const k of Object.keys(obj)){
    const v = obj[k];
    if (v && typeof v === 'object' && !Object.isFrozen(v)){
      deepFreeze(v);
    }
  }
  return obj;
}