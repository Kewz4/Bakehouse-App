/**
 * Olivo & Liora · dónde viven los datos
 * =====================================
 *
 * Dos almacenes detrás de la misma puerta:
 *
 *   1. Una base de datos Postgres, si hay `DATABASE_URL` (o `POSTGRES_URL`).
 *   2. El Blob de Vercel, si no la hay.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ SE MUDA
 * ---------------------------------------------------------------------------
 * El Blob cobra por OPERACIÓN, y leer cuesta una: cada lectura hace un `list()`
 * del almacén. La app pregunta cada 30 segundos mientras está abierta, desde
 * dos teléfonos y desde la web — son miles de operaciones al mes sin que nadie
 * haya tocado nada. Ese es el límite que estaba a punto de llegar, no el
 * espacio: los datos enteros ocupan 16 kB.
 *
 * En Postgres leer es una consulta y no se cobra por operación.
 *
 * ---------------------------------------------------------------------------
 * Y POR QUÉ ADEMÁS QUEDA MÁS SIMPLE
 * ---------------------------------------------------------------------------
 * Los trozos que nunca se pisan existían por una sola razón: un blob público se
 * sirve desde el CDN, y al sobrescribirlo la URL no cambia, así que una lectura
 * podía devolver una copia vieja (se midieron 33 segundos de retraso) y
 * combinar contra datos viejos PERDÍA lo que el otro teléfono acababa de
 * escribir.
 *
 * Postgres no tiene ese problema: lo que se acaba de escribir es lo que se lee.
 * Así que aquí no hay trozos, ni compactación, ni URLs inmutables — hay una
 * fila. Contra la carrera de dos teléfonos escribiendo a la vez se usa un
 * "comparar y cambiar": se guarda sólo si nadie tocó la fila mientras tanto, y
 * si alguien la tocó se vuelve a leer y se combina otra vez. Combinar es
 * conmutativo, asociativo e idempotente (ver sync-core.js), así que reintentar
 * siempre da el resultado correcto.
 *
 * ---------------------------------------------------------------------------
 * LA MUDANZA
 * ---------------------------------------------------------------------------
 * No hay que hacer nada a mano. La primera vez que se lee con la base conectada
 * y todavía vacía, se traen los datos del Blob y se guardan. Es seguro
 * repetirlo: combinar dos veces lo mismo da lo mismo.
 */
const Sync = require('./sync-core.js');

const DOC_ID = 'olivo-liora';

// ---------------------------------------------------------------------------
// Postgres
// ---------------------------------------------------------------------------

/**
 * La cadena de conexión, se llame como se llame.
 *
 * Vercel la pone con nombres distintos según de dónde venga la base (Neon,
 * Supabase, una propia), y aceptar cualquiera evita el caso más tonto: está
 * conectada y aun así la app dice que no hay base.
 */
function urlPostgres() {
  const nombres = ['DATABASE_URL', 'POSTGRES_URL', 'POSTGRES_PRISMA_URL',
                   'POSTGRES_URL_NON_POOLING', 'NEON_DATABASE_URL'];
  for (const n of nombres) if (process.env[n]) return process.env[n];
  const otra = Object.keys(process.env).find(k => /^(POSTGRES|DATABASE)_.*URL$/.test(k));
  return otra ? process.env[otra] : null;
}

const hayPostgres = () => Boolean(urlPostgres());

// Una sola conexión por instancia: estas funciones se despiertan, hacen una
// consulta y se duermen. Abrir un pool grande sería pedirle a la base cien
// conexiones para dos personas.
let pool;
async function db() {
  if (pool) return pool;
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: urlPostgres(),
    max: 1,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 8000,
    ssl: comoDeTls(urlPostgres())
  });
  return pool;
}

/**
 * Si hablar por TLS o no.
 *
 * Los Postgres alojados (Neon, Supabase) lo exigen, y traen certificados que el
 * entorno de la función no siempre tiene en su lista — por eso no se verifica
 * la cadena. Pero uno local no habla TLS en absoluto, y pedírselo no da un
 * aviso: da un error seco de conexión. Así que se mira la dirección.
 */
function comoDeTls(url) {
  try {
    const u = new URL(url);
    const modo = u.searchParams.get('sslmode');
    if (modo === 'disable') return false;
    const local = ['localhost', '127.0.0.1', '::1', ''].includes(u.hostname);
    if (local && modo !== 'require') return false;
    return { rejectUnauthorized: false };
  } catch (e) {
    return { rejectUnauthorized: false };
  }
}

let tablaLista = false;
async function prepararTabla() {
  if (tablaLista) return;
  const c = await db();
  await c.query(`
    create table if not exists documento (
      id          text primary key,
      doc         jsonb  not null,
      version     bigint not null default 0,
      updated_at  bigint not null default 0
    )`);
  tablaLista = true;
}

/** Lee la fila. Devuelve el documento vacío si todavía no existe. */
async function leerPostgres() {
  await prepararTabla();
  const c = await db();
  const { rows } = await c.query(
    'select doc, version from documento where id = $1', [DOC_ID]);
  if (!rows.length) return { doc: Sync.emptyDoc(), version: 0, existe: false };
  return { doc: Sync.normalizeDoc(rows[0].doc), version: Number(rows[0].version), existe: true };
}

/**
 * Combina lo que llega con lo guardado y lo escribe, sin pisar a nadie.
 *
 * Si otro teléfono escribió entre la lectura y la escritura, la versión ya no
 * coincide, no se guarda nada y se vuelve a empezar. Se reintenta unas cuantas
 * veces; combinar es idempotente, así que repetir no ensucia nada.
 */
async function combinarPostgres(entrante, ahora) {
  await prepararTabla();
  const c = await db();

  for (let intento = 0; intento < 5; intento++) {
    const { doc: guardado, version } = await leerPostgres();
    const combinado = Sync.mergeDocs(guardado, entrante);
    combinado.updatedAt = ahora;
    Sync.purgeTombstones(combinado, ahora);

    const { rowCount } = await c.query(`
      insert into documento (id, doc, version, updated_at)
      values ($1, $2, 1, $3)
      on conflict (id) do update
        set doc = $2, version = documento.version + 1, updated_at = $3
        where documento.version = $4`,
      [DOC_ID, JSON.stringify(combinado), ahora, version]);

    if (rowCount === 1) return combinado;
    // Alguien se nos adelantó: se vuelve a leer y se combina sobre lo suyo.
  }
  const err = new Error('demasiados intentos');
  err.code = 'CONFLICTO';
  throw err;
}

// ---------------------------------------------------------------------------
// Blob (lo de antes, ahora sólo como respaldo y como origen de la mudanza)
// ---------------------------------------------------------------------------

function tokenBlob() {
  if (process.env.BLOB_READ_WRITE_TOKEN) return process.env.BLOB_READ_WRITE_TOKEN;
  const k = Object.keys(process.env).find(x => x.endsWith('BLOB_READ_WRITE_TOKEN'));
  return k ? process.env[k] : null;
}

const hayBlob = () => Boolean(tokenBlob());

const PREFIX = 'datos/olivo-liora';
const MAX_PARTS = 24;
const MAX_BYTES = 4 * 1024 * 1024;

async function trozos() {
  const { list } = await import('@vercel/blob');
  const { blobs } = await list({ prefix: PREFIX, token: tokenBlob(), limit: 100 });
  return blobs.slice().sort((a, b) =>
    new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0));
}

async function leerBlob() {
  const partes = (await trozos()).slice(0, MAX_PARTS);
  if (!partes.length) return { doc: Sync.emptyDoc(), merged: [] };

  const cuerpos = await Promise.all(partes.map(async (b) => {
    try {
      const r = await fetch(b.url);          // la URL es inmutable
      return r.ok ? await r.json() : null;
    } catch (e) { return null; }
  }));

  let doc = Sync.emptyDoc();
  const merged = [];
  cuerpos.forEach((cuerpo, i) => {
    if (!cuerpo) return;
    doc = Sync.mergeDocs(doc, cuerpo);
    merged.push(partes[i].url);
  });
  return { doc, merged };
}

async function escribirBlob(doc) {
  const payload = JSON.stringify(doc);
  if (Buffer.byteLength(payload) > MAX_BYTES) {
    const err = new Error('demasiado grande');
    err.code = 'TOO_BIG';
    throw err;
  }
  const { put } = await import('@vercel/blob');
  await put(PREFIX + '.json', payload, {
    token: tokenBlob(), access: 'public', contentType: 'application/json',
    addRandomSuffix: true, cacheControlMaxAge: 31536000
  });
}

async function compactarBlob(urls) {
  if (!urls.length) return;
  try {
    const { del } = await import('@vercel/blob');
    await del(urls, { token: tokenBlob() });
  } catch (e) {
    console.error('compactación', e && e.message);
  }
}

// ---------------------------------------------------------------------------
// La puerta común
// ---------------------------------------------------------------------------

/**
 * Trae los datos del Blob la primera vez, y sólo la primera vez.
 *
 * Se hace sola al leer: él conecta la base y en la siguiente sincronización los
 * datos ya están dentro, sin tocar nada. Sólo ocurre con la fila vacía, así que
 * no puede pisar nada escrito después. Y si el Blob falla, no pasa nada grave:
 * se sigue con la base vacía y se reintenta a la próxima.
 */
// Una vez comprobado que la fila existe, no hace falta volver a mirar: la fila
// no se borra sola. Sin esto, CADA lectura consultaba la base dos veces —una
// para preguntar si hacía falta mudarse y otra para leer— y la mitad sobraba.
let yaMudado = false;

async function mudarSiHaceFalta() {
  if (yaMudado || !hayBlob()) return { mudado: false, motivo: 'sin-blob' };
  const actual = await leerPostgres();
  // Ojo con el orden: esto sale ANTES de tocar el Blob. Una vez mudados los
  // datos, el Blob no se vuelve a leer nunca, que es justo el punto de mudarse.
  if (actual.existe) { yaMudado = true; return { mudado: false, motivo: 'ya-estaba' }; }

  try {
    const { doc } = await leerBlob();
    const cuantos = Sync.COLLECTIONS.reduce((n, k) => n + (doc[k] || []).length, 0);
    if (!cuantos) return { mudado: false, motivo: 'blob-vacio' };

    await combinarPostgres(doc, doc.updatedAt || Date.now());
    yaMudado = true;
    console.log('mudanza: %d registros del Blob a Postgres', cuantos);
    return { mudado: true, registros: cuantos };
  } catch (e) {
    console.error('mudanza fallida', e && e.message);
    return { mudado: false, motivo: 'error', error: e && e.message };
  }
}

/** ¿Hay dónde guardar? */
const habilitado = () => hayPostgres() || hayBlob();

/** En qué almacén estamos. Sirve para diagnosticar sin adivinar. */
const almacen = () => (hayPostgres() ? 'postgres' : (hayBlob() ? 'blob' : 'ninguno'));

async function leer() {
  if (hayPostgres()) {
    await mudarSiHaceFalta();
    const { doc } = await leerPostgres();
    return doc;
  }
  const { doc } = await leerBlob();
  return doc;
}

async function combinar(entrante, ahora) {
  if (hayPostgres()) {
    await mudarSiHaceFalta();
    return combinarPostgres(entrante, ahora);
  }
  const { doc: guardado, merged } = await leerBlob();
  const combinado = Sync.mergeDocs(guardado, entrante);
  combinado.updatedAt = ahora;
  Sync.purgeTombstones(combinado, ahora);
  await escribirBlob(combinado);
  await compactarBlob(merged);
  return combinado;
}

/** Cierra la conexión. Sólo hace falta en las pruebas, para que el proceso
 *  pueda terminar; en la nube la instancia se duerme sola. */
async function cerrar() {
  if (pool) { await pool.end(); pool = null; tablaLista = false; yaMudado = false; }
}

module.exports = {
  habilitado, almacen, leer, combinar, cerrar,
  mudarSiHaceFalta, leerBlob, leerPostgres, hayPostgres, hayBlob
};
