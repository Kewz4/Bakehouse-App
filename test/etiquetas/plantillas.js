/**
 * Etiquetas nutricionales de mentira, pero dibujadas como las de verdad.
 *
 * Se renderizan a imagen y se le mandan al lector de etiquetas para comprobar
 * que saca los números correctos. Cada una lleva escrito, aparte, lo que DEBE
 * salir por 100 g o por 100 ml: así la comparación es contra una verdad
 * conocida y no contra lo que el modelo dijo la última vez.
 */

const BASE = `
  body{margin:0;background:#fff;font:14px/1.25 Helvetica,Arial,sans-serif;color:#000}
  .label{width:300px;border:1px solid #000;padding:8px;margin:20px}
  .t{font:900 30px/0.95 Helvetica,Arial,sans-serif;letter-spacing:-1px;margin:0 0 4px}
  .sv{font-size:12px;display:flex;justify-content:space-between}
  .bar{height:9px;background:#000;margin:4px 0}
  .thin{height:4px;background:#000;margin:3px 0}
  .cal{display:flex;justify-content:space-between;align-items:baseline;font-weight:900}
  .cal b{font-size:32px}
  .row{display:flex;justify-content:space-between;border-top:1px solid #000;padding:2px 0;font-size:13px}
  .row.i{padding-left:14px;font-weight:400}
  .row.ii{padding-left:28px;font-weight:400}
  .row b{font-weight:700}
  .dv{font-weight:700}
  .foot{font-size:10px;border-top:6px solid #000;padding-top:4px;margin-top:4px}
`;

/** Una etiqueta al estilo FDA (Estados Unidos). */
function fda(o) {
  const fila = (n, v, dv, cls = '') =>
    `<div class="row ${cls}"><span>${n} ${v}</span><span class="dv">${dv || ''}</span></div>`;
  return `<div class="label">
    <p class="t">${o.titulo || 'Nutrition Facts'}</p>
    <div class="sv"><span>${o.porEnvase || ''}</span></div>
    <div class="thin"></div>
    <div class="sv"><b>${o.servingLabel || 'Serving size'}</b><b>${o.serving}</b></div>
    <div class="bar"></div>
    <div style="font-size:11px;font-weight:700">${o.amountLabel || 'Amount per serving'}</div>
    <div class="cal"><span>${o.calLabel || 'Calories'}</span><b>${o.calorias}</b></div>
    <div class="thin"></div>
    <div style="text-align:right;font-size:11px;font-weight:700">% Daily Value*</div>
    ${fila(`<b>${o.grasaLabel || 'Total Fat'}</b>`, o.grasa, o.grasaDV)}
    ${fila(o.satLabel || 'Saturated Fat', o.grasaSaturada, '', 'i')}
    ${fila(`<b>${o.sodioLabel || 'Sodium'}</b>`, o.sodio, o.sodioDV)}
    ${fila(`<b>${o.carbLabel || 'Total Carbohydrate'}</b>`, o.carbohidratos, o.carbDV)}
    ${fila(o.fibraLabel || 'Dietary Fiber', o.fibra, '', 'i')}
    ${fila(o.azucarLabel || 'Total Sugars', o.azucar, '', 'i')}
    ${o.azucarAnadida != null
      ? fila(o.anadidaLabel || `Includes ${o.azucarAnadida} Added Sugars`, '', o.anadidaDV || '', 'ii')
      : ''}
    ${fila(`<b>${o.proteinaLabel || 'Protein'}</b>`, o.proteina, '')}
    <div class="foot">${o.pie || '* The % Daily Value tells you how much a nutrient in a serving of food contributes to a daily diet.'}</div>
  </div>`;
}

/** Una etiqueta al estilo latinoamericano / español. */
function esp(o) {
  const fila = (n, v, cls = '') =>
    `<div class="row ${cls}"><span>${n}</span><span class="dv">${v}</span></div>`;
  return `<div class="label">
    <p class="t" style="font-size:20px">Información Nutricional</p>
    <div class="sv"><span>Tamaño de la porción</span><span>${o.serving}</span></div>
    ${o.porEnvase ? `<div class="sv"><span>Porciones por envase</span><span>${o.porEnvase}</span></div>` : ''}
    <div class="bar"></div>
    ${fila('<b>Energía</b>', o.calorias + ' kcal')}
    ${fila('<b>Grasas totales</b>', o.grasa)}
    ${fila('Grasas saturadas', o.grasaSaturada, 'i')}
    ${fila('<b>Carbohidratos totales</b>', o.carbohidratos)}
    ${fila('Fibra dietética', o.fibra, 'i')}
    ${fila('Azúcares totales', o.azucar, 'i')}
    ${o.azucarAnadida != null ? fila('Azúcares añadidos', o.azucarAnadida, 'ii') : ''}
    ${fila('<b>Proteínas</b>', o.proteina)}
    ${fila('<b>Sodio</b>', o.sodio)}
  </div>`;
}

module.exports = { BASE, fda, esp };
