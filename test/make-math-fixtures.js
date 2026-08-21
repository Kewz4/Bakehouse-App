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

// Recetas con macros: los ingredientes van con sus datos nutricionales y se
// comprueba que Swift sume exactamente igual, incluida la cobertura parcial.
const macroIngredients = {
  harina: { id: 'harina', quantity: 5, unitSingle: 'lb', price: 6.5,
    macros: { calorias: 380, proteina: 11, carbohidratos: 72, azucar: 1.5,
              grasa: 1.2, grasaSaturada: 0.2, fibra: 2.7, sodioMg: 2 } },
  azucar: { id: 'azucar', quantity: 2, unitSingle: 'kg', price: 3,
    macros: { calorias: 400, proteina: 0, carbohidratos: 100, azucar: 100,
              grasa: 0, grasaSaturada: 0, fibra: 0, sodioMg: 0 } },
  leche:  { id: 'leche', quantity: 1, unitSingle: 'l', price: 1.15,
    macros: { calorias: 61, proteina: 3.2, carbohidratos: 4.8, azucar: 4.8,
              grasa: 3.3, grasaSaturada: 1.9, fibra: null, sodioMg: 43 } },
  huevos: { id: 'huevos', quantity: 12, unitSingle: 'u', price: 2.4 }  // sin macros
};

const macroRecipes = [
  { name: 'todo cubierto', yield: 10,
    ingredients: [{ ingredientId: 'harina', qty: 500, unit: 'g' },
                  { ingredientId: 'azucar', qty: 0.2, unit: 'kg' }] },
  { name: 'cobertura parcial', yield: 8,
    ingredients: [{ ingredientId: 'harina', qty: 250, unit: 'g' },
                  { ingredientId: 'huevos', qty: 3, unit: 'u' },
                  { ingredientId: 'nada', qty: 1, unit: 'u' }] },
  { name: 'volumen en tazas', yield: 4,
    ingredients: [{ ingredientId: 'leche', qty: 2, unit: 'taza' }] },
  { name: 'sin ingredientes', yield: 1, ingredients: [] }
];

// Etiquetas de dieta: se comprueban tanto las que se ponen como las que NO,
// que es lo que de verdad importa (una receta incompleta no lleva ninguna).
const badgeIngredients = {
  almendra: { id: 'almendra', name: 'Harina de almendra', quantity: 1, unitSingle: 'kg',
    macros: { calorias: 579, proteina: 21, carbohidratos: 22, azucar: 4, azucarAnadida: 0,
              grasa: 50, grasaSaturada: 4, fibra: 12, sodioMg: 1 } },
  huevo: { id: 'huevo', name: 'Huevos', quantity: 12, unitSingle: 'u',
    macros: { calorias: 78, proteina: 6, carbohidratos: 0.6, azucar: 0.6, azucarAnadida: 0,
              grasa: 5, grasaSaturada: 1.6, fibra: 0, sodioMg: 62 } },
  trigo: { id: 'trigo', name: 'Harina de trigo', quantity: 1, unitSingle: 'kg',
    macros: { calorias: 364, proteina: 10, carbohidratos: 76, azucar: 0.3, azucarAnadida: 0,
              grasa: 1, grasaSaturada: 0.2, fibra: 3, sodioMg: 2 } },
  blanca: { id: 'blanca', name: 'Azúcar blanca', quantity: 1, unitSingle: 'kg',
    macros: { calorias: 400, proteina: 0, carbohidratos: 100, azucar: 100, azucarAnadida: 100,
              grasa: 0, grasaSaturada: 0, fibra: 0, sodioMg: 0 } },
  suero: { id: 'suero', name: 'Proteína de suero', quantity: 1, unitSingle: 'kg',
    macros: { calorias: 400, proteina: 80, carbohidratos: 8, azucar: 3, azucarAnadida: 0,
              grasa: 6, grasaSaturada: 2, fibra: 1, sodioMg: 300 } },
  // Fruta: fructosa natural, cero azúcar añadida.
  fresa: { id: 'fresa', name: 'Fresas', quantity: 1, unitSingle: 'kg',
    macros: { calorias: 32, proteina: 0.7, carbohidratos: 7.7, azucar: 4.9, azucarAnadida: 0,
              grasa: 0.3, grasaSaturada: 0, fibra: 2, sodioMg: 1 } },
  // Lactosa natural, cero añadida: tiene que salir "sin azúcar".
  leche: { id: 'leche', name: 'Leche entera', quantity: 1, unitSingle: 'l',
    macros: { calorias: 61, proteina: 3.2, carbohidratos: 4.8, azucar: 4.8, azucarAnadida: 0,
              grasa: 3.3, grasaSaturada: 1.9, fibra: 0, sodioMg: 43 } },
  // Marcada a mano como NO fruta pese a llamarse limón: es sólo ralladura.
  ralladura: { id: 'ralladura', name: 'Ralladura de limón', quantity: 100, unitSingle: 'g',
    fruta: false,
    macros: { calorias: 47, proteina: 1.5, carbohidratos: 16, azucar: 4.2, azucarAnadida: 0,
              grasa: 0.3, grasaSaturada: 0, fibra: 10, sodioMg: 6 } },
  sinDatos: { id: 'sinDatos', name: 'Vainilla', quantity: 1, unitSingle: 'ml' }
};

const badgeRecipes = [
  { name: 'keto y paleo', yield: 8,
    ingredients: [{ ingredientId: 'almendra', qty: 200, unit: 'g' },
                  { ingredientId: 'huevo', qty: 3, unit: 'u' }] },
  { name: 'pastel normal', yield: 10,
    ingredients: [{ ingredientId: 'trigo', qty: 300, unit: 'g' },
                  { ingredientId: 'blanca', qty: 200, unit: 'g' }] },
  { name: 'alto en proteina', yield: 4,
    ingredients: [{ ingredientId: 'suero', qty: 100, unit: 'g' }] },
  // Lactosa pero sin azúcar añadida -> SIN azúcar
  { name: 'lacteo sin anadida', yield: 8,
    ingredients: [{ ingredientId: 'leche', qty: 500, unit: 'ml' }] },
  // Fruta sin azúcar añadida -> BAJO en azúcar (fructosa)
  { name: 'con fruta', yield: 8,
    ingredients: [{ ingredientId: 'almendra', qty: 150, unit: 'g' },
                  { ingredientId: 'fresa', qty: 200, unit: 'g' }] },
  // Poca azúcar añadida -> BAJO en azúcar
  { name: 'poca anadida', yield: 8,
    ingredients: [{ ingredientId: 'almendra', qty: 200, unit: 'g' },
                  { ingredientId: 'blanca', qty: 10, unit: 'g' }] },
  // "Limón" desmarcado como fruta -> sigue siendo SIN azúcar
  { name: 'ralladura no cuenta como fruta', yield: 8,
    ingredients: [{ ingredientId: 'almendra', qty: 200, unit: 'g' },
                  { ingredientId: 'ralladura', qty: 5, unit: 'g' }] },
  // Falta la azúcar añadida de un ingrediente -> ninguna etiqueta de azúcar
  { name: 'faltan datos', yield: 4,
    ingredients: [{ ingredientId: 'almendra', qty: 100, unit: 'g' },
                  { ingredientId: 'sinDatos', qty: 5, unit: 'ml' }] },
  { name: 'sin ingredientes', yield: 1, ingredients: [] }
];

const out = {
  parseQty: quantities.map(q => ({ in: q, out: B.parseQty(q) })),
  prettyQty: prettyInputs.map(n => ({ in: n, out: B.prettyQty(n) })),
  baseCost: ingredients.map(i => ({ in: i, out: B.baseCost(i) })),
  // "A cuánto sale": tiene que elegir la MISMA unidad en los dos lados, o el
  // teléfono diría "$1.24 por lb" y la laptop "$0.00 por g".
  displayCost: ingredients.map(i => {
    const d = B.displayCost(i);
    return { in: i, amount: d.amount, unit: d.unit };
  }),
  badgeIngredients: badgeIngredients,
  badgeRecipes: badgeRecipes.map(r => {
    const out = B.recipeBadges(r, badgeIngredients);
    return { in: r, badges: out.badges.map(b => b.k), motivo: out.motivo };
  }),
  macroIngredients: macroIngredients,
  macroRecipes: macroRecipes.map(r => {
    const m = B.recipeMacros(r, macroIngredients);
    return { in: r, totals: m.totals, perServing: m.perServing,
             contadas: m.contadas, total: m.total, completo: m.completo };
  }),
  recipe: recipes.map(r => ({
    in: r,
    totalCost: B.recipeCost(r),
    unitCost: B.recipeUnitCost(r),
    margin: B.recipeMargin(r),
    suggested: B.suggestPrice(r)
  }))
};

fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
console.log('parseQty:%d prettyQty:%d baseCost:%d recipe:%d macroRecipes:%d -> %s',
  out.parseQty.length, out.prettyQty.length, out.baseCost.length, out.recipe.length,
  out.macroRecipes.length, path.relative(process.cwd(), OUT));
console.log('badgeRecipes:%d', out.badgeRecipes.length);
