import {initializeApp} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import {getFirestore,collection,getDocs,getDoc,addDoc,setDoc,doc,deleteDoc} from "https://www.gstatic.com/firebasejs/12.0.0/firebase-firestore.js";

const FB={apiKey:"AIzaSyBhY_LqT0DXU9mI27VNrIZZVboOlNFQzSs",authDomain:"vextor-d627c.firebaseapp.com",projectId:"vextor-d627c",storageBucket:"vextor-d627c.firebasestorage.app",messagingSenderId:"158596639790",appId:"1:158596639790:web:88f98a25dba712a61783bf"};
const COL='vextor_trades', CFG='vextor_config', OLD=['vextor_data','diario_personal'], BE=2, MIN_SPLASH=2000, WALL_MAX=700000;
const C={win:'#34d399',loss:'#f87171'};
const F=['fecha','resultado','activo','tf','dir','setup','ses','plan','emo','notas'];
const WALLS=[null,'linear-gradient(135deg,#020617,#0f172a)','linear-gradient(135deg,#2e1065,#172554)','linear-gradient(135deg,#022c22,#064e3b)'];
const MESES=['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

// ---------- IA (Gemini) ----------
const GEMINI_API_KEY = "AQ.Ab8RN6Ixv1qs-eahtLbH3wyfcv4qaPAFFDPhVv1Rwvt-KAB6oQ";
// gemini-1.5-flash ya no existe en la API. Se prueba en orden; si uno falla por cuota o no existe, pasa al siguiente.
const MODELS=['gemini-2.5-flash','gemini-2.5-flash-lite'];
const SYSTEM=`Eres un mentor de trading experto en SMC/ICT (liquidez BSL/SSL, order blocks, FVG, inducement, MSS). Analiza el trade que te envíen en JSON. Responde en español, en texto plano sin markdown ni asteriscos, máximo 120 palabras, en este orden: 1) Evaluación del setup. 2) Disciplina y emoción (campos plan y emo). 3) Una mejora concreta para el próximo trade. Sé directo y honesto; si faltan datos, dilo. No des asesoría financiera ni prometas resultados.`;

let db;
try{
  const app=initializeApp(FB);
  db=getFirestore(app);
}catch(e){console.error(e)}

const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const pad=n=>String(n).padStart(2,'0'), hoy=()=>new Date().toLocaleDateString('en-CA');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sum=a=>a.reduce((x,t)=>x+t.resultado,0);
const ls=(k,v)=>{try{if(v===undefined)return JSON.parse(localStorage.getItem(k));localStorage.setItem(k,JSON.stringify(v))}catch(e){}};

const S={trades:[],filter:null,offline:false,cfgWarned:false,m:new Date().getMonth(),y:new Date().getFullYear(),
  pref:{mode:'auto',hue:250,customAccent:null,blur:24,font:"'Inter',sans-serif",cur:'$',italic:false,bgDark:100,bgBlur:0,ts:0,...ls('vextor-pref')},
  wall:ls('vextor-wall')||{value:null,ts:0},          // wallpaper aparte de las preferencias (pesa mucho)
  goals:ls('vextor-goals')||{map:{},ts:0}};           // metas por mes: {"2026-10":100}
S.goals.map=S.goals.map||{};
// Migración: antes el wallpaper vivía dentro de vextor-pref
if('wall' in S.pref){
  if(S.pref.wall&&!S.wall.value)S.wall={value:S.pref.wall,ts:Date.now()};
  delete S.pref.wall;ls('vextor-wall',S.wall);ls('vextor-pref',S.pref);
}

const fmt=n=>(n<0?'-':n>0?'+':'')+S.pref.cur+Math.abs(n).toFixed(2);
const money=n=>S.pref.cur+Math.abs(n).toFixed(2);
const short=n=>{const a=Math.abs(n);return (n<0?'-':'+')+(a>=1000?(a/1000).toFixed(1).replace(/\.0$/,'')+'k':a<10?+a.toFixed(1):Math.round(a))};
const cls=n=>n>BE?'win':n<-BE?'loss':n?'be':'';
const curKey=()=>{const d=new Date();return `${d.getFullYear()}-${pad(d.getMonth()+1)}`};
// Convierte cualquier color CSS (oklch, color-mix...) a algo que Chart.js/canvas entienda siempre
const rgb=c=>{const x=document.createElement('canvas').getContext('2d');x.fillStyle='#888888';x.fillStyle=c;return x.fillStyle};

function toast(msg,type=''){const t=document.createElement('div');t.className='toast '+type;t.textContent=msg;$('#toasts').append(t);setTimeout(()=>t.remove(),3600)}

/* ---------- Sincronización de ajustes entre dispositivos ---------- */
const syncT={};
function sync(name,data,delay=700){clearTimeout(syncT[name]);syncT[name]=setTimeout(()=>store.cfgSave(name,data),delay)}
function reconcile(name,remote,local,apply){
  const rt=remote?.ts||0,lt=local.ts||0;
  if(rt>lt)apply(remote);            // lo más nuevo gana
  else if(lt>rt)store.cfgSave(name,local);
}

/* ---------- Datos ---------- */
function norm(t,i){
  let f=t.fecha;if(f?.toDate)f=f.toDate().toLocaleDateString('en-CA');
  const m=String(f??'').match(/^(\d{4})-(\d{1,2})-(\d{1,2})/),r=parseFloat(t.resultado);
  if(!m||isNaN(r))return null;
  return{...t,fecha:`${m[1]}-${pad(m[2])}-${pad(m[3])}`,resultado:r,id:'legacy-'+i};
}
const local=()=>ls('vextor-trades',S.trades);
const cfgGet=n=>getDoc(doc(db,CFG,n)).then(s=>s.exists()?s.data():null).catch(()=>null);
const store={
  async load(){
    try{
      const [cs,od,rp,rw,rg]=await Promise.all([getDocs(collection(db,COL)),getDoc(doc(db,...OLD)).catch(()=>null),cfgGet('prefs'),cfgGet('wall'),cfgGet('goals')]);
      const nuevos=cs.docs.map(d=>({id:d.id,...d.data()})),ids=new Set(nuevos.map(t=>t.id));
      const old=od?.exists()?od.data():null;let viejos=[];
      if(old&&!old.migrado&&Array.isArray(old.trades))viejos=old.trades.map(norm).filter(t=>t&&!ids.has(t.id));
      S.trades=[...nuevos,...viejos];local();
      if(viejos.length)store.migrar(viejos);

      reconcile('prefs',rp,S.pref,r=>{Object.assign(S.pref,r);ls('vextor-pref',S.pref)});
      reconcile('wall',rw,S.wall,r=>{S.wall={value:r.value??null,ts:r.ts};ls('vextor-wall',S.wall)});
      reconcile('goals',rg,S.goals,r=>{S.goals={map:r.map||{},ts:r.ts};ls('vextor-goals',S.goals)});
    }catch(e){console.error(e);S.offline=true;S.trades=ls('vextor-trades')||[];
      $('#sp-msg').textContent='Sin conexión: usando datos locales';toast('No se pudo leer Firebase (revisa tus reglas de Firestore)','err')}
  },
  async migrar(v){
    try{await Promise.all(v.map(({id,...d})=>setDoc(doc(db,COL,id),d)));await setDoc(doc(db,...OLD),{migrado:true},{merge:true});toast(`${v.length} trades antiguos migrados`)}
    catch(e){console.warn('Migración pendiente:',e)}
  },
  async save(t){const {id,...d}=t;
    try{if(id){await setDoc(doc(db,COL,id),d);return t}return {...d,id:(await addDoc(collection(db,COL),d)).id}}
    catch(e){toast('No se pudo guardar en Firebase (copia local guardada)','err');return {...d,id:id||'l'+Date.now()}}},
  async del(id){try{await deleteDoc(doc(db,COL,id))}catch(e){toast('No se pudo borrar en Firebase','err')}},
  async cfgSave(name,data){
    try{await setDoc(doc(db,CFG,name),data)}
    catch(e){console.warn('Sync',name,e);if(!S.cfgWarned){S.cfgWarned=true;toast('No se pudieron sincronizar tus ajustes (quedan solo en este dispositivo)','err')}}
  }
};

/* ---------- Métricas ---------- */
function stats(ts){
  const n=ts.length,w=ts.filter(t=>t.resultado>0),l=ts.filter(t=>t.resultado<0),gw=sum(w),gl=Math.abs(sum(l)),pnl=sum(ts);
  let eq=0,pk=0,dd=0;[...ts].sort((a,b)=>a.fecha.localeCompare(b.fecha)).forEach(t=>{eq+=t.resultado;pk=Math.max(pk,eq);dd=Math.max(dd,pk-eq)});
  const by={};ts.forEach(t=>by[t.fecha]=(by[t.fecha]||0)+t.resultado);const days=Object.values(by);
  const pl=ts.filter(t=>t.plan);
  return{n,pnl,wr:n?w.length/n*100:0,pf:gl?gw/gl:gw?Infinity:0,exp:n?pnl/n:0,dd,best:days.length?Math.max(...days):0,worst:days.length?Math.min(...days):0,
    adhN:pl.length,adh:pl.length?pl.filter(t=>t.plan==='si').length/pl.length*100:0};
}
function count(el,to,f){if(!isFinite(to)||matchMedia('(prefers-reduced-motion:reduce)').matches)return;const t0=performance.now();
  (function step(t){const p=Math.min(1,(t-t0)/700);el.textContent=f(to*(1-Math.pow(1-p,3)));if(p<1)requestAnimationFrame(step)})(t0)}
function kpis(){
  const s=stats(S.trades),sg=v=>v>=0?'pos':'neg';
  const it=[['Net PnL',s.pnl,fmt,sg(s.pnl)],['Win Rate',s.wr,v=>v.toFixed(1)+'%',''],['Profit Factor',s.pf,v=>isFinite(v)?v.toFixed(2):'∞',''],
    ['Expectativa por trade',s.exp,fmt,sg(s.exp)],['Máx. drawdown',-s.dd,fmt,s.dd?'neg':''],['Mejor día',s.best,fmt,s.best>0?'pos':''],
    ['Peor día',s.worst,fmt,s.worst<0?'neg':''],['Plan seguido',s.adh,v=>s.adhN?v.toFixed(0)+'%':'—','']];
  $('#kpis').innerHTML=it.map((k,i)=>`<div class="glass spot kpi" style="--n:${i}"><h3>${k[0]}</h3><p class="kv ${k[3]}">${k[2](k[1])}</p></div>`).join('');
  $$('.kv').forEach((el,i)=>count(el,it[i][1],it[i][2]));
}

/* ---------- Meta del mes en curso ---------- */
function goal(){
  const el=$('#goal'),d=new Date(),y=d.getFullYear(),m=d.getMonth(),key=curKey(),meta=S.goals.map[key],mes=MESES[m];
  if(!meta){
    el.className='glass spot goal empty';
    el.innerHTML=`<div><span class="g-eye"><i class="fa-solid fa-bullseye"></i> Meta de ${mes}</span>
      <h3 style="margin-top:8px">Define tu objetivo del mes</h3>
      <p>Fija cuánto quieres ganar y sigue tu avance con una barra de progreso.</p></div>
      <button class="btn" data-goal><i class="fa-solid fa-plus"></i> Definir meta</button>`;
    return;
  }
  const pm=sum(S.trades.filter(t=>t.fecha.startsWith(key))),raw=pm/meta*100,pct=Math.max(0,Math.min(100,raw)),done=pm>=meta,neg=pm<0;
  const dim=new Date(y,m+1,0).getDate(),left=dim-d.getDate()+1,falta=Math.max(0,meta-pm);
  el.className='glass spot goal'+(done?' done':neg?' neg':'');
  let chips='';
  if(done)chips+=`<span class="g-chip ok"><i class="fa-solid fa-circle-check"></i> ¡Meta cumplida!${pm>meta?` +${money(pm-meta)} extra`:''}</span>`;
  else{
    chips+=`<span class="g-chip${neg?' bad':''}"><i class="fa-solid fa-flag-checkered"></i> Faltan <b>${money(falta)}</b></span>`;
    chips+=`<span class="g-chip"><i class="fa-regular fa-calendar"></i> ${left} ${left===1?'día restante':'días restantes'} · <b>≈ ${money(falta/left)}</b>/día</span>`;
  }
  const ticks=[25,50,75].map(p=>`<span class="g-tick" style="left:${p}%"></span>`).join('');
  el.innerHTML=`<div class="goal-top"><div>
      <span class="g-eye"><i class="fa-solid fa-bullseye"></i> Meta de ${mes}</span>
      <p class="g-main"><span class="${neg?'neg':done?'pos':''}">${fmt(pm)}</span><small>de ${money(meta)}</small></p></div>
      <button class="gbtn sq" data-goal aria-label="Editar meta"><i class="fa-solid fa-pen"></i></button></div>
    <div class="g-wrap" style="--w:0%"><div class="g-bubble">${Math.round(Math.max(0,raw))}%</div>
      <div class="g-track" role="progressbar" aria-label="Progreso de la meta" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}"><div class="g-fill"></div>${ticks}</div></div>
    <div class="g-foot">${chips}</div>`;
  const w=el.querySelector('.g-wrap');
  requestAnimationFrame(()=>requestAnimationFrame(()=>w.style.setProperty('--w',pct+'%')));
}
function goalForm(){
  const k=curKey(),cur=S.goals.map[k];
  $('#g-title').textContent=`Meta de ${MESES[new Date().getMonth()]}`;
  $('#g-label').textContent=`¿Cuánto quieres ganar este mes? (${S.pref.cur})`;
  $('#g-val').value=cur??'';$('#g-del').disabled=!cur;
}
function setGoal(v){
  const k=curKey();
  if(v)S.goals.map[k]=Math.round(v*100)/100;else delete S.goals.map[k];
  S.goals.ts=Date.now();ls('vextor-goals',S.goals);sync('goals',S.goals,300);
  goal();cal();
}
function saveGoal(){
  const v=parseFloat($('#g-val').value);
  if(!(v>0))return toast('Escribe una meta mayor a 0','err');
  setGoal(v);close('modal-goal');toast('Meta guardada');
}

/* ---------- Gráficas ---------- */
let ch={};
function charts(){
  const rs=getComputedStyle(document.documentElement);
  Chart.defaults.color=rgb(rs.getPropertyValue('--mu').trim());
  Chart.defaults.font.family=getComputedStyle(document.body).fontFamily;
  const grid={color:'rgba(150,150,150,.12)'};
  let eq=0;const lab=['Inicio'],dat=[0];
  [...S.trades].sort((a,b)=>a.fecha.localeCompare(b.fecha)).forEach(t=>{eq+=t.resultado;lab.push(t.fecha);dat.push(+eq.toFixed(2))});
  ch.eq?.destroy();
  ch.eq=new Chart($('#eq'),{type:'line',data:{labels:lab,datasets:[{data:dat,borderWidth:3,tension:.4,borderCapStyle:'round',borderJoinStyle:'round',pointRadius:dat.length>40?0:3,borderColor:C.win,
    fill:{target:'origin',above:'rgba(52,211,153,.16)',below:'rgba(248,113,113,.16)'},segment:{borderColor:c=>c.p1.parsed.y>=0?C.win:C.loss},
    pointBackgroundColor:dat.map(v=>v>=0?C.win:C.loss)}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{cornerRadius:14,callbacks:{label:c=>fmt(c.parsed.y)}}},scales:{x:{display:false},y:{grid,border:{display:false},ticks:{callback:v=>S.pref.cur+v}}}}});
  const wd=[0,0,0,0,0,0,0];
  S.trades.forEach(t=>{const [y,m,d]=t.fecha.split('-');wd[(new Date(y,m-1,d).getDay()+6)%7]+=t.resultado});
  ch.wd?.destroy();
  ch.wd=new Chart($('#wd'),{type:'bar',data:{labels:['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'],datasets:[{data:wd.map(v=>+v.toFixed(2)),borderRadius:99,borderSkipped:false,maxBarThickness:22,backgroundColor:wd.map(v=>v>=0?C.win:C.loss)}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{cornerRadius:14,callbacks:{label:c=>fmt(c.parsed.y)}}},scales:{x:{grid:{display:false},border:{display:false}},y:{grid,border:{display:false}}}}});
}
// Evita reconstruir las gráficas en cada "input" de un slider
const schedCharts=(()=>{let r;return()=>{cancelAnimationFrame(r);r=requestAnimationFrame(()=>charts())}})();

/* ---------- Calendario heatmap ---------- */
function cal(){
  const key=`${S.y}-${pad(S.m+1)}`,by={};let pm=0,max=1;
  S.trades.forEach(t=>by[t.fecha]=(by[t.fecha]||0)+t.resultado);
  Object.entries(by).forEach(([f,v])=>{max=Math.max(max,Math.abs(v));if(f.startsWith(key))pm+=v});
  $('#mes').textContent=`${MESES[S.m]} ${S.y}`;
  $('#mes-pnl').innerHTML=`Mes: <span class="${pm>=0?'pos':'neg'}">${fmt(pm)}</span>`;
  const gm=S.goals.map[key];
  $('#mes-goal').innerHTML=gm?`· Meta ${S.pref.cur}${gm} (${Math.round(Math.max(0,pm)/gm*100)}%)`:'';
  document.documentElement.style.setProperty('--ambient',pm>BE?'var(--profit)':pm<-BE?'var(--loss)':'var(--accent)');
  const dim=new Date(S.y,S.m+1,0).getDate(),first=(new Date(S.y,S.m,1).getDay()+6)%7;
  let h='',n=0,wk=0;const weeks=[];
  for(let i=0;i<first;i++,n++)h+='<div class="cd off"></div>';
  for(let d=1;d<=dim;d++){
    const k=`${key}-${pad(d)}`,v=by[k]||0;wk+=v;n++;
    h+=`<button class="cd ${cls(v)}" data-day="${k}" style="--i:${v?Math.max(.18,Math.abs(v)/max):0}" aria-label="${k}"><span>${d}</span><b>${v?`<em class="full">${fmt(v)}</em><em class="short">${short(v)}</em>`:''}</b></button>`;
    if(n%7===0||d===dim){while(n%7){h+='<div class="cd off"></div>';n++}
      h+=`<div class="cd wk ${cls(wk)}" style="--i:.5"><span>Total</span><b><em class="full">${fmt(wk)}</em><em class="short">${short(wk)}</em></b></div>`;weeks.push(wk);wk=0}
  }
  $('#days').innerHTML=h;
  // Totales por semana (se muestran solo en celular, donde la columna "Semana" no cabe)
  $('#wk-sum').innerHTML=weeks.map((v,i)=>`<div><span>Sem ${i+1}</span><b class="${v>0?'pos':v<0?'neg':''}">${fmt(v)}</b></div>`).join('');
}

/* ---------- Tabla ---------- */
function table(){
  let ts=[...S.trades].sort((a,b)=>b.fecha.localeCompare(a.fecha));
  if(S.filter)ts=ts.filter(t=>t.fecha===S.filter);
  $('#chip').innerHTML=S.filter?`<button class="gbtn" data-clear>${S.filter} <i class="fa-solid fa-xmark"></i></button> `:'';
  $('#tbl').innerHTML=ts.length?`<thead><tr><th>Fecha</th><th>Activo</th><th>Dir.</th><th>Setup</th><th>Resultado</th><th></th></tr></thead><tbody>`+
    ts.map(t=>`<tr><td>${esc(t.fecha)}</td><td>${esc(t.activo||'—')}</td><td>${esc(t.dir||'—')}</td><td>${esc(t.setup||'—')}</td><td class="num ${t.resultado>=0?'pos':'neg'}">${fmt(t.resultado)}</td>
    <td class="ac"><button class="gbtn" data-edit="${esc(t.id)}" aria-label="Editar"><i class="fa-solid fa-pen"></i></button> <button class="gbtn" data-del="${esc(t.id)}" aria-label="Eliminar"><i class="fa-solid fa-trash"></i></button></td></tr>`).join('')+'</tbody>'
    :'<tbody><tr><td class="empty">Aún no hay trades. Registra el primero con “Nuevo trade”.</td></tr></tbody>';
}
const renderAll=()=>{goal();kpis();charts();cal();table()};

/* ---------- Formulario ---------- */
const lock=()=>document.body.classList.toggle('lock',!!$('.ov.on'));
const open=id=>{$('#'+id).classList.add('on');lock()}, close=id=>{$('#'+id).classList.remove('on');lock()};
function form(t={}){
  $('#f-id').value=t.id||'';$('#mt').textContent=t.id?'Editar trade':'Registrar trade';
  const o=$('#ia-out');o.hidden=!t.ia;o.textContent=t.ia||'';o.dataset.txt=t.ia||'';
  F.forEach(k=>{const el=$('#f-'+k);el.value=t[k]??(k==='fecha'?hoy():el.tagName==='SELECT'?el.options[0].value:'')});
}
async function save(){
  const t={};F.forEach(k=>t[k]=$('#f-'+k).value.trim());t.resultado=parseFloat(t.resultado);
  const iaBox=$('#ia-out');if(!iaBox.hidden&&iaBox.dataset.txt)t.ia=iaBox.dataset.txt;
  if(!t.fecha||isNaN(t.resultado))return toast('Completa la fecha y el resultado neto','err');
  const id=$('#f-id').value;if(id)t.id=id;
  const s=await store.save(t);
  S.trades=id?S.trades.map(x=>x.id===id?s:x):[...S.trades,s];
  local();renderAll();close('modal-trade');toast(id?'Trade actualizado':'Trade guardado');
}

/* ---------- IA ---------- */
async function gemini(t){
  const body={
    systemInstruction:{parts:[{text:SYSTEM}]},
    contents:[{role:'user',parts:[{text:'Trade a analizar (JSON):\n'+JSON.stringify(t)}]}],
    generationConfig:{temperature:.6,maxOutputTokens:700,thinkingConfig:{thinkingBudget:0}} // sin "thinking": más rápido y no gasta tokens
  };
  let lastErr;
  for(const m of MODELS){
    try{
      const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${GEMINI_API_KEY}`,{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      const d=await r.json().catch(()=>({}));
      if(!r.ok){const e=new Error(d.error?.message||('HTTP '+r.status));e.status=r.status;throw e}
      const txt=d.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('').trim();
      if(!txt)throw new Error(d.promptFeedback?.blockReason?'La IA bloqueó la respuesta ('+d.promptFeedback.blockReason+')':'La IA devolvió una respuesta vacía');
      return txt.replace(/\*\*/g,'').replace(/^\s*[*#]+\s?/gm,'');
    }catch(e){
      lastErr=e;console.warn('Gemini',m,e);
      if(![404,429,500,503].includes(e.status))break; // solo reintenta con el otro modelo si fue cuota/servidor/modelo inexistente
    }
  }
  throw lastErr;
}
async function analizar(){
  const out=$('#ia-out'),btn=$('#ia');out.hidden=false;

  if(GEMINI_API_KEY==="PON_TU_API_KEY_AQUI"){
    out.textContent='Falta tu API Key de Gemini. Debes ponerla en la constante GEMINI_API_KEY de diario.js.';
    return;
  }

  const t={};F.forEach(k=>t[k]=$('#f-'+k).value.trim());
  if(!t.resultado){out.textContent='Escribe al menos el resultado neto para analizar.';return}

  btn.disabled=true;out.textContent='Analizando…';
  try{
    const txt=await gemini(t);
    out.textContent=txt;out.dataset.txt=txt;
  }catch(e){
    console.error('Error IA:',e);
    out.textContent='No se pudo analizar: '+e.message;
  }finally{btn.disabled=false}
}

function csv(){
  const q=v=>`"${String(v??'').replace(/"/g,'""')}"`;
  const txt=[['id',...F].map(q).join(','),...S.trades.map(t=>[t.id,...F.map(k=>t[k])].map(q).join(','))].join('\n');
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([txt],{type:'text/csv'}));a.download='vextor-trades.csv';a.click();
}

/* ---------- Temas ---------- */
function savePref(){S.pref.ts=Date.now();ls('vextor-pref',S.pref);sync('prefs',S.pref)}
function setWall(v){S.wall={value:v,ts:Date.now()};ls('vextor-wall',S.wall);sync('wall',S.wall,300)}
function theme(){
  const p=S.pref,r=document.documentElement;
  r.dataset.mode=p.mode==='auto'?(matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light'):p.mode;

  r.style.setProperty('--hue',p.hue);
  if(p.customAccent)r.style.setProperty('--accent',p.customAccent);
  else r.style.removeProperty('--accent');

  r.style.setProperty('--blur',p.blur+'px');r.style.setProperty('--ff',p.font);
  r.style.setProperty('--bg-dark',p.bgDark/100);r.style.setProperty('--bg-blur',p.bgBlur+'px');
  $('#bg-wall').style.backgroundImage=S.wall.value||'none';   // wallpaper directo al elemento (no por variable CSS)

  document.body.classList.toggle('it',p.italic);
  $$('.seg button').forEach(b=>b.classList.toggle('on',b.dataset.m===p.mode));

  $('#hue').value=p.hue;
  if(p.customAccent)$('#custom-color').value=p.customAccent;
  $('#blur').value=p.blur;$('#cur').value=p.cur;$('#font').value=p.font;$('#ital').checked=p.italic;
  $('#bg-dark').value=p.bgDark;$('#bg-blur').value=p.bgBlur;

  if(ch.eq)schedCharts();
}
function adaptar(im){
  const c=document.createElement('canvas');c.width=c.height=32;const x=c.getContext('2d');x.drawImage(im,0,0,32,32);
  const d=x.getImageData(0,0,32,32).data,n=d.length/4;let r=0,g=0,b=0;
  for(let i=0;i<d.length;i+=4){r+=d[i];g+=d[i+1];b+=d[i+2]}r/=n;g/=n;b/=n;
  const lum=(.2126*r+.7152*g+.0722*b)/255,mx=Math.max(r,g,b),dl=mx-Math.min(r,g,b);let h=S.pref.hue;
  if(dl>12){h=mx===r?((g-b)/dl)%6:mx===g?(b-r)/dl+2:(r-g)/dl+4;h=Math.round((h*60+360)%360)}
  Object.assign(S.pref,{mode:lum>.5?'light':'dark',hue:h,customAccent:null,blur:lum>.35&&lum<.7?32:22});
  toast('Tema ajustado al wallpaper');
}
// Redimensiona y comprime hasta que quepa en un documento de Firestore (límite 1 MiB)
function comprimir(im){
  let max=1600,q=.72,url='';
  for(let i=0;i<7;i++){
    const k=Math.min(1,max/Math.max(im.width,im.height)),w=Math.round(im.width*k),h=Math.round(im.height*k);
    const c=document.createElement('canvas');c.width=w;c.height=h;c.getContext('2d').drawImage(im,0,0,w,h);
    url=c.toDataURL('image/jpeg',q);
    if(url.length<=WALL_MAX)break;
    max*=.85;q=Math.max(.45,q-.05);
  }
  return url;
}

/* ---------- Eventos ---------- */
const TITLES={dashboard:'Dashboard',calendario:'Calendario de Trading',trades:'Trades'};
function tab(id){
  $$('.view').forEach(v=>v.classList.toggle('on',v.id==='v-'+id));
  $$('[data-tab]').forEach(b=>b.classList.toggle('on',b.dataset.tab===id));
  $('#title').textContent=TITLES[id];if(id!=='trades')S.filter=null;table();
  scrollTo({top:0});
}
document.addEventListener('click',e=>{
  const g=s=>e.target.closest(s);let el;
  if(g('[data-goal]')){goalForm();open('modal-goal')}
  else if(el=g('[data-q]'))$('#g-val').value=el.dataset.q;
  else if(el=g('[data-tab]'))tab(el.dataset.tab);
  else if(el=g('[data-open]')){if(el.dataset.open==='modal-trade')form();open(el.dataset.open)}
  else if(el=g('[data-close]'))close(el.dataset.close);
  else if(e.target.classList.contains('ov')){e.target.classList.remove('on');lock()}
  else if(el=g('[data-day]')){const d=el.dataset.day;
    if(S.trades.some(t=>t.fecha===d)){S.filter=d;tab('trades')}else{form({fecha:d});open('modal-trade')}}
  else if(g('[data-clear]')){S.filter=null;table()}
  else if(el=g('[data-edit]')){form(S.trades.find(t=>t.id===el.dataset.edit));open('modal-trade')}
  else if(el=g('[data-del]')){if(confirm('¿Eliminar este trade? No se puede deshacer.')){const id=el.dataset.del;store.del(id);S.trades=S.trades.filter(t=>t.id!==id);local();renderAll();toast('Trade eliminado')}}
  else if(el=g('.seg button')){S.pref.mode=el.dataset.m;savePref();theme()}
  else if(el=g('[data-w]')){const i=+el.dataset.w;setWall(WALLS[i]);if(i)S.pref.mode='dark';savePref();theme()}
});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){$$('.ov.on').forEach(o=>o.classList.remove('on'));lock()}});
document.addEventListener('pointermove',e=>{const c=e.target.closest?.('.spot');if(c){const b=c.getBoundingClientRect();c.style.setProperty('--mx',e.clientX-b.left+'px');c.style.setProperty('--my',e.clientY-b.top+'px')}});
$('#save').onclick=save;$('#ia').onclick=analizar;$('#csv').onclick=csv;
$('#g-save').onclick=saveGoal;
$('#g-del').onclick=()=>{setGoal(0);close('modal-goal');toast('Meta eliminada')};
$('#g-val').addEventListener('keydown',e=>{if(e.key==='Enter')saveGoal()});
$('#prev').onclick=()=>{if(--S.m<0){S.m=11;S.y--}cal()};
$('#next').onclick=()=>{if(++S.m>11){S.m=0;S.y++}cal()};

$('#bg-dark').oninput=e=>{S.pref.bgDark=+e.target.value;savePref();theme()};
$('#bg-blur').oninput=e=>{S.pref.bgBlur=+e.target.value;savePref();theme()};

$('#hue').oninput=e=>{S.pref.hue=+e.target.value;S.pref.customAccent=null;savePref();theme()};
$('#custom-color').oninput=e=>{S.pref.customAccent=e.target.value;savePref();theme()};

$('#blur').oninput=e=>{S.pref.blur=+e.target.value;savePref();theme()};
$('#cur').onchange=e=>{S.pref.cur=e.target.value;savePref();renderAll()};
$('#font').onchange=e=>{S.pref.font=e.target.value;savePref();theme()};
$('#ital').onchange=e=>{S.pref.italic=e.target.checked;savePref();theme()};

$('#wall-in').onchange=e=>{
  const inp=e.target,f=inp.files[0];if(!f)return;
  const rd=new FileReader();
  rd.onload=()=>{
    const im=new Image();
    im.onload=()=>{
      adaptar(im);
      setWall(`url(${comprimir(im)})`);
      savePref();theme();inp.value='';
    };
    im.onerror=()=>toast('No se pudo leer esa imagen','err');
    im.src=rd.result;
  };
  rd.readAsDataURL(f);
};

matchMedia('(prefers-color-scheme:dark)').addEventListener('change',()=>S.pref.mode==='auto'&&theme());

/* ---------- Arranque ---------- */
theme();
const t0=performance.now();
await store.load();
theme(); // aplica ajustes/wallpaper que llegaron de otro dispositivo
if(!S.offline)$('#sp-msg').textContent=S.trades.length?`${S.trades.length} trades cargados`:'Todo listo';
await new Promise(r=>setTimeout(r,Math.max(0,MIN_SPLASH-(performance.now()-t0))));
renderAll();
document.body.classList.replace('loading','intro');
$('#splash').classList.add('out');
setTimeout(()=>$('#splash').remove(),900);
setTimeout(()=>document.body.classList.remove('intro'),2800);