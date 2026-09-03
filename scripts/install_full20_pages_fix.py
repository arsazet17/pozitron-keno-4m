#!/usr/bin/env python3
from pathlib import Path
import json,re

ROOT=Path(__file__).resolve().parents[1]
INDEX=ROOT/'index.html'
APP=ROOT/'full20-app.js'
SW=ROOT/'sw.js'
MANIFEST=ROOT/'manifest.webmanifest'
PAGES=ROOT/'.github/workflows/pages.yml'
VERSION='1.0.3'

def must(x,msg):
    if not x: raise RuntimeError(msg)

# ---------------- INDEX ----------------
h=INDEX.read_text(encoding='utf-8')
h=re.sub(r'v1\.0\.\d+',f'v{VERSION}',h)
h=h.replace('href="manifest.webmanifest"',f'href="manifest.webmanifest?v={VERSION}"')
h=h.replace('href="style.css"',f'href="style.css?v={VERSION}"')
h=h.replace('src="full20-app.js"',f'src="full20-app.js?v={VERSION}"')
if 'http-equiv="Cache-Control"' not in h:
    h=h.replace(
        '<meta charset="utf-8">',
        '<meta charset="utf-8"><meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">'
    )
INDEX.write_text(h,encoding='utf-8')

# ---------------- APP ----------------
a=APP.read_text(encoding='utf-8')
old="if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).catch(()=>{}));"
new=f"""if('serviceWorker'in navigator)window.addEventListener('load',async()=>{{
 try{{
  const reg=await navigator.serviceWorker.register('./sw.js?v={VERSION}',{{updateViaCache:'none'}});
  await reg.update();
  let reloading=false;
  navigator.serviceWorker.addEventListener('controllerchange',()=>{{
   if(reloading)return;
   reloading=true;
   location.reload();
  }});
 }}catch(e){{console.warn('SW update',e)}}
}});"""
if old in a:
    a=a.replace(old,new)
elif f"sw.js?v={VERSION}" not in a:
    raise RuntimeError('Не найдена регистрация Service Worker в full20-app.js')
APP.write_text(a,encoding='utf-8')

# ---------------- MANIFEST ----------------
m=json.loads(MANIFEST.read_text(encoding='utf-8'))
m['start_url']=f'./?v={VERSION}'
m['scope']='./'
MANIFEST.write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

# ---------------- SW ----------------
sw=f"""const CACHE='keno-full20-v{VERSION}';
const SHELL=[
 './?v={VERSION}',
 './index.html?v={VERSION}',
 './style.css?v={VERSION}',
 './full20-app.js?v={VERSION}',
 './manifest.webmanifest?v={VERSION}',
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

self.addEventListener('fetch',e=>{{
 if(e.request.method!=='GET')return;
 const u=new URL(e.request.url);

 // FULL20 live data are always network-only/no-store.
 if(u.pathname.includes('/data/full20_')){{
  e.respondWith(fetch(new Request(e.request,{{cache:'no-store'}})));
  return;
 }}

 if(u.origin!==self.location.origin)return;

 // App shell: network first, cache only as offline fallback.
 e.respondWith(
  fetch(new Request(e.request,{{cache:'no-store'}}))
   .then(r=>{{
    const cp=r.clone();
    caches.open(CACHE).then(c=>c.put(e.request,cp)).catch(()=>{{}});
    return r;
   }})
   .catch(()=>caches.match(e.request))
 );
}});
"""
SW.write_text(sw,encoding='utf-8')

# ---------------- PAGES ----------------
p=PAGES.read_text(encoding='utf-8')
# Replace any stale KENO workflow_run workflow name(s).
p=re.sub(
    r'workflows:\s*\[[^\]]*\]',
    'workflows: ["KENO FULL20 · Stoloto AUTO"]',
    p
)
must('KENO FULL20 · Stoloto AUTO' in p,'Не удалось исправить workflow_run Pages')
PAGES.write_text(p,encoding='utf-8')

# ---------------- SELF CHECK ----------------
hh=INDEX.read_text(encoding='utf-8')
aa=APP.read_text(encoding='utf-8')
ss=SW.read_text(encoding='utf-8')
pp=PAGES.read_text(encoding='utf-8')
mm=json.loads(MANIFEST.read_text(encoding='utf-8'))

must(f'v{VERSION}' in hh,'Версия не обновилась')
must(f'full20-app.js?v={VERSION}' in hh,'Нет cache-bust JS')
must(f'style.css?v={VERSION}' in hh,'Нет cache-bust CSS')
must(f"sw.js?v={VERSION}" in aa,'SW registration не обновлена')
must("updateViaCache:'none'" in aa,'updateViaCache не включён')
must(f"const CACHE='keno-full20-v{VERSION}'" in ss,'CACHE не обновлён')
must('/data/full20_' in ss and "cache:'no-store'" in ss,'live JSON не network-only')
must(mm['start_url']==f'./?v={VERSION}','manifest start_url не обновлён')
must('workflows: ["KENO FULL20 · Stoloto AUTO"]' in pp,'Pages слушает не новый AUTO')

print(f'PAGES/SW FIX PASS v{VERSION}')
