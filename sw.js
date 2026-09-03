const CACHE='keno-full20-v1.0.3';
const SHELL=[
 './?v=1.0.3',
 './index.html?v=1.0.3',
 './style.css?v=1.0.3',
 './full20-app.js?v=1.0.3',
 './manifest.webmanifest?v=1.0.3',
 './icons/icon-192.png',
 './icons/icon-512.png'
];

self.addEventListener('install',e=>e.waitUntil(
 caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting())
));

self.addEventListener('activate',e=>e.waitUntil(
 caches.keys()
  .then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
  .then(()=>self.clients.claim())
));

self.addEventListener('fetch',e=>{
 if(e.request.method!=='GET')return;
 const u=new URL(e.request.url);
 if(u.pathname.includes('/data/full20_')){
  e.respondWith(fetch(new Request(e.request,{cache:'no-store'})));
  return;
 }
 if(u.origin!==self.location.origin)return;
 e.respondWith(
  fetch(new Request(e.request,{cache:'no-store'}))
   .then(r=>{
    const cp=r.clone();
    caches.open(CACHE).then(c=>c.put(e.request,cp)).catch(()=>{});
    return r;
   })
   .catch(()=>caches.match(e.request))
 );
});
