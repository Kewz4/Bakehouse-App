/**
 * Pruebas del núcleo de sincronización.
 *   node --test test/
 *
 * Lo que se comprueba no es "el código corre", sino las tres propiedades de
 * las que depende que la laptop y el teléfono terminen viendo lo mismo:
 * conmutatividad, asociatividad e idempotencia. Si alguna se rompe, dos
 * dispositivos pueden quedar en desacuerdo para siempre.
 */
const test = require('node:test');
const assert = require('node:assert');
const Sync = require('../sync-core.js');

const rec = (id, updatedAt, extra) => Object.assign({ id, updatedAt, deleted: false }, extra || {});
const docWith = (key, list) => Object.assign(Sync.emptyDoc(), { [key]: list });
const ids = (doc, key) => Sync.live(doc, key).map(r => r.id).sort();

test('gana el registro con updatedAt mayor', () => {
  const a = docWith('sales', [rec('s1', 100, { total: 10 })]);
  const b = docWith('sales', [rec('s1', 200, { total: 99 })]);
  assert.equal(Sync.mergeDocs(a, b).sales[0].total, 99);
  assert.equal(Sync.mergeDocs(b, a).sales[0].total, 99);
});

test('combinar es conmutativo: da igual quién sincroniza primero', () => {
  const a = docWith('sales', [rec('s1', 100, { total: 10 }), rec('s2', 300, { total: 5 })]);
  const b = docWith('sales', [rec('s1', 200, { total: 99 }), rec('s3', 150, { total: 7 })]);
  assert.equal(
    Sync.canonical(Sync.mergeDocs(a, b)),
    Sync.canonical(Sync.mergeDocs(b, a))
  );
});

test('combinar es asociativo: da igual el orden de tres dispositivos', () => {
  const a = docWith('expenses', [rec('e1', 100, { amount: 1 })]);
  const b = docWith('expenses', [rec('e1', 200, { amount: 2 }), rec('e2', 50, { amount: 9 })]);
  const c = docWith('expenses', [rec('e1', 150, { amount: 3 }), rec('e3', 400, { amount: 4 })]);
  assert.equal(
    Sync.canonical(Sync.mergeDocs(Sync.mergeDocs(a, b), c)),
    Sync.canonical(Sync.mergeDocs(a, Sync.mergeDocs(b, c)))
  );
});

test('combinar es idempotente: sincronizar dos veces no cambia nada', () => {
  const a = docWith('recipes', [rec('r1', 100, { name: 'Brownie' })]);
  const b = docWith('recipes', [rec('r1', 200, { name: 'Brownie de nuez' })]);
  const once = Sync.mergeDocs(a, b);
  assert.equal(Sync.canonical(Sync.mergeDocs(once, b)), Sync.canonical(once));
  assert.equal(Sync.canonical(Sync.mergeDocs(once, once)), Sync.canonical(once));
});

test('un empate exacto se resuelve igual en ambos lados', () => {
  const a = docWith('sales', [rec('s1', 500, { total: 10 })]);
  const b = docWith('sales', [rec('s1', 500, { total: 20 })]);
  assert.equal(
    Sync.canonical(Sync.mergeDocs(a, b)),
    Sync.canonical(Sync.mergeDocs(b, a))
  );
});

test('un borrado en el teléfono no revive desde la laptop', () => {
  const laptop = docWith('expenses', [rec('e1', 100, { name: 'Gas' })]);
  const phone = docWith('expenses', [Sync.tombstone('e1', 200)]);
  assert.deepEqual(ids(Sync.mergeDocs(laptop, phone), 'expenses'), []);
  assert.deepEqual(ids(Sync.mergeDocs(phone, laptop), 'expenses'), []);
});

test('una edición posterior a un borrado resucita el registro a propósito', () => {
  const deleted = docWith('expenses', [Sync.tombstone('e1', 100)]);
  const edited = docWith('expenses', [rec('e1', 300, { name: 'Gas para horno' })]);
  const out = Sync.mergeDocs(deleted, edited);
  assert.deepEqual(ids(out, 'expenses'), ['e1']);
  assert.equal(out.expenses[0].name, 'Gas para horno');
});

test('edición sin conexión en el teléfono + edición en la laptop: se conservan las dos', () => {
  // Escenario real: ella anota una venta en el teléfono en el mercado (sin
  // señal) y un gasto en la laptop en la casa. Al volver el internet deben
  // quedar las dos cosas, no una.
  const base = docWith('sales', [rec('s0', 50, { product: 'Cheesecake' })]);

  const phone = Sync.mergeDocs(base, docWith('sales', [rec('s-phone', 900, { product: 'Brownies' })]));
  const laptop = Sync.mergeDocs(base, docWith('sales', [rec('s-laptop', 800, { product: 'Flan' })]));

  const final = Sync.mergeDocs(phone, laptop);
  assert.deepEqual(ids(final, 'sales'), ['s-laptop', 's-phone', 's0']);
});

test('registros viejos sin updatedAt pierden ante cualquier edición nueva', () => {
  const viejo = docWith('recipes', [{ id: 'r1', name: 'Sin fecha' }]);
  const nuevo = docWith('recipes', [rec('r1', 10, { name: 'Con fecha' })]);
  assert.equal(Sync.mergeDocs(viejo, nuevo).recipes[0].name, 'Con fecha');
});

test('normalizar tolera basura sin explotar', () => {
  assert.deepEqual(Sync.normalizeDoc(null).sales, []);
  assert.deepEqual(Sync.normalizeDoc({ sales: 'no soy una lista' }).sales, []);
  assert.deepEqual(Sync.normalizeDoc({ sales: [null, 5, 'x'] }).sales, []);
});

test('ids duplicados dentro de una misma lista se colapsan', () => {
  const doc = Sync.normalizeDoc({ sales: [rec('s1', 100, { total: 1 }), rec('s1', 200, { total: 2 })] });
  assert.equal(doc.sales.length, 1);
  assert.equal(doc.sales[0].total, 2);
});

test('contains detecta que el servidor todavía no tiene mis cambios', () => {
  const mine = docWith('sales', [rec('s1', 500)]);
  assert.equal(Sync.contains(docWith('sales', [rec('s1', 500)]), mine), true);
  assert.equal(Sync.contains(docWith('sales', [rec('s1', 900)]), mine), true);
  assert.equal(Sync.contains(docWith('sales', [rec('s1', 100)]), mine), false);
  assert.equal(Sync.contains(Sync.emptyDoc(), mine), false);
});

test('las lápidas viejas se limpian y las recientes se conservan', () => {
  const now = Date.now();
  const doc = docWith('sales', [
    Sync.tombstone('viejo', now - Sync.TOMBSTONE_TTL_MS - 1000),
    Sync.tombstone('reciente', now - 1000)
  ]);
  Sync.purgeTombstones(doc, now);
  assert.deepEqual(doc.sales.map(r => r.id), ['reciente']);
});

test('convergencia con tres dispositivos y órdenes de sincronización distintos', () => {
  const A = docWith('sales', [rec('a', 100), rec('shared', 500, { v: 'A' })]);
  const B = docWith('sales', [rec('b', 200), rec('shared', 700, { v: 'B' })]);
  const C = docWith('sales', [rec('c', 300), rec('shared', 600, { v: 'C' })]);

  const orders = [
    Sync.mergeDocs(Sync.mergeDocs(A, B), C),
    Sync.mergeDocs(Sync.mergeDocs(C, A), B),
    Sync.mergeDocs(Sync.mergeDocs(B, C), A),
    Sync.mergeDocs(A, Sync.mergeDocs(B, C))
  ].map(Sync.canonical);

  assert.equal(new Set(orders).size, 1, 'todos los órdenes deben dar el mismo resultado');
  const out = Sync.mergeDocs(Sync.mergeDocs(A, B), C);
  assert.equal(Sync.live(out, 'sales').find(r => r.id === 'shared').v, 'B');
});
