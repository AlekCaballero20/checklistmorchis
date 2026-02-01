/* =============================================================================
  /src/render.js — UI rendering (no business logic)
  - Renders tabs, list, progress, add-category select
  - Binds delegated events (tabs + list) via setupRenderEvents
  - Pure-ish: reads state, writes DOM
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
 */
export function setupRenderEvents({ tabRow, list, onTab, onToggle, onDelete }){
  if (tabRow){
    tabRow.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-cat]');
      if (!btn) return;
      onTab?.(btn.dataset.cat);
    });
  }

  if (list){
    list.addEventListener('click', (e) => {
      const row = e.target.closest('[data-id]');
      if (!row) return;

      if (e.target.closest('[data-action="del"]')){
        onDelete?.(row.dataset.id);
        return;
      }

      onToggle?.(row.dataset.id);
    });
  }
}

/**
 * renderTabs
 * @param {Object} state
 * @param {HTMLElement} tabRow
 */
export function renderTabs(state, tabRow){
  if (!tabRow) return;

  const cats = state?.data?.cats || [];
  const active = state?.activeCat || 'all';

  const html = [
    tabBtn('all', 'Todo', '🧩', active === 'all'),
    ...cats.map(c => tabBtn(c.id, c.name, c.emoji || '🏷️', active === c.id))
  ].join('');

  tabRow.innerHTML = html;
}

/**
 * renderAddCategories
 * @param {Object} state
 * @param {HTMLSelectElement} selectEl
 */
export function renderAddCategories(state, selectEl){
  if (!selectEl) return;

  const cats = state?.data?.cats || [];
  selectEl.innerHTML = cats.map(c => (
    `<option value="${esc(c.id)}">${esc(c.emoji || '🏷️')} ${esc(c.name)}</option>`
  )).join('');
}

/**
 * renderList
 * @param {Object} state
 * @param {HTMLElement} listEl
 */
export function renderList(state, listEl){
  if (!listEl) return;

  const items = filteredItems(state);
  if (!items.length){
    listEl.innerHTML = emptyHTML();
    return;
  }

  listEl.innerHTML = items.map((it, idx) => rowHTML(state, it, idx)).join('');
}

/**
 * renderProgress
 * Updates progress UI and returns computed values.
 *
 * @param {Object} state
 * @param {Object} els
 * @param {HTMLElement} els.progressFill
 * @param {HTMLElement} els.progressText
 * @param {HTMLElement} els.progressPct
 * @param {HTMLElement|null} els.progressBarEl Optional (if not provided, query .progressBar)
 *
 * @returns {{done:number,total:number,pct:number,completed:boolean}}
 */
export function renderProgress(state, els){
  const items = state?.data?.items || [];
  const done  = items.filter(i => i.done).length;
  const total = items.length;
  const pct   = total ? Math.round((done / total) * 100) : 0;

  if (els?.progressText) els.progressText.textContent = `${done}/${total}`;
  if (els?.progressPct)  els.progressPct.textContent  = `${pct}%`;
  if (els?.progressFill) els.progressFill.style.width = `${pct}%`;

  // aria progress
  const bar = els?.progressBarEl || document.querySelector('.progressBar');
  if (bar) bar.setAttribute('aria-valuenow', String(pct));

  const completed = total > 0 && done === total;
  return { done, total, pct, completed };
}

/* =========================
   INTERNALS
========================= */

function filteredItems(state){
  const items = state?.data?.items || [];
  const active = state?.activeCat || 'all';
  if (active === 'all') return items;
  return items.filter(i => i.cat === active);
}

function tabBtn(id, name, emoji, active){
  return `<button class="tab ${active ? 'active':''}" data-cat="${esc(id)}">${esc(emoji)} ${esc(name)}</button>`;
}

function rowHTML(state, it, idx=0){
  const cats = state?.data?.cats || [];
  const cat = cats.find(c => c.id === it.cat);
  const catName = cat?.name || 'Otros';
  const catEmoji = cat?.emoji || '🏷️';

  // Stagger only if motion ON
  const motion = !!state?.settings?.motion;
  const delay = motion ? Math.min(idx * 35, 280) : 0;

  return `
    <div class="item ${it.done ? 'done':''}" data-id="${esc(it.id)}" style="animation-delay:${delay}ms">
      <div class="pop"></div>

      <div class="itemLeft">
        <div class="bubble">${esc(it.emoji || catEmoji || '✨')}</div>
        <div class="itemText">
          <div class="itemName">${esc(it.name)}</div>
          <div class="itemMeta">${esc(catEmoji)} ${esc(catName)}</div>
        </div>
      </div>

      <div style="display:flex; align-items:center; gap:10px;">
        <button class="btn ghost" type="button" data-action="del" aria-label="Eliminar" title="Eliminar">🗑️</button>
        <div class="check" aria-hidden="true"><div class="knob"></div></div>
      </div>
    </div>
  `;
}

function emptyHTML(){
  return `
    <div class="item">
      <div class="itemLeft">
        <div class="bubble">🫥</div>
        <div class="itemText">
          <div class="itemName">No hay items aquí.</div>
          <div class="itemMeta">Cambia de categoría o agrega algo.</div>
        </div>
      </div>
      <div class="check" aria-hidden="true"><div class="knob"></div></div>
    </div>
  `;
}

function esc(s){
  return String(s ?? '').replace(/[&<>"']/g, m => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[m]));
}
