/**
 * Olivo & Liora · el archivo que hace que el iPhone instale la app
 * ================================================================
 *
 * GET /instalar/olivo-liora.plist?app=<identificador>
 *
 * iOS no instala un .ipa directamente: instala un "manifest", un XML que le
 * dice de dónde bajarse la app, cómo se llama y qué identificador tiene. El
 * enlace `itms-services://` que abre la app apunta aquí.
 *
 * El parámetro dice para qué iPhone. Cada certificado de KravaSign vale para
 * uno solo, así que hay un .ipa por teléfono y darle a uno el del otro produce
 * una descarga completa que falla justo al instalarse.
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

/** La variante que toca, o null si no hay ninguna que sirva. */
function elegir(info, pedido) {
  if (!info) return null;
  const lista = (Array.isArray(info.apps) ? info.apps : [])
    .filter(a => a && typeof a.bundleId === 'string' && typeof a.ipa === 'string');

  // Una Release anterior a que hubiera varias variantes.
  if (!lista.length && typeof info.bundleId === 'string') {
    lista.push({ bundleId: info.bundleId, ipa: info.ipa || IPA_URL });
  }
  if (!lista.length) return null;

  // Sin parámetro se sirve la primera: es lo que pide la página de instalación
  // y lo que hacía la versión anterior de esta dirección.
  if (!pedido) return lista[0];
  // Con parámetro, sólo la que coincide. Nunca "la que más se parezca": un
  // .ipa firmado para otro iPhone no se instala, y el error aparece después de
  // haberla bajado entera.
  return lista.find(a => a.bundleId === pedido) || null;
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
  const variante = elegir(info, new URL(req.url, 'https://olivo-liora.vercel.app')
    .searchParams.get('app'));

  if (!variante) {
    // Sin una versión publicada no hay nada que instalar. Se contesta 404 y no
    // un manifest a medias: iOS con un manifest inválido se queda con un icono
    // gris pegado en la pantalla de inicio, y quitarlo no es evidente.
    res.setHeader('Cache-Control', 'no-store');
    return res.status(404).send('Todavía no hay ninguna versión publicada.');
  }

  const titulo = (info && info.title) || 'Olivo & Liora';
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
          <key>url</key><string>${xml(variante.ipa)}</string>
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
        <key>bundle-identifier</key><string>${xml(variante.bundleId)}</string>
        <key>bundle-version</key><string>${xml((info && info.version) || '1.0.0')}</string>
        <key>kind</key><string>software</string>
        <key>title</key><string>${xml(titulo)}</string>
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
