(function(){
  'use strict';
  const E=window.KenoEngine;
  const LS={overrides:'keno4m.overrides.v1',records:'keno4m.records.v1',custom:'keno4m.customMatrix.v1'};
  let matrix=null, baseMatrix=null, forecast=null, xlsxWorkbook=null, xlsxSheetName=null, customActive=false;

  const $=id=>document.getElementById(id);
  function toast(msg){const t=$('toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2600)}
  const memStore={};
  function loadJSON(key,fallback){
    try{const raw=localStorage.getItem(key);if(raw!=null)return JSON.parse(raw)}catch(e){console.warn('localStorage read',e)}
    return Object.prototype.hasOwnProperty.call(memStore,key)?memStore[key]:fallback;
  }
  function saveJSON(key,v){memStore[key]=v;try{localStorage.setItem(key,JSON.stringify(v))}catch(e){console.warn('localStorage write',e)}}
  function esc(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
  function methodValues(m){const c={};m.continuations.forEach(x=>c[x.v]=(c[x.v]||0)+1);return Object.entries(c).sort((a,b)=>b[1]-a[1]||a[0]-b[0]).map(([v,n])=>n>1?`${v}×${n}`:v).join(', ')||'—'}
  function recordKey(r){return `${r.date}|${r.time}`}

  async function fetchJSON(url,backup){
    const tryOne=async u=>{
      const sep=u.includes('?')?'&':'?';
      const r=await fetch(`${u}${sep}_v=012`,{cache:'no-store'});
      if(!r.ok) throw new Error(`HTTP ${r.status}`);
      const text=await r.text();
      if(/^\s*</.test(text)) throw new Error('получен HTML вместо JSON');
      return JSON.parse(text);
    };
    try{return await tryOne(url)}catch(e){
      if(backup){console.warn(`Основной архив ${url} не загрузился`,e);return await tryOne(backup)}
      throw new Error(`Не удалось загрузить ${url}: ${e.message}`);
    }
  }

  async function removeOldPwaCache(){
    let had=false;
    try{
      if('serviceWorker' in navigator){
        const regs=await navigator.serviceWorker.getRegistrations();
        had=regs.length>0 || !!navigator.serviceWorker.controller;
        await Promise.all(regs.map(r=>r.unregister().catch(()=>false)));
      }
      if('caches' in window){
        const keys=await caches.keys();
        if(keys.some(k=>k.startsWith('keno4m-')))had=true;
        await Promise.all(keys.filter(k=>k.startsWith('keno4m-')).map(k=>caches.delete(k)));
      }
    }catch(e){console.warn('Очистка старого PWA-кэша',e)}
    return had;
  }

  async function forceUpdate(){
    const b=$('forceUpdate');
    if(b){b.disabled=true;b.textContent='⟳ Обновляю…';}
    await removeOldPwaCache();
    const u=new URL(location.href);u.searchParams.set('_clean','1');u.searchParams.set('_update',Date.now());location.replace(u.href);
  }

  async function loadArchive(){
    const custom=loadJSON(LS.custom,null);
    const validCustom=Array.isArray(custom)&&custom.length>2&&Array.isArray(custom[0])&&String(custom[0][0])==='Дата / Время';
    if(validCustom){baseMatrix=custom;customActive=true;}
    else {
      const j=await fetchJSON('data/archive.json','https://raw.githubusercontent.com/arsazet17/pozitron-keno-4m/main/data/archive.json');
      if(!j||!Array.isArray(j.rows)||j.rows.length<3)throw new Error('Архив JSON имеет неверный формат');
      baseMatrix=j.rows;customActive=false;
    }
    matrix=E.cloneMatrix(baseMatrix);
    E.applyOverrides(matrix,loadJSON(LS.overrides,{}));
    $('archiveStatus').textContent=`Архив: ${matrix.length-1} дат`;$('archiveStatus').classList.remove('error');
  }

  async function loadXlsx(){
    if(!window.XLSX){$('exportXlsx').disabled=true;return;}
    if(customActive){return;}
    try{
      const xr=await fetch('data/keno_stolby_po_date_vremeni_16-08-2026.xlsx',{cache:'no-store'});if(!xr.ok)throw new Error(`Excel HTTP ${xr.status}`);const b=await xr.arrayBuffer();
      xlsxWorkbook=XLSX.read(b,{type:'array'});xlsxSheetName=xlsxWorkbook.SheetNames[0];
      applyOverridesToWorkbook();
    }catch(e){console.warn(e);$('exportXlsx').disabled=true;}
  }

  function getRecords(){return loadJSON(LS.records,[])}
  function setRecords(rows){saveJSON(LS.records,rows)}
  function upsertRecord(r){
    const rows=getRecords(),k=recordKey(r),i=rows.findIndex(x=>recordKey(x)===k);
    if(i>=0) rows[i]={...rows[i],...r}; else rows.push(r);
    rows.sort((a,b)=>E.parseDate(a.date)-E.parseDate(b.date)||E.SCHEDULE.indexOf(a.time)-E.SCHEDULE.indexOf(b.time));
    setRecords(rows);
  }

  async function seedRecords(){
    if(getRecords().length) return;
    try{
      const seed=await fetchJSON('data/predictions_seed.json','https://raw.githubusercontent.com/arsazet17/pozitron-keno-4m/main/data/predictions_seed.json');
      seed.forEach(r=>upsertRecord({...r,hitV1:r.v1.includes(r.actual),hitConsensus:r.consensus!=null&&r.consensus===r.actual}));
    }catch{}
  }

  function compute(){
    const target=E.nextTarget(matrix);
    forecast=E.predict(matrix,target);
    upsertRecord({date:target.date,time:target.time,v1:forecast.v1.values,v2:forecast.v2.value,gg:forecast.gg.value,consensus:forecast.consensus,actual:null});
    renderForecast();renderResultSelector();renderStats();
  }

  function renderForecast(){
    const f=forecast,t=f.target;
    $('targetTime').textContent=t.time;$('targetDate').textContent=t.date;
    $('v1Balls').innerHTML=f.v1.values.map(n=>`<div class="ball">${n}</div>`).join('');
    $('v2Value').textContent=f.v2.value??'—';$('ggValue').textContent=f.gg.value??'—';
    $('vChain').textContent=f.vChain.join('–');$('hChain').textContent=f.hChain.join('–');
    $('vChainLen').textContent=f.vChain.length;$('hChainLen').textContent=f.hChain.length;
    const cb=$('consensusBox');
    if(f.consensus!=null){cb.className='consensus';cb.innerHTML=`🔥 <strong>ГЛАВНЫЙ АКЦЕНТ — СТОЛБ ${f.consensus}</strong><div class="small" style="margin-top:5px">В1 + В2 + Доп. Г/Г совпали.</div>`}
    else {cb.className='consensus none';cb.innerHTML='<strong>Полного согласования нет</strong>'}
    $('methods').innerHTML=Object.entries(f.methods).map(([name,m])=>`<div class="method"><b>${name}</b><div><div class="chain">${m.usedChain.join('–')||'—'}</div><div class="muted small">длина ${m.usedLen}, продолжений ${m.continuations.length}</div></div><div class="nexts">${esc(methodValues(m))}</div></div>`).join('');
  }

  function renderResultSelector(){
    const t=forecast.target;
    $('resultTime').innerHTML=`<option value="${t.time}">${t.date} · ${t.time}</option>`;
    $('resultValue').value='';
  }

  function updateMatrixCell(date,time,value){
    const hm=E.headerMap(matrix),c=hm[time];if(c==null)throw new Error('Время отсутствует в Excel');
    const r=E.ensureDateRow(matrix,date);matrix[r][c]=value;
    const overrides=loadJSON(LS.overrides,{});overrides[`${date}|${time}`]=value;saveJSON(LS.overrides,overrides);
  }

  function saveResult(){
    if(!forecast)return;
    const n=E.val($('resultValue').value);if(n==null){toast('Введите столб от 1 до 10');return;}
    const {date,time}=forecast.target;
    const rec=getRecords().find(r=>r.date===date&&r.time===time) || {date,time,v1:forecast.v1.values,v2:forecast.v2.value,gg:forecast.gg.value,consensus:forecast.consensus};
    rec.actual=n;rec.hitV1=rec.v1.includes(n);rec.hitConsensus=rec.consensus!=null&&rec.consensus===n;upsertRecord(rec);
    updateMatrixCell(date,time,n);updateWorkbookCell(date,time,n);
    $('lastCheck').innerHTML=`${date} ${time} → столб <b>${n}</b>. Основной В1: <span class="${rec.hitV1?'hit':'miss'}">${rec.hitV1?'ПОПАЛ':'мимо'}</span>${rec.consensus!=null?`; согласованный ${rec.consensus}: <span class="${rec.hitConsensus?'hit':'miss'}">${rec.hitConsensus?'ПОПАЛ':'мимо'}</span>`:''}.`;
    toast(`Зафиксировано: ${time} → ${n}`);compute();
  }

  function renderStats(){
    const rows=getRecords().filter(r=>r.actual!=null), latest=forecast?.target.date || matrix[matrix.length-1][0];
    const day=rows.filter(r=>r.date===latest);
    $('dayForecasts').textContent=day.length;$('dayV1Hits').textContent=day.filter(r=>r.hitV1).length;
    $('dayConsensus').textContent=day.filter(r=>r.consensus!=null).length;$('dayConsensusHits').textContent=day.filter(r=>r.hitConsensus).length;
    $('dayRows').innerHTML=day.map(r=>`<tr><td>${r.time}</td><td>${r.v1.join(', ')}</td><td>${r.actual}</td><td class="${r.hitV1?'hit':'miss'}">${r.hitV1?'✓':'—'}</td><td class="${r.consensus==null?'muted':r.hitConsensus?'hit':'miss'}">${r.consensus==null?'—':`${r.consensus} ${r.hitConsensus?'✓':'×'}`}</td></tr>`).join('')||'<tr><td colspan="5" class="muted">Пока нет проверенных прогнозов за эти сутки.</td></tr>';
    const by={};
    rows.forEach(r=>{const s=by[r.time]||(by[r.time]={time:r.time,n:0,v1:0,c:0,ch:0});s.n++;if(r.hitV1)s.v1++;if(r.consensus!=null){s.c++;if(r.hitConsensus)s.ch++;}});
    const stats=Object.values(by).sort((a,b)=>(b.v1/b.n)-(a.v1/a.n)||b.ch-a.ch||E.SCHEDULE.indexOf(a.time)-E.SCHEDULE.indexOf(b.time));
    $('timeStats').innerHTML=stats.map(s=>`<tr><td class="${s.n>=3&&s.v1/s.n>=.5?'hot':''}">${s.time}</td><td>${s.n}</td><td>${s.v1}</td><td>${Math.round(100*s.v1/s.n)}%</td><td>${s.c}</td><td>${s.ch}</td></tr>`).join('')||'<tr><td colspan="6" class="muted">Статистика начнёт накапливаться после результатов.</td></tr>';
  }

  function applyOverridesToWorkbook(){
    const ov=loadJSON(LS.overrides,{});for(const [k,v] of Object.entries(ov)){const [d,t]=k.split('|');updateWorkbookCell(d,t,E.val(v));}
  }
  function updateWorkbookCell(date,time,value){
    if(!xlsxWorkbook||!window.XLSX)return;
    const ws=xlsxWorkbook.Sheets[xlsxSheetName], arr=XLSX.utils.sheet_to_json(ws,{header:1,defval:null});
    const header=arr[0]||[],c=header.indexOf(time);if(c<0)return;
    let r=arr.findIndex((x,i)=>i>0&&String(x[0])===date);
    if(r<0){r=arr.length;ws[XLSX.utils.encode_cell({r,c:0})]={t:'s',v:date};}
    const addr=XLSX.utils.encode_cell({r,c});
    const oldCell=ws[addr]||{};ws[addr]={...oldCell,t:'n',v:value};
    const range=XLSX.utils.decode_range(ws['!ref']||'A1:A1');
    range.e.r=Math.max(range.e.r,r);range.e.c=Math.max(range.e.c,c);ws['!ref']=XLSX.utils.encode_range(range);
  }

  function exportXlsx(){
    if(!window.XLSX){toast('Модуль Excel ещё не загрузился');return;}
    if(!xlsxWorkbook){
      const ws=XLSX.utils.aoa_to_sheet(matrix), wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'КЕНО столбы');xlsxWorkbook=wb;xlsxSheetName='КЕНО столбы';
    }
    applyOverridesToWorkbook();
    const d=forecast?.target.date?.replaceAll('.','-')||'archive';
    XLSX.writeFile(xlsxWorkbook,`keno_stolby_aktualny_${d}.xlsx`);toast('Актуальный Excel сформирован');
  }

  function importXlsx(file){
    if(!window.XLSX){toast('Модуль Excel не загружен');return;}
    const fr=new FileReader();fr.onload=()=>{
      try{
        const wb=XLSX.read(fr.result,{type:'array'}),sn=wb.SheetNames[0],arr=XLSX.utils.sheet_to_json(wb.Sheets[sn],{header:1,defval:null});
        if(!arr.length||String(arr[0][0])!=='Дата / Время')throw new Error('Неверный формат');
        xlsxWorkbook=wb;xlsxSheetName=sn;baseMatrix=arr;customActive=true;saveJSON(LS.custom,arr);matrix=E.cloneMatrix(arr);E.applyOverrides(matrix,loadJSON(LS.overrides,{}));
        $('archiveStatus').textContent=`Архив: ${matrix.length-1} дат`;compute();toast('Excel загружен и принят как рабочий архив');
      }catch(e){console.error(e);toast('Не удалось прочитать Excel');}
    };fr.readAsArrayBuffer(file);
  }

  async function init(){
    $('forceUpdate')?.addEventListener('click',forceUpdate);
    try{
      const u=new URL(location.href);
      if(!u.searchParams.has('_clean')){
        const had=await removeOldPwaCache();
        if(had){u.searchParams.set('_clean','1');u.searchParams.set('_update',Date.now());location.replace(u.href);return;}
      }
      await loadArchive();await seedRecords();await loadXlsx();compute();
      $('saveResult').addEventListener('click',saveResult);$('exportXlsx').addEventListener('click',exportXlsx);$('recalc').addEventListener('click',()=>{compute();toast('Пересчитано по текущему архиву')});
      $('importXlsx').addEventListener('change',e=>{const f=e.target.files?.[0];if(f)importXlsx(f)});
      // v0.1.2: Service Worker временно отключён до стабилизации запуска на телефоне.
    }catch(e){
      console.error(e);
      const msg=(e&&e.message)?e.message:'Ошибка запуска';
      $('archiveStatus').textContent=`Ошибка: ${msg}`;$('archiveStatus').classList.add('error');toast(msg);
    }
  }
  init();
})();
