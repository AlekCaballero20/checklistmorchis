'use strict';

export function createActions({ getState, setState, deps = {} } = {}) {
  const saveState = typeof deps.saveState === 'function' ? deps.saveState : () => {};
  const saveSettings = typeof deps.saveSettings === 'function' ? deps.saveSettings : () => {};
  const uid = typeof deps.uid === 'function' ? deps.uid : null;

  const toast = typeof deps.toast === 'function' ? deps.toast : null;
  const haptic = typeof deps.haptic === 'function' ? deps.haptic : null;
  const tickSound = typeof deps.tickSound === 'function' ? deps.tickSound : null;

  const DEFAULT_LIST_NAME = 'Mi lista';
  const DEFAULT_LIST_ICON = '🧾';
  const DEFAULT_CATEGORY = 'general';
  const DEFAULT_SETTINGS = {
    motion: true,
    sound: true,
    streak: 0
  };

  /* ==========================================================================
    SAFE SIDE EFFECTS
  ========================================================================== */

  function safeToast(message) {
    try { toast?.(message); } catch {}
  }

  function safeHaptic(ms = 10) {
    try { haptic?.(ms); } catch {}
  }

  function safeTick() {
    try { tickSound?.(); } catch {}
  }

  /* ==========================================================================
    GENERIC HELPERS
  ========================================================================== */

  function nowIso() {
    try {
      return new Date().toISOString();
    } catch {
      return '';
    }
  }

  function ensureString(value, maxLen = 100) {
    const out = String(value ?? '').trim();
    return maxLen > 0 ? out.slice(0, maxLen) : out;
  }

  function isPlainObject(value) {
    return (
      value != null &&
      typeof value === 'object' &&
      (value.constructor === Object || Object.getPrototypeOf(value) === Object.prototype)
    );
  }

  function clone(value) {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return {};
    }
  }

  function clampInt(value, min, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return min;
    const i = Math.floor(n);
    return Math.min(max, Math.max(min, i));
  }

  function normalizeEmoji(value) {
    const clean = ensureString(value, 16);
    return clean || null;
  }

  function normalizeText(value) {
    return ensureString(value, 200)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function sanitizeCategory(value) {
    const clean = ensureString(value, 60)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s_-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^[-_]+|[-_]+$/g, '');

    return clean || DEFAULT_CATEGORY;
  }

  function sanitizeListName(value) {
    return ensureString(value, 80) || DEFAULT_LIST_NAME;
  }

  function makeId(prefix = 'id') {
    try {
      if (uid) {
        const external = String(uid()).trim();
        if (external) return external;
      }
    } catch {}

    return `${prefix}_${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
  }

  function normalizeSettings(raw = {}) {
    return {
      motion: Object.prototype.hasOwnProperty.call(raw || {}, 'motion')
        ? !!raw.motion
        : DEFAULT_SETTINGS.motion,
      sound: Object.prototype.hasOwnProperty.call(raw || {}, 'sound')
        ? !!raw.sound
        : DEFAULT_SETTINGS.sound,
      streak: clampInt(raw?.streak, 0, 999999)
    };
  }

  /* ==========================================================================
    RECORD FACTORIES
  ========================================================================== */

  function createListRecord({ name, icon, id, createdAt, updatedAt } = {}) {
    const now = nowIso();
    const existingId = ensureString(id, 120);

    return {
      id: existingId || makeId('list'),
      name: sanitizeListName(name),
      icon: normalizeEmoji(icon) || DEFAULT_LIST_ICON,
      createdAt: ensureString(createdAt, 40) || now,
      updatedAt: ensureString(updatedAt, 40) || now
    };
  }

  function createItemRecord(partial = {}) {
    const now = nowIso();
    const existingId = ensureString(partial.id, 120);

    return {
      id: existingId || makeId('item'),
      text: ensureString(
        partial.text ?? partial.name ?? partial.title ?? '',
        180
      ) || 'Nuevo ítem',
      checked: !!(partial.checked ?? partial.done),
      category: sanitizeCategory(
        partial.category ?? partial.cat ?? DEFAULT_CATEGORY
      ),
      emoji: normalizeEmoji(partial.emoji),
      notes: ensureString(partial.notes, 500) || '',
      createdAt: ensureString(partial.createdAt, 40) || now,
      updatedAt: ensureString(partial.updatedAt, 40) || now
    };
  }

  /* ==========================================================================
    STATE REPAIR
  ========================================================================== */

  function repairList(list) {
    if (!isPlainObject(list)) return null;

    return createListRecord({
      id: list.id,
      name: list.name ?? list.label ?? list.title,
      icon: list.icon,
      createdAt: list.createdAt,
      updatedAt: list.updatedAt
    });
  }

  function repairItems(items) {
    const source = Array.isArray(items) ? items : [];
    const out = [];
    const seen = new Set();

    for (const raw of source) {
      if (!isPlainObject(raw)) continue;

      const item = createItemRecord(raw);

      if (!item.id || seen.has(item.id)) {
        item.id = makeId('item');
      }

      seen.add(item.id);
      out.push(item);
    }

    return out;
  }

  function ensureAtLeastOneList(state) {
    const next = {
      version: Number(state?.version) || 1,
      savedAt: nowIso(),
      currentListId: state?.currentListId || null,
      settings: normalizeSettings(state?.settings),
      lists: Array.isArray(state?.lists) ? [...state.lists] : [],
      itemsByListId: isPlainObject(state?.itemsByListId) ? { ...state.itemsByListId } : {}
    };

    if (next.lists.length > 0) {
      if (!next.currentListId || !next.lists.some((list) => list.id === next.currentListId)) {
        next.currentListId = next.lists[0].id;
      }

      for (const list of next.lists) {
        if (!Array.isArray(next.itemsByListId[list.id])) {
          next.itemsByListId[list.id] = [];
        }
      }

      return next;
    }

    const firstList = createListRecord({
      name: DEFAULT_LIST_NAME,
      icon: DEFAULT_LIST_ICON
    });

    next.lists = [firstList];
    next.currentListId = firstList.id;
    next.itemsByListId[firstList.id] = [];

    return next;
  }

  function repairStateShape(rawState) {
    const base = isPlainObject(rawState) ? rawState : {};
    const lists = [];
    const seenListIds = new Set();

    for (const rawList of Array.isArray(base.lists) ? base.lists : []) {
      const fixed = repairList(rawList);
      if (!fixed) continue;
      if (!fixed.id) continue;
      if (seenListIds.has(fixed.id)) continue;

      seenListIds.add(fixed.id);
      lists.push(fixed);
    }

    const rawItemsByListId = isPlainObject(base.itemsByListId) ? base.itemsByListId : {};
    const itemsByListId = {};

    for (const list of lists) {
      itemsByListId[list.id] = repairItems(rawItemsByListId[list.id]);
    }

    let currentListId = ensureString(base.currentListId, 120) || null;
    if (!currentListId || !lists.some((list) => list.id === currentListId)) {
      currentListId = lists[0]?.id || null;
    }

    return ensureAtLeastOneList({
      version: Number(base.version) || 1,
      savedAt: nowIso(),
      currentListId,
      settings: normalizeSettings(base.settings),
      lists,
      itemsByListId
    });
  }

  function snapshot() {
    try {
      return repairStateShape(getState?.() || {});
    } catch {
      return ensureAtLeastOneList({
        version: 1,
        savedAt: nowIso(),
        currentListId: null,
        settings: DEFAULT_SETTINGS,
        lists: [],
        itemsByListId: {}
      });
    }
  }

  /* ==========================================================================
    STATE ACCESS
  ========================================================================== */

  function getCurrentList(state = null) {
    const s = state ? repairStateShape(state) : snapshot();
    return s.lists.find((list) => list.id === s.currentListId) || null;
  }

  function getCurrentListId(state = null) {
    return getCurrentList(state)?.id || null;
  }

  function getCurrentItems(state = null) {
    const s = state ? repairStateShape(state) : snapshot();
    const listId = getCurrentListId(s);
    if (!listId) return [];
    return Array.isArray(s.itemsByListId[listId]) ? s.itemsByListId[listId] : [];
  }

  function findListById(state, listId) {
    const cleanId = ensureString(listId, 120);
    return state.lists.find((list) => list.id === cleanId) || null;
  }

  function findListIndexById(state, listId) {
    const cleanId = ensureString(listId, 120);
    return state.lists.findIndex((list) => list.id === cleanId);
  }

  function findListByName(state, name, ignoreId = '') {
    const wanted = normalizeText(name);
    if (!wanted) return null;

    return state.lists.find((list) => {
      if (ignoreId && list.id === ignoreId) return false;
      return normalizeText(list.name) === wanted;
    }) || null;
  }

  function findItemIndexById(items, itemId) {
    const cleanId = ensureString(itemId, 120);
    return Array.isArray(items)
      ? items.findIndex((item) => item && item.id === cleanId)
      : -1;
  }

  function getListItems(state, listId) {
    const cleanId = ensureString(listId, 120);
    if (!cleanId) return [];
    return Array.isArray(state.itemsByListId[cleanId]) ? state.itemsByListId[cleanId] : [];
  }

  function getCompletionMeta(items = []) {
    const total = Array.isArray(items) ? items.length : 0;
    const checkedCount = total
      ? items.filter((item) => !!item?.checked).length
      : 0;

    return {
      total,
      checkedCount,
      completed: total > 0 && checkedCount === total
    };
  }

  function touchList(list) {
    return {
      ...list,
      updatedAt: nowIso()
    };
  }

  /* ==========================================================================
    COMMIT
  ========================================================================== */

  function commit(mutator, options = {}) {
    const persist = options.persist !== false;
    const previous = snapshot();
    const draft = clone(previous);
    const mutated = mutator(draft) || draft;
    const nextState = repairStateShape(mutated);

    try {
      setState?.(nextState);
    } catch {}

    if (persist) {
      try {
        saveState(nextState);
      } catch {}
    }

    return nextState;
  }

  function commitSettings(mutator) {
    const nextState = commit((draft) => {
      draft.settings = normalizeSettings(draft.settings);
      mutator(draft.settings, draft);
      draft.savedAt = nowIso();
      return draft;
    });

    try {
      saveSettings(nextState.settings);
    } catch {}

    return nextState;
  }

  /* ==========================================================================
    ITEMS
  ========================================================================== */

  function toggleDone(itemId) {
    const cleanId = ensureString(itemId, 120);
    if (!cleanId) return { ok: false, reason: 'BAD_ID' };

    let found = false;
    let nextChecked = false;
    let activeListId = null;

    const nextState = commit((draft) => {
      const listId = draft.currentListId;
      activeListId = listId;

      const items = Array.isArray(draft.itemsByListId[listId])
        ? [...draft.itemsByListId[listId]]
        : [];

      const index = findItemIndexById(items, cleanId);
      if (index < 0) return draft;

      const current = items[index];
      nextChecked = !current.checked;

      items[index] = {
        ...current,
        checked: nextChecked,
        updatedAt: nowIso()
      };

      draft.itemsByListId[listId] = items;
      draft.lists = draft.lists.map((list) =>
        list.id === listId ? touchList(list) : list
      );

      found = true;
      return draft;
    });

    if (!found) {
      return { ok: false, reason: 'NOT_FOUND' };
    }

    if (nextState.settings.sound) {
      safeTick();
    }

    safeHaptic(10);

    const items = getListItems(nextState, activeListId);
    const completion = getCompletionMeta(items);

    return {
      ok: true,
      checked: nextChecked,
      listId: activeListId,
      ...completion
    };
  }

  function createItem(payload = {}) {
    const text = ensureString(payload.text ?? payload.name ?? payload.title, 180);
    const targetListId = ensureString(payload.listId ?? payload.targetListId, 120);

    if (!text) {
      safeToast('Ponle nombre al ítem 🙃');
      safeHaptic(16);
      return { ok: false, reason: 'EMPTY_TEXT' };
    }

    let created = null;
    let usedListId = null;

    commit((draft) => {
      const listId =
        targetListId && findListById(draft, targetListId)
          ? targetListId
          : draft.currentListId;

      const items = Array.isArray(draft.itemsByListId[listId])
        ? [...draft.itemsByListId[listId]]
        : [];

      created = createItemRecord({
        text,
        checked: !!payload.checked,
        category: payload.category ?? payload.cat,
        emoji: payload.emoji,
        notes: payload.notes
      });

      items.unshift(created);
      draft.itemsByListId[listId] = items;
      draft.lists = draft.lists.map((list) =>
        list.id === listId ? touchList(list) : list
      );

      usedListId = listId;
      return draft;
    });

    safeToast('Ítem agregado ✅');
    safeHaptic(10);

    return {
      ok: true,
      item: created,
      itemId: created?.id || null,
      listId: usedListId
    };
  }

  function editItem(itemId, changes = {}) {
    const cleanId = ensureString(itemId, 120);
    if (!cleanId) return { ok: false, reason: 'BAD_ID' };

    const hasText =
      Object.prototype.hasOwnProperty.call(changes, 'text') ||
      Object.prototype.hasOwnProperty.call(changes, 'name') ||
      Object.prototype.hasOwnProperty.call(changes, 'title');

    const nextText = hasText
      ? ensureString(changes.text ?? changes.name ?? changes.title, 180)
      : null;

    if (hasText && !nextText) {
      safeToast('Ponle nombre al ítem 🙃');
      safeHaptic(16);
      return { ok: false, reason: 'EMPTY_TEXT' };
    }

    let found = false;

    commit((draft) => {
      const listId = draft.currentListId;
      const items = Array.isArray(draft.itemsByListId[listId])
        ? [...draft.itemsByListId[listId]]
        : [];

      const index = findItemIndexById(items, cleanId);
      if (index < 0) return draft;

      const current = items[index];

      items[index] = {
        ...current,
        ...(hasText ? { text: nextText } : {}),
        ...(Object.prototype.hasOwnProperty.call(changes, 'checked')
          ? { checked: !!changes.checked }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(changes, 'done')
          ? { checked: !!changes.done }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(changes, 'category') ||
        Object.prototype.hasOwnProperty.call(changes, 'cat')
          ? { category: sanitizeCategory(changes.category ?? changes.cat) }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(changes, 'emoji')
          ? { emoji: normalizeEmoji(changes.emoji) }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(changes, 'notes')
          ? { notes: ensureString(changes.notes, 500) }
          : {}),
        updatedAt: nowIso()
      };

      draft.itemsByListId[listId] = items;
      draft.lists = draft.lists.map((list) =>
        list.id === listId ? touchList(list) : list
      );

      found = true;
      return draft;
    });

    if (!found) return { ok: false, reason: 'NOT_FOUND' };

    safeToast('Ítem actualizado ✨');
    safeHaptic(8);

    return { ok: true };
  }

  function deleteItem(itemId) {
    const cleanId = ensureString(itemId, 120);
    if (!cleanId) return { ok: false, reason: 'BAD_ID' };

    let removed = false;

    commit((draft) => {
      const listId = draft.currentListId;
      const items = Array.isArray(draft.itemsByListId[listId])
        ? draft.itemsByListId[listId]
        : [];

      const filtered = items.filter((item) => item.id !== cleanId);
      removed = filtered.length !== items.length;

      if (!removed) return draft;

      draft.itemsByListId[listId] = filtered;
      draft.lists = draft.lists.map((list) =>
        list.id === listId ? touchList(list) : list
      );

      return draft;
    });

    if (!removed) return { ok: false, reason: 'NOT_FOUND' };

    safeToast('Ítem eliminado 🗑️');
    safeHaptic(10);

    return { ok: true };
  }

  function duplicateItem(itemId, options = {}) {
    const cleanId = ensureString(itemId, 120);
    if (!cleanId) return { ok: false, reason: 'BAD_ID' };

    let duplicated = null;

    commit((draft) => {
      const sourceListId = draft.currentListId;
      const targetListId =
        ensureString(options.listId, 120) && findListById(draft, options.listId)
          ? ensureString(options.listId, 120)
          : sourceListId;

      const sourceItems = Array.isArray(draft.itemsByListId[sourceListId])
        ? draft.itemsByListId[sourceListId]
        : [];

      const sourceIndex = findItemIndexById(sourceItems, cleanId);
      if (sourceIndex < 0) return draft;

      const source = sourceItems[sourceIndex];
      duplicated = createItemRecord({
        text: source.text,
        checked: false,
        category: source.category,
        emoji: source.emoji,
        notes: source.notes
      });

      const targetItems = Array.isArray(draft.itemsByListId[targetListId])
        ? [...draft.itemsByListId[targetListId]]
        : [];

      targetItems.unshift(duplicated);
      draft.itemsByListId[targetListId] = targetItems;
      draft.lists = draft.lists.map((list) =>
        list.id === targetListId ? touchList(list) : list
      );

      return draft;
    });

    if (!duplicated) return { ok: false, reason: 'NOT_FOUND' };

    safeToast('Ítem duplicado ✅');
    safeHaptic(10);

    return {
      ok: true,
      item: duplicated,
      itemId: duplicated.id
    };
  }

  function moveItem(itemId, targetCategory) {
    return editItem(itemId, { category: targetCategory });
  }

  function moveItemToList(itemId, targetListId, options = {}) {
    const cleanId = ensureString(itemId, 120);
    const cleanTargetListId = ensureString(targetListId, 120);

    if (!cleanId) return { ok: false, reason: 'BAD_ID' };
    if (!cleanTargetListId) return { ok: false, reason: 'BAD_LIST_ID' };

    let result = null;

    commit((draft) => {
      if (!findListById(draft, cleanTargetListId)) return draft;

      const sourceListId =
        ensureString(options.fromListId, 120) && findListById(draft, options.fromListId)
          ? ensureString(options.fromListId, 120)
          : draft.currentListId;

      if (sourceListId === cleanTargetListId) return draft;

      const sourceItems = Array.isArray(draft.itemsByListId[sourceListId])
        ? [...draft.itemsByListId[sourceListId]]
        : [];

      const sourceIndex = findItemIndexById(sourceItems, cleanId);
      if (sourceIndex < 0) return draft;

      const [movedItem] = sourceItems.splice(sourceIndex, 1);

      const targetItems = Array.isArray(draft.itemsByListId[cleanTargetListId])
        ? [...draft.itemsByListId[cleanTargetListId]]
        : [];

      const finalItem = {
        ...movedItem,
        checked: !!options.keepChecked ? movedItem.checked : false,
        updatedAt: nowIso()
      };

      targetItems.unshift(finalItem);

      draft.itemsByListId[sourceListId] = sourceItems;
      draft.itemsByListId[cleanTargetListId] = targetItems;
      draft.lists = draft.lists.map((list) =>
        list.id === sourceListId || list.id === cleanTargetListId
          ? touchList(list)
          : list
      );

      result = {
        item: finalItem,
        fromListId: sourceListId,
        toListId: cleanTargetListId
      };

      return draft;
    });

    if (!result) return { ok: false, reason: 'NOT_FOUND' };

    safeToast('Ítem movido ✅');
    safeHaptic(10);

    return { ok: true, ...result };
  }

  function copyItemToList(itemId, targetListId, options = {}) {
    const cleanId = ensureString(itemId, 120);
    const cleanTargetListId = ensureString(targetListId, 120);

    if (!cleanId) return { ok: false, reason: 'BAD_ID' };
    if (!cleanTargetListId) return { ok: false, reason: 'BAD_LIST_ID' };

    let result = null;

    commit((draft) => {
      if (!findListById(draft, cleanTargetListId)) return draft;

      const sourceListId =
        ensureString(options.fromListId, 120) && findListById(draft, options.fromListId)
          ? ensureString(options.fromListId, 120)
          : draft.currentListId;

      const sourceItems = Array.isArray(draft.itemsByListId[sourceListId])
        ? draft.itemsByListId[sourceListId]
        : [];

      const sourceIndex = findItemIndexById(sourceItems, cleanId);
      if (sourceIndex < 0) return draft;

      const source = sourceItems[sourceIndex];

      const targetItems = Array.isArray(draft.itemsByListId[cleanTargetListId])
        ? [...draft.itemsByListId[cleanTargetListId]]
        : [];

      const duplicate = createItemRecord({
        text: source.text,
        checked: !!options.keepChecked ? source.checked : false,
        category: source.category,
        emoji: source.emoji,
        notes: source.notes
      });

      targetItems.unshift(duplicate);
      draft.itemsByListId[cleanTargetListId] = targetItems;
      draft.lists = draft.lists.map((list) =>
        list.id === cleanTargetListId ? touchList(list) : list
      );

      result = {
        item: duplicate,
        fromListId: sourceListId,
        toListId: cleanTargetListId
      };

      return draft;
    });

    if (!result) return { ok: false, reason: 'NOT_FOUND' };

    safeToast('Ítem copiado ✅');
    safeHaptic(10);

    return { ok: true, ...result };
  }

  function resetChecks() {
    const nextState = commit((draft) => {
      const listId = draft.currentListId;
      const items = Array.isArray(draft.itemsByListId[listId])
        ? draft.itemsByListId[listId]
        : [];

      draft.itemsByListId[listId] = items.map((item) => ({
        ...item,
        checked: false,
        updatedAt: nowIso()
      }));

      draft.lists = draft.lists.map((list) =>
        list.id === listId ? touchList(list) : list
      );

      return draft;
    });

    safeToast('Checklist reiniciado ↺');
    safeHaptic(10);

    return {
      ok: true,
      ...getCompletionMeta(getListItems(nextState, nextState.currentListId))
    };
  }

  function setAll(checked) {
    const nextChecked = !!checked;

    const nextState = commit((draft) => {
      const listId = draft.currentListId;
      const items = Array.isArray(draft.itemsByListId[listId])
        ? draft.itemsByListId[listId]
        : [];

      draft.itemsByListId[listId] = items.map((item) => ({
        ...item,
        checked: nextChecked,
        updatedAt: nowIso()
      }));

      draft.lists = draft.lists.map((list) =>
        list.id === listId ? touchList(list) : list
      );

      return draft;
    });

    safeToast(nextChecked ? 'Todo marcado ✅' : 'Todo desmarcado ⬜');
    safeHaptic(10);

    return {
      ok: true,
      checked: nextChecked,
      ...getCompletionMeta(getListItems(nextState, nextState.currentListId))
    };
  }

  /* ==========================================================================
    LISTS
  ========================================================================== */

  function createList(nameOrPayload, maybePayload = {}) {
    const payload = isPlainObject(nameOrPayload)
      ? nameOrPayload
      : { name: nameOrPayload, ...(isPlainObject(maybePayload) ? maybePayload : {}) };

    const rawName = ensureString(payload.name ?? payload.label ?? payload.title, 80);
    const cleanName = sanitizeListName(payload.name ?? payload.label ?? payload.title);
    const cleanIcon = normalizeEmoji(payload.icon) || DEFAULT_LIST_ICON;

    if (!rawName) {
      safeToast('Ponle nombre a la lista 🙃');
      safeHaptic(16);
      return { ok: false, reason: 'EMPTY_NAME' };
    }

    const current = snapshot();
    const duplicate = findListByName(current, cleanName);

    if (duplicate) {
      return { ok: false, reason: 'DUPLICATE_NAME', listId: duplicate.id };
    }

    let created = null;

    commit((draft) => {
      created = createListRecord({ name: cleanName, icon: cleanIcon });
      draft.lists = [created, ...draft.lists];
      draft.itemsByListId[created.id] = [];
      draft.currentListId = created.id;
      return draft;
    });

    safeToast('Lista creada ✅');
    safeHaptic(12);

    return {
      ok: true,
      list: created,
      listId: created?.id || null
    };
  }

  function renameList(listId, newName) {
    const cleanId = ensureString(listId, 120);
    const rawName = ensureString(newName, 80);
    const cleanName = sanitizeListName(newName);

    if (!cleanId) return { ok: false, reason: 'BAD_LIST_ID' };

    if (!rawName) {
      safeToast('Ponle nombre a la lista 🙃');
      safeHaptic(16);
      return { ok: false, reason: 'EMPTY_NAME' };
    }

    const current = snapshot();
    if (!findListById(current, cleanId)) {
      return { ok: false, reason: 'NOT_FOUND' };
    }

    const duplicate = findListByName(current, cleanName, cleanId);
    if (duplicate) {
      return { ok: false, reason: 'DUPLICATE_NAME', listId: duplicate.id };
    }

    commit((draft) => {
      draft.lists = draft.lists.map((list) =>
        list.id === cleanId
          ? { ...list, name: cleanName, updatedAt: nowIso() }
          : list
      );
      return draft;
    });

    safeToast('Lista actualizada ✨');
    safeHaptic(8);

    return { ok: true, listId: cleanId };
  }

  function updateList(listId, payload = {}) {
    const cleanId = ensureString(listId, 120);
    if (!cleanId) return { ok: false, reason: 'BAD_LIST_ID' };

    const current = snapshot();
    const existing = findListById(current, cleanId);
    if (!existing) return { ok: false, reason: 'NOT_FOUND' };

    const hasName =
      Object.prototype.hasOwnProperty.call(payload, 'name') ||
      Object.prototype.hasOwnProperty.call(payload, 'label') ||
      Object.prototype.hasOwnProperty.call(payload, 'title');

    const rawName = hasName
      ? ensureString(payload.name ?? payload.label ?? payload.title, 80)
      : existing.name;

    const cleanName = hasName
      ? sanitizeListName(payload.name ?? payload.label ?? payload.title)
      : existing.name;

    if (hasName && !rawName) {
      safeToast('Ponle nombre a la lista 🙃');
      safeHaptic(16);
      return { ok: false, reason: 'EMPTY_NAME' };
    }

    const duplicate = findListByName(current, cleanName, cleanId);
    if (duplicate) {
      return { ok: false, reason: 'DUPLICATE_NAME', listId: duplicate.id };
    }

    commit((draft) => {
      draft.lists = draft.lists.map((list) => {
        if (list.id !== cleanId) return list;

        return {
          ...list,
          ...(hasName ? { name: cleanName } : {}),
          ...(Object.prototype.hasOwnProperty.call(payload, 'icon')
            ? { icon: normalizeEmoji(payload.icon) || DEFAULT_LIST_ICON }
            : {}),
          updatedAt: nowIso()
        };
      });

      return draft;
    });

    safeToast('Lista actualizada ✨');
    safeHaptic(8);

    return { ok: true, listId: cleanId };
  }

  function selectList(listId) {
    const cleanId = ensureString(listId, 120);
    if (!cleanId) return { ok: false, reason: 'BAD_LIST_ID' };

    const current = snapshot();
    if (!findListById(current, cleanId)) {
      return { ok: false, reason: 'NOT_FOUND' };
    }

    commit((draft) => {
      draft.currentListId = cleanId;
      return draft;
    });

    return { ok: true, listId: cleanId };
  }

  function duplicateList(listId, newName = '') {
    const cleanId = ensureString(listId, 120);
    if (!cleanId) return { ok: false, reason: 'BAD_LIST_ID' };

    const current = snapshot();
    const source = findListById(current, cleanId);
    if (!source) return { ok: false, reason: 'NOT_FOUND' };

    const finalName = sanitizeListName(newName || `${source.name} copia`);
    const duplicate = findListByName(current, finalName);

    if (duplicate) {
      return { ok: false, reason: 'DUPLICATE_NAME', listId: duplicate.id };
    }

    let created = null;

    commit((draft) => {
      const sourceItems = Array.isArray(draft.itemsByListId[cleanId])
        ? draft.itemsByListId[cleanId]
        : [];

      created = createListRecord({
        name: finalName,
        icon: source.icon
      });

      draft.lists = [created, ...draft.lists];
      draft.itemsByListId[created.id] = sourceItems.map((item) =>
        createItemRecord({
          text: item.text,
          checked: false,
          category: item.category,
          emoji: item.emoji,
          notes: item.notes
        })
      );
      draft.currentListId = created.id;

      return draft;
    });

    safeToast('Lista duplicada ✅');
    safeHaptic(12);

    return {
      ok: true,
      list: created,
      listId: created?.id || null
    };
  }

  function deleteList(listId) {
    const cleanId = ensureString(listId, 120);
    if (!cleanId) return { ok: false, reason: 'BAD_LIST_ID' };

    const current = snapshot();
    const index = findListIndexById(current, cleanId);

    if (index < 0) return { ok: false, reason: 'NOT_FOUND' };

    if (current.lists.length <= 1) {
      safeToast('Debe quedar al menos una lista 😑');
      safeHaptic(16);
      return { ok: false, reason: 'LAST_LIST' };
    }

    let fallbackListId = null;

    commit((draft) => {
      const currentIndex = findListIndexById(draft, cleanId);
      if (currentIndex < 0) return draft;

      const filtered = draft.lists.filter((list) => list.id !== cleanId);
      delete draft.itemsByListId[cleanId];

      fallbackListId =
        filtered[currentIndex]?.id ||
        filtered[currentIndex - 1]?.id ||
        filtered[0]?.id ||
        null;

      draft.lists = filtered;

      if (draft.currentListId === cleanId) {
        draft.currentListId = fallbackListId;
      }

      return draft;
    });

    safeToast('Lista eliminada 🗑️');
    safeHaptic(10);

    return {
      ok: true,
      listId: cleanId,
      fallbackListId
    };
  }

  function reorderLists(nextListIds = []) {
    const desired = Array.isArray(nextListIds)
      ? nextListIds.map((id) => ensureString(id, 120)).filter(Boolean)
      : [];

    if (!desired.length) {
      return { ok: false, reason: 'EMPTY_ORDER' };
    }

    commit((draft) => {
      const map = new Map(draft.lists.map((list) => [list.id, list]));
      const reordered = [];

      for (const id of desired) {
        if (map.has(id)) {
          reordered.push(map.get(id));
          map.delete(id);
        }
      }

      for (const leftover of map.values()) {
        reordered.push(leftover);
      }

      draft.lists = reordered;
      return draft;
    });

    return { ok: true };
  }

  function getListInfo(listId = '') {
    const state = snapshot();
    const cleanId = ensureString(listId, 120) || state.currentListId;
    const list = findListById(state, cleanId);

    if (!list) return { ok: false, reason: 'NOT_FOUND' };

    const items = Array.isArray(state.itemsByListId[cleanId])
      ? state.itemsByListId[cleanId]
      : [];

    return {
      ok: true,
      listId: list.id,
      list: { ...list },
      itemsCount: items.length,
      checkedCount: items.filter((item) => item.checked).length
    };
  }

  /* ==========================================================================
    SETTINGS
  ========================================================================== */

  function setMotion(value) {
    commitSettings((settings) => {
      settings.motion = !!value;
    });

    return { ok: true, value: !!value };
  }

  function setSound(value) {
    commitSettings((settings) => {
      settings.sound = !!value;
    });

    return { ok: true, value: !!value };
  }

  /* ==========================================================================
    DESTRUCTIVE
  ========================================================================== */

  function wipeAll() {
    let freshList = null;

    commit((draft) => {
      freshList = createListRecord({
        name: DEFAULT_LIST_NAME,
        icon: DEFAULT_LIST_ICON
      });

      draft.lists = [freshList];
      draft.currentListId = freshList.id;
      draft.itemsByListId = {
        [freshList.id]: []
      };
      draft.settings = { ...DEFAULT_SETTINGS };

      return draft;
    });

    try {
      saveSettings({ ...DEFAULT_SETTINGS });
    } catch {}

    safeToast('Todo borrado. Nueva vida, supongo 🧼');
    safeHaptic(12);

    return {
      ok: true,
      listId: freshList?.id || null
    };
  }

  /* ==========================================================================
    COMPLETION
  ========================================================================== */

  function onCompletedOnce() {
    const state = snapshot();
    const list = getCurrentList(state);
    if (!list) return { ok: false, reason: 'NO_ACTIVE_LIST' };

    const items = getCurrentItems(state);
    const meta = getCompletionMeta(items);

    if (!meta.total) return { ok: false, reason: 'EMPTY' };
    if (!meta.completed) return { ok: false, reason: 'NOT_COMPLETE' };

    return { ok: true, ...meta };
  }

  /* ==========================================================================
    LEGACY ALIASES
  ========================================================================== */

  function createMode(nameOrPayload, maybePayload) {
    const result = createList(nameOrPayload, maybePayload);
    return {
      ...result,
      modeKey: result.listId || null,
      mode: result.list || null
    };
  }

  function renameMode(modeKey, newName) {
    const result = renameList(modeKey, newName);
    return {
      ...result,
      modeKey: result.listId || modeKey
    };
  }

  function updateMode(modeKey, payload) {
    const result = updateList(modeKey, payload);
    return {
      ...result,
      modeKey: result.listId || modeKey
    };
  }

  function deleteMode(modeKey) {
    const result = deleteList(modeKey);
    return {
      ...result,
      modeKey: result.listId || modeKey,
      fallbackMode: result.fallbackListId || null
    };
  }

  function duplicateMode(modeKey, newName) {
    const result = duplicateList(modeKey, newName);
    return {
      ...result,
      modeKey: result.listId || null,
      mode: result.list || null
    };
  }

  function changeMode(modeKey) {
    const result = selectList(modeKey);
    return {
      ...result,
      modeKey: result.listId || modeKey
    };
  }

  function openModeEditor(modeKey) {
    const result = getListInfo(modeKey);
    return {
      ...result,
      modeKey: result.listId || modeKey,
      mode: result.list || null
    };
  }

  return {
    getCurrentList,
    getCurrentListId,
    getCurrentItems,
    getListInfo,

    createItem,
    editItem,
    deleteItem,
    duplicateItem,
    moveItem,
    moveItemToList,
    copyItemToList,
    toggleDone,
    resetChecks,
    setAll,

    createList,
    renameList,
    updateList,
    deleteList,
    duplicateList,
    selectList,
    reorderLists,

    setMotion,
    setSound,

    wipeAll,

    onCompletedOnce,

    createMode,
    renameMode,
    updateMode,
    deleteMode,
    duplicateMode,
    changeMode,
    openModeEditor,

    _util: {
      ensureString,
      normalizeText,
      normalizeEmoji,
      sanitizeCategory,
      createListRecord,
      createItemRecord,
      repairStateShape,
      normalizeSettings,
      getCompletionMeta
    }
  };
}