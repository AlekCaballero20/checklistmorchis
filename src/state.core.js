/* =============================================================================
   Maleta · state.core.js
   Lógica pura de datos: saneamiento, fusión y forma del estado.

   Este módulo NO conoce el DOM ni Firebase a propósito. Es el código que
   decide qué datos sobreviven, así que es también el que más necesita
   tests — y para poder testearlo tiene que poder correr fuera del navegador.
============================================================================= */

export const LIST_NAME_MAX = 40;
export const ITEM_TEXT_MAX = 80;
export const EMOJI_MAX = 8;

/* ────────────────────────────────────────────────────────────────────────────
   HELPERS
──────────────────────────────────────────────────────────────────────────── */
export function uid() {
  // globalThis en vez de window: así funciona igual en el navegador y en node.
  if (globalThis.crypto?.randomUUID) {
    return `id_${globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  }
  return `id_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36)}`;
}

export function safeString(value) {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  return String(value);
}

export function safeBool(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

export function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function nowIso() {
  return new Date().toISOString();
}

export function truncateChars(value, maxChars) {
  // Array.from respeta los emoji (pares suplentes); slice sobre string no.
  return Array.from(safeString(value)).slice(0, maxChars).join('');
}

export function normalizeText(value) {
  return safeString(value).trim().toLowerCase().replace(/\s+/g, ' ');
}

/* Huella de un ítem SIN su lista: sirve para comparar "lo mismo" entre
   listas distintas (comparar, copiar, evitar duplicados). */
export function itemKey(item) {
  return [
    normalizeText(item?.text),
    safeString(item?.emoji).trim()
  ].join('::');
}

export function itemFingerprint(item) {
  return [
    safeString(item.listId).trim(),
    normalizeText(item.text),
    safeString(item.emoji).trim()
  ].join('::');
}

export function summarizeState(s) {
  return {
    lists: Array.isArray(s?.lists) ? s.lists.length : 0,
    items: Array.isArray(s?.items) ? s.items.length : 0
  };
}

/* ────────────────────────────────────────────────────────────────────────────
   ESTADO BASE
──────────────────────────────────────────────────────────────────────────── */
export function defaultState() {
  const id = uid();
  return {
    lists: [{ id, name: 'Mi lista', icon: '🧾' }],
    items: [],
    activeListId: id
  };
}

/* ────────────────────────────────────────────────────────────────────────────
   NORMALIZACIÓN Y SANEAMIENTO
──────────────────────────────────────────────────────────────────────────── */
export function extractFlatStatePayload(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;

  const envelopeData =
    input &&
    typeof input === 'object' &&
    input.data &&
    typeof input.data === 'object' &&
    !Array.isArray(input.data)
      ? input.data
      : null;

  const source = envelopeData || input;

  // Formato actual plano
  if (Array.isArray(source.lists) && Array.isArray(source.items)) {
    return {
      lists: source.lists,
      items: source.items,
      activeListId: source.activeListId || source.currentListId || ''
    };
  }

  // Posible formato futuro/modular -> convertir a plano
  if (Array.isArray(source.lists) && source.itemsByListId && typeof source.itemsByListId === 'object') {
    const flatItems = [];

    Object.entries(source.itemsByListId).forEach(([listId, items]) => {
      if (!Array.isArray(items)) return;

      items.forEach(item => {
        flatItems.push({
          ...item,
          listId: safeString(item?.listId).trim() || listId
        });
      });
    });

    return {
      lists: source.lists,
      items: flatItems,
      activeListId: source.currentListId || source.activeListId || ''
    };
  }

  return null;
}

export function sanitizeList(rawList, usedIds) {
  const name = truncateChars(safeString(rawList?.name).trim(), LIST_NAME_MAX);
  if (!name) return null;

  let id = safeString(rawList?.id).trim();
  if (!id || usedIds.has(id)) id = uid();
  usedIds.add(id);

  const icon = truncateChars(safeString(rawList?.icon).trim(), EMOJI_MAX) || '🧾';

  return { id, name, icon };
}

export function sanitizeItem(rawItem, validListIds, usedIds) {
  const text = truncateChars(safeString(rawItem?.text).trim(), ITEM_TEXT_MAX);
  if (!text) return null;

  const listId = safeString(rawItem?.listId).trim();
  if (!validListIds.has(listId)) return null;

  let id = safeString(rawItem?.id).trim();
  if (!id || usedIds.has(id)) id = uid();
  usedIds.add(id);

  const emoji = truncateChars(safeString(rawItem?.emoji).trim(), EMOJI_MAX);
  const done = safeBool(rawItem?.done);

  return { id, listId, text, emoji, done };
}

export function sanitizeState(input) {
  const extracted = extractFlatStatePayload(input);
  const fallback = defaultState();

  if (!extracted) {
    return {
      ok: false,
      state: fallback,
      report: {
        listsKept: 1,
        itemsKept: 0,
        listsDropped: 0,
        itemsDropped: 0,
        repaired: true
      },
      error: 'Formato no reconocido.'
    };
  }

  const rawLists = Array.isArray(extracted.lists) ? extracted.lists : [];
  const listIds = new Set();
  const lists = [];
  let listsDropped = 0;

  rawLists.forEach(rawList => {
    const clean = sanitizeList(rawList, listIds);
    if (clean) lists.push(clean);
    else listsDropped += 1;
  });

  if (!lists.length) {
    const fallbackList = defaultState().lists[0];
    lists.push(fallbackList);
    listIds.add(fallbackList.id);
  }

  const rawItems = Array.isArray(extracted.items) ? extracted.items : [];
  const itemIds = new Set();
  const items = [];
  let itemsDropped = 0;

  rawItems.forEach(rawItem => {
    const clean = sanitizeItem(rawItem, listIds, itemIds);
    if (clean) items.push(clean);
    else itemsDropped += 1;
  });

  let activeListId = safeString(extracted.activeListId).trim();
  if (!listIds.has(activeListId)) activeListId = lists[0].id;

  return {
    ok: true,
    state: { lists, items, activeListId },
    report: {
      listsKept: lists.length,
      itemsKept: items.length,
      listsDropped,
      itemsDropped,
      repaired: listsDropped > 0 || itemsDropped > 0
    }
  };
}

export function resolveDone(currentDone, incomingDone, strategy = 'or') {
  if (strategy === 'current') return Boolean(currentDone);
  if (strategy === 'incoming') return Boolean(incomingDone);
  return Boolean(currentDone || incomingDone);
}

/* mergeStates fusiona dos estados sin perder contenido.

   doneStrategy decide quién gana cuando el mismo ítem existe en los dos
   lados con distinto estado:
     'or'       -> gana marcado (por defecto; útil al importar respaldos)
     'current'  -> gana lo que tiene el estado actual (la UI local)
     'incoming' -> gana lo que llega (lo último que quiso el usuario)

   El default sigue siendo 'or' para no cambiar el comportamiento de la
   importación de respaldos. */
export function mergeStates(currentState, importedState, options = {}) {
  const doneStrategy = options.doneStrategy || 'or';
  const current = sanitizeState(currentState).state;
  const incoming = sanitizeState(importedState).state;

  const result = deepClone(current);

  const listById = new Map(result.lists.map(list => [list.id, list]));
  const itemById = new Map(result.items.map(item => [item.id, item]));
  const itemByFingerprint = new Map(result.items.map(item => [itemFingerprint(item), item]));

  // Listas: merge conservador por id
  incoming.lists.forEach(list => {
    if (listById.has(list.id)) return;

    const next = deepClone(list);
    result.lists.push(next);
    listById.set(next.id, next);
  });

  // Ítems: merge por id, y si no, detectar posible duplicado por huella
  incoming.items.forEach(item => {
    if (!listById.has(item.listId)) return;

    const existingById = itemById.get(item.id);
    if (existingById) {
      existingById.done = resolveDone(existingById.done, item.done, doneStrategy);
      if (!existingById.emoji && item.emoji) existingById.emoji = item.emoji;
      if (!existingById.text && item.text) existingById.text = item.text;
      return;
    }

    const fp = itemFingerprint(item);
    const existingByFingerprint = itemByFingerprint.get(fp);

    if (existingByFingerprint) {
      existingByFingerprint.done = resolveDone(
        existingByFingerprint.done,
        item.done,
        doneStrategy
      );
      if (!existingByFingerprint.emoji && item.emoji) {
        existingByFingerprint.emoji = item.emoji;
      }
      return;
    }

    const next = deepClone(item);
    result.items.push(next);
    itemById.set(next.id, next);
    itemByFingerprint.set(fp, next);
  });

  if (!listById.has(result.activeListId)) {
    result.activeListId = listById.has(incoming.activeListId)
      ? incoming.activeListId
      : result.lists[0]?.id || defaultState().activeListId;
  }

  return sanitizeState(result).state;
}

/* ────────────────────────────────────────────────────────────────────────────
   COMPARAR LISTAS
   Responde "¿qué le falta a esta lista que la otra sí tiene?".
   Compara por contenido (texto normalizado + emoji), no por id, porque el
   mismo ítem copiado en dos listas tiene ids distintos.
──────────────────────────────────────────────────────────────────────────── */
export function compareLists(rawState, listAId, listBId) {
  const clean = sanitizeState(rawState).state;

  const listA = clean.lists.find(list => list.id === safeString(listAId).trim()) || null;
  const listB = clean.lists.find(list => list.id === safeString(listBId).trim()) || null;

  const empty = { ok: false, listA, listB, onlyInA: [], onlyInB: [], inBoth: [] };

  if (!listA || !listB) return { ...empty, reason: 'missing-list' };
  if (listA.id === listB.id) return { ...empty, reason: 'same-list' };

  const itemsA = clean.items.filter(item => item.listId === listA.id);
  const itemsB = clean.items.filter(item => item.listId === listB.id);

  const keysA = new Set(itemsA.map(itemKey));
  const keysB = new Set(itemsB.map(itemKey));

  // dedupe: si una lista repite el mismo contenido, lo reportamos una vez.
  const pick = (items, predicate) => {
    const seen = new Set();
    const out = [];

    items.forEach(item => {
      const key = itemKey(item);
      if (seen.has(key)) return;
      if (!predicate(key)) return;
      seen.add(key);
      out.push({ id: item.id, text: item.text, emoji: item.emoji, done: item.done });
    });

    return out;
  };

  return {
    ok: true,
    listA,
    listB,
    totals: { a: itemsA.length, b: itemsB.length },
    onlyInA: pick(itemsA, key => !keysB.has(key)),
    onlyInB: pick(itemsB, key => !keysA.has(key)),
    inBoth: pick(itemsA, key => keysB.has(key))
  };
}
