/* =============================================================================
  /src/ui.js — UI glue (modals, buttons, mobile-only, focus)
  - Mobile-only enforcement (soft) with DEV bypass
  - Open/close modals (settings/add) + focus restore
  - Button bindings (reset/add/settings/share/selectAll/uncheckAll/wipe)
  - Sync settings inputs with store
============================================================================= */

'use strict';

/**
 * initUI
 * @param {Object} cfg
 * @param {Object} cfg.els  DOM refs
 * @param {Object} cfg.store { getState, setState, subscribe? }
 * @param {Object} cfg.actions actions from actions.js
 * @param {Object} cfg.fx { toast, haptic, unlockAudio }
 * @param {Object} cfg.storage { wipeAllStorage? optional }
 * @param {Function} cfg.onAfterStateChange called after actions that change state (so app.js can rerender)
 */
export function initUI(cfg){
  const { els, store, actions, fx, storage, onAfterStateChange } = cfg;

  // Dev bypass: allow desktop testing if running on localhost or file://
  const DEV_BYPASS = isDevEnv();

  // Initial mobile enforcement + resize
  enforceMobileOnly(els, { devBypass: DEV_BYPASS });
  window.addEventListener('resize', () => enforceMobileOnly(els, { devBypass: DEV_BYPASS }), { passive:true });

  // Bind top/bottom actions
  bindButtons({ els, store, actions, fx, storage, onAfterStateChange });

  // Bind modals close behaviors + focus handling
  bindOverlays({ els, fx });

  // Sync settings inputs initial
  syncSettingsInputs(els, store.getState?.());

  // Bind settings inputs
  bindSettingsInputs({ els, store, actions, fx, onAfterStateChange });

  // Bind add modal create
  bindAddModal({ els, store, actions, fx, onAfterStateChange });

  // Keep inputs synced when settings change
  store?.subscribe?.((prev, next) => {
    if (prev?.settings !== next?.settings){
      syncSettingsInputs(els, next);
    }
  });

  return {
    enforceMobileOnly: () => enforceMobileOnly(els, { devBypass: DEV_BYPASS }),
    openSettings: () => openSettings(els, fx),
    closeSettings: () => closeSettings(els),
    openAdd: () => openAdd(els, fx),
    closeAdd: () => closeAdd(els),
    sync: () => syncSettingsInputs(els, store.getState?.())
  };
}

/* =========================
   Mobile-only enforcement
========================= */

export function enforceMobileOnly(els, { devBypass = false } = {}){
  // If DEV bypass, don't block desktop (lets you test on PC without suffering)
  if (devBypass){
    if (els.desktopBlock){
      els.desktopBlock.style.display = 'none';
      els.desktopBlock.setAttribute('aria-hidden', 'true');
    }
    if (els.app) els.app.style.filter = 'none';
    return;
  }

  const small = matchMedia('(max-width: 820px)').matches;
  const touch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  const ua = (navigator.userAgent || '').toLowerCase();
  const uaMobile = /android|iphone|ipad|ipod/.test(ua);

  const isMobile = small && (touch || uaMobile);

  if (!isMobile){
    if (els.desktopBlock){
      els.desktopBlock.style.display = 'flex';
      els.desktopBlock.setAttribute('aria-hidden', 'false');
    }
    if (els.app) els.app.style.filter = 'blur(3px)';
  } else {
    if (els.desktopBlock){
      els.desktopBlock.style.display = 'none';
      els.desktopBlock.setAttribute('aria-hidden', 'true');
    }
    if (els.app) els.app.style.filter = 'none';
  }
}

/* =========================
   Buttons
========================= */

function bindButtons({ els, store, actions, fx, storage, onAfterStateChange }){
  els.btnReset?.addEventListener('click', () => {
    safe(() => fx?.unlockAudio?.());
    actions.resetChecks?.();
    onAfterStateChange?.();
  });

  els.btnAdd?.addEventListener('click', () => {
    safe(() => fx?.unlockAudio?.());
    openAdd(els, fx, { returnFocusEl: els.btnAdd });
  });

  els.btnSettings?.addEventListener('click', () => {
    safe(() => fx?.unlockAudio?.());
    openSettings(els, fx, { returnFocusEl: els.btnSettings });
  });

  els.btnSelectAll?.addEventListener('click', () => {
    safe(() => fx?.unlockAudio?.());
    actions.setAll?.(true);
    onAfterStateChange?.();
  });

  els.btnUncheckAll?.addEventListener('click', () => {
    safe(() => fx?.unlockAudio?.());
    actions.setAll?.(false);
    onAfterStateChange?.();
  });

  els.btnShare?.addEventListener('click', async () => {
    safe(() => fx?.unlockAudio?.());
    try{
      await actions.shareList?.();
    }catch{}
    // share doesn't change state usually
  });

  els.btnWipe?.addEventListener('click', () => {
    // Soft confirm (prevents accidental "oops I deleted my life")
    const ok = confirm('¿Seguro que quieres borrar TODO? (listas + progreso)');
    if (!ok) return;

    // optional hard wipe storage first
    safe(() => storage?.wipeAllStorage?.());
    actions.wipeAll?.();
    closeSettings(els);
    onAfterStateChange?.();
  });
}

/* =========================
   Overlays & Modals
========================= */

function bindOverlays({ els, fx }){
  // Settings
  els.btnCloseSettings?.addEventListener('click', () => closeSettings(els));
  els.settingsOverlay?.addEventListener('click', (e) => {
    if (e.target === els.settingsOverlay) closeSettings(els);
  });

  // Add
  els.btnCloseAdd?.addEventListener('click', () => closeAdd(els));
  els.addOverlay?.addEventListener('click', (e) => {
    if (e.target === els.addOverlay) closeAdd(els);
  });

  // ESC to close
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (els.addOverlay?.classList.contains('show')) closeAdd(els);
    if (els.settingsOverlay?.classList.contains('show')) closeSettings(els);
  }, { passive:true });

  // Basic focus trap inside open modals
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;

    const activeOverlay =
      els.addOverlay?.classList.contains('show') ? els.addOverlay :
      els.settingsOverlay?.classList.contains('show') ? els.settingsOverlay :
      null;

    if (!activeOverlay) return;

    const focusables = getFocusables(activeOverlay);
    if (!focusables.length) return;

    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;

    if (e.shiftKey){
      if (active === first || active === activeOverlay){
        e.preventDefault();
        last.focus();
      }
    } else {
      if (active === last){
        e.preventDefault();
        first.focus();
      }
    }
  });
}

let lastFocusEl = null;

export function openSettings(els, fx, { returnFocusEl = null } = {}){
  if (!els.settingsOverlay) return;

  lastFocusEl = returnFocusEl || document.activeElement;

  els.settingsOverlay.classList.add('show');
  els.settingsOverlay.setAttribute('aria-hidden', 'false');
  safe(() => fx?.haptic?.(8));

  // Focus first focusable
  setTimeout(() => {
    const focusables = getFocusables(els.settingsOverlay);
    (focusables[0] || els.settingsOverlay).focus?.();
  }, 40);
}

export function closeSettings(els){
  if (!els.settingsOverlay) return;
  els.settingsOverlay.classList.remove('show');
  els.settingsOverlay.setAttribute('aria-hidden', 'true');
  restoreFocus();
}

export function openAdd(els, fx, { returnFocusEl = null } = {}){
  if (!els.addOverlay) return;

  lastFocusEl = returnFocusEl || document.activeElement;

  if (els.newName) els.newName.value = '';
  if (els.newEmoji) els.newEmoji.value = '';

  els.addOverlay.classList.add('show');
  els.addOverlay.setAttribute('aria-hidden', 'false');

  setTimeout(() => els.newName?.focus(), 60);
  safe(() => fx?.haptic?.(8));
}

export function closeAdd(els){
  if (!els.addOverlay) return;
  els.addOverlay.classList.remove('show');
  els.addOverlay.setAttribute('aria-hidden', 'true');
  restoreFocus();
}

function restoreFocus(){
  try{
    if (lastFocusEl && typeof lastFocusEl.focus === 'function'){
      lastFocusEl.focus();
    }
  }catch{}
  lastFocusEl = null;
}

/* =========================
   Settings inputs
========================= */

function syncSettingsInputs(els, state){
  const s = state?.settings || {};
  if (els.tripMode) els.tripMode.value = s.tripMode || 'salida';
  if (els.toggleMotion) els.toggleMotion.checked = !!s.motion;
  if (els.toggleSound) els.toggleSound.checked = !!s.sound;
  if (els.streakChip) els.streakChip.textContent = `✨ ${s.streak || 0}`;
}

function bindSettingsInputs({ els, store, actions, fx, onAfterStateChange }){
  els.tripMode?.addEventListener('change', () => {
    const mode = els.tripMode.value;

    // actions.changeMode already toasts/haptics (avoid double spam)
    actions.changeMode?.(mode);
    onAfterStateChange?.();
  });

  els.toggleMotion?.addEventListener('change', () => {
    store.setState?.((prev) => ({
      ...prev,
      settings: { ...prev.settings, motion: !!els.toggleMotion.checked }
    }));

    safe(() => fx?.toast?.(els.toggleMotion.checked ? 'Animaciones ON ✨' : 'Animaciones OFF 🧊'));
    safe(() => fx?.haptic?.(12));
    onAfterStateChange?.();
  });

  els.toggleSound?.addEventListener('change', () => {
    store.setState?.((prev) => ({
      ...prev,
      settings: { ...prev.settings, sound: !!els.toggleSound.checked }
    }));

    safe(() => fx?.toast?.(els.toggleSound.checked ? 'Sonidito ON 🔔' : 'Sonidito OFF 🤫'));
  });
}

/* =========================
   Add modal create
========================= */

function bindAddModal({ els, store, actions, fx, onAfterStateChange }){
  els.btnCreate?.addEventListener('click', () => {
    const name  = (els.newName?.value || '').trim();
    const emoji = (els.newEmoji?.value || '').trim();
    const cat   = els.newCat?.value || 'otros';

    const res = actions.createItem?.({
      name,
      emoji,
      cat
    });

    if (!res?.ok){
      // Shake modal if empty name and motion is on
      const motion = !!store.getState?.()?.settings?.motion;
      if (motion){
        const modal = els.addOverlay?.querySelector('.modal');
        if (modal){
          modal.classList.remove('shake');
          void modal.offsetWidth; // reflow to restart anim
          modal.classList.add('shake');
        }
      }
      return;
    }

    closeAdd(els);
    onAfterStateChange?.();
  });

  // Enter key to create
  els.newName?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    els.btnCreate?.click();
  });

  // ESC in the add modal should close (already global, but feels nicer)
  els.newName?.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    closeAdd(els);
  });
}

/* =========================
   Helpers
========================= */

function safe(fn){
  try{ fn?.(); }catch{}
}

function getFocusables(root){
  return Array.from(root.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  )).filter(el => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true');
}

function isDevEnv(){
  try{
    const h = location.hostname;
    const p = location.protocol;
    // localhost / 127.0.0.1 / file:// are treated as dev
    if (p === 'file:') return true;
    return h === 'localhost' || h === '127.0.0.1' || h === '';
  }catch{
    return false;
  }
}
