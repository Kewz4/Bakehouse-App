const KEY='olivo-liora-data-v1';let data=JSON.parse(localStorage.getItem(KEY)||'{"ingredients":[],"recipes":[],"sales":[],"expenses":[]}');const $=s=>document.querySelector(s);const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(n)||0);// ---- Guardado automático ----
// Se escribe primero en el teléfono (instantáneo) y enseguida se sincroniza
// con el almacenamiento en la nube. La usuaria sólo ve "Guardando…" / "Guardado".
let CLOUD=false, syncTimer=null, syncing=false, pendiente=false;
function setSync(estado){const el=document.getElementById('syncStatus');if(!el)return;
const textos={guardando:'Guardando…',guardado:'Guardado',local:'Guardado en tu teléfono',error:'Se guardará al volver el internet'};
el.textContent=textos[estado]||'';el.dataset.state=estado}
const save=(msg)=>{data.updatedAt=Date.now();
try{localStorage.setItem(KEY,JSON.stringify(data))}catch(e){toast('Tu teléfono se quedó sin espacio. Prueba borrando registros muy viejos.',true);return false}
render();if(msg)toast(msg);setSync(CLOUD?'guardando':'local');scheduleSync();return true};
function scheduleSync(){if(!CLOUD)return;clearTimeout(syncTimer);syncTimer=setTimeout(syncNow,700)}
async function syncNow(){if(!CLOUD)return;if(syncing){pendiente=true;return}
syncing=true;setSync('guardando');
try{const r=await fetch('api/data',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(data)});
if(!r.ok)throw new Error('sync');const j=await r.json();data.updatedAt=j.updatedAt||data.updatedAt;
localStorage.setItem(KEY,JSON.stringify(data));setSync('guardado')}
catch(e){setSync('error')}
finally{syncing=false;if(pendiente){pendiente=false;scheduleSync()}}}
async function bootSync(){try{const r=await fetch('api/data',{cache:'no-store'});if(!r.ok)throw new Error('off');
const j=await r.json();
if(!j.enabled){CLOUD=false;setSync('local');return}
CLOUD=true;
const remoto=j.data,rt=+j.updatedAt||0,lt=+data.updatedAt||0;
if(remoto&&rt>=lt){data={ingredients:remoto.ingredients||[],recipes:remoto.recipes||[],sales:remoto.sales||[],expenses:remoto.expenses||[],updatedAt:rt};
localStorage.setItem(KEY,JSON.stringify(data));render();setSync('guardado')}
else{await syncNow()}}
catch(e){CLOUD=false;setSync('local')}}
window.addEventListener('online',()=>{if(CLOUD)syncNow()});
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
document.addEventListener('click',e=>{const pad=document.getElementById('pad');
if(!pad||!pad.classList.contains('show'))return;
if(pad.contains(e.target)||e.target===padTarget)return;
if(e.target.dataset&&e.target.dataset.pad!=null)return;
closePad()},true);
// Muestra un número bonito: 0.5 -> "½", 1.25 -> "1 ¼"
function prettyQty(n){if(!isFinite(n)||!n)return '0';
const entero=Math.floor(n),resto=+(n-entero).toFixed(3);
const mapa={0.5:'½',0.25:'¼',0.75:'¾',0.333:'⅓',0.667:'⅔',0.125:'⅛'};
const frac=mapa[resto];
if(!frac)return String(+n.toFixed(2));
return (entero?entero+' ':'')+frac}
const unitFamily=k=>unitInfo(k).fam;
function unitOptions(selected,family){return Object.entries(UNITS).filter(([k,v])=>!family||v.fam===family).map(([k,v])=>`<option value="${k}" ${k===selected?'selected':''}>${v.n}</option>`).join('')}
// costo del ingrediente por unidad base (por gramo, por ml o por unidad)
function baseCost(ing){const q=(+ing.quantity||1)*unitInfo(ing.unitSingle).f;return (+ing.price||0)/(q||1)}
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtDate=d=>{if(!d)return '—';const m=String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);return m?`${m[3]}/${m[2]}/${m[1].slice(2)}`:d};
let toastTimer;function toast(msg,isError){const t=$('#toast');t.textContent=msg;t.className='show'+(isError?' err':'');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.className='',isError?4200:2400)}
function go(view){if(!document.getElementById(view))view='dashboard';document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===view));$('#fab').dataset.view=view;window.scrollTo({top:0,behavior:'smooth'});try{history.replaceState(null,'','#'+view)}catch(e){}}
function fabAction(){({dashboard:openSale,recipes:openRecipe,sales:openSale,expenses:openExpense,inventory:openIngredient}[$('#fab').dataset.view||'dashboard'])()}
function nav(){document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>go(b.dataset.view));go((location.hash||'#dashboard').slice(1));window.addEventListener('hashchange',()=>go(location.hash.slice(1)))}
function recipeCost(r){return (r.ingredients||[]).reduce((s,i)=>s+(+i.qty||0)*(+i.cost||0),0)}function recipePrice(r){return +r.price||0}function recipeUnitCost(r){return recipeCost(r)/(+r.yield||1)}function recipeMargin(r){const p=recipePrice(r);return p?(p-recipeUnitCost(r))/p*100:0}function suggestPrice(r,target=65){return recipeUnitCost(r)/(1-target/100)}function render(){const sales=data.sales.reduce((a,s)=>a+(+s.total||0),0),production=data.sales.reduce((a,s)=>{let r=data.recipes.find(x=>x.id===s.recipeId);return a+(r?recipeUnitCost(r)*(+s.qty||0):0)},0),expenses=data.expenses.reduce((a,e)=>a+(+e.amount||0),0),profit=sales-production-expenses;$('#mSales').textContent=money(sales);$('#mCost').textContent=money(production);$('#mExpenses').textContent=money(expenses);$('#mProfit').textContent=money(profit);$('#mMargin').textContent=sales?'Te quedan '+Math.round(profit/sales*100)+' centavos de cada dólar':'Aún sin ventas';renderRecipes();renderTables();renderChart(sales);renderAlerts()}
function renderRecipes(){const q=(($('#recipeSearch')||{}).value||'').toLowerCase().trim();const list=data.recipes.filter(r=>!q||(r.name||'').toLowerCase().includes(q));const el=$('#recipesList');el.innerHTML=list.length?list.map(r=>{const c=recipeCost(r),u=recipeUnitCost(r),p=recipePrice(r),m=recipeMargin(r),cls=!p?'warn':m>=60?'ok':m>=45?'warn':'bad';return `<article class="recipe">${r.photo?`<img class="recipe-photo" src="${esc(r.photo)}" alt="${esc(r.name)}" loading="lazy">`:''}<span class="tag">${esc(r.yield)} porciones</span><h3>${esc(r.name)}</h3><small>${(r.ingredients||[]).length} ingredientes · costo por porción ${money(u)}</small><div class="recipe-data"><div><span>Costo total</span><b>${money(c)}</b></div><div><span>Precio / porción</span><b>${money(p)}</b></div></div><span class="badge ${cls}">${p?`Ganas ${m.toFixed(0)}% de cada venta`:'Falta ponerle precio'}</span>${p&&m<60?`<p class="helper">Cobrando <b>${money(suggestPrice(r))}</b> ganarías más</p>`:''}<div class="recipe-actions"><button onclick="openRecipe('${r.id}')">Editar</button><button onclick="duplicateRecipe('${r.id}')">Duplicar</button><button onclick="quickFromRecipe('${r.id}')">Calcular precio</button><button class="negative" onclick="removeItem('recipes','${r.id}')">Eliminar</button></div></article>`}).join(''):`<div class="empty">${q?'Ninguna receta coincide con tu búsqueda.':'Crea tu primer postre y calcula en un minuto cuánto cobrar.'}</div>`}
function duplicateRecipe(id){const r=data.recipes.find(x=>x.id===id);if(!r)return;data.recipes.push({...r,id:crypto.randomUUID(),name:r.name+' (copia)',ingredients:(r.ingredients||[]).map(i=>({...i}))});save('Receta duplicada')}
function quickFromRecipe(id){const r=data.recipes.find(x=>x.id===id);if(!r)return;go('recipes');$('#quickCost').value=recipeUnitCost(r).toFixed(2);quickCalc();$('#quickCost').scrollIntoView({behavior:'smooth',block:'center'});toast('Listo: costo de una porción de '+r.name)}
function renderTables(){
const qs=(($('#saleSearch')||{}).value||'').toLowerCase().trim();
const sl=data.sales.filter(x=>!qs||(x.product||'').toLowerCase().includes(qs));
$('#salesRows').innerHTML=sl.map(x=>{const r=data.recipes.find(r=>r.id===x.recipeId),cost=r?recipeUnitCost(r)*(+x.qty||0):0,prof=(+x.total||0)-cost;return `<tr><td data-label="Fecha">${fmtDate(x.date)}</td><td class="main"><b>${esc(x.product)}</b></td><td data-label="Cant.">${esc(x.qty)}</td><td class="amount" data-label="Total">${money(x.total)}</td><td class="${prof>=0?'positive':'negative'}" data-label="Utilidad">${money(prof)}</td><td class="actions"><button class="icon-btn" onclick="openSale('${x.id}')" aria-label="Editar venta">✎</button><button class="icon-btn" onclick="removeItem('sales','${x.id}')" aria-label="Eliminar venta">×</button></td></tr>`}).join('');
$('#salesEmpty').style.display=sl.length?'none':'block';
const qe=(($('#expenseSearch')||{}).value||'').toLowerCase().trim();
const ex=data.expenses.filter(x=>!qe||(x.name||'').toLowerCase().includes(qe)||(x.category||'').toLowerCase().includes(qe));
$('#expenseRows').innerHTML=ex.map(x=>`<tr><td data-label="Fecha">${fmtDate(x.date)}</td><td class="main"><b>${esc(x.name)}</b></td><td data-label="Categoría"><span class="chip">${esc(x.category)}</span></td><td class="amount negative" data-label="Monto">${money(x.amount)}</td><td class="actions"><button class="icon-btn" onclick="openExpense('${x.id}')" aria-label="Editar gasto">✎</button><button class="icon-btn" onclick="removeItem('expenses','${x.id}')" aria-label="Eliminar gasto">×</button></td></tr>`).join('');
$('#expensesEmpty').style.display=ex.length?'none':'block';
const qi=(($('#ingSearch')||{}).value||'').toLowerCase().trim();
const ing=data.ingredients.filter(x=>!qi||(x.name||'').toLowerCase().includes(qi));
$('#ingredientRows').innerHTML=ing.map(x=>`<tr><td class="main"><b>${esc(x.name)}</b></td><td data-label="Cómo lo compras">${esc(x.unit)} de ${esc(x.quantity)} ${esc(unitInfo(x.unitSingle).s)}</td><td data-label="Te costó">${money(x.price)}</td><td class="amount" data-label="Sale a">${money(baseCost(x)*unitInfo(x.unitSingle).f)} / ${esc(unitInfo(x.unitSingle).s)}</td><td class="actions"><button class="icon-btn" onclick="openIngredient('${x.id}')" aria-label="Editar ingrediente">✎</button><button class="icon-btn" onclick="removeItem('ingredients','${x.id}')" aria-label="Eliminar ingrediente">×</button></td></tr>`).join('');
$('#ingredientsEmpty').style.display=ing.length?'none':'block'}
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
function openIngredient(id){const g=data.ingredients.find(x=>x.id===id)||{name:'',unit:'',quantity:1,price:'',unitSingle:'unidad'};
openModal(id?'Editar ingrediente':'Nuevo ingrediente',`<div class="form-grid">${field('Nombre','ingName','text',esc(g.name))}${field('¿Cómo lo compras?','ingUnit','text',esc(g.unit),'placeholder="ej. bolsa, caja, botella"')}${field('¿Cuánto trae?','ingQty','text',g.quantity!=null&&g.quantity!==''?prettyQty(g.quantity):'','readonly data-pad="1" placeholder="toca para escribir" onfocus="openPad(this)" onclick="openPad(this)"')}<div class="field"><label>¿En qué se mide?</label><select id="ingUnitSingle">${unitOptions(g.unitSingle||'g')}</select></div>${field('¿Cuánto te costó? ($)','ingPrice','number',g.price,'min="0" step="0.01" inputmode="decimal"')}</div><p class="helper">Ejemplo: compras una bolsa de harina de 5 libras por $6.50 → escribes “bolsa”, 5 y eliges “libras”. Después en tus recetas puedes usar gramos: la cuenta se hace sola.</p><div class="modal-actions"><button class="btn alt" onclick="closeModal()">Cancelar</button><button class="btn" onclick="addIngredient('${id||''}')">Guardar ingrediente</button></div>`)}
function addIngredient(id){const name=$('#ingName').value.trim(),unit=$('#ingUnit').value.trim(),quantity=parseQty($('#ingQty').value),price=+$('#ingPrice').value,unitSingle=$('#ingUnitSingle').value||'g';
if(!name||!unit||!quantity||!(price>=0))return toast('Completa todos los campos.',true);
const rec={id:id||crypto.randomUUID(),name,unit,quantity,price,unitSingle};
if(id)data.ingredients=data.ingredients.map(x=>x.id===id?rec:x);else data.ingredients.push(rec);
save(id?'Ingrediente actualizado':'Ingrediente guardado');closeModal()}
function ingredientLines(lines=[]){return `<div class="ingredients" id="ingredientsForm">${(lines.length?lines:[{}]).map(x=>ingredientLine(x)).join('')}</div><button class="btn alt" type="button" onclick="addLine()">+ Agregar ingrediente</button>`}
function ingredientLine(x={}){const opts=data.ingredients.map(i=>`<option value="${i.id}" ${x.ingredientId===i.id?'selected':''}>${esc(i.name)}</option>`).join('');
const sel=data.ingredients.find(i=>i.id===x.ingredientId);
const name=x.name||(sel&&sel.name)||'';
const unit=x.unit||(sel?sel.unitSingle:'g')||'g';
const cost=x.cost!=null&&x.cost!==''?x.cost:(sel?(baseCost(sel)*unitInfo(unit).f).toFixed(4):'');
return `<div class="ingredient-line" data-name="${esc(name)}">
${data.ingredients.length?`<select data-n="ingredientId" onchange="pickIngredient(this)"><option value="">Elige un ingrediente</option>${opts}</select>`:`<input placeholder="Ingrediente" value="${esc(name)}" data-n="name">`}
<input type="text" readonly data-pad="1" placeholder="cantidad" value="${x.qty!=null&&x.qty!==''?prettyQty(x.qty):''}" data-n="qty" onfocus="openPad(this)" onclick="openPad(this)" oninput="lineTotal(this)">
<select data-n="unit" onchange="pickUnit(this)">${unitOptions(unit,sel?unitFamily(sel.unitSingle):null)}</select>
<input type="hidden" data-n="cost" value="${cost}">
<button class="icon-btn" type="button" aria-label="Quitar ingrediente" onclick="this.closest('.ingredient-line').remove();recipeTotals()">×</button>
<div class="line-total"></div></div>`}
function pickIngredient(select){const ing=data.ingredients.find(i=>i.id===select.value),line=select.closest('.ingredient-line');if(!ing)return;
line.dataset.name=ing.name;
const us=line.querySelector('[data-n=unit]');
us.innerHTML=unitOptions(ing.unitSingle,unitFamily(ing.unitSingle));
pickUnit(us)}
function pickUnit(select){const line=select.closest('.ingredient-line'),ing=data.ingredients.find(i=>i.id===(line.querySelector('[data-n=ingredientId]')||{}).value);
if(ing)line.querySelector('[data-n=cost]').value=(baseCost(ing)*unitInfo(select.value).f).toFixed(6);
lineTotal(select)}
function addLine(){$('#ingredientsForm').insertAdjacentHTML('beforeend',ingredientLine());recipeTotals()}
function lineTotal(el){const l=el.closest('.ingredient-line'),q=parseQty(l.querySelector('[data-n=qty]').value),c=+l.querySelector('[data-n=cost]').value||0;
const u=(l.querySelector('[data-n=unit]')||{}).value;
l.querySelector('.line-total').textContent=q&&c?`${prettyQty(q)} ${unitInfo(u).s} cuestan ${money(q*c)}`:'';recipeTotals()}
function recipeTotals(){const box=$('#recipeTotals');if(!box)return;let total=0;document.querySelectorAll('.ingredient-line').forEach(l=>{total+=parseQty(l.querySelector('[data-n=qty]').value)*(+l.querySelector('[data-n=cost]').value||0)});
const y=parseQty($('#rYield').value)||1,pr=+$('#rPrice').value||0,u=total/y,m=pr?(pr-u)/pr*100:0;
box.innerHTML=`<div class="recipe-data" style="margin:0"><div><span>Costo total</span><b>${money(total)}</b></div><div><span>Costo por porción</span><b>${money(u)}</b></div><div><span>Precio / porción</span><b>${money(pr)}</b></div><div><span>Ganas del precio</span><b class="${!pr?'':m>=55?'positive':'negative'}">${pr?m.toFixed(0)+'%':'—'}</b></div></div>${u&&(!pr||m<55)?`<p class="helper">Cobrando <b>${money(u/0.35)}</b> por porción tendrías buena ganancia.</p>`:''}`}
function openRecipe(id){const r=data.recipes.find(x=>x.id===id)||{name:'',yield:1,price:'',ingredients:[],photo:''};
openModal(id?'Editar receta':'Nueva receta',`<div class="form-grid">${field('Nombre del postre','rName','text',esc(r.name))}${field('Porciones que rinde','rYield','text',r.yield,'readonly data-pad="1" onfocus="openPad(this)" onclick="openPad(this)" oninput="recipeTotals()"')}${field('Precio de venta por porción ($)','rPrice','number',r.price,'min="0" step="0.01" inputmode="decimal" oninput="recipeTotals()"')}
<div class="field full"><label>Foto del postre (opcional)</label><div class="photo-drop"><img id="photoPreview" src="${esc(r.photo||'')}" data-value="${esc(r.photo||'')}" alt="Vista previa" style="${r.photo?'':'display:none'}">
<div class="photo-btns"><input id="rCam" type="file" accept="image/*" capture="environment" onchange="previewPhoto(event)" hidden><input id="rPhoto" type="file" accept="image/*" onchange="previewPhoto(event)" hidden>
<button type="button" class="btn alt small" onclick="$('#rCam').click()">📷 Tomar foto</button><button type="button" class="btn alt small" onclick="$('#rPhoto').click()">🖼 Elegir foto</button><button type="button" class="btn danger small" onclick="clearPhoto()">Quitar</button></div></div>
<p class="helper" id="photoHint">Toma una foto o elige una de tu galería.</p></div></div>
<h3 style="margin-top:20px">Ingredientes usados en la receta</h3><p class="helper">Elige un ingrediente y toca la cantidad: se abre un teclado con números y fracciones (½, ⅓, ¼…).</p>${ingredientLines(r.ingredients)}
<div id="recipeTotals" style="margin-top:16px"></div>
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
function saveRecipe(id){const name=$('#rName').value.trim(),yieldN=parseQty($('#rYield').value)||0,price=+$('#rPrice').value;
if(!name||!yieldN)return toast('Añade el nombre y cuántas porciones rinde.',true);
const ingredients=[...document.querySelectorAll('.ingredient-line')].map(l=>{const sel=l.querySelector('[data-n=ingredientId]'),ing=data.ingredients.find(i=>i.id===(sel&&sel.value));const manual=l.querySelector('[data-n=name]');
return{ingredientId:ing?ing.id:undefined,name:(ing&&ing.name)||(manual&&manual.value.trim())||l.dataset.name||'',qty:parseQty(l.querySelector('[data-n=qty]').value),unit:(l.querySelector('[data-n=unit]')||{}).value||'u',cost:+l.querySelector('[data-n=cost]').value||0}}).filter(x=>x.name&&x.qty>0);
const photo=$('#photoPreview').dataset.value||'';
const rec={id:id||crypto.randomUUID(),name,yield:yieldN,price,ingredients,photo};
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
const rec={id:id||crypto.randomUUID(),date,product,total,qty,recipeId};
if(id)data.sales=data.sales.map(x=>x.id===id?rec:x);else data.sales.unshift(rec);
data.sales.sort((a,b)=>String(b.date).localeCompare(String(a.date)));
save(id?'Venta actualizada':'Venta registrada');closeModal()}
function openExpense(id){const g=data.expenses.find(x=>x.id===id)||{date:new Date().toISOString().slice(0,10),name:'',category:'Servicios',amount:''};
const cats=['Servicios','Transporte','Empaque','Ingredientes','Marketing','Mano de obra','Otro'];
openModal(id?'Editar gasto':'Registrar gasto',`<div class="form-grid">${field('Fecha','eDate','date',g.date)}${field('Concepto','eName','text',esc(g.name),'placeholder="ej. Gas para horno"')}<div class="field"><label>Categoría</label><select id="eCategory">${cats.map(c=>`<option ${g.category===c?'selected':''}>${c}</option>`).join('')}</select></div>${field('Monto ($)','eAmount','number',g.amount,'min="0" step="0.01" inputmode="decimal"')}</div><div class="modal-actions"><button class="btn alt" onclick="closeModal()">Cancelar</button><button class="btn" onclick="addExpense('${id||''}')">Guardar gasto</button></div>`)}
function addExpense(id){const name=$('#eName').value.trim(),amount=+$('#eAmount').value;
if(!name||!(amount>0))return toast('Completa el concepto y el monto.',true);
const rec={id:id||crypto.randomUUID(),date:$('#eDate').value,name,category:$('#eCategory').value,amount};
if(id)data.expenses=data.expenses.map(x=>x.id===id?rec:x);else data.expenses.unshift(rec);
data.expenses.sort((a,b)=>String(b.date).localeCompare(String(a.date)));
save(id?'Gasto actualizado':'Gasto registrado');closeModal()}
function removeItem(type,id){if(!confirm('¿Borrar esto? No se puede deshacer.'))return;data[type]=data[type].filter(x=>x.id!==id);save('Registro eliminado')}
let calcMode='margin';
function setCalcMode(m){calcMode=m;document.querySelectorAll('#calcMode button').forEach(b=>b.classList.toggle('active',b.dataset.mode===m));
$('#quickPctLabel').textContent=m==='margin'?'De cada venta quiero ganar (%)':'Al costo le sumo (%)';
const inp=$('#quickMargin');inp.max=m==='margin'?99:1000;if(m==='markup'&&+inp.value===65)inp.value=100;if(m==='margin'&&+inp.value>99)inp.value=65;quickCalc()}
function quickCalc(){const cost=Math.max(0,+$('#quickCost').value||0),note=$('#quickNote');let pct=+$('#quickMargin').value;if(!isFinite(pct))pct=0;let msg='',warn=false;
if(calcMode==='markup'){if(pct<0){pct=0;$('#quickMargin').value=0}
const price=cost*(1+pct/100),eq=price?(price-cost)/price*100:0;
$('#quickCaption').textContent=`Precio cobrando ${pct}% sobre el costo`;$('#quickPrice').textContent=money(price);
msg=cost?`Ganas ${money(price-cost)} por porción: ${eq.toFixed(0)} centavos de cada dólar que cobras.`:'Escribe cuánto te cuesta una porción.';}
else{if(pct>=100){pct=99;$('#quickMargin').value=99;msg='Para ganar el 100% del precio, hacer el postre tendría que costarte $0. Lo dejé en 99%. Si lo que quieres es cobrar el doble de lo que te cuesta, toca “Sumar % al costo” y escribe 100.';warn=true}
else if(pct<0){pct=0;$('#quickMargin').value=0}
const price=cost/(1-pct/100);
$('#quickCaption').textContent='Precio mínimo recomendado';$('#quickPrice').textContent=money(price);
if(!msg){if(pct>=90){msg='Es un precio alto. Revisa que la gente lo siga comprando.';warn=true}
else if(cost&&pct&&pct<40){msg='Ganas poco. Recuerda sumar el gas, las cajas y tu tiempo.';warn=true}
else if(cost)msg=`Ganas ${money(price-cost)} por porción.`;
else msg='Escribe cuánto te cuesta una porción.';}}
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
function periodRange(){const f=($('#periodFilter')||{}).value||'month',now=new Date();let start=new Date(now),end=new Date('2999-12-31T23:59:59');
if(f==='day')start.setHours(0,0,0,0);
else if(f==='week'){start.setDate(now.getDate()-((now.getDay()+6)%7));start.setHours(0,0,0,0)}
else if(f==='month'){start.setDate(1);start.setHours(0,0,0,0)}
else if(f==='quarter'){start.setMonth(Math.floor(now.getMonth()/3)*3,1);start.setHours(0,0,0,0)}
else if(f==='semester'){start.setMonth(now.getMonth()<6?0:6,1);start.setHours(0,0,0,0)}
else if(f==='year'){start.setMonth(0,1);start.setHours(0,0,0,0)}
else if(f==='all')start=new Date('1900-01-01T00:00:00');
else if(f==='custom'){const from=($('#filterFrom')||{}).value,to=($('#filterTo')||{}).value;start=new Date((from||'1900-01-01')+'T00:00:00');if(to)end=new Date(to+'T23:59:59')}
$('#customDates').style.display=f==='custom'?'grid':'none';
const sel=$('#periodFilter')&&$('#periodFilter').selectedOptions[0];
return{start,end,label:sel?sel.textContent:''}}
render=function(){const{start,end,label}=periodRange();const all={sales:data.sales,expenses:data.expenses};window.ALLDATA=all;
const inRange=d=>{const t=new Date(String(d).length<=10?String(d)+'T12:00:00':d);return !isNaN(t)&&t>=start&&t<=end};
data.sales=all.sales.filter(x=>inRange(x.date));data.expenses=all.expenses.filter(x=>inRange(x.date));
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
const profitEl=$('#mProfit');const profit=total-data.sales.reduce((a,x)=>{const r=data.recipes.find(y=>y.id===x.recipeId);return a+(r?recipeUnitCost(r)*(+x.qty||0):0)},0)-data.expenses.reduce((a,x)=>a+(+x.amount||0),0);
profitEl.style.color=profit<0?'var(--red)':'var(--ink)';$('#mMargin').className=profit<0?'':'';$('#mMargin').style.color=profit<0?'var(--red)':'';
data.sales=all.sales;data.expenses=all.expenses};
nav();render();setCalcMode('margin');bootSync();
