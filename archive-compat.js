(function(){
  'use strict';
  const nativeFetch=window.fetch.bind(window);

  function isArchiveRequest(input){
    try{
      const raw=typeof input==='string' ? input : input?.url;
      if(!raw) return false;
      const u=new URL(raw, location.href);
      return /\/data\/archive\.json$/i.test(u.pathname);
    }catch(_){ return false; }
  }

  function normalizeArchive(value){
    if(Array.isArray(value)) return {rows:value, format:'legacy-array-adapted'};
    if(value && Array.isArray(value.rows)) return value;
    return value;
  }

  window.fetch=async function(input,init){
    const response=await nativeFetch(input,init);
    if(!isArchiveRequest(input) || !response.ok) return response;

    try{
      const text=await response.clone().text();
      if(/^\s*</.test(text)) return response;
      const parsed=JSON.parse(text);
      const normalized=normalizeArchive(parsed);
      if(normalized===parsed) return response;

      const headers=new Headers(response.headers);
      headers.set('content-type','application/json; charset=utf-8');
      headers.set('x-keno-archive-adapted','legacy-array');
      return new Response(JSON.stringify(normalized),{
        status:response.status,
        statusText:response.statusText,
        headers
      });
    }catch(e){
      console.warn('KENO archive compatibility adapter',e);
      return response;
    }
  };

  window.KenoArchiveCompat={version:'0.2.2',accepts:['legacy-array','rows-object']};
})();
