/**
 * Pruebas de las dos direcciones que hacen que la app se actualice sola.
 *   node --test test/ota.test.js
 *
 * Lo que se comprueba aquí es lo que rompería la actualización en el teléfono
 * de ella, que es donde no hay nadie para diagnosticar nada:
 *
 *   - que nunca se ofrezca una actualización que no existe;
 *   - que el manifest que lee iOS sea un plist válido y con el identificador
 *     correcto (uno equivocado instala una app aparte en vez de actualizar);
 *   - que si GitHub no contesta, la app siga funcionando y sin avisos raros.
 */
const test = require('node:test');
const assert = require('node:assert');

const realFetch = globalThis.fetch;

// Lo que "hay publicado" en GitHub durante cada prueba.
let publicado = null;
let fallos = 0;

globalThis.fetch = async function (url, opts) {
  const key = String(url);
  if (key.includes('releases/latest/download/version.json')) {
    if (publicado === null) { fallos += 1; return { ok: false, status: 404 }; }
    if (publicado === 'caido') { fallos += 1; throw new Error('red caída'); }
    return { ok: true, status: 200, json: async () => publicado };
  }
  return realFetch(url, opts);
};

const versionHandler = require('../api/app-version.js');
const manifestHandler = require('../api/manifest.js');

const IPA = 'https://github.com/Kewz4/Bakehouse-App/releases/latest/download';

const KENNETH = 'app.gorilla3597.nadir5999';
const CAMILA = 'app.wind2481.cyan887';

/** Dos iPhones, dos certificados, dos .ipa: lo que hay de verdad. */
const RELEASE = {
  version: '1.0.0',
  build: 42,
  title: 'Olivo & Liora',
  publishedAt: '2026-08-21T12:00:00Z',
  apps: [
    { nombre: 'Kenneth', bundleId: KENNETH, ipa: `${IPA}/OlivoLiora-${KENNETH}.ipa` },
    { nombre: 'Camila', bundleId: CAMILA, ipa: `${IPA}/OlivoLiora-${CAMILA}.ipa` }
  ],
  bundleId: KENNETH,
  ipa: `${IPA}/OlivoLiora-${KENNETH}.ipa`
};

/** Una publicación de antes de que hubiera dos teléfonos. */
const RELEASE_VIEJA = {
  version: '1.0.0',
  build: 42,
  bundleId: KENNETH,
  title: 'Olivo & Liora',
  ipa: `${IPA}/OlivoLiora.ipa`,
  publishedAt: '2026-08-21T12:00:00Z'
};

function call(handler, method = 'GET', query = '') {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
      status(c) { this.statusCode = c; return this; },
      json(payload) { resolve({ status: this.statusCode, body: payload, headers: this.headers }); return this; },
      send(payload) { resolve({ status: this.statusCode, body: payload, headers: this.headers }); return this; }
    };
    handler({
      method,
      // Los dos handlers leen `?app=` de req.url.
      url: '/api/manifest' + query,
      headers: { host: 'olivo-liora.vercel.app', 'x-forwarded-proto': 'https' }
    }, res);
  });
}

/** Vuelve a cargar los handlers para vaciarles la memoria entre pruebas. */
function recargar() {
  delete require.cache[require.resolve('../api/app-version.js')];
  delete require.cache[require.resolve('../api/manifest.js')];
  return {
    version: require('../api/app-version.js'),
    manifest: require('../api/manifest.js')
  };
}

// --- /api/app-version -------------------------------------------------------

test('dice qué versión hay y cómo instalarla', async () => {
  publicado = RELEASE;
  const { version } = recargar();
  const r = await call(version);

  assert.equal(r.status, 200);
  assert.equal(r.body.disponible, true);
  assert.equal(r.body.build, 42);
  assert.equal(r.body.version, '1.0.0');
  assert.match(r.body.instalar, /^itms-services:\/\/\?action=download-manifest&url=/);
  // La dirección del manifest tiene que ir codificada dentro del enlace: si no,
  // iOS corta el parámetro en el primer & y se queda sin saber qué instalar.
  assert.match(r.body.instalar, /https%3A%2F%2Folivo-liora\.vercel\.app%2Finstalar%2Folivo-liora\.plist/);
  assert.ok(r.body.instalar.includes(encodeURIComponent('?app=' + KENNETH)),
    'el identificador tiene que viajar codificado dentro del enlace');
});

test('sin nada publicado no ofrece ninguna actualización', async () => {
  publicado = null;
  const { version } = recargar();
  const r = await call(version);

  assert.equal(r.status, 200, 'la app no debe ver un error, sólo "no hay nada"');
  assert.equal(r.body.disponible, false);
  assert.equal(r.body.instalar, undefined);
});

test('si GitHub se cae, no inventa una actualización', async () => {
  publicado = 'caido';
  const { version } = recargar();
  const r = await call(version);

  assert.equal(r.status, 200);
  assert.equal(r.body.disponible, false);
});

test('una publicación sin número de build se ignora', async () => {
  // Sin build no hay nada que comparar contra la versión instalada, y ofrecer
  // una actualización a ciegas puede dejarla instalando lo que ya tiene.
  for (const roto of [{ ...RELEASE, build: undefined },
                      { ...RELEASE, build: 'cuarenta y dos' },
                      { ...RELEASE, build: 0 },
                      { ...RELEASE, build: -3 }]) {
    publicado = roto;
    const { version } = recargar();
    const r = await call(version);
    assert.equal(r.body.disponible, false, `build ${JSON.stringify(roto.build)} debería descartarse`);
  }
});

test('recuerda la última versión buena si GitHub deja de contestar', async () => {
  publicado = RELEASE;
  const { version } = recargar();
  assert.equal((await call(version)).body.build, 42);

  // La misma instancia, ahora con GitHub caído: sigue sabiendo qué hay.
  publicado = 'caido';
  const r = await call(version);
  assert.equal(r.body.disponible, true);
  assert.equal(r.body.build, 42);
});

test('no vuelve a preguntar a GitHub en cada arranque de la app', async () => {
  publicado = RELEASE;
  const { version } = recargar();
  const antes = fallos;
  await call(version);
  await call(version);
  await call(version);
  assert.equal(fallos, antes, 'ninguna de las tres debería haber fallado');
  // La segunda y la tercera salen de memoria; se comprueba por el encabezado
  // de caché, que es lo que además evita que el CDN las repita.
  const r = await call(version);
  assert.match(r.headers['cache-control'], /s-maxage=300/);
});

test('sólo responde a GET', async () => {
  publicado = RELEASE;
  const { version } = recargar();
  const r = await call(version, 'POST');
  assert.equal(r.status, 405);
});

// --- el manifest que lee iOS ------------------------------------------------

test('el manifest es un plist válido y apunta al .ipa publicado', async () => {
  publicado = RELEASE;
  const { manifest } = recargar();
  const r = await call(manifest);

  assert.equal(r.status, 200);
  assert.match(r.headers['content-type'], /application\/xml/);

  const xml = r.body;
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<key>kind<\/key><string>software-package<\/string>/);
  assert.ok(xml.includes(RELEASE.ipa), 'debe apuntar al .ipa de la última release');

  // El identificador es lo único que decide si iOS actualiza la app que ella ya
  // tiene o le instala una segunda al lado.
  assert.ok(xml.includes('<string>app.gorilla3597.nadir5999</string>'));

  // Balance de etiquetas: un plist a medias deja un icono gris pegado en la
  // pantalla de inicio que no es evidente cómo quitar.
  const abre = (xml.match(/<dict>/g) || []).length;
  const cierra = (xml.match(/<\/dict>/g) || []).length;
  assert.equal(abre, cierra, 'los <dict> tienen que estar balanceados');
});

test('el & del nombre se escapa una sola vez', async () => {
  publicado = RELEASE;
  const { manifest } = recargar();
  const xml = (await call(manifest)).body;

  assert.ok(xml.includes('<string>Olivo &amp; Liora</string>'),
    'el título tiene que quedar como &amp;, ni crudo ni doblemente escapado');
  assert.ok(!xml.includes('&amp;amp;'));
});

test('sin versión publicada el manifest es un 404, no un plist vacío', async () => {
  publicado = null;
  const { manifest } = recargar();
  const r = await call(manifest);
  assert.equal(r.status, 404);
  assert.equal(r.headers['cache-control'], 'no-store');
});

test('una publicación sin ningún identificador no genera manifest', async () => {
  // Ahora hay que quitar las dos formas: la lista de apps y el campo suelto de
  // compatibilidad. Sin ninguna de las dos no se sabe qué app instalar.
  publicado = { ...RELEASE, apps: undefined, bundleId: undefined };
  const { manifest } = recargar();
  assert.equal((await call(manifest)).status, 404);

  // Y una entrada de la lista a medias tampoco cuenta.
  publicado = { ...RELEASE, apps: [{ nombre: 'Rota' }], bundleId: undefined };
  const { manifest: m2 } = recargar();
  assert.equal((await call(m2)).status, 404);
});

// --- Dos iPhones -----------------------------------------------------------
// Cada certificado de KravaSign vale para UN dispositivo. Mandarle a un
// teléfono el .ipa del otro no da un error visible aquí: da una descarga
// completa que falla justo al instalarse, en el teléfono, sin explicación.

test('cada iPhone recibe su propia app', async () => {
  publicado = RELEASE;
  const { version } = recargar();

  const kenneth = await call(version, 'GET', '?app=' + KENNETH);
  assert.equal(kenneth.body.disponible, true);
  assert.equal(kenneth.body.bundleId, KENNETH);
  assert.ok(kenneth.body.instalar.includes(encodeURIComponent('?app=' + KENNETH)));

  const camila = await call(version, 'GET', '?app=' + CAMILA);
  assert.equal(camila.body.disponible, true);
  assert.equal(camila.body.bundleId, CAMILA);
  assert.ok(camila.body.instalar.includes(encodeURIComponent('?app=' + CAMILA)));

  assert.notEqual(kenneth.body.instalar, camila.body.instalar);
});

test('a una app firmada con otro certificado no se le ofrece nada', async () => {
  // Pasa cuando se renueva un certificado: la app vieja sigue instalada con su
  // identificador de antes. Ofrecerle el .ipa de otro sería peor que no
  // ofrecerle nada — no se instalaría y ella no sabría por qué.
  publicado = RELEASE;
  const { version } = recargar();
  const r = await call(version, 'GET', '?app=app.desconocida.xyz');
  assert.equal(r.body.disponible, false);
  assert.equal(r.body.motivo, 'otra-firma');
});

test('sin decir quién eres se contesta la primera, para la página de instalación', async () => {
  publicado = RELEASE;
  const { version } = recargar();
  const r = await call(version);
  assert.equal(r.body.disponible, true);
  assert.equal(r.body.bundleId, KENNETH);
  // Y la página necesita la lista entera para poner un botón por teléfono.
  assert.equal(r.body.apps.length, 2);
  assert.deepEqual(r.body.apps.map(a => a.nombre), ['Kenneth', 'Camila']);
  assert.ok(r.body.apps.every(a => a.instalar.startsWith('itms-services://')));
});

test('una publicación vieja, sin lista de apps, se sigue entendiendo', async () => {
  publicado = RELEASE_VIEJA;
  const { version } = recargar();
  const r = await call(version, 'GET', '?app=' + KENNETH);
  assert.equal(r.body.disponible, true);
  assert.equal(r.body.bundleId, KENNETH);
});

test('el manifest de cada iPhone apunta a su propio .ipa', async () => {
  publicado = RELEASE;
  const { manifest } = recargar();

  const k = await call(manifest, 'GET', '?app=' + KENNETH);
  assert.equal(k.status, 200);
  assert.ok(k.body.includes(`<string>${KENNETH}</string>`));
  assert.ok(k.body.includes(`OlivoLiora-${KENNETH}.ipa`));
  assert.ok(!k.body.includes(CAMILA), 'no debe colarse el otro identificador');

  const c = await call(manifest, 'GET', '?app=' + CAMILA);
  assert.ok(c.body.includes(`<string>${CAMILA}</string>`));
  assert.ok(c.body.includes(`OlivoLiora-${CAMILA}.ipa`));
});

test('un manifest para una app que no está publicada es 404', async () => {
  publicado = RELEASE;
  const { manifest } = recargar();
  const r = await call(manifest, 'GET', '?app=app.desconocida.xyz');
  assert.equal(r.status, 404,
    'antes que servirle el .ipa de otro iPhone, que no le sirve, mejor nada');
});

test.after(() => { globalThis.fetch = realFetch; });
