const CACHE='keno4m-v0.1.1';
const ASSETS=['./','index.html','style.css','engine.js','app.js','navigation.js','manifest.webmanifest','icons/icon-192.png','icons/icon-512.png','data/archive.json','data/predictions_seed.json','data/keno_stolby_po_date_vremeni_16-08-2026.xlsx'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE&&k.startsWith('keno4m-')).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET') return;
  const isNav=e.request.mode==='navigate';
  e.respondWith(caches.match(e.request).then(hit=>hit||fetch(e.request).then(res=>{
    if(res.ok){const copy=res.clone();caches.open(CACHE).then(c=>c.put(e.request,copy)).catch(()=>{});}
    return res;
  }).catch(()=>isNav?caches.match('index.html'):Promise.reject(new Error('offline')))));
});
