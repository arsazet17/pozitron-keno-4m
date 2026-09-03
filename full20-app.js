'use strict';
const SCHEDULE=['00:02','00:17','00:32','01:02','01:17','01:32','02:02','02:17','02:32','03:02','03:32','04:02','04:17','04:32','05:02','05:17','05:32','06:02','06:17','06:32','07:02','07:32','08:02','08:17','08:32','09:02','09:17','09:32','10:02','10:17','10:32','11:02','11:32','12:02','12:17','12:32','13:02','13:17','13:32','14:02','14:17','14:32','15:02','15:32','16:02','16:17','16:32','17:02','17:17','17:32','18:02','18:17','18:32','19:02','19:32','20:02','20:17','20:32','21:02','21:17','21:32','22:02','22:17','22:32','23:02','23:32'];
const $=id=>document.getElementById(id);
let DATA={draws:[],frozen:{records:[]},meta:{},combos:{}};
let comboCol=1;
const fmt=n=>String(n).padStart(2,'0');

const PAYOUTS={
  10:{10:10000000,9:1000000,8:50000,7:5000,6:750,5:250,4:100,0:200},
  9:{9:4000000,8:210000,7:10000,6:1000,5:300,4:150,0:150},
  8:{8:1500000,7:53300,6:2500,5:500,4:200,0:150},
  7:{7:250000,6:10000,5:1200,4:200,3:100,0:150},
  6:{6:75000,5:4180,4:750,3:200},
  5:{5:20000,4:1920,3:400},
  4:{4:3300,3:300,2:100},
  3:{3:1500,2:300},
  2:{2:300,1:100},
  1:{1:280}
};
function comboPrize(size,hits){
  return Number(PAYOUTS[Number(size)]?.[Number(hits)]||0);
}
function rub(n){return `${Number(n).toLocaleString('ru-RU')} ₽`}
function toast(t){
  const e=$('toast');e.textContent=t;e.classList.add('show');
  setTimeout(()=>e.classList.remove('show'),1800);
}

/*
  M5M PRINCIPLE:
  live FULL20 JSON is read DIRECTLY from GitHub main, not through Pages.
  Pages publication is therefore NOT on the critical data path.
*/
const RAW_BASE='https://raw.githubusercontent.com/arsazet17/pozitron-keno-4m/main/';
async function j(path){
  const clean=String(path).replace(/^\.\//,'');
  const isLive=clean.startsWith('data/full20_') && clean.endsWith('.json');
  const url=isLive ? new URL(clean,RAW_BASE) : new URL(clean,location.href);
  url.searchParams.set('ts',String(Date.now()));
  const r=await fetch(url.href,{
    method:'GET',
    cache:'no-store',
    mode:isLive?'cors':'same-origin',
    credentials:isLive?'omit':'same-origin'
  });
  if(!r.ok)throw new Error(`${clean}: HTTP ${r.status}`);
  return r.json();
}

function go(p){
  document.querySelectorAll('.page').forEach(x=>x.classList.toggle('active',x.dataset.page===p));
  document.querySelectorAll('.nav').forEach(x=>x.classList.toggle('active',x.dataset.go===p));
  scrollTo(0,0);
}
document.addEventListener('click',e=>{
  const b=e.target.closest('[data-go]');
  if(b)go(b.dataset.go);
});

function latest(){return DATA.draws.at(-1)}
function openFrozen(){return [...DATA.frozen.records].reverse().find(r=>!r.closed)}

function renderLatest(){
  const d=latest();if(!d)return;
  $('latestHead').textContent=`№${d.draw} · ${d.date} · ${d.time}`;
  $('latestColumn').textContent=d.column;
  $('latestBalls').innerHTML=d.balls.map(n=>`<span class="ball ${(((n-1)%10)+1)==d.column?'winner':''}">${fmt(n)}</span>`).join('');
  const a=d.audit||{},counts=a.counts||{};
  $('auditBox').innerHTML=`<div class="audit-grid">${Array.from({length:10},(_,i)=>`<div class="audit-cell">ст${i+1}<b>${counts[String(i+1)]??'—'}</b></div>`).join('')}</div><p class="muted">${(a.tied||[]).length>1?`Ничья: ${(a.tied||[]).map(c=>`ст${c}→поз.${a.completion?.[String(c)]}`).join(' · ')}. Corrected победитель: ст${a.calculated}.`:`Единственный лидер. Tie-break не требуется.`}</p>`;
}

function renderForecast(){
  const r=openFrozen();
  if(!r){
    $('forecastTarget').textContent='Открытого frozen нет';
    $('forecastRows').innerHTML='';
    return;
  }
  $('forecastTarget').textContent=`На ${r.target.date} ${r.target.time} · №${r.target.draw}`;
  $('nextDraw').textContent=`№${r.target.draw} · ${r.target.time}`;
  $('forecastRows').innerHTML=(r.options||[]).map((o,i)=>`<div class="frow ${i===0?'main':''}"><div class="flabel">${o.label}</div><div class="fcol">ст${o.column}</div><div class="fmeta"><b>SCORE ${Number(o.score||0).toLocaleString('ru-RU')}</b><div class="combochips">${(o.combo||[]).map(n=>`<span class="chip">${fmt(n)}</span>`).join('')}</div>${o.specificity!=null?`<div class="spec">support ${o.support} / ALL ${o.all} · P ${(o.specificity*100).toFixed(3)}%</div>`:''}</div></div>`).join('');
  $('rankingBox').innerHTML=(r.ranking||[]).map((x,i)=>`<div class="rankrow"><b>${i+1}</b><span>ст${x[0]}</span><b>${Number(x[1]).toLocaleString('ru-RU')}</b></div>`).join('');
}

function renderDraws(){
  const arr=[...DATA.draws].reverse().slice(0,50);
  $('drawList').innerHTML=arr.map(d=>`<details class="draw-card"><summary><div><div class="dh-title">№${d.draw}</div><div class="dh-meta">${d.date} · ${d.time}</div></div><div class="colbadge">ст${d.column}</div></summary><div class="detail"><div class="balls20" style="margin-top:12px">${d.balls.map(n=>`<span class="ball ${(((n-1)%10)+1)==d.column?'winner':''}">${fmt(n)}</span>`).join('')}</div><p class="muted">${(d.audit?.tied||[]).length>1?`Tie: ${(d.audit.tied||[]).map(c=>`ст${c}→${d.audit.completion?.[String(c)]}`).join(' · ')}`:'Tie-break не требовался'}</p></div></details>`).join('');
}

function clsText(r){
  if(r.classification==='V1')return['✅ В1','hit'];
  if(r.classification==='V2'||r.classification==='V3')return[`☑️ ${r.classification}`,'hit'];
  if(r.classification==='reserve-hit')return['🛟 резерв','reserve'];
  return['❌ мимо','miss'];
}

function renderHistory(){
  const arr=[...DATA.frozen.records].filter(r=>r.closed).reverse();
  $('historyList').innerHTML=arr.map(r=>{
    const [txt,cl]=clsText(r);
    const totalPrize=(r.options||[]).reduce((sum,o)=>sum+(o.combo?comboPrize(o.combo.length,o.comboHits??0):0),0);
    return `<details class="hist-card">
      <summary>
        <div>
          <div class="dh-title">№${r.target.draw} · ${r.target.time}</div>
          <div class="dh-meta">Факт: ст${r.actual?.column??'—'} · ранг ${r.actualRank??'—'}${totalPrize?` · 🔥 ${rub(totalPrize)}`:''}</div>
        </div>
        <div class="histstatus ${cl}">${txt}</div>
      </summary>
      <div class="detail">
        ${(r.options||[]).map(o=>{
          const hits=Number(o.comboHits??0);
          const size=o.combo?.length||0;
          const prize=o.combo?comboPrize(size,hits):0;
          return `<div class="combo-eval">
            <b>${o.label} · ст${o.column} ${o.columnHit?'✅':'❌'}</b>
            <div class="muted">
              SCORE ${o.score??'—'} · комба ${(o.combo||[]).map(fmt).join('·')||'не фиксировалась'}
              ${o.combo?`→ ${hits}/${size}${o.comboHitNumbers?.length?` (${o.comboHitNumbers.map(fmt).join(', ')})`:''}`:''}
              ${prize?` <strong class="combo-prize">🔥 ${rub(prize)}</strong>`:''}
            </div>
          </div>`;
        }).join('')}
      </div>
    </details>`;
  }).join('')||'<section class="card">История пока пуста.</section>';
}

function renderCombos(){
  $('comboTabs').innerHTML=Array.from({length:10},(_,i)=>i+1).map(c=>`<button class="coltab ${c===comboCol?'active':''}" data-col="${c}">ст${c}</button>`).join('');
  const arr=DATA.combos[String(comboCol)]||[];
  $('comboList').innerHTML=arr.slice(0,20).map((x,i)=>`<div class="combo-row"><strong>${i+1}. ${x.combo.map(fmt).join(' · ')}</strong><div class="combo-stat"><span>размер ${x.size}</span><span>support <b>${x.support}</b></span><span>ALL ${x.all}</span><span>P <b>${(x.specificity*100).toFixed(3)}%</b></span></div></div>`).join('');
}
document.addEventListener('click',e=>{
  const b=e.target.closest('[data-col]');
  if(b){comboCol=Number(b.dataset.col);renderCombos();}
});

function renderMeta(){
  const m=DATA.meta;
  $('syncText').textContent='Столото: синхронизировано';
  $('syncDot').classList.add('ok');
  $('updatedAt').textContent=m.updatedAt?new Date(m.updatedAt).toLocaleString('ru-RU'):'';
  $('baseCount').textContent=Number(m.baseDraws||0).toLocaleString('ru-RU');
  $('retieCount').textContent=Number(m.retieChanged||0).toLocaleString('ru-RU');
  const d=latest();
  $('settingsLatest').textContent=d?`${d.date} ${d.time} · ст${d.column}`:'—';
  $('schedule').innerHTML=SCHEDULE.map(t=>`<span>${t}</span>`).join('');
}

async function loadAll(){
  try{
    const [draws,frozen,meta,combos]=await Promise.all([
      j('data/full20_draws.json'),
      j('data/full20_frozen.json'),
      j('data/full20_meta.json'),
      j('data/full20_combo_view.json')
    ]);
    DATA={draws,frozen,meta,combos};
    renderLatest();renderForecast();renderDraws();renderHistory();renderCombos();renderMeta();
  }catch(e){
    $('syncText').textContent='Ошибка загрузки данных';
    toast('Ошибка данных FULL20');
    console.error(e);
  }
}

$('auditToggle').onclick=()=> $('auditBox').classList.toggle('open');
$('rankingToggle').onclick=()=> $('rankingBox').classList.toggle('open');
$('refreshBtn').onclick=()=>{toast('Обновляю…');loadAll();};
loadAll();
