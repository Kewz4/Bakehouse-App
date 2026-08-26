/**
 * Pasa el banco de etiquetas por el lector de verdad.
 *
 *   node test/vision-labels.js [url]
 *
 * No va en `npm test`: gasta llamadas a la API y necesita red. Se corre a mano
 * cuando se toca el prompt, el modelo o la normalización, que es cuando puede
 * empezar a leer mal sin que nada falle de forma visible.
 *
 * Cada etiqueta se dibuja como imagen y se manda como la mandaría el teléfono.
 * Lo que vuelve se compara contra el valor calculado a mano en casos.js.
 */
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const { BASE } = require('./etiquetas/plantillas.js');
const { casos } = require('./etiquetas/casos.js');

const URL = process.argv[2] || 'https://olivo-liora.vercel.app/api/vision';
// Groq corta por peticiones por minuto. Sin esta pausa la primera etiqueta
// pasa y el resto se cae, y el informe diría que el lector está roto cuando lo
// que está es ocupado — que fue exactamente lo que pasó la primera vez.
const PAUSA_MS = +(process.env.PAUSA_MS || 20000);
const EXEC = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const SALIDA = path.join(__dirname, 'etiquetas', 'render');

// Un 2% de margen: el modelo lee "17g" y la división la hace el código, así que
// la única fuente de diferencia es el redondeo a dos decimales.
const TOLERANCIA = 0.02;

function cerca(a, b) {
  if (a == null || b == null) return a == null && b == null;
  if (b === 0) return Math.abs(a) < 0.05;
  return Math.abs(a - b) / Math.abs(b) <= TOLERANCIA;
}

async function main() {
  fs.mkdirSync(SALIDA, { recursive: true });
  const browser = await chromium.launch({
    executablePath: fs.existsSync(EXEC) ? EXEC : undefined,
    args: ['--no-sandbox']
  });
  const page = await browser.newPage({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 2 });

  let bien = 0;
  const fallos = [];

  let primera = true;
  for (const caso of casos) {
    if (!primera) await new Promise(r => setTimeout(r, PAUSA_MS));
    primera = false;
    await page.setContent(`<style>${BASE}</style>${caso.html}`);
    const nodo = await page.$('.label');
    const png = await nodo.screenshot();
    fs.writeFileSync(path.join(SALIDA, caso.id + '.png'), png);

    const dataUrl = 'data:image/png;base64,' + png.toString('base64');
    const t0 = Date.now();
    let res;
    try {
      const r = await fetch(URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dataUrl, paquete: caso.paquete })
      });
      res = await r.json();
    } catch (err) {
      res = { ok: false, mensaje: 'error de red: ' + err.message };
    }
    const ms = Date.now() - t0;

    console.log(`\n── ${caso.id}  (${(ms / 1000).toFixed(1)}s, ${Math.round(png.length / 1024)} kB)`);
    console.log(`   ${caso.que}`);

    if (caso.esperaFallo) {
      if (res.ok) {
        fallos.push(`${caso.id}: se inventó datos donde no había tabla → ${JSON.stringify(res.macros)}`);
        console.log('   ✗ dijo que sí pudo leerla:', JSON.stringify(res.macros));
      } else {
        bien++;
        console.log(`   ✓ dijo que no pudo (${res.motivo || '—'})`);
      }
      continue;
    }

    if (!res.ok) {
      // "ocupado" no es un fallo de lectura: es el límite de peticiones. Se
      // distingue para que el informe no acuse al lector de algo que no hizo.
      const etiqueta = res.motivo === 'ocupado' ? 'servicio ocupado' : 'no pudo leerla';
      fallos.push(`${caso.id}: ${etiqueta} (${res.motivo || '?'}) — ${res.mensaje || ''}`);
      console.log(`   ✗ ${etiqueta}: ${res.motivo || '?'} — ${res.mensaje || ''}`);
      continue;
    }

    const malos = [];
    for (const [k, esperado] of Object.entries(caso.espera)) {
      const salio = res.macros ? res.macros[k] : undefined;
      if (!cerca(salio, esperado)) malos.push(`${k}: salió ${salio}, esperaba ${esperado}`);
    }
    if (malos.length) {
      fallos.push(`${caso.id}: ${malos.join(' · ')}`);
      console.log('   ✗ ' + malos.join('\n     '));
    } else {
      bien++;
      console.log(`   ✓ todo cuadra (confianza: ${res.confianza})`);
    }
  }

  await browser.close();

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`${bien} de ${casos.length} etiquetas leídas correctamente.`);
  if (fallos.length) {
    console.log('\nFallos:');
    fallos.forEach(f => console.log('  · ' + f));
  }
  console.log(`\nImágenes en ${path.relative(process.cwd(), SALIDA)}/`);
  process.exit(fallos.length ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
