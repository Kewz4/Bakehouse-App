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

test('"Te sale a" sube de unidad sin cambiarte de sistema de medida', async () => {
  const d = await device();
  try {
    await d.page.evaluate(() => {
      data.ingredients.push(sello({ id: 'h2', name: 'Harina', unit: 'Bolsa',
        quantity: 459, price: 1.25, unitSingle: 'g' }));
      save(); go('inventory');
    });
    await d.page.waitForSelector('#ingredientRows tr', { timeout: 10000 });
    const celda = await d.page.textContent('#ingredientRows tr td.amount');

    // $0.0027 el gramo se ve como $0.00, así que hay que subir de unidad. Ese
    // era el fallo original.
    assert.ok(!/\$0\.00/.test(celda), 'no debe mostrar $0.00: ' + celda);
    // Pero se sube dentro de SU sistema: quien compra en gramos quiere kilos,
    // no onzas ni libras. Era la segunda queja de él, y la primera versión de
    // esta prueba fijaba justo el comportamiento que le molestaba.
    assert.ok(/kg/.test(celda), 'debería salir por kilos: ' + celda);
    assert.ok(!/(lb|oz)/.test(celda), 'no debería cambiar a libras ni onzas: ' + celda);
    assert.ok(/2\.7[0-9]/.test(celda), 'debería salir alrededor de $2.72 por kg: ' + celda);
  } finally { await d.close(); }
});

test('lo que se compra por piezas dice también el precio por peso', async () => {
  const d = await device();
  try {
    await d.page.evaluate(() => {
      // Su ejemplo: una caja de 7 barras de mantequilla por $7.
      data.ingredients.push(sello({ id: 'mant', name: 'Mantequilla', unit: 'Caja',
        quantity: 7, price: 7, unitSingle: 'u', unitWeight: 113, unitWeightUnit: 'g' }));
      save(); go('inventory');
    });
    await d.page.waitForSelector('#ingredientRows tr', { timeout: 10000 });
    const celda = await d.page.textContent('#ingredientRows tr td.amount');

    assert.ok(/\$1\.00/.test(celda), 'la barra tiene que salir a $1.00: ' + celda);
    assert.ok(/kg|g\b/.test(celda), 'y además el precio por peso: ' + celda);
    assert.deepEqual(d.errors, []);
  } finally { await d.close(); }
});

test('una receta puede pedir gramos de algo que se compra por barras', async () => {
  const d = await device();
  try {
    const total = await d.page.evaluate(() => {
      const mant = { id: 'mant', name: 'Mantequilla', unit: 'Caja', quantity: 7,
                     price: 7, unitSingle: 'u', unitWeight: 113, unitWeightUnit: 'g' };
      // 200 g de una barra de 113 g son 1.77 barras, y cada barra cuesta $1.
      return { costo: lineUnitCost(mant, 'g') * 200,
               texto: conversionInfo(mant, 'g', 200).texto };
    });
    assert.ok(Math.abs(total.costo - 200 / 113) < 1e-9,
      'el costo tiene que salir de cuánto pesa una barra: ' + total.costo);
    assert.equal(total.texto, '200 g = 1.77 u');
  } finally { await d.close(); }
});

test('la fruta cambia "sin azúcar" por "bajo en azúcar"', async () => {
  const d = await device();
  try {
    await d.page.evaluate(() => {
      const base = { calorias: 100, proteina: 1, carbohidratos: 20, azucar: 1,
                     azucarAnadida: 0, grasa: 1, grasaSaturada: 0, fibra: 1, sodioMg: 5 };
      data.ingredients.push(sello({ id: 'alm', name: 'Harina de almendra', unit: 'bolsa',
        quantity: 1, price: 8, unitSingle: 'kg', macros: base }));
      data.ingredients.push(sello({ id: 'fre', name: 'Fresas', unit: 'caja',
        quantity: 1, price: 3, unitSingle: 'kg',
        macros: Object.assign({}, base, { azucar: 4.9 }) }));
      // Sin fruta -> sin azúcar
      data.recipes.push(sello({ id: 'r1', name: 'Galleta simple', yield: 8, price: 2,
        ingredients: [{ ingredientId: 'alm', qty: 200, unit: 'g', cost: 0 }] }));
      // Con fruta -> bajo en azúcar
      data.recipes.push(sello({ id: 'r2', name: 'Tarta de fresa', yield: 8, price: 3,
        ingredients: [{ ingredientId: 'alm', qty: 150, unit: 'g', cost: 0 },
                      { ingredientId: 'fre', qty: 200, unit: 'g', cost: 0 }] }));
      save(); go('recipes');
    });
    await d.page.waitForSelector('.dbadge', { timeout: 10000 });

    const porReceta = await d.page.evaluate(() =>
      Object.fromEntries([...document.querySelectorAll('.recipe')].map(c => [
        c.querySelector('h3').textContent,
        [...c.querySelectorAll('.dbadge')].map(b => b.textContent.trim())
      ])));

    assert.ok(porReceta['Galleta simple'].some(t => /Sin azúcar/.test(t)),
      'sin fruta y sin azúcar añadida -> Sin azúcar: ' + porReceta['Galleta simple']);
    assert.ok(porReceta['Tarta de fresa'].some(t => /Bajo en azúcar/.test(t)),
      'con fruta -> Bajo en azúcar: ' + porReceta['Tarta de fresa']);
    assert.ok(!porReceta['Tarta de fresa'].some(t => /Sin azúcar/.test(t)),
      'la fructosa impide decir "sin azúcar"');
    assert.deepEqual(d.errors, []);
  } finally { await d.close(); }
});

// --- Que cada pantalla se nombre una sola vez -------------------------------
// "necesito que en todas las pantallas dejes de ser tan redundante".
// Antes cada sección decía su nombre tres veces: la pestaña, un antetítulo
// sinónimo ("Lo que compras") y el título. Esto lo fija para que no vuelva.

test('ninguna pantalla se nombra dos veces en sus encabezados', async () => {
  const d = await device();
  try {
    // La pieza que rompía la regla era `.eyebrow`: un antetítulo puesto encima
    // de cada título que siempre acababa siendo otra forma de decir lo mismo —
    // "Lo que compras" sobre "Ingredientes", "Ranking" sobre "Productos más
    // vendidos". Como ya no debe quedar ninguno, comprobarlo es directo.
    const antetitulos = await d.page.evaluate(() =>
      [...document.querySelectorAll('.eyebrow')].map(e => e.textContent));
    assert.deepEqual(antetitulos, [],
      'un antetítulo encima de un título es siempre el título dicho dos veces');

    for (const vista of ['dashboard', 'recipes', 'sales', 'expenses', 'inventory']) {
      await d.page.evaluate(v => go(v), vista);

      const encabezados = await d.page.evaluate((v) => {
        const sec = document.querySelector('#' + v);
        return {
          titulos: sec.querySelectorAll('h1').length,
          // Se miran sólo los encabezados. El texto corrido no cuenta: "Aún no
          // hay ventas aquí" dice "ventas" y es la frase correcta, no una
          // repetición. Un primer intento de esta prueba contaba todo el texto
          // de la sección y marcaba justo eso.
          textos: [...sec.querySelectorAll('h1, h2, h3')]
            .map(e => e.textContent.trim().toLowerCase())
        };
      }, vista);

      assert.equal(encabezados.titulos, 1, `${vista} debería tener un solo h1`);
      assert.equal(new Set(encabezados.textos).size, encabezados.textos.length,
        `${vista} repite un encabezado: ${encabezados.textos.join(' / ')}`);
    }

    // Y la marca no se repite dentro del panel: ya está arriba, en la cabecera.
    // Antes el saludo decía "Hola, Camila. Así va Olivo & Liora." con el logo
    // justo encima.
    await d.page.evaluate(() => go('dashboard'));
    const marca = await d.page.evaluate(() =>
      (document.querySelector('#dashboard').textContent.match(/Olivo/g) || []).length);
    assert.equal(marca, 0, 'el nombre de la app no debería repetirse dentro del panel');

    assert.deepEqual(d.errors, []);
  } finally {
    await d.close();
  }
});

test('bajo el título se lee cuántas cosas hay, no un sinónimo del título', async () => {
  const d = await device();
  try {
    await d.page.evaluate(() => {
      data.ingredients = [
        sello({ id: crypto.randomUUID(), name: 'Harina',   unit: 'bolsa', quantity: 5, price: 6.5, unitSingle: 'lb' }),
        sello({ id: crypto.randomUUID(), name: 'Azúcar',   unit: 'bolsa', quantity: 2, price: 3,   unitSingle: 'kg' }),
        sello({ id: crypto.randomUUID(), name: 'Vainilla', unit: 'frasco', quantity: 60, price: 4.2, unitSingle: 'ml' })
      ];
      render();
      go('inventory');
    });

    assert.equal(await d.page.textContent('#ingCount'), '3 guardados');

    // Con una búsqueda encima cambia a "cuántas de cuántas".
    await d.page.fill('#ingSearch', 'har');
    await d.page.waitForFunction(() =>
      document.querySelector('#ingCount').textContent === '1 de 3');

    // Y en una pantalla vacía no se escribe nada: debajo está el mensaje que
    // dice qué hacer, y un "0 ventas" encima sólo estorbaría.
    await d.page.evaluate(() => go('sales'));
    assert.equal((await d.page.textContent('#saleCount')).trim(), '');

    assert.deepEqual(d.errors, []);
  } finally {
    await d.close();
  }
});

// --- Inversión --------------------------------------------------------------
// Tres cosas distintas que antes eran una sola. Lo que se comprueba aquí es lo
// que cambiaría los números del negocio si se hiciera mal.

test('la inversión no se resta de la ganancia del mes', async () => {
  const d = await device();
  try {
    const r = await d.page.evaluate(() => {
      const hoy = new Date().toISOString().slice(0, 10);
      data.sales = [sello({ id: 'v', date: hoy, product: 'Torta', qty: 1, total: 100 })];
      data.expenses = [
        sello({ id: 'g', date: hoy, name: 'Gas', category: 'Servicios', amount: 10, tipo: 'gasto' }),
        sello({ id: 'b', date: hoy, name: 'Batidora', category: 'Maquinaria', amount: 2000, tipo: 'inversion' })
      ];
      save(); render();
      return { ganancia: document.querySelector('#mProfit').textContent,
               gastos: document.querySelector('#mExpenses').textContent };
    });
    // 100 - 10 = 90. Con la batidora dentro saldría -1910, y un mes bueno
    // parecería un desastre.
    assert.match(r.ganancia, /\$90\.00/, 'la ganancia salió ' + r.ganancia);
    assert.match(r.gastos, /\$10\.00/, 'los gastos operativos salieron ' + r.gastos);
    assert.deepEqual(d.errors, []);
  } finally { await d.close(); }
});

test('un gasto recurrente sigue contando los meses siguientes', async () => {
  const d = await device();
  try {
    const r = await d.page.evaluate(() => {
      // Anotado hace tres meses, una vez. Tiene que seguir contando hoy.
      const atras = new Date(); atras.setMonth(atras.getMonth() - 3);
      const hoy = new Date().toISOString().slice(0, 10);
      data.sales = [sello({ id: 'v', date: hoy, product: 'Torta', qty: 1, total: 100 })];
      data.expenses = [sello({ id: 'g', date: atras.toISOString().slice(0, 10),
        name: 'Internet', category: 'Servicios', amount: 30, tipo: 'recurrente', frecuencia: 'mensual' })];
      save(); render();
      return { gastos: document.querySelector('#mExpenses').textContent,
               ganancia: document.querySelector('#mProfit').textContent };
    });
    // Filtrando por su fecha habría desaparecido y la ganancia diría $100.
    assert.match(r.gastos, /\$30\.00/, 'los gastos salieron ' + r.gastos);
    assert.match(r.ganancia, /\$70\.00/, 'la ganancia salió ' + r.ganancia);
  } finally { await d.close(); }
});

test('la pantalla de Inversión separa lo invertido de lo que se gasta', async () => {
  const d = await device();
  try {
    await d.page.evaluate(() => {
      const hoy = new Date().toISOString().slice(0, 10);
      data.expenses = [
        sello({ id: 'b', date: hoy, name: 'Batidora', amount: 2000, tipo: 'inversion', category: 'Maquinaria' }),
        sello({ id: 'i', date: hoy, name: 'Internet', amount: 30, tipo: 'recurrente', frecuencia: 'mensual', category: 'Servicios' }),
        sello({ id: 'g', date: hoy, name: 'Gas', amount: 12, tipo: 'gasto', category: 'Servicios' })
      ];
      save(); render(); go('expenses');
    });
    await d.page.waitForSelector('#expenseRows tr');
    const n = await d.page.evaluate(() => ({
      total: document.querySelector('#iTotal').textContent,
      recurrente: document.querySelector('#iRecurrente').textContent,
      sueltos: document.querySelector('#iSueltos').textContent
    }));
    assert.match(n.total, /\$2,?000\.00/, 'invertido en total: ' + n.total);
    assert.match(n.recurrente, /\$30\.00/, 'recurrentes: ' + n.recurrente);
    assert.match(n.sueltos, /\$12\.00/, 'sueltos: ' + n.sueltos);
    assert.deepEqual(d.errors, []);
  } finally { await d.close(); }
});

// --- La calculadora en una ventana ------------------------------------------

test('calcular el precio abre la calculadora con el costo ya puesto', async () => {
  const d = await device();
  try {
    await d.page.evaluate(() => {
      data.ingredients = [sello({ id: 'h', name: 'Harina', unit: 'Bolsa', quantity: 1,
        price: 8, unitSingle: 'kg' })];
      data.recipes = [sello({ id: 'r', name: 'Pan', yield: 4, price: 0,
        ingredients: [{ ingredientId: 'h', qty: 500, unit: 'g', cost: 0.008 }] })];
      save(); go('recipes'); quickFromRecipe('r');
    });
    await d.page.waitForSelector('#mQuickCost');

    // 500 g x $0.008 = $4 la receta, entre 4 porciones = $1 la porción.
    assert.equal(await d.page.inputValue('#mQuickCost'), '1.00');
    // Con 65% de margen: 1 / (1 - 0.65) = $2.86
    assert.match(await d.page.textContent('#mQuickPrice'), /\$2\.86/);

    // Y el precio se puede llevar a la receta sin abrir el editor.
    await d.page.click('.modal-actions .btn:not(.alt)');
    await d.page.waitForFunction(() => !document.querySelector('#modal').classList.contains('show'));
    const precio = await d.page.evaluate(() => data.recipes[0].price);
    assert.ok(Math.abs(precio - 2.86) < 0.01, 'el precio guardado fue ' + precio);
    assert.deepEqual(d.errors, []);
  } finally { await d.close(); }
});

test('los dos modos de la calculadora dan lo que dicen', async () => {
  const d = await device();
  try {
    await d.page.evaluate(() => { go('recipes'); abrirCalculadora(10, 'Prueba', null); });
    await d.page.waitForSelector('#mQuickCost');

    // Ganar el 50% del precio: cuesta $10, se cobra $20.
    await d.page.fill('#mQuickPct', '50');
    await d.page.dispatchEvent('#mQuickPct', 'input');
    assert.match(await d.page.textContent('#mQuickPrice'), /\$20\.00/);

    // Sumarle el 50% al costo: se cobra $15. Es la confusión clásica y por eso
    // están los dos modos.
    await d.page.click('#mCalcMode button[data-mode=markup]');
    await d.page.fill('#mQuickPct', '50');
    await d.page.dispatchEvent('#mQuickPct', 'input');
    assert.match(await d.page.textContent('#mQuickPrice'), /\$15\.00/);
  } finally { await d.close(); }
});
