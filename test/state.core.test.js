/* =============================================================================
   Tests de la lógica que decide qué datos sobreviven.

   Correr con:  node --test
============================================================================= */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  clearTombstones,
  collectStateIds,
  compareLists,
  defaultState,
  extractFlatStatePayload,
  itemKey,
  mergeStates,
  pruneTombstones,
  resolveDone,
  sanitizeState,
  summarizeState,
  TOMBSTONE_MAX,
  truncateChars,
  withDeletionTombstones
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

/* ────────────────────────────────────────────────────────────────────────────
   resolveDone: quién gana cuando el mismo ítem llega con estados distintos
──────────────────────────────────────────────────────────────────────────── */
test('resolveDone por defecto gana marcado', () => {
  assert.equal(resolveDone(true, false), true);
  assert.equal(resolveDone(false, true), true);
  assert.equal(resolveDone(false, false), false);
});

test('resolveDone con estrategia incoming respeta lo último que llega', () => {
  assert.equal(resolveDone(true, false, 'incoming'), false);
  assert.equal(resolveDone(false, true, 'incoming'), true);
});

test('resolveDone con estrategia current respeta lo local', () => {
  assert.equal(resolveDone(false, true, 'current'), false);
  assert.equal(resolveDone(true, false, 'current'), true);
});

test('mergeStates con doneStrategy incoming permite desmarcar', () => {
  const remote = {
    lists: [{ id: 'l1', name: 'Viaje', icon: '🧳' }],
    items: [{ id: 'i1', listId: 'l1', text: 'Cargador', emoji: '', done: true }],
    activeListId: 'l1'
  };
  const local = {
    lists: [{ id: 'l1', name: 'Viaje', icon: '🧳' }],
    items: [{ id: 'i1', listId: 'l1', text: 'Cargador', emoji: '', done: false }],
    activeListId: 'l1'
  };

  const conDefault = mergeStates(remote, local);
  assert.equal(conDefault.items[0].done, true, 'el default deja el marcado pegajoso');

  const conIncoming = mergeStates(remote, local, { doneStrategy: 'incoming' });
  assert.equal(conIncoming.items[0].done, false, 'la intención local debe ganar');
});

test('mergeStates conserva los marcados nuevos del lado que llega', () => {
  // Escenario del bug: se marcan tres ítems seguidos mientras el remoto
  // todavía tiene los tres sin marcar.
  const remote = {
    lists: [{ id: 'l1', name: 'Viaje', icon: '🧳' }],
    items: [
      { id: 'i1', listId: 'l1', text: 'Uno', emoji: '', done: false },
      { id: 'i2', listId: 'l1', text: 'Dos', emoji: '', done: false },
      { id: 'i3', listId: 'l1', text: 'Tres', emoji: '', done: false }
    ],
    activeListId: 'l1'
  };
  const local = deepCloneForTest(remote);
  local.items.forEach(item => { item.done = true; });

  const merged = mergeStates(remote, local, { doneStrategy: 'incoming' });
  assert.deepEqual(merged.items.map(i => i.done), [true, true, true]);
});

function deepCloneForTest(value) {
  return JSON.parse(JSON.stringify(value));
}

/* ────────────────────────────────────────────────────────────────────────────
   itemKey y compareLists
──────────────────────────────────────────────────────────────────────────── */
test('itemKey ignora mayúsculas y espacios de más', () => {
  assert.equal(
    itemKey({ text: '  Cepillo   de Dientes ', emoji: '🪥' }),
    itemKey({ text: 'cepillo de dientes', emoji: '🪥' })
  );
});

const estadoParaComparar = () => ({
  lists: [
    { id: 'la', name: 'Viaje', icon: '🧳' },
    { id: 'lb', name: 'Camping', icon: '⛺' }
  ],
  items: [
    { id: 'a1', listId: 'la', text: 'Cargador', emoji: '🔌', done: false },
    { id: 'a2', listId: 'la', text: 'Medias', emoji: '🧦', done: true },
    { id: 'a3', listId: 'la', text: 'Cepillo', emoji: '🪥', done: false },
    { id: 'b1', listId: 'lb', text: 'cargador', emoji: '🔌', done: true },
    { id: 'b2', listId: 'lb', text: 'Carpa', emoji: '⛺', done: false }
  ],
  activeListId: 'la'
});

test('compareLists dice qué le falta a cada lista', () => {
  const r = compareLists(estadoParaComparar(), 'la', 'lb');

  assert.equal(r.ok, true);
  assert.deepEqual(r.totals, { a: 3, b: 2 });
  assert.deepEqual(r.onlyInA.map(i => i.text), ['Medias', 'Cepillo']);
  assert.deepEqual(r.onlyInB.map(i => i.text), ['Carpa']);
  assert.deepEqual(r.inBoth.map(i => i.text), ['Cargador']);
});

test('compareLists compara por contenido, no por id ni por estado', () => {
  const r = compareLists(estadoParaComparar(), 'la', 'lb');
  // "Cargador" y "cargador" son el mismo ítem aunque tengan ids y done distintos.
  assert.equal(r.inBoth.length, 1);
});

test('compareLists no repite un ítem duplicado dentro de la misma lista', () => {
  const s = estadoParaComparar();
  s.items.push({ id: 'a4', listId: 'la', text: 'MEDIAS', emoji: '🧦', done: false });

  const r = compareLists(s, 'la', 'lb');
  assert.equal(r.onlyInA.filter(i => i.text.toLowerCase() === 'medias').length, 1);
});

test('compareLists se niega a comparar una lista consigo misma', () => {
  const r = compareLists(estadoParaComparar(), 'la', 'la');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'same-list');
});

test('compareLists avisa si la lista no existe', () => {
  const r = compareLists(estadoParaComparar(), 'la', 'no-existe');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'missing-list');
  assert.deepEqual(r.onlyInA, []);
});

/* ────────────────────────────────────────────────────────────────────────────
   TUMBAS: un borrado no se deshace solo
──────────────────────────────────────────────────────────────────────────── */
const estadoConDos = () => ({
  lists: [{ id: 'l1', name: 'Viaje', icon: '🧳' }],
  items: [
    { id: 'i1', listId: 'l1', text: 'Cargador', emoji: '🔌', done: false },
    { id: 'i2', listId: 'l1', text: 'Medias', emoji: '🧦', done: false }
  ],
  deleted: [],
  activeListId: 'l1'
});

test('sanitizeState siempre devuelve deleted, incluso en respaldos viejos', () => {
  const viejo = {
    lists: [{ id: 'l1', name: 'Viaje', icon: '🧳' }],
    items: [],
    activeListId: 'l1'
  };
  assert.deepEqual(sanitizeState(viejo).state.deleted, []);
  assert.deepEqual(defaultState().deleted, []);
});

test('withDeletionTombstones marca lo que desapareció', () => {
  const antes = estadoConDos();
  const despues = { ...antes, items: antes.items.filter(i => i.id !== 'i2') };

  const resultado = withDeletionTombstones(antes, despues);
  assert.deepEqual(resultado.items.map(i => i.id), ['i1']);
  assert.deepEqual(resultado.deleted.map(t => [t.kind, t.id]), [['item', 'i2']]);
});

test('borrar una lista deja tumba de la lista y no de cada ítem vivo', () => {
  const antes = {
    lists: [
      { id: 'l1', name: 'Viaje', icon: '🧳' },
      { id: 'l2', name: 'Camping', icon: '⛺' }
    ],
    items: [{ id: 'i9', listId: 'l2', text: 'Carpa', emoji: '⛺', done: false }],
    deleted: [],
    activeListId: 'l1'
  };
  const despues = { ...antes, lists: [antes.lists[0]], items: [] };

  const r = withDeletionTombstones(antes, despues);
  assert.ok(r.deleted.some(t => t.kind === 'list' && t.id === 'l2'));
  assert.ok(r.deleted.some(t => t.kind === 'item' && t.id === 'i9'));
});

test('mergeStates YA NO revive un ítem borrado (el bug que buscábamos)', () => {
  const remoto = estadoConDos();                       // la otra persona aún lo tiene
  const local = withDeletionTombstones(
    estadoConDos(),
    { ...estadoConDos(), items: [estadoConDos().items[0]] }
  );

  // Fusión en cualquiera de los dos sentidos: el borrado se respeta.
  const aOrden = mergeStates(remoto, local, { doneStrategy: 'incoming' });
  const bOrden = mergeStates(local, remoto, { doneStrategy: 'incoming' });

  assert.deepEqual(aOrden.items.map(i => i.id), ['i1'], 'no debe revivir i2');
  assert.deepEqual(bOrden.items.map(i => i.id), ['i1'], 'no debe revivir i2');
});

test('una lista borrada tampoco revive, ni arrastra sus ítems de vuelta', () => {
  const remoto = {
    lists: [
      { id: 'l1', name: 'Viaje', icon: '🧳' },
      { id: 'l2', name: 'Camping', icon: '⛺' }
    ],
    items: [{ id: 'i9', listId: 'l2', text: 'Carpa', emoji: '⛺', done: false }],
    deleted: [],
    activeListId: 'l1'
  };
  const local = withDeletionTombstones(remoto, {
    ...remoto,
    lists: [remoto.lists[0]],
    items: []
  });

  const merged = mergeStates(remoto, local);
  assert.deepEqual(merged.lists.map(l => l.id), ['l1']);
  assert.deepEqual(merged.items, []);
});

test('volver a agregar el mismo texto después de borrarlo sí funciona', () => {
  // La tumba es por id, no por texto: el ítem nuevo tiene id nuevo y vive.
  const local = withDeletionTombstones(
    estadoConDos(),
    { ...estadoConDos(), items: [estadoConDos().items[0]] }
  );

  local.items.push({ id: 'i3', listId: 'l1', text: 'Medias', emoji: '🧦', done: false });

  const limpio = sanitizeState(local).state;
  assert.deepEqual(limpio.items.map(i => i.id), ['i1', 'i3']);
});

test('importar un respaldo puede resucitar lo borrado (clearTombstones)', () => {
  const local = withDeletionTombstones(
    estadoConDos(),
    { ...estadoConDos(), items: [estadoConDos().items[0]] }
  );
  const respaldo = estadoConDos();   // el JSON todavía tiene i2

  // Sin perdonar la tumba, el respaldo llegaría y se borraría de nuevo.
  const sinPerdon = mergeStates(local, respaldo);
  assert.deepEqual(sinPerdon.items.map(i => i.id), ['i1']);

  const base = clearTombstones(local, collectStateIds(respaldo));
  const conPerdon = mergeStates(base, respaldo);
  assert.deepEqual(conPerdon.items.map(i => i.id), ['i1', 'i2'], 'el respaldo debe poder restaurar');
});

test('las tumbas se podan por edad y por cantidad', () => {
  const vieja = { id: 'x', kind: 'item', at: new Date(Date.now() - 90 * 86400000).toISOString() };
  const nueva = { id: 'y', kind: 'item', at: new Date().toISOString() };

  assert.deepEqual(pruneTombstones([vieja, nueva]).map(t => t.id), ['y']);

  const muchas = Array.from({ length: TOMBSTONE_MAX + 50 }, (_, n) => ({
    id: `id_${n}`,
    kind: 'item',
    at: new Date(Date.now() - n * 1000).toISOString()
  }));
  assert.equal(pruneTombstones(muchas).length, TOMBSTONE_MAX);
});

test('una tumba repetida no se duplica y gana la más reciente', () => {
  const antigua = { id: 'z', kind: 'item', at: '2026-01-01T00:00:00.000Z' };
  const reciente = { id: 'z', kind: 'item', at: new Date().toISOString() };

  const podadas = pruneTombstones([antigua, reciente, antigua]);
  assert.equal(podadas.length, 1);
  assert.equal(podadas[0].at, reciente.at);
});

test('una tumba sin id o con fecha basura no rompe nada', () => {
  const podadas = pruneTombstones([
    { id: '', kind: 'item', at: 'hoy' },
    { id: 'ok', kind: 'item', at: 'fecha-invalida' },
    null,
    'basura'
  ]);
  assert.deepEqual(podadas.map(t => t.id), ['ok']);
  assert.ok(!Number.isNaN(Date.parse(podadas[0].at)));
});

test('un id duplicado en el remoto no resucita un borrado', () => {
  /* Caso real encontrado probando en el navegador: si el documento remoto
     trae el mismo id dos veces, sanitizeItem le pone un id nuevo al segundo
     para que no choquen. Si las tumbas se aplicaran después, ese ítem
     renombrado se colaba con otro id y el borrado quedaba deshecho. */
  const remotoConDuplicado = {
    lists: [{ id: 'l1', name: 'Viaje', icon: '🧳' }],
    items: [
      { id: 'i1', listId: 'l1', text: 'Cargador', emoji: '🔌', done: false },
      { id: 'i2', listId: 'l1', text: 'Medias', emoji: '🧦', done: false },
      { id: 'i2', listId: 'l1', text: 'Medias', emoji: '🧦', done: false }
    ],
    deleted: [],
    activeListId: 'l1'
  };

  const local = withDeletionTombstones(estadoConDos(), {
    ...estadoConDos(),
    items: [estadoConDos().items[0]]
  });

  const merged = mergeStates(remotoConDuplicado, local, { doneStrategy: 'incoming' });
  assert.deepEqual(
    merged.items.map(i => i.text),
    ['Cargador'],
    'ninguna copia de Medias debe sobrevivir'
  );
});
