/**
 * Servidor de desarrollo: sirve la PWA y una versión en memoria de /api/data
 * con exactamente la misma lógica de combinación que usa Vercel.
 *
 *   node test/dev-server.js [puerto]
 *
 * Sirve para probar la sincronización de verdad, con dos navegadores abiertos,
 * sin necesidad de tener un Blob Store conectado.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const Sync = require('../sync-core.js');

const ROOT = path.join(__dirname, '..');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json'
};

function createServer(options) {
  const opts = options || {};
  // `enabled:false` simula un despliegue sin Blob Store conectado.
  const state = { doc: Sync.emptyDoc(), enabled: opts.enabled !== false, writes: 0, uploads: 0, scans: 0 };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');

    if (url.pathname === '/api/data') {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Access-Control-Allow-Origin', '*');

      if (!state.enabled) {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ enabled: false, doc: null, updatedAt: 0 }));
      }

      if (req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ enabled: true, doc: state.doc, updatedAt: state.doc.updatedAt }));
      }

      if (req.method === 'PUT' || req.method === 'POST') {
        let body = '';
        req.on('data', c => { body += c; });
        req.on('end', () => {
          let incoming;
          try { incoming = JSON.parse(body); } catch (e) {
            res.writeHead(400, { 'content-type': 'application/json' });
            return res.end(JSON.stringify({ error: 'json inválido' }));
          }
          state.doc = Sync.mergeDocs(state.doc, incoming);
          state.doc.updatedAt = Date.now();
          Sync.purgeTombstones(state.doc, Date.now());
          state.writes++;
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ enabled: true, ok: true, doc: state.doc, updatedAt: state.doc.updatedAt }));
        });
        return;
      }

      res.writeHead(405).end();
      return;
    }

    if (url.pathname === '/api/upload') {
      res.setHeader('Cache-Control', 'no-store');
      if (!state.enabled || opts.uploads === false) {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ enabled: false }));
      }
      if (req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ enabled: true }));
      }
      // Guarda la foto y devuelve una dirección, como haría Blob.
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        state.uploads++;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ url: 'https://blob.test.local/postres/foto-' + state.uploads + '.jpg' }));
      });
      return;
    }

    if (url.pathname === '/api/vision') {
      res.setHeader('Cache-Control', 'no-store');
      const on = opts.vision !== false;
      if (req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ enabled: on }));
      }
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        state.scans++;
        res.writeHead(200, { 'content-type': 'application/json' });
        // Respuesta fija: aquí se prueba la interfaz, no el modelo. Lo que el
        // modelo hace de verdad se comprobó contra la API real.
        res.end(JSON.stringify(opts.visionResult || {
          ok: true, confianza: 'alta', porcionGramos: 30,
          macros: { calorias: 380, proteina: 11, carbohidratos: 70, azucar: 4,
                    grasa: 5, grasaSaturada: 1.33, fibra: 2.67, sodioMg: 400 }
        }));
      });
      return;
    }

    const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end('no encontrado');
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });

  server.state = state;
  return server;
}

module.exports = { createServer };

if (require.main === module) {
  const port = Number(process.argv[2]) || 4321;
  createServer().listen(port, () => console.log('http://localhost:' + port));
}
