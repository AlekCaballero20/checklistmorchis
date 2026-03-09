/* =============================================================================
  /src/ui.js — UI glue (modals, buttons, mobile-only, focus) — PRO v6.0
  - ✅ Mobile-only enforcement (soft) + DEV bypass
  - ✅ Modal manager robusto:
      - focus restore por modal
      - focus trap
      - ESC close
      - click outside close
      - scroll lock real
      - close top-most only
  - ✅ Button bindings seguros
  - ✅ Sync settings inputs + sync visual de toggles
  - ✅ Add flow: create item in selected target mode
  - ✅ Edit flow: save item + add item to another mode
  - ✅ Mode editor hooks alineados con HTML nuevo
  - ✅ Safer:
      - prevents double-submits
      - handles missing els gracefully
      - avoids duplicate listeners in repeated init
      - better focusables filtering
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
 * @param {Function} cfg.onAfterStateChange called after actions that change state
 */
export function initUI(cfg) {
  const { els, store, actions, fx, storage, onAfterStateChange } = cfg || {};
  const DEV_BYPASS = isDevEnv();

  if (!els) {
    return createPublicAPI({
      els,
      store,
      fx,
      actions,
      onAfterStateChange,
      modal: null,
      devBypass: DEV_BYPASS
    });
  }

  enforceMobileOnly(els, { devBypass: DEV_BYPASS });

  bindOnce(
    window,
    '__ui_resize_mobile_gate__',
    'resize',
    () => enforceMobileOnly(els, { devBypass: DEV_BYPASS }),
    { passive: true }
  );

  const modal = createModalController({ els, fx });

  bindOverlays({ els, modal });
  bindButtons({ els, actions, fx, storage, modal, onAfterStateChange, store });
  syncSettingsInputs(els, store?.getState?.());

  bindSettingsInputs({ els, store, actions, fx, onAfterStateChange });
  bindAddModal({ els, actions, fx, modal, onAfterStateChange, store });
  bindEditModal({ els, actions, fx, modal, onAfterStateChange, store });
  bindModeEditor({ els, store, actions, fx, modal, onAfterStateChange });

  store?.subscribe?.((prev, next) => {
    if (prev?.settings !== next?.settings) {
      syncSettingsInputs(els, next);
    }
  });

  return createPublicAPI({
    els,
    store,
    fx,
    actions,
    onAfterStateChange,
    modal,
    devBypass: DEV_BYPASS
  });
}

/* =========================
   Public API
========================= */

function createPublicAPI({ els, store, fx, actions, onAfterStateChange, modal, devBypass }) {
  return {
    enforceMobileOnly: () => enforceMobileOnly(els, { devBypass }),

    openSettings: (opts) => modal?.open?.('settings', opts),
    closeSettings: () => modal?.close?.('settings'),

    openAdd: (opts) => modal?.open?.('add', opts),
    closeAdd: () => modal?.close?.('add'),

    openEdit: (opts) => modal?.open?.('edit', opts),
    closeEdit: () => modal?.close?.('edit'),

    openModeEditor: (opts) => openModeEditor({
      els, store, actions, fx, modal, onAfterStateChange, ...(opts || {})
    }),
    closeModeEditor: () => modal?.close?.('modeEditor'),

    openEditById: (id) => openEditById({ els, store, fx, modal, id }),

    sync: () => syncSettingsInputs(els, store?.getState?.())
  };
}

/* =========================
   Mobile-only enforcement
========================= */

export function enforceMobileOnly(els, { devBypass = false } = {}) {
  if (!els) return;

  if (devBypass) {
    hideDesktopBlock(els);
    if (els.app) els.app.style.filter = 'none';
    return;
  }

  const small = window.matchMedia?.('(max-width: 820px)')?.matches ?? true;
  const touch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  const ua = (navigator.userAgent || '').toLowerCase();
  const uaMobile = /android|iphone|ipad|ipod/.test(ua);

  const isMobile = small && (touch || uaMobile);

  if (!isMobile) {
    showDesktopBlock(els);
    if (els.app) els.app.style.filter = 'blur(3px)';
  } else {
    hideDesktopBlock(els);
    if (els.app) els.app.style.filter = 'none';
  }
}

function showDesktopBlock(els) {
  if (!els?.desktopBlock) return;
  els.desktopBlock.style.display = 'flex';
  els.desktopBlock.setAttribute('aria-hidden', 'false');
}

function hideDesktopBlock(els) {
  if (!els?.desktopBlock) return;
  els.desktopBlock.style.display = 'none';
  els.desktopBlock.setAttribute('aria-hidden', 'true');
}

/* =========================
   Main buttons
========================= */

function bindButtons({ els, actions, fx, storage, modal, onAfterStateChange, store }) {
  if (!els) return;

  bindClick(els.btnReset, () => {
    safe(() => fx?.unlockAudio?.());
    safe(() => actions?.resetChecks?.());
    onAfterStateChange?.();
  });

  bindClick(els.btnAdd, () => {
    safe(() => fx?.unlockAudio?.());

    if (els.newModeTarget && els.tripMode) {
      const currentMode = String(els.tripMode.value || 'salida');
      if (selectHasValue(els.newModeTarget, currentMode)) {
        els.newModeTarget.value = currentMode;
      }
    }

    modal?.open?.('add', { returnFocusEl: els.btnAdd });
  });

  bindClick(els.btnSettings, () => {
    safe(() => fx?.unlockAudio?.());
    modal?.open?.('settings', { returnFocusEl: els.btnSettings });
  });

  bindClick(els.btnSelectAll, () => {
    safe(() => fx?.unlockAudio?.());
    safe(() => actions?.setAll?.(true));
    onAfterStateChange?.();
  });

  bindClick(els.btnUncheckAll, () => {
    safe(() => fx?.unlockAudio?.());
    safe(() => actions?.setAll?.(false));
    onAfterStateChange?.();
  });

  bindClick(els.btnWipe, () => {
    const ok = confirm('¿Seguro que quieres borrar TODO? (listas + progreso)');
    if (!ok) return;

    safe(() => storage?.wipeAllStorage?.());
    safe(() => actions?.wipeAll?.());
    modal?.close?.('settings');
    onAfterStateChange?.();
  });

  bindClick(resolveModeEditButton(els), () => {
    safe(() => fx?.unlockAudio?.());
    openModeEditor({
      els,
      store,
      actions,
      fx,
      modal,
      onAfterStateChange,
      returnFocusEl: resolveModeEditButton(els)
    });
  }, '__modeEditMainClick__');
}

/* =========================
   Overlay events / focus trap
========================= */

function bindOverlays({ els, modal }) {
  if (!els || !modal) return;

  bindClick(els.btnCloseSettings, () => modal.close('settings'));
  bindClick(els.btnCloseAdd, () => modal.close('add'));
  bindClick(els.btnCloseEdit, () => modal.close('edit'));
  bindClick(resolveModeEditorCloseButton(els), () => modal.close('modeEditor'), '__modeEditorClose__');

  bindOverlayDismiss(els.settingsOverlay, () => modal.close('settings'));
  bindOverlayDismiss(els.addOverlay, () => modal.close('add'));
  bindOverlayDismiss(els.editOverlay, () => modal.close('edit'));
  bindOverlayDismiss(resolveModeEditorOverlay(els), () => modal.close('modeEditor'));

  bindOnce(window, '__ui_keydown_escape__', 'keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (e.isComposing) return;

    const top = modal.topOpen();
    if (!top) return;

    e.preventDefault();
    modal.close(top);
  });

  bindOnce(window, '__ui_keydown_tabtrap__', 'keydown', (e) => {
    if (e.key !== 'Tab') return;

    const overlay = modal.activeOverlayEl();
    if (!overlay) return;

    const focusables = getFocusables(overlay);
    if (!focusables.length) return;

    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;

    if (e.shiftKey) {
      if (active === first || active === overlay || !overlay.contains(active)) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (active === last || !overlay.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    }
  });
}

function bindOverlayDismiss(overlay, onClose) {
  if (!overlay) return;
  bindClick(overlay, (e) => {
    if (e.target === overlay) onClose?.();
  }, '__overlayDismiss__');
}

/* =========================
   Modal Controller
========================= */

function createModalController({ els, fx }) {
  const modeEditorOverlay = resolveModeEditorOverlay(els);

  const overlays = {
    settings: els?.settingsOverlay || null,
    add: els?.addOverlay || null,
    edit: els?.editOverlay || null,
    modeEditor: modeEditorOverlay || null
  };

  const defaultFocus = {
    settings: () => getFocusables(overlays.settings)[0] || overlays.settings,
    add: () => els?.newName || getFocusables(overlays.add)[0] || overlays.add,
    edit: () => els?.editName || getFocusables(overlays.edit)[0] || overlays.edit,
    modeEditor: () =>
      resolveModeEditorNameInput(els) ||
      resolveModeEditorSelect(els) ||
      getFocusables(overlays.modeEditor)[0] ||
      overlays.modeEditor
  };

  let stack = [];
  const returnFocusMap = new Map();

  function lockScroll() {
    try {
      const scrollY = window.scrollY || window.pageYOffset || 0;
      document.documentElement.classList.add('modal-open');
      document.body.classList.add('modal-open');
      document.body.dataset.modalScrollY = String(scrollY);
      document.body.style.top = `-${scrollY}px`;
    } catch {}
  }

  function unlockScroll() {
    try {
      const scrollY = Number(document.body?.dataset?.modalScrollY || 0);

      document.documentElement.classList.remove('modal-open');
      document.body.classList.remove('modal-open');
      document.body.style.top = '';

      window.scrollTo?.(0, Number.isFinite(scrollY) ? scrollY : 0);

      delete document.body.dataset.modalScrollY;
    } catch {}
  }

  function isOpen(name) {
    const overlay = overlays[name];
    return !!(overlay && overlay.classList.contains('show'));
  }

  function open(name, opts = {}) {
    const overlay = overlays[name];
    if (!overlay) return;

    prepareModalOpen(name, els, overlay);

    const returnFocusEl = opts.returnFocusEl || document.activeElement || null;
    const focusEl = opts.focusEl || null;

    returnFocusMap.set(name, returnFocusEl);

    overlay.classList.add('show');
    overlay.setAttribute('aria-hidden', 'false');

    stack = stack.filter(x => x !== name);
    stack.push(name);

    if (stack.length === 1) lockScroll();

    safe(() => fx?.haptic?.(8));

    requestAnimationFrame(() => {
      setTimeout(() => {
        if (!isOpen(name)) return;

        if (focusEl?.focus) {
          safe(() => focusEl.focus());
          return;
        }

        const f = defaultFocus[name]?.();
        safe(() => f?.focus?.());
      }, 24);
    });
  }

  function close(name) {
    const overlay = overlays[name];
    if (!overlay || !isOpen(name)) return;

    overlay.classList.remove('show');
    overlay.setAttribute('aria-hidden', 'true');

    cleanupModalClose(name, overlay);

    stack = stack.filter(x => x !== name);

    if (!stack.length) {
      unlockScroll();
    } else {
      const nextTop = stack[stack.length - 1];
      const nextOverlay = overlays[nextTop];
      if (nextOverlay) {
        setTimeout(() => {
          const f = defaultFocus[nextTop]?.();
          safe(() => f?.focus?.());
        }, 12);
      }
    }

    restoreFocus(name);
  }

  function restoreFocus(name) {
    const el = returnFocusMap.get(name) || null;
    returnFocusMap.delete(name);

    if (stack.length) return;

    try {
      if (el && typeof el.focus === 'function') {
        el.focus();
      }
    } catch {}
  }

  function topOpen() {
    return stack.length ? stack[stack.length - 1] : null;
  }

  function activeOverlayEl() {
    const top = topOpen();
    return top ? overlays[top] : null;
  }

  return {
    open,
    close,
    topOpen,
    activeOverlayEl,
    isOpen
  };
}

function prepareModalOpen(name, els, overlay) {
  if (!overlay) return;

  if (name === 'add') {
    if (els?.newName) els.newName.value = '';
    if (els?.newEmoji) els.newEmoji.value = '';
    if (els?.newModeTarget && els?.tripMode) {
      const currentMode = String(els.tripMode.value || 'salida');
      if (selectHasValue(els.newModeTarget, currentMode)) {
        els.newModeTarget.value = currentMode;
      }
    }
  }

  if (name === 'edit') {
    if (overlay.dataset && overlay.dataset.editingId == null) overlay.dataset.editingId = '';
  }

  if (name === 'modeEditor') {
    if (overlay.dataset && overlay.dataset.modeKey == null) overlay.dataset.modeKey = '';
  }
}

function cleanupModalClose(name, overlay) {
  if (!overlay) return;

  if (name === 'edit' && overlay.dataset) {
    overlay.dataset.editingId = '';
  }

  if (name === 'modeEditor' && overlay.dataset) {
    overlay.dataset.modeKey = '';
  }
}

/* =========================
   Settings inputs
========================= */

function syncSettingsInputs(els, state) {
  if (!els) return;
  const s = state?.settings || {};

  if (els.tripMode) els.tripMode.value = s.tripMode || 'salida';

  const motion = !!s.motion;
  const sound = !!s.sound;

  if (els.toggleMotion) {
    els.toggleMotion.checked = motion;
    syncToggleVisualState(els.toggleMotion, motion);
  }

  if (els.toggleSound) {
    els.toggleSound.checked = sound;
    syncToggleVisualState(els.toggleSound, sound);
  }

  if (els.streakChip) {
    const n = Number(s.streak || 0);
    els.streakChip.textContent = `✨ ${Number.isFinite(n) ? n : 0}`;
  }

  if (els.newModeTarget && els.tripMode && selectHasValue(els.newModeTarget, s.tripMode || 'salida')) {
    els.newModeTarget.value = s.tripMode || 'salida';
  }
}

function bindSettingsInputs({ els, store, actions, fx, onAfterStateChange }) {
  if (!els) return;

  bindChange(els.tripMode, () => {
    const mode = String(els.tripMode.value || 'salida');
    safe(() => actions?.changeMode?.(mode));
    onAfterStateChange?.();
  });

  bindToggleChange(els.toggleMotion, ({ checked }) => {
    if (typeof actions?.setMotion === 'function') {
      actions.setMotion(checked);
    } else {
      store?.setState?.((prev) => ({
        ...prev,
        settings: { ...(prev.settings || {}), motion: checked }
      }));
    }

    safe(() => fx?.toast?.(checked ? 'Animaciones ON ✨' : 'Animaciones OFF 🧊'));
    safe(() => fx?.haptic?.(12));
    onAfterStateChange?.();
  });

  bindToggleChange(els.toggleSound, ({ checked }) => {
    if (typeof actions?.setSound === 'function') {
      actions.setSound(checked);
    } else {
      store?.setState?.((prev) => ({
        ...prev,
        settings: { ...(prev.settings || {}), sound: checked }
      }));
    }

    safe(() => fx?.toast?.(checked ? 'Sonidito ON 🔔' : 'Sonidito OFF 🤫'));
    safe(() => fx?.haptic?.(10));
    onAfterStateChange?.();
  });
}

/* =========================
   Add modal
========================= */

function bindAddModal({ els, actions, fx, modal, onAfterStateChange, store }) {
  if (!els) return;

  let busy = false;

  const doCreate = () => {
    if (busy) return;
    busy = true;

    const name = (els.newName?.value || '').trim();
    const emoji = (els.newEmoji?.value || '').trim();
    const cat = String(els.newCat?.value || 'otros');
    const targetMode = String(
      els.newModeTarget?.value ||
      store?.getState?.()?.settings?.tripMode ||
      'salida'
    );

    const res = actions?.createItem?.({ name, emoji, cat, targetMode });

    if (!res?.ok) {
      shakeIfMotion({ store, overlay: els.addOverlay });
      busy = false;
      return;
    }

    modal?.close?.('add');
    onAfterStateChange?.();

    setTimeout(() => { busy = false; }, 90);
  };

  bindClick(els.btnCreate, () => {
    safe(() => fx?.unlockAudio?.());
    doCreate();
  });

  bindEnterEsc(els.newName, () => els.btnCreate?.click(), () => modal?.close?.('add'));
  bindEnterEsc(els.newEmoji, () => els.btnCreate?.click(), () => modal?.close?.('add'));
  bindEnterEsc(els.newCat, () => els.btnCreate?.click(), () => modal?.close?.('add'));
  bindEnterEsc(els.newModeTarget, () => els.btnCreate?.click(), () => modal?.close?.('add'));
}

/* =========================
   Edit modal
========================= */

function bindEditModal({ els, actions, fx, modal, onAfterStateChange, store }) {
  if (!els) return;

  let busySave = false;
  let busyAdd = false;

  const getEditingId = () => String(els.editOverlay?.dataset?.editingId || '').trim();

  const doSave = () => {
    if (busySave) return;
    busySave = true;

    const id = getEditingId();
    if (!id) {
      busySave = false;
      return;
    }

    const name = (els.editName?.value || '').trim();
    const emoji = (els.editEmoji?.value || '').trim();
    const cat = String(els.editCat?.value || 'otros');

    const res = actions?.editItem?.(id, { name, emoji, cat });

    if (!res?.ok) {
      shakeIfMotion({ store, overlay: els.editOverlay });
      busySave = false;
      return;
    }

    modal?.close?.('edit');
    onAfterStateChange?.();
    setTimeout(() => { busySave = false; }, 90);
  };

  const doAddToMode = () => {
    if (busyAdd) return;
    busyAdd = true;

    const id = getEditingId();
    if (!id) {
      busyAdd = false;
      return;
    }

    const toMode = String(els.dupMode?.value || '').trim();
    if (!toMode) {
      safe(() => fx?.toast?.('Escoge una lista 🙃'));
      safe(() => fx?.haptic?.(14));
      busyAdd = false;
      return;
    }

    let res = null;

    if (typeof actions?.assignItemToModes === 'function') {
      res = actions.assignItemToModes(id, [toMode]);
    } else if (typeof actions?.addItemToMode === 'function') {
      res = actions.addItemToMode(id, toMode);
    } else {
      res = { ok: false };
    }

    if (!res?.ok) {
      safe(() => fx?.toast?.('No se pudo agregar a esa lista 🙄'));
      safe(() => fx?.haptic?.(14));
      busyAdd = false;
      return;
    }

    safe(() => fx?.toast?.('Agregado a la otra lista ✅'));
    safe(() => fx?.haptic?.(10));
    onAfterStateChange?.();
    setTimeout(() => { busyAdd = false; }, 90);
  };

  bindClick(els.btnSaveEdit, () => {
    safe(() => fx?.unlockAudio?.());
    doSave();
  });

  bindClick(els.btnAddToMode, () => {
    safe(() => fx?.unlockAudio?.());
    doAddToMode();
  });

  bindEnterEsc(els.editName, () => els.btnSaveEdit?.click(), () => modal?.close?.('edit'));
  bindEnterEsc(els.editEmoji, () => els.btnSaveEdit?.click(), () => modal?.close?.('edit'));
  bindEnterEsc(els.editCat, () => els.btnSaveEdit?.click(), () => modal?.close?.('edit'));
  bindEnterEsc(els.dupMode, () => els.btnAddToMode?.click(), () => modal?.close?.('edit'));
}

/* =========================
   Mode editor
========================= */

function bindModeEditor({ els, store, actions, fx, modal, onAfterStateChange }) {
  if (!els) return;

  const trigger = resolveModeEditButton(els);
  if (trigger) {
    bindClick(trigger, () => {
      openModeEditor({
        els,
        store,
        actions,
        fx,
        modal,
        onAfterStateChange,
        returnFocusEl: trigger
      });
    }, '__modeEditorTrigger__');
  }

  const saveBtn = resolveModeEditorSaveButton(els);
  const deleteBtn = resolveModeEditorDeleteButton(els);

  bindClick(saveBtn, () => {
    saveModeEditor({ els, store, actions, fx, modal, onAfterStateChange });
  }, '__modeEditorSave__');

  bindClick(deleteBtn, () => {
    deleteModeEditor({ els, store, actions, fx, modal, onAfterStateChange });
  }, '__modeEditorDelete__');

  bindChange(resolveModeEditorSelect(els), () => {
    const overlay = resolveModeEditorOverlay(els);
    const state = store?.getState?.() || {};
    const selectEl = resolveModeEditorSelect(els);
    const nameInput = resolveModeEditorNameInput(els);
    const countEl = resolveModeItemsCountEl(els);

    const modeKey = String(selectEl?.value || getCurrentMode(state) || '').trim();

    if (overlay?.dataset) overlay.dataset.modeKey = modeKey;

    const modeData = getModeData(state, modeKey);

    if (nameInput) {
      nameInput.value = String(
        stripLeadingEmoji(modeData?.label || modeData?.name || modeKey || '')
      );
    }

    if (countEl) {
      const count = Array.isArray(modeData?.items)
        ? modeData.items.length
        : getItemsForMode(state, modeKey).length;
      countEl.textContent = String(count);
    }
  }, '__modeEditorSelectChange__');

  bindEnterEsc(
    resolveModeEditorNameInput(els),
    () => resolveModeEditorSaveButton(els)?.click?.(),
    () => modal?.close?.('modeEditor')
  );

  bindEnterEsc(
    resolveModeEditorSelect(els),
    () => resolveModeEditorSaveButton(els)?.click?.(),
    () => modal?.close?.('modeEditor')
  );
}

function openModeEditor({ els, store, actions, fx, modal, onAfterStateChange, returnFocusEl } = {}) {
  const state = store?.getState?.() || {};
  const currentMode = getCurrentMode(state);

  if (typeof actions?.openModeEditor === 'function') {
    safe(() => actions.openModeEditor(currentMode));
  }

  const overlay = resolveModeEditorOverlay(els);
  if (overlay && modal) {
    const modeData = getModeData(state, currentMode);
    const nameInput = resolveModeEditorNameInput(els);
    const selectEl = resolveModeEditorSelect(els);
    const countEl = resolveModeItemsCountEl(els);

    if (overlay.dataset) {
      overlay.dataset.modeKey = currentMode;
    }

    if (nameInput) {
      nameInput.value = String(
        stripLeadingEmoji(modeData?.label || modeData?.name || currentMode || '')
      );
    }

    if (selectEl) {
      if (selectHasValue(selectEl, currentMode)) {
        selectEl.value = String(currentMode || '');
      }
    }

    if (countEl) {
      const count = Array.isArray(modeData?.items)
        ? modeData.items.length
        : getItemsForMode(state, currentMode).length;
      countEl.textContent = String(count);
    }

    modal.open('modeEditor', {
      returnFocusEl: returnFocusEl || document.activeElement,
      focusEl: nameInput || selectEl
    });
    return;
  }

  safe(() => fx?.toast?.('El editor de listas aún no está conectado del todo 👀'));
  safe(() => fx?.haptic?.(10));
}

function saveModeEditor({ els, store, actions, fx, modal, onAfterStateChange }) {
  const state = store?.getState?.() || {};
  const overlay = resolveModeEditorOverlay(els);
  const selectEl = resolveModeEditorSelect(els);
  const nameInput = resolveModeEditorNameInput(els);

  const modeKey = String(
    overlay?.dataset?.modeKey ||
    selectEl?.value ||
    getCurrentMode(state) ||
    ''
  ).trim();

  if (!modeKey) {
    safe(() => fx?.toast?.('No encontré la lista para editar 😑'));
    safe(() => fx?.haptic?.(14));
    return;
  }

  const newName = String(nameInput?.value || '').trim();

  if (!newName) {
    shakeIfMotion({ store, overlay });
    safe(() => fx?.toast?.('Ponle un nombre a la lista'));
    return;
  }

  let res = null;

  if (typeof actions?.updateMode === 'function') {
    res = actions.updateMode(modeKey, { name: newName, label: `🧳 ${newName}` });
  } else if (typeof actions?.renameMode === 'function') {
    res = actions.renameMode(modeKey, newName);
  } else {
    store?.setState?.((prev) => {
      const next = { ...(prev || {}) };
      const data = { ...(next.data || {}) };
      const modes = { ...(data.modes || {}) };

      const prevMode = { ...(modes[modeKey] || {}) };
      modes[modeKey] = { ...prevMode, name: newName, label: `🧳 ${newName}` };

      data.modes = modes;
      next.data = data;
      return next;
    });

    res = { ok: true };
  }

  if (!res?.ok) {
    shakeIfMotion({ store, overlay });
    safe(() => fx?.toast?.('No se pudo guardar la lista 🙄'));
    safe(() => fx?.haptic?.(14));
    return;
  }

  modal?.close?.('modeEditor');
  safe(() => fx?.toast?.('Lista actualizada ✨'));
  safe(() => fx?.haptic?.(8));
  onAfterStateChange?.();
}

function deleteModeEditor({ els, store, actions, fx, modal, onAfterStateChange }) {
  const state = store?.getState?.() || {};
  const overlay = resolveModeEditorOverlay(els);
  const selectEl = resolveModeEditorSelect(els);

  const modeKey = String(
    overlay?.dataset?.modeKey ||
    selectEl?.value ||
    getCurrentMode(state) ||
    ''
  ).trim();

  if (!modeKey) return;

  const ok = confirm(`¿Borrar la lista "${modeKey}"?`);
  if (!ok) return;

  let res = null;

  if (typeof actions?.deleteMode === 'function') {
    res = actions.deleteMode(modeKey);
  } else {
    safe(() => fx?.toast?.('Falta conectar deleteMode en actions.js'));
    safe(() => fx?.haptic?.(12));
    return;
  }

  if (!res?.ok) {
    safe(() => fx?.toast?.('No se pudo borrar esa lista'));
    safe(() => fx?.haptic?.(14));
    return;
  }

  modal?.close?.('modeEditor');
  onAfterStateChange?.();
}

/* =========================
   Edit convenience
========================= */

export function openEditById({ els, store, fx, modal, id }) {
  if (!els?.editOverlay) return;

  const cleanId = String(id ?? '').trim();
  if (!cleanId) return;

  const s = store?.getState?.() || {};
  const mode = getCurrentMode(s);

  const items = getItemsForMode(s, mode);
  const it = items.find(x => x && String(x.id) === cleanId);

  if (!it) {
    safe(() => fx?.toast?.('No encontré ese item 🤨'));
    safe(() => fx?.haptic?.(14));
    return;
  }

  els.editOverlay.dataset.editingId = cleanId;

  if (els.editName) els.editName.value = String(it.name || '');
  if (els.editEmoji) els.editEmoji.value = String(it.emoji || '');
  if (els.editCat) els.editCat.value = String(it.cat || 'otros');

  if (els.dupMode) {
    const currentMode = String(mode || 'salida');
    if (selectHasValue(els.dupMode, currentMode)) {
      els.dupMode.value = currentMode;
    }
  }

  modal?.open?.('edit', {
    returnFocusEl: document.activeElement,
    focusEl: els.editName
  });
}

/* =========================
   Mode-aware access
========================= */

function getCurrentMode(state) {
  return String(state?.settings?.tripMode || state?.data?.mode || 'salida');
}

function getItemsForMode(state, mode) {
  if (state?.data?.itemsByMode && typeof state.data.itemsByMode === 'object') {
    const arr = state.data.itemsByMode[mode];
    return Array.isArray(arr) ? arr : [];
  }
  return Array.isArray(state?.data?.items) ? state.data.items : [];
}

function getModeData(state, mode) {
  const key = String(mode || '').trim();
  if (!key) return null;

  if (state?.data?.modes && typeof state.data.modes === 'object' && state.data.modes[key]) {
    return {
      ...state.data.modes[key],
      items: getItemsForMode(state, key)
    };
  }

  if (state?.data?.modesById && typeof state.data.modesById === 'object' && state.data.modesById[key]) {
    return {
      ...state.data.modesById[key],
      items: getItemsForMode(state, key)
    };
  }

  return {
    key,
    name: key,
    label: key,
    items: getItemsForMode(state, key)
  };
}

/* =========================
   Resolver helpers
========================= */

function resolveModeEditorOverlay(els) {
  return (
    els?.modeEditorOverlay ||
    els?.modesOverlay ||
    null
  );
}

function resolveModeEditButton(els) {
  return (
    els?.btnEditMode ||
    els?.tripModeEditBtn ||
    els?.btnTripModeEdit ||
    els?.modeEditBtn ||
    els?.btnManageModes ||
    null
  );
}

function resolveModeEditorCloseButton(els) {
  return (
    els?.btnCloseModeEditor ||
    els?.btnCloseModes ||
    null
  );
}

function resolveModeEditorSaveButton(els) {
  return (
    els?.btnSaveModeEditor ||
    els?.btnSaveMode ||
    els?.btnCreateMode ||
    null
  );
}

function resolveModeEditorDeleteButton(els) {
  return (
    els?.btnDeleteModeEditor ||
    els?.btnDeleteMode ||
    null
  );
}

function resolveModeEditorNameInput(els) {
  return (
    els?.modeNameInput ||
    els?.modeEditorName ||
    els?.newModeName ||
    null
  );
}

function resolveModeEditorSelect(els) {
  return (
    els?.modeEditorSelect ||
    null
  );
}

function resolveModeItemsCountEl(els) {
  return (
    els?.modeItemsCount ||
    null
  );
}

function selectHasValue(selectEl, value) {
  if (!selectEl || !('options' in selectEl)) return false;
  return Array.from(selectEl.options || []).some(opt => String(opt.value) === String(value));
}

function stripLeadingEmoji(text = '') {
  return String(text)
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .trim();
}

/* =========================
   Generic helpers
========================= */

function bindEnterEsc(el, onEnter, onEsc) {
  if (!el) return;

  bindOnce(el, '__bindEnterEsc__', 'keydown', (e) => {
    if (e.isComposing) return;

    if (e.key === 'Enter') {
      e.preventDefault();
      onEnter?.();
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      onEsc?.();
    }
  });
}

function bindToggleChange(el, handler) {
  if (!el) return;

  bindOnce(el, '__bindToggleChange__', 'change', () => {
    const checked = !!el.checked;
    syncToggleVisualState(el, checked);
    handler?.({ checked, el });
  });

  const wrapper = findToggleWrapper(el);
  if (wrapper && wrapper !== el) {
    bindClick(wrapper, (e) => {
      const tag = String(e?.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'label') return;

      if (typeof el.click === 'function') {
        el.click();
      } else {
        el.checked = !el.checked;
        syncToggleVisualState(el, !!el.checked);
        handler?.({ checked: !!el.checked, el });
      }
    }, '__toggleWrapperClick__');
  }
}

function syncToggleVisualState(inputEl, checked) {
  if (!inputEl) return;

  const isOn = !!checked;
  const wrapper = findToggleWrapper(inputEl);

  inputEl.setAttribute('aria-checked', String(isOn));

  if (wrapper) {
    wrapper.classList.toggle('active', isOn);
    wrapper.classList.toggle('isOn', isOn);
    wrapper.setAttribute('aria-checked', String(isOn));
  }

  inputEl.classList.toggle?.('active', isOn);
  inputEl.classList.toggle?.('isOn', isOn);
}

function findToggleWrapper(inputEl) {
  if (!inputEl) return null;

  return (
    inputEl.closest?.('.toggle') ||
    inputEl.closest?.('.switch') ||
    inputEl.parentElement ||
    inputEl
  );
}

function shakeIfMotion({ store, overlay }) {
  const motion = !!store?.getState?.()?.settings?.motion;
  if (!motion) return;

  const modal = overlay?.querySelector?.('.modal') || overlay?.querySelector?.('[data-modal]') || overlay;
  if (!modal) return;

  modal.classList.remove('shake');
  void modal.offsetWidth;
  modal.classList.add('shake');
}

function getFocusables(root) {
  if (!root?.querySelectorAll) return [];

  return Array.from(root.querySelectorAll(
    [
      'button:not([disabled])',
      '[href]',
      'input:not([disabled]):not([type="hidden"])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])'
    ].join(', ')
  )).filter(el => {
    if (!isElementVisible(el)) return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
    return true;
  });
}

function isElementVisible(el) {
  if (!el) return false;
  const style = window.getComputedStyle?.(el);
  if (!style) return true;
  return style.display !== 'none' && style.visibility !== 'hidden';
}

function bindClick(el, handler, key = '__bindClick__') {
  if (!el) return;
  bindOnce(el, key, 'click', handler);
}

function bindChange(el, handler, key = '__bindChange__') {
  if (!el) return;
  bindOnce(el, key, 'change', handler);
}

function bindOnce(target, key, type, handler, options) {
  if (!target || !type || !handler) return;
  if (!target.__uiBoundHandlers) target.__uiBoundHandlers = new Map();

  const mapKey = `${key}:${type}`;
  if (target.__uiBoundHandlers.has(mapKey)) return;

  target.addEventListener(type, handler, options);
  target.__uiBoundHandlers.set(mapKey, handler);
}

function safe(fn) {
  try { fn?.(); } catch {}
}

function isDevEnv() {
  try {
    const h = location.hostname;
    const p = location.protocol;
    if (p === 'file:') return true;
    return h === 'localhost' || h === '127.0.0.1' || h === '';
  } catch {
    return false;
  }
}