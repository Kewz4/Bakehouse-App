/**
 * La prueba que de verdad importa:
 *   "quiero que ella abra su laptop y vea lo mismo que vio en el teléfono"
 *
 * Levanta la app real en dos navegadores independientes (dos perfiles, dos
 * localStorage separados = dos dispositivos) contra un solo servidor, y
 * comprueba que los datos viajan de uno a otro sin que nadie toque nada.
 *
 *   node --test test/two-devices.test.js
 */
const test = require('node:test');
const assert = require('node:assert');
const { chromium } = require('playwright');
const { createServer } = require('./dev-server.js');
const Sync = require('../sync-core.js');

// En este contenedor Chromium ya viene instalado en /opt; en CI lo instala
// Playwright en su sitio por defecto. Si la ruta no existe, se deja que
// Playwright elija.
const fs = require('node:fs');
const EXEC = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const execPath = EXEC && fs.existsSync(EXEC) ? EXEC : undefined;

let server, browser, base;

test.before(async () => {
  server = createServer();
  await new Promise(r => server.listen(0, r));
  base = 'http://127.0.0.1:' + server.address().port + '/';
  browser = await chromium.launch({ executablePath: execPath, args: ['--no-sandbox'] });
});

// Cada prueba arranca con el almacén vacío: si no, los datos de una prueba
// se cuelan en la siguiente y los conteos dejan de significar nada.
test.beforeEach(() => { server.state.doc = Sync.emptyDoc(); });

test.after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(r => server.close(r));
});

/** Un "dispositivo": contexto aislado, con su propio almacenamiento. */
async function device() {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(base, { waitUntil: 'networkidle' });
  return { ctx, page, errors, close: () => ctx.close() };
}

/** Registra una venta usando la interfaz, como lo haría ella. */
async function registrarVenta(page, { producto, cantidad, total }) {
  await page.evaluate(() => openSale());
  await page.fill('#sProduct', producto);
  await page.fill('#sTotal', String(total));
  // El campo de cantidad usa el teclado propio de la app (sólo lectura).
  await page.evaluate((q) => { document.querySelector('#sQty').value = String(q); }, cantidad);
  await page.evaluate(() => addSale(''));
  await page.waitForFunction(() => !document.querySelector('#modal').classList.contains('show'));
}

const ventasVisibles = page => page.evaluate(() =>
  [...document.querySelectorAll('#salesRows tr')].map(tr => tr.querySelector('.main b').textContent));

const esperarSync = page => page.waitForFunction(
  () => document.querySelector('#syncStatus').textContent === 'Todo guardado',
  null, { timeout: 10000 });

test('la app arranca sin errores de JavaScript', async () => {
  const d = await device();
  try {
    assert.deepEqual(d.errors, []);
    assert.equal(await d.page.title(), 'Olivo & Liora · Control de negocio');
    // Las cinco secciones siguen existiendo: no se rompió la paridad.
    const vistas = await d.page.evaluate(() => [...document.querySelectorAll('.view')].map(v => v.id));
    assert.deepEqual(vistas, ['dashboard', 'recipes', 'sales', 'expenses', 'inventory']);
  } finally { await d.close(); }
});

test('TELÉFONO -> LAPTOP: una venta anotada en uno aparece en el otro', async () => {
  const phone = await device();
  const laptop = await device();
  try {
    await registrarVenta(phone.page, { producto: 'Cheesecake de fresa', cantidad: 2, total: 24 });
    await esperarSync(phone.page);

    // La laptop no toca nada: sólo se le devuelve el foco, como al abrir la tapa.
    await laptop.page.bringToFront();
    await laptop.page.evaluate(() => pull());
    await laptop.page.waitForFunction(
      () => [...document.querySelectorAll('#salesRows tr')].length > 0, null, { timeout: 10000 });

    assert.deepEqual(await ventasVisibles(laptop.page), ['Cheesecake de fresa']);
    assert.deepEqual(phone.errors, []);
    assert.deepEqual(laptop.errors, []);
  } finally { await phone.close(); await laptop.close(); }
});

test('los dos escriben a la vez y no se pierde ninguna venta', async () => {
  const phone = await device();
  const laptop = await device();
  try {
    await Promise.all([
      registrarVenta(phone.page, { producto: 'Brownies', cantidad: 6, total: 18 }),
      registrarVenta(laptop.page, { producto: 'Flan napolitano', cantidad: 1, total: 9 })
    ]);
    await Promise.all([esperarSync(phone.page), esperarSync(laptop.page)]);

    await phone.page.evaluate(() => pull());
    await laptop.page.evaluate(() => pull());
    await phone.page.waitForFunction(
      () => document.querySelectorAll('#salesRows tr').length === 2, null, { timeout: 10000 });
    await laptop.page.waitForFunction(
      () => document.querySelectorAll('#salesRows tr').length === 2, null, { timeout: 10000 });

    const enPhone = (await ventasVisibles(phone.page)).sort();
    const enLaptop = (await ventasVisibles(laptop.page)).sort();
    assert.deepEqual(enPhone, ['Brownies', 'Flan napolitano']);
    assert.deepEqual(enLaptop, enPhone, 'los dos dispositivos ven exactamente lo mismo');
  } finally { await phone.close(); await laptop.close(); }
});

test('SIN SEÑAL: lo anotado offline se sube solo al volver el internet', async () => {
  const phone = await device();
  const laptop = await device();
  try {
    // Se corta el internet del teléfono. Ella sigue trabajando igual.
    await phone.ctx.setOffline(true);
    await registrarVenta(phone.page, { producto: 'Tres leches', cantidad: 1, total: 15 });

    // La app no le pide nada ni la alarma: sólo dice que se guardará solo.
    await phone.page.waitForFunction(
      () => document.querySelector('#syncStatus').textContent === 'Se guardará solo',
      null, { timeout: 10000 });
    assert.deepEqual(await ventasVisibles(phone.page), ['Tres leches'],
      'sin señal la venta ya está anotada y visible');

    // Vuelve la señal. Nadie toca nada.
    await phone.ctx.setOffline(false);
    await phone.page.evaluate(() => window.dispatchEvent(new Event('online')));
    await esperarSync(phone.page);

    // Y llega a la laptop.
    await laptop.page.evaluate(() => pull());
    await laptop.page.waitForFunction(
      () => document.querySelectorAll('#salesRows tr').length === 1, null, { timeout: 10000 });
    assert.deepEqual(await ventasVisibles(laptop.page), ['Tres leches']);
  } finally { await phone.close(); await laptop.close(); }
});

test('un borrado en el teléfono también borra en la laptop', async () => {
  const phone = await device();
  const laptop = await device();
  try {
    await registrarVenta(phone.page, { producto: 'Pie de limón', cantidad: 1, total: 11 });
    await esperarSync(phone.page);
    await laptop.page.evaluate(() => pull());
    await laptop.page.waitForFunction(
      () => document.querySelectorAll('#salesRows tr').length === 1, null, { timeout: 10000 });

    // Borrar pide confirmación: la aceptamos automáticamente.
    phone.page.on('dialog', d => d.accept());
    await phone.page.evaluate(() => {
      const id = window.SyncCore.live({ sales: data.sales }, 'sales')[0].id;
      removeItem('sales', id);
    });
    await esperarSync(phone.page);

    await laptop.page.evaluate(() => pull());
    await laptop.page.waitForFunction(
      () => document.querySelectorAll('#salesRows tr').length === 0, null, { timeout: 10000 });
    assert.deepEqual(await ventasVisibles(laptop.page), [], 'el borrado viajó al otro dispositivo');
  } finally { await phone.close(); await laptop.close(); }
});

test('los datos guardados antes de la sincronización no se pierden al actualizar', async () => {
  // Migración: alguien que ya venía usando la app tiene datos bajo la clave
  // vieja. Al abrir la versión nueva tienen que seguir ahí.
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  try {
    // Esperamos a que la app termine de arrancar antes de tocar el
    // almacenamiento: si no, su primer guardado pisa lo que sembramos aquí.
    await page.goto(base, { waitUntil: 'networkidle' });
    // La fecha tiene que caer dentro del período que muestra el panel por
    // defecto ("Este mes"), o la venta existe pero queda fuera del filtro.
    const hoy = new Date().toISOString().slice(0, 10);
    await page.evaluate((fecha) => {
      localStorage.clear();
      localStorage.setItem('olivo-liora-data-v1', JSON.stringify({
        ingredients: [], recipes: [], expenses: [],
        sales: [{ id: 'viejo-1', date: fecha, product: 'Venta antigua', qty: 1, total: 20 }]
      }));
    }, hoy);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(
      () => document.querySelectorAll('#salesRows tr').length === 1, null, { timeout: 10000 });
    assert.deepEqual(await ventasVisibles(page), ['Venta antigua']);
  } finally { await ctx.close(); }
});

test('sin Blob Store la app sigue funcionando y guarda en el dispositivo', async () => {
  const solo = createServer({ enabled: false });
  await new Promise(r => solo.listen(0, r));
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  try {
    await page.goto('http://127.0.0.1:' + solo.address().port + '/', { waitUntil: 'networkidle' });
    await registrarVenta(page, { producto: 'Sin nube', cantidad: 1, total: 5 });
    assert.deepEqual(await ventasVisibles(page), ['Sin nube']);
    await page.waitForFunction(
      () => document.querySelector('#syncStatus').textContent === 'Guardado aquí',
      null, { timeout: 10000 });
    assert.deepEqual(errors, []);
  } finally {
    await ctx.close();
    await new Promise(r => solo.close(r));
  }
});
