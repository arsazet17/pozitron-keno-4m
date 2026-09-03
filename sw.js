const CACHE='keno-full20-shell-000000000000';

const ASSETS=[
  './',
  './index.html',
  './style.css',
  './full20-app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

const RAW_BASE='https://raw.githubusercontent.com/arsazet17/pozitron-keno-4m/main/';
const DIRECT={
  '/data/full20_draws.json':'data/full20_draws.json',
  '/data/full20_frozen.json':'data/full20_frozen.json',
  '/data/full20_meta.json':'data/full20_meta.json',
  '/data/full20_combo_view.json':'data/full20_combo_view.json',
  '/data/full20_sync.json':'data/full20_sync.json',
  '/data/full20_model_state.json':'data/full20_model_state.json'
};

self.addEventListener('install',event=>event.waitUntil(
  caches.open(CACHE)
    .then(cache=>cache.addAll(ASSETS))
    .then(()=>self.skipWaiting())
));

self.addEventListener('activate',event=>event.waitUntil(
  caches.keys()
    .then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
    .then(()=>self.clients.claim())
));

self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;

  const u=new URL(event.request.url);

  // LIVE FULL20 JSON: direct from GitHub main, same principle as M5M.
  if(u.origin===self.location.origin){
    const found=Object.entries(DIRECT).find(([suffix])=>u.pathname.endsWith(suffix));
    if(found){
      const raw=new URL(found[1],RAW_BASE);
      raw.searchParams.set('ts',String(Date.now()));

      event.respondWith(
        fetch(raw.href,{
          method:'GET',
          cache:'no-store',
          mode:'cors',
          credentials:'omit'
        }).then(r=>{
          if(!r.ok)throw new Error('FULL20 RAW HTTP '+r.status);
          return r;
        })
      );
      return;
    }
  }

  // Static shell: network first, cache only as offline fallback.
  if(u.origin===self.location.origin){
    event.respondWith(
      fetch(new Request(event.request,{cache:'no-store'}))
        .then(r=>{
          const copy=r.clone();
          caches.open(CACHE).then(c=>c.put(event.request,copy)).catch(()=>{});
          return r;
        })
        .catch(()=>caches.match(event.request))
    );
  }
});

self.addEventListener('message',event=>{
  if(event.data==='SKIP_WAITING')self.skipWaiting();
});
