/**
 * Genera los casos de conformidad entre los dos motores de combinación.
 *
 *   node test/make-conformance-fixtures.js
 *
 * Escribe ios/OlivoLioraCore/Tests/OlivoLioraCoreTests/merge-conformance.json
 * con pares de documentos y el resultado canónico que produce el motor de
 * JavaScript. La prueba de Swift lee ese archivo, combina con SU motor y exige
 * exactamente el mismo texto.
 *
 * Sirve para lo siguiente: si alguien toca la regla de combinación en un solo
 * lado, la prueba de Swift falla. Sin esto, el teléfono y la laptop podrían
 * quedar en desacuerdo sin que nadie se entere hasta perder datos.
 */
const fs = require('node:fs');
const path = require('node:path');
const Sync = require('../sync-core.js');

const OUT = path.join(__dirname, '..', 'ios', 'OlivoLioraCore', 'Tests',
                      'OlivoLioraCoreTests', 'merge-conformance.json');

// Base fija: los casos tienen que ser reproducibles, no depender de la hora a
// la que se generen. Es una fecha real reciente para que las lápidas no se
// consideren antiguas y se limpien.
const T = 1787000000000;
const rec = (id, dt, extra) => Object.assign({ id, updatedAt: T + dt, deleted: false }, extra || {});
const doc = (obj) => Object.assign(Sync.emptyDoc(), obj);

const cases = [
  {
    name: 'gana el más reciente',
    a: doc({ sales: [rec('s1', 100, { product: 'Flan', total: 10 })] }),
    b: doc({ sales: [rec('s1', 200, { product: 'Flan grande', total: 14 })] })
  },
  {
    name: 'union de dos dispositivos',
    a: doc({ sales: [rec('a1', 100, { total: 5 })], expenses: [rec('e1', 120, { amount: 3 })] }),
    b: doc({ sales: [rec('b1', 110, { total: 7 })], expenses: [rec('e2', 130, { amount: 4 })] })
  },
  {
    name: 'lapida gana a registro viejo',
    a: doc({ expenses: [rec('e1', 100, { name: 'Gas' })] }),
    b: doc({ expenses: [Sync.tombstone('e1', T + 200)] })
  },
  {
    name: 'edicion posterior resucita',
    a: doc({ expenses: [Sync.tombstone('e1', T + 100)] }),
    b: doc({ expenses: [rec('e1', 300, { name: 'Gas para horno' })] })
  },
  {
    name: 'empate exacto se desempata igual',
    a: doc({ sales: [rec('s1', 500, { total: 10 })] }),
    b: doc({ sales: [rec('s1', 500, { total: 20 })] })
  },
  {
    name: 'decimales y fracciones',
    a: doc({ recipes: [rec('r1', 100, { name: 'Brownie', yield: 12, price: 2.5,
             ingredients: [{ name: 'Harina', qty: 0.5, unit: 'kg', cost: 1.25 }] })] }),
    b: doc({ recipes: [rec('r1', 200, { name: 'Brownie', yield: 12, price: 2.75,
             ingredients: [{ name: 'Harina', qty: 0.75, unit: 'kg', cost: 1.25 }] })] })
  },
  {
    name: 'campos desconocidos se conservan',
    a: doc({ sales: [rec('s1', 100, { product: 'Pie', futuro: { algo: [1, 2, 3], flag: true } })] }),
    b: doc({ sales: [rec('s2', 110, { product: 'Tarta' })] })
  },
  {
    name: 'texto con acentos comillas y saltos',
    a: doc({ expenses: [rec('e1', 100, { name: 'Cajas "grandes"\ny cintas', category: 'Empaque' })] }),
    b: doc({ expenses: [rec('e2', 110, { name: 'Café con leche · azúcar', category: 'Otro' })] })
  },
  {
    name: 'orden de entrada distinto mismo resultado',
    a: doc({ sales: [rec('z', 100), rec('a', 200), rec('m', 150)] }),
    b: doc({ sales: [rec('m', 150), rec('a', 200), rec('z', 100)] })
  },
  {
    name: 'documentos vacios',
    a: Sync.emptyDoc(),
    b: Sync.emptyDoc()
  },
  {
    name: 'uno vacio y otro con datos',
    a: Sync.emptyDoc(),
    b: doc({ ingredients: [rec('i1', 100, { name: 'Harina', unit: 'bolsa', quantity: 5, price: 6.5, unitSingle: 'lb' })] })
  },
  {
    name: 'todas las colecciones a la vez',
    a: doc({
      ingredients: [rec('i1', 100, { name: 'Azúcar', quantity: 2, price: 3, unitSingle: 'kg' })],
      recipes: [rec('r1', 110, { name: 'Flan', yield: 8, price: 2 })],
      sales: [rec('s1', 120, { product: 'Flan', qty: 2, total: 4 })],
      expenses: [rec('x1', 130, { name: 'Gas', amount: 12, category: 'Servicios' })]
    }),
    b: doc({
      ingredients: [rec('i2', 140, { name: 'Huevos', quantity: 12, price: 2.4, unitSingle: 'u' })],
      recipes: [rec('r1', 150, { name: 'Flan napolitano', yield: 8, price: 2.5 })],
      sales: [rec('s2', 160, { product: 'Cheesecake', qty: 1, total: 12 })],
      expenses: [Sync.tombstone('x1', T + 170)]
    })
  }
];

const out = cases.map(c => ({
  name: c.name,
  a: c.a,
  b: c.b,
  // Se comprueban los dos órdenes: la combinación tiene que ser conmutativa.
  expectedAB: Sync.canonical(Sync.mergeDocs(c.a, c.b)),
  expectedBA: Sync.canonical(Sync.mergeDocs(c.b, c.a))
}));

for (const c of out) {
  if (c.expectedAB !== c.expectedBA) {
    throw new Error('el caso "' + c.name + '" no es conmutativo en JavaScript');
  }
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
console.log('escritos ' + out.length + ' casos en ' + path.relative(process.cwd(), OUT));
