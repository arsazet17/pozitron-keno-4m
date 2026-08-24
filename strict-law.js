(function(){
  'use strict';
  const RECORDS_KEY='keno4m.records.v1';
  const LAW_KEY='keno4m.strictLaw.v2';
  const originalSetItem=Storage.prototype.setItem;
  function sanitizeRecords(value){
    try{
      const rows=JSON.parse(value);
      if(!Array.isArray(rows)) return value;
      const clean=rows.filter(r=>!(r && typeof r==='object' && r.restored===true && !r.frozenAt));
      return JSON.stringify(clean);
    }catch(_){ return value; }
  }
  Storage.prototype.setItem=function(key,value){
    if(key===RECORDS_KEY) value=sanitizeRecords(value);
    return originalSetItem.call(this,key,value);
  };
  try{
    const old=localStorage.getItem(RECORDS_KEY);
    if(old!=null){
      const clean=sanitizeRecords(old);
      if(clean!==old) originalSetItem.call(localStorage,RECORDS_KEY,clean);
    }
    originalSetItem.call(localStorage,LAW_KEY,JSON.stringify({
      version:2, rule:'only-pre-draw-frozen-counts', installedAt:new Date().toISOString()
    }));
  }catch(e){ console.warn('strict law init',e); }
  window.KenoStrictLaw={
    isFrozenRecord:r=>Boolean(r && r.frozenAt && r.date && r.time && Array.isArray(r.v1)),
    noBackfill:true
  };
})();
