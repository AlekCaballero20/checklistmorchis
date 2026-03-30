'use strict';

/* ============================================================================
  RENDER EVENT BINDING
============================================================================ */

const BOUND_TAB_ROWS = new WeakSet();
const BOUND_LISTS = new WeakSet();

/* ============================================================================
  PUBLIC API
============================================================================ */

export function setupRenderEvents({ tabRow, list, onTab, onToggle, onDelete, onEdit }) {
  bindTabEvents(tabRow, onTab);
  bindListEvents(list, { onToggle, onDelete, onEdit });
}

export function renderTabs(state, tabRow) {
  if (!tabRow) return;

  const items = getCurrentItems(state);
  const activeCat = normalizeCategoryId(state?.activeCat || 'all');
  const categories = getCategoriesFromItems(items);
  const counts = countByCategory(items);

  tabRow.setAttribute('role', 'tablist');
  tabRow.setAttribute('aria-label', 'Categorías');

  const html = [
    createTabButton({
      id: 'all',
      label: 'Todo',
      emoji: '🧩',
      active: activeCat === 'all',
      count: items.length
    }),
    ...categories.map((cat) =>
      createTabButton({
        id: cat.id,
        label: cat.name,
        emoji: cat.emoji || '🏷️',
        active: activeCat === cat.id,
        count: counts.get(cat.id) || 0
      })
    )
  ].join('');

  if (tabRow.innerHTML !== html) {
    tabRow.innerHTML = html;
  }
}

export function renderAddCategories(state, selectEl, opts = {}) {
  if (!selectEl) return;

  const items = getCurrentItems(state);
  const categories = getCategoriesFromItems(items);

  const includeAll = !!opts.includeAll;
  const selectedId =
    opts.selected != null ? normalizeCategoryId(opts.selected) : null;

  const parts = [];

  if (includeAll) {
    parts.push(
      `<option value="all"${selectedId === 'all' ? ' selected' : ''}>🧩 Todo</option>`
    );
  }

  for (const cat of categories) {
    const isSelected = selectedId != null && selectedId === cat.id;
    parts.push(
      `<option value="${esc(cat.id)}"${isSelected ? ' selected' : ''}>${esc(cat.emoji || '🏷️')} ${esc(cat.name)}</option>`
    );
  }

  const html = parts.join('');
  if (selectEl.innerHTML !== html) {
    selectEl.innerHTML = html;
  }
}

export function renderList(state, listEl) {
  if (!listEl) return;

  const items = getFilteredItems(state);

  listEl.setAttribute('role', 'list');
  listEl.setAttribute('aria-label', 'Lista de elementos');

  if (!items.length) {
    listEl.innerHTML = '';
    listEl.appendChild(createEmptyState(state));
    return;
  }

  const html = items
    .map((rawItem, index) => createRowMarkup(normalizeItem(rawItem), index))
    .join('');

  if (listEl.innerHTML !== html) {
    listEl.innerHTML = html;
  }
}

export function renderProgress(state, els) {
  const items = getCurrentItems(state);
  const total = items.length;
  const done = items.filter((item) => normalizeItem(item).checked).length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  if (els?.progressText) {
    els.progressText.textContent = `${done}/${total}`;
  }

  if (els?.progressPct) {
    els.progressPct.textContent = `${pct}%`;
  }

  if (els?.progressFill) {
    els.progressFill.style.width = `${pct}%`;
  }

  const progressBar = els?.progressBarEl || null;
  if (progressBar) {
    progressBar.setAttribute('role', 'progressbar');
    progressBar.setAttribute('aria-valuemin', '0');
    progressBar.setAttribute('aria-valuemax', '100');
    progressBar.setAttribute('aria-valuenow', String(pct));
    progressBar.setAttribute('aria-label', `Progreso de la lista: ${pct}%`);
  }

  return {
    done,
    total,
    pct,
    completed: total > 0 && done === total,
    listId: getCurrentListId(state)
  };
}

/* ============================================================================
  EVENTS
============================================================================ */

function bindTabEvents(tabRow, onTab) {
  if (!tabRow || BOUND_TAB_ROWS.has(tabRow)) return;

  tabRow.addEventListener('click', (event) => {
    const button = event.target.closest('[data-cat]');
    if (!button) return;

    onTab?.(button.dataset.cat || 'all');
  });

  tabRow.addEventListener('keydown', (event) => {
    const current = event.target.closest('[data-cat]');
    if (!current) return;

    const tabs = Array.from(tabRow.querySelectorAll('[data-cat]'));
    if (!tabs.length) return;

    const currentIndex = tabs.indexOf(current);
    if (currentIndex < 0) return;

    let nextIndex = currentIndex;

    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (currentIndex + 1) % tabs.length;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = tabs.length - 1;
    } else {
      return;
    }

    event.preventDefault();

    const nextTab = tabs[nextIndex];
    nextTab?.focus();
    onTab?.(nextTab?.dataset?.cat || 'all');
  });

  BOUND_TAB_ROWS.add(tabRow);
}

function bindListEvents(listEl, { onToggle, onDelete, onEdit }) {
  if (!listEl || BOUND_LISTS.has(listEl)) return;

  listEl.addEventListener('click', (event) => {
    const actionButton = event.target.closest('[data-action]');
    const row = event.target.closest('.item[data-id]');

    if (!row) return;

    const id = ensureString(row.dataset.id, 120);
    if (!id) return;

    if (actionButton) {
      const action = actionButton.dataset.action;

      if (action === 'toggle') {
        event.preventDefault();
        event.stopPropagation();
        onToggle?.(id);
        return;
      }

      if (action === 'edit') {
        event.preventDefault();
        event.stopPropagation();
        onEdit?.(id);
        return;
      }

      if (action === 'del') {
        event.preventDefault();
        event.stopPropagation();
        onDelete?.(id);
        return;
      }
    }

    if (isInteractiveElement(event.target)) return;

    onToggle?.(id);
  });

  listEl.addEventListener('keydown', (event) => {
    const row = event.target.closest('.item[data-id]');
    if (!row) return;

    const id = ensureString(row.dataset.id, 120);
    if (!id) return;

    if (event.key !== 'Enter' && event.key !== ' ') return;

    if (event.target.closest('[data-action]')) return;

    event.preventDefault();
    onToggle?.(id);
  });

  BOUND_LISTS.add(listEl);
}

/* ============================================================================
  ROWS
============================================================================ */

function createRowMarkup(item, index = 0) {
  const checked = !!item.checked;
  const itemText = item.text || 'Sin nombre';
  const categoryName = prettifyCategory(item.category);
  const categoryEmoji = guessCategoryEmoji(item.category);
  const mainEmoji = item.emoji || categoryEmoji || '✨';

  return `
    <div
      class="item${checked ? ' done' : ''}"
      data-id="${esc(item.id)}"
      data-checked="${checked ? 'true' : 'false'}"
      role="listitem"
      tabindex="0"
      aria-label="${esc(buildRowAriaLabel(itemText, categoryName, checked))}"
      data-index="${index}"
    >
      <div class="itemLeft">
        <div class="bubble" aria-hidden="true">${esc(mainEmoji)}</div>

        <div class="itemText">
          <div class="itemName">${esc(itemText)}</div>
          <div class="itemMeta">${esc(categoryEmoji || '🏷️')} ${esc(categoryName)}</div>
        </div>
      </div>

      <div class="itemRight">
        <button
          class="btn ghost itemAction itemAction--edit"
          type="button"
          data-action="edit"
          aria-label="Editar ${esc(itemText)}"
          title="Editar"
        >
          <span aria-hidden="true">✏️</span>
        </button>

        <button
          class="btn ghost itemAction itemAction--delete"
          type="button"
          data-action="del"
          aria-label="Eliminar ${esc(itemText)}"
          title="Eliminar"
        >
          <span aria-hidden="true">🗑️</span>
        </button>

        ${createToggleMarkup(checked, itemText)}
      </div>
    </div>
  `.trim();
}

function createToggleMarkup(checked, itemText) {
  const isChecked = !!checked;
  const ariaLabel = isChecked
    ? `Marcar ${itemText} como pendiente`
    : `Marcar ${itemText} como hecho`;

  return `
    <button
      class="check ${isChecked ? 'is-checked' : 'is-unchecked'}"
      type="button"
      data-action="toggle"
      data-checked="${isChecked ? 'true' : 'false'}"
      role="switch"
      aria-checked="${isChecked ? 'true' : 'false'}"
      aria-label="${esc(ariaLabel)}"
      title="${isChecked ? 'Marcar como pendiente' : 'Marcar como hecho'}"
    >
      <span class="checkTrack" aria-hidden="true">
        <span class="knob"></span>
      </span>
      <span class="sr-only">${isChecked ? 'Hecho' : 'Pendiente'}</span>
    </button>
  `.trim();
}

function createEmptyState(state) {
  const activeCat = normalizeCategoryId(state?.activeCat || 'all');

  const info =
    activeCat === 'all'
      ? { emoji: '🧩', text: 'Agrega algo a la lista' }
      : {
          emoji: guessCategoryEmoji(activeCat),
          text: `Nada en ${prettifyCategory(activeCat)}`
        };

  const wrapper = document.createElement('div');
  wrapper.className = 'item item--empty';
  wrapper.setAttribute('role', 'listitem');
  wrapper.setAttribute('aria-label', 'No hay ítems en esta vista');

  wrapper.innerHTML = `
    <div class="itemLeft">
      <div class="bubble" aria-hidden="true">🫥</div>
      <div class="itemText">
        <div class="itemName">No hay ítems aquí.</div>
        <div class="itemMeta">${esc(info.emoji)} ${esc(info.text)}</div>
      </div>
    </div>

    <div class="check check--static" aria-hidden="true">
      <span class="checkTrack">
        <span class="knob"></span>
      </span>
    </div>
  `.trim();

  return wrapper;
}

/* ============================================================================
  DATA HELPERS
============================================================================ */

function getCurrentListId(state) {
  return ensureString(state?.currentListId, 120) || null;
}

function getCurrentItems(state) {
  const currentListId = getCurrentListId(state);
  const itemsByListId = isPlainObject(state?.itemsByListId) ? state.itemsByListId : {};
  const items = Array.isArray(itemsByListId[currentListId])
    ? itemsByListId[currentListId]
    : [];

  return items.map(normalizeItem);
}

function getFilteredItems(state) {
  const items = getCurrentItems(state);
  const activeCat = normalizeCategoryId(state?.activeCat || 'all');

  if (activeCat === 'all') {
    return items;
  }

  return items.filter((item) => normalizeCategoryId(item.category) === activeCat);
}

function getCategoriesFromItems(items) {
  const map = new Map();

  for (const rawItem of Array.isArray(items) ? items : []) {
    const item = normalizeItem(rawItem);
    const id = normalizeCategoryId(item.category || 'general');

    if (!map.has(id)) {
      map.set(id, {
        id,
        key: id,
        name: prettifyCategory(id),
        label: prettifyCategory(id),
        emoji: guessCategoryEmoji(id, item.emoji)
      });
    }
  }

  if (!map.size) {
    map.set('general', {
      id: 'general',
      key: 'general',
      name: 'General',
      label: 'General',
      emoji: '🏷️'
    });
  }

  return Array.from(map.values());
}

function normalizeItem(item) {
  return {
    id: ensureString(item?.id, 120),
    text: ensureString(item?.text ?? item?.name ?? item?.title, 180) || 'Sin nombre',
    checked: !!(item?.checked ?? item?.done),
    category: normalizeCategoryId(item?.category ?? item?.cat ?? 'general'),
    emoji: safeEmoji(item?.emoji),
    notes: ensureString(item?.notes, 500) || '',
    createdAt: ensureString(item?.createdAt, 40),
    updatedAt: ensureString(item?.updatedAt, 40)
  };
}

function countByCategory(items) {
  const map = new Map();

  for (const rawItem of Array.isArray(items) ? items : []) {
    const item = normalizeItem(rawItem);
    const categoryId = normalizeCategoryId(item.category);
    map.set(categoryId, (map.get(categoryId) || 0) + 1);
  }

  return map;
}

/* ============================================================================
  CATEGORY + UI HELPERS
============================================================================ */

function createTabButton({ id, label, emoji, active, count }) {
  return `
    <button
      class="tab ${active ? 'active' : ''}"
      type="button"
      data-cat="${esc(id)}"
      role="tab"
      aria-selected="${active ? 'true' : 'false'}"
      tabindex="${active ? '0' : '-1'}"
    >
      <span class="tabEmoji" aria-hidden="true">${esc(emoji)}</span>
      <span class="tabLabel">${esc(label)}</span>
      <span class="tabCount" aria-hidden="true">${Number(count || 0)}</span>
    </button>
  `.trim();
}

function buildRowAriaLabel(itemText, categoryName, checked) {
  return `${itemText}. Categoría ${categoryName}. ${checked ? 'Completado' : 'Pendiente'}`;
}

function guessCategoryEmoji(categoryId, fallbackEmoji = null) {
  const map = {
    general: '🏷️',
    tech: '🔌',
    tecnologia: '🔌',
    docs: '🪪',
    documentos: '🪪',
    ropa: '👕',
    higiene: '🧼',
    salud: '💊',
    trabajo: '💼',
    mercado: '🛒',
    viaje: '✈️',
    audio: '🎧',
    musica: '🎵',
    estudio: '📚',
    llaves: '🔑'
  };

  return safeEmoji(fallbackEmoji) || map[normalizeCategoryId(categoryId)] || '🏷️';
}

function normalizeCategoryId(value) {
  const raw = String(value ?? '').trim().toLowerCase();

  const clean = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s_-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '');

  return clean || 'general';
}

function prettifyCategory(value) {
  const clean = normalizeCategoryId(value).replace(/[-_]+/g, ' ');

  return clean
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || 'General';
}

/* ============================================================================
  GENERIC HELPERS
============================================================================ */

function isInteractiveElement(target) {
  if (!(target instanceof Element)) return false;

  return !!target.closest(
    'button, a, input, select, textarea, summary, details, label, [role="button"], [role="switch"], [contenteditable="true"]'
  );
}

function ensureString(value, maxLen = 100) {
  const out = String(value ?? '').trim();
  return maxLen > 0 ? out.slice(0, maxLen) : out;
}

function safeEmoji(value) {
  const clean = ensureString(value, 16);
  return clean || null;
}

function isPlainObject(value) {
  return (
    value != null &&
    typeof value === 'object' &&
    (value.constructor === Object || Object.getPrototypeOf(value) === Object.prototype)
  );
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}