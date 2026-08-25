(function(){
  'use strict';
  const PREFIX='keno4m.';
  const RECORD_KEY='keno4m.records.v1';
  const memory=Object.create(null);
  let serverRecords=[];

  function recordsPayload(){ return JSON.stringify(serverRecords); }
  function applyPayload(j){
    if(j && Array.isArray(j.records)) serverRecords=j.records;
    else if(Array.isArray(j)) serverRecords=j;
  }
  async function refresh(){
    try{
      const r=await fetch(`data/frozen_records.json?_v=${Date.now()}`,{cache:'no-store'});
      if(!r.ok) throw new Error(`HTTP ${r.status}`);
      applyPayload(await r.json());
      window.dispatchEvent(new CustomEvent('keno4m-server-records'));
    }catch(e){ console.warn('server frozen store',e); }
  }

  // Предзагрузка: данные берутся из репозитория, не из памяти телефона.
  try{
    const x=new XMLHttpRequest();
    x.open('GET',`data/frozen_records.json?_v=${Date.now()}`,false);
    x.send(null);
    if(x.status>=200 && x.status<300) applyPayload(JSON.parse(x.responseText));
  }catch(e){ console.warn('server frozen preload',e); }

  const p=Storage.prototype;
  const nativeGet=p.getItem, nativeSet=p.setItem, nativeRemove=p.removeItem;

  p.getItem=function(key){
    key=String(key);
    if(key===RECORD_KEY) return recordsPayload();
    if(key.startsWith(PREFIX)) return Object.prototype.hasOwnProperty.call(memory,key)?memory[key]:null;
    return nativeGet.call(this,key);
  };
  p.setItem=function(key,value){
    key=String(key);
    if(key===RECORD_KEY) return; // frozen в браузере не записываем
    if(key.startsWith(PREFIX)){ memory[key]=String(value); return; } // только RAM сессии
    return nativeSet.call(this,key,value);
  };
  p.removeItem=function(key){
    key=String(key);
    if(key===RECORD_KEY) return;
    if(key.startsWith(PREFIX)){ delete memory[key]; return; }
    return nativeRemove.call(this,key);
  };

  window.Keno4MServerStore={refresh,getRecords:()=>serverRecords.slice()};
  setInterval(refresh,10000);
})();
