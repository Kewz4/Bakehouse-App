/**
 * Macros: suma en recetas y lectura de etiquetas.
 *
 * La parte que importa es la aritmética. El modelo de visión sólo copia lo que
 * ve; todo lo que sigue —pasar de "por porción" a "por 100 g", convertir
 * unidades, sumar— pasa por aquí, y un error se traduce en un dato nutricional
 * equivocado que se ve igual de creíble que uno correcto.
 */
const test = require('node:test');
const assert = require('node:assert');
const B = require('../business-core.js');

const harina = {
  id: 'harina', quantity: 5, unitSingle: 'lb', price: 6.5,
  macros: { calorias: 380, proteina: 11, carbohidratos: 72, azucar: 1.5,
            grasa: 1.2, grasaSaturada: 0.2, fibra: 2.7, sodioMg: 2 }
};
const azucar = {
  id: 'azucar', quantity: 2, unitSingle: 'kg', price: 3,
  macros: { calorias: 400, proteina: 0, carbohidratos: 100, azucar: 100,
            grasa: 0, grasaSaturada: 0, fibra: 0, sodioMg: 0 }
};
const huevos = { id: 'huevos', quantity: 12, unitSingle: 'u', price: 2.4 }; // sin macros

// --- hasMacros --------------------------------------------------------------

test('un ingrediente sin macros no cuenta como que las tiene', () => {
  assert.equal(B.hasMacros(huevos), false);
  assert.equal(B.hasMacros({}), false);
  assert.equal(B.hasMacros({ macros: {} }), false);
  assert.equal(B.hasMacros({ macros: { calorias: '' } }), false);
  assert.equal(B.hasMacros(harina), true);
  // Un cero explícito SÍ es un dato: el azúcar tiene 0 g de grasa de verdad.
  assert.equal(B.hasMacros({ macros: { grasa: 0 } }), true);
});

// --- suma en recetas --------------------------------------------------------

test('suma los macros convirtiendo la unidad de cada línea', () => {
  const r = { yield: 10, ingredients: [
    { ingredientId: 'harina', qty: 500, unit: 'g' },
    { ingredientId: 'azucar', qty: 0.2, unit: 'kg' }   // 200 g
  ]};
  const m = B.recipeMacros(r, { harina, azucar });
  assert.equal(m.totals.calorias, 500 * 3.8 + 200 * 4);   // 1900 + 800
  assert.equal(m.totals.azucar, 500 * 0.015 + 200 * 1);   // 7.5 + 200
  assert.equal(m.perServing.calorias, 2700 / 10);
  assert.equal(m.completo, true);
});

test('la misma cantidad en otra unidad da el mismo resultado', () => {
  const enGramos = { yield: 1, ingredients: [{ ingredientId: 'harina', qty: 1000, unit: 'g' }] };
  const enKilos  = { yield: 1, ingredients: [{ ingredientId: 'harina', qty: 1, unit: 'kg' }] };
  const a = B.recipeMacros(enGramos, { harina });
  const b = B.recipeMacros(enKilos, { harina });
  assert.equal(a.totals.calorias, b.totals.calorias);
});

test('avisa cuando faltan ingredientes por cubrir en vez de callarlo', () => {
  // Mostrar "1900 kcal" cuando dos de tres ingredientes no tienen datos sería
  // mentir con una cifra convincente.
  const r = { yield: 8, ingredients: [
    { ingredientId: 'harina', qty: 500, unit: 'g' },
    { ingredientId: 'huevos', qty: 3, unit: 'u' },
    { ingredientId: 'desconocido', qty: 1, unit: 'u' }
  ]};
  const m = B.recipeMacros(r, { harina, huevos });
  assert.equal(m.contadas, 1);
  assert.equal(m.total, 3);
  assert.equal(m.completo, false);
});

test('una receta sin líneas no se declara completa', () => {
  const m = B.recipeMacros({ yield: 4, ingredients: [] }, {});
  assert.equal(m.completo, false);
  assert.equal(m.totals.calorias, 0);
});

// --- lectura de etiquetas ---------------------------------------------------

const valores = { calorias: 114, proteina: 3.3, carbohidratos: 21, azucar: 1.2,
                  grasa: 1.5, grasaSaturada: 0.4, fibra: 0.8, sodioMg: 120 };

test('una tabla que ya viene por 100 g se copia tal cual', () => {
  const out = B.normalizarEtiqueta({ encontrado: true, base: '100g', valores });
  assert.equal(out.ok, true);
  assert.equal(out.macros.calorias, 114);
  assert.equal(out.macros.sodioMg, 120);
});

test('una tabla por porción se lleva a 100 g', () => {
  const out = B.normalizarEtiqueta({
    encontrado: true, base: 'porcion', porcionGramos: 30, valores });
  assert.equal(out.ok, true);
  assert.equal(out.macros.calorias, 380);          // 114 / 30 * 100
  assert.equal(out.macros.proteina, 11);           // 3.3 / 30 * 100
});

test('sin tamaño de porción se deduce de las porciones por envase', () => {
  // La etiqueta dice "16 porciones" y ella ya escribió "bolsa de 5 lb":
  // 5 lb = 2267.96 g, entre 16 = 141.7 g por porción.
  const out = B.normalizarEtiqueta(
    { encontrado: true, base: 'porcion', porcionGramos: null,
      porcionesPorEnvase: 16, valores },
    { cantidad: 5, unitSingle: 'lb' });
  assert.equal(out.ok, true);
  const porcion = 5 * 453.592 / 16;
  assert.ok(Math.abs(out.macros.calorias - 114 / porcion * 100) < 0.02);
});

test('si no hay forma de saber la porción, se dice y no se inventa', () => {
  const out = B.normalizarEtiqueta({
    encontrado: true, base: 'porcion', porcionGramos: null,
    porcionesPorEnvase: null, valores });
  assert.equal(out.ok, false);
  assert.equal(out.motivo, 'sin-porcion');
});

test('una foto que no es una etiqueta se rechaza', () => {
  assert.equal(B.normalizarEtiqueta({ encontrado: false }).motivo, 'sin-tabla');
  assert.equal(B.normalizarEtiqueta(null).ok, false);
});

test('una tabla sin ningún número se rechaza en vez de devolver ceros', () => {
  const vacios = {};
  B.MACRO_KEYS.forEach(k => { vacios[k] = null; });
  const out = B.normalizarEtiqueta({
    encontrado: true, base: '100g', valores: vacios });
  assert.equal(out.ok, false);
  assert.equal(out.motivo, 'sin-datos');
});

test('un dato que la etiqueta no trae se queda en null, no en cero', () => {
  // Cero y "no dice" son cosas distintas: cero es información, null es su
  // ausencia, y confundirlos falsea la suma de la receta.
  const parcial = Object.assign({}, valores, { fibra: null, grasaSaturada: null });
  const out = B.normalizarEtiqueta({
    encontrado: true, base: '100g', valores: parcial });
  assert.equal(out.ok, true);
  assert.equal(out.macros.fibra, null);
  assert.equal(out.macros.grasaSaturada, null);
  assert.equal(out.macros.calorias, 114);
});

test('un ingrediente con datos parciales sigue sumando lo que sí tiene', () => {
  const parcial = { id: 'p', quantity: 1, unitSingle: 'kg',
                    macros: { calorias: 200, proteina: null } };
  const m = B.recipeMacros(
    { yield: 1, ingredients: [{ ingredientId: 'p', qty: 100, unit: 'g' }] }, { p: parcial });
  assert.equal(m.totals.calorias, 200);
  assert.equal(m.totals.proteina, 0);
});

// --- Etiquetas de dieta -----------------------------------------------------

const almendra = { id: 'a', name: 'Harina de almendra', quantity: 1, unitSingle: 'kg',
  macros: { calorias: 579, proteina: 21, carbohidratos: 22, azucar: 4,
            grasa: 50, grasaSaturada: 4, fibra: 12, sodioMg: 1 } };
const huevo = { id: 'h', name: 'Huevos', quantity: 12, unitSingle: 'u',
  macros: { calorias: 78, proteina: 6, carbohidratos: 0.6, azucar: 0.6,
            grasa: 5, grasaSaturada: 1.6, fibra: 0, sodioMg: 62 } };
const suero = { id: 's', name: 'Proteína de suero', quantity: 1, unitSingle: 'kg',
  macros: { calorias: 400, proteina: 80, carbohidratos: 8, azucar: 3,
            grasa: 6, grasaSaturada: 2, fibra: 1, sodioMg: 300 } };

const names = out => out.badges.map(b => b.k).sort();

test('NO pone etiquetas si falta algún ingrediente por cubrir', () => {
  // Es la regla más importante de todas. "Sin azúcar" en una receta de la que
  // se conoce media información no es un dato incompleto, es uno falso, y
  // alguien que evita el azúcar por salud podría creerlo.
  const r = { yield: 4, ingredients: [
    { ingredientId: 'a', qty: 100, unit: 'g' },
    { ingredientId: 'desconocido', qty: 1, unit: 'u' }
  ]};
  const out = B.recipeBadges(r, { a: almendra });
  assert.deepEqual(out.badges, []);
  assert.equal(out.motivo, 'faltan-datos');
});

test('una receta sin ingredientes no lleva etiquetas', () => {
  const out = B.recipeBadges({ yield: 1, ingredients: [] }, {});
  assert.deepEqual(out.badges, []);
  assert.equal(out.motivo, 'sin-ingredientes');
});

// --- Azúcar: lo que cuenta es la AÑADIDA ------------------------------------

const conAnadida = (name, azucar, azucarAnadida, extra) => Object.assign({
  id: name, name, quantity: 1, unitSingle: 'kg',
  macros: { calorias: 100, proteina: 1, carbohidratos: 20, azucar, azucarAnadida,
            grasa: 1, grasaSaturada: 0, fibra: 1, sodioMg: 10 }
}, extra || {});

test('azúcar NATURAL sin añadida sigue siendo "sin azúcar"', () => {
  // La leche tiene lactosa y se vende como sin azúcar. Lo que la gente busca
  // al leer "sugar free" es que no le hayan AÑADIDO azúcar.
  const leche = conAnadida('Leche', 4.8, 0);
  const r = { yield: 8, ingredients: [{ ingredientId: 'Leche', qty: 500, unit: 'g' }] };
  const b = names(B.recipeBadges(r, { Leche: leche }));
  assert.ok(b.includes('sinAzucar'), 'esperaba sinAzucar: ' + b.join(','));
  assert.ok(!b.includes('bajoAzucar'));
});

test('la fruta baja la etiqueta a "bajo en azúcar" aunque no lleve añadida', () => {
  const fresa = conAnadida('Fresas', 4.9, 0);
  const r = { yield: 8, ingredients: [{ ingredientId: 'Fresas', qty: 200, unit: 'g' }] };
  const b = names(B.recipeBadges(r, { Fresas: fresa }));
  assert.ok(b.includes('bajoAzucar'), 'esperaba bajoAzucar: ' + b.join(','));
  assert.ok(!b.includes('sinAzucar'), 'la fructosa impide decir "sin azúcar"');
});

test('poca azúcar añadida es "bajo en azúcar"', () => {
  const base = conAnadida('Base', 1, 0);
  const azuc = conAnadida('Azúcar blanca', 100, 100);
  const r = { yield: 8, ingredients: [
    { ingredientId: 'Base', qty: 200, unit: 'g' },
    { ingredientId: 'Azúcar blanca', qty: 10, unit: 'g' }] };
  const b = names(B.recipeBadges(r, { 'Base': base, 'Azúcar blanca': azuc }));
  assert.ok(b.includes('bajoAzucar'), b.join(','));
});

test('mucha azúcar añadida no lleva ninguna etiqueta de azúcar', () => {
  const base = conAnadida('Base', 1, 0);
  const azuc = conAnadida('Azúcar blanca', 100, 100);
  const r = { yield: 8, ingredients: [
    { ingredientId: 'Base', qty: 200, unit: 'g' },
    { ingredientId: 'Azúcar blanca', qty: 200, unit: 'g' }] };
  const b = names(B.recipeBadges(r, { 'Base': base, 'Azúcar blanca': azuc }));
  assert.ok(!b.includes('sinAzucar') && !b.includes('bajoAzucar'), b.join(','));
});

test('sin el dato de azúcar añadida NO se pone ninguna de las dos', () => {
  // Es una afirmación sobre salud: sin el dato no se afirma nada.
  const sinDato = { id: 'x', name: 'Algo', quantity: 1, unitSingle: 'kg',
    macros: { calorias: 100, proteina: 1, carbohidratos: 20, azucar: 0,
              grasa: 1, grasaSaturada: 0, fibra: 1, sodioMg: 10 } };
  const r = { yield: 8, ingredients: [{ ingredientId: 'x', qty: 100, unit: 'g' }] };
  const b = names(B.recipeBadges(r, { x: sinDato }));
  assert.ok(!b.includes('sinAzucar') && !b.includes('bajoAzucar'), b.join(','));
});

test('la marca manual de fruta gana sobre el nombre', () => {
  // "Ralladura de limón" suena a fruta pero casi no aporta azúcar.
  const ralladura = conAnadida('Ralladura de limón', 4.2, 0, { fruta: false });
  assert.equal(B.esFruta(ralladura), false);
  const r = { yield: 8, ingredients: [{ ingredientId: 'Ralladura de limón', qty: 5, unit: 'g' }] };
  assert.ok(names(B.recipeBadges(r, { 'Ralladura de limón': ralladura })).includes('sinAzucar'));

  // Y al revés: algo que no suena a fruta se puede marcar como tal.
  const pulpa = conAnadida('Pulpa natural', 8, 0, { fruta: true });
  assert.equal(B.esFruta(pulpa), true);
  const r2 = { yield: 8, ingredients: [{ ingredientId: 'Pulpa natural', qty: 100, unit: 'g' }] };
  assert.ok(names(B.recipeBadges(r2, { 'Pulpa natural': pulpa })).includes('bajoAzucar'));
});

test('detecta fruta por el nombre cuando no se marcó nada', () => {
  assert.equal(B.esFruta({ name: 'Fresas congeladas' }), true);
  assert.equal(B.esFruta({ name: 'Mango en trozos' }), true);
  assert.equal(B.esFruta({ name: 'Harina de trigo' }), false);
  // El coco queda fuera a propósito: casi no trae azúcar.
  assert.equal(B.esFruta({ name: 'Harina de coco' }), false);
});

test('keto exige pocos carbohidratos netos Y mayoría de calorías de grasa', () => {
  const r = { yield: 8, ingredients: [
    { ingredientId: 'a', qty: 200, unit: 'g' }, { ingredientId: 'h', qty: 3, unit: 'u' }] };
  assert.ok(names(B.recipeBadges(r, { a: almendra, h: huevo })).includes('keto'));

  // Mucha proteína y poca grasa: no es keto aunque tenga pocos carbohidratos.
  const rp = { yield: 4, ingredients: [{ ingredientId: 's', qty: 100, unit: 'g' }] };
  const b = names(B.recipeBadges(rp, { s: suero }));
  assert.ok(!b.includes('keto'), 'no debería ser keto: ' + b.join(','));
  assert.ok(b.includes('gymReady'));
});

test('GymReady exige gramos de proteína y también proporción', () => {
  // 10 g de proteína pero ahogados en calorías: no cuenta.
  const graso = { id: 'g', name: 'Almendra', quantity: 1, unitSingle: 'kg',
    macros: { calorias: 900, proteina: 10, carbohidratos: 10, azucar: 1,
              grasa: 85, grasaSaturada: 10, fibra: 5, sodioMg: 10 } };
  const r = { yield: 1, ingredients: [{ ingredientId: 'g', qty: 100, unit: 'g' }] };
  assert.ok(!names(B.recipeBadges(r, { g: graso })).includes('gymReady'));
});

test('paleo se decide por los ingredientes, no por los macros', () => {
  const rOk = { yield: 8, ingredients: [
    { ingredientId: 'a', qty: 200, unit: 'g' }, { ingredientId: 'h', qty: 3, unit: 'u' }] };
  assert.ok(names(B.recipeBadges(rOk, { a: almendra, h: huevo })).includes('paleo'),
    '"harina de almendra" sí es paleo pese a decir harina');

  const trigo = { id: 't', name: 'Harina de trigo', quantity: 1, unitSingle: 'kg',
    macros: { calorias: 364, proteina: 10, carbohidratos: 76, azucar: 0.3,
              grasa: 1, grasaSaturada: 0.2, fibra: 3, sodioMg: 2 } };
  const rNo = { yield: 8, ingredients: [{ ingredientId: 't', qty: 200, unit: 'g' }] };
  assert.ok(!names(B.recipeBadges(rNo, { t: trigo })).includes('paleo'));
});

test('el catálogo de etiquetas incluye paleo para poder filtrar por ella', () => {
  const keys = B.ALL_BADGES.map(b => b.k);
  assert.ok(keys.includes('paleo'));
  assert.ok(keys.includes('gymReady'));
  assert.equal(new Set(keys).size, keys.length, 'sin claves repetidas');
});

test('rescata la porción de "1 Tbsp" cuando el ingrediente se mide en volumen', () => {
  // Etiqueta estilo EE.UU.: dice "1 Tbsp." pero no cuántos gramos son.
  // Una cucharada son 15 ml SIEMPRE, así que si el ingrediente se mide en
  // volumen se puede convertir sin inventar nada.
  const out = B.normalizarEtiqueta(
    { encontrado: true, base: 'porcion', porcionGramos: null,
      porcionTexto: '1 Tbsp.', porcionesPorEnvase: 16,
      valores: { calorias: 60, proteina: 0, carbohidratos: 17, azucar: 17,
                 grasa: 0, grasaSaturada: 0, fibra: 0, sodioMg: 0 } },
    { cantidad: 340, unitSingle: 'ml' });
  assert.equal(out.ok, true);
  // 60 kcal por 15 ml -> 400 por 100 ml
  assert.ok(Math.abs(out.macros.calorias - 400) < 0.5, 'kcal: ' + out.macros.calorias);
});

test('NO adivina los gramos de una cucharada si el ingrediente se mide en peso', () => {
  // Una cucharada de miel pesa 21 g y una de harina 8 g. Sin saber qué es, la
  // densidad no se puede suponer: mejor pedirlo que inventarlo.
  const out = B.normalizarEtiqueta(
    { encontrado: true, base: 'porcion', porcionGramos: null,
      porcionTexto: '1 Tbsp.', porcionesPorEnvase: 16,
      valores: { calorias: 60, proteina: 0, carbohidratos: 17, azucar: 17,
                 grasa: 0, grasaSaturada: 0, fibra: 0, sodioMg: 0 } },
    { cantidad: 340, unitSingle: 'g' });
  // Con envase en gramos sí se puede por división: 340 g / 16 porciones.
  assert.equal(out.ok, true);
  const porcion = 340 / 16;
  assert.ok(Math.abs(out.macros.calorias - 60 / porcion * 100) < 0.5);

  // Pero sin saber cuánto trae el envase, no hay forma y se dice.
  const sinNada = B.normalizarEtiqueta(
    { encontrado: true, base: 'porcion', porcionGramos: null,
      porcionTexto: '1 Tbsp.', porcionesPorEnvase: null,
      valores: { calorias: 60, proteina: 0, carbohidratos: 17, azucar: 17,
                 grasa: 0, grasaSaturada: 0, fibra: 0, sodioMg: 0 } },
    { cantidad: 0, unitSingle: 'g' });
  assert.equal(sinNada.ok, false);
  assert.equal(sinNada.motivo, 'sin-porcion');
});

test('una etiqueta con muchos ceros sigue siendo válida', () => {
  // La miel es 0 grasa, 0 proteína, 0 sodio. Todo ceros salvo azúcar: eso es
  // información real, no una tabla vacía.
  const out = B.normalizarEtiqueta({
    encontrado: true, base: 'porcion', porcionGramos: 21,
    valores: { calorias: 60, proteina: 0, carbohidratos: 17, azucar: 17,
               grasa: 0, grasaSaturada: 0, fibra: 0, sodioMg: 0 } });
  assert.equal(out.ok, true);
  assert.ok(Math.abs(out.macros.azucar - 80.95) < 0.01);
  assert.equal(out.macros.grasa, 0);
});

// --- Textos de cabecera -----------------------------------------------------
// Estos no mueven ningún precio, pero son lo que se lee bajo el título de cada
// pantalla, y están escritos también en Swift. Aquí se fija el comportamiento;
// la conformidad con Swift la comprueba math-conformance.json.

test('el recuento de una pantalla dice singular o plural según toque', () => {
  assert.equal(B.countLabel(1, 1, 'receta', 'recetas'), '1 receta');
  assert.equal(B.countLabel(2, 2, 'receta', 'recetas'), '2 recetas');
  assert.equal(B.countLabel(8, 8, 'guardado', 'guardados'), '8 guardados');
});

test('con una búsqueda encima el recuento dice cuántas de cuántas', () => {
  assert.equal(B.countLabel(3, 8, 'guardado', 'guardados'), '3 de 8');
  assert.equal(B.countLabel(0, 40, 'gasto', 'gastos'), '0 de 40');
});

test('en una pantalla vacía no se escribe nada', () => {
  // Debajo va el mensaje que dice qué hacer; un "0 recetas" encima estorba.
  assert.equal(B.countLabel(0, 0, 'receta', 'recetas'), null);
  assert.equal(B.countLabel(5, -1, 'venta', 'ventas'), null);
});

test('los trozos de la cabecera se juntan saltándose los que faltan', () => {
  assert.equal(B.joinDetail(['Este mes', '12 ventas']), 'Este mes · 12 ventas');
  assert.equal(B.joinDetail(['Este mes', null]), 'Este mes');
  assert.equal(B.joinDetail([null, '12 ventas']), '12 ventas');
  assert.equal(B.joinDetail(['Este mes', '']), 'Este mes');
  assert.equal(B.joinDetail([null, null]), null);
  assert.equal(B.joinDetail([]), null);
});
