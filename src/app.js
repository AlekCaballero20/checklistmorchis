'use strict';
/* =============================================================================
   Maleta · app.js
   ~280 líneas. Sin frameworks. Sin duplicación. Sin magia.
   - State: objeto plano en memoria + localStorage
   - Render: funciones puras que escriben innerHTML
   - Events: un solo listener global (delegación) + bindings directos
============================================================================= */

/* ─── CONSTANTES ─────────────────────────────────────────────────────────── */
const KEY = 'maleta_v1';

/* ─── HELPERS ────────────────────────────────────────────────────────────── */
const $ = id => document.getElementById(id);
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
const esc = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* ─── ESTADO ─────────────────────────────────────────────────────────────── */
function defaultState() {
  const id = uid();
  return {
    lists: [{ id, name: 'Mi lista', icon: '🧾' }],
    items: [],
    activeListId: id
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultState();
    const s = JSON.parse(raw);
    if (!Array.isArray(s.lists) || !s.lists.length) return defaultState();
    if (!Array.isArray(s.items)) s.items = [];
    s.items = s.items.map(i => ({ emoji: '', done: false, ...i }));
    if (!s.lists.find(l => l.id === s.activeListId)) {
      s.activeListId = s.lists[0].id;
    }
    return s;
  } catch {
    return defaultState();
  }
}

let state = loadState();

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
}

/* ─── GETTERS ────────────────────────────────────────────────────────────── */
const getActiveList  = () => state.lists.find(l => l.id === state.activeListId) || state.lists[0];
const getActiveItems = () => state.items.filter(i => i.listId === state.activeListId);
const getListItems   = id => state.items.filter(i => i.listId === id);

/* ─── MUTACIONES ─────────────────────────────────────────────────────────── */
function selectList(id) {
  if (!state.lists.find(l => l.id === id)) return false;
  state.activeListId = id;
  save(); return true;
}

function addList(name, icon = '📋') {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const list = { id: uid(), name: trimmed, icon: icon.trim() || '📋' };
  state.lists.push(list);
  state.activeListId = list.id;
  save(); return list;
}

function deleteList(id) {
  if (state.lists.length <= 1) return false;
  state.lists = state.lists.filter(l => l.id !== id);
  state.items = state.items.filter(i => i.listId !== id);
  if (state.activeListId === id) state.activeListId = state.lists[0].id;
  save(); return true;
}

function addItem(text, emoji = '', listId) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const targetId = listId || state.activeListId;
  if (!state.lists.find(l => l.id === targetId)) return null;
  const item = { id: uid(), listId: targetId, text: trimmed, emoji: emoji.trim(), done: false };
  state.items.push(item);
  save(); return item;
}

function toggleItem(id) {
  const item = state.items.find(i => i.id === id);
  if (!item) return;
  item.done = !item.done;
  save();
}

function deleteItem(id) {
  state.items = state.items.filter(i => i.id !== id);
  save();
}

function resetItems() {
  getActiveItems().forEach(i => { i.done = false; });
  save();
}

function setAllDone(done) {
  getActiveItems().forEach(i => { i.done = done; });
  save();
}

/* ─── RENDER ─────────────────────────────────────────────────────────────── */
function render() {
  renderHero();
  renderItems();
}

function renderHero() {
  const list  = getActiveList();
  const items = getActiveItems();
  const total = items.length;
  const done  = items.filter(i => i.done).length;
  const pct   = total > 0 ? Math.round((done / total) * 100) : 0;

  $('tripPill').textContent = `${list.icon} ${list.name}`;
  $('progressText').textContent = `${done}/${total}`;
  $('progressPct').textContent = `${pct}%`;
  $('progressFill').style.width = pct + '%';
  $('progressBar').setAttribute('aria-valuenow', pct);
}

function renderItems() {
  const items     = getActiveItems();
  const container = $('list');

  if (!items.length) {
    container.innerHTML = `
      <div class="emptyState">
        <div class="emptyEmoji">🐾</div>
        <strong>No hay ítems aquí.</strong>
        <span>Agrega algo a la lista</span>
      </div>`;
    return;
  }

  // Pendientes primero, luego hechos
  const sorted = [
    ...items.filter(i => !i.done),
    ...items.filter(i =>  i.done)
  ];

  container.innerHTML = sorted.map(item => `
    <div class="item${item.done ? ' isDone' : ''}" data-id="${esc(item.id)}">
      <button class="itemToggle" data-action="toggle" data-id="${esc(item.id)}"
              aria-label="${item.done ? 'Desmarcar' : 'Marcar como listo'}">
        ${item.done ? '✅' : ''}
      </button>
      <span class="itemLabel">${item.emoji ? esc(item.emoji) + ' ' : ''}${esc(item.text)}</span>
      <button class="itemDelete" data-action="delete-item" data-id="${esc(item.id)}"
              aria-label="Eliminar ítem">✕</button>
    </div>`).join('');
}

function renderListsManager() {
  const container = $('listsList');
  if (!container) return;

  if (!state.lists.length) {
    container.innerHTML = '<p style="color:var(--muted);font-size:14px;text-align:center">Sin listas todavía</p>';
    return;
  }

  container.innerHTML = state.lists.map(list => {
    const count    = getListItems(list.id).length;
    const isActive = list.id === state.activeListId;
    const canDel   = state.lists.length > 1;
    return `
      <div class="listChip${isActive ? ' isActive' : ''}">
        <button class="listChipLabel" data-action="select-list" data-id="${esc(list.id)}">
          <span>${esc(list.icon)} ${esc(list.name)}</span>
          <span class="listChipCount">${count}</span>
        </button>
        ${canDel
          ? `<button class="listChipDelete" data-action="delete-list" data-id="${esc(list.id)}"
                     aria-label="Eliminar ${esc(list.name)}">✕</button>`
          : ''}
      </div>`;
  }).join('');
}

function populateListSelect(selectId) {
  const sel = $(selectId);
  if (!sel) return;
  sel.innerHTML = state.lists.map(l =>
    `<option value="${esc(l.id)}"${l.id === state.activeListId ? ' selected' : ''}>${esc(l.icon + ' ' + l.name)}</option>`
  ).join('');
}

/* ─── MODALES ────────────────────────────────────────────────────────────── */
let _returnFocus = null;

function openModal(id, returnEl) {
  const overlay = $(id);
  if (!overlay) return;
  _returnFocus = returnEl || null;
  overlay.classList.add('show');
  overlay.setAttribute('aria-hidden', 'false');
  // foco al primer input después de la animación
  setTimeout(() => overlay.querySelector('input, select')?.focus(), 80);
}

function closeModal(id) {
  const overlay = $(id);
  if (!overlay) return;
  overlay.classList.remove('show');
  overlay.setAttribute('aria-hidden', 'true');
  _returnFocus?.focus();
  _returnFocus = null;
}

function openAddModal(returnEl) {
  populateListSelect('newItemList');
  $('newName').value  = '';
  $('newEmoji').value = '';
  openModal('addOverlay', returnEl);
}

function openListsModal(returnEl) {
  renderListsManager();
  $('newListName').value = '';
  $('newListIcon').value = '';
  openModal('listsOverlay', returnEl);
}

/* ─── TOAST ──────────────────────────────────────────────────────────────── */
let _toastTimer;
function showToast(msg) {
  const el = $('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

/* ─── EVENTOS ────────────────────────────────────────────────────────────── */

// — Delegación global (ítems, chips de lista)
document.addEventListener('click', e => {
  // Cerrar modal al clickear el overlay de fondo
  if (e.target.classList.contains('modalOverlay')) {
    closeModal(e.target.id);
    return;
  }

  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const { action, id } = btn.dataset;

  switch (action) {
    case 'toggle':
      toggleItem(id);
      render();
      break;

    case 'delete-item':
      deleteItem(id);
      render();
      showToast('Ítem eliminado');
      break;

    case 'select-list':
      if (selectList(id)) {
        closeModal('listsOverlay');
        render();
      }
      break;

    case 'delete-list':
      if (confirm('¿Eliminar esta lista con todos sus ítems?')) {
        deleteList(id);
        renderListsManager();
        render();
        showToast('Lista eliminada');
      }
      break;
  }
});

// — Abrir modales
$('btnAdd').addEventListener('click',         () => openAddModal($('btnAdd')));
$('btnAddFooter').addEventListener('click',   () => openAddModal($('btnAddFooter')));
$('btnSettings').addEventListener('click',   () => openListsModal($('btnSettings')));
$('tripPill').addEventListener('click',      () => openListsModal($('tripPill')));

// — Cerrar modales
$('btnCloseAdd').addEventListener('click',   () => closeModal('addOverlay'));
$('btnCloseLists').addEventListener('click', () => closeModal('listsOverlay'));

// — Agregar ítem
function doAddItem() {
  const text = $('newName').value.trim();
  if (!text) { $('newName').focus(); return; }
  addItem(text, $('newEmoji').value.trim(), $('newItemList').value);
  closeModal('addOverlay');
  render();
  showToast('✅ Ítem agregado');
}

$('btnCreate').addEventListener('click', doAddItem);
$('newName').addEventListener('keydown', e => {
  if (e.key === 'Enter')  { e.preventDefault(); doAddItem(); }
  if (e.key === 'Escape') closeModal('addOverlay');
});
$('newEmoji').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); doAddItem(); }
});

// — Crear lista
function doAddList() {
  const name = $('newListName').value.trim();
  if (!name) { $('newListName').focus(); return; }
  addList(name, $('newListIcon').value.trim());
  $('newListName').value = '';
  $('newListIcon').value = '';
  renderListsManager();
  render();
  showToast('✅ Lista creada');
}

$('btnCreateList').addEventListener('click', doAddList);
$('newListName').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); doAddList(); }
});

// — Controles del hero
$('btnReset').addEventListener('click',          () => { resetItems();    render(); showToast('Lista reiniciada'); });
$('btnSelectAll').addEventListener('click',      () => { setAllDone(true);  render(); });
$('btnUncheckAll').addEventListener('click',     () => { setAllDone(false); render(); });
$('btnSelectAllFooter').addEventListener('click',() => { setAllDone(true);  render(); });
$('btnUncheckAllFooter').addEventListener('click',()=> { setAllDone(false); render(); });

// — Escape cierra cualquier modal abierto
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  ['addOverlay', 'listsOverlay'].forEach(id => closeModal(id));
});

/* ─── INIT ───────────────────────────────────────────────────────────────── */
render();
