/**
 * Olivo & Liora · almacén compartido
 * ===================================
 *
 * GET  /api/data  -> { enabled, doc, updatedAt }
 * PUT  /api/data  -> recibe un documento, lo COMBINA con el guardado y
 *                    devuelve el resultado -> { enabled, ok, doc, updatedAt }
 *
 * La diferencia importante con la versión anterior: el PUT ya no sobrescribe.
 * Antes, el último dispositivo en escribir borraba el trabajo del otro. Ahora
 * el servidor lee lo que hay, lo combina registro por registro (ver
 * sync-core.js) y guarda el resultado. Dos dispositivos pueden escribir sin
 * saber el uno del otro y no se pierde nada.
 *
 * Como respuesta siempre devolvemos el documento combinado completo, así el
 * dispositivo que escribe recibe de vuelta, en el mismo viaje, lo que hizo el
 * otro. Un solo round-trip hace subida y bajada.
 *
 * Si no hay Blob Store conectado (falta BLOB_READ_WRITE_TOKEN) respondemos
 * enabled:false. La app sigue funcionando con lo guardado en el dispositivo y
 * no le muestra nada raro a quien la usa.
 */
const Sync = require('../sync-core.js');

/**
 * Busca el token del Blob Store.
 *
 * Normalmente Vercel lo llama `BLOB_READ_WRITE_TOKEN`, pero al conectar un
 * store se le puede poner un prefijo y entonces queda como
 * `MITIENDA_BLOB_READ_WRITE_TOKEN`. Aceptar cualquiera de las dos formas evita
 * el caso más tonto de "está conectado y aun así dice que no".
 */
function blobToken() {
  if (process.env.BLOB_READ_WRITE_TOKEN) return process.env.BLOB_READ_WRITE_TOKEN;
  const key = Object.keys(process.env).find(k => k.endsWith('BLOB_READ_WRITE_TOKEN'));
  return key ? process.env[key] : null;
}

// Cada escritura crea un objeto NUEVO bajo este prefijo; ninguno se sobrescribe
// jamás. Leer es juntar todos y combinarlos.
//
// ---------------------------------------------------------------------------
// POR QUÉ NO UN SOLO ARCHIVO QUE SE PISA
// ---------------------------------------------------------------------------
// Se probó y falla en producción. Un blob público se sirve desde el CDN, y al
// sobrescribirlo la URL no cambia: una lectura puede devolver una copia vieja
// (se midieron 33 segundos de retraso). Con leer-combinar-guardar sobre un
// archivo único, eso significa combinar contra datos viejos y **perder** lo que
// otro dispositivo acababa de escribir. Ni el cache-buster `?t=` ni
// `cacheControlMaxAge: 0` lo evitan, y la re-lectura de verificación pasa por el
// mismo camino, así que tampoco lo detecta.
//
// Escribiendo objetos nuevos el problema desaparece: cada URL es inmutable, así
// que el CDN puede cachearla todo lo que quiera. Y si el listado va atrasado y
// no vemos el objeto de otro dispositivo, no se pierde nada — sigue ahí y entra
// en la próxima lectura. Esto se apoya en que combinar es conmutativo,
// asociativo e idempotente (ver sync-core.js): juntar los mismos trozos en
// cualquier orden, y más de una vez, da el mismo resultado.
const PREFIX = 'datos/olivo-liora';
const MAX_BYTES = 4 * 1024 * 1024;

// Si se juntan muchos trozos, se leen los más recientes. Sólo se borran los que
// de verdad se combinaron, así que nunca se descarta algo sin haberlo guardado.
const MAX_PARTS = 24;

async function listParts() {
  const { list } = await import('@vercel/blob');
  const { blobs } = await list({ prefix: PREFIX, token: blobToken(), limit: 100 });
  // Más nuevos primero.
  return blobs.slice().sort((a, b) =>
    new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0));
}

/** Lee todos los trozos y los combina en un solo documento. */
async function readDoc() {
  const parts = (await listParts()).slice(0, MAX_PARTS);
  if (!parts.length) return { doc: Sync.emptyDoc(), merged: [] };

  const bodies = await Promise.all(parts.map(async (b) => {
    try {
      // La URL es inmutable, así que da igual que venga del CDN.
      const r = await fetch(b.url);
      if (!r.ok) return null;
      return await r.json();
    } catch (e) {
      return null;
    }
  }));

  let doc = Sync.emptyDoc();
  const merged = [];
  bodies.forEach((body, i) => {
    if (!body) return;
    doc = Sync.mergeDocs(doc, body);
    merged.push(parts[i].url);
  });
  return { doc, merged };
}

/** Escribe un trozo nuevo. Nunca pisa nada. */
async function writePart(doc) {
  const payload = JSON.stringify(doc);
  if (Buffer.byteLength(payload) > MAX_BYTES) {
    const err = new Error('demasiado grande');
    err.code = 'TOO_BIG';
    throw err;
  }
  const { put } = await import('@vercel/blob');
  await put(PREFIX + '.json', payload, {
    token: blobToken(),
    access: 'public',
    contentType: 'application/json',
    // La clave de todo: sufijo aleatorio, así cada escritura es un objeto nuevo
    // con su propia URL inmutable.
    addRandomSuffix: true,
    cacheControlMaxAge: 31536000
  });
}

/**
 * Borra los trozos que ya quedaron guardados dentro del nuevo.
 *
 * Sólo se borran los que se leyeron y combinaron en esta misma operación: si
 * otro dispositivo escribió un trozo mientras tanto, no estaba en la lista y no
 * se toca. Si dos servidores hacen esto a la vez, los dos escriben un trozo
 * completo y los dos borran los mismos viejos: borrar es idempotente y el
 * resultado sigue siendo correcto.
 */
async function compact(urls) {
  if (!urls.length) return;
  try {
    const { del } = await import('@vercel/blob');
    await del(urls, { token: blobToken() });
  } catch (e) {
    // Que falle limpiar no es grave: sobra un trozo y se combinará igual.
    console.error('compactación', e && e.message);
  }
}

function parseBody(req) {
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch (e) { return null; }
  }
  return req.body && typeof req.body === 'object' ? req.body : null;
}

module.exports = async function handler(req, res) {
  const enabled = Boolean(blobToken());
  res.setHeader('Cache-Control', 'no-store');

  // La app de iPhone habla con este mismo endpoint.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (!enabled) {
    // Sin almacén conectado. No es un error para la usuaria: la app guarda en
    // el dispositivo. Devolvemos 200 para que el cliente no lo trate como caída.
    return res.status(200).json({
      enabled: false,
      doc: null,
      updatedAt: 0,
      hint: 'Falta BLOB_READ_WRITE_TOKEN. Vercel -> Storage -> Blob -> Connect Project.',
      // Sólo los NOMBRES de las variables que mencionan BLOB, nunca sus valores.
      // Sirve para distinguir "no está conectado" de "está conectado con otro
      // nombre", que desde fuera se ven exactamente igual.
      blobVars: Object.keys(process.env).filter(k => k.includes('BLOB'))
    });
  }

  try {
    if (req.method === 'GET') {
      const { doc } = await readDoc();
      return res.status(200).json({ enabled: true, doc, updatedAt: doc.updatedAt || 0 });
    }

    if (req.method === 'PUT' || req.method === 'POST') {
      const body = parseBody(req);
      if (!body) return res.status(400).json({ error: 'Cuerpo inválido' });

      const incoming = Sync.normalizeDoc(body);
      const now = Date.now();

      try {
        const { doc: stored, merged } = await readDoc();
        const combined = Sync.mergeDocs(stored, incoming);
        combined.updatedAt = now;
        Sync.purgeTombstones(combined, now);

        await writePart(combined);
        // Ya está todo dentro del trozo nuevo: los viejos sobran.
        await compact(merged);

        return res.status(200).json({
          enabled: true,
          ok: true,
          doc: combined,
          updatedAt: combined.updatedAt
        });
      } catch (e) {
        if (e && e.code === 'TOO_BIG') {
          return res.status(413).json({ error: 'Demasiada información para guardar de una vez' });
        }
        throw e;
      }
    }

    res.setHeader('Allow', 'GET, PUT, POST, OPTIONS');
    return res.status(405).json({ error: 'Método no permitido' });
  } catch (err) {
    console.error('data error', err);
    return res.status(500).json({ error: 'No se pudo guardar' });
  }
};
