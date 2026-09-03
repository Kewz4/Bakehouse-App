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
 g:{f:1,fam:'masa',n:'gramos (g)',s:'g',sys:'metrico'},
 kg:{f:1000,fam:'masa',n:'kilos (kg)',s:'kg',sys:'metrico'},
 lb:{f:453.592,fam:'masa',n:'libras (lb)',s:'lb',sys:'imperial'},
 oz:{f:28.3495,fam:'masa',n:'onzas (oz)',s:'oz',sys:'imperial'},
 ml:{f:1,fam:'volumen',n:'mililitros (ml)',s:'ml',sys:'metrico'},
 l:{f:1000,fam:'volumen',n:'litros (L)',s:'L',sys:'metrico'},
 taza:{f:240,fam:'volumen',n:'tazas',s:'taza',sys:'casero'},
 cda:{f:15,fam:'volumen',n:'cucharadas',s:'cda',sys:'casero'},
 cdta:{f:5,fam:'volumen',n:'cucharaditas',s:'cdta',sys:'casero'},
 u:{f:1,fam:'conteo',n:'unidades',s:'u',sys:'conteo'},
 docena:{f:12,fam:'conteo',n:'docenas',s:'docena',sys:'conteo'}};
/** La unidad de referencia de una familia: el gramo, el mililitro, la unidad. */
const baseUnit=fam=>Object.values(UNITS).find(u=>u.fam===fam&&u.f===1)||UNITS.u;
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
 * Manda la unidad que ELLA eligió: si compra la harina en kilos, quiere verla
 * en kilos, no en onzas. Sólo se cambia cuando su unidad daría "$0.00" —una
 * harina de $1.25 la bolsa de 459 g sale a $0.0027 el gramo, y a dos decimales
 * eso es cero—; ahí se sube a la unidad más pequeña que pase de 10 centavos.
 */
const COST_READABLE=0.01;   // por debajo de esto se ve como "$0.00"
const COST_MIN=0.10;        // al subir de unidad, se busca al menos esto
function displayCost(ing){
 return legible(baseCost(ing),unitFamily((ing&&ing.unitSingle)||'g'),(ing&&ing.unitSingle)||'g')}

/**
 * Elige la unidad en la que un precio se puede leer.
 *
 * Manda la unidad que ELLA eligió. Sólo se cambia cuando su unidad daría
 * "$0.00" —una harina de $1.25 la bolsa de 459 g sale a $0.0027 el gramo, y a
 * dos decimales eso es cero—, y aun entonces se busca dentro de su mismo
 * sistema de medida: quien compra en gramos quiere ver kilos, no onzas.
 */
function legible(porBase,fam,preferida){
 const pref=unitInfo(preferida);
 const propio=pref.fam===fam?pref.f:1;
 if(porBase*propio>=COST_READABLE)return {amount:porBase*propio,unit:pref.fam===fam?pref.s:baseUnit(fam).s};

 const todas=Object.entries(UNITS).filter(([k,v])=>v.fam===fam).sort((a,b)=>a[1].f-b[1].f);
 const mismoSistema=todas.filter(([k,v])=>v.sys===pref.sys);
 const busca=lista=>lista.find(([k,v])=>porBase*v.f>=COST_MIN);
 const elegida=busca(mismoSistema)||busca(todas)||todas[todas.length-1];
 if(!elegida)return {amount:porBase*propio,unit:pref.s};
 return {amount:porBase*elegida[1].f,unit:elegida[1].s}}

// ---------------------------------------------------------------------------
// Qué clase de cosa es
// ---------------------------------------------------------------------------
// El empaque no se come pero cuesta dinero, y es un gasto tan recurrente como
// la harina: va en la misma lista, con su propia categoría. Eso tiene una
// consecuencia que hay que tratar aparte — una caja no tiene macros, y sin esto
// una receta con caja no conseguiría nunca una etiqueta de dieta, porque le
// faltaría "un ingrediente por cubrir".
const KINDS=[
 {k:'ingrediente',n:'Ingrediente',emoji:'🥣'},
 {k:'fruta',      n:'Fruta y verdura',emoji:'🍎'},
 {k:'empaque',    n:'Empaque',emoji:'📦'}];
const KIND_KEYS=KINDS.map(k=>k.k);

function kindOf(ing){
 if(!ing)return 'ingrediente';
 if(KIND_KEYS.includes(ing.kind))return ing.kind;
 // Antes esto era un interruptor de sí/no para la fruta. Lo que ella marcó
 // entonces sigue mandando sobre la detección por nombre.
 if(ing.fruta===true)return 'fruta';
 if(ing.fruta===false)return 'ingrediente';
 return nombreEsFruta(ing.name)?'fruta':'ingrediente'}

/** El empaque cuesta, pero no alimenta: no cuenta ni suma ni resta macros. */
const aportaMacros=ing=>kindOf(ing)!=='empaque';

// ---------------------------------------------------------------------------
// Cuánto pesa una pieza
// ---------------------------------------------------------------------------
// Una caja de 24 barras de mantequilla son 24 unidades, y además cada barra
// pesa 113 g. Con ese dato salen dos cosas: el costo se puede dar por barra Y
// por gramo, y una receta puede pedir 200 g de mantequilla aunque la compra se
// haga por barras. Es opcional: sin él todo sigue funcionando como antes.
function unitWeight(ing){
 if(!ing)return null;
 const n=+ing.unitWeight;
 if(!isFinite(n)||n<=0)return null;
 const clave=ing.unitWeightUnit||'g';
 const u=unitInfo(clave);
 // "cada unidad pesa 3 unidades" no dice nada; hace falta peso o volumen.
 if(u.fam==='conteo')return null;
 return {amount:n,unit:clave,short:u.s,base:n*u.f,fam:u.fam}}

/**
 * Cuántas unidades base del ingrediente vale UNA de `lineUnit`.
 *
 * Es lo que convierte "dos cucharadas" en un costo cuando la leche se compró
 * por litros, y "200 g" en un costo cuando la mantequilla se compró por barras.
 * Devuelve null cuando la conversión no se puede hacer sin inventarse un dato:
 * de mililitros a gramos hace falta la densidad, y adivinarla daría un número
 * tan convincente como equivocado.
 */
function unitFactor(ing,lineUnit){
 const propiaKey=(ing&&ing.unitSingle)||'g';
 const propia=unitFamily(propiaKey);
 const li=unitInfo(lineUnit);
 if(li.fam===propia)return {factor:li.f,via:lineUnit===propiaKey?null:'misma-familia'};
 const w=unitWeight(ing);
 if(!w)return null;
 // Se compra por piezas y la receta pide peso o volumen.
 if(propia==='conteo'&&li.fam===w.fam)return {factor:li.f/w.base,via:'pieza'};
 // Se compra por peso o volumen y la receta pide piezas.
 if(li.fam==='conteo'&&propia===w.fam)return {factor:li.f*w.base,via:'pieza'};
 return null}

/** Lo que cuesta una unidad de `lineUnit` de este ingrediente. */
function lineUnitCost(ing,lineUnit){
 const f=unitFactor(ing,lineUnit);
 return f?baseCost(ing)*f.factor:null}

/**
 * Qué se convirtió, en palabras, para poder explicárselo a quien lo lea.
 * Devuelve null cuando no hubo conversión ninguna.
 */
function conversionInfo(ing,lineUnit,qty){
 const f=unitFactor(ing,lineUnit);
 if(!f||!f.via)return null;
 const n=+qty||0;
 const propiaKey=(ing&&ing.unitSingle)||'g';
 const propia=unitInfo(propiaKey);
 // El factor lleva a unidades BASE, así que la equivalencia se dice en la
 // unidad base de la familia: "30 ml", no "30 L".
 const base=baseUnit(unitFamily(propiaKey));
 const equivale=n*f.factor;
 const w=unitWeight(ing);
 const izq=prettyQty(n)+' '+unitInfo(lineUnit).s;
 const der=prettyQty(+equivale.toFixed(3))+' '+base.s;
 // "80 g = 80 g" es verdad y no sirve de nada. Pasa cuando la receta ya pide
 // la unidad base de la familia (gramos, mililitros): la conversión existe
 // —la harina se compró en libras— pero la frase no la enseña, y un aviso que
 // no dice nada acaba enseñando a ignorar los avisos que sí dicen algo.
 if(izq===der)return null;
 return {via:f.via,
  texto:izq+' = '+der,
  detalle:f.via==='pieza'&&w
   ? 'Compras '+(ing.name||'esto')+' por '+propia.n+', y cada una pesa '+prettyQty(w.amount)+' '+w.short+'. Con eso la cuenta sale sola.'
   : 'Compras '+(ing.name||'esto')+' por '+propia.n+'. Son la misma medida, así que la equivalencia es exacta.'}}

/**
 * A cuánto sale, en las formas que se pueden leer de un vistazo.
 *
 * Siempre la unidad en que se compra. Y además, cuando se sabe cuánto pesa una
 * pieza, el precio por peso: una caja de 7 barras a $7 son $1 la barra, y si
 * cada barra trae 113 g, también $0.0088 el gramo — que es el número que hace
 * falta cuando la receta pide gramos.
 */
function costBreakdown(ing){
 const salidas=[displayCost(ing)];
 const w=unitWeight(ing);
 if(!w)return salidas;
 const propia=unitFamily((ing&&ing.unitSingle)||'g');
 // Sólo tiene sentido enseñar la otra cara: si se compra por piezas, el peso;
 // si se compra por peso, la pieza.
 const otra=propia==='conteo'?w.fam:'conteo';
 const porBase=baseCost(ing);
 if(propia==='conteo'){
  const porUnidadDePeso=porBase/w.base;      // $ por gramo o por ml
  salidas.push(legible(porUnidadDePeso,w.fam,w.unit));
 }else if(propia===w.fam){
  salidas.push({amount:porBase*w.base,unit:'unidad'});
 }
 return salidas}

// ---------------------------------------------------------------------------
// Sobre qué cantidad se leen los macros
// ---------------------------------------------------------------------------
// Las etiquetas vienen por 100 g o por 100 ml, y así se guardan. Pero "por cada
// 100 unidades" no lo lee nadie: los datos de una banana se dicen POR BANANA,
// no por cien bananas. Se sigue guardando igual —por 100 unidades base, para
// que las cuentas de receta no cambien— y se enseña por pieza.
function macroBasis(unitSingle){
 const fam=unitFamily(unitSingle||'g');
 if(fam==='conteo')return {amount:1,unit:'unidad',etiqueta:'cada unidad',factor:100};
 const u=unitInfo(unitSingle);
 return {amount:100,unit:u.s,etiqueta:'100 '+u.s,factor:1}}

/** De lo que ella escribe a lo que se guarda. */
function macroToStore(valor,unitSingle){
 const n=+valor;
 if(valor==null||valor===''||!isFinite(n))return null;
 return +(n*macroBasis(unitSingle).factor).toFixed(4)}

/** De lo guardado a lo que se enseña. */
function macroToShow(valor,unitSingle){
 const n=+valor;
 if(valor==null||valor===''||!isFinite(n))return null;
 return +(n/macroBasis(unitSingle).factor).toFixed(2)}

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
 {k:'azucarAnadida', n:'Azúcares añadidos',u:'g'},
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
 // El empaque queda fuera de la cuenta entera: no aporta nada y tampoco
 // puede impedir que la receta consiga etiquetas por "faltarle un
 // ingrediente", porque una caja no es un ingrediente.
 const comestibles=lines.filter(l=>{
  const ing=ingredientsById&&ingredientsById[l.ingredientId];
  return !ing||aportaMacros(ing)});
 comestibles.forEach(l=>{
  const ing=ingredientsById&&ingredientsById[l.ingredientId];
  if(!ing||!hasMacros(ing))return;
  // La cantidad de la línea llevada a unidades base. Puede cruzar de contar a
  // pesar cuando se sabe cuánto pesa una pieza (200 g de mantequilla que se
  // compra por barras), y por eso no basta con el factor de la unidad.
  const f=unitFactor(ing,l.unit||ing.unitSingle);
  if(!f)return;
  const base=(+l.qty||0)*f.factor;
  MACRO_KEYS.forEach(k=>{totals[k]+=base*macroPerBase(ing,k)});
  contadas++});
 const porciones=(+r.yield||1)||1;
 const perServing={};MACRO_KEYS.forEach(k=>perServing[k]=totals[k]/porciones);
 return {totals:totals, perServing:perServing,
         contadas:contadas, total:comestibles.length,
         completo:contadas===comestibles.length&&comestibles.length>0};
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

/**
 * Convierte unos valores de referencia (por 100 g) a lo que se guarda.
 *
 * Una banana no trae etiqueta, pero sus datos son conocimiento general. El
 * modelo aporta los valores por 100 g y cuánto pesa una pieza típica; la cuenta
 * se hace aquí, por lo mismo de siempre: una división mal hecha por el modelo
 * se ve igual de convincente que una bien hecha, y aquí acaba en un precio o en
 * una etiqueta de dieta.
 *
 * `gramosPorPieza` sólo hace falta cuando el ingrediente se cuenta.
 */
function normalizarReferencia(por100g,gramosPorPieza,unitSingle){
 if(!por100g)return {ok:false,motivo:'sin-datos'};
 const tieneAlgo=MACRO_KEYS.some(k=>por100g[k]!=null&&isFinite(+por100g[k]));
 if(!tieneAlgo)return {ok:false,motivo:'sin-datos'};

 const fam=unitFamily(unitSingle||'g');

 // De gramos a mililitros hace falta la densidad, y no es la misma para un
 // jugo que para un puré. Inventarla daría un número creíble y falso.
 if(fam==='volumen')return {ok:false,motivo:'sin-densidad'};

 let factor;
 if(fam==='masa'){
  factor=1;                     // ya viene por 100 g, que es como se guarda
 }else{
  const g=+gramosPorPieza;
  if(!isFinite(g)||g<=0)return {ok:false,motivo:'sin-peso'};
  // Guardado = por 100 piezas. Una pieza aporta por100g x g/100, así que cien
  // piezas aportan por100g x g.
  factor=g;
 }

 const macros={};
 MACRO_KEYS.forEach(k=>{const n=+por100g[k];
  macros[k]=(por100g[k]==null||!isFinite(n))?null:+(n*factor).toFixed(2)});
 return {ok:true,macros:macros,gramosPorPieza:+gramosPorPieza||null};
}

// ---------------------------------------------------------------------------
// Inversión y gastos
// ---------------------------------------------------------------------------
// Tres cosas distintas que antes eran una sola:
//
//   gasto       una compra suelta de este mes (el gas, unas cajas)
//   inversion   maquinaria y compras de una vez. Cuesta una vez y sirve años.
//   recurrente  algo que se repite: cada semana o cada mes, sin volver a anotarlo
//
// La inversión NO se resta de la ganancia del mes. Una batidora de $2000 no
// hace que un mes bueno parezca un desastre: se compra una vez y trabaja
// durante años. Se cuenta aparte, que es justo lo que él pidió — saber cuánto
// lleva invertido.
const TIPOS_GASTO=[
 {k:'gasto',      n:'Gasto',      d:'Una compra de este mes'},
 {k:'inversion',  n:'Inversión',  d:'Maquinaria y cosas que se compran una vez'},
 {k:'recurrente', n:'Recurrente', d:'Se repite solo cada semana o cada mes'}];
const FRECUENCIAS=[
 {k:'semanal',n:'Cada semana',dias:7},
 {k:'mensual',n:'Cada mes',dias:null}];

const tipoGasto=x=>{const t=x&&x.tipo;
 return TIPOS_GASTO.some(z=>z.k===t)?t:'gasto'};
const frecuenciaDe=x=>(x&&x.frecuencia)==='semanal'?'semanal':'mensual';

// Se pasa por aquí para poder fijar "hoy" en las pruebas sin tocar el reloj.
let ahoraFn=()=>new Date();
function fijarAhora(fn){ahoraFn=fn||(()=>new Date())}

/** Una fecha suelta a medianoche, sin que el huso horario la corra un día. */
function fechaDe(v){
 if(v instanceof Date)return isNaN(v)?null:v;
 const t=String(v||'');
 const d=new Date(t.length<=10?t+'T12:00:00':t);
 return isNaN(d)?null:d}

/**
 * Cuántas veces cae un gasto recurrente dentro de un período.
 *
 * Se anota una vez ("$50 al mes de gas") y a partir de su fecha se repite solo.
 * Contar sólo la anotación haría que un gasto de enero no apareciera en marzo,
 * y el margen del negocio saldría mejor de lo que es.
 */
function vecesEnRango(x,desde,hasta){
 const inicio=fechaDe(x&&x.date);
 if(!inicio||!desde||!hasta)return 0;

 // Nunca hacia el futuro: el internet del mes que viene todavía no se ha
 // pagado. Importa más de lo que parece — los períodos de la app terminan en
 // una fecha abierta y muy lejana, así que sin este tope un gasto mensual se
 // contaría miles de veces y la ganancia saldría catastrófica.
 // El final de HOY, no el instante actual: las fechas sueltas se normalizan a
 // mediodía para que el huso horario no las corra un día, y comparar contra la
 // hora exacta dejaba fuera la cuota que toca hoy mismo.
 const hoy=ahoraFn();
 const ahora=new Date(hoy.getFullYear(),hoy.getMonth(),hoy.getDate(),23,59,59,999);
 const fin=fechaDe(x&&x.hasta);
 let tope=hasta<ahora?hasta:ahora;
 if(fin&&fin<tope)tope=fin;
 if(tope<desde||inicio>tope)return 0;

 let n=0;
 const cursor=new Date(inicio);
 const semanal=frecuenciaDe(x)==='semanal';
 // Un tope duro: si alguien pone una fecha de hace veinte años, contar semana
 // a semana no debe quedarse dando vueltas.
 const MAX=5000;
 while(cursor<=tope&&n<MAX){
  if(cursor>=desde)n++;
  if(semanal)cursor.setDate(cursor.getDate()+7);
  else cursor.setMonth(cursor.getMonth()+1);
 }
 return n}

/**
 * Cuántos se compraron. Un rollo de papel pergamino vale $1.25 y ella compra
 * dos: el gasto son $2.50, pero el precio que anotó —y el que reconocerá la
 * próxima vez— sigue siendo $1.25.
 *
 * Lo anotado antes de que existiera este campo no lleva cantidad, y vale uno:
 * así los números de siempre siguen dando lo mismo.
 */
function cantidadDe(x){
 const n=+((x&&x.cantidad)!=null?x.cantidad:1);
 return isFinite(n)&&n>0?n:1}

/** Lo que costó de verdad: el precio de uno por cuántos se llevaron. */
function montoBase(x){
 return (+((x&&x.amount)||0)||0)*cantidadDe(x)}

/** Cuánto suma un gasto dentro de un período. */
function montoEnRango(x,desde,hasta){
 const monto=montoBase(x);
 if(tipoGasto(x)!=='recurrente'){
  const d=fechaDe(x&&x.date);
  return d&&d>=desde&&d<=hasta?monto:0}
 return monto*vecesEnRango(x,desde,hasta)}

/**
 * Reparte los gastos de un período en las tres cosas que son.
 *
 * `operativo` es lo que se resta de la ganancia. `inversion` no: se acumula
 * aparte para poder decir cuánto lleva puesto en el negocio.
 */
function desgloseGastos(lista,desde,hasta){
 const out={operativo:0,inversion:0,recurrente:0,sueltos:0,total:0};
 (lista||[]).forEach(x=>{
  const monto=montoEnRango(x,desde,hasta);
  if(!monto)return;
  const t=tipoGasto(x);
  if(t==='inversion')out.inversion+=monto;
  else if(t==='recurrente')out.recurrente+=monto;
  else out.sueltos+=monto});
 out.operativo=out.sueltos+out.recurrente;
 out.total=out.operativo+out.inversion;
 return out}

// ---------------------------------------------------------------------------
// Períodos
// ---------------------------------------------------------------------------
const PERIODOS=['day','week','month','quarter','semester','year','all','custom'];
const MESES_ES=['enero','febrero','marzo','abril','mayo','junio','julio',
                'agosto','septiembre','octubre','noviembre','diciembre'];

/**
 * De qué fechas se habla cuando se elige un período.
 *
 * `offset` es cuántos períodos atrás: 0 es el de ahora, -1 el anterior. Existe
 * para poder preguntar "¿y en agosto?" sin escribir fechas.
 *
 * El final es el final DE VERDAD del período, no una fecha abierta y lejana.
 * Antes "agosto" significaba "agosto en adelante", y por eso mirar hacia atrás
 * no servía de nada: todos los meses daban el mismo número. Lo que se repite
 * solo sigue sin contarse hacia el futuro, de eso se encarga vecesEnRango.
 */
function rangoDePeriodo(clave,offset,hoy){
 const f=PERIODOS.includes(clave)?clave:'month';
 const o=Math.min(0,+offset||0);
 const h=hoy||ahoraFn();
 const finDe=d=>new Date(d.getFullYear(),d.getMonth(),d.getDate(),23,59,59,999);
 const mayus=t=>t.charAt(0).toUpperCase()+t.slice(1);
 let desde,hasta,etiqueta;

 if(f==='day'){
  desde=new Date(h.getFullYear(),h.getMonth(),h.getDate()+o);
  hasta=finDe(desde);
  etiqueta=o===0?'Hoy':o===-1?'Ayer':`${desde.getDate()} de ${MESES_ES[desde.getMonth()]}`;
 }else if(f==='week'){
  desde=new Date(h.getFullYear(),h.getMonth(),h.getDate()-((h.getDay()+6)%7)+o*7);
  hasta=finDe(new Date(desde.getFullYear(),desde.getMonth(),desde.getDate()+6));
  etiqueta=o===0?'Esta semana':`Semana del ${desde.getDate()} de ${MESES_ES[desde.getMonth()]}`;
 }else if(f==='month'){
  desde=new Date(h.getFullYear(),h.getMonth()+o,1);
  hasta=finDe(new Date(desde.getFullYear(),desde.getMonth()+1,0));
  etiqueta=mayus(MESES_ES[desde.getMonth()])+(desde.getFullYear()!==h.getFullYear()?' '+desde.getFullYear():'');
 }else if(f==='quarter'){
  desde=new Date(h.getFullYear(),(Math.floor(h.getMonth()/3)+o)*3,1);
  hasta=finDe(new Date(desde.getFullYear(),desde.getMonth()+3,0));
  etiqueta=`Trimestre: ${MESES_ES[desde.getMonth()]} a ${MESES_ES[hasta.getMonth()]}`;
 }else if(f==='semester'){
  desde=new Date(h.getFullYear(),((h.getMonth()<6?0:1)+o)*6,1);
  hasta=finDe(new Date(desde.getFullYear(),desde.getMonth()+6,0));
  etiqueta=`Semestre: ${MESES_ES[desde.getMonth()]} a ${MESES_ES[hasta.getMonth()]}`;
 }else if(f==='year'){
  desde=new Date(h.getFullYear()+o,0,1);
  hasta=finDe(new Date(desde.getFullYear(),11,31));
  etiqueta=String(desde.getFullYear());
 }else{
  // 'all' y 'custom' no se mueven: no hay "el todo anterior".
  desde=new Date(1900,0,1);hasta=finDe(h);etiqueta='Desde el inicio';
 }
 return {desde:desde,hasta:hasta,etiqueta:etiqueta,movible:f!=='all'&&f!=='custom'}}

/**
 * Todo lo que lleva puesto el negocio desde que empezó.
 *
 * No es lo mismo que la inversión: la inversión es la batidora y los moldes,
 * lo que se compra una vez y se queda. Esto es TODO — la batidora, los moldes,
 * y también cada rollo de papel que se ha ido comprando semana tras semana
 * desde el primer día. Es la pregunta de "¿cuánto llevamos metido aquí?".
 *
 * El principio es la fecha del gasto más viejo que haya anotado, no una fecha
 * fija: el negocio empezó cuando empezó. Y el final es hoy, nunca el futuro —
 * de eso ya se encarga vecesEnRango.
 */
function desdeElInicio(lista){
 const fechas=(lista||[]).map(x=>fechaDe(x&&x.date)).filter(Boolean);
 if(!fechas.length)return {operativo:0,inversion:0,recurrente:0,sueltos:0,total:0,desde:null};
 const desde=new Date(Math.min.apply(null,fechas.map(d=>d.getTime())));
 const hoy=ahoraFn();
 const hasta=new Date(hoy.getFullYear(),hoy.getMonth(),hoy.getDate(),23,59,59,999);
 const out=desgloseGastos(lista,desde,hasta);
 out.desde=desde;
 return out}

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
// Las dos de azúcar se deciden aparte, en recipeBadges(): dependen de la
// azúcar AÑADIDA y de si la receta lleva fruta, no sólo de los macros.
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

// La fruta lleva fructosa aunque no tenga azúcar añadida, así que una receta
// con fruta nunca es "sin azúcar": es "baja en azúcar". Se detecta por el
// nombre, pero `fruta: true/false` en el ingrediente manda sobre eso — así una
// ralladura de limón se puede desmarcar a mano.
//
// El coco queda fuera a propósito: la harina y la leche de coco casi no traen
// azúcar y marcarlas como fruta arruinaría las recetas keto.
const FRUTAS=['fresa','frambuesa','mora','zarzamora','arandano','arándano','blueberry',
 'mango','banano','banana','platano','plátano','manzana','pera','piña','pina','durazno',
 'melocoton','melocotón','cereza','uva','pasas','naranja','mandarina','limon','limón',
 'kiwi','papaya','sandia','sandía','melon','melón','maracuya','maracuyá','guayaba',
 'datil','dátil','higo','ciruela','granada','tamarindo','maranon','marañón','jocote',
 'mamey','zapote','anona','nispero','níspero','lichi','carambola','fruta'];
function nombreEsFruta(nombre){
 const n=String(nombre||'').toLowerCase();
 return FRUTAS.some(f=>n.includes(f))}
/** ¿Cuenta como fruta para las etiquetas de azúcar? */
function esFruta(ing){
 if(!ing)return false;
 return kindOf(ing)==='fruta'}

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

 // --- Azúcar -------------------------------------------------------------
 // "Sin azúcar" en el mercado quiere decir SIN AZÚCAR AÑADIDA: la leche tiene
 // lactosa y sigue vendiéndose como sin azúcar. Por eso se mira la añadida y
 // no la total. La excepción es la fruta: su fructosa es azúcar de verdad para
 // quien la cuenta, así que una receta con fruta nunca pasa de "baja".
 //
 // Si algún ingrediente no declara la azúcar añadida no se pone ninguna de las
 // dos: es una afirmación sobre salud y no se hace a medias.
 // El empaque no se come: ni aporta azúcar ni puede impedir que se sepa
 // cuánta lleva la receta.
 const comestiblesL=(r.ingredients||[]).filter(l=>{
  const ing=ingredientsById[l.ingredientId];
  return !ing||aportaMacros(ing)});
 const usadas=comestiblesL.map(l=>ingredientsById[l.ingredientId]).filter(Boolean);
 const sabemosAnadida=usadas.length===comestiblesL.length&&comestiblesL.length>0&&
   usadas.every(i=>i.macros&&i.macros.azucarAnadida!=null&&isFinite(+i.macros.azucarAnadida));
 if(sabemosAnadida){
  const anadida=p.azucarAnadida;
  const conFruta=usadas.some(esFruta);
  if(anadida<=0.5&&!conFruta){
   out.unshift({k:'sinAzucar',n:'Sin azúcar',emoji:'🍭',d:'Sin azúcar añadida'})}
  else if(anadida<=5){
   out.unshift({k:'bajoAzucar',n:'Bajo en azúcar',emoji:'🍬',
    d:conFruta?'Sin azúcar añadida, pero lleva fruta (fructosa)':'Poca azúcar añadida: 5 g o menos por porción'})}}

 // Paleo se evalúa aparte, sobre los ingredientes de verdad.
 const usados=(r.ingredients||[]).map(l=>ingredientsById[l.ingredientId])
   .filter(Boolean).filter(aportaMacros);
 const comestibles=(r.ingredients||[]).filter(l=>{
  const ing=ingredientsById[l.ingredientId];
  return !ing||aportaMacros(ing)});
 if(usados.length===comestibles.length&&esPaleo(usados)){
  out.push({k:'paleo',n:'Paleo',emoji:'🥥',d:'Sin harinas, lácteos ni azúcar añadida'})}

 return {badges:out,motivo:out.length?null:'ninguna',macros:m}}

// ---------------------------------------------------------------------------
// Textos de cabecera
// ---------------------------------------------------------------------------
// La regla de las pantallas es que el nombre se escribe UNA vez, y lo que va
// debajo tiene que aportar algo que el nombre no diga ya. Casi siempre eso es
// "cuántas cosas hay", y como la web y la app lo enseñan las dos, la frase se
// escribe aquí una sola vez.

/** "8 guardados", o "3 de 8" mientras hay una búsqueda escrita. */
function countLabel(shown,total,singular,plural){
 const t=Math.trunc(Number(total)||0), s=Math.trunc(Number(shown)||0);
 // En una pantalla vacía el mensaje que dice qué hacer está justo debajo; un
 // "0 recetas" encima de él sólo estorba.
 if(t<=0)return null;
 if(s!==t)return s+' de '+t;
 return t+' '+(t===1?singular:plural)}

/** Junta trozos con un punto, saltándose los que no existen. */
function joinDetail(parts){
 const kept=(parts||[]).filter(p=>typeof p==='string'&&p.length);
 return kept.length?kept.join(' · '):null}

// Todas las etiquetas posibles, para armar el filtro.
const ALL_BADGES=[
 {k:'sinAzucar',n:'Sin azúcar',emoji:'🍭',d:'Sin azúcar añadida'},
 {k:'bajoAzucar',n:'Bajo en azúcar',emoji:'🍬',d:'Poca azúcar añadida, o lleva fruta'}]
 .concat(BADGES.map(b=>({k:b.k,n:b.n,emoji:b.emoji,d:b.d})))
 .concat([{k:'paleo',n:'Paleo',emoji:'🥥',d:'Sin harinas, lácteos ni azúcar añadida'}]);

return {UNITS:UNITS, unitInfo:unitInfo, FRACCIONES:FRACCIONES, PALABRAS:PALABRAS,
        parseQty:parseQty, prettyQty:prettyQty, unitFamily:unitFamily, baseCost:baseCost,
        displayCost:displayCost, COST_MIN:COST_MIN, COST_READABLE:COST_READABLE,
        recipeCost:recipeCost, recipePrice:recipePrice, recipeUnitCost:recipeUnitCost,
        recipeMargin:recipeMargin, suggestPrice:suggestPrice,
        MACROS:MACROS, MACRO_KEYS:MACRO_KEYS, hasMacros:hasMacros,
        macroPerBase:macroPerBase, recipeMacros:recipeMacros,
        normalizarEtiqueta:normalizarEtiqueta,
        normalizarReferencia:normalizarReferencia,
        BADGES:BADGES, ALL_BADGES:ALL_BADGES,
        recipeBadges:recipeBadges, esPaleo:esPaleo,
        esFruta:esFruta, nombreEsFruta:nombreEsFruta, FRUTAS:FRUTAS,
        KINDS:KINDS, KIND_KEYS:KIND_KEYS, kindOf:kindOf, aportaMacros:aportaMacros,
        unitWeight:unitWeight, unitFactor:unitFactor, lineUnitCost:lineUnitCost,
        conversionInfo:conversionInfo, costBreakdown:costBreakdown,
        macroBasis:macroBasis, macroToStore:macroToStore, macroToShow:macroToShow,
        countLabel:countLabel, joinDetail:joinDetail,
        TIPOS_GASTO:TIPOS_GASTO, FRECUENCIAS:FRECUENCIAS, tipoGasto:tipoGasto,
        frecuenciaDe:frecuenciaDe, vecesEnRango:vecesEnRango, montoEnRango:montoEnRango,
        cantidadDe:cantidadDe, montoBase:montoBase,
        desgloseGastos:desgloseGastos, desdeElInicio:desdeElInicio,
        PERIODOS:PERIODOS, rangoDePeriodo:rangoDePeriodo,
        fijarAhora:fijarAhora};
});
