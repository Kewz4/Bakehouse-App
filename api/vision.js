/**
 * Olivo & Liora · leer una etiqueta nutricional con la cámara
 * ============================================================
 *
 * GET  /api/vision  -> { enabled }               (la app pregunta al abrir)
 * POST /api/vision  -> { dataUrl, paquete? }     -> { ok, macros, confianza }
 *
 * Ella toma una foto de la tabla nutricional y los campos se llenan solos.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ PASA POR EL SERVIDOR
 * ---------------------------------------------------------------------------
 * La llave de Groq vive aquí, en una variable de entorno, y nunca sale hacia el
 * teléfono ni hacia el navegador. Si estuviera dentro de app.js cualquiera que
 * abriera la página podría leerla, y el repositorio es público.
 *
 * ---------------------------------------------------------------------------
 * CÓMO SE REPARTE EL TRABAJO
 * ---------------------------------------------------------------------------
 * El modelo SÓLO copia lo que ve y dice a qué se refiere la tabla ("por
 * porción" o "por 100 g"). Las cuentas — pasar de porción a 100 g — se hacen en
 * código, en business-core.js.
 *
 * Es a propósito: un modelo que divide mal produce un número igual de
 * convincente que uno bien calculado, y aquí un error se convierte en un precio
 * mal puesto. Copiar es lo que hace bien; dividir lo hace bien el código.
 */
const B = require('../business-core.js');

const MODEL = 'qwen/qwen3.6-27b';
const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const MAX_BYTES = 4 * 1024 * 1024;
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];
const TIMEOUT_MS = 45000;

function groqKey() {
  return process.env.GROQ_API_KEY || process.env.GROQ_KEY || null;
}

// Se obliga al modelo a responder con esta forma exacta. Así no hay que
// adivinar nada al leer la respuesta.
const SCHEMA = {
  type: 'object',
  properties: {
    encontrado: { type: 'boolean' },
    base: { type: 'string', enum: ['porcion', '100g', 'desconocido'] },
    porcionGramos: { type: ['number', 'null'] },
    porcionTexto: { type: ['string', 'null'] },
    porcionesPorEnvase: { type: ['number', 'null'] },
    valores: {
      type: 'object',
      properties: {
        calorias: { type: ['number', 'null'] },
        proteina: { type: ['number', 'null'] },
        carbohidratos: { type: ['number', 'null'] },
        azucar: { type: ['number', 'null'] },
        azucarAnadida: { type: ['number', 'null'] },
        grasa: { type: ['number', 'null'] },
        grasaSaturada: { type: ['number', 'null'] },
        fibra: { type: ['number', 'null'] },
        sodioMg: { type: ['number', 'null'] }
      },
      required: ['calorias', 'proteina', 'carbohidratos', 'azucar', 'azucarAnadida',
                 'grasa', 'grasaSaturada', 'fibra', 'sodioMg']
    },
    confianza: { type: 'string', enum: ['alta', 'media', 'baja'] }
  },
  required: ['encontrado', 'base', 'porcionGramos', 'porcionTexto',
             'porcionesPorEnvase', 'valores', 'confianza']
};

const PROMPT = [
  'Eres un extractor de tablas nutricionales. Lee la etiqueta de la foto.',
  'Puede estar en español ("Información Nutricional") o en inglés ("Nutrition',
  'Facts"): trátalas igual. "Serving size" = tamaño de porción, "Amount per',
  'serving" = cantidad por porción, "Total Sugars" = azúcares, "Total',
  'Carbohydrate" = carbohidratos, "Protein" = proteína, "Total Fat" = grasa,',
  '"Saturated Fat" = grasa saturada, "Dietary Fiber" = fibra,',
  '"Added Sugars" / "Includes Xg Added Sugars" = azúcares añadidos.',
  '',
  'Reglas:',
  '- Copia los números EXACTAMENTE como aparecen. No conviertas, no calcules,',
  '  no redondees y no completes lo que falte.',
  '- "base" es a qué se refieren los números de la tabla: "porcion" si dice',
  '  "por porción" o "cantidad por porción"; "100g" si la tabla es por 100 g',
  '  o por 100 ml.',
  '- "porcionGramos": el tamaño de una porción en gramos (o ml). null si no',
  '  aparece. Si dice "1 taza (30 g)" o "1 Tbsp. (21g)", son 30 y 21.',
  '- "porcionTexto": la porción tal como está escrita y completa, por ejemplo',
  '  "1 Tbsp. (21g)" o "2 galletas". null si no aparece.',
  '- "porcionesPorEnvase": cuántas porciones trae el paquete. null si no aparece.',
  '- "azucar": los azúcares TOTALES ("Total Sugars" / "Azúcares").',
  '- "azucarAnadida": SÓLO los AÑADIDOS, la línea "Added Sugars" o "Azúcares',
  '  añadidos", a veces escrita "Includes 17g Added Sugars" (ahí son 17). No la',
  '  confundas con los totales. Si esa línea no aparece en la etiqueta, pon',
  '  null: "no lo dice" no es lo mismo que "cero".',
  '- Los gramos en gramos. El sodio SIEMPRE en miligramos: si la etiqueta lo da',
  '  en gramos, multiplica por 1000 (esta es la única conversión permitida).',
  '- Si un dato no aparece en la etiqueta, pon null. Nunca lo inventes ni lo',
  '  deduzcas de otro producto parecido.',
  '- "confianza": "alta" si la foto se lee sin esfuerzo; "baja" si está borrosa,',
  '  cortada o en ángulo.',
  '- Si la foto no es una tabla nutricional, encontrado=false y todo en null.'
].join('\n');

async function askGroq(mime, base64, signal) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    signal,
    headers: {
      Authorization: 'Bearer ' + groqKey(),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      messages: [
        { role: 'system', content: PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Extrae la tabla nutricional de esta etiqueta.' },
            { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } }
          ]
        }
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'nutricion', schema: SCHEMA } }
    })
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const err = new Error('groq ' + res.status);
    err.status = res.status;
    err.detail = detail.slice(0, 300);
    // 429 es "vas muy rápido", no "esta foto no se puede leer". Pasa de verdad:
    // ella fotografía tres ingredientes seguidos y el segundo y el tercero se
    // caen. Se espera lo que diga el servidor y se reintenta una vez, porque
    // lo que ella ve es una etiqueta que no se lee sin razón aparente.
    if (res.status === 429 && !yaReintentado) {
      const espera = segundosDeEspera(res, detail);
      console.warn('vision: límite de peticiones, reintentando en', espera, 's');
      await new Promise(r => setTimeout(r, espera * 1000));
      return leerEtiqueta(mime, base64, true);
    }
    throw err;
  }

  const json = await res.json();
  const text = json && json.choices && json.choices[0] &&
               json.choices[0].message && json.choices[0].message.content;
  if (!text) throw new Error('respuesta vacía');
  return JSON.parse(text);
}

/**
 * Cuánto esperar antes de reintentar tras un 429.
 *
 * Groq lo dice en la cabecera `retry-after` o dentro del cuerpo ("try again in
 * 7.5s"). Se acota a 8 segundos: más que eso y la petición se comería el
 * presupuesto de la función, y es mejor decírselo que dejarla mirando la
 * pantalla.
 */
function segundosDeEspera(res, detail) {
  const cabecera = parseFloat(res.headers.get('retry-after'));
  if (Number.isFinite(cabecera) && cabecera > 0) return Math.min(cabecera, 8);
  const enCuerpo = /try again in ([\d.]+)\s*s/i.exec(detail || '');
  if (enCuerpo) return Math.min(parseFloat(enCuerpo[1]) + 0.3, 8);
  return 3;
}

function parseBody(req) {
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch (e) { return null; }
  }
  return req.body && typeof req.body === 'object' ? req.body : null;
}

// Mensajes para ella: qué hacer, nunca por qué falló por dentro.
const MOTIVOS = {
  'sin-tabla':   'Esa foto no parece una tabla nutricional. Enfoca la parte donde dicen las calorías.',
  'sin-datos':   'No alcancé a leer los números. Prueba de nuevo con más luz y de frente.',
  'sin-porcion': 'Leí la tabla, pero no dice cuánto pesa una porción. Escribe primero cuánto trae el paquete y vuelve a intentarlo.',
  'error':       'No pude leer la etiqueta ahora. Puedes escribir los datos a mano.',
  'ocupado':     'Voy muy rápido. Espera unos segundos y toma la foto otra vez.',
  'sin-llave':   'La lectura por foto no está disponible ahora. Puedes escribir los datos a mano.'
};

/** Traduce un fallo del servicio a algo que se pueda leer y hacer. */
function motivoDelFallo(err) {
  const s = err && err.status;
  if (s === 429) return 'ocupado';
  if (s === 401 || s === 403) return 'sin-llave';
  return 'error';
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const enabled = Boolean(groqKey());

  if (req.method === 'GET') {
    // La interfaz esconde el botón de la cámara si esto viene en false, para no
    // ofrecerle algo que no va a funcionar.
    return res.status(200).json({
      enabled,
      hint: enabled ? undefined : 'Falta GROQ_API_KEY en las variables del proyecto.'
    });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST, OPTIONS');
    return res.status(405).json({ ok: false, error: 'Método no permitido' });
  }

  if (!enabled) {
    return res.status(200).json({ ok: false, enabled: false, motivo: 'apagado',
      mensaje: 'Puedes escribir los datos a mano.' });
  }

  const body = parseBody(req);
  const dataUrl = body && body.dataUrl;
  if (!dataUrl || typeof dataUrl !== 'string') {
    return res.status(400).json({ ok: false, error: 'Falta la imagen' });
  }

  const match = dataUrl.match(/^data:([\w/+.-]+);base64,(.+)$/);
  if (!match) return res.status(400).json({ ok: false, error: 'Formato de imagen inválido' });

  const [, mime, base64] = match;
  if (!ALLOWED.includes(mime)) {
    return res.status(415).json({ ok: false, error: 'Tipo de imagen no permitido' });
  }
  if (Buffer.byteLength(base64, 'base64') > MAX_BYTES) {
    return res.status(413).json({ ok: false, error: 'La foto es demasiado grande' });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const lectura = await askGroq(mime, base64, controller.signal);
    const normalizado = B.normalizarEtiqueta(lectura, body.paquete);

    if (!normalizado.ok) {
      return res.status(200).json({
        ok: false,
        motivo: normalizado.motivo,
        mensaje: MOTIVOS[normalizado.motivo] || MOTIVOS.error
      });
    }

    return res.status(200).json({
      ok: true,
      macros: normalizado.macros,
      confianza: normalizado.confianza,
      // Se devuelve para que la interfaz pueda decir "por 100 g" con seguridad.
      porcionGramos: lectura.porcionGramos || null
    });
  } catch (err) {
    console.error('vision error', err && err.status, err && (err.detail || err.message));
    const motivo = motivoDelFallo(err);
    // El código de estado va en la respuesta a propósito. Es un número, no
    // dice nada de nadie, y sin él un fallo del servicio y una foto ilegible se
    // ven exactamente igual desde fuera — que es lo que hizo perder una tarde
    // entera creyendo que el lector estaba roto cuando estaba ocupado.
    return res.status(200).json({ ok: false, motivo: motivo,
                                  mensaje: MOTIVOS[motivo],
                                  estado: (err && err.status) || 0 });
  } finally {
    clearTimeout(timer);
  }
};

// Vercel corta las funciones a los 10 segundos por defecto. Una foto subiendo
// por datos móviles más la inferencia se pasa de ahí con facilidad, y desde
// fuera eso se ve igual que "no pude leer la etiqueta".
module.exports.config = { maxDuration: 60 };
