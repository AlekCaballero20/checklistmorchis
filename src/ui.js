/* ============================================================================
  /src/ui.js
  UI glue para el sistema nuevo de listas

  MODELO NUEVO
  - state.currentListId
  - state.lists
  - state.itemsByListId
  - state.settings

  RESPONSABILIDAD
  - abrir / cerrar modales
  - conectar botones
  - sincronizar inputs
  - crear / editar / borrar listas
  - crear / editar / copiar items
  - focus management
============================================================================ */

'use strict';

export function initUI(cfg = {}) {
  const { els, store, actions, fx, storage, onAfterStateChange } = cfg;
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
  bindListEditor({ els, store, actions, fx, modal, onAfterStateChange });

  store?.subscribe?.((prev, next) => {
    if (
      prev?.settings !== next?.settings ||
      prev?.lists !== next?.lists ||
      prev?.currentListId !== next?.currentListId ||
      prev?.itemsByListId !== next?.itemsByListId
    ) {
      syncSettingsInputs(els, next);
      syncListEditorSnapshot({ els, store });
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

/* ============================================================================
  PUBLIC API
============================================================================ */

function createPublicAPI({ els, store, fx, actions, onAfterStateChange, modal, devBypass }) {
  return {
    enforceMobileOnly: () => enforceMobileOnly(els, { devBypass }),

    openSettings: (opts) => modal?.open?.('settings', opts),
    closeSettings: () => modal?.close?.('settings'),

    openAdd: (opts) => modal?.open?.('add', opts),
    closeAdd: () => modal?.close?.('add'),

    openEdit: (opts) => modal?.open?.('edit', opts),
    closeEdit: () => modal?.close?.('edit'),

    openListEditor: (opts) => openListEditor({
      els, store, actions, fx, modal, onAfterStateChange, ...(opts || {})
    }),
    closeListEditor: () => modal?.close?.('listEditor'),

    openEditById: (id) => openEditById({ els, store, fx, modal, id }),

    sync: () => {
      syncSettingsInputs(els, store?.getState?.());
      syncListEditorSnapshot({ els, store });
    }
  };
}

/* ============================================================================
  MOBILE ONLY
============================================================================ */

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

/* ============================================================================
  BUTTONS
============================================================================ */

function bindButtons({ els, actions, fx, storage, modal, onAfterStateChange, store }) {
  if (!els) return;

  bindClick(els.btnReset, () => {
    safe(() => fx?.unlockAudio?.());
    safe(() => actions?.resetChecks?.());
    onAfterStateChange?.();
  });

  bindClick(els.btnAdd, () => {
    safe(() => fx?.unlockAudio?.());

    if (els.newModeTarget) {
      const currentListId = getCurrentListId(store?.getState?.());
      if (selectHasValue(els.newModeTarget, currentListId)) {
        els.newModeTarget.value = currentListId;
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
    const ok = confirm('¿Seguro que quieres borrar TODO?');
    if (!ok) return;

    safe(() => storage?.wipeAllStorage?.());
    safe(() => actions?.wipeAll?.());
    modal?.close?.('settings');
    onAfterStateChange?.();
  });

  bindClick(resolveListEditButton(els), () => {
    safe(() => fx?.unlockAudio?.());
    openListEditor({
      els,
      store,
      actions,
      fx,
      modal,
      onAfterStateChange,
      returnFocusEl: resolveListEditButton(els)
    });
  }, '__listEditMainClick__');
}

/* ============================================================================
  OVERLAYS / MODALS
============================================================================ */

function bindOverlays({ els, modal }) {
  if (!els || !modal) return;

  bindClick(els.btnCloseSettings, () => modal.close('settings'));
  bindClick(els.btnCloseAdd, () => modal.close('add'));
  bindClick(els.btnCloseEdit, () => modal.close('edit'));
  bindClick(resolveListEditorCloseButton(els), () => modal.close('listEditor'), '__listEditorClose__');

  bindOverlayDismiss(els.settingsOverlay, () => modal.close('settings'));
  bindOverlayDismiss(els.addOverlay, () => modal.close('add'));
  bindOverlayDismiss(els.editOverlay, () => modal.close('edit'));
  bindOverlayDismiss(resolveListEditorOverlay(els), () => modal.close('listEditor'));

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

function createModalController({ els, fx }) {
  const listEditorOverlay = resolveListEditorOverlay(els);

  const overlays = {
    settings: els?.settingsOverlay || null,
    add: els?.addOverlay || null,
    edit: els?.editOverlay || null,
    listEditor: listEditorOverlay || null
  };

  const defaultFocus = {
    settings: () => getFocusables(overlays.settings)[0] || overlays.settings,
    add: () => els?.newName || getFocusables(overlays.add)[0] || overlays.add,
    edit: () => els?.editName || getFocusables(overlays.edit)[0] || overlays.edit,
    listEditor: () =>
      resolveListEditorNameInput(els) ||
      resolveListEditorSelect(els) ||
      getFocusables(overlays.listEditor)[0] ||
      overlays.listEditor
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

    stack = stack.filter((x) => x !== name);
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

    stack = stack.filter((x) => x !== name);

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
    if (els?.newCat && selectHasValue(els.newCat, 'general') && !els.newCat.value) {
      els.newCat.value = 'general';
    }
    if (els?.newModeTarget) {
      const currentListId = getCurrentListId();
      if (selectHasValue(els.newModeTarget, currentListId)) {
        els.newModeTarget.value = currentListId;
      }
    }
  }

  if (name === 'edit') {
    if (overlay.dataset && overlay.dataset.editingId == null) {
      overlay.dataset.editingId = '';
    }
  }

  if (name === 'listEditor') {
    if (overlay.dataset && overlay.dataset.listId == null) {
      overlay.dataset.listId = '';
    }
  }
}

function cleanupModalClose(name, overlay) {
  if (!overlay) return;

  if (name === 'edit' && overlay.dataset) {
    overlay.dataset.editingId = '';
  }

  if (name === 'listEditor' && overlay.dataset) {
    overlay.dataset.listId = '';
  }
}

/* ============================================================================
  SETTINGS
============================================================================ */

function syncSettingsInputs(els, state) {
  if (!els) return;

  const s = state?.settings || {};
  const currentListId = getCurrentListId(state);

  if (els.tripMode && selectHasValue(els.tripMode, currentListId)) {
    els.tripMode.value = currentListId;
  }

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

  if (els.newModeTarget && selectHasValue(els.newModeTarget, currentListId)) {
    els.newModeTarget.value = currentListId;
  }

  if (els.dupMode && selectHasValue(els.dupMode, currentListId) && !els.dupMode.value) {
    els.dupMode.value = currentListId;
  }
}

function bindSettingsInputs({ els, store, actions, fx, onAfterStateChange }) {
  if (!els) return;

  bindChange(els.tripMode, () => {
    const listId = String(els.tripMode.value || '').trim();
    safe(() => actions?.selectList?.(listId));
    onAfterStateChange?.();
  });

  bindToggleChange(els.toggleMotion, ({ checked }) => {
    if (typeof actions?.setMotion === 'function') {
      actions.setMotion(checked);
    } else {
      safeSetState(store, (prev) => ({
        ...prev,
        settings: { ...(prev.settings || {}), motion: checked }
      }));
    }

    safe(() => fx?.toast?.(checked ? 'Animaciones ON ✨' : 'Animaciones OFF 🧊'));
    safe(() => fx?.haptic?.(10));
    onAfterStateChange?.();
  });

  bindToggleChange(els.toggleSound, ({ checked }) => {
    if (typeof actions?.setSound === 'function') {
      actions.setSound(checked);
    } else {
      safeSetState(store, (prev) => ({
        ...prev,
        settings: { ...(prev.settings || {}), sound: checked }
      }));
    }

    safe(() => fx?.toast?.(checked ? 'Sonidito ON 🔔' : 'Sonidito OFF 🤫'));
    safe(() => fx?.haptic?.(10));
    onAfterStateChange?.();
  });
}

/* ============================================================================
  ADD MODAL
============================================================================ */

function bindAddModal({ els, actions, fx, modal, onAfterStateChange, store }) {
  if (!els) return;

  let busy = false;

  const doCreate = () => {
    if (busy) return;
    busy = true;

    const text = (els.newName?.value || '').trim();
    const emoji = (els.newEmoji?.value || '').trim();
    const category = String(els.newCat?.value || 'general');
    const listId = String(
      els.newModeTarget?.value ||
      getCurrentListId(store?.getState?.()) ||
      ''
    );

    const res = actions?.createItem?.({
      text,
      emoji,
      category,
      listId
    });

    if (!res?.ok) {
      shakeIfMotion({ store, overlay: els.addOverlay });
      safe(() => fx?.haptic?.(14));
      busy = false;
      return;
    }

    modal?.close?.('add');
    onAfterStateChange?.();

    setTimeout(() => {
      busy = false;
    }, 120);
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

/* ============================================================================
  EDIT MODAL
============================================================================ */

function bindEditModal({ els, actions, fx, modal, onAfterStateChange, store }) {
  if (!els) return;

  let busySave = false;
  let busyCopy = false;

  const getEditingId = () => String(els.editOverlay?.dataset?.editingId || '').trim();

  const doSave = () => {
    if (busySave) return;
    busySave = true;

    const id = getEditingId();
    if (!id) {
      busySave = false;
      return;
    }

    const text = (els.editName?.value || '').trim();
    const emoji = (els.editEmoji?.value || '').trim();
    const category = String(els.editCat?.value || 'general');

    const res = actions?.editItem?.(id, { text, emoji, category });

    if (!res?.ok) {
      shakeIfMotion({ store, overlay: els.editOverlay });
      safe(() => fx?.haptic?.(14));
      busySave = false;
      return;
    }

    modal?.close?.('edit');
    onAfterStateChange?.();

    setTimeout(() => {
      busySave = false;
    }, 120);
  };

  const doCopyToList = () => {
    if (busyCopy) return;
    busyCopy = true;

    const id = getEditingId();
    if (!id) {
      busyCopy = false;
      return;
    }

    const currentListId = getCurrentListId(store?.getState?.());
    const targetListId = String(els.dupMode?.value || '').trim();

    if (!targetListId) {
      safe(() => fx?.toast?.('Escoge una lista 🙃'));
      safe(() => fx?.haptic?.(14));
      busyCopy = false;
      return;
    }

    if (targetListId === currentListId) {
      safe(() => fx?.toast?.('Ese ítem ya está en esta lista 😌'));
      safe(() => fx?.haptic?.(8));
      busyCopy = false;
      return;
    }

    let res = null;

    if (typeof actions?.copyItemToList === 'function') {
      res = actions.copyItemToList(id, targetListId);
    } else if (typeof actions?.duplicateItem === 'function') {
      res = actions.duplicateItem(id, { listId: targetListId });
    } else {
      res = { ok: false, reason: 'MISSING_HANDLER' };
    }

    if (!res?.ok) {
      safe(() => fx?.toast?.('No se pudo agregar a esa lista 🙄'));
      safe(() => fx?.haptic?.(14));
      busyCopy = false;
      return;
    }

    safe(() => fx?.toast?.('Agregado a la otra lista ✅'));
    safe(() => fx?.haptic?.(10));
    onAfterStateChange?.();

    setTimeout(() => {
      busyCopy = false;
    }, 120);
  };

  bindClick(els.btnSaveEdit, () => {
    safe(() => fx?.unlockAudio?.());
    doSave();
  });

  bindClick(els.btnAddToMode, () => {
    safe(() => fx?.unlockAudio?.());
    doCopyToList();
  });

  bindEnterEsc(els.editName, () => els.btnSaveEdit?.click(), () => modal?.close?.('edit'));
  bindEnterEsc(els.editEmoji, () => els.btnSaveEdit?.click(), () => modal?.close?.('edit'));
  bindEnterEsc(els.editCat, () => els.btnSaveEdit?.click(), () => modal?.close?.('edit'));
  bindEnterEsc(els.dupMode, () => els.btnAddToMode?.click(), () => modal?.close?.('edit'));
}

/* ============================================================================
  LIST EDITOR
============================================================================ */

function bindListEditor({ els, store, actions, fx, modal, onAfterStateChange }) {
  if (!els) return;

  const trigger = resolveListEditButton(els);
  if (trigger) {
    bindClick(trigger, () => {
      openListEditor({
        els,
        store,
        actions,
        fx,
        modal,
        onAfterStateChange,
        returnFocusEl: trigger
      });
    }, '__listEditorTrigger__');
  }

  const saveBtn = resolveListEditorSaveButton(els);
  const deleteBtn = resolveListEditorDeleteButton(els);

  bindClick(saveBtn, () => {
    saveListEditor({ els, store, actions, fx, modal, onAfterStateChange });
  }, '__listEditorSave__');

  bindClick(deleteBtn, () => {
    deleteListEditor({ els, store, actions, fx, modal, onAfterStateChange });
  }, '__listEditorDelete__');

  bindChange(resolveListEditorSelect(els), () => {
    syncListEditorSnapshot({ els, store, preferSelected: true });
  }, '__listEditorSelectChange__');

  bindEnterEsc(
    resolveListEditorNameInput(els),
    () => resolveListEditorSaveButton(els)?.click?.(),
    () => modal?.close?.('listEditor')
  );

  bindEnterEsc(
    resolveListEditorSelect(els),
    () => resolveListEditorSaveButton(els)?.click?.(),
    () => modal?.close?.('listEditor')
  );
}

function openListEditor({ els, store, actions, fx, modal, onAfterStateChange, returnFocusEl } = {}) {
  const state = store?.getState?.() || {};
  const currentListId = getCurrentListId(state);

  if (typeof actions?.getListInfo === 'function') {
    safe(() => actions.getListInfo(currentListId));
  }

  const overlay = resolveListEditorOverlay(els);
  if (overlay && modal) {
    const selectEl = resolveListEditorSelect(els);

    if (overlay.dataset) {
      overlay.dataset.listId = currentListId;
    }

    if (selectEl && selectHasValue(selectEl, currentListId)) {
      selectEl.value = String(currentListId || '');
    }

    syncListEditorSnapshot({ els, store, listId: currentListId });

    modal.open('listEditor', {
      returnFocusEl: returnFocusEl || document.activeElement,
      focusEl: resolveListEditorNameInput(els) || selectEl
    });
    return;
  }

  safe(() => fx?.toast?.('El editor de listas aún no está conectado del todo 👀'));
  safe(() => fx?.haptic?.(10));
}

function saveListEditor({ els, store, actions, fx, modal, onAfterStateChange }) {
  const state = store?.getState?.() || {};
  const overlay = resolveListEditorOverlay(els);
  const selectEl = resolveListEditorSelect(els);
  const nameInput = resolveListEditorNameInput(els);

  const selectedListId = String(
    overlay?.dataset?.listId ||
    selectEl?.value ||
    getCurrentListId(state) ||
    ''
  ).trim();

  const typedName = String(nameInput?.value || '').trim();

  if (!typedName) {
    shakeIfMotion({ store, overlay });
    safe(() => fx?.toast?.('Ponle un nombre a la lista'));
    safe(() => fx?.haptic?.(14));
    return;
  }

  const selectedList = getListById(selectedListId, state);
  const existingListWithSameName = findListByDisplayName(state, typedName);

  if (existingListWithSameName && existingListWithSameName.id !== selectedListId) {
    if (selectEl && selectHasValue(selectEl, existingListWithSameName.id)) {
      selectEl.value = existingListWithSameName.id;
    }
    if (overlay?.dataset) overlay.dataset.listId = existingListWithSameName.id;
    syncListEditorSnapshot({ els, store, listId: existingListWithSameName.id });

    safe(() => fx?.toast?.('Ya existe una lista con ese nombre 😌'));
    safe(() => fx?.haptic?.(8));
    return;
  }

  if (selectedList && normalizeText(typedName) === normalizeText(selectedList.name || '')) {
    const res = updateExistingList({
      actions,
      store,
      listId: selectedListId,
      newName: typedName
    });

    if (!res?.ok) {
      shakeIfMotion({ store, overlay });
      safe(() => fx?.toast?.('No se pudo guardar la lista 🙄'));
      safe(() => fx?.haptic?.(14));
      return;
    }

    modal?.close?.('listEditor');
    safe(() => fx?.toast?.('Lista actualizada ✨'));
    safe(() => fx?.haptic?.(8));
    onAfterStateChange?.();
    return;
  }

  let shouldCreateNew = true;

  if (selectedList) {
    shouldCreateNew = confirm(
      `El nombre es diferente a la lista seleccionada.\n\n` +
      `Aceptar = crear una lista nueva llamada "${typedName}"\n` +
      `Cancelar = renombrar la lista actual`
    );
  }

  if (shouldCreateNew) {
    const createRes = createNewList({
      store,
      actions,
      newName: typedName
    });

    if (!createRes?.ok) {
      shakeIfMotion({ store, overlay });
      safe(() => fx?.toast?.('No se pudo crear la lista 🙄'));
      safe(() => fx?.haptic?.(14));
      return;
    }

    const newId = String(createRes.listId || '').trim();

    if (overlay?.dataset) overlay.dataset.listId = newId;
    if (selectEl && selectHasValue(selectEl, newId)) {
      selectEl.value = newId;
    }

    if (typeof actions?.selectList === 'function' && newId) {
      safe(() => actions.selectList(newId));
    } else {
      safeSetState(store, (prev) => ({
        ...(prev || {}),
        currentListId: newId || getCurrentListId(prev || {})
      }));
    }

    modal?.close?.('listEditor');
    safe(() => fx?.toast?.('Lista nueva creada ✅'));
    safe(() => fx?.haptic?.(10));
    onAfterStateChange?.();
    return;
  }

  if (!selectedListId) {
    shakeIfMotion({ store, overlay });
    safe(() => fx?.toast?.('No encontré la lista para renombrar 😑'));
    safe(() => fx?.haptic?.(14));
    return;
  }

  const renameRes = updateExistingList({
    actions,
    store,
    listId: selectedListId,
    newName: typedName
  });

  if (!renameRes?.ok) {
    shakeIfMotion({ store, overlay });
    safe(() => fx?.toast?.('No se pudo renombrar la lista 🙄'));
    safe(() => fx?.haptic?.(14));
    return;
  }

  modal?.close?.('listEditor');
  safe(() => fx?.toast?.('Lista renombrada ✨'));
  safe(() => fx?.haptic?.(8));
  onAfterStateChange?.();
}

function deleteListEditor({ els, store, actions, fx, modal, onAfterStateChange }) {
  const state = store?.getState?.() || {};
  const overlay = resolveListEditorOverlay(els);
  const selectEl = resolveListEditorSelect(els);

  const listId = String(
    overlay?.dataset?.listId ||
    selectEl?.value ||
    getCurrentListId(state) ||
    ''
  ).trim();

  if (!listId) return;

  const list = getListById(listId, state);
  const label = list?.name || 'esta lista';

  const ok = confirm(`¿Borrar la lista "${label}"?`);
  if (!ok) return;

  let res = null;

  if (typeof actions?.deleteList === 'function') {
    res = actions.deleteList(listId);
  } else if (typeof actions?.deleteMode === 'function') {
    res = actions.deleteMode(listId);
  } else {
    safe(() => fx?.toast?.('Falta conectar deleteList en actions.js'));
    safe(() => fx?.haptic?.(12));
    return;
  }

  if (!res?.ok) {
    safe(() => fx?.toast?.('No se pudo borrar esa lista'));
    safe(() => fx?.haptic?.(14));
    return;
  }

  modal?.close?.('listEditor');
  onAfterStateChange?.();
}

function syncListEditorSnapshot({ els, store, listId = '', preferSelected = false } = {}) {
  const state = store?.getState?.() || {};
  const overlay = resolveListEditorOverlay(els);
  const selectEl = resolveListEditorSelect(els);
  const nameInput = resolveListEditorNameInput(els);
  const countEl = resolveListItemsCountEl(els);

  const resolvedListId = String(
    listId ||
    (preferSelected ? selectEl?.value : '') ||
    overlay?.dataset?.listId ||
    selectEl?.value ||
    getCurrentListId(state) ||
    ''
  ).trim();

  if (!resolvedListId) return;

  if (overlay?.dataset) overlay.dataset.listId = resolvedListId;

  const list = getListById(resolvedListId, state);
  const items = getItemsForList(state, resolvedListId);

  if (nameInput && document.activeElement !== nameInput) {
    nameInput.value = String(list?.name || '');
  }

  if (selectEl && selectHasValue(selectEl, resolvedListId)) {
    selectEl.value = resolvedListId;
  }

  if (countEl) {
    countEl.textContent = String(items.length);
  }
}

/* ============================================================================
  EDIT CONVENIENCE
============================================================================ */

export function openEditById({ els, store, fx, modal, id }) {
  if (!els?.editOverlay) return;

  const cleanId = String(id ?? '').trim();
  if (!cleanId) return;

  const state = store?.getState?.() || {};
  const currentListId = getCurrentListId(state);
  const items = getItemsForList(state, currentListId);
  const item = items.find((x) => x && String(x.id) === cleanId);

  if (!item) {
    safe(() => fx?.toast?.('No encontré ese ítem 🤨'));
    safe(() => fx?.haptic?.(14));
    return;
  }

  els.editOverlay.dataset.editingId = cleanId;

  if (els.editName) els.editName.value = String(item.text || '');
  if (els.editEmoji) els.editEmoji.value = String(item.emoji || '');
  if (els.editCat && selectHasValue(els.editCat, String(item.category || 'general'))) {
    els.editCat.value = String(item.category || 'general');
  }

  if (els.dupMode) {
    const current = String(currentListId || '');
    if (selectHasValue(els.dupMode, current)) {
      els.dupMode.value = current;
    }
  }

  modal?.open?.('edit', {
    returnFocusEl: document.activeElement,
    focusEl: els.editName
  });
}

/* ============================================================================
  STATE ACCESS HELPERS
============================================================================ */

function getCurrentListId(state) {
  return String(state?.currentListId || '').trim();
}

function getListById(listId, state) {
  const cleanId = String(listId || '').trim();
  const lists = Array.isArray(state?.lists) ? state.lists : [];
  return lists.find((list) => String(list?.id || '') === cleanId) || null;
}

function getItemsForList(state, listId) {
  const cleanId = String(listId || '').trim();
  const map = state?.itemsByListId && typeof state.itemsByListId === 'object'
    ? state.itemsByListId
    : {};

  return Array.isArray(map[cleanId]) ? map[cleanId] : [];
}

function findListByDisplayName(state, targetName) {
  const wanted = normalizeText(targetName);
  const lists = Array.isArray(state?.lists) ? state.lists : [];

  for (const list of lists) {
    const displayName = String(list?.name || '').trim();
    if (normalizeText(displayName) === wanted) {
      return list;
    }
  }

  return null;
}

function normalizeText(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function updateExistingList({ actions, store, listId, newName }) {
  if (!listId || !newName) return { ok: false, reason: 'INVALID_DATA' };

  let res = null;

  if (typeof actions?.updateList === 'function') {
    res = actions.updateList(listId, { name: newName });
  } else if (typeof actions?.renameList === 'function') {
    res = actions.renameList(listId, newName);
  } else if (typeof actions?.updateMode === 'function') {
    res = actions.updateMode(listId, { name: newName });
  } else if (typeof actions?.renameMode === 'function') {
    res = actions.renameMode(listId, newName);
  } else {
    safeSetState(store, (prev) => {
      const next = { ...(prev || {}) };
      next.lists = Array.isArray(next.lists)
        ? next.lists.map((list) => (
            String(list?.id || '') === String(listId)
              ? { ...list, name: newName }
              : list
          ))
        : [];
      return next;
    });

    res = { ok: true, listId };
  }

  return res || { ok: false };
}

function createNewList({ store, actions, newName }) {
  if (!newName) return { ok: false, reason: 'EMPTY_NAME' };

  let res = null;

  if (typeof actions?.createList === 'function') {
    res = actions.createList({ name: newName });
    if (res?.ok) return res;
  }

  if (typeof actions?.createMode === 'function') {
    res = actions.createMode({ name: newName });
    if (res?.ok) {
      return {
        ...res,
        listId: res.listId || res.modeKey || null
      };
    }
  }

  const id = `list_${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;

  safeSetState(store, (prev) => {
    const next = { ...(prev || {}) };
    const lists = Array.isArray(next.lists) ? [...next.lists] : [];
    const itemsByListId =
      next.itemsByListId && typeof next.itemsByListId === 'object'
        ? { ...next.itemsByListId }
        : {};

    lists.unshift({
      id,
      name: newName,
      icon: '🧾',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    itemsByListId[id] = [];

    next.lists = lists;
    next.itemsByListId = itemsByListId;
    next.currentListId = id;

    return next;
  });

  return { ok: true, listId: id };
}

/* ============================================================================
  RESOLVERS
============================================================================ */

function resolveListEditorOverlay(els) {
  return (
    els?.listEditorOverlay ||
    els?.modesOverlay ||
    null
  );
}

function resolveListEditButton(els) {
  return (
    els?.btnEditList ||
    els?.tripModeEditBtn ||
    els?.btnTripModeEdit ||
    els?.listEditBtn ||
    els?.btnManageModes ||
    null
  );
}

function resolveListEditorCloseButton(els) {
  return (
    els?.btnCloseListEditor ||
    els?.btnCloseModes ||
    null
  );
}

function resolveListEditorSaveButton(els) {
  return (
    els?.btnSaveListEditor ||
    els?.btnSaveMode ||
    els?.btnCreateMode ||
    null
  );
}

function resolveListEditorDeleteButton(els) {
  return (
    els?.btnDeleteListEditor ||
    els?.btnDeleteMode ||
    null
  );
}

function resolveListEditorNameInput(els) {
  return (
    els?.listNameInput ||
    els?.modeEditorName ||
    els?.newModeName ||
    null
  );
}

function resolveListEditorSelect(els) {
  return (
    els?.modeEditorSelect ||
    null
  );
}

function resolveListItemsCountEl(els) {
  return (
    els?.modeItemsCount ||
    null
  );
}

function selectHasValue(selectEl, value) {
  if (!selectEl || !('options' in selectEl)) return false;
  return Array.from(selectEl.options || []).some((opt) => String(opt.value) === String(value));
}

/* ============================================================================
  GENERIC HELPERS
============================================================================ */

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
  )).filter((el) => {
    if (!isElementVisible(el)) return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
    if (el.closest?.('[aria-hidden="true"]')) return false;
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

function safeSetState(store, updater) {
  if (!store?.setState || typeof updater !== 'function') return;

  try {
    const prev = store.getState?.();
    const next = updater(prev);
    if (next && typeof next === 'object') {
      store.setState(next);
    }
  } catch {}
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