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
