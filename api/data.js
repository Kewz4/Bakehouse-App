/**
 * Olivo & Liora · almacén compartido
 * ===================================
 *
 * GET  /api/data           -> { enabled, doc, updatedAt }
 * GET  /api/data?desde=N   -> { sinCambios: true } si nada cambió desde N
 * PUT  /api/data           -> combina lo que llega con lo guardado y devuelve
 *                             el resultado -> { enabled, ok, doc, updatedAt }
 *
 * El PUT no sobrescribe: el servidor lee lo que hay, lo combina registro por
 * registro (ver sync-core.js) y guarda el resultado. Dos dispositivos pueden
 * escribir sin saber el uno del otro y no se pierde nada. Y como se devuelve el
 * documento combinado entero, quien escribe recibe de vuelta en el mismo viaje
 * lo que hizo el otro: un solo viaje hace subida y bajada.
 *
 * Dónde se guarda —Postgres o el Blob de Vercel— lo decide store.js. Aquí no se
 * nota la diferencia, que es justo la idea.
 */
const Sync = require('../sync-core.js');
const Store = require('../store-core.js');

function parseBody(req) {
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch (e) { return null; }
  }
  return req.body && typeof req.body === 'object' ? req.body : null;
}

/** El `?desde=` de la petición, si trae uno válido. */
function desdeCuando(req) {
  try {
    const v = new URL(req.url, 'https://olivo-liora.vercel.app').searchParams.get('desde');
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch (e) { return null; }
}

module.exports = async function handler(req, res) {

  const enabled = Store.habilitado();
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
      hint: 'No hay dónde guardar. Vercel -> Storage -> conecta una base Postgres (o un Blob).',
      // Sólo los NOMBRES de las variables, nunca sus valores. Sirve para
      // distinguir "no está conectado" de "está conectado con otro nombre",
      // que desde fuera se ven exactamente igual.
      vars: Object.keys(process.env).filter(k => /BLOB|POSTGRES|DATABASE/.test(k))
    });
  }

  try {
    if (req.method === 'GET') {
      const doc = await Store.leer();
      const actualizado = doc.updatedAt || 0;

      // La app pregunta cada 30 segundos. Casi siempre la respuesta es "nada
      // ha cambiado", y mandar el documento entero para decir eso es mandar
      // 16 kB por nada — a dos teléfonos, todo el día, con datos móviles.
      const desde = desdeCuando(req);
      if (desde && actualizado && actualizado <= desde) {
        return res.status(200).json({ enabled: true, sinCambios: true, updatedAt: actualizado });
      }

      return res.status(200).json({
        enabled: true, doc, updatedAt: actualizado, almacen: Store.almacen()
      });
    }

    if (req.method === 'PUT' || req.method === 'POST') {
      const body = parseBody(req);
      if (!body) return res.status(400).json({ error: 'Cuerpo inválido' });

      const incoming = Sync.normalizeDoc(body);
      const now = Date.now();

      try {
        const combined = await Store.combinar(incoming, now);
        return res.status(200).json({
          enabled: true,
          ok: true,
          doc: combined,
          updatedAt: combined.updatedAt,
          almacen: Store.almacen()
        });
      } catch (e) {
        if (e && e.code === 'TOO_BIG') {
          return res.status(413).json({ error: 'Demasiada información para guardar de una vez' });
        }
        if (e && e.code === 'CONFLICTO') {
          // Cinco intentos y siempre alguien escribiendo antes. No se pierde
          // nada: lo suyo sigue en el dispositivo y se reintenta al momento.
          return res.status(409).json({ error: 'Inténtalo otra vez' });
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
