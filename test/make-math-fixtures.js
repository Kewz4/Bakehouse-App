/**
 * Genera los casos de conformidad de las CUENTAS entre JavaScript y Swift.
 *
 *   node test/make-math-fixtures.js
 *
 * El motor de combinación ya se compara en merge-conformance.json. Esto cubre
 * lo otro que está escrito dos veces: cómo se interpreta una cantidad escrita a
 * mano ("media taza", "1 ½") y las fórmulas de costo y margen.
 *
 * Si divergen, no hay error ni caída: simplemente el teléfono y la laptop
 * muestran precios distintos para la misma receta. Por eso se comparan.
 */
const fs = require('node:fs');
const path = require('node:path');
const B = require('../business-core.js');

const OUT = path.join(__dirname, '..', 'ios', 'OlivoLioraCore', 'Tests',
                      'OlivoLioraCoreTests', 'math-conformance.json');

const quantities = [
  '1', '2.5', '2,5', '0.5', '10',
  '1/2', '3/4', '1 1/2', '2 3/4', '5/8',
  '½', '¼', '¾', '⅓', '⅔', '⅛', '1 ½', '2 ¼', '3 ⅓',
  'media', 'medio', 'mitad', 'un cuarto', 'dos tercios', 'tres cuartos',
  'una docena', 'dos docenas', 'un octavo',
  'media taza', '2 tazas', '1 1/2 libras',
  '', '   ', 'nada', 'abc'
];

const prettyInputs = [0, 0.125, 0.25, 1/3, 0.5, 2/3, 0.75, 1, 1.25, 1.5, 2, 2.75, 3.5, 12, 0.3, 1.07];

const ingredients = [
  { name: 'Harina',  quantity: 5,   price: 6.5,  unitSingle: 'lb' },
  { name: 'Azúcar',  quantity: 2,   price: 3,    unitSingle: 'kg' },
  { name: 'Huevos',  quantity: 12,  price: 2.4,  unitSingle: 'u' },
  { name: 'Leche',   quantity: 1,   price: 1.15, unitSingle: 'l' },
  { name: 'Vainilla',quantity: 60,  price: 4.2,  unitSingle: 'ml' },
  { name: 'Raro',    quantity: 0,   price: 5,    unitSingle: 'g' }   // división por cero
];

const recipes = [
  { name: 'Brownie', yield: 12, price: 2.5,
    ingredients: [{ qty: 500, cost: 0.0028 }, { qty: 3, cost: 0.2 }] },
  { name: 'Sin precio', yield: 8, price: 0,
    ingredients: [{ qty: 250, cost: 0.004 }] },
  { name: 'Pierde plata', yield: 4, price: 0.5,
    ingredients: [{ qty: 1000, cost: 0.01 }] },
  { name: 'Sin ingredientes', yield: 1, price: 5, ingredients: [] }
];

const out = {
  parseQty: quantities.map(q => ({ in: q, out: B.parseQty(q) })),
  prettyQty: prettyInputs.map(n => ({ in: n, out: B.prettyQty(n) })),
  baseCost: ingredients.map(i => ({ in: i, out: B.baseCost(i) })),
  recipe: recipes.map(r => ({
    in: r,
    totalCost: B.recipeCost(r),
    unitCost: B.recipeUnitCost(r),
    margin: B.recipeMargin(r),
    suggested: B.suggestPrice(r)
  }))
};

fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
console.log('parseQty:%d prettyQty:%d baseCost:%d recipe:%d -> %s',
  out.parseQty.length, out.prettyQty.length, out.baseCost.length, out.recipe.length,
  path.relative(process.cwd(), OUT));
