/**
 * El almacén, contra un Postgres de verdad.
 *
 *   DATABASE_URL=postgres://... node --test test/store.test.js
 *
 * Sin `DATABASE_URL` las pruebas se saltan solas: no queremos que `npm test`
 * falle en una máquina que no tiene base. En CI se levanta una y se pasan.
 *
 * Lo que se comprueba es lo único que de verdad importa de un almacén
 * compartido: que dos dispositivos escribiendo a la vez no se pisen, que un
 * borrado no reviva, y que guardar dos veces lo mismo no cambie nada. Si algo
 * de eso falla, ella pierde trabajo sin enterarse.
 */
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Sync = require('../sync-core.js');

const URL_BASE = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const saltar = !URL_BASE;

let Store;

/** Los registros ordenados, sin la marca de tiempo del documento. */
function registros(doc) {
  return JSON.stringify(Sync.COLLECTIONS.map(k =>
    (doc[k] || []).slice().sort((a, b) => String(a.id).localeCompare(String(b.id)))));
}

const doc = (coleccion, filas) => ({ ...Sync.emptyDoc(), [coleccion]: filas });

describe('almacén en Postgres', { skip: saltar ? 'sin DATABASE_URL' : false }, () => {

  before(async () => {
    Store = require('../store-core.js');
    // Cada corrida empieza limpia: si no, la primera prueba dependería de lo
    // que dejó la anterior y dejaría de significar nada.
    const { rows } = await Store.leerPostgres();
    void rows;
    const { Pool } = require('pg');
    const p = new Pool({ connectionString: URL_BASE, max: 1, ssl: false });
    await p.query('delete from documento').catch(() => {});
    await p.end();
  });

  after(async () => { if (Store && Store.cerrar) await Store.cerrar(); });

  test('empieza vacío y guarda lo que se le da', async () => {
    const vacio = await Store.leer();
    assert.equal(vacio.ingredients.length, 0, 'debería empezar sin nada');

    const t = Date.now();
    const guardado = await Store.combinar(
      doc('ingredients', [{ id: 'a', name: 'Harina', updatedAt: t }]), t);
    assert.equal(guardado.ingredients.length, 1);

    const releido = await Store.leer();
    assert.equal(releido.ingredients[0].name, 'Harina', 'no sobrevivió a la relectura');
  });

  test('dos dispositivos a la vez no se pisan', async () => {
    const t = Date.now();
    await Promise.all([
      Store.combinar(doc('ingredients', [{ id: 'b', name: 'Azúcar', updatedAt: t + 10 }]), t + 1),
      Store.combinar(doc('ingredients', [{ id: 'c', name: 'Sal', updatedAt: t + 10 }]), t + 2)
    ]);
    const d = await Store.leer();
    const ids = d.ingredients.map(x => x.id);
    // Éste es el fallo que da miedo: uno escribe, el otro escribe encima y el
    // primero desaparece sin que nadie vea un error.
    assert.ok(ids.includes('b'), 'se perdió lo que escribió el primero');
    assert.ok(ids.includes('c'), 'se perdió lo que escribió el segundo');
  });

  test('el registro más nuevo gana, venga de donde venga', async () => {
    const t = Date.now();
    await Store.combinar(doc('ingredients', [{ id: 'a', name: 'Harina integral', updatedAt: t + 1000 }]), t);
    await Store.combinar(doc('ingredients', [{ id: 'a', name: 'Harina vieja', updatedAt: t - 1000 }]), t);
    const d = await Store.leer();
    assert.equal(d.ingredients.find(x => x.id === 'a').name, 'Harina integral',
      'una escritura vieja pisó a una nueva');
  });

  test('un borrado no revive', async () => {
    const t = Date.now();
    await Store.combinar(doc('ingredients', [{ id: 'b', deleted: true, updatedAt: t + 5000 }]), t);
    // El otro dispositivo, que no se había enterado, vuelve a mandar el suyo.
    await Store.combinar(doc('ingredients', [{ id: 'b', name: 'Azúcar', updatedAt: t + 10 }]), t);
    const d = await Store.leer();
    const b = d.ingredients.find(x => x.id === 'b');
    assert.ok(b && b.deleted, 'lo borrado volvió a aparecer');
  });

  test('guardar dos veces lo mismo no cambia nada', async () => {
    const antes = registros(await Store.leer());
    const entrante = await Store.leer();
    await Store.combinar(entrante, Date.now());
    assert.equal(registros(await Store.leer()), antes,
      'combinar no es idempotente: repetir un envío cambia los datos');
  });

  test('la mudanza trae lo que había en el Blob, y sólo la primera vez', async () => {
    // Un Blob falso con datos dentro, como el que él tiene ahora en producción.
    const stub = path.join(__dirname, '..', 'node_modules', '@vercel', 'blob');
    const viejo = {
      ...Sync.emptyDoc(),
      ingredients: [{ id: 'v1', name: 'Lo de antes', updatedAt: Date.now() - 1000 }],
      recipes: [{ id: 'v2', name: 'Receta vieja', updatedAt: Date.now() - 1000 }]
    };
    globalThis.__OLIVO_BLOB__ = viejo;
    fs.mkdirSync(stub, { recursive: true });
    fs.writeFileSync(path.join(stub, 'package.json'), JSON.stringify(
      { name: '@vercel/blob', version: '0.0.0-test', type: 'module', main: 'index.js' }));
    fs.writeFileSync(path.join(stub, 'index.js'), `
export async function list() { return { blobs: [{ url: 'https://blob.test/x.json', uploadedAt: new Date().toISOString() }] }; }
export async function put() { return { url: 'https://blob.test/x.json' }; }
export async function del() {}
`);
    const fetchReal = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true, json: async () => globalThis.__OLIVO_BLOB__ });
    process.env.BLOB_READ_WRITE_TOKEN = 'de-mentira';

    try {
      // Base vacía + Blob con datos = se mudan solos al leer.
      const { Pool } = require('pg');
      const p = new Pool({ connectionString: URL_BASE, max: 1, ssl: false });
      await p.query('delete from documento');
      await p.end();
      await Store.cerrar();

      const d = await Store.leer();
      assert.ok(d.ingredients.some(x => x.id === 'v1'), 'no trajo los ingredientes del Blob');
      assert.ok(d.recipes.some(x => x.id === 'v2'), 'no trajo las recetas del Blob');

      // Y ahora lo que de verdad da miedo: que la mudanza se repita más tarde y
      // resucite lo que ella borró después. Se borra un registro y se vuelve a
      // leer; el Blob sigue teniéndolo, pero la fila ya no está vacía.
      const t = Date.now() + 1000;
      await Store.combinar(doc('ingredients', [{ id: 'v1', deleted: true, updatedAt: t }]), t);
      const otra = await Store.leer();
      const v1 = otra.ingredients.find(x => x.id === 'v1');
      assert.ok(v1 && v1.deleted, 'la mudanza volvió a correr y resucitó lo borrado');
    } finally {
      globalThis.fetch = fetchReal;
      delete process.env.BLOB_READ_WRITE_TOKEN;
      fs.rmSync(stub, { recursive: true, force: true });
    }
  });

  test('la marca de tiempo avanza en cada escritura', async () => {
    const antes = (await Store.leer()).updatedAt || 0;
    const t = Date.now() + 60000;
    await Store.combinar(doc('sales', [{ id: 's1', total: 5, updatedAt: t }]), t);
    const despues = (await Store.leer()).updatedAt || 0;
    // De esto depende el "nada ha cambiado" que ahorra los datos móviles: si la
    // marca no avanzara, un cambio de verdad no llegaría nunca al otro teléfono.
    assert.ok(despues > antes, 'la marca no avanzó tras una escritura');
  });
});
