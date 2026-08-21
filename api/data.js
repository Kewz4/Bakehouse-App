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

const PATHNAME = 'datos/olivo-liora.json';
const MAX_BYTES = 4 * 1024 * 1024;

// Cuántas veces reintentamos leer-combinar-guardar si dos dispositivos
// escriben en el mismo instante.
const WRITE_ATTEMPTS = 3;

async function readDoc() {
  const { list } = await import('@vercel/blob');
  const { blobs } = await list({ prefix: PATHNAME, limit: 1, token: blobToken() });
  if (!blobs.length) return Sync.emptyDoc();

  const r = await fetch(blobs[0].url + '?t=' + Date.now(), { cache: 'no-store' });
  if (!r.ok) return Sync.emptyDoc();

  try {
    return Sync.normalizeDoc(await r.json());
  } catch (e) {
    // Un blob corrupto no debe tumbar la app: arrancamos de cero en memoria
    // pero no lo sobrescribimos hasta que llegue una escritura real.
    console.error('blob ilegible', e);
    return Sync.emptyDoc();
  }
}

async function writeDoc(doc) {
  const payload = JSON.stringify(doc);
  if (Buffer.byteLength(payload) > MAX_BYTES) {
    const err = new Error('demasiado grande');
    err.code = 'TOO_BIG';
    throw err;
  }
  const { put } = await import('@vercel/blob');
  await put(PATHNAME, payload, {
    token: blobToken(),
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0
  });
  return doc;
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
      const doc = await readDoc();
      return res.status(200).json({ enabled: true, doc, updatedAt: doc.updatedAt || 0 });
    }

    if (req.method === 'PUT' || req.method === 'POST') {
      const body = parseBody(req);
      if (!body) return res.status(400).json({ error: 'Cuerpo inválido' });

      const incoming = Sync.normalizeDoc(body);
      const now = Date.now();
      let merged = null;
      let lastErr = null;

      for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt++) {
        try {
          const stored = await readDoc();
          merged = Sync.mergeDocs(stored, incoming);
          merged.updatedAt = now;
          Sync.purgeTombstones(merged, now);
          await writeDoc(merged);

          // Releemos para confirmar que lo nuestro quedó. Si otro dispositivo
          // escribió justo entre nuestro read y nuestro write, su versión pisó
          // la nuestra: lo detectamos aquí y repetimos la combinación.
          const verify = await readDoc();
          if (Sync.contains(verify, incoming)) {
            merged = verify;
            break;
          }
          lastErr = new Error('carrera de escritura');
        } catch (e) {
          if (e && e.code === 'TOO_BIG') {
            return res.status(413).json({ error: 'Demasiada información para guardar de una vez' });
          }
          lastErr = e;
        }
      }

      if (!merged) throw lastErr || new Error('no se pudo guardar');

      return res.status(200).json({
        enabled: true,
        ok: true,
        doc: merged,
        updatedAt: merged.updatedAt
      });
    }

    res.setHeader('Allow', 'GET, PUT, POST, OPTIONS');
    return res.status(405).json({ error: 'Método no permitido' });
  } catch (err) {
    console.error('data error', err);
    return res.status(500).json({ error: 'No se pudo guardar' });
  }
};
