/**
 * Olivo & Liora · cuentas del negocio
 * ====================================
 *
 * Unidades, cantidades escritas a mano y las fórmulas de costo y precio.
 *
 * Vive aparte de app.js por la misma razón que sync-core.js: la app de iPhone
 * tiene que calcular EXACTAMENTE lo mismo. Estando aquí, estas funciones se
 * pueden probar contra su gemela en Swift (Units.swift, Domain.swift) y CI
 * avisa si alguna de las dos se desvía. Si vivieran dentro de app.js, mezcladas
 * con el DOM, no habría forma de compararlas.
 *
 * Si cambias una fórmula aquí, cámbiala también en el lado de Swift.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.BusinessCore = api;
    // También como globales sueltos: app.js las llama por su nombre a secas.
    Object.keys(api).forEach(function (k) { root[k] = api[k]; });
  }
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

// Unidades: cada una guarda a cuánto equivale en la unidad base de su familia
// (masa → gramos, volumen → mililitros, conteo → unidades).
const UNITS={
 g:{f:1,fam:'masa',n:'gramos (g)',s:'g'},
 kg:{f:1000,fam:'masa',n:'kilos (kg)',s:'kg'},
 lb:{f:453.592,fam:'masa',n:'libras (lb)',s:'lb'},
 oz:{f:28.3495,fam:'masa',n:'onzas (oz)',s:'oz'},
 ml:{f:1,fam:'volumen',n:'mililitros (ml)',s:'ml'},
 l:{f:1000,fam:'volumen',n:'litros (L)',s:'L'},
 taza:{f:240,fam:'volumen',n:'tazas',s:'taza'},
 cda:{f:15,fam:'volumen',n:'cucharadas',s:'cda'},
 cdta:{f:5,fam:'volumen',n:'cucharaditas',s:'cdta'},
 u:{f:1,fam:'conteo',n:'unidades',s:'u'},
 docena:{f:12,fam:'conteo',n:'docenas',s:'docena'}};
const unitInfo=k=>UNITS[k]||UNITS.u;
// Acepta "1/2", "1 1/2", "½", "media taza", "un cuarto", "2.5"…
const FRACCIONES={'½':.5,'⅓':1/3,'⅔':2/3,'¼':.25,'¾':.75,'⅛':.125,'⅜':.375,'⅝':.625,'⅞':.875,'⅕':.2,'⅖':.4,'⅗':.6,'⅘':.8,'⅙':1/6,'⅚':5/6};
const PALABRAS={'un':1,'una':1,'uno':1,'dos':2,'tres':3,'cuatro':4,'cinco':5,'seis':6,'siete':7,'ocho':8,'nueve':9,'diez':10,'once':11,'doce':12,
 'medio':.5,'media':.5,'mitad':.5,'cuarto':.25,'cuarta':.25,'tercio':1/3,'tercia':1/3,'octavo':.125,'docena':12};
function parseQty(v){if(typeof v==='number')return v;
let t=String(v??'').toLowerCase().trim();if(!t)return 0;
t=t.replace(/,/g,'.');
let total=0,usado=false;
for(const [ch,val] of Object.entries(FRACCIONES)){if(t.includes(ch)){const antes=t.split(ch)[0].trim();const n=parseFloat(antes);total+=(isFinite(n)?n:0)+val;t=t.replace(ch,' ').replace(antes,' ');usado=true}}
if(usado)return total;
const mixta=t.match(/^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
if(mixta)return +mixta[1]+(+mixta[2])/(+mixta[3]||1);
const frac=t.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
if(frac)return (+frac[1])/(+frac[2]||1);
const num=t.match(/^-?\d+(?:\.\d+)?/);
if(num)return +num[0];
// "media", "un cuarto", "dos tercios", "tres cuartos"
const palabras=t.split(/\s+|\s*y\s*/).filter(Boolean);
let acc=0,pend=null;
for(const p of palabras){const w=p.replace(/s$/,'');const val=PALABRAS[w]??PALABRAS[p];
 if(val==null)continue;
 if(val>=1){if(pend==null)pend=val;else{acc+=pend*val;pend=null}}
 else{acc+=(pend??1)*val;pend=null}}
if(pend!=null)acc+=pend;
return acc}

// Muestra un número bonito: 0.5 -> "½", 1.25 -> "1 ¼"
function prettyQty(n){if(!isFinite(n)||!n)return '0';
const entero=Math.floor(n),resto=+(n-entero).toFixed(3);
const mapa={0.5:'½',0.25:'¼',0.75:'¾',0.333:'⅓',0.667:'⅔',0.125:'⅛'};
const frac=mapa[resto];
if(!frac)return String(+n.toFixed(2));
return (entero?entero+' ':'')+frac}
const unitFamily=k=>unitInfo(k).fam;
// costo del ingrediente por unidad base (por gramo, por ml o por unidad)
function baseCost(ing){const q=(+ing.quantity||1)*unitInfo(ing.unitSingle).f;return (+ing.price||0)/(q||1)}

/**
 * A cuánto sale el ingrediente, en una unidad que se pueda leer.
 *
 * Decir "$0.00 por g" es inútil: una harina de $1.25 la bolsa de 459 g cuesta
 * $0.0027 el gramo, y a dos decimales eso es cero. No era un cálculo malo, era
 * una unidad mal elegida.
 *
 * Se busca la unidad más pequeña de su misma familia con la que el número pase
 * de 10 centavos, que es donde deja de parecer cero: esa harina sale "$1.23 por
 * lb" y los huevos siguen saliendo "$0.20 por u".
 */
const COST_MIN=0.10;
function displayCost(ing){
 const porBase=baseCost(ing);
 const fam=unitFamily(ing.unitSingle);
 const opciones=Object.entries(UNITS).filter(([k,v])=>v.fam===fam)
   .sort((a,b)=>a[1].f-b[1].f);
 if(!opciones.length)return {amount:porBase,unit:unitInfo(ing.unitSingle).s};
 const elegida=opciones.find(([k,v])=>porBase*v.f>=COST_MIN)||opciones[opciones.length-1];
 return {amount:porBase*elegida[1].f,unit:elegida[1].s}}

function recipeCost(r){return (r.ingredients||[]).reduce((s,i)=>s+(+i.qty||0)*(+i.cost||0),0)}function recipePrice(r){return +r.price||0}function recipeUnitCost(r){return recipeCost(r)/(+r.yield||1)}function recipeMargin(r){const p=recipePrice(r);return p?(p-recipeUnitCost(r))/p*100:0}function suggestPrice(r,target=65){return recipeUnitCost(r)/(1-target/100)}

// ---------------------------------------------------------------------------
// Macros (opcional)
// ---------------------------------------------------------------------------
// Se guardan POR 100 UNIDADES BASE del ingrediente: por 100 g si se mide en
// masa, por 100 ml si en volumen, por 100 unidades si se cuenta. Es la misma
// forma en que vienen las etiquetas, así que lo que se lee de una foto entra
// tal cual, sin conversiones que se puedan torcer.
//
// El sodio va en miligramos; todo lo demás en gramos, salvo las calorías.
const MACROS=[
 {k:'calorias',      n:'Calorías',        u:'kcal'},
 {k:'proteina',      n:'Proteína',        u:'g'},
 {k:'carbohidratos', n:'Carbohidratos',   u:'g'},
 {k:'azucar',        n:'Azúcares',        u:'g'},
 {k:'grasa',         n:'Grasa',           u:'g'},
 {k:'grasaSaturada', n:'Grasa saturada',  u:'g'},
 {k:'fibra',         n:'Fibra',           u:'g'},
 {k:'sodioMg',       n:'Sodio',           u:'mg'}];
const MACRO_KEYS=MACROS.map(m=>m.k);

// ¿Este ingrediente tiene datos de macros? Son opcionales: la mayoría de las
// recetas funcionan sin ellos.
function hasMacros(ing){const m=ing&&ing.macros;
 return !!m&&MACRO_KEYS.some(k=>m[k]!=null&&m[k]!==''&&isFinite(+m[k]))}

// Cuánto aporta 1 unidad base (1 g, 1 ml, 1 unidad) del ingrediente.
function macroPerBase(ing,key){const m=(ing&&ing.macros)||{};const v=+m[key];
 return isFinite(v)?v/100:0}

/**
 * Suma los macros de una receta.
 *
 * Sólo cuentan las líneas enlazadas a un ingrediente que tenga macros. Se
 * devuelve además cuántas líneas se pudieron contar: si faltan, mostrar un
 * total a secas sería engañoso, y la interfaz lo advierte en vez de callar.
 */
function recipeMacros(r,ingredientsById){
 const totals={};MACRO_KEYS.forEach(k=>totals[k]=0);
 const lines=(r&&r.ingredients)||[];
 let contadas=0;
 lines.forEach(l=>{
  const ing=ingredientsById&&ingredientsById[l.ingredientId];
  if(!ing||!hasMacros(ing))return;
  // cantidad de la línea llevada a unidades base
  const base=(+l.qty||0)*unitInfo(l.unit||ing.unitSingle).f;
  MACRO_KEYS.forEach(k=>{totals[k]+=base*macroPerBase(ing,k)});
  contadas++});
 const porciones=(+r.yield||1)||1;
 const perServing={};MACRO_KEYS.forEach(k=>perServing[k]=totals[k]/porciones);
 return {totals:totals, perServing:perServing,
         contadas:contadas, total:lines.length, completo:contadas===lines.length&&lines.length>0};
}

/**
 * Convierte lo leído de una etiqueta a "por 100 unidades base".
 *
 * El modelo de visión copia los números tal cual los ve y dice a qué se
 * refieren; la cuenta se hace aquí, en código, porque una división mal hecha
 * por el modelo se vería igual de convincente que una bien hecha.
 *
 * `paquete` (opcional) es {cantidad, unitSingle}: si la etiqueta no dice cuánto
 * pesa una porción pero sí cuántas porciones trae el envase, se deduce.
 */
function normalizarEtiqueta(lectura,paquete){
 if(!lectura||!lectura.encontrado)return {ok:false,motivo:'sin-tabla'};
 const v=lectura.valores||{};
 const tieneAlgo=MACRO_KEYS.some(k=>v[k]!=null&&isFinite(+v[k]));
 if(!tieneAlgo)return {ok:false,motivo:'sin-datos'};

 let porcion=+lectura.porcionGramos||0;

 // La etiqueta dice "1 Tbsp." pero no cuántos gramos son. Sólo se puede
 // rescatar si el ingrediente se mide en VOLUMEN: una cucharada son 15 ml
 // siempre, pero en gramos depende de qué sea (una de miel pesa 21 g y una de
 // harina 8 g). Adivinar la densidad sería inventarse el dato.
 if(!porcion&&lectura.porcionTexto&&paquete&&unitFamily(paquete.unitSingle)==='volumen'){
  const t=String(lectura.porcionTexto).toLowerCase();
  const CASERAS=[[/\b(tbsp|tablespoon|cucharada|cda)\b/,15],
                 [/\b(tsp|teaspoon|cucharadita|cdta)\b/,5],
                 [/\b(cup|taza)\b/,240],
                 [/\b(fl\.? ?oz|onza l[ií]quida)\b/,29.5735]];
  const num=parseFloat(t)||1;
  for(const [re,ml] of CASERAS){if(re.test(t)){porcion=num*ml;break}}}
 // Si no dice el tamaño de la porción pero sí cuántas trae el envase, y
 // sabemos cuánto trae el envase, sale por división.
 if(!porcion&&paquete&&+lectura.porcionesPorEnvase>0){
  const base=(+paquete.cantidad||0)*unitInfo(paquete.unitSingle).f;
  if(base>0)porcion=base/(+lectura.porcionesPorEnvase)}

 let factor;
 if(lectura.base==='100g')factor=1;                 // ya viene por 100
 else if(porcion>0)factor=100/porcion;              // por porción -> por 100
 else return {ok:false,motivo:'sin-porcion'};

 const macros={};
 MACRO_KEYS.forEach(k=>{const n=+v[k];
  macros[k]=(v[k]==null||!isFinite(n))?null:+(n*factor).toFixed(2)});
 return {ok:true,macros:macros,confianza:lectura.confianza||'media'};
}

// ---------------------------------------------------------------------------
// Etiquetas de dieta
// ---------------------------------------------------------------------------
// Se calculan a partir de los macros POR PORCIÓN, con los cortes que usan las
// etiquetas de alimentos (FDA) donde existen.
//
// Regla de oro: NO se pone ninguna etiqueta si falta algún ingrediente por
// cubrir. Un "sin azúcar" en una receta de la que sólo se conocen tres de cinco
// ingredientes no es un dato incompleto: es un dato falso, y alguien que evita
// el azúcar por salud podría creerlo.
const BADGES=[
 {k:'sinAzucar', n:'Sin azúcar',      emoji:'🍭',
  d:'Menos de 0.5 g de azúcar por porción',
  test:p=>p.azucar<=0.5},
 {k:'bajoAzucar',n:'Bajo en azúcar',  emoji:'🍬',
  d:'5 g de azúcar o menos por porción',
  test:p=>p.azucar>0.5&&p.azucar<=5},
 {k:'keto',      n:'Keto',            emoji:'🥑',
  d:'Pocos carbohidratos netos y mayoría de calorías de grasa',
  test:p=>p.calorias>0&&(p.carbohidratos-(p.fibra||0))<=10&&(p.grasa*9)/p.calorias>=0.6},
 {k:'gymReady',  n:'GymReady',        emoji:'💪',
  d:'Buena carga de proteína por porción',
  test:p=>p.proteina>=10&&p.calorias>0&&(p.proteina*4)/p.calorias>=0.2},
 {k:'altaFibra', n:'Alta en fibra',   emoji:'🌾',
  d:'5 g de fibra o más por porción',
  test:p=>p.fibra>=5},
 {k:'bajoGrasa', n:'Bajo en grasa',   emoji:'🪶',
  d:'3 g de grasa o menos por porción',
  test:p=>p.grasa<=3},
 {k:'bajoSodio', n:'Bajo en sodio',   emoji:'🧂',
  d:'140 mg de sodio o menos por porción',
  test:p=>p.sodioMg<=140}];

// Paleo NO se puede deducir de los macros: no es una cuestión de cantidades
// sino de qué lleva la receta. Se mira por nombre de ingrediente, y por eso es
// deliberadamente estricta: ante la duda, no se pone.
const NO_PALEO=['suero','caseina','caseína','gluten','centeno','cebada','malta','nata','condensada',
 'harina','trigo','azucar','azúcar','leche','crema','queso',
 'mantequilla','yogur','yoghurt','maiz','maíz','arroz','avena','frijol','soya',
 'lenteja','garbanzo','cacahuate','maní','mani','levadura','margarina','pan',
 'galleta','cereal','sirope','jarabe'];
// Excepciones: estas sí son paleo aunque el nombre contenga una palabra vetada.
const SI_PALEO=['harina de almendra','harina de coco','harina de yuca',
 'harina de castaña','leche de coco','leche de almendra'];

function esPaleo(ingredientes){
 if(!ingredientes.length)return false;
 return ingredientes.every(ing=>{
  const n=String(ing.name||'').toLowerCase();
  if(SI_PALEO.some(ok=>n.includes(ok)))return true;
  return !NO_PALEO.some(mal=>n.includes(mal))})}

/**
 * Etiquetas de una receta.
 *
 * Devuelve también por qué no hay etiquetas, para poder decírselo en vez de
 * dejar un hueco sin explicación.
 */
function recipeBadges(r,ingredientsById){
 const m=recipeMacros(r,ingredientsById);
 if(!m.total)return {badges:[],motivo:'sin-ingredientes',macros:m};
 if(!m.completo)return {badges:[],motivo:'faltan-datos',macros:m};

 const p=m.perServing;
 const out=BADGES.filter(b=>{try{return b.test(p)}catch(e){return false}})
                 .map(b=>({k:b.k,n:b.n,emoji:b.emoji,d:b.d}));

 // Paleo se evalúa aparte, sobre los ingredientes de verdad.
 const usados=(r.ingredients||[]).map(l=>ingredientsById[l.ingredientId]).filter(Boolean);
 if(usados.length===(r.ingredients||[]).length&&esPaleo(usados)){
  out.push({k:'paleo',n:'Paleo',emoji:'🥥',d:'Sin harinas, lácteos ni azúcar añadida'})}

 return {badges:out,motivo:out.length?null:'ninguna',macros:m}}

// Todas las etiquetas posibles, para armar el filtro.
const ALL_BADGES=BADGES.map(b=>({k:b.k,n:b.n,emoji:b.emoji,d:b.d}))
 .concat([{k:'paleo',n:'Paleo',emoji:'🥥',d:'Sin harinas, lácteos ni azúcar añadida'}]);

return {UNITS:UNITS, unitInfo:unitInfo, FRACCIONES:FRACCIONES, PALABRAS:PALABRAS,
        parseQty:parseQty, prettyQty:prettyQty, unitFamily:unitFamily, baseCost:baseCost,
        displayCost:displayCost, COST_MIN:COST_MIN,
        recipeCost:recipeCost, recipePrice:recipePrice, recipeUnitCost:recipeUnitCost,
        recipeMargin:recipeMargin, suggestPrice:suggestPrice,
        MACROS:MACROS, MACRO_KEYS:MACRO_KEYS, hasMacros:hasMacros,
        macroPerBase:macroPerBase, recipeMacros:recipeMacros,
        normalizarEtiqueta:normalizarEtiqueta,
        BADGES:BADGES, ALL_BADGES:ALL_BADGES,
        recipeBadges:recipeBadges, esPaleo:esPaleo};
});
