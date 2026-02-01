/* =============================================================================
  /src/utils.js — Small utilities (Vanilla)
============================================================================= */

'use strict';

/* =========================
   DOM helpers
========================= */

export const qs  = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/* =========================
   Escaping
========================= */

export function esc(s){
  return String(s ?? '').replace(/[&<>"']/g, m => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[m]));
}

export function cssEsc(s){
  try{
    return CSS.escape(String(s));
  }catch{
    return String(s).replace(/["\\]/g, '\\$&');
  }
}

/* =========================
   IDs
========================= */

export function uid(){
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

/* =========================
   Math / formatting
========================= */

export function clamp(n, min, max){
  const v = Number(n);
  if (!Number.isFinite(v)) return min;
  return Math.min(max, Math.max(min, v));
}

export function formatPercent(done, total){
  const pct = total ? Math.round((done / total) * 100) : 0;
  return clamp(pct, 0, 100);
}

/* =========================
   Timing
========================= */

export function debounce(fn, wait = 200){
  let t = null;
  return function(...args){
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), wait);
  };
}

export function throttle(fn, wait = 200){
  let last = 0;
  let t = null;
  return function(...args){
    const now = Date.now();
    const remaining = wait - (now - last);
    if (remaining <= 0){
      last = now;
      fn.apply(this, args);
    } else if (!t){
      t = setTimeout(() => {
        t = null;
        last = Date.now();
        fn.apply(this, args);
      }, remaining);
    }
  };
}

/* =========================
   Clipboard
========================= */

export async function copyText(text){
  if (navigator.clipboard?.writeText){
    return navigator.clipboard.writeText(text);
  }

  // legacy fallback
  return new Promise((resolve, reject) => {
    try{
      const ta = document.createElement('textarea');
      ta.value = String(text ?? '');
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-9999px';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      ok ? resolve() : reject(new Error('copy failed'));
    }catch (err){
      reject(err);
    }
  });
}

/* =========================
   JSON safety
========================= */

export function safeJSONParse(raw, fallback = null){
  try{
    if (raw == null || raw === '') return fallback;
    return JSON.parse(raw);
  }catch{
    return fallback;
  }
}

export function isPlainObject(v){
  return v != null && typeof v === 'object' &&
    (v.constructor === Object || Object.getPrototypeOf(v) === Object.prototype);
}

/* =========================
   UX prefs
========================= */

export function prefersReducedMotion(){
  try{
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }catch{
    return false;
  }
}
