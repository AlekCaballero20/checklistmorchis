/* =============================================================================
  /src/gestures.js — Swipe gestures (Vanilla, Pro)
  - Swipe right: toggle done
  - Swipe left: delete
  - Thresholds + resistance + snap
  - Scroll-friendly (only engages when horizontal intent is clear)
  - Delegation: works with dynamic lists
============================================================================= */

'use strict';

const DEFAULTS = {
  listSelector: '#list',
  itemSelector: '.item[data-id]',
  // px
  swipeThreshold: 64,       // distance to "commit"
  revealThreshold: 18,      // distance to start revealing UI state
  maxSwipe: 110,            // clamp translateX
  resistance: 0.32,         // extra drag beyond max
  // gesture behavior
  lockAxisThreshold: 8,     // px before deciding axis intent
  // callbacks
  onToggle: null,           // (id, el) => void
  onDelete: null,           // (id, el) => void
  onReveal: null,           // (id, el, side) => void | side: 'left'|'right'|null
  // flags
  enabled: true,
  motion: true
};

/**
 * initGestures
 * @param {Object} opts
 * @returns {Object} controls { destroy, setEnabled, setMotion }
 */
export function initGestures(opts = {}){
  const cfg = { ...DEFAULTS, ...opts };
  const listEl = typeof cfg.listSelector === 'string'
    ? document.querySelector(cfg.listSelector)
    : cfg.listSelector;

  if (!listEl) {
    // no list, no party
    return {
      destroy(){},
      setEnabled(){},
      setMotion(){}
    };
  }

  // Internal gesture state
  let active = null;

  function onPointerDown(e){
    if (!cfg.enabled) return;
    // primary pointer only
    if (e.button != null && e.button !== 0) return;

    const row = e.target.closest(cfg.itemSelector);
    if (!row) return;

    // ignore when pressing a button inside (like delete button) to not conflict
    const insideBtn = e.target.closest('button, a, input, select, textarea, label');
    if (insideBtn) return;

    const id = row.dataset.id;
    if (!id) return;

    // start tracking
    active = {
      id,
      row,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      dx: 0,
      dy: 0,
      axisLocked: null, // 'x' | 'y'
      isDragging: false,
      revealedSide: null, // 'left' | 'right' | null
    };

    row.setPointerCapture?.(e.pointerId);
    // prepping styles
    row.classList.add('swiping');
    row.style.willChange = 'transform';

    // avoid text selection during gesture
    document.documentElement.classList.add('noSelect');

    // We don't prevent default yet to keep scroll smooth until lock axis decides.
  }

  function onPointerMove(e){
    if (!cfg.enabled) return;
    if (!active) return;
    if (e.pointerId !== active.pointerId) return;

    active.lastX = e.clientX;
    active.lastY = e.clientY;

    active.dx = active.lastX - active.startX;
    active.dy = active.lastY - active.startY;

    // Decide axis intent after small movement
    if (!active.axisLocked) {
      const adx = Math.abs(active.dx);
      const ady = Math.abs(active.dy);
      if (adx < cfg.lockAxisThreshold && ady < cfg.lockAxisThreshold) return;

      active.axisLocked = (adx > ady) ? 'x' : 'y';
    }

    // If vertical scrolling, stop handling
    if (active.axisLocked === 'y') {
      cleanupActive(false);
      return;
    }

    // Horizontal drag: now we can prevent scroll
    active.isDragging = true;
    e.preventDefault?.();

    const tx = computeTranslate(active.dx, cfg.maxSwipe, cfg.resistance);
    applyTransform(active.row, tx, cfg.motion);

    // Reveal state class
    if (Math.abs(tx) >= cfg.revealThreshold) {
      const side = tx < 0 ? 'left' : 'right';
      if (side !== active.revealedSide) {
        active.revealedSide = side;
        setRevealClasses(active.row, side);
        cfg.onReveal?.(active.id, active.row, side);
      }
    } else {
      if (active.revealedSide !== null) {
        active.revealedSide = null;
        setRevealClasses(active.row, null);
        cfg.onReveal?.(active.id, active.row, null);
      }
    }
  }

  function onPointerUp(e){
    if (!cfg.enabled) return;
    if (!active) return;
    if (e.pointerId !== active.pointerId) return;

    // If we never truly dragged horizontally, treat as normal click (do nothing here)
    if (!active.isDragging) {
      cleanupActive(false);
      return;
    }

    const tx = getCurrentTranslate(active.row);
    const commit = Math.abs(tx) >= cfg.swipeThreshold;

    if (commit) {
      // Decide action based on direction
      if (tx < 0) {
        // swipe left => delete
        snapAndDelete(active);
      } else {
        // swipe right => toggle done
        snapAndToggle(active);
      }
    } else {
      // revert
      snapBack(active.row, cfg.motion);
      cleanupActive(false);
    }
  }

  function onPointerCancel(e){
    if (!active) return;
    if (e.pointerId !== active.pointerId) return;
    if (active.row) snapBack(active.row, cfg.motion);
    cleanupActive(false);
  }

  function snapAndToggle(a){
    // snap to right briefly, then back
    const row = a.row;
    const id = a.id;

    row.classList.add('swipeCommitRight');
    applyTransform(row, cfg.maxSwipe, cfg.motion);

    // call action a bit after snap for better feel
    setTimeout(() => {
      cfg.onToggle?.(id, row);

      // snap back
      snapBack(row, cfg.motion);

      // cleanup
      cleanupActive(true);
    }, cfg.motion ? 160 : 0);
  }

  function snapAndDelete(a){
    const row = a.row;
    const id = a.id;

    row.classList.add('swipeCommitLeft');
    // slide out left
    applyTransform(row, -Math.max(cfg.maxSwipe, 140), cfg.motion);

    // optional: collapse height for a "native" delete feel
    setTimeout(() => {
      row.classList.add('swipeRemove');
      cfg.onDelete?.(id, row);
      cleanupActive(true);
    }, cfg.motion ? 180 : 0);
  }

  function cleanupActive(hard){
    if (!active) return;

    const row = active.row;
    if (row) {
      row.releasePointerCapture?.(active.pointerId);
      row.style.willChange = '';
      row.classList.remove('swiping', 'revealLeft', 'revealRight', 'swipeCommitLeft', 'swipeCommitRight');
      if (!hard) row.classList.remove('swipeRemove');
      // don't clear transform here; caller does snapBack or commit animation
    }

    document.documentElement.classList.remove('noSelect');
    active = null;
  }

  // Attach listeners
  listEl.addEventListener('pointerdown', onPointerDown, { passive: true });
  listEl.addEventListener('pointermove', onPointerMove, { passive: false });
  listEl.addEventListener('pointerup', onPointerUp, { passive: true });
  listEl.addEventListener('pointercancel', onPointerCancel, { passive: true });

  return {
    destroy(){
      listEl.removeEventListener('pointerdown', onPointerDown);
      listEl.removeEventListener('pointermove', onPointerMove);
      listEl.removeEventListener('pointerup', onPointerUp);
      listEl.removeEventListener('pointercancel', onPointerCancel);
    },
    setEnabled(v){ cfg.enabled = !!v; },
    setMotion(v){ cfg.motion = !!v; }
  };
}

/* =========================
   HELPERS
========================= */

function computeTranslate(dx, maxSwipe, resistance){
  const sign = dx < 0 ? -1 : 1;
  const adx = Math.abs(dx);

  if (adx <= maxSwipe) return dx;

  // resistance beyond max
  const extra = adx - maxSwipe;
  return sign * (maxSwipe + extra * resistance);
}

function applyTransform(row, tx, motion){
  if (!row) return;
  row.style.transition = 'none';
  row.style.transform = `translate3d(${tx}px, 0, 0)`;
  // optional micro shadow for "lift"
  if (motion) row.classList.add('swipeLift');
}

function snapBack(row, motion){
  if (!row) return;
  row.style.transition = motion
    ? 'transform 220ms cubic-bezier(.2,.9,.2,1)'
    : 'transform 0ms linear';
  row.style.transform = 'translate3d(0px,0,0)';
  row.classList.remove('swipeLift');

  // After snap, remove transition so future drags are immediate
  setTimeout(() => {
    row.style.transition = 'none';
  }, 240);
}

function setRevealClasses(row, side){
  if (!row) return;
  row.classList.toggle('revealLeft', side === 'left');
  row.classList.toggle('revealRight', side === 'right');
}

function getCurrentTranslate(el){
  const t = getComputedStyle(el).transform;
  if (!t || t === 'none') return 0;
  // matrix(a,b,c,d,tx,ty)
  const match = t.match(/matrix\(([^)]+)\)/);
  if (match){
    const parts = match[1].split(',').map(s => parseFloat(s.trim()));
    return parts[4] || 0;
  }
  // matrix3d(..., tx, ty, tz)
  const match3 = t.match(/matrix3d\(([^)]+)\)/);
  if (match3){
    const parts = match3[1].split(',').map(s => parseFloat(s.trim()));
    return parts[12] || 0;
  }
  return 0;
}
