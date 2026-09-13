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

/* Tumbas (tombstones).
   Una fusión que "no pierde nada" tiene un problema: no distingue entre
   "este ítem no lo tenía" y "este ítem lo borré". Por eso un ítem borrado
   revivía cuando la otra persona guardaba con el ítem todavía presente.
   Guardamos el rastro del borrado para que la ausencia sea explícita.
   Se podan solas: ni eternas ni infinitas. */
export const TOMBSTONE_TTL_DAYS = 60;
export const TOMBSTONE_MAX = 400;

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
    deleted: [],
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
      deleted: source.deleted,
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
      deleted: source.deleted,
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

export function sanitizeTombstone(raw) {
  const id = safeString(raw?.id).trim();
  if (!id) return null;

  const kind = raw?.kind === 'list' ? 'list' : 'item';
  const at = safeString(raw?.at).trim() || nowIso();
  const time = Date.parse(at);

  return { id, kind, at: Number.isNaN(time) ? nowIso() : at };
}

/* Poda: primero por edad, y si aún son muchas, conservamos las más nuevas.
   Una tumba vieja ya no sirve: a esas alturas todos los dispositivos vieron
   el borrado hace rato. */
export function pruneTombstones(rawList, now = Date.now()) {
  const cutoff = now - TOMBSTONE_TTL_DAYS * 86400000;
  const byId = new Map();

  (Array.isArray(rawList) ? rawList : []).forEach(raw => {
    const clean = sanitizeTombstone(raw);
    if (!clean) return;
    if (Date.parse(clean.at) < cutoff) return;

    // Si el mismo id aparece dos veces, gana el borrado más reciente.
    const previous = byId.get(clean.id);
    if (previous && Date.parse(previous.at) >= Date.parse(clean.at)) return;

    byId.set(clean.id, clean);
  });

  return Array.from(byId.values())
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, TOMBSTONE_MAX);
}

export function tombstoneIdsByKind(tombstones, kind) {
  return new Set(
    (Array.isArray(tombstones) ? tombstones : [])
      .filter(entry => entry?.kind === kind)
      .map(entry => safeString(entry.id).trim())
      .filter(Boolean)
  );
}

/* Marca como borrado todo lo que estaba en previousState y ya no está en
   nextState. Así cualquier borrado (un ítem, una lista, reemplazar una lista
   completa, importar un respaldo encima) deja rastro sin tener que acordarse
   de crear la tumba a mano en cada sitio. */
export function withDeletionTombstones(previousState, nextState, at = nowIso()) {
  const before = sanitizeState(previousState).state;
  const after = deepClone(sanitizeState(nextState).state);

  const liveListIds = new Set(after.lists.map(list => list.id));
  const liveItemIds = new Set(after.items.map(item => item.id));

  const fresh = [];

  before.lists.forEach(list => {
    if (!liveListIds.has(list.id)) fresh.push({ id: list.id, kind: 'list', at });
  });

  before.items.forEach(item => {
    if (!liveItemIds.has(item.id)) fresh.push({ id: item.id, kind: 'item', at });
  });

  after.deleted = pruneTombstones([...fresh, ...before.deleted, ...after.deleted]);
  return sanitizeState(after).state;
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

  const deleted = pruneTombstones(extracted.deleted);
  const deletedListIds = tombstoneIdsByKind(deleted, 'list');
  const deletedItemIds = tombstoneIdsByKind(deleted, 'item');

  const rawLists = Array.isArray(extracted.lists) ? extracted.lists : [];
  const listIds = new Set();
  const lists = [];
  let listsDropped = 0;

  rawLists.forEach(rawList => {
    // Una lista con tumba no vuelve: si está acá, es que alguien la fusionó
    // de vuelta desde un estado viejo.
    if (deletedListIds.has(safeString(rawList?.id).trim())) {
      listsDropped += 1;
      return;
    }

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
    if (deletedItemIds.has(safeString(rawItem?.id).trim())) {
      itemsDropped += 1;
      return;
    }

    const clean = sanitizeItem(rawItem, listIds, itemIds);
    if (clean) items.push(clean);
    else itemsDropped += 1;
  });

  let activeListId = safeString(extracted.activeListId).trim();
  if (!listIds.has(activeListId)) activeListId = lists[0].id;

  return {
    ok: true,
    state: { lists, items, deleted, activeListId },
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
/* Une las tumbas de un estado con una lista compartida ANTES de sanearlo.
   Importa el orden: si las tumbas llegaran después del saneamiento, un id
   duplicado ya habría sido renombrado (sanitizeItem le da uno nuevo para que
   no choque) y la tumba no lo reconocería. Ese ítem "renacido con otro id"
   era una forma silenciosa de deshacer un borrado. */
function withSharedTombstones(rawState, deleted) {
  const flat = extractFlatStatePayload(rawState);
  if (!flat) return rawState;
  return { ...flat, deleted };
}

export function mergeStates(currentState, importedState, options = {}) {
  const doneStrategy = options.doneStrategy || 'or';

  const sharedDeleted = pruneTombstones([
    ...(extractFlatStatePayload(currentState)?.deleted || []),
    ...(extractFlatStatePayload(importedState)?.deleted || [])
  ]);

  const current = sanitizeState(withSharedTombstones(currentState, sharedDeleted)).state;
  const incoming = sanitizeState(withSharedTombstones(importedState, sharedDeleted)).state;

  const result = deepClone(current);

  /* Un borrado que cualquiera de los dos lados alcanzó a registrar se
     respeta, aunque el otro todavía tenga el ítem. Sin esto, fusionar
     revivía lo borrado. */
  result.deleted = sharedDeleted;

  const deletedListIds = tombstoneIdsByKind(result.deleted, 'list');
  const deletedItemIds = tombstoneIdsByKind(result.deleted, 'item');

  result.lists = result.lists.filter(list => !deletedListIds.has(list.id));
  result.items = result.items.filter(
    item => !deletedItemIds.has(item.id) && !deletedListIds.has(item.listId)
  );

  const listById = new Map(result.lists.map(list => [list.id, list]));
  const itemById = new Map(result.items.map(item => [item.id, item]));
  const itemByFingerprint = new Map(result.items.map(item => [itemFingerprint(item), item]));

  // Listas: merge conservador por id
  incoming.lists.forEach(list => {
    if (listById.has(list.id)) return;
    if (deletedListIds.has(list.id)) return;

    const next = deepClone(list);
    result.lists.push(next);
    listById.set(next.id, next);
  });

  // Ítems: merge por id, y si no, detectar posible duplicado por huella
  incoming.items.forEach(item => {
    if (!listById.has(item.listId)) return;
    if (deletedItemIds.has(item.id)) return;

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

/* ────────────────────────────────────────────────────────────────────────────
   RESUCITAR A PROPÓSITO
   Las tumbas son para que un borrado no se deshaga solo. Pero importar un
   respaldo SÍ es una orden explícita de recuperar cosas: si el archivo trae
   un ítem que se había borrado, la tumba debe quitarse del camino. Sin esto,
   el plan B (restaurar un JSON) quedaría inservible justo cuando se necesita.
──────────────────────────────────────────────────────────────────────────── */
export function collectStateIds(rawState) {
  const clean = sanitizeState(rawState).state;
  return new Set([
    ...clean.lists.map(list => list.id),
    ...clean.items.map(item => item.id)
  ]);
}

export function clearTombstones(rawState, idsToForget) {
  const clean = deepClone(sanitizeState(rawState).state);
  const forget = idsToForget instanceof Set ? idsToForget : new Set(idsToForget || []);

  clean.deleted = clean.deleted.filter(entry => !forget.has(entry.id));
  return clean;
}
