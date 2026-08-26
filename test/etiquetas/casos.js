/**
 * El banco de etiquetas, cada una con lo que DEBE salir.
 *
 * `espera` está en las mismas unidades en que el sistema guarda los macros:
 * por 100 g o por 100 ml. Los números están calculados a mano a partir de lo
 * que dice la etiqueta, no copiados de una respuesta del modelo — si no, la
 * prueba sólo comprobaría que el modelo sigue diciendo lo mismo que dijo ayer.
 */
const { fda, esp } = require('./plantillas.js');

// Por porción -> por 100 g
const por100 = (valor, porcionG) => valor == null ? null : +(valor * 100 / porcionG).toFixed(2);

const casos = [
  {
    id: 'miel-fda-por-porcion',
    que: 'Etiqueta FDA por porción, con azúcares añadidos. La que él mandó.',
    paquete: { cantidad: 340, unitSingle: 'g' },
    html: fda({
      porEnvase: 'about 16 servings per container',
      serving: '1 Tbsp. (21g)',
      calorias: 60, grasa: '0g', grasaSaturada: '0g', sodio: '0mg',
      carbohidratos: '17g', fibra: '0g', azucar: '17g', azucarAnadida: '17g',
      proteina: '0g'
    }),
    espera: {
      calorias: por100(60, 21), proteina: 0, carbohidratos: por100(17, 21),
      azucar: por100(17, 21), azucarAnadida: por100(17, 21),
      grasa: 0, grasaSaturada: 0, fibra: 0, sodioMg: 0
    }
  },
  {
    id: 'harina-fda-por-porcion',
    que: 'Harina, porción de 30 g, sin azúcar añadida declarada.',
    paquete: { cantidad: 2270, unitSingle: 'g' },
    html: fda({
      porEnvase: 'about 76 servings per container',
      serving: '1/4 cup (30g)',
      calorias: 110, grasa: '0.5g', grasaSaturada: '0g', sodio: '0mg',
      carbohidratos: '23g', fibra: '1g', azucar: '0g', azucarAnadida: '0g',
      proteina: '3g'
    }),
    espera: {
      calorias: por100(110, 30), proteina: por100(3, 30), carbohidratos: por100(23, 30),
      azucar: 0, azucarAnadida: 0, grasa: por100(0.5, 30), grasaSaturada: 0,
      fibra: por100(1, 30), sodioMg: 0
    }
  },
  {
    id: 'leche-esp-por-100ml',
    que: 'Etiqueta en español que YA viene por 100 ml: no hay que convertir nada.',
    paquete: { cantidad: 1, unitSingle: 'l' },
    html: esp({
      serving: '100 ml',
      calorias: 61, grasa: '3.3 g', grasaSaturada: '1.9 g',
      carbohidratos: '4.8 g', fibra: '0 g', azucar: '4.8 g',
      proteina: '3.2 g', sodio: '43 mg'
    }),
    espera: {
      calorias: 61, proteina: 3.2, carbohidratos: 4.8, azucar: 4.8,
      grasa: 3.3, grasaSaturada: 1.9, fibra: 0, sodioMg: 43
    }
  },
  {
    id: 'yogur-esp-por-porcion',
    que: 'Español por porción de 170 g, con azúcares añadidos.',
    paquete: { cantidad: 1000, unitSingle: 'g' },
    html: esp({
      serving: '170 g', porEnvase: '5',
      calorias: 150, grasa: '2 g', grasaSaturada: '1.5 g',
      carbohidratos: '20 g', fibra: '0 g', azucar: '19 g', azucarAnadida: '12 g',
      proteina: '12 g', sodio: '65 mg'
    }),
    espera: {
      calorias: por100(150, 170), proteina: por100(12, 170), carbohidratos: por100(20, 170),
      azucar: por100(19, 170), azucarAnadida: por100(12, 170),
      grasa: por100(2, 170), grasaSaturada: por100(1.5, 170), fibra: 0,
      sodioMg: por100(65, 170)
    }
  },
  {
    id: 'aceite-sin-gramos-volumen',
    que: 'Dice "1 Tbsp." y no cuántos gramos. Se mide en volumen, así que una '
       + 'cucharada son 15 ml y se puede rescatar.',
    paquete: { cantidad: 500, unitSingle: 'ml' },
    html: fda({
      porEnvase: 'about 33 servings per container',
      serving: '1 Tbsp.',
      calorias: 120, grasa: '14g', grasaSaturada: '2g', sodio: '0mg',
      carbohidratos: '0g', fibra: '0g', azucar: '0g', proteina: '0g'
    }),
    espera: {
      calorias: por100(120, 15), proteina: 0, carbohidratos: 0, azucar: 0,
      grasa: por100(14, 15), grasaSaturada: por100(2, 15), fibra: 0, sodioMg: 0
    }
  },
  {
    id: 'sin-gramos-por-envase',
    que: 'Ni gramos por porción ni unidad casera, pero sí porciones por envase: '
       + '900 g entre 30 porciones.',
    paquete: { cantidad: 900, unitSingle: 'g' },
    html: fda({
      porEnvase: '30 servings per container',
      serving: '1 scoop',
      calorias: 120, grasa: '1.5g', grasaSaturada: '0.5g', sodio: '50mg',
      carbohidratos: '3g', fibra: '1g', azucar: '1g', azucarAnadida: '0g',
      proteina: '24g'
    }),
    espera: {
      calorias: por100(120, 30), proteina: por100(24, 30), carbohidratos: por100(3, 30),
      azucar: por100(1, 30), azucarAnadida: 0, grasa: por100(1.5, 30),
      grasaSaturada: por100(0.5, 30), fibra: por100(1, 30), sodioMg: por100(50, 30)
    }
  },
  {
    id: 'etiqueta-vieja-sin-anadida',
    que: 'Etiqueta antigua de EE.UU.: no existe la línea de azúcares añadidos. '
       + 'Tiene que quedar en blanco, NO en cero.',
    paquete: { cantidad: 400, unitSingle: 'g' },
    html: fda({
      porEnvase: 'Servings Per Container 8',
      serving: '50g',
      calorias: 200, grasa: '8g', grasaSaturada: '3g', sodio: '150mg',
      carbohidratos: '28g', fibra: '2g', azucar: '14g',
      proteina: '4g'
    }),
    espera: {
      calorias: por100(200, 50), proteina: por100(4, 50), carbohidratos: por100(28, 50),
      azucar: por100(14, 50), azucarAnadida: null,
      grasa: por100(8, 50), grasaSaturada: por100(3, 50), fibra: por100(2, 50),
      sodioMg: por100(150, 50)
    }
  },
  {
    id: 'decimales-y-menores',
    que: 'Decimales y un "<1g", que es lo que rompe los lectores ingenuos.',
    paquete: { cantidad: 250, unitSingle: 'g' },
    html: fda({
      serving: '25g',
      calorias: 132, grasa: '7.5g', grasaSaturada: '<1g', sodio: '12mg',
      carbohidratos: '13.4g', fibra: '0.5g', azucar: '2.8g', azucarAnadida: '0g',
      proteina: '3.2g'
    }),
    espera: {
      calorias: por100(132, 25), proteina: por100(3.2, 25), carbohidratos: por100(13.4, 25),
      azucar: por100(2.8, 25), azucarAnadida: 0, grasa: por100(7.5, 25),
      fibra: por100(0.5, 25), sodioMg: por100(12, 25)
      // grasaSaturada se deja fuera a propósito: "<1g" no es un número y
      // cualquier cosa entre 0 y 1 es defendible.
    }
  },
  {
    id: 'porcion-en-piezas',
    que: 'La porción son 2 galletas (32 g). El peso está ahí, aunque venga '
       + 'acompañado de un conteo.',
    paquete: { cantidad: 300, unitSingle: 'g' },
    html: fda({
      porEnvase: 'about 9 servings per container',
      serving: '2 cookies (32g)',
      calorias: 160, grasa: '7g', grasaSaturada: '2.5g', sodio: '110mg',
      carbohidratos: '23g', fibra: '1g', azucar: '13g', azucarAnadida: '13g',
      proteina: '1g'
    }),
    espera: {
      calorias: por100(160, 32), proteina: por100(1, 32), carbohidratos: por100(23, 32),
      azucar: por100(13, 32), azucarAnadida: por100(13, 32),
      grasa: por100(7, 32), grasaSaturada: por100(2.5, 32), fibra: por100(1, 32),
      sodioMg: por100(110, 32)
    }
  },
  {
    id: 'no-es-una-etiqueta',
    que: 'Una lista de ingredientes, no una tabla nutricional. Tiene que decir '
       + 'que no la pudo leer, no inventarse números.',
    paquete: { cantidad: 500, unitSingle: 'g' },
    html: `<div class="label"><p class="t" style="font-size:18px">INGREDIENTES</p>
      <p style="font-size:13px">Harina de trigo enriquecida, azúcar, aceite vegetal
      (palma, canola), cacao, jarabe de maíz, sal, bicarbonato de sodio,
      lecitina de soya, saborizante artificial de vainilla.</p>
      <p style="font-size:11px">CONTIENE: TRIGO, SOYA.</p></div>`,
    esperaFallo: true
  }
];

module.exports = { casos };
