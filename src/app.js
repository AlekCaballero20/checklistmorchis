import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import {
  doc,
  getFirestore,
  onSnapshot,
  serverTimestamp,
  setDoc
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';

/* =============================================================================
   Maleta · app.js
   Estado compartido en Firebase Auth + Firestore.
   - Solo Alek y Cata pueden entrar.
   - Ya no se guarda estado en localStorage.
   - Render simple + import/export JSON + validación de datos.
============================================================================= */

/* ────────────────────────────────────────────────────────────────────────────
   CONSTANTES
──────────────────────────────────────────────────────────────────────────── */
const BACKUP_VERSION = 1;
const APP_ID = 'maleta-checklist';
const SCHEMA_ID = 'simple-flat-v1';
const ALLOWED_EMAILS = [
  'alekcaballeromusic@gmail.com',
  'catalina.medina.leal@gmail.com'
];

const firebaseConfig = {
  apiKey: 'AIzaSyAdB0rGcyjFE2_BCGoeoH2oRtYVC1kTvjY',
  authDomain: 'checklist-maleta.firebaseapp.com',
  projectId: 'checklist-maleta',
  storageBucket: 'checklist-maleta.firebasestorage.app',
  messagingSenderId: '266347823720',
  appId: '1:266347823720:web:44fe1b5762515f292731dd'
};

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });
const db = getFirestore(firebaseApp);
const sharedStateRef = doc(db, 'apps', APP_ID);

/* ────────────────────────────────────────────────────────────────────────────
   HELPERS
──────────────────────────────────────────────────────────────────────────── */
const $ = id => document.getElementById(id);

function on(id, event, handler) {
  const el = $(id);
  if (el) el.addEventListener(event, handler);
}

function uid() {
  if (window.crypto?.randomUUID) {
    return `id_${window.crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  }
  return `id_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36)}`;
}

function esc(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function safeString(value) {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  return String(value);
}

function safeBool(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function nowIso() {
  return new Date().toISOString();
}

function truncateChars(value, maxChars) {
  return Array.from(safeString(value)).slice(0, maxChars).join('');
}

function normalizeText(value) {
  return safeString(value).trim().toLowerCase().replace(/\s+/g, ' ');
}

function formatBackupFileDate(date = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join('-') + '_' + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join('-');
}

function readFileAsText(file) {
  if (file?.text) return file.text();

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    reader.readAsText(file);
  });
}

function downloadTextFile(filename, content, mime = 'application/json;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function itemFingerprint(item) {
  return [
    safeString(item.listId).trim(),
    normalizeText(item.text),
    safeString(item.emoji).trim()
  ].join('::');
}

function summarizeState(s) {
  return {
    lists: Array.isArray(s?.lists) ? s.lists.length : 0,
    items: Array.isArray(s?.items) ? s.items.length : 0
  };
}

/* ────────────────────────────────────────────────────────────────────────────
   ESTADO BASE
──────────────────────────────────────────────────────────────────────────── */
function defaultState() {
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
function extractFlatStatePayload(input) {
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

function sanitizeList(rawList, usedIds) {
  const name = truncateChars(safeString(rawList?.name).trim(), 40);
  if (!name) return null;

  let id = safeString(rawList?.id).trim();
  if (!id || usedIds.has(id)) id = uid();
  usedIds.add(id);

  const icon = truncateChars(safeString(rawList?.icon).trim(), 8) || '🧾';

  return { id, name, icon };
}

function sanitizeItem(rawItem, validListIds, usedIds) {
  const text = truncateChars(safeString(rawItem?.text).trim(), 80);
  if (!text) return null;

  let listId = safeString(rawItem?.listId).trim();
  if (!validListIds.has(listId)) return null;

  let id = safeString(rawItem?.id).trim();
  if (!id || usedIds.has(id)) id = uid();
  usedIds.add(id);

  const emoji = truncateChars(safeString(rawItem?.emoji).trim(), 8);
  const done = safeBool(rawItem?.done);

  return { id, listId, text, emoji, done };
}

function sanitizeState(input) {
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

function mergeStates(currentState, importedState) {
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
      existingById.done = Boolean(existingById.done || item.done);
      if (!existingById.emoji && item.emoji) existingById.emoji = item.emoji;
      if (!existingById.text && item.text) existingById.text = item.text;
      return;
    }

    const fp = itemFingerprint(item);
    const existingByFingerprint = itemByFingerprint.get(fp);

    if (existingByFingerprint) {
      existingByFingerprint.done = Boolean(existingByFingerprint.done || item.done);
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
   FIREBASE / ESTADO REMOTO
──────────────────────────────────────────────────────────────────────────── */
let state = defaultState();
let duplicateItemId = '';
let currentUser = null;
let unsubscribeRemoteState = null;
let initialRemoteLoaded = false;
let lastSavedAt = '';

function isAllowedEmail(email) {
  return ALLOWED_EMAILS.includes(safeString(email).trim().toLowerCase());
}

function setAuthMessage(message) {
  const el = $('authMessage');
  if (el) el.textContent = message || '';
}

function setSyncStatus(message) {
  const el = $('syncStatus');
  if (el) el.textContent = message || '';
}

function setCurrentUserLabel(user) {
  const el = $('currentUserLabel');
  if (!el) return;

  if (!user?.email) {
    el.textContent = '';
    el.hidden = true;
    return;
  }

  el.textContent = user.email;
  el.hidden = false;
}

function showAuthGate(message = '') {
  const app = $('app');
  const gate = $('authGate');

  if (app) app.hidden = true;
  if (gate) gate.hidden = false;

  setAuthMessage(message);
  setSyncStatus('');
  setCurrentUserLabel(null);
}

function showAppShell() {
  const app = $('app');
  const gate = $('authGate');

  if (gate) gate.hidden = true;
  if (app) app.hidden = false;
}

function createRemotePayload(rawState) {
  const cleanState = sanitizeState(rawState).state;

  return {
    app: APP_ID,
    schema: SCHEMA_ID,
    backupVersion: BACKUP_VERSION,
    updatedAt: serverTimestamp(),
    updatedAtClient: nowIso(),
    updatedBy: currentUser?.email || '',
    data: cleanState
  };
}

function readRemoteState(snapshotData) {
  const payload = snapshotData?.data || snapshotData?.state || snapshotData;
  return sanitizeState(payload).state;
}

async function save() {
  if (!currentUser || !isAllowedEmail(currentUser.email)) {
    showToast('Inicia sesión con una cuenta autorizada');
    return false;
  }

  try {
    state = sanitizeState(state).state;
    setSyncStatus('Guardando…');

    await setDoc(sharedStateRef, createRemotePayload(state));

    lastSavedAt = new Date().toLocaleTimeString('es-CO', {
      hour: '2-digit',
      minute: '2-digit'
    });
    setSyncStatus(`Guardado ${lastSavedAt}`);
    return true;
  } catch (error) {
    console.error(error);
    setSyncStatus('Error al guardar');
    showToast('No se pudo guardar en Firebase');
    return false;
  }
}

function backupCurrentStateBeforeImport() {
  const envelope = createBackupEnvelope(state, {
    reason: 'before-import',
    backupCreatedAt: nowIso(),
    source: 'firestore'
  });
  const filename = `maleta-backup-antes-de-importar-${formatBackupFileDate()}.json`;
  downloadTextFile(filename, JSON.stringify(envelope, null, 2));
}

function stopRemoteSync() {
  if (typeof unsubscribeRemoteState === 'function') {
    unsubscribeRemoteState();
    unsubscribeRemoteState = null;
  }
}

function startRemoteSync() {
  stopRemoteSync();
  initialRemoteLoaded = false;
  setSyncStatus('Cargando…');

  unsubscribeRemoteState = onSnapshot(
    sharedStateRef,
    async snapshot => {
      try {
        if (!snapshot.exists()) {
          state = defaultState();
          await setDoc(sharedStateRef, createRemotePayload(state));
        } else {
          state = readRemoteState(snapshot.data());
        }

        initialRemoteLoaded = true;
        showAppShell();
        render();

        if (snapshot.metadata.hasPendingWrites) {
          setSyncStatus('Guardando…');
        } else {
          const suffix = lastSavedAt ? ` ${lastSavedAt}` : '';
          setSyncStatus(`Sincronizado${suffix}`);
        }
      } catch (error) {
        console.error(error);
        setSyncStatus('Error al cargar');
        showToast('No se pudo cargar la información');
      }
    },
    error => {
      console.error(error);
      initialRemoteLoaded = false;
      setSyncStatus('Sin acceso');
      showAuthGate('No se pudo leer Firestore. Revisa que las reglas estén publicadas y que uses una cuenta autorizada.');
    }
  );
}

async function loginWithGoogle() {
  try {
    setAuthMessage('Abriendo Google…');
    await signInWithPopup(auth, provider);
  } catch (error) {
    console.error(error);
    setAuthMessage('No se pudo iniciar sesión. Revisa ventanas emergentes o intenta de nuevo.');
  }
}

async function logout() {
  stopRemoteSync();
  currentUser = null;
  initialRemoteLoaded = false;
  await signOut(auth);
}

function initAuth() {
  showAuthGate('Inicia sesión con una cuenta autorizada.');

  onAuthStateChanged(auth, async user => {
    stopRemoteSync();

    if (!user) {
      currentUser = null;
      initialRemoteLoaded = false;
      showAuthGate('Inicia sesión con una cuenta autorizada.');
      return;
    }

    if (!isAllowedEmail(user.email)) {
      currentUser = null;
      initialRemoteLoaded = false;
      showAuthGate(`La cuenta ${user.email || ''} no tiene acceso.`);
      await signOut(auth);
      return;
    }

    currentUser = user;
    setCurrentUserLabel(user);
    showAppShell();
    startRemoteSync();
  });
}

/* ────────────────────────────────────────────────────────────────────────────
   EXPORT / IMPORT
──────────────────────────────────────────────────────────────────────────── */
function createBackupEnvelope(rawState, extraMeta = {}) {
  const cleanState = sanitizeState(rawState).state;
  const summary = summarizeState(cleanState);

  return {
    backupVersion: BACKUP_VERSION,
    app: APP_ID,
    schema: SCHEMA_ID,
    savedAt: nowIso(),
    meta: {
      listsCount: summary.lists,
      itemsCount: summary.items,
      source: 'firestore',
      ...extraMeta
    },
    data: cleanState
  };
}

function exportData() {
  const backup = createBackupEnvelope(state);
  const filename = `maleta-backup-${formatBackupFileDate()}.json`;
  const content = JSON.stringify(backup, null, 2);

  downloadTextFile(filename, content);
  return backup;
}

function askImportMode() {
  const replace = confirm(
    '¿Cómo quieres importar este respaldo?\n\n' +
    'Aceptar = REEMPLAZAR todo lo actual\n' +
    'Cancelar = ver opción de FUSIONAR'
  );

  if (replace) return 'replace';

  const merge = confirm(
    '¿Quieres FUSIONAR el respaldo con tus datos actuales?\n\n' +
    'Aceptar = FUSIONAR\n' +
    'Cancelar = cancelar la importación'
  );

  if (merge) return 'merge';
  return null;
}

async function importFromFile(file) {
  if (!file) return;

  let parsed;
  try {
    const text = await readFileAsText(file);
    const cleaned = String(text).replace(/^\uFEFF/, '').trim();

    if (!cleaned) {
      showToast('El archivo está vacío');
      return;
    }

    parsed = JSON.parse(cleaned);
  } catch {
    showToast('No se pudo leer el JSON');
    return;
  }

  const sanitized = sanitizeState(parsed);

  if (!sanitized.ok && !sanitized.state) {
    showToast('Respaldo inválido');
    return;
  }

  const mode = askImportMode();
  if (!mode) {
    showToast('Importación cancelada');
    return;
  }

  backupCurrentStateBeforeImport();

  if (mode === 'replace') {
    state = sanitized.state;
    save();
    render();

    const summary = summarizeState(state);
    closeModal('listsOverlay');
    showToast(`Respaldo cargado: ${summary.lists} listas y ${summary.items} ítems`);
    return;
  }

  if (mode === 'merge') {
    state = mergeStates(state, sanitized.state);
    save();
    render();

    const summary = summarizeState(state);
    closeModal('listsOverlay');
    showToast(`Datos fusionados: ${summary.lists} listas y ${summary.items} ítems`);
  }
}

/* ────────────────────────────────────────────────────────────────────────────
   GETTERS
──────────────────────────────────────────────────────────────────────────── */
function getActiveList() {
  return state.lists.find(list => list.id === state.activeListId) || state.lists[0];
}

function getActiveItems() {
  return state.items.filter(item => item.listId === state.activeListId);
}

function getListItems(listId) {
  return state.items.filter(item => item.listId === listId);
}

/* ────────────────────────────────────────────────────────────────────────────
   MUTACIONES
──────────────────────────────────────────────────────────────────────────── */
function selectList(id) {
  if (!state.lists.find(list => list.id === id)) return false;
  state.activeListId = id;
  save();
  return true;
}

function addList(name, icon = '📋') {
  const cleanName = truncateChars(safeString(name).trim(), 40);
  const cleanIcon = truncateChars(safeString(icon).trim(), 8) || '📋';

  if (!cleanName) return null;

  const list = {
    id: uid(),
    name: cleanName,
    icon: cleanIcon
  };

  state.lists.push(list);
  state.activeListId = list.id;
  save();
  return list;
}

function deleteList(id) {
  if (state.lists.length <= 1) return false;
  if (!state.lists.find(list => list.id === id)) return false;

  state.lists = state.lists.filter(list => list.id !== id);
  state.items = state.items.filter(item => item.listId !== id);

  if (!state.lists.find(list => list.id === state.activeListId)) {
    state.activeListId = state.lists[0].id;
  }

  save();
  return true;
}

function addItem(text, emoji = '', listId) {
  const cleanText = truncateChars(safeString(text).trim(), 80);
  const cleanEmoji = truncateChars(safeString(emoji).trim(), 8);
  const targetId = safeString(listId).trim() || state.activeListId;

  if (!cleanText) return null;
  if (!state.lists.find(list => list.id === targetId)) return null;

  const item = {
    id: uid(),
    listId: targetId,
    text: cleanText,
    emoji: cleanEmoji,
    done: false
  };

  state.items.push(item);
  save();
  return item;
}

function duplicateItemToList(itemId, targetListId) {
  const source = state.items.find(item => item.id === itemId);
  const cleanTargetId = safeString(targetListId).trim();

  if (!source) return { ok: false, reason: 'missing-item' };
  if (!cleanTargetId) return { ok: false, reason: 'missing-list' };
  if (!state.lists.find(list => list.id === cleanTargetId)) {
    return { ok: false, reason: 'missing-list' };
  }
  if (source.listId === cleanTargetId) {
    return { ok: false, reason: 'same-list' };
  }

  const duplicateExists = state.items.some(item =>
    item.listId === cleanTargetId &&
    normalizeText(item.text) === normalizeText(source.text) &&
    safeString(item.emoji).trim() === safeString(source.emoji).trim()
  );

  if (duplicateExists) {
    return { ok: false, reason: 'already-exists' };
  }

  const copy = addItem(source.text, source.emoji, cleanTargetId);
  if (!copy) return { ok: false, reason: 'create-failed' };

  return { ok: true, item: copy };
}

function copyListItems(sourceListId, targetListId, mode) {
  const cleanSource = safeString(sourceListId).trim();
  const cleanTarget = safeString(targetListId).trim();

  if (!state.lists.find(list => list.id === cleanSource)) {
    return { ok: false, reason: 'missing-source' };
  }
  if (!state.lists.find(list => list.id === cleanTarget)) {
    return { ok: false, reason: 'missing-target' };
  }
  if (cleanSource === cleanTarget) {
    return { ok: false, reason: 'same-list' };
  }

  const sourceItems = getListItems(cleanSource);
  if (!sourceItems.length) {
    return { ok: false, reason: 'empty-source' };
  }

  if (mode === 'replace') {
    // Borra todo lo de la lista destino y copia esta tal cual, en orden.
    state.items = state.items.filter(item => item.listId !== cleanTarget);

    const copies = sourceItems.map(source => ({
      id: uid(),
      listId: cleanTarget,
      text: source.text,
      emoji: source.emoji,
      done: false
    }));

    state.items.push(...copies);
    save();
    return { ok: true, added: copies.length, skipped: 0, mode };
  }

  // mode === 'skip': copia solo los que faltan, sin duplicar, en orden.
  const existing = new Set(
    getListItems(cleanTarget).map(item =>
      `${normalizeText(item.text)}::${safeString(item.emoji).trim()}`
    )
  );

  const copies = [];
  let skipped = 0;

  sourceItems.forEach(source => {
    const fp = `${normalizeText(source.text)}::${safeString(source.emoji).trim()}`;
    if (existing.has(fp)) {
      skipped += 1;
      return;
    }
    existing.add(fp);
    copies.push({
      id: uid(),
      listId: cleanTarget,
      text: source.text,
      emoji: source.emoji,
      done: false
    });
  });

  if (copies.length) {
    state.items.push(...copies);
    save();
  }

  return { ok: true, added: copies.length, skipped, mode };
}

function toggleItem(id) {
  const item = state.items.find(entry => entry.id === id);
  if (!item) return false;

  item.done = !item.done;
  save();
  return true;
}

function deleteItem(id) {
  const before = state.items.length;
  state.items = state.items.filter(item => item.id !== id);

  if (state.items.length === before) return false;
  save();
  return true;
}

function reorderActiveItems(orderedIds) {
  const activeIds = new Set(getActiveItems().map(item => item.id));
  const orderedActiveItems = orderedIds
    .map(id => state.items.find(item => item.id === id))
    .filter(item => item && activeIds.has(item.id));

  if (orderedActiveItems.length !== activeIds.size) return false;

  let activeIndex = 0;
  state.items = state.items.map(item =>
    activeIds.has(item.id) ? orderedActiveItems[activeIndex++] : item
  );
  save();
  return true;
}

function resetItems() {
  const items = getActiveItems();
  items.forEach(item => {
    item.done = false;
  });
  save();
}

function setAllDone(done) {
  const items = getActiveItems();
  items.forEach(item => {
    item.done = Boolean(done);
  });
  save();
}

/* ────────────────────────────────────────────────────────────────────────────
   RENDER
──────────────────────────────────────────────────────────────────────────── */
function render() {
  const clean = sanitizeState(state).state;
  state = clean;

  renderHero();
  renderItems();
  renderListsManager();
  populateListSelect('newItemList');
  populateListSelect('duplicateItemList');
}

function renderHero() {
  const activeList = getActiveList();
  const items = getActiveItems();
  const total = items.length;
  const done = items.filter(item => item.done).length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  const tripPill = $('tripPill');
  const progressText = $('progressText');
  const progressPct = $('progressPct');
  const progressFill = $('progressFill');
  const progressBar = $('progressBar');

  if (tripPill) tripPill.textContent = `${activeList.icon} ${activeList.name}`;
  if (progressText) progressText.textContent = `${done}/${total}`;
  if (progressPct) progressPct.textContent = `${pct}%`;
  if (progressFill) progressFill.style.width = `${pct}%`;
  if (progressBar) progressBar.setAttribute('aria-valuenow', String(pct));

  const disableBulk = total === 0;
  [
    'btnReset',
    'btnSelectAll',
    'btnUncheckAll',
    'btnSelectAllFooter',
    'btnUncheckAllFooter'
  ].forEach(id => {
    const el = $(id);
    if (el) el.disabled = disableBulk;
  });
}

function renderItems() {
  const items = getActiveItems();
  const container = $('list');
  if (!container) return;

  if (!items.length) {
    container.innerHTML = `
      <div class="emptyState">
        <div class="emptyEmoji">🐾</div>
        <strong>No hay ítems aquí.</strong>
        <span>Agrega algo a la lista</span>
      </div>
    `;
    return;
  }

  container.innerHTML = items.map(item => `
    <div class="item${item.done ? ' isDone' : ''}" data-id="${esc(item.id)}">
      <button
        class="itemDragHandle"
        type="button"
        aria-label="Mantén presionado para cambiar el orden"
        title="Mantén presionado y arrastra"
      >
        <span aria-hidden="true">⋮⋮</span>
      </button>

      <button
        class="itemToggle"
        type="button"
        data-action="toggle"
        data-id="${esc(item.id)}"
        aria-label="${item.done ? 'Desmarcar' : 'Marcar como listo'}"
      >
        ${item.done ? '✅' : ''}
      </button>

      <span class="itemLabel">
        ${item.emoji ? `${esc(item.emoji)} ` : ''}${esc(item.text)}
      </span>

      <button
        class="itemDuplicate"
        type="button"
        data-action="duplicate-item"
        data-id="${esc(item.id)}"
        aria-label="Duplicar ítem en otra lista"
        title="Duplicar en otra lista"
      >
        ⧉
      </button>

      <button
        class="itemDelete"
        type="button"
        data-action="delete-item"
        data-id="${esc(item.id)}"
        aria-label="Eliminar ítem"
        title="Eliminar ítem"
      >
        ✕
      </button>
    </div>
  `).join('');
}

function renderListsManager() {
  const container = $('listsList');
  if (!container) return;

  if (!state.lists.length) {
    container.innerHTML = `
      <p style="color:var(--muted);font-size:14px;text-align:center">
        Sin listas todavía
      </p>
    `;
    return;
  }

  container.innerHTML = state.lists.map(list => {
    const count = getListItems(list.id).length;
    const isActive = list.id === state.activeListId;
    const canDelete = state.lists.length > 1;

    return `
      <div class="listChip${isActive ? ' isActive' : ''}">
        <button
          class="listChipLabel"
          type="button"
          data-action="select-list"
          data-id="${esc(list.id)}"
          aria-label="Abrir lista ${esc(list.name)}"
        >
          <span>${esc(list.icon)} ${esc(list.name)}</span>
          <span class="listChipCount">${count}</span>
        </button>

        ${
          canDelete
            ? `
              <button
                class="listChipDelete"
                type="button"
                data-action="delete-list"
                data-id="${esc(list.id)}"
                aria-label="Eliminar ${esc(list.name)}"
                title="Eliminar lista"
              >
                ✕
              </button>
            `
            : ''
        }
      </div>
    `;
  }).join('');
}

function populateListSelect(selectId) {
  const select = $(selectId);
  if (!select) return;

  select.innerHTML = state.lists.map(list => `
    <option value="${esc(list.id)}"${list.id === state.activeListId ? ' selected' : ''}>
      ${esc(`${list.icon} ${list.name}`)}
    </option>
  `).join('');
}

/* ────────────────────────────────────────────────────────────────────────────
   MODALES
──────────────────────────────────────────────────────────────────────────── */
let returnFocusEl = null;

function anyModalOpen() {
  return Array.from(document.querySelectorAll('.modalOverlay.show')).length > 0;
}

function syncBodyScrollLock() {
  document.body.style.overflow = anyModalOpen() ? 'hidden' : '';
}

function hideModalSilently(id) {
  const overlay = $(id);
  if (!overlay) return;
  overlay.classList.remove('show');
  overlay.setAttribute('aria-hidden', 'true');
}

function openModal(id, returnEl) {
  const overlay = $(id);
  if (!overlay) return;

  ['addOverlay', 'duplicateOverlay', 'copyListOverlay', 'listsOverlay'].forEach(otherId => {
    if (otherId !== id) hideModalSilently(otherId);
  });

  returnFocusEl = returnEl || null;
  overlay.classList.add('show');
  overlay.setAttribute('aria-hidden', 'false');
  syncBodyScrollLock();

  setTimeout(() => {
    overlay.querySelector('input, select, button')?.focus();
  }, 80);
}

function closeModal(id) {
  const overlay = $(id);
  if (!overlay) return;

  const wasOpen = overlay.classList.contains('show');
  overlay.classList.remove('show');
  overlay.setAttribute('aria-hidden', 'true');
  syncBodyScrollLock();

  if (id === 'duplicateOverlay') {
    duplicateItemId = '';
  }

  if (wasOpen && returnFocusEl) {
    returnFocusEl.focus();
    returnFocusEl = null;
  }
}

function closeAllModals() {
  ['addOverlay', 'duplicateOverlay', 'copyListOverlay', 'listsOverlay'].forEach(hideModalSilently);
  syncBodyScrollLock();
}

function openAddModal(returnEl) {
  populateListSelect('newItemList');

  const newName = $('newName');
  const newEmoji = $('newEmoji');

  if (newName) newName.value = '';
  if (newEmoji) newEmoji.value = '';

  openModal('addOverlay', returnEl);
}

function openListsModal(returnEl) {
  renderListsManager();

  const newListName = $('newListName');
  const newListIcon = $('newListIcon');

  if (newListName) newListName.value = '';
  if (newListIcon) newListIcon.value = '';

  openModal('listsOverlay', returnEl);
}

function openDuplicateModal(itemId, returnEl) {
  const item = state.items.find(entry => entry.id === itemId);
  if (!item) {
    showToast('No se encontró el ítem');
    return;
  }

  if (state.lists.length < 2) {
    showToast('Crea otra lista para poder duplicar');
    return;
  }

  duplicateItemId = item.id;
  populateListSelect('duplicateItemList');

  const preview = $('duplicateItemPreview');
  const select = $('duplicateItemList');

  if (preview) {
    preview.textContent = `${item.emoji ? `${item.emoji} ` : ''}${item.text}`;
  }

  if (select) {
    select.value = state.lists.find(list => list.id !== item.listId)?.id || item.listId;
  }

  openModal('duplicateOverlay', returnEl);
}

function openCopyListModal(returnEl) {
  if (state.lists.length < 2) {
    showToast('Crea otra lista para poder copiar');
    return;
  }

  populateListSelect('copySourceList');
  populateListSelect('copyTargetList');

  const sourceSelect = $('copySourceList');
  const targetSelect = $('copyTargetList');

  if (sourceSelect) sourceSelect.value = state.activeListId;
  if (targetSelect) {
    targetSelect.value =
      state.lists.find(list => list.id !== state.activeListId)?.id ||
      state.activeListId;
  }

  const skip = $('copyModeSkip');
  if (skip) skip.checked = true;

  openModal('copyListOverlay', returnEl);
}

/* ────────────────────────────────────────────────────────────────────────────
   TOAST
──────────────────────────────────────────────────────────────────────────── */
let toastTimer = null;

function showToast(message, duration = 2400) {
  const el = $('toast');
  if (!el) return;

  el.textContent = message;
  el.classList.add('show');

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove('show');
  }, duration);
}

/* ────────────────────────────────────────────────────────────────────────────
   ACCIONES DE UI
──────────────────────────────────────────────────────────────────────────── */
function doAddItem() {
  const nameInput = $('newName');
  const emojiInput = $('newEmoji');
  const listSelect = $('newItemList');

  const text = safeString(nameInput?.value).trim();
  if (!text) {
    nameInput?.focus();
    return;
  }

  const created = addItem(text, emojiInput?.value || '', listSelect?.value || state.activeListId);
  if (!created) {
    showToast('No se pudo agregar el ítem');
    return;
  }

  closeModal('addOverlay');
  render();
  showToast('✅ Ítem agregado');
}

function doAddList() {
  const nameInput = $('newListName');
  const iconInput = $('newListIcon');

  const name = safeString(nameInput?.value).trim();
  if (!name) {
    nameInput?.focus();
    return;
  }

  const created = addList(name, iconInput?.value || '');
  if (!created) {
    showToast('No se pudo crear la lista');
    return;
  }

  if (nameInput) nameInput.value = '';
  if (iconInput) iconInput.value = '';

  render();
  showToast('✅ Lista creada');
}

function doDuplicateItem() {
  const targetListId = $('duplicateItemList')?.value || '';
  const result = duplicateItemToList(duplicateItemId, targetListId);

  if (!result.ok) {
    if (result.reason === 'same-list') {
      showToast('Elige una lista diferente');
      return;
    }

    if (result.reason === 'already-exists') {
      showToast('Ese ítem ya existe en la lista destino');
      return;
    }

    showToast('No se pudo duplicar el ítem');
    return;
  }

  duplicateItemId = '';
  closeModal('duplicateOverlay');
  render();
  showToast('✅ Ítem duplicado');
}

function doCopyList() {
  const sourceId = $('copySourceList')?.value || '';
  const targetId = $('copyTargetList')?.value || '';
  const mode =
    document.querySelector('input[name="copyListMode"]:checked')?.value || 'skip';

  if (sourceId === targetId) {
    showToast('Elige listas diferentes');
    return;
  }

  if (mode === 'replace') {
    const targetList = state.lists.find(list => list.id === targetId);
    const ok = confirm(
      `Esto borrará todos los ítems de "${targetList?.name || 'la lista destino'}" ` +
      'y los reemplazará por los de la lista origen. ¿Continuar?'
    );
    if (!ok) return;
  }

  const result = copyListItems(sourceId, targetId, mode);

  if (!result.ok) {
    if (result.reason === 'same-list') {
      showToast('Elige listas diferentes');
      return;
    }
    if (result.reason === 'empty-source') {
      showToast('La lista origen no tiene ítems');
      return;
    }
    showToast('No se pudo copiar la lista');
    return;
  }

  closeModal('copyListOverlay');
  render();

  if (result.mode === 'replace') {
    showToast(`✅ Lista reemplazada (${result.added} ítems)`);
  } else if (result.added === 0) {
    showToast('Nada que copiar: ya estaban todos');
  } else if (result.skipped > 0) {
    showToast(`✅ ${result.added} copiados, ${result.skipped} ya existían`);
  } else {
    showToast(`✅ ${result.added} ítems copiados`);
  }
}

/* ────────────────────────────────────────────────────────────────────────────
   EVENTOS
──────────────────────────────────────────────────────────────────────────── */
function bindEvents() {
  const list = $('list');
  let drag = null;

  function clearDragTimer() {
    if (!drag?.timer) return;
    clearTimeout(drag.timer);
    drag.timer = null;
  }

  function finishDrag(event, cancelled = false) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    clearDragTimer();

    if (drag.active) {
      drag.item.classList.remove('isDragging');
      list?.classList.remove('isReordering');
      drag.handle.releasePointerCapture?.(event.pointerId);

      if (cancelled) {
        renderItems();
      } else {
        const orderedIds = [...list.querySelectorAll('.item')].map(item => item.dataset.id);
        if (reorderActiveItems(orderedIds)) showToast('Orden guardado');
      }
    }

    drag = null;
  }

  list?.addEventListener('pointerdown', event => {
    const handle = event.target.closest('.itemDragHandle');
    const item = handle?.closest('.item');
    if (!handle || !item || event.button > 0) return;

    drag = {
      pointerId: event.pointerId,
      handle,
      item,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      timer: setTimeout(() => {
        if (!drag || drag.pointerId !== event.pointerId) return;
        drag.active = true;
        handle.setPointerCapture?.(event.pointerId);
        item.classList.add('isDragging');
        list.classList.add('isReordering');
        navigator.vibrate?.(25);
      }, 320)
    };
  });

  list?.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.pointerId) return;

    if (!drag.active) {
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 8) {
        clearDragTimer();
        drag = null;
      }
      return;
    }

    event.preventDefault();
    const siblings = [...list.querySelectorAll('.item:not(.isDragging)')];
    const next = siblings.find(item => {
      const rect = item.getBoundingClientRect();
      return event.clientY < rect.top + rect.height / 2;
    });

    if (next) list.insertBefore(drag.item, next);
    else list.appendChild(drag.item);
  });

  list?.addEventListener('pointerup', event => finishDrag(event));
  list?.addEventListener('pointercancel', event => finishDrag(event, true));

  // Delegación global
  document.addEventListener('click', event => {
    if (event.target.classList.contains('modalOverlay')) {
      closeModal(event.target.id);
      return;
    }

    const actionEl = event.target.closest('[data-action]');
    if (!actionEl) return;

    const action = actionEl.dataset.action;
    const id = actionEl.dataset.id;

    switch (action) {
      case 'toggle': {
        if (toggleItem(id)) render();
        break;
      }

      case 'delete-item': {
        if (deleteItem(id)) {
          render();
          showToast('Ítem eliminado');
        }
        break;
      }

      case 'duplicate-item': {
        openDuplicateModal(id, actionEl);
        break;
      }

      case 'select-list': {
        if (selectList(id)) {
          closeModal('listsOverlay');
          render();
        }
        break;
      }

      case 'delete-list': {
        const list = state.lists.find(entry => entry.id === id);
        if (!list) return;

        if (state.lists.length <= 1) {
          showToast('Debes conservar al menos una lista');
          return;
        }

        const ok = confirm(`¿Eliminar la lista "${list.name}" con todos sus ítems?`);
        if (!ok) return;

        if (deleteList(id)) {
          render();
          showToast('Lista eliminada');
        }
        break;
      }
    }
  });

  // Abrir modales
  on('btnAdd', 'click', () => openAddModal($('btnAdd')));
  on('btnAddFooter', 'click', () => openAddModal($('btnAddFooter')));
  on('btnSettings', 'click', () => openListsModal($('btnSettings')));
  on('tripPill', 'click', () => openListsModal($('tripPill')));

  // Cerrar modales
  on('btnCloseAdd', 'click', () => closeModal('addOverlay'));
  on('btnCloseDuplicate', 'click', () => closeModal('duplicateOverlay'));
  on('btnCloseCopyList', 'click', () => closeModal('copyListOverlay'));
  on('btnCloseLists', 'click', () => closeModal('listsOverlay'));

  // Copiar lista completa
  on('btnOpenCopyList', 'click', () => openCopyListModal($('btnOpenCopyList')));
  on('btnConfirmCopyList', 'click', doCopyList);

  // Crear ítem
  on('btnCreate', 'click', doAddItem);
  on('newName', 'keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      doAddItem();
    }
    if (event.key === 'Escape') {
      closeModal('addOverlay');
    }
  });
  on('newEmoji', 'keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      doAddItem();
    }
    if (event.key === 'Escape') {
      closeModal('addOverlay');
    }
  });
  on('newItemList', 'keydown', event => {
    if (event.key === 'Escape') {
      closeModal('addOverlay');
    }
  });

  // Duplicar ítem
  on('btnConfirmDuplicate', 'click', doDuplicateItem);
  on('duplicateItemList', 'keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      doDuplicateItem();
    }
    if (event.key === 'Escape') {
      closeModal('duplicateOverlay');
    }
  });

  // Crear lista
  on('btnCreateList', 'click', doAddList);
  on('newListName', 'keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      doAddList();
    }
    if (event.key === 'Escape') {
      closeModal('listsOverlay');
    }
  });
  on('newListIcon', 'keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      doAddList();
    }
    if (event.key === 'Escape') {
      closeModal('listsOverlay');
    }
  });

  // Acciones masivas
  on('btnReset', 'click', () => {
    resetItems();
    render();
    showToast('Lista reiniciada');
  });

  on('btnSelectAll', 'click', () => {
    setAllDone(true);
    render();
    showToast('Todo marcado');
  });

  on('btnUncheckAll', 'click', () => {
    setAllDone(false);
    render();
    showToast('Todo desmarcado');
  });

  on('btnSelectAllFooter', 'click', () => {
    setAllDone(true);
    render();
    showToast('Todo marcado');
  });

  on('btnUncheckAllFooter', 'click', () => {
    setAllDone(false);
    render();
    showToast('Todo desmarcado');
  });

  // Exportar / importar
  on('btnExportData', 'click', () => {
    const backup = exportData();
    const total = backup?.meta?.itemsCount ?? summarizeState(state).items;
    showToast(`Respaldo exportado (${total} ítems)`);
  });

  on('btnImportData', 'click', () => {
    const input = $('importFileInput');
    if (!input) return;

    input.value = '';
    input.click();
  });

  on('importFileInput', 'change', async event => {
    const input = event.currentTarget;
    const file = input?.files?.[0];
    if (!file) return;

    await importFromFile(file);

    if (input) input.value = '';
  });

  // Sesión
  on('btnLoginGoogle', 'click', loginWithGoogle);
  on('btnLogout', 'click', logout);

  // Escape global
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    closeAllModals();
  });
}

/* ────────────────────────────────────────────────────────────────────────────
   INIT
──────────────────────────────────────────────────────────────────────────── */
function init() {
  bindEvents();
  initAuth();
}

init();
