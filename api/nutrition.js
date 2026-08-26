/**
 * Olivo & Liora · nutrición de lo que no trae etiqueta
 * ====================================================
 *
 * GET  /api/nutrition  -> { enabled }
 * POST /api/nutrition  -> { nombre, unitSingle, ... } -> { ok, macros, gramosPorPieza }
 *
 * Una banana no viene con tabla nutricional pegada, pero sus datos son
 * conocimiento general. Ella escribe "banana", toca un botón y los campos se
 * llenan.
 *
 * ---------------------------------------------------------------------------
 * QUÉ HACE EL MODELO Y QUÉ HACE EL CÓDIGO
 * ---------------------------------------------------------------------------
 * Lo mismo que en la lectura de etiquetas, y por la misma razón. El modelo
 * SÓLO aporta dos cosas que sabe de memoria: los valores por 100 g y cuánto
 * pesa una pieza típica. Todas las conversiones —de 100 g a "por banana"— las
 * hace business-core.js.
 *
 * Un modelo que divide mal produce un número igual de convincente que uno bien
 * calculado, y aquí un error acaba en una etiqueta de dieta que alguien podría
 * creerse.
 */
const B = require('../business-core.js');

const MODEL = 'qwen/qwen3.6-27b';
const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const TIMEOUT_MS = 25000;

function groqKey() {
  return process.env.GROQ_API_KEY || process.env.GROQ_KEY || null;
}

const SCHEMA = {
  type: 'object',
  properties: {
    esAlimento: { type: 'boolean' },
    nombreReconocido: { type: ['string', 'null'] },
    // Siempre por 100 g de producto crudo y comestible, que es la referencia
    // en la que están publicadas las tablas de composición de alimentos.
    por100g: {
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
                 'grasa', 'grasaSaturada', 'fibra', 'sodioMg'],
      additionalProperties: false
    },
    gramosPorPieza: { type: ['number', 'null'] },
    esFruta: { type: 'boolean' },
    confianza: { type: 'string', enum: ['alta', 'media', 'baja'] }
  },
  required: ['esAlimento', 'nombreReconocido', 'por100g', 'gramosPorPieza', 'esFruta', 'confianza'],
  additionalProperties: false
};

const PROMPT = `Eres una tabla de composición de alimentos. Te dan el nombre de un
ingrediente y devuelves sus valores nutricionales de referencia.

REGLAS

1. Los valores van SIEMPRE por 100 g de producto crudo y en su parte comestible
   (una banana sin cáscara, una naranja sin cáscara). Nunca por porción, nunca
   por pieza: de eso se encarga quien te llama.

2. "azucarAnadida" es azúcar AÑADIDA en la elaboración. Un alimento sin
   procesar —fruta, verdura, huevo, carne— tiene 0, aunque tenga azúcar propia.
   La fructosa de la fruta va en "azucar", no en "azucarAnadida".

3. "gramosPorPieza": UN solo número, cuánto pesa una pieza mediana comestible,
   si el alimento se cuenta por piezas. Nunca un rango ("8-12") ni texto
   ("12 g"): si varía mucho, da el valor típico. Una banana mediana ~118 g, un huevo grande ~50 g, una
   fresa ~12 g, un limón ~58 g. Si no se cuenta por piezas (harina, aceite,
   leche), pon null.

4. "esFruta": true para frutas y verduras frescas. El coco es un caso aparte:
   ponlo en false, porque su harina y su aceite casi no llevan azúcar.

5. Todos los valores de por100g son números o null. Nunca texto, nunca rangos,
   nunca "<1": si algo es menor que 1, escribe ese límite.

6. Si no reconoces el alimento, o el texto no es un alimento, pon
   esAlimento: false y TODOS los valores de por100g en null. El objeto
   por100g siempre va presente, aunque esté entero en null. NO te inventes valores: es
   preferible que lo escriba a mano a que se guarde un dato falso.

7. "confianza": alta para alimentos comunes y bien documentados, media si
   varía mucho según variedad o preparación, baja si dudas.

Responde SÓLO con el JSON del esquema.`;

async function consultar(nombre, yaReintentado) {
  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      signal: control.signal,
      headers: {
        authorization: 'Bearer ' + groqKey(),
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        messages: [
          { role: 'system', content: PROMPT },
          { role: 'user', content: `Ingrediente: ${nombre}` }
        ],
        response_format: { type: 'json_schema', json_schema: { name: 'nutricion', schema: SCHEMA } }
      })
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      const err = new Error('groq ' + res.status);
      err.status = res.status;
      err.detail = detail.slice(0, 300);
      // Un 400 aquí es que la respuesta del modelo no encajó en el esquema, y
      // no es determinista: la misma consulta pasa o falla según la vez. Un
      // solo reintento convierte casi todas, y sin él ella vería fallar una
      // fruta de cada tres sin ninguna razón visible.
      if ((res.status === 429 || res.status === 400) && !yaReintentado) {
        const espera = res.status === 400 ? 0 : Math.min(
          parseFloat(res.headers.get('retry-after'))
            || (parseFloat((/try again in ([\d.]+)\s*s/i.exec(detail || '') || [])[1]) + 0.3)
            || 3, 8);
        console.warn('nutrition: límite de peticiones, reintentando en', espera, 's');
        clearTimeout(timer);
        await new Promise(r => setTimeout(r, espera * 1000));
        return consultar(nombre, true);
      }
      throw err;
    }
    const json = await res.json();
    const text = json && json.choices && json.choices[0] &&
                 json.choices[0].message && json.choices[0].message.content;
    if (!text) throw new Error('respuesta vacía');
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

const MOTIVOS = {
  'no-alimento':   'No conozco ese ingrediente. Escribe los datos a mano.',
  'sin-datos':     'No conozco ese ingrediente. Escribe los datos a mano.',
  'sin-peso':      'Necesito saber cuánto pesa cada uno. Escríbelo arriba y vuelve a intentarlo.',
  'sin-densidad':  'Para lo que se mide en líquidos hace falta la etiqueta. Toma una foto o escríbelo a mano.',
  'ocupado':       'Voy muy rápido. Espera unos segundos y vuelve a tocarlo.',
  'rara':          'No pude entender la respuesta para eso. Escribe los datos a mano.',
  'sin-llave':     'Esto no está disponible ahora. Puedes escribir los datos a mano.',
  'error':         'No pude buscarlo ahora. Puedes escribir los datos a mano.'
};

function motivoDelFallo(err) {
  const s = err && err.status;
  if (s === 429) return 'ocupado';
  if (s === 401 || s === 403) return 'sin-llave';
  // Un 400 con salida estructurada significa que lo que respondió el modelo no
  // encajó en el esquema. Es un fallo de esta consulta, no del servicio.
  if (s === 400) return 'rara';
  return 'error';
}

function parseBody(req) {
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch (e) { return null; }
  }
  return req.body && typeof req.body === 'object' ? req.body : null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    return res.status(200).json({ enabled: !!groqKey() });
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, error: 'Método no permitido' });
  }
  if (!groqKey()) {
    return res.status(200).json({ ok: false, enabled: false, motivo: 'sin-llave',
                                  mensaje: MOTIVOS['sin-llave'] });
  }

  const body = parseBody(req) || {};
  const nombre = String(body.nombre || '').trim().slice(0, 80);
  if (!nombre) return res.status(400).json({ ok: false, error: 'Falta el nombre' });

  const unitSingle = String(body.unitSingle || 'g');
  // Lo que ella ya escribió manda sobre lo que el modelo recuerde: si dice que
  // cada barra pesa 113 g, son 113 g.
  const pesoPropio = +body.gramosPorPieza || 0;

  try {
    const lectura = await consultar(nombre);

    if (!lectura || !lectura.esAlimento || !lectura.por100g) {
      return res.status(200).json({ ok: false, motivo: 'no-alimento',
                                    mensaje: MOTIVOS['no-alimento'] });
    }

    const peso = pesoPropio > 0 ? pesoPropio : lectura.gramosPorPieza;
    const normalizado = B.normalizarReferencia(lectura.por100g, peso, unitSingle);
    if (!normalizado.ok) {
      return res.status(200).json({
        ok: false,
        motivo: normalizado.motivo,
        mensaje: MOTIVOS[normalizado.motivo] || MOTIVOS.error,
        // Aunque no se pueda convertir, saber cuánto pesa una pieza sirve: la
        // interfaz lo ofrece para rellenar ese campo.
        gramosPorPieza: lectura.gramosPorPieza || null
      });
    }

    return res.status(200).json({
      ok: true,
      nombre: lectura.nombreReconocido || nombre,
      macros: normalizado.macros,
      gramosPorPieza: lectura.gramosPorPieza || null,
      esFruta: lectura.esFruta === true,
      confianza: lectura.confianza || 'media'
    });
  } catch (err) {
    console.error('nutrition error', err && err.status, err && (err.detail || err.message));
    const motivo = motivoDelFallo(err);
    // El código de estado va en la respuesta a propósito. Es un número, no
    // dice nada de nadie, y sin él un fallo del servicio y una foto ilegible se
    // ven exactamente igual desde fuera — que es lo que hizo perder una tarde
    // entera creyendo que el lector estaba roto cuando estaba ocupado.
    return res.status(200).json({ ok: false, motivo: motivo,
                                  mensaje: MOTIVOS[motivo],
                                  estado: (err && err.status) || 0 });
  }
};

module.exports.config = { maxDuration: 30 };
