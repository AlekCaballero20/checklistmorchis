/* =============================================================================
  /src/state.js — Tiny state store (Vanilla)
  - getState / setState
  - subscribe (pub/sub)
  - shallow merge updates
  - optional selectors to reduce re-renders
============================================================================= */

'use strict';

/**
 * createStore
 * @param {Object} initialState
 * @returns {Object} store API
 */
export function createStore(initialState = {}){
  let state = deepClone(initialState);
  const listeners = new Set();

  function getState(){
    return state;
  }

  /**
   * setState
   * - setState(partialObj)
   * - setState(updaterFn) where updaterFn(prev) => nextState OR partialObj
   *
   * By default, it shallow merges at the top-level.
   */
  function setState(update){
    const prev = state;

    let next;
    if (typeof update === 'function'){
      const out = update(prev);
      // allow updater to return full state or partial
      next = isPlainObject(out) ? { ...prev, ...out } : prev;
    } else if (isPlainObject(update)){
      next = { ...prev, ...update };
    } else {
      // ignore weird inputs
      next = prev;
    }

    if (next === prev) return;

    state = next;
    emit(prev, next);
  }

  /**
   * replaceState
   * Replaces entire state object (rarely needed).
   */
  function replaceState(nextState){
    const prev = state;
    state = deepClone(nextState || {});
    emit(prev, state);
  }

  /**
   * subscribe
   * @param {(prev, next) => void} fn
   * @returns {() => void} unsubscribe
   */
  function subscribe(fn){
    if (typeof fn !== 'function') return () => {};
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  /**
   * select
   * Subscribe to a slice of state and only fire when that slice changes.
   * @param {(state) => any} selector
   * @param {(slice, prevSlice, nextState, prevState) => void} onChange
   * @param {(a,b) => boolean} [equal] equality function (default: Object.is)
   * @returns {() => void} unsubscribe
   */
  function select(selector, onChange, equal = Object.is){
    let prevSlice = selector(state);

    return subscribe((prev, next) => {
      const nextSlice = selector(next);
      if (!equal(prevSlice, nextSlice)){
        const old = prevSlice;
        prevSlice = nextSlice;
        onChange?.(nextSlice, old, next, prev);
      }
    });
  }

  function emit(prev, next){
    for (const fn of listeners){
      try{ fn(prev, next); } catch {}
    }
  }

  return {
    getState,
    setState,
    replaceState,
    subscribe,
    select
  };
}

/* =========================
   HELPERS
========================= */

function isPlainObject(v){
  return v != null && typeof v === 'object' && (v.constructor === Object || Object.getPrototypeOf(v) === Object.prototype);
}

function deepClone(obj){
  // Enough for our JSON-y state
  try{
    return JSON.parse(JSON.stringify(obj));
  }catch{
    // fallback shallow
    return isPlainObject(obj) ? { ...obj } : obj;
  }
}
