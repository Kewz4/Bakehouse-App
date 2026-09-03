// Las unidades, el parseo de cantidades y las fórmulas de costo viven en
// business-core.js, para poder compararlas con las de la app de iPhone.
const $=s=>document.querySelector(s);const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(n)||0);
// ---------------------------------------------------------------------------
// Guardado y sincronización
// ---------------------------------------------------------------------------
// Todo se escribe primero en el dispositivo (instantáneo) y enseguida se sube.
// Si no hay internet, se queda esperando y sube solo cuando vuelve la señal.
// Nunca se pierde nada y nunca hay que tocar ningún botón.
//
// `data` guarda lo que se ve. `graves` guarda las lápidas de lo borrado, que
// viajan en la sincronización pero no se muestran (ver sync-core.js).
const KEY='olivo-liora-data-v2';
const LEGACY_KEY='olivo-liora-data-v1';
const S=window.SyncCore;
const COLS=S.COLLECTIONS;
const vacio=()=>({ingredients:[],recipes:[],sales:[],expenses:[]});
let data=vacio(),graves=vacio();
let CLOUD=false,syncing=false,otraVez=false,syncTimer=null,pullTimer=null,intentos=0,sucio=false;
// Sube en cada escritura: sirve para saber si ella escribió algo mientras
// una subida estaba en curso.
let escrituras=0;

// Documento completo tal como viaja por la red: lo vivo + las lápidas.
function toWire(){const doc=S.emptyDoc();COLS.forEach(k=>{doc[k]=data[k].concat(graves[k])});doc.updatedAt=Date.now();return doc}
// Al revés: separa lo que se muestra de lo que sólo sirve para sincronizar.
function fromWire(doc){const d=S.normalizeDoc(doc);COLS.forEach(k=>{data[k]=d[k].filter(r=>!r.deleted);graves[k]=d[k].filter(r=>r.deleted)});ordenar()}
function ordenar(){data.sales.sort((a,b)=>String(b.date).localeCompare(String(a.date)));data.expenses.sort((a,b)=>String(b.date).localeCompare(String(a.date)))}

function loadLocal(){
 let nuevo=null,viejo=null;
 try{nuevo=JSON.parse(localStorage.getItem(KEY)||'null')}catch(e){}
 try{viejo=JSON.parse(localStorage.getItem(LEGACY_KEY)||'null')}catch(e){}
 const cuantos=d=>d?COLS.reduce((n,k)=>n+(Array.isArray(d[k])?d[k].length:0),0):0;
 // Nos traemos lo de la versión anterior si todavía no hay documento nuevo, y
 // también si el nuevo quedó vacío: eso pasa si la app alcanzó a guardar un
 // documento en blanco antes de leer el viejo, y sin esto los datos de ella
 // quedarían escondidos para siempre. Un documento vacío no tiene nada que
 // perder, así que preferir el viejo siempre es seguro.
 const raw=(cuantos(nuevo)===0&&cuantos(viejo)>0)?viejo:(nuevo||viejo||S.emptyDoc());
 fromWire(raw||S.emptyDoc())}
function saveLocal(){try{localStorage.setItem(KEY,JSON.stringify(toWire()));return true}
 catch(e){toast('Tu teléfono se quedó sin espacio. Prueba borrando registros muy viejos.',true);return false}}

// Lo único que ve la usuaria sobre la sincronización. Sin tecnicismos y sin
// pedirle nada: o está guardado, o se está guardando, o se guardará solo.
function setSync(estado){const el=document.getElementById('syncStatus');if(!el)return;
 const textos={guardando:'Guardando…',guardado:'Todo guardado',espera:'Se guardará solo',local:'Guardado aquí'};
 el.textContent=textos[estado]||'';el.dataset.state=estado}

// Marca un registro como modificado ahora mismo. De esto depende que, al
// combinar, gane la versión más reciente.
const sello=rec=>{rec.updatedAt=Date.now();rec.deleted=false;return rec};

const save=(msg)=>{ordenar();if(!saveLocal())return false;
 render();if(msg)toast(msg);
 sucio=true;escrituras++;setSync(CLOUD?'guardando':'local');scheduleSync(400);return true};

// Lo último que el servidor dijo tener. Se le manda de vuelta para que pueda
// contestar "nada ha cambiado" sin mandar el documento entero: la app pregunta
// cada 30 segundos y casi siempre la respuesta es esa, así que mandar 16 kB
// para decirlo era gastar los datos móviles de los dos en nada.
let vistoEn=0;

function scheduleSync(ms){if(!CLOUD)return;clearTimeout(syncTimer);syncTimer=setTimeout(syncNow,ms==null?400:ms)}

// Sube lo local y baja lo remoto en un solo viaje: el servidor combina y nos
// devuelve el resultado ya unificado.
async function syncNow(){
 if(!CLOUD)return;
 if(syncing){otraVez=true;return}
 syncing=true;if(sucio)setSync('guardando');
 const enviado=toWire(),generacion=escrituras;
 try{
  const r=await fetch('api/data',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(enviado),cache:'no-store'});
  if(!r.ok)throw new Error('http '+r.status);
  const j=await r.json();
  if(j.enabled===false){CLOUD=false;setSync('local');return}
  // Acabamos de recibir el documento entero: la próxima lectura puede pedir
  // sólo lo que haya cambiado a partir de aquí.
  if(j.updatedAt)vistoEn=j.updatedAt;
  if(j.doc){
   // Combinamos otra vez contra lo local por si la usuaria escribió algo
   // mientras el viaje estaba en curso.
   fromWire(S.mergeDocs(toWire(),j.doc));
   saveLocal();render()}
  intentos=0;
  // Sólo damos por sincronizado si el servidor de verdad tiene lo nuestro Y
  // ella no escribió nada nuevo mientras el viaje estaba en curso.
  sucio=!(S.contains(j.doc||S.emptyDoc(),enviado)&&escrituras===generacion);
  setSync(sucio?'espera':'guardado');
  if(sucio)scheduleSync(1500);
  // Acabamos de comprobar que hay señal: buen momento para subir las fotos que
  // se hayan quedado guardadas como texto. Si no hay ninguna, no hace nada.
  reconciliarFotos();
 }catch(e){
  // Sin señal o servidor caído: lo local queda intacto y reintentamos con
  // esperas cada vez más largas, hasta un minuto.
  intentos++;setSync('espera');
  scheduleSync(Math.min(60000,1000*Math.pow(2,Math.min(intentos,6))));
 }finally{
  syncing=false;
  if(otraVez){otraVez=false;scheduleSync(300)}}}

// Baja los cambios de los otros dispositivos sin subir nada.
async function pull(){
 if(!CLOUD||syncing)return;
 try{
  const r=await fetch('api/data'+(vistoEn?'?desde='+vistoEn:''),{cache:'no-store'});
  if(!r.ok)return;
  const j=await r.json();
  if(j.enabled===false){CLOUD=false;setSync('local');return}
  if(j.updatedAt)vistoEn=j.updatedAt;
  if(j.sinCambios)return;
  if(!j.doc)return;
  const antes=S.canonical(toWire());
  fromWire(S.mergeDocs(toWire(),j.doc));
  const despues=S.canonical(toWire());
  if(antes!==despues){saveLocal();render();if(!sucio)setSync('guardado')}
 }catch(e){/* sin señal: da igual, lo intentamos luego */}}

// Una foto tomada sin señal se queda guardada como texto (data:image/…) dentro
// del documento. Eso abulta cientos de kB por foto, no se ve en los otros
// dispositivos, y si se juntan varias el documento deja de caber y la
// sincronización se rompe del todo.
//
// Esto las va subiendo de una en una en cuanto hay internet y las reemplaza por
// su dirección. Se cura solo: las fotos se suben por su propio endpoint, así que
// funciona incluso si el documento ya está demasiado grande para subirse.
let subiendoFotos=false;
// ¿El servidor puede leer etiquetas? Si no, el botón de la cámara ni aparece:
// más vale no ofrecer algo que no va a funcionar.
let VISION=false;
async function checarVision(){try{const r=await fetch('api/vision',{cache:'no-store'});
 if(!r.ok)return;const j=await r.json();VISION=!!j.enabled}catch(e){VISION=false}}
async function reconciliarFotos(){
 if(!CLOUD||subiendoFotos)return;
 const pendientes=data.recipes.filter(r=>typeof r.photo==='string'&&r.photo.startsWith('data:'));
 if(!pendientes.length)return;
 subiendoFotos=true;
 try{let alguna=false;
  for(const r of pendientes){
   const url=await uploadPhoto(r.photo,(r.name||'postre')+'.jpg');
   if(!url)break;                    // sigue sin señal: se reintenta luego
   r.photo=url;sello(r);alguna=true}
  if(alguna){saveLocal();render();sucio=true;escrituras++;scheduleSync(300)}}
 finally{subiendoFotos=false}}

async function bootSync(){
 loadLocal();render();
 try{
  const r=await fetch('api/data',{cache:'no-store'});
  if(!r.ok)throw new Error('off');
  const j=await r.json();
  if(!j.enabled){CLOUD=false;setSync('local');return}
  CLOUD=true;
  if(j.doc){fromWire(S.mergeDocs(toWire(),j.doc));saveLocal();render()}
  // Subimos de una lo que hubiera quedado pendiente de la última vez.
  await syncNow();
  reconciliarFotos();
  arrancarVigilancia();
 }catch(e){CLOUD=false;setSync('local');
  // Puede que sólo sea que ahora no hay señal: si vuelve, reintentamos.
  window.addEventListener('online',()=>{if(!CLOUD)bootSync()},{once:true})}}

// Mantiene los dispositivos al día sin que nadie toque nada: al volver la
// señal, al volver a la pestaña, y cada 30 segundos mientras está abierta.
function arrancarVigilancia(){
 clearInterval(pullTimer);
 pullTimer=setInterval(()=>{if(document.visibilityState==='visible')pull()},30000);
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){pull();if(sucio)scheduleSync(200)}});
 window.addEventListener('focus',()=>pull());
 window.addEventListener('online',()=>{intentos=0;scheduleSync(200);pull();reconciliarFotos()});
 // Último intento de subir si cierra la pestaña con algo pendiente.
 window.addEventListener('pagehide',()=>{
  if(!CLOUD||!sucio||!navigator.sendBeacon)return;
  try{navigator.sendBeacon('api/data',new Blob([JSON.stringify(toWire())],{type:'application/json'}))}catch(e){}});}
// ---- Teclado propio para cantidades ----
// Evita que el teclado del teléfono acepte cosas raras: sólo números,
// fracciones y "Listo". Lo que se escribe siempre es válido.
let padTarget=null;
const PAD_KEYS=[['1','2','3','½'],['4','5','6','⅓'],['7','8','9','¼'],['.','0','⌫','¾']];
function padUnitLabel(input){const line=input.closest&&input.closest('.ingredient-line');
if(line){const u=(line.querySelector('[data-n=unit]')||{}).value;return unitInfo(u).s}
return input.dataset.padUnit||''}
function openPad(input){padTarget=input;
const pad=document.getElementById('pad');
pad.innerHTML=`<div class="pad-head"><span id="padPreview"></span><button type="button" class="pad-done" onclick="closePad()">Listo</button></div>
<div class="pad-keys">${PAD_KEYS.map(row=>row.map(k=>`<button type="button" class="pad-key${'½⅓¼¾'.includes(k)?' frac':''}${k==='⌫'?' del':''}" onclick="padKey('${k}')">${k}</button>`).join('')).join('')}
<button type="button" class="pad-key frac" onclick="padKey('⅔')">⅔</button>
<button type="button" class="pad-key frac" onclick="padKey('⅛')">⅛</button>
<button type="button" class="pad-key wide" onclick="padKey('C')">Borrar</button></div>`;
pad.classList.add('show');document.body.classList.add('pad-open');padPreview();setTimeout(()=>{const r=input.getBoundingClientRect(),limite=window.innerHeight-pad.offsetHeight-14;if(r.bottom>limite){const cont=input.closest('.dialog')||document.scrollingElement;cont.scrollBy({top:r.bottom-limite+12,behavior:'smooth'})}},60)}
function closePad(){document.getElementById('pad').classList.remove('show');document.body.classList.remove('pad-open');
if(padTarget){padTarget.blur();if(padTarget.oninput)padTarget.oninput()}
padTarget=null}
function padKey(k){if(!padTarget)return;
let v=padTarget.value||'';
if(k==='C')v='';
else if(k==='⌫')v=v.replace(/\s*.$/,'');
else if('½⅓¼¾⅔⅛'.includes(k)){if(/[\d]$/.test(v))v+=' ';v+=k}
else if(k==='.'){if(!/[.,]\d*$/.test(v))v+= v?'.':'0.'}
else v+=k;
padTarget.value=v;
if(padTarget.oninput)padTarget.oninput();
padPreview()}
function padPreview(){if(!padTarget)return;
const n=parseQty(padTarget.value),u=padUnitLabel(padTarget);
document.getElementById('padPreview').textContent=n?`${prettyQty(n)} ${u}`.trim():'Escribe una cantidad';}
// Se cierra con `pointerdown`, no con `click`, y eso importa: al abrirse, el
// teclado empuja el contenido para que el campo no quede debajo, y el `click`
// termina cayendo en otro sitio del que empezó. Con `click` ese aterrizaje
// contaba como "tocó fuera" y cerraba el teclado que el mismo dedo acababa de
// abrir. Con `pointerdown` el gesto se juzga ANTES de que el teclado exista, así
// que ya no puede cerrar lo que él mismo abrió.
document.addEventListener('pointerdown',e=>{const pad=document.getElementById('pad');
if(!pad||!pad.classList.contains('show'))return;
if(pad.contains(e.target)||e.target===padTarget)return;
if(e.target.dataset&&e.target.dataset.pad!=null)return;
closePad()},true);
function unitOptions(selected,family,excluir){return Object.entries(UNITS)
 .filter(([k,v])=>(!family||v.fam===family)&&!(excluir||[]).includes(v.fam))
 .map(([k,v])=>`<option value="${k}" ${k===selected?'selected':''}>${v.n}</option>`).join('')}
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtDate=d=>{if(!d)return '—';const m=String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);return m?`${m[3]}/${m[2]}/${m[1].slice(2)}`:d};
let toastTimer;function toast(msg,isError){const t=$('#toast');t.textContent=msg;t.className='show'+(isError?' err':'');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.className='',isError?4200:2400)}
// En qué pantallas tiene sentido preguntar "¿de cuándo?". Las recetas y los
// ingredientes son un catálogo: no cambian porque cambie el mes.
const VISTAS_CON_PERIODO=['dashboard','sales','expenses'];
function go(view){if(!document.getElementById(view))view='dashboard';document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===view));$('#fab').dataset.view=view;
const pp=$('#periodPanel');if(pp)pp.style.display=VISTAS_CON_PERIODO.includes(view)?'':'none';window.scrollTo({top:0,behavior:'smooth'});try{history.replaceState(null,'','#'+view)}catch(e){}}
function fabAction(){({dashboard:openSale,recipes:openRecipe,sales:openSale,expenses:openExpense,inventory:openIngredient}[$('#fab').dataset.view||'dashboard'])()}
function nav(){document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>go(b.dataset.view));
go((location.hash||'#dashboard').slice(1));
// Al abrir con "#dashboard" en la dirección, el navegador salta él solo hasta
// esa sección y deja la cabecera fuera de pantalla. Y lo hace DESPUÉS de que
// corra este script, así que no basta con subir aquí: hay que volver a subir
// cuando la página termina de cargar, y desactivar la restauración de posición
// que el navegador aplica al volver atrás.
try{history.scrollRestoration='manual'}catch(e){}
const arriba=()=>window.scrollTo(0,0);
arriba();
requestAnimationFrame(arriba);
window.addEventListener('load',arriba,{once:true});
window.addEventListener('hashchange',()=>go(location.hash.slice(1)))}
function render(){
const sales=data.sales.reduce((a,s)=>a+(+s.total||0),0);
const production=data.sales.reduce((a,s)=>{let r=data.recipes.find(x=>x.id===s.recipeId);return a+(r?recipeUnitCost(r)*(+s.qty||0):0)},0);
// Los gastos se calculan sobre la lista ENTERA y con el período a mano, no
// sobre la lista ya filtrada por fecha: un gasto recurrente se anota una vez y
// vale para todos los meses siguientes, así que filtrarlo por su fecha lo
// haría desaparecer del mes que viene y la ganancia saldría mejor de lo que es.
const {start:d0,end:d1}=periodRange();
const g=desgloseGastos((window.ALLDATA?window.ALLDATA.expenses:data.expenses)||[],d0,d1);
// La inversión NO se resta: una batidora de $2000 se compra una vez y trabaja
// durante años. Restarla del mes haría parecer un desastre un mes que fue bueno.
const profit=sales-production-g.operativo;
$('#mSales').textContent=money(sales);
$('#mCost').textContent=money(production);
$('#mExpenses').textContent=money(g.operativo);
$('#mProfit').textContent=money(profit);
$('#mMargin').textContent=sales?'Te quedan '+Math.round(profit/sales*100)+' centavos de cada dólar':'Aún sin ventas';
renderRecipes();renderTables();renderChart(sales);renderAlerts()}
// Filtro por etiqueta de dieta. Vacío = todas.
let filtroBadge='';
function setBadgeFilter(k){filtroBadge=(filtroBadge===k)?'':k;renderRecipes()}

// Sólo se ofrecen las etiquetas que de verdad tiene alguna receta: un filtro
// con opciones que no devuelven nada es peor que no tener filtro.
function badgeFilterRow(){
 const idx=ingredientsById();
 const cuenta={};
 data.recipes.forEach(r=>{recipeBadges(r,idx).badges.forEach(b=>{cuenta[b.k]=(cuenta[b.k]||0)+1})});
 const disponibles=ALL_BADGES.filter(b=>cuenta[b.k]);
 if(!disponibles.length)return '';
 return `<div class="badge-filters">${disponibles.map(b=>
  `<button class="bfilter${filtroBadge===b.k?' active':''}" onclick="setBadgeFilter('${b.k}')" title="${esc(b.d)}">${b.emoji} ${esc(b.n)} <span>${cuenta[b.k]}</span></button>`
 ).join('')}${filtroBadge?`<button class="bfilter clear" onclick="setBadgeFilter('')">Ver todas</button>`:''}</div>`}

/** Escribe "8 guardados" (o "3 de 8") bajo el título de una pantalla.
 *
 * Es lo único que va debajo del nombre de cada sección: antes había ahí un
 * antetítulo que decía lo mismo con otras palabras ("Lo que compras" encima de
 * "Ingredientes"). Un recuento sí dice algo que el título no dice.
 */
/**
 * Los cuatro números de la pantalla de Inversión.
 *
 * "Invertido en total" no mira el período a propósito: lo que él quiere saber
 * es cuánto lleva puesto en el negocio desde el principio, y eso no cambia
 * porque se mire un mes u otro.
 */
function renderInversion(desde,hasta){
 const todos=(window.ALLDATA?window.ALLDATA.expenses:data.expenses)||[];
 const g=desgloseGastos(todos,desde,hasta);
 const total=todos.filter(x=>tipoGasto(x)==='inversion').reduce((a,x)=>a+(+x.amount||0),0);
 const set=(sel,v)=>{const el=$(sel);if(el)el.textContent=money(v)};
 const inicio=desdeElInicio(todos);
 set('#iTotal',total);set('#iPeriodo',g.inversion);
 set('#iRecurrente',g.recurrente);set('#iSueltos',g.sueltos);
 set('#iDesdeInicio',inicio.total);
 const nota=$('#iDesdeInicioNota');
 if(nota)nota.textContent=inicio.desde
  ? 'Todo, desde el '+fmtDate(inicio.desde.toISOString().slice(0,10))
  : 'Todavía no hay nada anotado'}

// Qué categoría se está mirando. Vacío = todas.
let filtroKind='';
function setKindFilter(k){filtroKind=filtroKind===k?'':k;renderTables()}
function renderKindFilters(){
 const el=$('#kindFilters');if(!el)return;
 const cuenta=k=>data.ingredients.filter(x=>kindOf(x)===k).length;
 el.innerHTML=KINDS.map(k=>{const n=cuenta(k.k);
  return `<button class="kfilter${filtroKind===k.k?' active':''}" onclick="setKindFilter('${k.k}')">${k.emoji} ${k.n} <span>${n}</span></button>`}).join('')
  +(filtroKind?`<button class="kfilter clear" onclick="setKindFilter('')">Ver todo</button>`:'')}

function setCount(sel,shown,total,singular,plural){
 const el=$(sel);if(!el)return;
 const t=countLabel(shown,total,singular,plural);
 el.textContent=t||'';el.style.display=t?'':'none'}

function renderRecipes(){const q=(($('#recipeSearch')||{}).value||'').toLowerCase().trim();const idx=ingredientsById();
const list=data.recipes.filter(r=>(!q||(r.name||'').toLowerCase().includes(q))&&
 (!filtroBadge||recipeBadges(r,idx).badges.some(b=>b.k===filtroBadge)));
const el=$('#recipesList');
const fr=$('#badgeFilters');if(fr)fr.innerHTML=badgeFilterRow();
setCount('#recipeCount',list.length,data.recipes.length,'receta','recetas');
el.innerHTML=list.length?list.map(r=>{const c=recipeCost(r),u=recipeUnitCost(r),p=recipePrice(r),m=recipeMargin(r),cls=!p?'warn':m>=60?'ok':m>=45?'warn':'bad';return `<article class="recipe">${r.photo?`<img class="recipe-photo" src="${esc(r.photo)}" alt="${esc(r.name)}" loading="lazy">`:''}<span class="tag">${esc(r.yield)} porciones</span><h3>${esc(r.name)}</h3><small>${(r.ingredients||[]).length} ingredientes · costo por porción ${money(u)}</small><div class="recipe-data"><div><span>Costo total</span><b>${money(c)}</b></div><div><span>Precio / porción</span><b>${money(p)}</b></div></div><span class="badge ${cls}">${p?`Ganas ${m.toFixed(0)}% de cada venta`:'Falta ponerle precio'}</span>${p&&m<60?`<p class="helper">Cobrando <b>${money(suggestPrice(r))}</b> ganarías más</p>`:''}${macroSummary(r)}${faltaNutriRow(r,idx)}${badgeRow(r)}<div class="recipe-actions"><button onclick="openRecipe('${r.id}')">Editar</button><button onclick="duplicateRecipe('${r.id}')">Duplicar</button><button onclick="quickFromRecipe('${r.id}')">Calcular precio</button><button class="negative" onclick="removeItem('recipes','${r.id}')">Eliminar</button></div></article>`}).join(''):`<div class="empty">${q?'Ninguna receta coincide con tu búsqueda.':'Crea tu primer postre y calcula en un minuto cuánto cobrar.'}</div>`}
/**
 * La marca de "aquí falta algo".
 *
 * Dice cuántos ingredientes faltan de cuántos, no un "faltan datos" a secas:
 * "faltan 2 de 5" se puede arreglar esta tarde, "faltan datos" no dice por
 * dónde empezar. Una receta sin ingredientes no se marca: no le falta nada, es
 * que todavía no es una receta.
 */
function faltaNutriRow(r,idx){
 const p=nutricionPendiente(r,idx);
 if(!p||p.vacia)return '';
 return `<p class="falta-linea"><span class="falta">faltan ${p.faltan} de ${p.total}</span> por completar su información nutricional</p>`}

function duplicateRecipe(id){const r=data.recipes.find(x=>x.id===id);if(!r)return;data.recipes.push(sello({...r,id:crypto.randomUUID(),name:r.name+' (copia)',ingredients:(r.ingredients||[]).map(i=>({...i}))}));save('Receta duplicada')}
function quickFromRecipe(id){const r=data.recipes.find(x=>x.id===id);if(!r)return;
 abrirCalculadora(recipeUnitCost(r),r.name,id)}

/**
 * La calculadora de precio, en una ventana.
 *
 * Es la misma de la pantalla de recetas —los mismos dos modos, el mismo
 * deslizador— para que no haya que aprender dos cosas que hacen lo mismo. Se
 * abre con el costo de la receta ya puesto, que es el dato que hace falta y
 * el que nadie se sabe de memoria.
 */
let calcReceta=null;
/**
 * "Tengo esta bolsa de azúcar, ¿para cuántas tandas me da?"
 *
 * La misma ventana que la calculadora de precio, para que no parezcan dos
 * herramientas distintas. Se abre desde la lista de ingredientes, y desde una
 * fila concreta ya viene elegido el ingrediente.
 */
function abrirRendimiento(ingId){
 const ings=data.ingredients;
 if(!ings.length)return toast('Primero guarda algún ingrediente.',true);
 const elegido=ings.find(x=>x.id===ingId)||ings[0];
 openModal('¿Para cuánto me alcanza?',`
  <p class="helper">Dime cuánto tienes y para qué receta, y te digo cuántas tandas salen.</p>
  <div class="form-grid">
   <div class="field full"><label>¿De qué ingrediente?</label>
    <select id="rendIng" onchange="rendCambiaIngrediente()">
     ${ings.map(x=>`<option value="${x.id}" ${x.id===elegido.id?'selected':''}>${esc(x.name)}</option>`).join('')}
    </select></div>
   <div class="field"><label>¿Cuánto tienes?</label>
    <input id="rendQty" type="text" readonly data-pad="1" placeholder="toca para escribir"
     value="${prettyQty(elegido.quantity||1)}" onfocus="openPad(this)" onclick="openPad(this)" oninput="calcularRendimiento()"></div>
   <div class="field"><label>¿En qué medida?</label>
    <select id="rendUnit" onchange="calcularRendimiento()">${unitOptionsFor(elegido,elegido.unitSingle)}</select></div>
   <div class="field full"><label>¿Para qué receta?</label>
    <select id="rendReceta" onchange="calcularRendimiento()">${opcionesReceta(elegido)}</select></div>
  </div>
  <div class="calc-result pop"><span id="rendCaption">Te alcanza para</span><strong id="rendOut">—</strong></div>
  <p class="calc-warning info" id="rendNota"></p>
  <div class="modal-actions"><button class="btn alt" onclick="closeModal()">Cerrar</button></div>`);
 calcularRendimiento()}

/**
 * Las recetas que llevan este ingrediente.
 *
 * Cuando no hay ninguna se dice, en vez de dejar el desplegable vacío: un hueco
 * en blanco parece que la app se rompió, y lo que pasa es que a esa vainilla
 * todavía no le ha tocado entrar en una receta.
 */
const opcionesReceta=ing=>{
 const rs=recetasCon(ing,data.recipes);
 return rs.length
  ? rs.map(r=>`<option value="${r.id}">${esc(r.name)}</option>`).join('')
  : `<option value="">Ninguna receta la usa todavía</option>`};

/** Al cambiar de ingrediente cambian sus unidades y sus recetas. */
function rendCambiaIngrediente(){
 const ing=data.ingredients.find(x=>x.id===$('#rendIng').value);
 if(!ing)return;
 $('#rendUnit').innerHTML=unitOptionsFor(ing,ing.unitSingle);
 $('#rendReceta').innerHTML=opcionesReceta(ing);
 $('#rendQty').value=prettyQty(ing.quantity||1);
 calcularRendimiento()}

function calcularRendimiento(){
 const ing=data.ingredients.find(x=>x.id===($('#rendIng')||{}).value);
 const receta=data.recipes.find(r=>r.id===($('#rendReceta')||{}).value);
 const cant=parseQty(($('#rendQty')||{}).value||'');
 const out=$('#rendOut'),cap=$('#rendCaption'),nota=$('#rendNota');
 if(!out)return;
 // Antes que nada: si no está en ninguna receta, no hay pregunta que responder.
 // Decirlo es más útil que esconder el botón y dejarla adivinando por qué unos
 // ingredientes lo tienen y otros no.
 if(ing&&!recetasCon(ing,data.recipes).length){
  cap.textContent='Todavía no puedo decírtelo';
  out.textContent='falta la receta';
  nota.textContent=`Ninguna de tus recetas lleva ${ing.name} todavía. Agrégalo a una y aquí te digo para cuántas tandas alcanza.`;
  return}
 const r=rendimiento(ing,cant,($('#rendUnit')||{}).value,receta);
 if(!r){
  cap.textContent='Te alcanza para';
  out.textContent='—';
  nota.textContent=cant>0?'Con esa medida no puedo hacer la cuenta.':'Escribe cuánto tienes.';
  return}
 if(!r.alcanza){
  cap.textContent='No alcanza ni para una';
  out.textContent=`faltan ${prettyQty(+r.falta.toFixed(1))} ${esc(r.unidadBase)}`;
  nota.textContent=`Una tanda de ${esc(receta.name)} gasta ${prettyQty(+r.gastaPorTanda.toFixed(1))} ${esc(r.unidadBase)} de ${esc(ing.name)}.`;
  return}
 cap.textContent='Te alcanza para';
 out.textContent=`${r.tandasEnteras} ${r.tandasEnteras===1?'tanda':'tandas'} · ${prettyQty(r.porcionesEnteras)} porciones`;
 nota.textContent=joinDetail([
  `Cada tanda gasta ${prettyQty(+r.gastaPorTanda.toFixed(1))} ${r.unidadBase} de ${ing.name}`,
  r.sobra>0.05?`te sobran ${prettyQty(+r.sobra.toFixed(1))} ${r.unidadBase}`:null])}

function abrirCalculadora(costo,nombre,recetaId){
 calcReceta=recetaId||null;
 openModal('¿Cuánto cobrar?',`
  <p class="helper">${nombre?`Una porción de <b>${esc(nombre)}</b> te cuesta <b>${money(costo)}</b>.`:'Escribe cuánto te cuesta una porción.'}</p>
  <div class="seg" id="mCalcMode">
   <button class="active" data-mode="margin" onclick="setCalcMode('margin',true)">Ganar % del precio</button>
   <button data-mode="markup" onclick="setCalcMode('markup',true)">Sumar % al costo</button>
  </div>
  <div class="form-grid">
   <div class="field"><label>Costo por porción ($)</label>
    <input id="mQuickCost" type="number" inputmode="decimal" min="0" step="0.01" value="${costo.toFixed(2)}" oninput="quickCalc(true)"></div>
   <div class="field"><label id="mQuickPctLabel">De cada venta quiero ganar (%)</label>
    <input id="mQuickPct" type="number" inputmode="decimal" min="0" max="99" value="65" oninput="quickCalc(true)"></div>
  </div>
  <input id="mQuickSlider" class="slider" type="range" min="0" max="95" value="65" oninput="$('#mQuickPct').value=this.value;quickCalc(true)">
  <div class="calc-result pop"><span id="mQuickCaption">Precio mínimo recomendado</span><strong id="mQuickPrice">$0.00</strong></div>
  <p class="calc-warning" id="mQuickNote"></p>
  <div class="modal-actions">
   <button class="btn alt" onclick="closeModal()">Cerrar</button>
   ${recetaId?`<button class="btn" onclick="guardarPrecioCalculado()">Ponerle este precio</button>`:''}
  </div>`);
 setCalcMode(calcMode,true)}

/** Lleva el precio calculado a la receta, sin tener que abrir el editor. */
function guardarPrecioCalculado(){
 const r=data.recipes.find(x=>x.id===calcReceta);if(!r)return;
 const precio=+($('#mQuickPrice').textContent||'').replace(/[^0-9.]/g,'')||0;
 if(!(precio>0))return toast('Escribe primero el costo.',true);
 const actualizada=sello({...r,price:+precio.toFixed(2)});
 data.recipes=data.recipes.map(x=>x.id===r.id?actualizada:x);
 save('Precio de '+r.name+' actualizado');closeModal()}

function renderTables(){
const qs=(($('#saleSearch')||{}).value||'').toLowerCase().trim();
const sl=data.sales.filter(x=>!qs||(x.product||'').toLowerCase().includes(qs));
$('#salesRows').innerHTML=sl.map(x=>{const r=data.recipes.find(r=>r.id===x.recipeId),cost=r?recipeUnitCost(r)*(+x.qty||0):0,prof=(+x.total||0)-cost;return `<tr><td data-label="Fecha">${fmtDate(x.date)}</td><td class="main"><b>${esc(x.product)}</b></td><td data-label="Cant.">${esc(x.qty)}</td><td class="amount" data-label="Total">${money(x.total)}</td><td class="${prof>=0?'positive':'negative'}" data-label="Utilidad">${money(prof)}</td><td class="actions"><button class="icon-btn" onclick="openSale('${x.id}')" aria-label="Editar venta">✎</button><button class="icon-btn" onclick="removeItem('sales','${x.id}')" aria-label="Eliminar venta">×</button></td></tr>`}).join('');
$('#salesEmpty').style.display=sl.length?'none':'block';
setCount('#saleCount',sl.length,data.sales.length,'venta','ventas');
const qe=(($('#expenseSearch')||{}).value||'').toLowerCase().trim();
const {start:desdeE,end:hastaE}=periodRange();
// Los recurrentes no se filtran por fecha: se anotan una vez y siguen valiendo.
const ex=(window.ALLDATA?window.ALLDATA.expenses:data.expenses).filter(x=>
  (!qe||(x.name||'').toLowerCase().includes(qe)||(x.category||'').toLowerCase().includes(qe))&&
  (tipoGasto(x)==='recurrente'?montoEnRango(x,desdeE,hastaE)>0||true:montoEnRango(x,desdeE,hastaE)>0));
$('#expenseRows').innerHTML=ex.map(x=>{
 const t=tipoGasto(x), info=TIPOS_GASTO.find(z=>z.k===t)||TIPOS_GASTO[0];
 const veces=t==='recurrente'?vecesEnRango(x,desdeE,hastaE):1;
 const enRango=montoEnRango(x,desdeE,hastaE);
 // "2 × $1.25" cuando compró varios, y "$2.50 cada vez" cuando además se repite.
 const sub=joinDetail([cantidadDe(x)>1?`${prettyQty(cantidadDe(x))} × ${money(x.amount)}`:null,
                       veces>1?`${money(montoBase(x))} cada vez`:null]);
 const detalle=t==='recurrente'
  ? `${(FRECUENCIAS.find(f=>f.k===frecuenciaDe(x))||FRECUENCIAS[1]).n}${veces?` · ${veces}x aquí`:''}`
  : esc(x.category||'');
 return `<tr><td data-label="Fecha">${fmtDate(x.date)}</td><td class="main"><b>${esc(x.name)}</b></td>`+
  `<td data-label="Tipo"><span class="chip tipo-${t}">${esc(info.n)}</span><small class="sub">${detalle}</small></td>`+
  `<td class="amount ${t==='inversion'?'':'negative'}" data-label="Monto">${money(enRango||x.amount)}`+
  `${sub?`<small class="sub">${esc(sub)}</small>`:''}</td>`+
  `<td class="actions"><button class="icon-btn" onclick="openExpense('${x.id}')" aria-label="Editar">✎</button>`+
  `<button class="icon-btn" onclick="removeItem('expenses','${x.id}')" aria-label="Eliminar">×</button></td></tr>`}).join('');
$('#expensesEmpty').style.display=ex.length?'none':'block';
setCount('#expenseCount',ex.length,ex.length,'movimiento','movimientos');
renderInversion(desdeE,hastaE);
const qi=(($('#ingSearch')||{}).value||'').toLowerCase().trim();
const ing=data.ingredients.filter(x=>(!qi||(x.name||'').toLowerCase().includes(qi))&&
  (!filtroKind||kindOf(x)===filtroKind));
renderKindFilters();
$('#ingredientRows').innerHTML=ing.map(x=>{const k=KINDS.find(z=>z.k===kindOf(x))||KINDS[0];
 const sale=costBreakdown(x).map(c=>money(c.amount)+' / '+esc(c.unit)).join('<br>');
 const trae=x.unitWeight?` · cada uno ${prettyQty(x.unitWeight)} ${esc(unitInfo(x.unitWeightUnit||'g').s)}`:'';
 const sinNutri=faltaNutricion(x)?'<span class="falta" title="Sin información nutricional">sin nutrición</span>':'';
 return `<tr><td class="main"><b>${k.emoji} ${esc(x.name)}</b>${sinNutri}</td><td data-label="Cómo lo compras">${esc(x.unit)} de ${esc(x.quantity)} ${esc(unitInfo(x.unitSingle).s)}${trae}</td><td data-label="Te costó">${money(x.price)}</td><td class="amount" data-label="Sale a">${sale}</td><td class="actions"><button class="icon-btn" onclick="abrirRendimiento('${x.id}')" aria-label="¿Para cuánto alcanza?" title="¿Para cuánto alcanza?">⚖</button><button class="icon-btn" onclick="openIngredient('${x.id}')" aria-label="Editar ingrediente">✎</button><button class="icon-btn" onclick="removeItem('ingredients','${x.id}')" aria-label="Eliminar ingrediente">×</button></td></tr>`}).join('');
$('#ingredientsEmpty').style.display=ing.length?'none':'block';
setCount('#ingCount',ing.length,data.ingredients.length,'guardado','guardados')}
function renderChart(){const src=(window.ALLDATA&&window.ALLDATA.sales)||data.sales;const now=new Date(),vals=[0,0,0,0,0,0],labels=[];
for(let i=5;i>=0;i--){const d=new Date(now.getFullYear(),now.getMonth()-i,1);let l=d.toLocaleDateString('es',{month:'short'}).replace('.','');labels.push(l.charAt(0).toUpperCase()+l.slice(1))}
src.forEach(x=>{const d=new Date(String(x.date)+'T12:00:00');if(isNaN(d))return;const diff=(now.getFullYear()-d.getFullYear())*12+(now.getMonth()-d.getMonth());if(diff>=0&&diff<6)vals[5-diff]+=+x.total||0});
const max=Math.max(...vals,1);$('#chart').innerHTML=vals.map((v,i)=>`<div class="bar ${i===5?'active':''}" style="height:${Math.max(5,v/max*100)}%" title="${money(v)}">${v?`<b>${money(v)}</b>`:''}<label>${labels[i]}</label></div>`).join('')}
function renderAlerts(){const a=[];
if(!data.recipes.length)a.push(['Crea tu primer postre','Así sabrás exactamente cuánto te cuesta hacerlo.']);
else{const sinPrecio=data.recipes.filter(r=>!recipePrice(r));if(sinPrecio.length)a.push(['Falta el precio de '+sinPrecio[0].name,'Ponle precio para saber cuánto ganas con cada porción.']);
const low=data.recipes.filter(r=>recipePrice(r)&&recipeMargin(r)<55);if(low.length)a.push(['Margen bajo en '+low[0].name,`Solo ganas ${recipeMargin(low[0]).toFixed(0)} centavos por dólar. Cobrando ${money(suggestPrice(low[0]))} por porción estarías mejor.`]);
const neg=data.recipes.filter(r=>recipePrice(r)&&recipePrice(r)<recipeUnitCost(r));if(neg.length)a.push(['Estás perdiendo con '+neg[0].name,'Cobras menos de lo que te cuesta hacerlo. Sube el precio.']);}
if(!data.sales.length)a.push(['Anota tus ventas','Así verás cuánto ganas de verdad y qué se vende más.']);
if(!data.ingredients.length)a.push(['Anota lo que compras','Agrega tus ingredientes una vez y los reutilizas en cada receta.']);
$('#alerts').innerHTML=a.map(x=>`<div class="row"><span class="dot"></span><div class="grow"><b>${esc(x[0])}</b><small>${esc(x[1])}</small></div></div>`).join('')||'<div class="empty">¡Todo va en orden! Sigue registrando tu actividad.</div>'}
function renderTopProducts(){const map={};data.sales.forEach(x=>{const k=x.product||'Sin nombre';map[k]=map[k]||{qty:0,total:0};map[k].qty+=+x.qty||0;map[k].total+=+x.total||0});
const top=Object.entries(map).sort((a,b)=>b[1].total-a[1].total).slice(0,5);
$('#topProducts').innerHTML=top.length?top.map(([n,v])=>`<div class="row"><span class="dot"></span><div class="grow"><b>${esc(n)}</b><small>${v.qty} unidades vendidas</small></div><span class="amount">${money(v.total)}</span></div>`).join(''):'<div class="empty">Registra ventas para ver tu ranking de productos.</div>'}
function openModal(title,body){$('#dialog').innerHTML=`<h2>${title}</h2>${body}`;$('#modal').classList.add('show');document.body.classList.add('modal-open');$('#dialog').scrollTop=0}function closeModal(){$('#modal').classList.remove('show');document.body.classList.remove('modal-open')}$('#modal').onclick=e=>{if(e.target.id==='modal')closeModal()};document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal()});function field(label,id,type='text',value='',extra=''){return `<div class="field"><label>${label}</label><input id="${id}" type="${type}" value="${value}" ${extra}></div>`}
// Sobre qué cantidad se leen los macros. Para lo que se pesa son 100 g o
// 100 ml, como en las etiquetas. Para lo que se cuenta es UNA pieza: los datos
// de una banana se dicen por banana, no por cien bananas.
const macroBase=u=>macroBasis(u).etiqueta;

function macroFields(g){const m=(g&&g.macros)||{};
 const abierto=hasMacros(g)?' open':'';
 const u=(g&&g.unitSingle)||'g';
 // Lo guardado está por 100 unidades base; lo que se enseña está en la base que
 // se lee (100 g, o una pieza).
 const vista=k=>{const v=macroToShow(m[k],u);return v==null?'':esc(v)};
 const filas=MACROS.map(x=>`<div class="field"><label>${x.n} (${x.u})</label>
  <input id="mac_${x.k}" type="number" min="0" step="0.01" inputmode="decimal" value="${vista(x.k)}"></div>`).join('');
 // Una caja no se come: pedirle calorías sería pedir un dato que no existe.
 const esEmpaque=kindOf(g)==='empaque';
 return `<details class="macros"${abierto} id="macroFields" style="${esEmpaque?'display:none':''}">
  <summary>Información nutricional <span class="opt">opcional</span></summary>
  <p class="helper">Sirve para saber cuánta azúcar, proteína o grasa lleva cada postre.</p>
  ${VISION?`<div class="scan-row">
    <input id="macCam" type="file" accept="image/*" capture="environment" onchange="scanLabel(event)" hidden>
    <input id="macFile" type="file" accept="image/*" onchange="scanLabel(event)" hidden>
    <button type="button" class="btn alt small" onclick="$('#macCam').click()">📷 Leer con la cámara</button>
    <button type="button" class="btn alt small" onclick="$('#macFile').click()">🖼 Elegir foto</button>
   <button type="button" class="btn alt small" onclick="buscarNutricion()">🍎 Es fruta o verdura</button>
   </div>
   <p class="helper" id="scanHint">Toma una foto de la tabla nutricional y se llena solo. Si es fruta o verdura no hace falta foto: toca el botón de al lado.</p>`:''}
  <p class="helper"><b>Por cada <span id="macBase">${macroBase(g&&g.unitSingle)}</span></b></p>
  <div class="form-grid">${filas}</div>
 </details>`}

/**
 * Busca los datos de una fruta o verdura sin foto ninguna.
 *
 * Una banana no trae etiqueta pegada, pero sus valores son conocimiento
 * general. Se manda sólo el nombre; las cuentas —de "por 100 g" a "por
 * banana"— las hace business-core.js, no el modelo.
 */
async function buscarNutricion(){
 const hint=$('#scanHint');
 const g=ingFromForm();
 if(!g.name.trim()){if(hint)hint.textContent='Escribe primero el nombre.';return}
 if(hint)hint.textContent='Buscando los datos de '+g.name.trim()+'…';
 try{
  const r=await fetch('api/nutrition',{method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({nombre:g.name.trim(),unitSingle:g.unitSingle,
                        gramosPorPieza:g.unitWeight&&unitFamily(g.unitWeightUnit)==='masa'
                          ?g.unitWeight*unitInfo(g.unitWeightUnit).f:0})});
  const j=await r.json();

  // Aunque no haya podido con los macros, saber cuánto pesa una pieza sirve.
  if(j.gramosPorPieza&&!g.unitWeight){const el=$('#ingUnitWeight');
   if(el&&el.offsetParent!==null){el.value=j.gramosPorPieza;
    const u=$('#ingUnitWeightUnit');if(u)u.value='g';renderIngPreview()}}

  if(!j.ok){if(hint)hint.textContent=j.mensaje||'No pude buscarlo.';return}

  let puestos=0;
  MACRO_KEYS.forEach(k=>{const el=document.getElementById('mac_'+k);
   const v=macroToShow(j.macros[k],g.unitSingle);
   if(el&&v!=null){el.value=v;puestos++}});
  if(j.esFruta){const b=document.querySelector('.kind-tabs button[data-kind=fruta]');if(b)pickKind(b)}
  if(hint)hint.textContent=puestos
   ? `Listo: ${puestos} datos de ${esc(j.nombre)}${j.confianza==='baja'?'. Revísalos, no estoy seguro.':'. Revisa que estén bien.'}`
   : 'No encontré datos.';
  toast(puestos?'Datos de '+j.nombre+' ✓':'No encontré datos.',!puestos);
 }catch(err){if(hint)hint.textContent='No pude buscarlo ahora. Puedes escribir los datos a mano.'}}

// Lee la etiqueta de una foto y llena los campos. Ella no elige nada: o sale, o
// se le dice en una línea qué hacer distinto.
async function scanLabel(e){const file=e.target.files&&e.target.files[0];e.target.value='';
 if(!file)return;
 const hint=$('#scanHint');if(hint)hint.textContent='Leyendo la etiqueta…';
 try{
  const dataUrl=await compressImage(file,1100,.8);
  const paquete={cantidad:parseQty(($('#ingQty')||{}).value||0),unitSingle:($('#ingUnitSingle')||{}).value||'g'};
  const r=await fetch('api/vision',{method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({dataUrl,paquete})});
  const j=await r.json();
  if(!j.ok){if(hint)hint.textContent=j.mensaje||'No pude leer esa etiqueta.';return}
  let puestos=0;
  const u=($('#ingUnitSingle')||{}).value||'g';
  MACRO_KEYS.forEach(k=>{const el=document.getElementById('mac_'+k);
   const v=macroToShow(j.macros[k],u);
   if(el&&v!=null){el.value=v;puestos++}});
  if(hint)hint.textContent=puestos?`Listo: ${puestos} datos llenados${j.confianza==='baja'?'. Revísalos, la foto salió borrosa.':'. Revisa que estén bien.'}`
                                  :'No encontré datos en esa foto.';
  toast(puestos?'Etiqueta leída ✓':'No encontré datos en esa foto.',!puestos);
 }catch(err){if(hint)hint.textContent='No pude leer esa etiqueta. Puedes escribir los datos a mano.'}}

// Recoge los macros del formulario. Vacío = null (no se sabe), que no es lo
// mismo que 0.
// Lo que ella elige manda sobre lo que se adivina por el nombre: así una
// ralladura de limón se puede sacar de "fruta" y una "pulpa" que no suena a
// nada se puede meter.
function readKind(){const el=document.getElementById('ingKind');
 return el&&KIND_KEYS.includes(el.value)?el.value:'ingrediente'}

function readMacros(unitSingle){const m={};let alguno=false;
 MACRO_KEYS.forEach(k=>{const el=document.getElementById('mac_'+k);
  const v=el&&el.value.trim();
  const guardado=macroToStore(v,unitSingle);
  if(guardado==null){m[k]=null}else{m[k]=guardado;alguno=true}});
 return alguno?m:null}

function openIngredient(id){const g=data.ingredients.find(x=>x.id===id)||{name:'',unit:'',quantity:1,price:'',unitSingle:'g'};
const kind=kindOf(g);
const pesoUnidad=`<div class="field peso-unidad" id="pesoUnidad" style="${unitFamily(g.unitSingle||'g')==='conteo'?'':'display:none'}">
  <label>¿Cuánto pesa cada uno? <span class="opt">opcional</span></label>
  <div class="par">
   <input id="ingUnitWeight" type="number" min="0" step="0.01" inputmode="decimal" value="${g.unitWeight!=null&&g.unitWeight!==''?esc(g.unitWeight):''}" placeholder="ej. 113" oninput="renderIngPreview()">
   <select id="ingUnitWeightUnit" onchange="renderIngPreview()">${unitOptions(g.unitWeightUnit||'g',null,['conteo'])}</select>
  </div>
  <small class="helper">Una caja de 24 barras de mantequilla son 24 unidades, y cada barra 113 g. Con eso te digo el precio por barra y por gramo, y puedes cocinar en gramos.</small>
 </div>`;
openModal(id?'Editar ingrediente':'Nuevo ingrediente',`
 <div class="kind-tabs" role="tablist">${KINDS.map(k=>`
  <button type="button" role="tab" class="${k.k===kind?'active':''}" data-kind="${k.k}" onclick="pickKind(this)">${k.emoji} ${k.n}</button>`).join('')}
  <input type="hidden" id="ingKind" value="${kind}"></div>
 <div class="form-grid">
  ${field('Nombre','ingName','text',esc(g.name),'oninput="renderIngPreview()"')}
  ${field('¿Cómo lo compras?','ingUnit','text',esc(g.unit),'placeholder="ej. bolsa, caja, mata"')}
  ${field('¿Cuánto trae?','ingQty','text',g.quantity!=null&&g.quantity!==''?prettyQty(g.quantity):'','readonly data-pad="1" placeholder="toca para escribir" onfocus="openPad(this)" onclick="openPad(this)"')}
  <div class="field"><label>¿En qué se mide?</label>
   <select id="ingUnitSingle" onchange="onIngUnitChange(this.value)">${unitOptions(g.unitSingle||'g')}</select></div>
  ${field('¿Cuánto te costó? ($)','ingPrice','number',g.price,'min="0" step="0.01" inputmode="decimal" oninput="renderIngPreview()"')}
 </div>
 ${pesoUnidad}
 <div id="ingPreview" class="preview"></div>
 ${macroFields(g)}
 <div class="modal-actions"><button class="btn alt" onclick="closeModal()">Cancelar</button><button class="btn" onclick="addIngredient('${id||''}')">Guardar ingrediente</button></div>`);
renderIngPreview()}

/** Cambia la categoría. La de fruta es la que decide las etiquetas de azúcar. */
function pickKind(btn){
 document.querySelectorAll('.kind-tabs button').forEach(b=>b.classList.toggle('active',b===btn));
 $('#ingKind').value=btn.dataset.kind;
 const mf=$('#macroFields');
 if(mf)mf.style.display=btn.dataset.kind==='empaque'?'none':'';
 renderIngPreview()}

/** El peso por pieza sólo tiene sentido para lo que se cuenta. */
function onIngUnitChange(u){
 const b=$('#macBase');if(b)b.textContent=macroBase(u);
 const p=$('#pesoUnidad');if(p)p.style.display=unitFamily(u)==='conteo'?'':'none';
 // Los macros se escriben sobre otra base al cambiar de unidad, y dejar los
 // números de antes con la etiqueta nueva sería enseñar un dato falso.
 renderIngPreview()}

function ingFromForm(){
 return {name:($('#ingName')||{}).value||'',
  unit:($('#ingUnit')||{}).value||'',
  quantity:parseQty(($('#ingQty')||{}).value||0),
  price:+(($('#ingPrice')||{}).value||0),
  unitSingle:($('#ingUnitSingle')||{}).value||'g',
  unitWeight:+(($('#ingUnitWeight')||{}).value||0)||null,
  unitWeightUnit:($('#ingUnitWeightUnit')||{}).value||'g',
  kind:($('#ingKind')||{}).value||'ingrediente'}}

/** "Te sale a": ahora puede decir dos cosas — por pieza y por peso. */
function renderIngPreview(){
 const el=$('#ingPreview');if(!el)return;
 const g=ingFromForm();
 if(!(g.quantity>0)||!(g.price>0)){el.innerHTML='';return}
 const partes=costBreakdown(g).map(c=>`<b>${money(c.amount)}</b> por ${esc(c.unit)}`);
 el.innerHTML=`<span>Te sale a</span> ${partes.join(' &nbsp;·&nbsp; ')}`}

function addIngredient(id){const g=ingFromForm();
if(!g.name.trim()||!g.unit.trim()||!g.quantity||!(g.price>=0))return toast('Completa todos los campos.',true);
const macros=readMacros(g.unitSingle);
const rec=sello({id:id||crypto.randomUUID(),name:g.name.trim(),unit:g.unit.trim(),
 quantity:g.quantity,price:g.price,unitSingle:g.unitSingle,
 unitWeight:g.unitWeight,unitWeightUnit:g.unitWeight?g.unitWeightUnit:undefined,
 kind:readKind(),macros});
if(id)data.ingredients=data.ingredients.map(x=>x.id===id?rec:x);else data.ingredients.push(rec);
save(id?'Ingrediente actualizado':'Ingrediente guardado');closeModal()}
function ingredientLines(lines=[]){return `<div class="ingredients" id="ingredientsForm">${(lines.length?lines:[{}]).map(x=>ingredientLine(x)).join('')}</div><button class="btn alt" type="button" onclick="addLine()">+ Agregar ingrediente</button>`}
function ingredientLine(x={}){const opts=data.ingredients.map(i=>`<option value="${i.id}" ${x.ingredientId===i.id?'selected':''}>${esc(i.name)}</option>`).join('');
const sel=data.ingredients.find(i=>i.id===x.ingredientId);
const name=x.name||(sel&&sel.name)||'';
const unit=x.unit||(sel?sel.unitSingle:'g')||'g';
const cost=x.cost!=null&&x.cost!==''?x.cost:(sel?(lineUnitCost(sel,unit)||0):'');
return `<div class="ingredient-line" data-name="${esc(name)}">
${data.ingredients.length?`<select data-n="ingredientId" onchange="pickIngredient(this)"><option value="">Elige un ingrediente</option>${opts}</select>`:`<input placeholder="Ingrediente" value="${esc(name)}" data-n="name">`}
<input type="text" readonly data-pad="1" placeholder="cantidad" value="${x.qty!=null&&x.qty!==''?prettyQty(x.qty):''}" data-n="qty" onfocus="openPad(this)" onclick="openPad(this)" oninput="lineTotal(this)">
<select data-n="unit" onchange="pickUnit(this)">${unitOptionsFor(sel,unit)}</select>
<input type="hidden" data-n="cost" value="${cost}">
<button class="icon-btn" type="button" aria-label="Quitar ingrediente" onclick="this.closest('.ingredient-line').remove();recipeTotals()">×</button>
<div class="line-total"></div></div>`}

/**
 * Las unidades que se le pueden ofrecer a una línea de receta.
 *
 * Todas las de su familia, más las de la otra cuando se sabe cuánto pesa una
 * pieza: leche comprada en litros se puede medir en cucharadas, y mantequilla
 * comprada por barras se puede medir en gramos. Las que no se pueden convertir
 * sin inventarse la densidad no se ofrecen, porque ofrecerlas sería prometer
 * una cuenta que no se puede hacer.
 */
function unitOptionsFor(ing,selected){
 if(!ing)return unitOptions(selected);
 return Object.entries(UNITS).filter(([k])=>unitFactor(ing,k))
  .map(([k,v])=>`<option value="${k}" ${k===selected?'selected':''}>${v.n}</option>`).join('')}

function pickIngredient(select){const ing=data.ingredients.find(i=>i.id===select.value),line=select.closest('.ingredient-line');if(!ing)return;
line.dataset.name=ing.name;
const us=line.querySelector('[data-n=unit]');
us.innerHTML=unitOptionsFor(ing,ing.unitSingle);
pickUnit(us)}

function pickUnit(select){const line=select.closest('.ingredient-line'),ing=data.ingredients.find(i=>i.id===(line.querySelector('[data-n=ingredientId]')||{}).value);
if(ing){const c=lineUnitCost(ing,select.value);
 line.querySelector('[data-n=cost]').value=c==null?0:c}
lineTotal(select)}
function addLine(){$('#ingredientsForm').insertAdjacentHTML('beforeend',ingredientLine());recipeTotals()}
function lineTotal(el){const l=el.closest('.ingredient-line'),q=parseQty(l.querySelector('[data-n=qty]').value),c=+l.querySelector('[data-n=cost]').value||0;
const u=(l.querySelector('[data-n=unit]')||{}).value;
const ing=data.ingredients.find(i=>i.id===(l.querySelector('[data-n=ingredientId]')||{}).value);
const conv=ing&&q?conversionInfo(ing,u,q):null;
// Cuando la unidad de la receta no es la de la compra, se dice. Un costo que
// aparece solo, sin explicar de dónde salió, es un costo en el que no se confía.
l.querySelector('.line-total').innerHTML=q&&c
 ? `${prettyQty(q)} ${esc(unitInfo(u).s)} cuestan ${money(q*c)}`
   +(conv?` <button type="button" class="conv" onclick='verConversion(${JSON.stringify(conv).replace(/'/g,"&#39;")})'>⇄ ${esc(conv.texto)} <span class="i">i</span></button>`:'')
 : '';
recipeTotals()}

/** Explica una conversión, para que no parezca magia. */
function verConversion(info){
 toast(info.texto+' — '+info.detalle)}
const ingredientsById=()=>{const m={};data.ingredients.forEach(i=>{m[i.id]=i});return m};

/**
 * Resumen nutricional de una receta, para el editor y para las tarjetas.
 *
 * Si faltan ingredientes por cubrir se dice cuántos. Enseñar "320 kcal" a secas
 * cuando la mitad de la receta no tiene datos sería un número creíble y falso.
 */
// Las etiquetas sólo salen con la receta completa; si faltan datos se explica
// por qué en vez de dejar el hueco sin más.
function badgeRow(r){const out=recipeBadges(r,ingredientsById());
 if(out.badges.length)return `<div class="badges">${out.badges.map(b=>
  `<span class="dbadge" title="${esc(b.d)}">${b.emoji} ${esc(b.n)}</span>`).join('')}</div>`;
 if(out.motivo==='faltan-datos')return `<p class="badges-hint">Añade la información nutricional de todos los ingredientes para ver etiquetas como “Sin azúcar” o “Keto”.</p>`;
 return ''}

function macroSummary(r){const m=recipeMacros(r,ingredientsById());
 if(!m.contadas)return '';
 const p=m.perServing;
 const trozo=(k,suf)=>p[k]?`${Math.round(p[k]*10)/10} ${suf}`:null;
 const partes=[trozo('calorias','kcal'),trozo('proteina','g proteína'),
               trozo('azucar','g azúcar'),trozo('grasa','g grasa')].filter(Boolean);
 if(!partes.length)return '';
 const aviso=m.completo?'':` · sólo ${m.contadas} de ${m.total} ingredientes`;
 return `<p class="macro-line">Por porción: ${partes.join(' · ')}${esc(aviso)}</p>`}

function recipeTotals(){const box=$('#costPanel');if(!box)return;
let total=0;document.querySelectorAll('.ingredient-line').forEach(l=>{
 total+=parseQty(l.querySelector('[data-n=qty]').value)*(+l.querySelector('[data-n=cost]').value||0)});
const y=parseQty($('#rYield').value)||1,u=total/y;

box.innerHTML=`<div class="cost-main"><b>${money(u)}</b><span>cada porción</span></div>
 <div class="cost-side"><b>${money(total)}</b><span>la receta entera</span></div>
 ${total?'':'<p class="cost-empty">Agrega ingredientes y el costo aparece solo.</p>'}`;

const pr=recipeFinalPrice(),gan=pr-u;
const pp=$('#pricePanel');
if(pp)pp.innerHTML=`<div class="price-result${gan<0&&pr?' loss':''}">
 <span>${recipeMode==='margin'?'Cobrando así, cada porción sale a':'Cada porción'}</span>
 <strong>${money(pr)}</strong>
 ${pr&&u?`<small>${gan>=0?`Te quedan ${money(gan)} de ganancia por porción`:`Estás perdiendo ${money(-gan)} por porción`}</small>`:''}
 </div>${!u&&recipeMode==='margin'?'<p class="helper">Primero agrega los ingredientes: el precio se calcula a partir de lo que te cuesta.</p>':''}`;

const rt=$('#recipeTotals');
if(rt)rt.innerHTML=macroSummary(formRecipe())+badgeRow(formRecipe())}

// Reconstruye la receta a partir del formulario abierto, para poder calcular
// los macros y las etiquetas mientras ella todavía está escribiendo.
function formRecipe(){const lines=[...document.querySelectorAll('.ingredient-line')].map(l=>({
 ingredientId:(l.querySelector('[data-n=ingredientId]')||{}).value||'',
 qty:parseQty(l.querySelector('[data-n=qty]').value),
 unit:(l.querySelector('[data-n=unit]')||{}).value||'u'})).filter(x=>x.qty>0);
 return {yield:parseQty(($('#rYield')||{}).value)||1,ingredients:lines}}

// Precio de la receta: o sale de un margen, o se escribe a mano.
let recipeMode='margin', margenPct=65;
function setRecipeMode(m){recipeMode=m;
 document.querySelectorAll('#priceMode button').forEach(b=>b.classList.toggle('active',b.dataset.mode===m));
 $('#marginBox').style.display=m==='margin'?'block':'none';
 $('#manualBox').style.display=m==='manual'?'block':'none';
 recipeTotals()}
function setRecipeMargin(v){margenPct=+v;$('#marginVal').textContent=Math.round(margenPct)+'%';recipeTotals()}
// El precio que se guardará, venga de donde venga.
function recipeFinalPrice(){const u=recipeUnitCostForm();
 if(recipeMode==='manual')return +($('#rPrice')||{}).value||0;
 if(!u||margenPct>=100)return 0;
 return u/(1-margenPct/100)}
function recipeUnitCostForm(){let total=0;
 document.querySelectorAll('.ingredient-line').forEach(l=>{
  total+=parseQty(l.querySelector('[data-n=qty]').value)*(+l.querySelector('[data-n=cost]').value||0)});
 return total/(parseQty(($('#rYield')||{}).value)||1)}

// El orden sigue el de la cabeza de quien cocina: qué es, qué lleva, cuánto
// cuesta y sólo entonces cuánto cobrar. Antes pedía el precio de venta primero,
// cuando todavía no había forma de saberlo.
function openRecipe(id){const r=data.recipes.find(x=>x.id===id)||{name:'',yield:1,price:'',ingredients:[],photo:''};
recipeMode=(+r.price>0)?'manual':'margin';margenPct=65;
openModal(id?'Editar receta':'Nueva receta',`<div class="form-grid">${field('Nombre del postre','rName','text',esc(r.name))}${field('¿Cuántas porciones rinde?','rYield','text',r.yield,'readonly data-pad="1" onfocus="openPad(this)" onclick="openPad(this)" oninput="recipeTotals()"')}</div>

<h3 style="margin-top:20px">¿Qué lleva?</h3><p class="helper">Elige un ingrediente y toca la cantidad: se abre un teclado con números y fracciones (½, ⅓, ¼…).</p>${ingredientLines(r.ingredients)}

<div id="costPanel" class="cost-panel"></div>

<h3 style="margin-top:20px">¿Cuánto vas a cobrar?</h3>
<div class="seg" id="priceMode">
 <button type="button" class="${recipeMode==='margin'?'active':''}" data-mode="margin" onclick="setRecipeMode('margin')">Con un margen</button>
 <button type="button" class="${recipeMode==='manual'?'active':''}" data-mode="manual" onclick="setRecipeMode('manual')">Yo pongo el precio</button>
</div>
<div id="marginBox" style="display:${recipeMode==='margin'?'block':'none'}">
 <div class="margin-row"><span>De cada venta quiero ganar</span><b id="marginVal">${margenPct}%</b></div>
 <input id="rMargin" type="range" min="30" max="90" step="5" value="${margenPct}" oninput="setRecipeMargin(this.value)">
 <p class="helper">La mayoría de la repostería se mueve entre 60 % y 70 %.</p>
</div>
<div id="manualBox" style="display:${recipeMode==='manual'?'block':'none'}">
 ${field('Precio por porción ($)','rPrice','number',r.price,'min="0" step="0.01" inputmode="decimal" oninput="recipeTotals()"')}
</div>
<div id="pricePanel"></div>
<div id="recipeTotals"></div>

<div class="field full" style="margin-top:18px"><label>Foto del postre (opcional)</label><div class="photo-drop"><img id="photoPreview" src="${esc(r.photo||'')}" data-value="${esc(r.photo||'')}" alt="Vista previa" style="${r.photo?'':'display:none'}">
<div class="photo-btns"><input id="rCam" type="file" accept="image/*" capture="environment" onchange="previewPhoto(event)" hidden><input id="rPhoto" type="file" accept="image/*" onchange="previewPhoto(event)" hidden>
<button type="button" class="btn alt small" onclick="$('#rCam').click()">📷 Tomar foto</button><button type="button" class="btn alt small" onclick="$('#rPhoto').click()">🖼 Elegir foto</button><button type="button" class="btn danger small" onclick="clearPhoto()">Quitar</button></div></div>
<p class="helper" id="photoHint">Toma una foto o elige una de tu galería.</p></div>

<div class="modal-actions"><button class="btn alt" onclick="closeModal()">Cancelar</button><button class="btn" onclick="saveRecipe('${id||''}')">Guardar receta</button></div>`);
document.querySelectorAll('.ingredient-line [data-n=qty]').forEach(i=>lineTotal(i));recipeTotals()}
function clearPhoto(){const img=$('#photoPreview');img.src='';img.dataset.value='';img.style.display='none';$('#photoHint').textContent='Sin foto.'}

function compressImage(file,max,q){return new Promise((res,rej)=>{const fr=new FileReader();fr.onerror=()=>rej(new Error('read'));fr.onload=()=>{const im=new Image();im.onerror=()=>rej(new Error('decode'));im.onload=()=>{let w=im.naturalWidth,h=im.naturalHeight;const sc=Math.min(1,max/Math.max(w,h));w=Math.round(w*sc);h=Math.round(h*sc);const cv=document.createElement('canvas');cv.width=w;cv.height=h;const ctx=cv.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);ctx.drawImage(im,0,0,w,h);res(cv.toDataURL('image/jpeg',q))};im.src=fr.result};fr.readAsDataURL(file)})}
async function uploadPhoto(dataUrl,name){if(!CLOUD)return null;try{const r=await fetch('api/upload',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({filename:name||'postre.jpg',dataUrl})});if(!r.ok)return null;const j=await r.json();return j.url||null}catch(e){return null}}
async function previewPhoto(e){const file=e.target.files&&e.target.files[0];if(!file)return;if(!/^image\//.test(file.type))return toast('Elige un archivo de imagen.',true);
const img=$('#photoPreview'),hint=$('#photoHint');hint.textContent='Preparando la foto…';
try{const dataUrl=await compressImage(file,1280,.82);img.src=dataUrl;img.dataset.value=dataUrl;img.style.display='block';
hint.textContent='Foto lista ✓';
const url=await uploadPhoto(dataUrl,file.name);
if(url){img.dataset.value=url;img.src=url;hint.textContent='Foto guardada ✓'}}
catch(err){console.error(err);hint.textContent='No pude usar esa foto.';toast('No pude usar esa foto. Intenta con otra.',true)}
finally{e.target.value=''}}
function saveRecipe(id){const name=$('#rName').value.trim(),yieldN=parseQty($('#rYield').value)||0,price=recipeFinalPrice();
if(!name||!yieldN)return toast('Añade el nombre y cuántas porciones rinde.',true);
const ingredients=[...document.querySelectorAll('.ingredient-line')].map(l=>{const sel=l.querySelector('[data-n=ingredientId]'),ing=data.ingredients.find(i=>i.id===(sel&&sel.value));const manual=l.querySelector('[data-n=name]');
return{ingredientId:ing?ing.id:undefined,name:(ing&&ing.name)||(manual&&manual.value.trim())||l.dataset.name||'',qty:parseQty(l.querySelector('[data-n=qty]').value),unit:(l.querySelector('[data-n=unit]')||{}).value||'u',cost:+l.querySelector('[data-n=cost]').value||0}}).filter(x=>x.name&&x.qty>0);
const photo=$('#photoPreview').dataset.value||'';
const rec=sello({id:id||crypto.randomUUID(),name,yield:yieldN,price,ingredients,photo});
if(id)data.recipes=data.recipes.map(x=>x.id===id?rec:x);else data.recipes.push(rec);
save(id?'Receta actualizada':'Receta guardada');closeModal()}
function openSale(id){const v=data.sales.find(x=>x.id===id)||{date:new Date().toISOString().slice(0,10),product:'',qty:1,total:'',recipeId:''};
const opts=data.recipes.map(r=>`<option value="${r.id}" ${v.recipeId===r.id?'selected':''}>${esc(r.name)} · ${money(r.price)}/porción</option>`).join('');
openModal(id?'Editar venta':'Registrar venta',`<div class="form-grid">${field('Fecha','sDate','date',v.date)}<div class="field"><label>Producto</label><select id="sRecipe" onchange="saleAuto(true)"><option value="">Venta general</option>${opts}</select></div>${field('Descripción','sProduct','text',esc(v.product),'placeholder="ej. Caja de brownies"')}${field('Cantidad','sQty','text',v.qty,'readonly data-pad="1" onfocus="openPad(this)" onclick="openPad(this)" oninput="saleAuto()"')}${field('Total cobrado ($)','sTotal','number',v.total,'min="0" step="0.01" inputmode="decimal"')}</div><p class="helper" id="saleHint"></p><div class="modal-actions"><button class="btn alt" onclick="closeModal()">Cancelar</button><button class="btn" onclick="addSale('${id||''}')">Guardar venta</button></div>`);saleAuto()}
function saleAuto(fromSelect){const r=data.recipes.find(x=>x.id===$('#sRecipe').value),hint=$('#saleHint');if(!r){hint.textContent='';return}
const qty=parseQty($('#sQty').value)||1;if(fromSelect&&!$('#sProduct').value.trim())$('#sProduct').value=r.name;
const sugerido=recipePrice(r)*qty;if(fromSelect||!$('#sTotal').value)if(sugerido)$('#sTotal').value=sugerido.toFixed(2);
hint.textContent=`Con tu precio serían ${money(sugerido)} · hacerlos te cuesta unos ${money(recipeUnitCost(r)*qty)}`}
function addSale(id){const product=$('#sProduct').value.trim(),total=+$('#sTotal').value,qty=parseQty($('#sQty').value),recipeId=$('#sRecipe').value,date=$('#sDate').value;
if(!product||!(total>0)||!(qty>0))return toast('Completa producto, cantidad y total.',true);
const rec=sello({id:id||crypto.randomUUID(),date,product,total,qty,recipeId});
if(id)data.sales=data.sales.map(x=>x.id===id?rec:x);else data.sales.unshift(rec);
data.sales.sort((a,b)=>String(b.date).localeCompare(String(a.date)));
save(id?'Venta actualizada':'Venta registrada');closeModal()}
function openExpense(id){const g=data.expenses.find(x=>x.id===id)||
 {date:new Date().toISOString().slice(0,10),name:'',category:'Servicios',amount:'',tipo:'gasto'};
const cats=['Servicios','Transporte','Empaque','Ingredientes','Marketing','Mano de obra','Maquinaria','Otro'];
const tipo=tipoGasto(g);
openModal(id?'Editar':'Registrar',`
 <div class="kind-tabs" role="tablist">${TIPOS_GASTO.map(t=>`
  <button type="button" role="tab" class="${t.k===tipo?'active':''}" data-tipo="${t.k}" onclick="pickTipo(this)">${esc(t.n)}</button>`).join('')}
  <input type="hidden" id="eTipo" value="${tipo}"></div>
 <p class="helper" id="tipoAyuda">${esc((TIPOS_GASTO.find(t=>t.k===tipo)||TIPOS_GASTO[0]).d)}</p>
 <div class="form-grid">
  ${field('Fecha','eDate','date',g.date)}
  ${field('Concepto','eName','text',esc(g.name),'placeholder="ej. Gas para horno"')}
  <div class="field"><label>Categoría</label><select id="eCategory">${cats.map(c=>`<option ${g.category===c?'selected':''}>${c}</option>`).join('')}</select></div>
  ${field('Precio de uno ($)','eAmount','number',g.amount,'min="0" step="0.01" inputmode="decimal" oninput="renderGastoPreview()"')}
  ${field('¿Cuántos?','eCantidad','text',cantidadDe(g)>1?prettyQty(cantidadDe(g)):'','readonly data-pad="1" placeholder="1" onfocus="openPad(this)" onclick="openPad(this)" oninput="renderGastoPreview()"')}
 </div>
 <div id="gastoPreview" class="preview"></div>
 <div class="field" id="frecuenciaCampo" style="${tipo==='recurrente'?'':'display:none'}">
  <label>¿Cada cuánto se repite?</label>
  <select id="eFrecuencia">${FRECUENCIAS.map(f=>`<option value="${f.k}" ${frecuenciaDe(g)===f.k?'selected':''}>${esc(f.n)}</option>`).join('')}</select>
  <small class="helper">Se anota una vez y se cuenta solo cada período, desde la fecha de arriba. No hay que volver a escribirlo cada mes.</small>
 </div>
 <div class="modal-actions"><button class="btn alt" onclick="closeModal()">Cancelar</button><button class="btn" onclick="addExpense('${id||''}')">Guardar</button></div>`);
renderGastoPreview()}

/** El total a la vista mientras escribe: dos rollos a $1.25 son $2.50. */
function renderGastoPreview(){
 const el=$('#gastoPreview');if(!el)return;
 const precio=+($('#eAmount')||{}).value||0;
 const cuantos=parseQty(($('#eCantidad')||{}).value||'')||1;
 if(!(precio>0)){el.innerHTML='';el.style.display='none';return}
 el.style.display='';
 el.innerHTML=cuantos>1
  ? `<b>${money(precio*cuantos)}</b> en total · ${prettyQty(cuantos)} × ${money(precio)}`
  : `<b>${money(precio)}</b>`}

function pickTipo(btn){
 document.querySelectorAll('.kind-tabs button[data-tipo]').forEach(b=>b.classList.toggle('active',b===btn));
 const t=btn.dataset.tipo;
 $('#eTipo').value=t;
 const info=TIPOS_GASTO.find(z=>z.k===t)||TIPOS_GASTO[0];
 $('#tipoAyuda').textContent=info.d;
 $('#frecuenciaCampo').style.display=t==='recurrente'?'':'none'}

function addExpense(id){const name=$('#eName').value.trim(),amount=+$('#eAmount').value;
if(!name||!(amount>0))return toast('Completa el concepto y el monto.',true);
const tipo=$('#eTipo').value||'gasto';
const cantidad=parseQty($('#eCantidad').value||'')||1;
const rec=sello({id:id||crypto.randomUUID(),date:$('#eDate').value,name,
 category:$('#eCategory').value,amount,cantidad,tipo,
 frecuencia:tipo==='recurrente'?($('#eFrecuencia').value||'mensual'):undefined});
if(id)data.expenses=data.expenses.map(x=>x.id===id?rec:x);else data.expenses.unshift(rec);
data.expenses.sort((a,b)=>String(b.date).localeCompare(String(a.date)));
save(id?'Actualizado':'Registrado');closeModal()}
function removeItem(type,id){if(!confirm('¿Borrar esto? No se puede deshacer.'))return;
data[type]=data[type].filter(x=>x.id!==id);
// La lápida es lo que impide que el registro reaparezca desde el otro dispositivo.
graves[type]=graves[type].filter(x=>x.id!==id).concat([S.tombstone(id)]);
save('Registro eliminado')}
let calcMode='margin';
/**
 * La calculadora de precio. Vive en dos sitios —la pantalla de recetas y la
 * ventana que se abre desde una receta— y es la MISMA: los mismos dos modos,
 * el mismo deslizador, los mismos avisos. Cambian sólo los identificadores de
 * los campos, así que se pasan como parámetro en vez de escribirla dos veces.
 */
const CALC_IDS={
 fija:  {cost:'#quickCost', pct:'#quickMargin', slider:'#quickSlider', label:'#quickPctLabel',
         caption:'#quickCaption', price:'#quickPrice', note:'#quickNote', modes:'#calcMode'},
 modal: {cost:'#mQuickCost', pct:'#mQuickPct', slider:'#mQuickSlider', label:'#mQuickPctLabel',
         caption:'#mQuickCaption', price:'#mQuickPrice', note:'#mQuickNote', modes:'#mCalcMode'}
};
const calcIds=enModal=>CALC_IDS[enModal?'modal':'fija'];

function setCalcMode(m,enModal){calcMode=m;
 const id=calcIds(enModal);
 document.querySelectorAll(id.modes+' button').forEach(b=>b.classList.toggle('active',b.dataset.mode===m));
 const et=$(id.label);
 if(et)et.textContent=m==='margin'?'De cada venta quiero ganar (%)':'Al costo le sumo (%)';
 const inp=$(id.pct);if(!inp)return;
 inp.max=m==='margin'?99:1000;
 if(m==='markup'&&+inp.value===65)inp.value=100;
 if(m==='margin'&&+inp.value>99)inp.value=65;
 const sl=$(id.slider);if(sl){sl.max=m==='margin'?95:300;sl.value=Math.min(+inp.value,+sl.max)}
 quickCalc(enModal)}

function quickCalc(enModal){
 const id=calcIds(enModal);
 const campoCosto=$(id.cost);if(!campoCosto)return;
 const cost=Math.max(0,+campoCosto.value||0),note=$(id.note);
 const inp=$(id.pct);
 let pct=+inp.value;if(!isFinite(pct))pct=0;
 let msg='',warn=false;

 if(calcMode==='markup'){
  if(pct<0){pct=0;inp.value=0}
  const price=cost*(1+pct/100),eq=price?(price-cost)/price*100:0;
  $(id.caption).textContent=`Precio cobrando ${pct}% sobre el costo`;
  $(id.price).textContent=money(price);
  msg=cost?`Ganas ${money(price-cost)} por porción: ${eq.toFixed(0)} centavos de cada dólar que cobras.`
          :'Escribe cuánto te cuesta una porción.';
 }else{
  if(pct>=100){pct=99;inp.value=99;
   msg='Para ganar el 100% del precio, hacer el postre tendría que costarte $0. Lo dejé en 99%. Si querías cobrar el doble de lo que te cuesta, usa la otra opción.';warn=true}
  else if(pct<0){pct=0;inp.value=0}
  const price=cost/(1-pct/100);
  $(id.caption).textContent='Precio mínimo recomendado';
  $(id.price).textContent=money(price);
  if(!msg){
   if(pct>=90){msg='Es un precio alto. Revisa que la gente lo siga comprando.';warn=true}
   else if(cost&&pct&&pct<40){msg='Ganas poco. Recuerda sumar el gas, las cajas y tu tiempo.';warn=true}
   else if(cost)msg=`Ganas ${money(price-cost)} por porción.`;
   else msg='Escribe cuánto te cuesta una porción.';}
 }
 const sl=$(id.slider);if(sl&&+sl.value!==pct)sl.value=Math.min(pct,+sl.max);
 note.className='calc-warning'+(warn?'':' info');note.textContent=msg}

let deferredPrompt;
const standalone=window.matchMedia('(display-mode: standalone)').matches||window.navigator.standalone===true;
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredPrompt=e;showInstall('Agrega Olivo & Liora a tu pantalla de inicio y ábrela como cualquier app.',true)});
function showInstall(t,canPrompt){if(standalone||localStorage.getItem('dismissed-install'))return;
$('#installText').textContent=t;
const box=$('#install');box.classList.add('show');
const old=box.querySelector('.btn');if(old)old.remove();
if(canPrompt){const b=document.createElement('button');b.className='btn small';b.textContent='Instalar';b.onclick=async()=>{box.classList.remove('show');if(deferredPrompt){deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null}};box.insertBefore(b,box.lastElementChild)}}
function dismissInstall(){localStorage.setItem('dismissed-install','1');$('#install').classList.remove('show')}
if(/iphone|ipad|ipod/i.test(navigator.userAgent)&&!standalone)showInstall('Para tenerla siempre a mano: toca Compartir ↑ abajo y elige “Agregar a pantalla de inicio”.');
window.addEventListener('online',()=>document.body.classList.remove('offline'));
window.addEventListener('offline',()=>document.body.classList.add('offline'));
if(!navigator.onLine)document.body.classList.add('offline');
if('serviceWorker'in navigator)window.addEventListener('load',()=>{navigator.serviceWorker.register('sw.js').then(reg=>{reg.addEventListener('updatefound',()=>{const w=reg.installing;w&&w.addEventListener('statechange',()=>{if(w.state==='installed'&&navigator.serviceWorker.controller)toast('Hay mejoras nuevas. Cierra y vuelve a abrir la app.')})})}).catch(()=>{})});
// Filtros de período: los datos siguen siendo locales hasta conectar una base remota.
const baseRender=render;
// Cuántos períodos atrás (o adelante) se está mirando. Cero es el de ahora.
// Existe para poder decir "y en agosto, ¿cómo nos fue?" sin escribir fechas.
let periodoOffset=0;

/** Mueve el período uno atrás o uno adelante. Nunca más allá del actual. */
function moverPeriodo(paso){
 const f=($('#periodFilter')||{}).value||'month';
 if(!rangoDePeriodo(f,0).movible)return;
 periodoOffset=Math.min(0,periodoOffset+paso);
 render()}

/** Al cambiar de tipo de período se vuelve al de ahora. */
function cambiarPeriodo(){periodoOffset=0;render()}

/**
 * De qué fechas se está hablando. La cuenta vive en el núcleo compartido, para
 * que el teléfono y la web no puedan separarse.
 */
function periodRange(){
 const f=($('#periodFilter')||{}).value||'month';
 const r=rangoDePeriodo(f,periodoOffset);
 let start=r.desde,end=r.hasta,label=r.etiqueta;
 if(f==='custom'){
  const from=($('#filterFrom')||{}).value,to=($('#filterTo')||{}).value;
  start=new Date((from||'1900-01-01')+'T00:00:00');
  if(to)end=new Date(to+'T23:59:59');
  label='Fechas elegidas';
 }
 const cd=$('#customDates');if(cd)cd.style.display=f==='custom'?'grid':'none';
 const et=$('#periodLabel');if(et)et.textContent=label;
 const mover=$('#periodMover');if(mover)mover.style.display=r.movible?'':'none';
 // No se puede ir más allá del período de ahora: no hay datos del futuro.
 const sig=$('#periodNext');if(sig)sig.disabled=periodoOffset>=0;
 return{start,end,label}}
render=function(){const{start,end,label}=periodRange();const all={sales:data.sales,expenses:data.expenses};window.ALLDATA=all;
const inRange=d=>{const t=new Date(String(d).length<=10?String(d)+'T12:00:00':d);return !isNaN(t)&&t>=start&&t<=end};
data.sales=all.sales.filter(x=>inRange(x.date));data.expenses=all.expenses.filter(x=>inRange(x.date));
try{
baseRender();
const total=data.sales.reduce((a,x)=>a+(+x.total||0),0);
const ticket=data.sales.length?total/data.sales.length:0;
const unidades=data.sales.reduce((a,x)=>a+(+x.qty||0),0);
const top=[...data.sales].sort((a,b)=>b.total-a.total)[0];
$('#periodLabel').textContent=label||'Control de negocio';
$('#stats').innerHTML=`<div class="row"><span class="dot"></span><div class="grow"><b>Venta promedio</b><small>Cuánto deja cada venta</small></div><span class="amount">${money(ticket)}</span></div>
<div class="row"><span class="dot"></span><div class="grow"><b>Ventas registradas</b><small>En este período</small></div><span class="amount">${data.sales.length}</span></div>
<div class="row"><span class="dot"></span><div class="grow"><b>Porciones vendidas</b><small>En total</small></div><span class="amount">${unidades}</span></div>
<div class="row"><span class="dot"></span><div class="grow"><b>Tu mejor venta</b><small>${top?esc(top.product):'Sin ventas aún'}</small></div><span class="amount">${top?money(top.total):'—'}</span></div>`;
renderTopProducts();
const profitEl=$('#mProfit');const profit=total-data.sales.reduce((a,x)=>{const r=data.recipes.find(y=>y.id===x.recipeId);return a+(r?recipeUnitCost(r)*(+x.qty||0):0)},0)-desgloseGastos(all.expenses,start,end).operativo;
profitEl.style.color=profit<0?'var(--red)':'var(--ink)';$('#mMargin').className=profit<0?'':'';$('#mMargin').style.color=profit<0?'var(--red)':'';
}finally{data.sales=all.sales;data.expenses=all.expenses}};
loadLocal();nav();render();setCalcMode('margin');bootSync();checarVision();
