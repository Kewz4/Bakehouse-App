/**
 * Subida de fotos de postres al almacenamiento de Vercel (Blob).
 *
 * GET  /api/upload  -> { enabled: true|false }   (la PWA lo consulta al abrir)
 * POST /api/upload  -> { filename, dataUrl }  →  { url }
 *
 * Si no existe la variable BLOB_READ_WRITE_TOKEN (no hay Blob Store conectado),
 * responde enabled:false y la app guarda la foto dentro del dispositivo.
 */
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

const MAX_BYTES = 4 * 1024 * 1024; // 4 MB por foto
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];

module.exports = async function handler(req, res) {
  const enabled = Boolean(blobToken());

  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ enabled });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Método no permitido' });
  }

  if (!enabled) {
    return res.status(503).json({
      error: 'Blob Store no configurado',
      hint: 'En Vercel: Storage → Create Blob Store → Connect Project. Añade BLOB_READ_WRITE_TOKEN y vuelve a desplegar.'
    });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const { filename, dataUrl } = body;

    if (!dataUrl || typeof dataUrl !== 'string') {
      return res.status(400).json({ error: 'Falta la imagen' });
    }

    const match = dataUrl.match(/^data:([\w/+.-]+);base64,(.+)$/);
    if (!match) return res.status(400).json({ error: 'Formato de imagen inválido' });

    const [, mime, b64] = match;
    if (!ALLOWED.includes(mime)) return res.status(415).json({ error: 'Tipo de imagen no permitido' });

    const buffer = Buffer.from(b64, 'base64');
    if (buffer.length > MAX_BYTES) return res.status(413).json({ error: 'La foto es demasiado grande' });

    const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
    const safe = String(filename || 'postre')
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-zA-Z0-9-_]/g, '-')
      .slice(0, 40) || 'postre';

    const { put } = await import('@vercel/blob');
    const blob = await put(`postres/${safe}-${Date.now()}.${ext}`, buffer, {
      token: blobToken(),
      access: 'public',
      contentType: mime,
      addRandomSuffix: true,
      cacheControlMaxAge: 31536000
    });

    return res.status(200).json({ url: blob.url });
  } catch (err) {
    console.error('upload error', err);
    return res.status(500).json({ error: 'No se pudo guardar la foto' });
  }
};
