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
  initializeFirestore,
  onSnapshot,
  persistentLocalCache,
  persistentMultipleTabManager,
  runTransaction,
  serverTimestamp,
  setDoc
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';

import {
  deepClone,
  defaultState,
  mergeStates,
  normalizeText,
  nowIso,
  safeString,
  sanitizeState,
  summarizeState,
  truncateChars,
  uid
} from './state.core.js';

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

/* Red de seguridad contra pérdida de datos.
   Contexto: una versión anterior sobrescribía el documento con un estado
   vacío cuando la lectura devolvía "no existe". Estas tres capas evitan
   que un fallo transitorio vuelva a ser una pérdida permanente. */
const VERSIONS_COLLECTION = 'versiones'; // historial en Firestore
const LOCAL_BACKUP_KEY = 'maleta_local_backups_v1';
const LOCAL_BACKUP_LIMIT = 20;           // copias locales que conservamos

const SAVE_DEBOUNCE_MS = 1500;           // agrupa ráfagas de cambios
const VERSION_MIN_INTERVAL_MS = 5 * 60 * 1000; // 5 min entre versiones
const VERSION_TTL_DAYS = 90;             // el historial se borra solo
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
/* Persistencia offline.
   Sin esto la app abría sin señal pero no mostraba ni guardaba nada — justo
   cuando más se necesita (en la moto, entre casas). Además deja una copia
   local real de los datos en IndexedDB.
   persistentMultipleTabManager permite tener varias pestañas abiertas. */
const db = initializeFirestore(firebaseApp, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});
const sharedStateRef = doc(db, 'apps', APP_ID);

/* ────────────────────────────────────────────────────────────────────────────
   HELPERS
──────────────────────────────────────────────────────────────────────────── */
const $ = id => document.getElementById(id);

function on(id, event, handler) {
  const el = $(id);
  if (el) el.addEventListener(event, handler);
}

function esc(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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

/* La lógica pura de datos vive en state.core.js (ver import arriba). */
/* ────────────────────────────────────────────────────────────────────────────
   FIREBASE / ESTADO REMOTO
──────────────────────────────────────────────────────────────────────────── */
let state = defaultState();
let duplicateItemId = '';
let currentUser = null;
let unsubscribeRemoteState = null;
let initialRemoteLoaded = false;
let lastSavedAt = '';
// Último estado que Firestore nos confirmó. Sirve para detectar si una
// escritura va a destruir contenido que existía hace un momento.
let lastConfirmedRemoteState = null;

// Control de escrituras agrupadas (debounce).
let saveTimer = null;
let pendingSaveResolvers = [];

// Control del historial de versiones.
let lastVersionWriteAt = 0;
let lastVersionState = null;

// Revisión conocida del documento, para detectar edición concurrente.
let knownRevision = 0;

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

/* ────────────────────────────────────────────────────────────────────────────
   RED DE SEGURIDAD
──────────────────────────────────────────────────────────────────────────── */

/* Capa 1 — Copias locales.
   Guardamos en el navegador cada estado que Firestore confirma. Es la
   escotilla de escape: si el documento remoto se daña, acá queda rastro. */
function pushLocalBackup(rawState, reason) {
  try {
    const envelope = createBackupEnvelope(rawState, { reason, source: 'auto-local' });
    const prev = JSON.parse(localStorage.getItem(LOCAL_BACKUP_KEY) || '[]');
    const list = Array.isArray(prev) ? prev : [];

    // Evitamos duplicar si el contenido no cambió respecto de la última copia.
    const fingerprint = JSON.stringify(envelope.data);
    if (list.length && JSON.stringify(list[0]?.data) === fingerprint) return;

    list.unshift(envelope);
    localStorage.setItem(LOCAL_BACKUP_KEY, JSON.stringify(list.slice(0, LOCAL_BACKUP_LIMIT)));
  } catch (error) {
    // Nunca dejamos que un fallo de respaldo rompa el flujo principal.
    console.warn('No se pudo guardar el respaldo local:', error);
  }
}

function readLocalBackups() {
  try {
    const list = JSON.parse(localStorage.getItem(LOCAL_BACKUP_KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/* Capa 2 — Guardia contra escrituras destructivas.
   Una escritura es sospechosa si vacía o reduce drásticamente algo que
   sí tenía contenido confirmado. Ante la duda, preguntamos. */
function isDestructiveWrite(nextState) {
  if (!lastConfirmedRemoteState) return false;

  const before = summarizeState(lastConfirmedRemoteState);
  const after = summarizeState(nextState);

  if (before.items === 0) return false;              // no había nada que perder
  if (after.items === 0) return true;                // lo deja vacío
  return after.items < Math.ceil(before.items / 2);  // borra más de la mitad
}

function confirmDestructiveWrite(nextState) {
  const before = summarizeState(lastConfirmedRemoteState);
  const after = summarizeState(nextState);

  return confirm(
    'Este cambio reduce mucho la información guardada:\n\n' +
    `  Antes:  ${before.items} ítems en ${before.lists} listas\n` +
    `  Ahora:  ${after.items} ítems en ${after.lists} listas\n\n` +
    'Se guardó una copia local por si acaso.\n¿Confirmas que quieres guardar así?'
  );
}

/* Capa 3 — Historial en Firestore.
   Guardamos una versión aparte, pero NO en cada toque: marcar 20 ítems al
   empacar no debe generar 20 versiones. Se escribe si pasó el intervalo
   mínimo o si el cambio es grande. */
function shouldWriteVersion(cleanState) {
  if (!lastVersionWriteAt) return true;
  if (Date.now() - lastVersionWriteAt >= VERSION_MIN_INTERVAL_MS) return true;

  // Cambio estructural (listas o ítems agregados/eliminados): vale la pena.
  if (!lastVersionState) return true;
  const before = summarizeState(lastVersionState);
  const after = summarizeState(cleanState);
  return before.items !== after.items || before.lists !== after.lists;
}

async function writeVersionSnapshot(cleanState) {
  try {
    const versionId = `${Date.now()}`;
    const versionRef = doc(db, 'apps', APP_ID, VERSIONS_COLLECTION, versionId);

    // expiresAt permite que la política TTL de Firestore las borre solas.
    const expiresAt = new Date(Date.now() + VERSION_TTL_DAYS * 86400000);

    await setDoc(versionRef, { ...createRemotePayload(cleanState), expiresAt });

    lastVersionWriteAt = Date.now();
    lastVersionState = deepClone(cleanState);
  } catch (error) {
    // El historial es un extra: si falla, el guardado principal sigue válido.
    console.warn('No se pudo escribir la versión histórica:', error);
  }
}

/* Escritura concurrente.
   Alek y Cata pueden estar empacando al mismo tiempo. Antes, el último en
   escribir pisaba al otro en silencio. Ahora la transacción compara la
   revisión: si el remoto avanzó desde lo último que confirmamos, fusionamos
   en vez de sobrescribir. */
async function commitState(cleanState) {
  let finalState = cleanState;

  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(sharedStateRef);
    let toWrite = cleanState;

    if (snapshot.exists()) {
      const remoteData = snapshot.data();
      const remoteRevision = Number(remoteData?.revision) || 0;

      if (remoteRevision > knownRevision) {
        // Alguien más escribió mientras editábamos: unimos los dos estados.
        const remoteState = readRemoteState(remoteData);
        toWrite = mergeStates(remoteState, cleanState);
        console.info('Fusión por edición concurrente:', summarizeState(toWrite));
      }

      knownRevision = Math.max(knownRevision, remoteRevision);
    }

    finalState = toWrite;
    transaction.set(
      sharedStateRef,
      { ...createRemotePayload(toWrite), revision: knownRevision + 1 },
      { merge: true }
    );
  });

  knownRevision += 1;
  return finalState;
}

async function flushSave() {
  if (!currentUser || !isAllowedEmail(currentUser.email)) {
    showToast('Inicia sesión con una cuenta autorizada');
    return false;
  }

  try {
    state = sanitizeState(state).state;

    // Copia local ANTES de tocar nada remoto.
    pushLocalBackup(state, 'antes-de-guardar');

    if (isDestructiveWrite(state) && !confirmDestructiveWrite(state)) {
      showToast('Guardado cancelado. No se cambió nada.');
      setSyncStatus('Cambios sin guardar');
      return false;
    }

    setSyncStatus('Guardando…');

    const written = await commitState(state);

    // Si la transacción fusionó con cambios de la otra persona, adoptamos
    // el resultado para no quedar mostrando algo distinto a lo guardado.
    if (summarizeState(written).items !== summarizeState(state).items) {
      state = written;
      render();
      showToast('Se combinaron cambios de la otra persona');
    }

    if (shouldWriteVersion(written)) await writeVersionSnapshot(written);

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

/* save() agrupa ráfagas: marcar cinco ítems seguidos es una sola escritura.
   Devuelve una promesa por si alguien necesita esperar el guardado real. */
function save() {
  setSyncStatus('Cambios sin guardar…');

  if (saveTimer) clearTimeout(saveTimer);

  return new Promise(resolve => {
    pendingSaveResolvers.push(resolve);

    saveTimer = setTimeout(async () => {
      saveTimer = null;
      const resolvers = pendingSaveResolvers.splice(0);
      const result = await flushSave();
      resolvers.forEach(fn => fn(result));
    }, SAVE_DEBOUNCE_MS);
  });
}

/* Si cierran la pestaña con un guardado pendiente, lo mandamos ya. */
function flushPendingSaveNow() {
  if (!saveTimer) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  flushSave();
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
          // NO crear el documento automáticamente: si algo falló y el doc
          // desapareció, escribir aquí borraría de forma definitiva lo que
          // hubiera. Mostramos el estado vacío solo en memoria y avisamos.
          state = defaultState();
          initialRemoteLoaded = true;
          showAppShell();
          render();
          setSyncStatus('Sin datos');
          showToast('No hay datos guardados en Firebase. No se escribió nada.');
          return;
        } else {
          const remoteData = snapshot.data();
          state = readRemoteState(remoteData);
          knownRevision = Math.max(knownRevision, Number(remoteData?.revision) || 0);

          // Firestore nos confirmó este contenido: se vuelve la referencia
          // para detectar escrituras destructivas, y queda copiado localmente.
          if (!snapshot.metadata.hasPendingWrites) {
            lastConfirmedRemoteState = deepClone(state);
            pushLocalBackup(state, 'confirmado-remoto');
          }
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

  function placeDraggedItem(clientY) {
    if (!drag?.active || !list) return;

    const siblings = [...list.querySelectorAll('.item:not(.isDragging)')];
    const next = siblings.find(item => {
      const rect = item.getBoundingClientRect();
      return clientY < rect.top + rect.height / 2;
    });

    if (next) list.insertBefore(drag.item, next);
    else list.appendChild(drag.item);
  }

  function stopDragAutoScroll() {
    if (!drag?.scrollFrame) return;
    cancelAnimationFrame(drag.scrollFrame);
    drag.scrollFrame = null;
  }

  function updateDragAutoScroll() {
    if (!drag?.active || !list) return;

    const rect = list.getBoundingClientRect();
    const edgeSize = Math.min(84, rect.height / 3);
    const topDistance = drag.lastY - rect.top;
    const bottomDistance = rect.bottom - drag.lastY;
    let direction = 0;
    let intensity = 0;

    if (topDistance < edgeSize) {
      direction = -1;
      intensity = 1 - Math.max(topDistance, 0) / edgeSize;
    } else if (bottomDistance < edgeSize) {
      direction = 1;
      intensity = 1 - Math.max(bottomDistance, 0) / edgeSize;
    }

    if (!direction) {
      stopDragAutoScroll();
      return;
    }

    const previousScrollTop = list.scrollTop;
    list.scrollTop += direction * (4 + intensity * 16);
    placeDraggedItem(drag.lastY);

    if (list.scrollTop !== previousScrollTop) {
      drag.scrollFrame = requestAnimationFrame(updateDragAutoScroll);
    } else {
      drag.scrollFrame = null;
    }
  }

  function syncDragAutoScroll() {
    stopDragAutoScroll();
    updateDragAutoScroll();
  }

  function clearDragTimer() {
    if (!drag?.timer) return;
    clearTimeout(drag.timer);
    drag.timer = null;
  }

  function finishDrag(event, cancelled = false) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    clearDragTimer();
    stopDragAutoScroll();

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
      lastY: event.clientY,
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
    drag.lastY = event.clientY;
    placeDraggedItem(drag.lastY);
    syncDragAutoScroll();
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

  // Con el debounce, un cambio puede quedar en el aire si cierran la app.
  // visibilitychange es más confiable que beforeunload en móvil.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushPendingSaveNow();
  });
  window.addEventListener('pagehide', flushPendingSaveNow);
}

init();
