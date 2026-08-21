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

test('una foto tomada sin señal se sube sola y deja de abultar el documento', async () => {
  // Una foto guardada como texto (data:image/…) pesa cientos de kB dentro del
  // documento compartido. Si se juntan varias, el documento deja de caber y la
  // sincronización se rompe. Al volver el internet tienen que convertirse en
  // direcciones normales sin que nadie haga nada.
  const phone = await device();
  try {
    await phone.page.evaluate(() => {
      const punto = 'data:image/jpeg;base64,' + 'A'.repeat(2000);
      data.recipes.push(sello({
        id: crypto.randomUUID(), name: 'Pastel sin señal',
        yield: 8, price: 3, ingredients: [], photo: punto
      }));
      save();
    });

    await phone.page.waitForFunction(
      () => data.recipes[0] && data.recipes[0].photo.startsWith('http'),
      null, { timeout: 10000 });

    const foto = await phone.page.evaluate(() => data.recipes[0].photo);
    assert.ok(foto.startsWith('https://blob.test.local/postres/'), 'la foto quedó como dirección: ' + foto);

    const doc = await phone.page.evaluate(() => JSON.stringify(toWire()));
    assert.ok(!doc.includes('data:image'), 'el documento ya no lleva la foto en texto');
    assert.deepEqual(phone.errors, []);
  } finally { await phone.close(); }
});

// --- Macros -----------------------------------------------------------------

test('los macros de un ingrediente se guardan y viajan al otro dispositivo', async () => {
  const phone = await device();
  const laptop = await device();
  try {
    await phone.page.evaluate(() => openIngredient());
    await phone.page.fill('#ingName', 'Harina');
    await phone.page.fill('#ingUnit', 'bolsa');
    await phone.page.evaluate(() => { document.querySelector('#ingQty').value = '5'; });
    await phone.page.selectOption('#ingUnitSingle', 'lb');
    await phone.page.fill('#ingPrice', '6.50');
    await phone.page.click('.macros > summary');
    await phone.page.fill('#mac_calorias', '380');
    await phone.page.fill('#mac_proteina', '11');
    await phone.page.evaluate(() => addIngredient(''));
    await esperarSync(phone.page);

    await laptop.page.evaluate(() => pull());
    await laptop.page.waitForFunction(
      () => data.ingredients.length === 1, null, { timeout: 10000 });

    const m = await laptop.page.evaluate(() => data.ingredients[0].macros);
    assert.equal(m.calorias, 380);
    assert.equal(m.proteina, 11);
    // Lo que no se escribió queda en null, no en 0.
    assert.equal(m.grasa, null);
    assert.deepEqual(phone.errors, []);
  } finally { await phone.close(); await laptop.close(); }
});

test('un ingrediente sin macros no guarda un objeto vacío', async () => {
  const d = await device();
  try {
    await d.page.evaluate(() => openIngredient());
    await d.page.fill('#ingName', 'Sal');
    await d.page.fill('#ingUnit', 'bolsa');
    await d.page.evaluate(() => { document.querySelector('#ingQty').value = '1'; });
    await d.page.fill('#ingPrice', '1');
    await d.page.evaluate(() => addIngredient(''));
    const m = await d.page.evaluate(() => data.ingredients[0].macros);
    assert.equal(m, null, 'sin datos nutricionales, macros debe ser null');
  } finally { await d.close(); }
});

test('la cámara lee una etiqueta y llena los campos sola', async () => {
  const d = await device();
  try {
    await d.page.waitForFunction(() => VISION === true, null, { timeout: 10000 });
    await d.page.evaluate(() => openIngredient());
    await d.page.click('.macros > summary');
    // Se simula la foto entregando un archivo al input, como haría la cámara.
    await d.page.setInputFiles('#macFile', {
      name: 'etiqueta.png', mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64')
    });
    await d.page.waitForFunction(
      () => document.querySelector('#mac_calorias').value === '380',
      null, { timeout: 15000 });

    assert.equal(await d.page.inputValue('#mac_proteina'), '11');
    assert.equal(await d.page.inputValue('#mac_sodioMg'), '400');
    const hint = await d.page.textContent('#scanHint');
    assert.ok(/8 datos/.test(hint), 'debe decir cuántos datos llenó: ' + hint);
    assert.deepEqual(d.errors, []);
  } finally { await d.close(); }
});

test('la receta muestra los macros por porción y avisa si faltan ingredientes', async () => {
  const d = await device();
  try {
    await d.page.evaluate(() => {
      data.ingredients.push(sello({ id: 'h', name: 'Harina', unit: 'bolsa',
        quantity: 1, price: 1, unitSingle: 'kg',
        macros: { calorias: 380, proteina: 11, azucar: 1.5, grasa: 1.2 } }));
      data.ingredients.push(sello({ id: 'x', name: 'Huevos', unit: 'caja',
        quantity: 12, price: 2, unitSingle: 'u', macros: null }));
      data.recipes.push(sello({ id: 'r', name: 'Pan', yield: 10, price: 2,
        ingredients: [{ ingredientId: 'h', qty: 500, unit: 'g', cost: 0 },
                      { ingredientId: 'x', qty: 2, unit: 'u', cost: 0 }] }));
      save();
      go('recipes');
    });
    await d.page.waitForSelector('.macro-line', { timeout: 10000 });
    const line = await d.page.textContent('.macro-line');
    // 500 g a 380 kcal/100 g = 1900 kcal, entre 10 porciones = 190
    assert.ok(/190 kcal/.test(line), 'kcal por porción: ' + line);
    assert.ok(/1 de 2 ingredientes/.test(line), 'debe avisar de la cobertura: ' + line);
  } finally { await d.close(); }
});

test('una receta completa muestra sus etiquetas de dieta y se puede filtrar', async () => {
  const d = await device();
  try {
    await d.page.evaluate(() => {
      data.ingredients.push(sello({ id: 'alm', name: 'Harina de almendra', unit: 'bolsa',
        quantity: 1, price: 8, unitSingle: 'kg',
        macros: { calorias: 579, proteina: 21, carbohidratos: 22, azucar: 4,
                  grasa: 50, grasaSaturada: 4, fibra: 12, sodioMg: 1 } }));
      data.ingredients.push(sello({ id: 'hv', name: 'Huevos', unit: 'caja',
        quantity: 12, price: 2.4, unitSingle: 'u',
        macros: { calorias: 78, proteina: 6, carbohidratos: 0.6, azucar: 0.6,
                  grasa: 5, grasaSaturada: 1.6, fibra: 0, sodioMg: 62 } }));
      // Completa: lleva etiquetas.
      data.recipes.push(sello({ id: 'keto', name: 'Pan keto', yield: 8, price: 3,
        ingredients: [{ ingredientId: 'alm', qty: 200, unit: 'g', cost: 0 },
                      { ingredientId: 'hv', qty: 3, unit: 'u', cost: 0 }] }));
      // Incompleta: NO debe llevar ninguna.
      data.recipes.push(sello({ id: 'incompleta', name: 'Pastel misterioso', yield: 4, price: 2,
        ingredients: [{ ingredientId: 'alm', qty: 100, unit: 'g', cost: 0 },
                      { ingredientId: 'nada', qty: 1, unit: 'u', cost: 0 }] }));
      save(); go('recipes');
    });
    await d.page.waitForSelector('.dbadge', { timeout: 10000 });

    const badges = await d.page.evaluate(() =>
      [...document.querySelectorAll('.recipe')].map(card => ({
        name: card.querySelector('h3').textContent,
        badges: [...card.querySelectorAll('.dbadge')].map(b => b.textContent.trim())
      })));

    const keto = badges.find(b => b.name === 'Pan keto');
    assert.ok(keto.badges.some(t => /Keto/.test(t)), 'esperaba Keto: ' + keto.badges);
    assert.ok(keto.badges.some(t => /Paleo/.test(t)), '"harina de almendra" es paleo');

    const incompleta = badges.find(b => b.name === 'Pastel misterioso');
    assert.deepEqual(incompleta.badges, [],
      'una receta con datos incompletos no debe llevar ninguna etiqueta');

    // Filtrar por Keto deja sólo la que la tiene.
    await d.page.evaluate(() => setBadgeFilter('keto'));
    await d.page.waitForFunction(
      () => document.querySelectorAll('.recipe').length === 1, null, { timeout: 10000 });
    assert.equal(await d.page.textContent('.recipe h3'), 'Pan keto');

    // Y quitar el filtro las devuelve todas.
    await d.page.evaluate(() => setBadgeFilter('keto'));
    await d.page.waitForFunction(
      () => document.querySelectorAll('.recipe').length === 2, null, { timeout: 10000 });
    assert.deepEqual(d.errors, []);
  } finally { await d.close(); }
});

test('la receta se crea con el costo primero y el precio sale del margen', async () => {
  // El orden que pidió: primero qué lleva, el costo aparece solo, y el precio
  // se calcula a partir de cuánto quiere ganar. Antes pedía el precio de venta
  // antes de que hubiera forma de saberlo.
  const d = await device();
  try {
    await d.page.evaluate(() => {
      data.ingredients.push(sello({ id: 'har', name: 'Harina', unit: 'bolsa',
        quantity: 5, price: 6.5, unitSingle: 'lb' }));
      save();
      openRecipe();
    });

    await d.page.fill('#rName', 'Pan dulce');
    await d.page.evaluate(() => { document.querySelector('#rYield').value = '10'; recipeTotals(); });

    // Elegir el ingrediente. Al hacerlo la unidad salta a como se compra (lb),
    // así que se cambia a gramos, que es como se usa en la receta.
    await d.page.selectOption('.ingredient-line [data-n=ingredientId]', 'har');
    await d.page.selectOption('.ingredient-line [data-n=unit]', 'g');
    await d.page.evaluate(() => {
      const l = document.querySelector('.ingredient-line');
      l.querySelector('[data-n=qty]').value = '500';
      lineTotal(l.querySelector('[data-n=qty]'));
    });

    // El costo aparece sin que ella escriba ningún precio.
    await d.page.waitForFunction(
      () => /\$0\.1[0-9]/.test(document.querySelector('#costPanel').textContent),
      null, { timeout: 10000 });

    // 500 g de harina a $6.50 las 5 lb = $1.4330, entre 10 porciones = $0.1433
    const costo = await d.page.evaluate(() => recipeUnitCostForm());
    assert.ok(Math.abs(costo - 0.14330) < 0.0005, 'costo por porción: ' + costo);

    // Con 65 % de margen el precio sale solo.
    const precio = await d.page.evaluate(() => recipeFinalPrice());
    assert.ok(Math.abs(precio - costo / 0.35) < 1e-9, 'precio calculado: ' + precio);

    await d.page.evaluate(() => saveRecipe(''));
    await d.page.waitForFunction(() => data.recipes.length === 1, null, { timeout: 10000 });

    const guardada = await d.page.evaluate(() => data.recipes[0]);
    assert.equal(guardada.name, 'Pan dulce');
    assert.ok(Math.abs(guardada.price - costo / 0.35) < 1e-9, 'se guardó el precio del margen');
    // Y el costo de la línea se guarda sin redondear.
    assert.ok(Math.abs(guardada.ingredients[0].cost - 6.5 / (5 * 453.592)) < 1e-12,
      'el costo por gramo no debe redondearse: ' + guardada.ingredients[0].cost);
    assert.deepEqual(d.errors, []);
  } finally { await d.close(); }
});

test('"Te sale a" usa una unidad que se pueda leer, no $0.00 por gramo', async () => {
  const d = await device();
  try {
    await d.page.evaluate(() => {
      data.ingredients.push(sello({ id: 'h2', name: 'Harina', unit: 'Bolsa',
        quantity: 459, price: 1.25, unitSingle: 'g' }));
      save(); go('inventory');
    });
    await d.page.waitForSelector('#ingredientRows tr', { timeout: 10000 });
    const celda = await d.page.textContent('#ingredientRows tr td.amount');
    assert.ok(!/\$0\.00/.test(celda), 'no debe mostrar $0.00: ' + celda);
    assert.ok(/por lb|\/ lb/.test(celda) || /1\.2[0-9]/.test(celda),
      'debería salir alrededor de $1.24 por lb: ' + celda);
  } finally { await d.close(); }
});
