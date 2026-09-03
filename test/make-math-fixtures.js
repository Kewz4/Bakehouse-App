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

// Casos que SUBEN de unidad porque en la suya el precio se leería "$0.00".
// Es justo lo que él reportó ("me da el costo por onza") y no tenía ni una
// prueba de conformidad: ninguno de los ingredientes de arriba escala.
const escalan = [
  { name: 'Harina fina',  quantity: 459,  price: 1.25, unitSingle: 'g' },   // métrico -> kg
  { name: 'Sal',          quantity: 100,  price: 0.5,  unitSingle: 'oz' },  // imperial
  { name: 'Agua',         quantity: 3000, price: 2,    unitSingle: 'ml' },  // métrico -> L
  { name: 'Caldo',        quantity: 50,   price: 1.2,  unitSingle: 'cda' }, // casero
  { name: 'Arroz',        quantity: 2000, price: 3.4,  unitSingle: 'g' }
];

// Ingredientes que además dicen cuánto pesa una pieza. Es lo que permite
// comprar por cajas y cocinar por gramos.
const conPeso = [
  { name: 'Mantequilla', quantity: 7,   price: 7,    unitSingle: 'u', unitWeight: 113, unitWeightUnit: 'g' },
  { name: 'Banana',      quantity: 12,  price: 3,    unitSingle: 'u', unitWeight: 118, unitWeightUnit: 'g' },
  { name: 'Huevo',       quantity: 1,   price: 0.25, unitSingle: 'u', unitWeight: 50,  unitWeightUnit: 'g' },
  { name: 'Leche',       quantity: 1,   price: 1.15, unitSingle: 'l' },     // sin peso por pieza
  { name: 'Queso',       quantity: 500, price: 6,    unitSingle: 'g', unitWeight: 30, unitWeightUnit: 'g' },
  { name: 'Roto',        quantity: 5,   price: 2,    unitSingle: 'u', unitWeight: 0,  unitWeightUnit: 'g' },
  { name: 'Absurdo',     quantity: 5,   price: 2,    unitSingle: 'u', unitWeight: 3,  unitWeightUnit: 'u' }
];

// Conversiones que tiene que resolver una línea de receta.
const conversiones = [
  { ing: conPeso[0], unit: 'g',    qty: 200 },   // barras -> gramos
  { ing: conPeso[0], unit: 'u',    qty: 2 },     // su propia unidad: sin conversión
  { ing: conPeso[0], unit: 'kg',   qty: 1 },
  { ing: conPeso[1], unit: 'g',    qty: 100 },
  { ing: conPeso[3], unit: 'cda',  qty: 2 },     // litros -> cucharadas
  { ing: conPeso[3], unit: 'taza', qty: 1 },
  { ing: conPeso[3], unit: 'u',    qty: 1 },     // sin peso por pieza: imposible
  { ing: conPeso[4], unit: 'u',    qty: 3 },     // gramos -> piezas
  { ing: conPeso[5], unit: 'g',    qty: 50 },    // peso por pieza inválido
  { ing: conPeso[6], unit: 'g',    qty: 50 },    // "cada unidad pesa 3 unidades"
  // Los dos que NO deben enseñar badge: la frase saldría "80 g = 80 g", que es
  // verdad y no dice nada.
  { ing: { name: 'Harina', quantity: 5, price: 6.5, unitSingle: 'lb' }, unit: 'g',  qty: 80 },
  { ing: { name: 'Leche',  quantity: 1, price: 2,   unitSingle: 'l'  }, unit: 'ml', qty: 250 },
  // Medio limón: se cuenta por unidades y la mitad tiene que salir.
  { ing: { name: 'Limón',  quantity: 10, price: 3,  unitSingle: 'u'  }, unit: 'u',  qty: 0.5 }
];

// Gastos con cantidad, y el acumulado desde que empezó el negocio. La fecha de
// "hoy" se fija para que el fixture no cambie de un día para otro.
const HOY = '2026-03-15';
const gastos = [
  { id: 'g1', date: '2026-01-10', name: 'Batidora',        amount: 120,  tipo: 'inversion' },
  { id: 'g2', date: '2026-01-10', name: 'Molde',           amount: 6.75, cantidad: 4, tipo: 'inversion' },
  { id: 'g3', date: '2026-01-15', name: 'Papel pergamino', amount: 1.25, cantidad: 2, tipo: 'recurrente', frecuencia: 'semanal' },
  { id: 'g4', date: '2026-02-01', name: 'Gas',             amount: 30,   tipo: 'recurrente', frecuencia: 'mensual' },
  { id: 'g5', date: '2026-02-20', name: 'Cajas',           amount: 0.4,  cantidad: 50, tipo: 'gasto' },
  { id: 'g6', date: '2026-03-14', name: 'Sin cantidad',    amount: 9,    tipo: 'gasto' }
];

// De qué se habla cuando se habla de macros: por 100 g, o por pieza.
const basesMacro = ['g', 'kg', 'ml', 'l', 'u', 'docena', 'taza', 'lb'];

const categorias = [
  { name: 'Harina',   kind: 'ingrediente' },
  { name: 'Banana',   kind: 'fruta' },
  { name: 'Caja',     kind: 'empaque' },
  { name: 'Fresa' },                              // por el nombre
  { name: 'Harina' },                             // por el nombre, no es fruta
  { name: 'Mora',     fruta: false },             // lo que ella decidió manda
  { name: 'Cosa',     fruta: true },
  { name: 'Coco' },                               // a propósito NO es fruta
  { name: 'Vaso',     kind: 'empaque', fruta: true }  // la categoría manda
];

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

// Los textos de cabecera ("8 guardados", "3 de 8") también están escritos en los
// dos sitios. No cambian ningún precio, pero sí hacen que la misma pantalla se
// lea distinta en el teléfono y en la laptop, que es justo lo que no queremos.
const countCases = [
  { shown: 0,  total: 0,  singular: 'receta',   plural: 'recetas' },
  { shown: 0,  total: 1,  singular: 'receta',   plural: 'recetas' },
  { shown: 1,  total: 1,  singular: 'receta',   plural: 'recetas' },
  { shown: 2,  total: 2,  singular: 'venta',    plural: 'ventas' },
  { shown: 3,  total: 8,  singular: 'guardado', plural: 'guardados' },
  { shown: 8,  total: 8,  singular: 'guardado', plural: 'guardados' },
  { shown: 12, total: 12, singular: 'gasto',    plural: 'gastos' },
  { shown: 0,  total: 40, singular: 'gasto',    plural: 'gastos' },
  { shown: 5,  total: -1, singular: 'venta',    plural: 'ventas' }
];

const joinCases = [
  ['Este mes', '12 ventas'],
  ['Este mes', null],
  [null, '12 ventas'],
  [null, null],
  ['Este mes', ''],
  ['Hoy', '1 gasto', '']
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
  countLabel: countCases.map(c => ({
    in: c,
    out: B.countLabel(c.shown, c.total, c.singular, c.plural)
  })),
  joinDetail: joinCases.map(parts => ({ in: parts, out: B.joinDetail(parts) })),
  displayCostEscala: escalan.map(i => {
    const d = B.displayCost(i);
    return { in: i, amount: d.amount, unit: d.unit };
  }),
  costBreakdown: conPeso.map(i => ({
    in: i,
    salidas: B.costBreakdown(i).map(c => ({ amount: c.amount, unit: c.unit }))
  })),
  unitFactor: conversiones.map(c => {
    const f = B.unitFactor(c.ing, c.unit);
    const info = B.conversionInfo(c.ing, c.unit, c.qty);
    return {
      in: { ing: c.ing, unit: c.unit, qty: c.qty },
      factor: f ? f.factor : null,
      via: f ? f.via : null,
      lineCost: B.lineUnitCost(c.ing, c.unit),
      texto: info ? info.texto : null
    };
  }),
  macroBasis: basesMacro.map(u => {
    const b = B.macroBasis(u);
    return { in: u, amount: b.amount, unit: b.unit, etiqueta: b.etiqueta, factor: b.factor };
  }),
  kindOf: categorias.map(i => ({ in: i, kind: B.kindOf(i), fruta: B.esFruta(i) })),
  rendimiento: (() => {
    const ings = {
      az: { id: 'az', name: 'Azúcar', unit: 'bolsa', quantity: 2, price: 3, unitSingle: 'kg' },
      le: { id: 'le', name: 'Leche', unit: 'botella', quantity: 1, price: 2, unitSingle: 'l' },
      ba: { id: 'ba', name: 'Barras', unit: 'caja', quantity: 24, price: 7,
            unitSingle: 'u', unitWeight: 113, unitWeightUnit: 'g' }
    };
    const receta = { id: 'r1', name: 'Galletas', yield: 24, ingredients: [
      { ingredientId: 'az', qty: 200, unit: 'g' },
      { ingredientId: 'az', qty: 50,  unit: 'g' },   // el mismo ingrediente dos veces
      { ingredientId: 'le', qty: 100, unit: 'ml' },
      { ingredientId: 'ba', qty: 226, unit: 'g' }    // se compra por piezas, se pide en peso
    ]};
    const otra = { id: 'r2', name: 'Sin azúcar', yield: 4, ingredients: [
      { ingredientId: 'le', qty: 50, unit: 'ml' }
    ]};
    const casos = [
      { ing: 'az', qty: 2,   unit: 'kg' },
      { ing: 'az', qty: 100, unit: 'g' },     // no alcanza ni para una
      { ing: 'le', qty: 1,   unit: 'l' },
      { ing: 'le', qty: 2,   unit: 'taza' },
      { ing: 'ba', qty: 24,  unit: 'u' },     // piezas -> peso
      { ing: 'ba', qty: 1,   unit: 'kg' },
      { ing: 'az', qty: 0,   unit: 'kg' }     // sin cantidad: no hay respuesta
    ];
    return {
      ingredientes: ings,
      receta: receta,
      casos: casos.map(c => {
        const r = B.rendimiento(ings[c.ing], c.qty, c.unit, receta);
        return { in: c, out: r && {
          tandas: r.tandas, tandasEnteras: r.tandasEnteras,
          porciones: r.porciones, porcionesEnteras: r.porcionesEnteras,
          gastaPorTanda: r.gastaPorTanda, disponible: r.disponible,
          falta: r.falta, sobra: r.sobra, unidadBase: r.unidadBase, alcanza: r.alcanza } };
      }),
      // Qué recetas usan cada ingrediente.
      usadoEn: Object.keys(ings).map(k => ({
        id: k, recetas: B.recetasCon(ings[k], [receta, otra]).map(r => r.id) }))
    };
  })(),
  nutricionPendiente: badgeRecipes.map(r => {
    const p = B.nutricionPendiente(r, badgeIngredients);
    return { in: r, falta: !!p && !p.vacia, faltan: p ? p.faltan : 0,
             total: p ? p.total : 0, vacia: !!p && p.vacia };
  }),
  faltaNutricion: Object.values(badgeIngredients).map(i => ({
    id: i.id, falta: B.faltaNutricion(i)
  })),
  periodos: (() => {
    // Un "hoy" fijo: si no, el fixture cambiaría cada día. Las fechas se
    // escriben por componentes locales, no en ISO, para que el huso horario del
    // que corre esto no corra ningún día.
    const hoy = new Date(2026, 8, 3);   // 3 de septiembre de 2026, un jueves
    const dia = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const casos = [];
    for (const f of ['day', 'week', 'month', 'quarter', 'semester', 'year', 'all']) {
      for (const o of [0, -1, -5, 1]) {
        const r = B.rangoDePeriodo(f, o, hoy);
        casos.push({ clave: f, offset: o, desde: dia(r.desde), hasta: dia(r.hasta),
                     etiqueta: r.etiqueta, movible: r.movible });
      }
    }
    return { hoy: dia(hoy), casos };
  })(),
  gastos: (() => {
    B.fijarAhora(() => new Date(HOY + 'T12:00:00Z'));
    const desde = new Date('2026-03-01T00:00:00Z');
    const hasta = new Date('2999-12-31T23:59:59Z');
    const out = {
      hoy: HOY,
      cantidades: gastos.map(g => ({ in: g, cantidad: B.cantidadDe(g), montoBase: B.montoBase(g) })),
      mes: B.desgloseGastos(gastos, desde, hasta),
      inicio: (() => { const r = B.desdeElInicio(gastos); return { ...r, desde: undefined } })()
    };
    B.fijarAhora(null);
    return out;
  })(),
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
console.log('badgeRecipes:%d countLabel:%d joinDetail:%d', out.badgeRecipes.length, out.countLabel.length, out.joinDetail.length);
console.log('rendimiento:%d', out.rendimiento.casos.length);
console.log('periodos:%d nutriciónPendiente:%d faltaNutrición:%d', out.periodos.casos.length,
  out.nutricionPendiente.length, out.faltaNutricion.length);
console.log('gastos: cantidades:%d mes:%s inicio:%s',
  out.gastos.cantidades.length, out.gastos.mes.total.toFixed(2), out.gastos.inicio.total.toFixed(2));
console.log('escala:%d costBreakdown:%d unitFactor:%d macroBasis:%d kindOf:%d',
  out.displayCostEscala.length, out.costBreakdown.length, out.unitFactor.length,
  out.macroBasis.length, out.kindOf.length);
