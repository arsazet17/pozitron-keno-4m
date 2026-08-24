(function(){
  'use strict';
  const E=window.KenoEngine;
  const LS={overrides:'keno4m.overrides.v1',records:'keno4m.records.v1',custom:'keno4m.customMatrix.v1'};
  const AUTO_REFRESH_MS=10*1000;
  let matrix=null,baseMatrix=null,forecast=null,syncMeta=null;
  let archiveFingerprint='',autoRefreshBusy=false,customActive=false;
  let xlsxWorkbook=null,xlsxSheetName=null;
  const $=id=>document.getElementById(id);
  const memStore={};

  function toast(msg){const t=$('toast');if(!t)return;t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2600)}
  function esc(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
  function loadJSON(key,fallback){try{const raw=localStorage.getItem(key);if(raw!=null)return JSON.parse(raw)}catch(e){console.warn('localStorage read',e)}return Object.prototype.hasOwnProperty.call(memStore,key)?memStore[key]:fallback}
  function saveJSON(key,v){memStore[key]=v;try{localStorage.setItem(key,JSON.stringify(v))}catch(e){console.warn('localStorage write',e)}}
  function recordKey(r){return `${r.date}|${r.time}`}
  function getRecords(){return loadJSON(LS.records,[])}
  function setRecords(rows){saveJSON(LS.records,rows)}
  function isFrozen(r){return !!(r&&r.frozenAt&&r.date&&r.time&&Array.isArray(r.v1)&&r.v1.length===3)}
  function sortRecords(rows){rows.sort((a,b)=>E.parseDate(a.date)-E.parseDate(b.date)||E.SCHEDULE.indexOf(a.time)-E.SCHEDULE.indexOf(b.time));return rows}
  function upsertRecord(r){const rows=getRecords(),k=recordKey(r),i=rows.findIndex(x=>recordKey(x)===k);if(i>=0)rows[i]={...rows[i],...r};else rows.push(r);setRecords(sortRecords(rows))}
  function methodValues(m){const c={};m.continuations.forEach(x=>c[x.v]=(c[x.v]||0)+1);return Object.entries(c).sort((a,b)=>b[1]-a[1]||a[0]-b[0]).map(([v,n])=>n>1?`${v}×${n}`:v).join(', ')||'—'}

  async function fetchJSON(url,backup){
    const one=async u=>{const sep=u.includes('?')?'&':'?';const r=await fetch(`${u}${sep}_v=0201`,{cache:'no-store'});if(!r.ok)throw new Error(`HTTP ${r.status}`);const text=await r.text();if(/^\s*</.test(text))throw new Error('получен HTML вместо JSON');return JSON.parse(text)};
    try{return await one(url)}catch(e){if(backup){console.warn('primary JSON failed',e);return one(backup)}throw e}
  }
  async function loadSyncMeta(){try{syncMeta=await fetchJSON('data/last_sync.json','https://raw.githubusercontent.com/arsazet17/pozitron-keno-4m/main/data/last_sync.json')}catch(e){console.warn('last_sync',e);syncMeta=null}}
  function nextDrawNumber(){const n=Number(syncMeta?.latestOfficial?.draw);return Number.isFinite(n)?n+1:null}
  function formatDrawNo(n){const v=Number(n);return Number.isFinite(v)?`№${v}`:'№—'}

  function matrixActual(date,time){if(!matrix)return null;const hm=E.headerMap(matrix),c=hm[time];if(c==null)return null;const r=matrix.findIndex((row,i)=>i>0&&String(row?.[0])===String(date));return r<1?null:E.val(matrix[r][c])}
  function officialFilledSequence(){
    if(!matrix)return [];
    const latest=syncMeta?.latestOfficial,latestDateObj=E.parseDate(latest?.date),latestTime=latest?.time;
    if(!latestDateObj||!latestTime)return [];
    const out=[],hm=E.headerMap(matrix);
    for(let r=1;r<matrix.length;r++){
      const date=String(matrix[r]?.[0]||''),d=E.parseDate(date);if(!d||d>latestDateObj)continue;
      for(const time of E.SCHEDULE){const c=hm[time];if(c==null)continue;if(d.getTime()===latestDateObj.getTime()&&E.SCHEDULE.indexOf(time)>E.SCHEDULE.indexOf(latestTime))break;const actual=E.val(matrix[r][c]);if(actual!=null)out.push({date,time,actual})}
    }
    return out;
  }
  function officialDrawFor(date,time){const latest=syncMeta?.latestOfficial,n=Number(latest?.draw);if(!Number.isFinite(n))return null;const seq=officialFilledSequence();const li=seq.findIndex(x=>x.date===String(latest.date)&&x.time===String(latest.time)),ti=seq.findIndex(x=>x.date===String(date)&&x.time===String(time));return li<0||ti<0||ti>li?null:n-(li-ti)}
  function latestArchiveOfficial(rows){if(!Array.isArray(rows)||rows.length<2)return null;const hm={};(rows[0]||[]).forEach((x,i)=>{if(i>0&&x!=null)hm[String(x)]=i});for(let r=rows.length-1;r>=1;r--){const date=String(rows[r]?.[0]||'');if(!date)continue;for(let i=E.SCHEDULE.length-1;i>=0;i--){const time=E.SCHEDULE[i],c=hm[time];if(c==null)continue;const column=E.val(rows[r]?.[c]);if(column!=null)return {date,time,column}}}return null}
  function sameOfficial(a,b){return !!a&&!!b&&String(a.date)===String(b.date)&&String(a.time)===String(b.time)&&E.val(a.column)===E.val(b.column)}
  function archiveFingerprintOf(rows){return Array.isArray(rows)?JSON.stringify(rows.slice(-3)):''}

  // STRICT: закрываем только прогноз, реально сохранённый ДО факта.
  function reconcileFrozenRecords(){
    const rows=getRecords();let changed=false;
    for(const r of rows){
      if(!isFrozen(r))continue;
      const actual=matrixActual(r.date,r.time);if(actual==null||r.actual!=null)continue;
      r.actual=actual;r.hitV1=r.v1.includes(actual);r.hitConsensus=r.consensus!=null&&r.consensus===actual;
      if(!Number.isFinite(Number(r.draw)))r.draw=officialDrawFor(r.date,r.time);
      changed=true;
    }
    if(changed)setRecords(rows);
  }

  async function loadArchive(){
    try{localStorage.removeItem(LS.custom)}catch(_){}
    const j=await fetchJSON('data/archive.json','https://raw.githubusercontent.com/arsazet17/pozitron-keno-4m/main/data/archive.json');
    if(!j||!Array.isArray(j.rows)||j.rows.length<3)throw new Error('Архив JSON имеет неверный формат');
    baseMatrix=j.rows;matrix=E.cloneMatrix(baseMatrix);E.applyOverrides(matrix,loadJSON(LS.overrides,{}));customActive=false;archiveFingerprint=archiveFingerprintOf(baseMatrix);
    $('archiveStatus').textContent=`Архив: ${matrix.length-1} дат`;$('archiveStatus').classList.remove('error');
  }

  function freezeForecast(){
    const t=forecast.target,k=`${t.date}|${t.time}`,rows=getRecords(),old=rows.find(r=>recordKey(r)===k);
    // Никогда не переписываем уже замороженный прогноз после факта/повторного расчёта.
    if(old&&isFrozen(old))return old;
    const rec={draw:forecast.targetDraw,date:t.date,time:t.time,v1:[...forecast.v1.values],v2:forecast.v2.value,gg:forecast.gg.value,consensus:forecast.consensus,scanner:[...(forecast.scanner||[])],actual:null,frozenAt:new Date().toISOString(),frozen:true};
    upsertRecord(rec);return rec;
  }

  function compute(){const target=E.nextTarget(matrix);forecast=E.predict(matrix,target);forecast.targetDraw=nextDrawNumber();freezeForecast();renderForecast();renderResultSelector();renderStats()}
  function renderForecast(){
    const f=forecast,t=f.target;$('targetTime').textContent=t.time;$('targetDate').textContent=t.date;const db=$('targetDraw');if(db)db.textContent=`Тираж ${formatDrawNo(f.targetDraw)}`;
    $('v1Balls').innerHTML=f.v1.values.map(n=>`<div class="ball">${n}</div>`).join('');$('v2Value').textContent=f.v2.value??'—';$('ggValue').textContent=f.gg.value??'—';$('vChain').textContent=f.vChain.join('–');$('hChain').textContent=f.hChain.join('–');$('vChainLen').textContent=f.vChain.length;$('hChainLen').textContent=f.hChain.length;
    const cb=$('consensusBox');if(f.consensus!=null){cb.className='consensus';cb.innerHTML=`🔥 <strong>ГЛАВНЫЙ АКЦЕНТ — СТОЛБ ${f.consensus}</strong><div class="small" style="margin-top:5px">В1 + В2 + Доп. Г/Г совпали.</div>`}else{cb.className='consensus none';cb.innerHTML='<strong>Полного согласования нет</strong>'}
    $('methods').innerHTML=Object.entries(f.methods).map(([name,m])=>`<div class="method"><b>${name}</b><div><div class="chain">${m.usedChain.join('–')||'—'}</div><div class="muted small">длина ${m.usedLen}, продолжений ${m.continuations.length}</div></div><div class="nexts">${esc(methodValues(m))}</div></div>`).join('');
  }
  function renderResultSelector(){const t=forecast.target;$('resultTime').innerHTML=`<option value="${t.time}">${t.date} · ${t.time}</option>`;$('resultValue').value=''}

  function renderStats(){
    const box=$('dayAccordion');if(!box)return;
    const latestDate=String(syncMeta?.latestOfficial?.date||forecast?.target?.date||'');
    const facts=officialFilledSequence().filter(x=>x.date===latestDate).sort((a,b)=>E.SCHEDULE.indexOf(b.time)-E.SCHEDULE.indexOf(a.time));
    const saved=getRecords();
    box.innerHTML=facts.map(x=>{
      const r=saved.find(z=>recordKey(z)===`${x.date}|${x.time}`&&isFrozen(z));
      const draw=r?.draw??officialDrawFor(x.date,x.time);
      if(!r){return `<details class="day-item"><summary><span class="day-draw">${formatDrawNo(draw)}</span><span class="day-date">${x.date}</span><span class="day-time">${x.time}</span><span class="day-fire">—</span><span class="day-chevron">▾</span></summary><div class="day-item-body"><div class="detail-line">Факт: <b>${x.actual}</b></div><div class="detail-line muted">Предтиражного прогноза не было; результат не считается ни попаданием, ни промахом.</div></div></details>`}
      const hit=r.v1.includes(x.actual),hc=r.consensus!=null&&r.consensus===x.actual;
      return `<details class="day-item ${hit?'is-hit':'is-miss'}"><summary><span class="day-draw">${formatDrawNo(draw)}</span><span class="day-date">${x.date}</span><span class="day-time">${x.time}</span><span class="day-fire">${hit?'🔥':'—'}</span><span class="day-chevron">▾</span></summary><div class="day-item-body"><div class="detail-line">Факт: <b>${x.actual}</b></div><div class="detail-line">Вариант 1: <b>${r.v1.join(', ')}</b> <span class="${hit?'hit':'miss'}">${hit?'ПОПАЛ':'мимо'}</span></div><div class="detail-line">Вариант 2: <b>${r.v2??'—'}</b></div><div class="detail-line">Доп. Г/Г: <b>${r.gg??'—'}</b></div>${r.consensus==null?'<div class="detail-line muted">FULL: нет</div>':`<div class="detail-line">FULL: <b>${r.consensus}</b> <span class="${hc?'hit':'miss'}">${hc?'✓':'×'}</span></div>`}<div class="detail-line muted">Frozen: ${esc(r.frozenAt)}</div></div></details>`;
    }).join('')||'<div class="stats-empty">Официальных завершённых тиражей за эти сутки пока нет.</div>';
  }

  function updateMatrixCell(date,time,value){const hm=E.headerMap(matrix),c=hm[time];if(c==null)throw new Error('Время отсутствует в Excel');const r=E.ensureDateRow(matrix,date);matrix[r][c]=value;const ov=loadJSON(LS.overrides,{});ov[`${date}|${time}`]=value;saveJSON(LS.overrides,ov)}
  function saveResult(){
    if(!forecast)return;const n=E.val($('resultValue').value);if(n==null){toast('Введите столб от 1 до 10');return}
    const {date,time}=forecast.target,rows=getRecords(),rec=rows.find(r=>r.date===date&&r.time===time&&isFrozen(r));
    if(!rec){toast('Нет предтиражного frozen — оценка запрещена');return}
    rec.actual=n;rec.hitV1=rec.v1.includes(n);rec.hitConsensus=rec.consensus!=null&&rec.consensus===n;upsertRecord(rec);updateMatrixCell(date,time,n);updateWorkbookCell(date,time,n);
    $('lastCheck').innerHTML=`${formatDrawNo(rec.draw)} · ${date} ${time} → столб <b>${n}</b>. В1: <span class="${rec.hitV1?'hit':'miss'}">${rec.hitV1?'ПОПАЛ':'мимо'}</span>.`;toast(`Зафиксировано: ${time} → ${n}`);compute();
  }

  async function autoRefreshArchive(showToast=false){
    if(autoRefreshBusy||customActive||document.hidden)return;autoRefreshBusy=true;
    try{
      const oldTarget=forecast?.target?`${forecast.target.date}|${forecast.target.time}`:'';const stamp=Date.now();
      const j=await fetchJSON(`https://raw.githubusercontent.com/arsazet17/pozitron-keno-4m/main/data/archive.json?_auto=${stamp}`,`data/archive.json?_auto=${stamp}`);if(!j||!Array.isArray(j.rows))throw new Error('AUTO archive format');
      await loadSyncMeta();const al=latestArchiveOfficial(j.rows),ml=syncMeta?.latestOfficial;if(ml&&!sameOfficial(al,ml)){console.warn('archive/meta mismatch');return}
      const fp=archiveFingerprintOf(j.rows);if(fp===archiveFingerprint){reconcileFrozenRecords();renderStats();return}
      baseMatrix=j.rows;matrix=E.cloneMatrix(baseMatrix);E.applyOverrides(matrix,loadJSON(LS.overrides,{}));archiveFingerprint=fp;xlsxWorkbook=null;xlsxSheetName=null;$('archiveStatus').textContent=`Архив: ${matrix.length-1} дат`;reconcileFrozenRecords();compute();const nt=`${forecast.target.date}|${forecast.target.time}`;if(showToast||nt!==oldTarget)toast(`Новый тираж получен · следующий ${forecast.target.time}`)
    }catch(e){console.warn('AUTO',e)}finally{autoRefreshBusy=false}
  }
  function startAutoRefresh(){setTimeout(()=>autoRefreshArchive(false),1000);setInterval(()=>autoRefreshArchive(false),AUTO_REFRESH_MS);document.addEventListener('visibilitychange',()=>{if(!document.hidden)autoRefreshArchive(true)});window.addEventListener('focus',()=>autoRefreshArchive(false));window.addEventListener('online',()=>autoRefreshArchive(true))}

  async function loadXlsx(){if(!window.XLSX)return;try{const r=await fetch('data/keno_stolby_po_date_vremeni_16-08-2026.xlsx',{cache:'no-store'});if(!r.ok)throw new Error();const b=await r.arrayBuffer();xlsxWorkbook=XLSX.read(b,{type:'array'});xlsxSheetName=xlsxWorkbook.SheetNames[0]}catch(e){console.warn('xlsx',e)}}
  function updateWorkbookCell(date,time,value){if(!xlsxWorkbook||!window.XLSX)return;const ws=xlsxWorkbook.Sheets[xlsxSheetName],arr=XLSX.utils.sheet_to_json(ws,{header:1,defval:null}),c=(arr[0]||[]).indexOf(time);if(c<0)return;let r=arr.findIndex((x,i)=>i>0&&String(x[0])===date);if(r<0){r=arr.length;ws[XLSX.utils.encode_cell({r,c:0})]={t:'s',v:date}}const a=XLSX.utils.encode_cell({r,c});ws[a]={...(ws[a]||{}),t:'n',v:value}}
  function exportXlsx(){if(!window.XLSX){toast('Excel не загружен');return}if(!xlsxWorkbook){const ws=XLSX.utils.aoa_to_sheet(matrix),wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'КЕНО столбы');xlsxWorkbook=wb;xlsxSheetName='КЕНО столбы'}XLSX.writeFile(xlsxWorkbook,`keno_stolby_aktualny_${forecast?.target.date?.replaceAll('.','-')||'archive'}.xlsx`)}
  function importXlsx(file){if(!window.XLSX)return;const fr=new FileReader();fr.onload=()=>{try{const wb=XLSX.read(fr.result,{type:'array'}),sn=wb.SheetNames[0],arr=XLSX.utils.sheet_to_json(wb.Sheets[sn],{header:1,defval:null});if(!arr.length||String(arr[0][0])!=='Дата / Время')throw new Error('format');xlsxWorkbook=wb;xlsxSheetName=sn;baseMatrix=arr;customActive=true;matrix=E.cloneMatrix(arr);E.applyOverrides(matrix,loadJSON(LS.overrides,{}));compute();toast('Excel загружен')}catch(e){toast('Не удалось прочитать Excel')}};fr.readAsArrayBuffer(file)}
  async function forceUpdate(){const u=new URL(location.href);u.searchParams.set('_update',Date.now());location.replace(u.href)}

  async function init(){
    $('forceUpdate')?.addEventListener('click',forceUpdate);
    try{await loadArchive();await loadSyncMeta();if(syncMeta?.latestOfficial&&!sameOfficial(latestArchiveOfficial(baseMatrix),syncMeta.latestOfficial))syncMeta=null;reconcileFrozenRecords();await loadXlsx();compute();$('saveResult')?.addEventListener('click',saveResult);$('exportXlsx')?.addEventListener('click',exportXlsx);$('recalc')?.addEventListener('click',()=>{reconcileFrozenRecords();compute();toast('Пересчитано по текущему архиву')});$('importXlsx')?.addEventListener('change',e=>{const f=e.target.files?.[0];if(f)importXlsx(f)});startAutoRefresh()}catch(e){console.error(e);$('archiveStatus').textContent=`Ошибка: ${e.message||e}`;$('archiveStatus').classList.add('error');toast(e.message||'Ошибка запуска')}
  }
  init();
})();
