/* =============================================================================
  /src/render.js — UI rendering (no business logic) — MODE-AWARE + IMPROVED
  - ✅ Renders tabs, list, progress, add-category select
  - ✅ Delegated events for tabs + list (toggle/delete/edit)
  - ✅ Smart keyed list rendering to reduce jank on toggles
  - ✅ Works with modern data shape:
      data.itemsByMode[mode], data.cats, data.modes
    and also with legacy-ish shapes:
      data.items, data.catsByMode, data.__completedOnce
  - ✅ Category compatibility:
      supports cats with {id,name,emoji} and/or {key,label,emoji}
  - ✅ Safer DOM updates + better accessibility
============================================================================= */

'use strict';

/* =========================
   PUBLIC API
========================= */

/**
 * setupRenderEvents
 * Delegated UI events for tabs and list.
 * @param {Object} opts
 * @param {HTMLElement} opts.tabRow
 * @param {HTMLElement} opts.list
 * @param {Function} opts.onTab     (catId) => void
 * @param {Function} opts.onToggle  (id) => void
 * @param {Function} opts.onDelete  (id) => void
 * @param {Function} [opts.onEdit]  (id) => void
 */
export function setupRenderEvents({ tabRow, list, onTab, onToggle, onDelete, onEdit }) {
  if (tabRow) {
    tabRow.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-cat]');
      if (!btn) return;
      onTab?.(btn.dataset.cat || 'all');
    });

    tabRow.addEventListener('keydown', (e) => {
      const current = e.target.closest('[data-cat]');
      if (!current) return;

      const tabs = Array.from(tabRow.querySelectorAll('[data-cat]'));
      if (!tabs.length) return;

      const idx = tabs.indexOf(current);
      if (idx < 0) return;

      let nextIdx = -1;

      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        nextIdx = (idx + 1) % tabs.length;
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        nextIdx = (idx - 1 + tabs.length) % tabs.length;
      } else if (e.key === 'Home') {
        nextIdx = 0;
      } else if (e.key === 'End') {
        nextIdx = tabs.length - 1;
      } else {
        return;
      }

      e.preventDefault();
      const next = tabs[nextIdx];
      next?.focus();
      onTab?.(next?.dataset?.cat || 'all');
    });
  }

  if (list) {
    list.addEventListener('click', (e) => {
      const actionEl = e.target.closest('[data-action]');
      const row = e.target.closest('[data-id]');
      if (!row) return;

      const id = row.dataset.id;
      if (!id) return;

      if (actionEl) {
        const action = actionEl.dataset.action;

        if (action === 'del') {
          e.stopPropagation();
          onDelete?.(id);
          return;
        }

        if (action === 'edit') {
          e.stopPropagation();
          onEdit?.(id);
          return;
        }

        if (action === 'toggle') {
          e.stopPropagation();
          onToggle?.(id);
          return;
        }
      }

      // Click default on row toggles
      onToggle?.(id);
    });

    list.addEventListener('keydown', (e) => {
      const row = e.target.closest('[data-id]');
      if (!row) return;

      const id = row.dataset.id;
      if (!id) return;

      if (e.key === 'Enter' || e.key === ' ') {
        if (e.target.closest('[data-action="edit"], [data-action="del"]')) return;
        e.preventDefault();
        onToggle?.(id);
      }
    });
  }
}

/**
 * renderTabs
 * @param {Object} state
 * @param {HTMLElement} tabRow
 * @param {Object} [opts]
 * @param {boolean} [opts.showCounts=true]
 */
export function renderTabs(state, tabRow, opts = {}) {
  if (!tabRow) return;

  const mode = getCurrentMode(state);
  const cats = getCats(state, mode);
  const active = normalizeCatId(state?.activeCat || 'all');
  const { showCounts = true } = opts;

  const items = getItems(state, mode);
  const counts = showCounts ? countByCat(items) : null;

  tabRow.setAttribute('role', 'tablist');
  tabRow.setAttribute('aria-label', 'Categorías');

  const html = [
    tabBtn('all', 'Todo', '🧩', active === 'all', showCounts ? items.length : null),
    ...cats.map((cat) => {
      const c = normalizeCat(cat);
      return tabBtn(
        c.id,
        c.name,
        c.emoji || '🏷️',
        active === c.id,
        showCounts ? (counts.get(c.id) || 0) : null
      );
    })
  ].join('');

  tabRow.innerHTML = html;
}

/**
 * renderAddCategories
 * @param {Object} state
 * @param {HTMLSelectElement} selectEl
 * @param {Object} [opts]
 * @param {boolean} [opts.includeAll=false]
 * @param {string|null} [opts.selected]
 */
export function renderAddCategories(state, selectEl, opts = {}) {
  if (!selectEl) return;

  const mode = getCurrentMode(state);
  const cats = getCats(state, mode);
  const { includeAll = false, selected = null } = opts;

  const parts = [];

  if (includeAll) {
    parts.push(`<option value="all"${selected === 'all' ? ' selected' : ''}>🧩 Todo</option>`);
  }

  for (const rawCat of cats) {
    const c = normalizeCat(rawCat);
    const isSelected = selected != null && normalizeCatId(selected) === c.id;
    parts.push(
      `<option value="${esc(c.id)}"${isSelected ? ' selected' : ''}>${esc(c.emoji || '🏷️')} ${esc(c.name)}</option>`
    );
  }

  selectEl.innerHTML = parts.join('');
}

/**
 * renderList
 * Smart keyed rendering: updates existing rows & reorders with minimal DOM churn.
 *
 * @param {Object} state
 * @param {HTMLElement} listEl
 */
export function renderList(state, listEl) {
  if (!listEl) return;

  const mode = getCurrentMode(state);
  const items = filteredItems(state, mode);

  listEl.setAttribute('role', 'list');
  listEl.setAttribute('aria-label', 'Lista de elementos');

  if (!items.length) {
    listEl.innerHTML = '';
    listEl.appendChild(createEmptyEl(state, mode));
    return;
  }

  const existing = new Map();
  for (const el of Array.from(listEl.querySelectorAll('.item[data-id]'))) {
    existing.set(el.dataset.id, el);
  }

  const motion = !!state?.settings?.motion;
  const frag = document.createDocumentFragment();

  for (let idx = 0; idx < items.length; idx++) {
    const it = normalizeItem(items[idx]);
    const id = String(it.id || '');

    let row = existing.get(id);
    if (row) {
      updateRowEl(row, state, mode, it);
      existing.delete(id);
    } else {
      row = createRowEl(state, mode, it, idx, { motion });
    }

    frag.appendChild(row);
  }

  for (const leftover of existing.values()) {
    leftover.remove();
  }

  listEl.replaceChildren(frag);
}

/**
 * renderProgress
 * Updates progress UI and returns computed values for CURRENT MODE.
 *
 * @param {Object} state
 * @param {Object} els
 * @param {HTMLElement} els.progressFill
 * @param {HTMLElement} els.progressText
 * @param {HTMLElement} els.progressPct
 * @param {HTMLElement|null} els.progressBarEl Optional
 *
 * @returns {{done:number,total:number,pct:number,completed:boolean,mode:string}}
 */
export function renderProgress(state, els) {
  const mode = getCurrentMode(state);
  const items = getItems(state, mode);

  const done = items.filter(i => normalizeItem(i).done).length;
  const total = items.length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  if (els?.progressText) els.progressText.textContent = `${done}/${total}`;
  if (els?.progressPct) els.progressPct.textContent = `${pct}%`;
  if (els?.progressFill) els.progressFill.style.width = `${pct}%`;

  const bar = els?.progressBarEl || document.querySelector('.progressBar');
  if (bar) {
    bar.setAttribute('aria-valuenow', String(pct));
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', '100');
    bar.setAttribute('role', 'progressbar');
  }

  const completed = total > 0 && done === total;
  return { done, total, pct, completed, mode };
}

/* =========================
   INTERNALS
========================= */

function getCurrentMode(state) {
  return String(
    state?.settings?.tripMode ||
    state?.data?.mode ||
    'salida'
  );
}

function getCats(state, mode) {
  // Legacy-ish per mode
  const catsByMode = state?.data?.catsByMode;
  if (catsByMode && typeof catsByMode === 'object' && Array.isArray(catsByMode[mode])) {
    return dedupeCats(catsByMode[mode].map(normalizeCat));
  }

  // Modern canonical shared cats
  if (Array.isArray(state?.data?.cats)) {
    return dedupeCats(state.data.cats.map(normalizeCat));
  }

  return [normalizeCat({ id: 'otros', name: 'Otros', emoji: null })];
}

function getItems(state, mode) {
  const byMode = state?.data?.itemsByMode;
  if (byMode && typeof byMode === 'object') {
    const arr = byMode[mode];
    if (Array.isArray(arr)) return arr.map(normalizeItem);
    return [];
  }

  // Legacy fallback
  if (Array.isArray(state?.data?.items)) {
    return state.data.items.map(normalizeItem);
  }

  return [];
}

function filteredItems(state, mode) {
  const items = getItems(state, mode);
  const active = normalizeCatId(state?.activeCat || 'all');

  if (active === 'all') return items;
  return items.filter(i => normalizeCatId(i?.cat) === active);
}

function normalizeCat(cat) {
  if (typeof cat === 'string') {
    const id = normalizeCatId(cat);
    return {
      id,
      key: id,
      name: cat.trim() || 'Otros',
      label: cat.trim() || 'Otros',
      emoji: null
    };
  }

  const id = normalizeCatId(
    cat?.id ||
    cat?.key ||
    cat?.slug ||
    cat?.value ||
    'otros'
  );

  const name = safeText(
    cat?.name ||
    cat?.label ||
    cat?.title ||
    idToLabel(id),
    'Otros'
  );

  return {
    id,
    key: id,
    name,
    label: name,
    emoji: safeEmoji(cat?.emoji)
  };
}

function normalizeItem(it) {
  return {
    id: String(it?.id || ''),
    cat: normalizeCatId(it?.cat || it?.category || 'otros'),
    name: safeText(it?.name || it?.title, 'Sin nombre'),
    emoji: safeEmoji(it?.emoji),
    done: !!it?.done,
    modes: Array.isArray(it?.modes) ? it.modes.map(String) : null,
    originId: it?.originId ? String(it.originId) : null
  };
}

function normalizeCatId(v) {
  const raw = String(v ?? '').trim().toLowerCase();

  const s = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s_-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '');

  return s || 'otros';
}

function safeText(v, fallback = '') {
  const s = String(v ?? '').trim();
  return s || fallback;
}

function safeEmoji(v) {
  const s = String(v ?? '').trim();
  return s || null;
}

function idToLabel(id) {
  return String(id || 'otros')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function dedupeCats(cats) {
  const out = [];
  const seen = new Set();

  for (const raw of cats || []) {
    const c = normalizeCat(raw);
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
  }

  if (!seen.has('otros')) {
    out.push(normalizeCat({ id: 'otros', name: 'Otros', emoji: null }));
  }

  return out;
}

function tabBtn(id, name, emoji, active, countOrNull) {
  const badge = (typeof countOrNull === 'number')
    ? `<span class="tabCount" aria-hidden="true">${countOrNull}</span>`
    : '';

  return `
    <button
      class="tab ${active ? 'active' : ''}"
      data-cat="${esc(id)}"
      role="tab"
      aria-selected="${active ? 'true' : 'false'}"
      tabindex="${active ? '0' : '-1'}"
      type="button"
    >
      <span class="tabEmoji" aria-hidden="true">${esc(emoji)}</span>
      <span class="tabLabel">${esc(name)}</span>
      ${badge}
    </button>
  `.trim();
}

function getCatMeta(state, mode, catId) {
  const cats = getCats(state, mode);
  const wanted = normalizeCatId(catId);
  const cat = cats.find(c => normalizeCatId(c.id) === wanted) || cats.find(c => c.id === 'otros');

  return {
    id: cat?.id || 'otros',
    name: cat?.name || 'Otros',
    emoji: cat?.emoji || '🏷️'
  };
}

function computeDelay(idx, motion) {
  if (!motion) return 0;
  return Math.min(idx * 22, 200);
}

function createRowEl(state, mode, it, idx, { motion } = {}) {
  const meta = getCatMeta(state, mode, it.cat);
  const delay = computeDelay(idx, motion);

  const row = document.createElement('div');
  row.className = `item ${it.done ? 'done' : ''}`;
  row.dataset.id = String(it.id || '');
  row.setAttribute('role', 'listitem');
  row.setAttribute('tabindex', '0');
  row.setAttribute('aria-label', `${it.name}. Categoría ${meta.name}. ${it.done ? 'Completado' : 'Pendiente'}`);

  if (delay > 0) {
    row.style.animationDelay = `${delay}ms`;
  }

  row.innerHTML = `
    <div class="pop"></div>

    <div class="itemLeft">
      <div class="bubble" aria-hidden="true">${esc(it.emoji || meta.emoji || '✨')}</div>
      <div class="itemText">
        <div class="itemName">${esc(it.name)}</div>
        <div class="itemMeta">${esc(meta.emoji || '🏷️')} ${esc(meta.name)}</div>
      </div>
    </div>

    <div class="itemRight" style="display:flex; align-items:center; gap:10px;">
      <button class="btn ghost" type="button" data-action="edit" aria-label="Editar ${esc(it.name)}" title="Editar">✏️</button>
      <button class="btn ghost" type="button" data-action="del" aria-label="Eliminar ${esc(it.name)}" title="Eliminar">🗑️</button>
      <button class="check" type="button" data-action="toggle" aria-label="${it.done ? 'Marcar como pendiente' : 'Marcar como hecho'}">
        <div class="knob"></div>
      </button>
    </div>
  `.trim();

  return row;
}

function updateRowEl(row, state, mode, it) {
  row.classList.toggle('done', !!it.done);

  const meta = getCatMeta(state, mode, it.cat);

  const bubble = row.querySelector('.bubble');
  const nameEl = row.querySelector('.itemName');
  const metaEl = row.querySelector('.itemMeta');
  const toggleBtn = row.querySelector('[data-action="toggle"]');
  const editBtn = row.querySelector('[data-action="edit"]');
  const delBtn = row.querySelector('[data-action="del"]');

  const bubbleText = String(it.emoji || meta.emoji || '✨');
  if (bubble && bubble.textContent !== bubbleText) bubble.textContent = bubbleText;

  const nameText = String(it.name || 'Sin nombre');
  if (nameEl && nameEl.textContent !== nameText) nameEl.textContent = nameText;

  const metaText = `${meta.emoji || '🏷️'} ${meta.name}`;
  if (metaEl && metaEl.textContent !== metaText) metaEl.textContent = metaText;

  if (toggleBtn) {
    toggleBtn.setAttribute('aria-label', it.done ? 'Marcar como pendiente' : 'Marcar como hecho');
  }

  if (editBtn) {
    editBtn.setAttribute('aria-label', `Editar ${nameText}`);
  }

  if (delBtn) {
    delBtn.setAttribute('aria-label', `Eliminar ${nameText}`);
  }

  row.setAttribute(
    'aria-label',
    `${nameText}. Categoría ${meta.name}. ${it.done ? 'Completado' : 'Pendiente'}`
  );

  if (row.style.animationDelay) row.style.animationDelay = '';
}

function createEmptyEl(state, mode) {
  const active = normalizeCatId(state?.activeCat || 'all');
  const meta = active === 'all'
    ? { name: 'todo', emoji: '🧩' }
    : getCatMeta(state, mode, active);

  const wrap = document.createElement('div');
  wrap.className = 'item item--empty';
  wrap.setAttribute('role', 'listitem');

  wrap.innerHTML = `
    <div class="itemLeft">
      <div class="bubble" aria-hidden="true">🫥</div>
      <div class="itemText">
        <div class="itemName">No hay items aquí.</div>
        <div class="itemMeta">${esc(meta.emoji)} ${esc(active === 'all' ? 'Agrega algo a la lista' : `Nada en ${meta.name}`)}</div>
      </div>
    </div>
    <div class="check" aria-hidden="true"><div class="knob"></div></div>
  `.trim();

  return wrap;
}

function countByCat(items) {
  const m = new Map();

  for (const raw of (items || [])) {
    const it = normalizeItem(raw);
    if (!it.cat) continue;
    m.set(it.cat, (m.get(it.cat) || 0) + 1);
  }

  return m;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, m => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[m]));
}