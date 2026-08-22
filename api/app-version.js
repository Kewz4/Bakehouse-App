/**
 * Olivo & Liora · qué versión de la app hay publicada
 * ===================================================
 *
 * GET /api/app-version?app=<identificador> -> { disponible, build, instalar }
 *
 * La app del iPhone pregunta esto al abrir y al volver del fondo. Si el número
 * de build que hay aquí es mayor que el suyo, enseña un botón "Actualizar" y ya.
 * Ella nunca ve un número de versión ni tiene que ir a ningún sitio a buscarla.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ HAY QUE DECIR QUÉ APP ERES
 * ---------------------------------------------------------------------------
 * Cada certificado de KravaSign vale para UN iPhone y trae su propio
 * identificador de app. Con dos teléfonos hay dos .ipa distintos publicados, y
 * mandarle a uno el del otro no es un detalle: un perfil ad-hoc sólo instala en
 * los dispositivos que lleva dentro, así que la actualización se bajaría entera
 * y fallaría al final, en el teléfono, sin decir por qué.
 *
 * La app manda su propio identificador, que se conoce a sí misma. Sin el
 * parámetro se contesta la primera variante, que es lo que necesita la página
 * de instalación y lo que hacía la versión anterior.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ NO SE USA LA API DE GITHUB
 * ---------------------------------------------------------------------------
 * GitHub sirve `releases/latest/download/<archivo>` como una redirección a la
 * última publicación. Es una dirección fija, pública y sin límite de peticiones,
 * mientras que la API de GitHub sin credenciales corta a las 60 por hora y por
 * IP — y las IP de Vercel son compartidas, así que ese límite se agota con el
 * tráfico de cualquier otro. Aquí no hay ninguna llave guardada.
 */

const REPO = process.env.GITHUB_REPO || 'Kewz4/Bakehouse-App';
const VERSION_URL = `https://github.com/${REPO}/releases/latest/download/version.json`;
const TIMEOUT_MS = 8000;

// Entre invocaciones calientes la función se reutiliza, así que basta con
// recordar la última respuesta buena. Sirve para dos cosas: no golpear a GitHub
// en cada arranque de la app, y tener algo que contestar si GitHub falla.
let cache = { at: 0, value: null };
const FRESH_MS = 5 * 60 * 1000;

/** Las variantes publicadas, una por iPhone. */
function normalizeApps(raw) {
  const lista = Array.isArray(raw && raw.apps) ? raw.apps : [];
  const apps = lista
    .filter(a => a && typeof a.bundleId === 'string' && typeof a.ipa === 'string')
    .map(a => ({
      bundleId: a.bundleId,
      ipa: a.ipa,
      nombre: typeof a.nombre === 'string' ? a.nombre : 'este iPhone'
    }));
  if (apps.length) return apps;

  // Una Release de antes de que hubiera varias variantes.
  if (raw && typeof raw.bundleId === 'string' && typeof raw.ipa === 'string') {
    return [{ bundleId: raw.bundleId, ipa: raw.ipa, nombre: 'este iPhone' }];
  }
  return [];
}
async function fetchLatest() {
  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(VERSION_URL, {
      redirect: 'follow',
      signal: control.signal,
      headers: { accept: 'application/json' }
    });
    if (!r.ok) return null;
    const raw = await r.json();
    const build = Number(raw && raw.build);
    // Sin un build numérico no hay nada que comparar, y ofrecer una
    // actualización que no se puede comprobar es peor que no ofrecer ninguna.
    if (!Number.isFinite(build) || build <= 0) return null;

    const apps = normalizeApps(raw);
    if (!apps.length) return null;

    return {
      build,
      version: typeof raw.version === 'string' ? raw.version : null,
      publishedAt: typeof raw.publishedAt === 'string' ? raw.publishedAt : null,
      apps
    };
  } catch (err) {
    console.error('app-version', err && err.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function latest() {
  const now = Date.now();
  if (cache.value && now - cache.at < FRESH_MS) return cache.value;
  const fresh = await fetchLatest();
  if (fresh) cache = { at: now, value: fresh };
  return fresh || cache.value;
}

function originOf(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${host}`;
}

/** La dirección que instala la app. iOS la reconoce y hace el resto solo. */
function installURL(req, bundleId) {
  const manifest = `${originOf(req)}/instalar/olivo-liora.plist`
    + `?app=${encodeURIComponent(bundleId)}`;
  return `itms-services://?action=download-manifest&url=${encodeURIComponent(manifest)}`;
}

module.exports = async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).json({ error: 'Sólo GET.' });
  }

  // Cinco minutos en el CDN: suficiente para que una publicación se note casi
  // enseguida sin que cada arranque de la app llegue hasta GitHub.
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');

  const info = await latest();
  if (!info) {
    // Todavía no hay ninguna versión publicada, o GitHub no contestó. La app lo
    // lee como "no hay nada nuevo" y no enseña nada. Es la respuesta correcta:
    // más vale no ofrecer una actualización que ofrecer una que no existe.
    return res.status(200).json({ disponible: false });
  }

  // La app dice quién es; si no lo dice, se contesta la primera variante.
  const pedido = new URL(req.url, 'https://olivo-liora.vercel.app')
    .searchParams.get('app');
  const app = (pedido && info.apps.find(a => a.bundleId === pedido)) || null;

  if (pedido && !app) {
    // Ese identificador no está publicado. Podría ser una app firmada con un
    // certificado que ya no se usa: no hay nada que ofrecerle, y ofrecerle el
    // .ipa de otro teléfono sería peor — no se instalaría.
    return res.status(200).json({ disponible: false, motivo: 'otra-firma' });
  }

  const elegida = app || info.apps[0];
  return res.status(200).json({
    disponible: true,
    build: info.build,
    version: info.version,
    bundleId: elegida.bundleId,
    publicadoEl: info.publishedAt,
    instalar: installURL(req, elegida.bundleId),
    // Para la página de instalación, que tiene que enseñar un botón por iPhone
    // porque en la primera instalación todavía no hay app que se identifique.
    apps: info.apps.map(a => ({
      nombre: a.nombre,
      bundleId: a.bundleId,
      instalar: installURL(req, a.bundleId)
    }))
  });
};
