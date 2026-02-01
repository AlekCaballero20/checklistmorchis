/* =============================================================================
  /src/fx.js — Visual polish & feedback (Vanilla, Pro)
  - Ripple (Material-ish) for taps
  - Haptics (vibrate)
  - Tick sound (WebAudio, no files)
  - Confetti (DOM based)
  - Tiny WAAPI helper (optional)
============================================================================= */

'use strict';

import { copyText as copyTextUtil } from './utils.js';

// NOTE:
// app.js expects a factory export: `createFX()`.
// If this export is missing, the ES module graph fails to load and NOTHING works.

/* =========================
   INTERNAL STATE
========================= */

let _audioCtx = null;
let _toastTimer = null;

const FX_DEFAULTS = {
  motion: true,
  sound: true,
  ripple: true,
  haptics: true,
  rippleSelectors: ['.btn', '.mini', '.tab'],
  rippleColor: null
};

/* =========================
   FACTORY (expected by app.js)
========================= */

export function createFX({ toastEl = null, getMotion = () => true, getSound = () => true } = {}){
  // One-time ripple delegation
  initFX({
    motion: !!getMotion(),
    sound:  !!getSound(),
    ripple: true,
    haptics: true
  });

  return {
    toast: (msg, duration) => toast(msg, toastEl || 'toast', duration),
    haptic: (ms = 12) => haptic(ms, true),
    tickSound: () => tickSound(!!getSound()),
    confetti: (opts = {}) => confettiBurst({ enabled: !!getMotion(), ...opts }),
    copyText: (text) => copyTextUtil(text),
    unlockAudio
  };
}

/* =========================
   PUBLIC API
========================= */

export function initFX(opts = {}){
  const cfg = { ...FX_DEFAULTS, ...opts };

  if (cfg.ripple){
    const sel = cfg.rippleSelectors.join(',');
    document.addEventListener('pointerdown', (e) => {
      if (e.button != null && e.button !== 0) return;

      const target = e.target.closest(sel);
      if (!target) return;
      if (target.disabled || target.getAttribute('aria-disabled') === 'true') return;
      if (!isElementVisible(target)) return;

      spawnRipple(target, e, cfg);
    }, { passive: true });
  }
}

export function toast(message, toastElOrId = 'toast', duration = 1600){
  const el = typeof toastElOrId === 'string'
    ? document.getElementById(toastElOrId)
    : toastElOrId;

  if (!el) return;

  el.textContent = message;
  el.classList.add('show');

  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    el.classList.remove('show');
  }, duration);
}

export function haptic(ms = 12, enabled = true){
  if (!enabled) return;
  try{
    if (navigator.vibrate) navigator.vibrate(ms);
  }catch{}
}

export function tickSound(enabled = true){
  if (!enabled) return;
  try{
    const ctx = getAudioCtx();
    if (!ctx) return;

    const o = ctx.createOscillator();
    const g = ctx.createGain();

    o.type = 'square';
    o.frequency.value = 880;

    const now = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.03, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);

    o.connect(g);
    g.connect(ctx.destination);

    o.start(now);
    o.stop(now + 0.08);
  }catch{}
}

export async function unlockAudio(){
  try{
    const ctx = getAudioCtx();
    if (!ctx) return false;
    if (ctx.state === 'suspended') await ctx.resume();
    return true;
  }catch{
    return false;
  }
}

export function confettiBurst({
  count = 26,
  duration = 1600,
  palette = ['#0C41C4','#CE0071','#220A63','#22c55e','#f59e0b','#06b6d4'],
  enabled = true
} = {}){
  if (!enabled) return;

  const layer = document.createElement('div');
  layer.className = 'confettiLayer';
  document.body.appendChild(layer);

  const w = window.innerWidth;

  for (let i=0; i<count; i++){
    const c = document.createElement('div');
    c.className = 'confetto';
    c.style.left = (Math.random() * w) + 'px';
    c.style.top  = (-20 - Math.random()*80) + 'px';
    c.style.background = palette[(Math.random()*palette.length)|0];

    const scale = 0.75 + Math.random()*1.25;
    c.style.transform = `scale(${scale})`;

    const dur = 900 + Math.random()*650;
    c.style.animationDuration = `${dur}ms, ${dur}ms`;

    layer.appendChild(c);
  }

  setTimeout(() => layer.remove(), duration);
}

export function animateEl(el, keyframes, options = {}){
  if (!el || !el.animate) return null;
  return el.animate(keyframes, { duration: 220, easing: 'cubic-bezier(.2,.9,.2,1)', ...options });
}

/* =========================
   RIPPLE (helpers)
========================= */

function spawnRipple(target, e, cfg){
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) return;
  if (!cfg.motion) return;

  const style = getComputedStyle(target);
  if (style.position === 'static'){
    target.dataset._fxPos = 'static';
    target.style.position = 'relative';
  }
  if (style.overflow !== 'hidden'){
    target.dataset._fxOv = style.overflow;
    target.style.overflow = 'hidden';
  }

  const rip = document.createElement('span');
  rip.className = 'fxRipple';
  rip.setAttribute('aria-hidden', 'true');

  const rect = target.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height) * 1.35;

  rip.style.width = rip.style.height = `${size}px`;

  const x = e.clientX - rect.left - size/2;
  const y = e.clientY - rect.top  - size/2;

  rip.style.left = `${x}px`;
  rip.style.top  = `${y}px`;

  if (cfg.rippleColor){
    rip.style.background = cfg.rippleColor;
  }

  target.appendChild(rip);

  rip.addEventListener('animationend', () => {
    rip.remove();
    if (target.dataset._fxPos){
      target.style.position = 'static';
      delete target.dataset._fxPos;
    }
    if (target.dataset._fxOv){
      target.style.overflow = target.dataset._fxOv;
      delete target.dataset._fxOv;
    }
  }, { once: true });
}

function isElementVisible(el){
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

function getAudioCtx(){
  if (_audioCtx) return _audioCtx;
  try{
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;
    _audioCtx = new AudioContext();
    return _audioCtx;
  }catch{
    return null;
  }
}
