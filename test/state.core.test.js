/* =============================================================================
   Tests de la lógica que decide qué datos sobreviven.

   Correr con:  node --test
============================================================================= */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  defaultState,
  extractFlatStatePayload,
  mergeStates,
  sanitizeState,
  summarizeState,
  truncateChars
} from '../src/state.core.js';

/* ────────────────────────────────────────────────────────────────────────────
   Forma base
──────────────────────────────────────────────────────────────────────────── */
test('defaultState arranca con una lista y sin ítems', () => {
  const s = defaultState();
  assert.equal(s.lists.length, 1);
  assert.equal(s.items.length, 0);
  assert.equal(s.activeListId, s.lists[0].id);
});

test('dos defaultState no comparten id', () => {
  assert.notEqual(defaultState().lists[0].id, defaultState().lists[0].id);
});

/* ────────────────────────────────────────────────────────────────────────────
   sanitizeState: lo que entra sucio no debe romper ni borrar de más
──────────────────────────────────────────────────────────────────────────── */
test('acepta el formato plano y conserva todo', () => {
  const input = {
    lists: [{ id: 'l1', name: 'Hogar', icon: '🏠' }],
    items: [{ id: 'i1', listId: 'l1', text: 'Cascos', emoji: '🪖', done: false }],
    activeListId: 'l1'
  };
  const { ok, state, report } = sanitizeState(input);

  assert.equal(ok, true);
  assert.equal(state.items.length, 1);
  assert.equal(report.itemsDropped, 0);
  assert.equal(state.items[0].text, 'Cascos');
});

test('desenvuelve el formato con envoltorio { data: ... }', () => {
  const envelope = {
    backupVersion: 1,
    data: {
      lists: [{ id: 'l1', name: 'Musicala', icon: '🎵' }],
      items: [{ id: 'i1', listId: 'l1', text: 'Computadores' }],
      activeListId: 'l1'
    }
  };
  const { state } = sanitizeState(envelope);
  assert.equal(state.lists[0].name, 'Musicala');
  assert.equal(state.items.length, 1);
});

test('descarta ítems que apuntan a una lista inexistente', () => {
  const input = {
    lists: [{ id: 'l1', name: 'Hogar', icon: '🏠' }],
    items: [
      { id: 'i1', listId: 'l1', text: 'Válido' },
      { id: 'i2', listId: 'FANTASMA', text: 'Huérfano' }
    ],
    activeListId: 'l1'
  };
  const { state, report } = sanitizeState(input);

  assert.equal(state.items.length, 1);
  assert.equal(report.itemsDropped, 1);
  assert.equal(report.repaired, true);
});

test('descarta ítems sin texto pero conserva los demás', () => {
  const input = {
    lists: [{ id: 'l1', name: 'Hogar', icon: '🏠' }],
    items: [
      { id: 'i1', listId: 'l1', text: '   ' },
      { id: 'i2', listId: 'l1', text: 'Botas de moto' }
    ],
    activeListId: 'l1'
  };
  const { state, report } = sanitizeState(input);
  assert.equal(state.items.length, 1);
  assert.equal(state.items[0].text, 'Botas de moto');
  assert.equal(report.itemsDropped, 1);
});

test('reasigna ids duplicados en vez de perder el ítem', () => {
  const input = {
    lists: [{ id: 'l1', name: 'Hogar', icon: '🏠' }],
    items: [
      { id: 'MISMO', listId: 'l1', text: 'Uno' },
      { id: 'MISMO', listId: 'l1', text: 'Dos' }
    ],
    activeListId: 'l1'
  };
  const { state } = sanitizeState(input);

  assert.equal(state.items.length, 2, 'ninguno se pierde');
  assert.notEqual(state.items[0].id, state.items[1].id, 'los ids quedan únicos');
});

test('un activeListId inválido cae a la primera lista, no rompe', () => {
  const input = {
    lists: [{ id: 'l1', name: 'Hogar', icon: '🏠' }],
    items: [],
    activeListId: 'NO_EXISTE'
  };
  const { state } = sanitizeState(input);
  assert.equal(state.activeListId, 'l1');
});

test('entrada irreconocible devuelve ok:false y NO inventa datos', () => {
  for (const basura of [null, undefined, 42, 'texto', [], { cualquier: 'cosa' }]) {
    const { ok, state } = sanitizeState(basura);
    assert.equal(ok, false, `debería rechazar: ${JSON.stringify(basura)}`);
    assert.equal(state.items.length, 0);
    assert.equal(state.lists.length, 1);
  }
});

test('sin listas válidas se crea una, y los ítems huérfanos no se cuelan', () => {
  const input = { lists: [{ name: '' }], items: [{ listId: 'x', text: 'Suelto' }] };
  const { state } = sanitizeState(input);
  assert.equal(state.lists.length, 1);
  assert.equal(state.items.length, 0);
});

test('respeta los límites de longitud sin cortar emoji a la mitad', () => {
  const largo = 'a'.repeat(200);
  const input = {
    lists: [{ id: 'l1', name: largo, icon: '🏠🏠🏠🏠🏠🏠🏠🏠🏠🏠' }],
    items: [{ id: 'i1', listId: 'l1', text: largo, emoji: '🪖' }],
    activeListId: 'l1'
  };
  const { state } = sanitizeState(input);

  assert.equal(Array.from(state.lists[0].name).length, 40);
  assert.equal(Array.from(state.items[0].text).length, 80);
  assert.ok(Array.from(state.lists[0].icon).length <= 8);
  assert.equal(state.items[0].emoji, '🪖', 'el emoji sobrevive entero');
});

test('done se normaliza a booleano real', () => {
  const input = {
    lists: [{ id: 'l1', name: 'L', icon: '🧾' }],
    items: [
      { id: 'a', listId: 'l1', text: 'A', done: 'true' },
      { id: 'b', listId: 'l1', text: 'B', done: 1 },
      { id: 'c', listId: 'l1', text: 'C', done: 'no' },
      { id: 'd', listId: 'l1', text: 'D' }
    ],
    activeListId: 'l1'
  };
  const { state } = sanitizeState(input);
  assert.deepEqual(state.items.map(i => i.done), [true, true, false, false]);
});

test('sanitizeState no muta la entrada', () => {
  const input = {
    lists: [{ id: 'l1', name: 'Hogar', icon: '🏠' }],
    items: [{ id: 'i1', listId: 'l1', text: 'Cascos' }],
    activeListId: 'l1'
  };
  const copia = JSON.parse(JSON.stringify(input));
  sanitizeState(input);
  assert.deepEqual(input, copia);
});

/* ────────────────────────────────────────────────────────────────────────────
   extractFlatStatePayload
──────────────────────────────────────────────────────────────────────────── */
test('convierte el formato agrupado por lista a plano', () => {
  const input = {
    lists: [{ id: 'l1', name: 'Hogar', icon: '🏠' }],
    itemsByListId: { l1: [{ id: 'i1', text: 'Cascos' }] },
    currentListId: 'l1'
  };
  const out = extractFlatStatePayload(input);

  assert.equal(out.items.length, 1);
  assert.equal(out.items[0].listId, 'l1', 'hereda el listId de la clave');
  assert.equal(out.activeListId, 'l1');
});

/* ────────────────────────────────────────────────────────────────────────────
   mergeStates: el caso de Alek y Cata editando a la vez
──────────────────────────────────────────────────────────────────────────── */
test('la fusión no pierde ítems de ninguno de los dos', () => {
  const base = {
    lists: [{ id: 'l1', name: 'Hogar', icon: '🏠' }],
    items: [{ id: 'i1', listId: 'l1', text: 'Cascos' }],
    activeListId: 'l1'
  };
  const otro = {
    lists: [{ id: 'l1', name: 'Hogar', icon: '🏠' }],
    items: [{ id: 'i2', listId: 'l1', text: 'Impermeables' }],
    activeListId: 'l1'
  };
  const merged = mergeStates(base, otro);

  assert.equal(summarizeState(merged).items, 2);
  const textos = merged.items.map(i => i.text).sort();
  assert.deepEqual(textos, ['Cascos', 'Impermeables']);
});

test('marcar hecho gana sobre no hecho al fusionar', () => {
  const a = {
    lists: [{ id: 'l1', name: 'L', icon: '🧾' }],
    items: [{ id: 'i1', listId: 'l1', text: 'Cascos', done: false }],
    activeListId: 'l1'
  };
  const b = {
    lists: [{ id: 'l1', name: 'L', icon: '🧾' }],
    items: [{ id: 'i1', listId: 'l1', text: 'Cascos', done: true }],
    activeListId: 'l1'
  };
  assert.equal(mergeStates(a, b).items[0].done, true);
  assert.equal(mergeStates(b, a).items[0].done, true, 'el orden no importa');
});

test('no duplica un ítem igual aunque venga con otro id', () => {
  const a = {
    lists: [{ id: 'l1', name: 'L', icon: '🧾' }],
    items: [{ id: 'i1', listId: 'l1', text: 'Cascos', emoji: '🪖' }],
    activeListId: 'l1'
  };
  const b = {
    lists: [{ id: 'l1', name: 'L', icon: '🧾' }],
    items: [{ id: 'OTRO_ID', listId: 'l1', text: 'cascos', emoji: '🪖' }],
    activeListId: 'l1'
  };
  assert.equal(mergeStates(a, b).items.length, 1, 'detecta el duplicado por huella');
});

test('la fusión suma listas nuevas', () => {
  const a = {
    lists: [{ id: 'l1', name: 'Hogar', icon: '🏠' }],
    items: [],
    activeListId: 'l1'
  };
  const b = {
    lists: [{ id: 'l2', name: 'Saskia', icon: '🐾' }],
    items: [{ id: 'i1', listId: 'l2', text: 'Comida' }],
    activeListId: 'l2'
  };
  const merged = mergeStates(a, b);

  assert.equal(merged.lists.length, 2);
  assert.equal(merged.items.length, 1);
});

/* ────────────────────────────────────────────────────────────────────────────
   Regresión del incidente
──────────────────────────────────────────────────────────────────────────── */
test('REGRESIÓN: fusionar con un estado vacío nunca borra lo que había', () => {
  const conDatos = {
    lists: [{ id: 'l1', name: 'Hogar', icon: '🏠' }],
    items: [
      { id: 'i1', listId: 'l1', text: 'Cascos' },
      { id: 'i2', listId: 'l1', text: 'Documentos' }
    ],
    activeListId: 'l1'
  };

  const merged = mergeStates(conDatos, defaultState());
  assert.equal(summarizeState(merged).items, 2, 'los ítems siguen ahí');
});

test('truncateChars corta por caracteres visibles, no por bytes', () => {
  assert.equal(truncateChars('🏠🏠🏠', 2), '🏠🏠');
  assert.equal(truncateChars('hola', 10), 'hola');
  assert.equal(truncateChars(null, 5), '');
});
