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

function recipeCost(r){return (r.ingredients||[]).reduce((s,i)=>s+(+i.qty||0)*(+i.cost||0),0)}function recipePrice(r){return +r.price||0}function recipeUnitCost(r){return recipeCost(r)/(+r.yield||1)}function recipeMargin(r){const p=recipePrice(r);return p?(p-recipeUnitCost(r))/p*100:0}function suggestPrice(r,target=65){return recipeUnitCost(r)/(1-target/100)}

return {UNITS:UNITS, unitInfo:unitInfo, FRACCIONES:FRACCIONES, PALABRAS:PALABRAS,
        parseQty:parseQty, prettyQty:prettyQty, unitFamily:unitFamily, baseCost:baseCost,
        recipeCost:recipeCost, recipePrice:recipePrice, recipeUnitCost:recipeUnitCost,
        recipeMargin:recipeMargin, suggestPrice:suggestPrice};
});
