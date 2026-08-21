/**
 * Olivo & Liora · el archivo que hace que el iPhone instale la app
 * ================================================================
 *
 * GET /instalar/olivo-liora.plist
 *
 * iOS no instala un .ipa directamente: instala un "manifest", un XML que le
 * dice de dónde bajarse la app, cómo se llama y qué identificador tiene. El
 * enlace `itms-services://` que abre la app apunta aquí.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ EL MANIFEST SE SIRVE DESDE AQUÍ Y EL .IPA DESDE GITHUB
 * ---------------------------------------------------------------------------
 * El .ipa es grande y GitHub ya lo sirve bien; el proceso que lo descarga sigue
 * redirecciones sin problema. El manifest, en cambio, lo lee un proceso del
 * sistema bastante quisquilloso: se le da directo, con su tipo de contenido
 * correcto y sin saltos de por medio.
 */

const REPO = process.env.GITHUB_REPO || 'Kewz4/Bakehouse-App';
const BASE = `https://github.com/${REPO}/releases/latest/download`;
const VERSION_URL = `${BASE}/version.json`;
const IPA_URL = `${BASE}/OlivoLiora.ipa`;
const TIMEOUT_MS = 8000;

// El icono que iOS enseña mientras la app se está instalando.
const ICON_URL = '/icon-512.png';

/** Escapa lo que va dentro de una etiqueta XML. */
function xml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function latest() {
  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(VERSION_URL, { redirect: 'follow', signal: control.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch (err) {
    console.error('manifest', err && err.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function originOf(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${host}`;
}

module.exports = async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).send('Sólo GET.');
  }

  const info = await latest();
  if (!info || !info.bundleId) {
    // Sin una versión publicada no hay nada que instalar. Se contesta 404 y no
    // un manifest a medias: iOS con un manifest inválido se queda con un icono
    // gris pegado en la pantalla de inicio, y quitarlo no es evidente.
    res.setHeader('Cache-Control', 'no-store');
    return res.status(404).send('Todavía no hay ninguna versión publicada.');
  }

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>items</key>
  <array>
    <dict>
      <key>assets</key>
      <array>
        <dict>
          <key>kind</key><string>software-package</string>
          <key>url</key><string>${xml(info.ipa || IPA_URL)}</string>
        </dict>
        <dict>
          <key>kind</key><string>display-image</string>
          <key>needs-shine</key><false/>
          <key>url</key><string>${xml(originOf(req) + ICON_URL)}</string>
        </dict>
        <dict>
          <key>kind</key><string>full-size-image</string>
          <key>needs-shine</key><false/>
          <key>url</key><string>${xml(originOf(req) + ICON_URL)}</string>
        </dict>
      </array>
      <key>metadata</key>
      <dict>
        <key>bundle-identifier</key><string>${xml(info.bundleId)}</string>
        <key>bundle-version</key><string>${xml(info.version || '1.0.0')}</string>
        <key>kind</key><string>software</string>
        <key>title</key><string>${xml(info.title || 'Olivo & Liora')}</string>
      </dict>
    </dict>
  </array>
</dict>
</plist>
`;

  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
  return res.status(200).send(plist);
};
