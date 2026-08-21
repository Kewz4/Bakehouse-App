/**
 * Guardado automático de toda la información de la app.
 *
 * GET  /api/data  -> { enabled, data, updatedAt }
 * PUT  /api/data  -> guarda el documento completo  -> { ok, updatedAt }
 *
 * Usa el almacenamiento de Vercel (Blob). Si no hay Blob Store conectado
 * responde enabled:false y la app sigue funcionando con lo guardado en el
 * teléfono, sin mostrarle nada raro a quien la usa.
 */
const PATHNAME = 'datos/olivo-liora.json';
const MAX_BYTES = 4 * 1024 * 1024;

async function blobUrl() {
  const { list } = await import('@vercel/blob');
  const { blobs } = await list({ prefix: PATHNAME, limit: 1 });
  return blobs.length ? blobs[0].url : null;
}

module.exports = async function handler(req, res) {
  const enabled = Boolean(process.env.BLOB_READ_WRITE_TOKEN);
  res.setHeader('Cache-Control', 'no-store');

  if (!enabled) {
    if (req.method === 'GET') return res.status(200).json({ enabled: false });
    return res.status(503).json({ enabled: false, error: 'Almacenamiento no configurado' });
  }

  try {
    if (req.method === 'GET') {
      const url = await blobUrl();
      if (!url) return res.status(200).json({ enabled: true, data: null, updatedAt: 0 });

      const r = await fetch(url + '?t=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) return res.status(200).json({ enabled: true, data: null, updatedAt: 0 });

      const doc = await r.json();
      return res.status(200).json({ enabled: true, data: doc, updatedAt: doc.updatedAt || 0 });
    }

    if (req.method === 'PUT' || req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
      if (!body || typeof body !== 'object' || !Array.isArray(body.recipes)) {
        return res.status(400).json({ error: 'Datos inválidos' });
      }

      const doc = {
        ingredients: body.ingredients || [],
        recipes: body.recipes || [],
        sales: body.sales || [],
        expenses: body.expenses || [],
        updatedAt: Date.now()
      };

      const payload = JSON.stringify(doc);
      if (Buffer.byteLength(payload) > MAX_BYTES) {
        return res.status(413).json({ error: 'Demasiada información' });
      }

      const { put } = await import('@vercel/blob');
      await put(PATHNAME, payload, {
        access: 'public',
        contentType: 'application/json',
        addRandomSuffix: false,
        allowOverwrite: true,
        cacheControlMaxAge: 0
      });

      return res.status(200).json({ ok: true, updatedAt: doc.updatedAt });
    }

    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ error: 'Método no permitido' });
  } catch (err) {
    console.error('data error', err);
    return res.status(500).json({ error: 'No se pudo guardar' });
  }
};
