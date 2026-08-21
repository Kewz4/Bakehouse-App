/**
 * Pruebas del endpoint /api/data con un Blob Store simulado en memoria.
 *   node --test test/api-data.test.js
 *
 * Aquí se comprueba lo que de verdad importa para la usuaria: que dos
 * dispositivos escribiendo sin saber el uno del otro no se borren el trabajo.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const STUB = path.join(ROOT, 'node_modules', '@vercel', 'blob');
const FAKE_URL = 'https://blob.test.local/datos/olivo-liora.json';

// --- Blob Store falso -------------------------------------------------------
// El handler hace `import('@vercel/blob')`, así que el stub tiene que existir
// como paquete real en node_modules. Se crea aquí y se borra al terminar.
const store = { payload: null };
globalThis.__OLIVO_STORE__ = store;

function installStub() {
  fs.mkdirSync(STUB, { recursive: true });
  fs.writeFileSync(path.join(STUB, 'package.json'),
    JSON.stringify({ name: '@vercel/blob', version: '0.0.0-test', type: 'module', main: 'index.js' }));
  fs.writeFileSync(path.join(STUB, 'index.js'), `
const store = globalThis.__OLIVO_STORE__;
export async function list() {
  return { blobs: store.payload === null ? [] : [{ url: ${JSON.stringify(FAKE_URL)} }] };
}
export async function put(pathname, payload) {
  store.payload = String(payload);
  return { url: ${JSON.stringify(FAKE_URL)} };
}
`);
}

function removeStub() {
  fs.rmSync(path.join(ROOT, 'node_modules', '@vercel'), { recursive: true, force: true });
}

// El handler lee el blob con fetch(url + '?t=...'): lo servimos desde memoria.
const realFetch = globalThis.fetch;
globalThis.fetch = async function (url, opts) {
  if (String(url).startsWith(FAKE_URL)) {
    if (store.payload === null) return { ok: false, status: 404, json: async () => ({}) };
    const body = store.payload;
    return { ok: true, status: 200, json: async () => JSON.parse(body) };
  }
  return realFetch(url, opts);
};

installStub();
process.env.BLOB_READ_WRITE_TOKEN = 'test-token';
const handler = require('../api/data.js');
const Sync = require('../sync-core.js');

test.after(removeStub);

// --- utilidades -------------------------------------------------------------
function call(method, body) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      status(c) { this.statusCode = c; return this; },
      json(payload) { resolve({ status: this.statusCode, body: payload, headers: this.headers }); return this; },
      end() { resolve({ status: this.statusCode, body: null, headers: this.headers }); return this; }
    };
    handler({ method, body }, res);
  });
}

const doc = (key, list) => Object.assign(Sync.emptyDoc(), { [key]: list });
// Las marcas de tiempo tienen que ser realistas: las lápidas se limpian a los
// 120 días, así que usar números pequeños (1000, 2000) las haría parecer de
// 1970 y se borrarían dentro de la propia prueba.
const BASE = Date.now() - 60 * 60 * 1000;
const at = ms => BASE + ms;
const rec = (id, updatedAt, extra) => Object.assign({ id, updatedAt: at(updatedAt), deleted: false }, extra || {});
const grave = (id, ms) => Sync.tombstone(id, at(ms));
const ids = (d, key) => Sync.live(d, key).map(r => r.id).sort();

test.beforeEach(() => { store.payload = null; });

test('GET sobre un almacén vacío devuelve un documento vacío, no un error', async () => {
  const r = await call('GET');
  assert.equal(r.status, 200);
  assert.equal(r.body.enabled, true);
  assert.deepEqual(r.body.doc.sales, []);
});

test('PUT guarda y GET devuelve lo guardado', async () => {
  await call('PUT', doc('sales', [rec('s1', 1000, { product: 'Brownie', total: 12 })]));
  const r = await call('GET');
  assert.deepEqual(ids(r.body.doc, 'sales'), ['s1']);
  assert.equal(r.body.doc.sales[0].product, 'Brownie');
});

test('DOS DISPOSITIVOS: el segundo en escribir no borra lo del primero', async () => {
  // Este es exactamente el bug que tenía la versión anterior: el PUT
  // sobrescribía el documento entero y ganaba el último en llegar.
  const laptop = doc('sales', [rec('laptop-1', 1000, { product: 'Flan' })]);
  const phone = doc('sales', [rec('phone-1', 1001, { product: 'Cheesecake' })]);

  await call('PUT', laptop);
  await call('PUT', phone);

  const r = await call('GET');
  assert.deepEqual(ids(r.body.doc, 'sales'), ['laptop-1', 'phone-1'],
    'las ventas de los dos dispositivos deben sobrevivir');
});

test('el PUT devuelve el documento ya combinado, sin necesidad de otro GET', async () => {
  await call('PUT', doc('expenses', [rec('e-laptop', 1000, { name: 'Gas' })]));
  const r = await call('PUT', doc('expenses', [rec('e-phone', 1001, { name: 'Cajas' })]));
  assert.equal(r.body.ok, true);
  assert.deepEqual(ids(r.body.doc, 'expenses'), ['e-laptop', 'e-phone'],
    'el teléfono recibe el gasto de la laptop en el mismo viaje');
});

test('editar el mismo registro en los dos: gana el más reciente', async () => {
  await call('PUT', doc('recipes', [rec('r1', 1000, { name: 'Brownie', price: 3 })]));
  await call('PUT', doc('recipes', [rec('r1', 2000, { name: 'Brownie', price: 4 })]));
  const r = await call('GET');
  assert.equal(r.body.doc.recipes.length, 1);
  assert.equal(r.body.doc.recipes[0].price, 4);
});

test('un borrado se propaga y no revive', async () => {
  await call('PUT', doc('expenses', [rec('e1', 1000, { name: 'Gas' })]));
  // El teléfono borra.
  await call('PUT', doc('expenses', [grave('e1', 2000)]));
  // La laptop, desactualizada, vuelve a subir su copia vieja.
  const r = await call('PUT', doc('expenses', [rec('e1', 1000, { name: 'Gas' })]));
  assert.deepEqual(ids(r.body.doc, 'expenses'), [], 'el gasto borrado no debe reaparecer');
});

test('escritura sin conexión: subir tarde no pierde nada', async () => {
  // La laptop trabaja normal durante el día.
  await call('PUT', doc('sales', [rec('dia-1', 1000), rec('dia-2', 2000)]));
  // El teléfono estuvo sin señal desde la mañana y sube al final del día un
  // documento que no incluye lo que la laptop hizo mientras tanto.
  const r = await call('PUT', doc('sales', [rec('mercado-1', 1500), rec('mercado-2', 1600)]));
  assert.deepEqual(ids(r.body.doc, 'sales'), ['dia-1', 'dia-2', 'mercado-1', 'mercado-2']);
});

test('sin BLOB_READ_WRITE_TOKEN responde enabled:false y no rompe', async () => {
  const saved = process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  try {
    const r = await call('GET');
    assert.equal(r.status, 200, 'no debe ser un error: la app sigue guardando en el dispositivo');
    assert.equal(r.body.enabled, false);
  } finally {
    process.env.BLOB_READ_WRITE_TOKEN = saved;
  }
});

test('un cuerpo inválido se rechaza sin tocar lo guardado', async () => {
  await call('PUT', doc('sales', [rec('s1', 1000)]));
  const r = await call('PUT', null);
  assert.equal(r.status, 400);
  const after = await call('GET');
  assert.deepEqual(ids(after.body.doc, 'sales'), ['s1'], 'lo guardado sigue intacto');
});

test('método no soportado devuelve 405', async () => {
  const r = await call('DELETE');
  assert.equal(r.status, 405);
});

test('veinte escrituras alternadas de dos dispositivos: no se pierde ninguna', async () => {
  const esperados = [];
  for (let i = 0; i < 10; i++) {
    const a = 'laptop-' + i, b = 'phone-' + i;
    esperados.push(a, b);
    await call('PUT', doc('sales', [rec(a, 1000 + i * 2)]));
    await call('PUT', doc('sales', [rec(b, 1001 + i * 2)]));
  }
  const r = await call('GET');
  assert.deepEqual(ids(r.body.doc, 'sales'), esperados.sort());
});

test('una lápida más vieja que 120 días se limpia (y el registro puede volver)', async () => {
  // Comportamiento intencional: las lápidas no se guardan para siempre o el
  // documento crecería sin límite. El precio es que un dispositivo apagado más
  // de 120 días puede resucitar algo que se borró. Queda documentado aquí.
  const viejaMs = Date.now() - Sync.TOMBSTONE_TTL_MS - 24 * 60 * 60 * 1000;
  await call('PUT', doc('expenses', [Sync.tombstone('antiguo', viejaMs)]));
  const r = await call('GET');
  assert.equal(r.body.doc.expenses.length, 0, 'la lápida antigua ya no ocupa espacio');
});
