#!/usr/bin/env python3
import asyncio,json,os,re
from pathlib import Path
from datetime import datetime,date,timezone,timedelta
from playwright.async_api import async_playwright

ROOT=Path(__file__).resolve().parents[1]; DATA=ROOT/'data'; OUT=DATA/'full20_draws.json'; STATUS=DATA/'full20_sync.json'
LOGIN_URL='https://oauth.stoloto.ru/login'; ARCHIVE_URL='https://m.stoloto.ru/keno2/archive/'
TAIL=10
SCHEDULE={
'00:02','00:17','00:32','01:02','01:17','01:32','02:02','02:17','02:32','03:02','03:32','04:02','04:17','04:32','05:02','05:17','05:32','06:02','06:17','06:32','07:02','07:32','08:02','08:17','08:32','09:02','09:17','09:32','10:02','10:17','10:32','11:02','11:32','12:02','12:17','12:32','13:02','13:17','13:32','14:02','14:17','14:32','15:02','15:32','16:02','16:17','16:32','17:02','17:17','17:32','18:02','18:17','18:32','19:02','19:32','20:02','20:17','20:32','21:02','21:17','21:32','22:02','22:17','22:32','23:02','23:32'}
MONTHS={'января':1,'февраля':2,'марта':3,'апреля':4,'мая':5,'июня':6,'июля':7,'августа':8,'сентября':9,'октября':10,'ноября':11,'декабря':12}

def norm(s):return re.sub(r'[ \t]+',' ',str(s or '').replace('\xa0',' ')).strip()
def parse_draw(t):
 m=re.search(r'№\s*(\d{4,})',t);return int(m.group(1)) if m else None
def parse_time(t):
 m=re.search(r'\b([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?\b',t);return f'{int(m.group(1)):02d}:{m.group(2)}' if m else None
def parse_column(t):
 s=norm(t)
 for rx in [r'столб(?:ец|ца|цу|цом|це)?\s*[:№#-]?\s*(10|[1-9])\b',r'(?:^|\s)(10|[1-9])\s*(?:-?й)?\s*столб(?:ец|ца|цу|цом|це)?\b']:
  m=re.search(rx,s,re.I)
  if m:return int(m.group(1))
 return None
def parse_date_label(label):
 raw=norm(label).lower(); today=(datetime.now(timezone.utc)+timedelta(hours=3)).date()
 if raw=='сегодня':d=today
 elif raw=='вчера':d=today-timedelta(days=1)
 else:
  m=re.fullmatch(r'(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})',raw)
  if m:
   y=int(m.group(3)); y=y+2000 if y<100 else y; d=date(y,int(m.group(2)),int(m.group(1)))
  else:
   m=re.fullmatch(r'(\d{1,2})\s+([а-яё]+)(?:\s+(\d{4}))?',raw)
   if not m or m.group(2) not in MONTHS:return None
   y=int(m.group(3)) if m.group(3) else today.year; mm=MONTHS[m.group(2)]
   if not m.group(3) and mm>today.month+6:y-=1
   d=date(y,mm,int(m.group(1)))
 return d.strftime('%d.%m.%y')

def audit(d):
 counts={str(i):0 for i in range(1,11)}; pos={i:[] for i in range(1,11)}
 for i,n in enumerate(d['balls'],1):c=((n-1)%10)+1;counts[str(c)]+=1;pos[c].append(i)
 mx=max(counts.values()); tied=[c for c in range(1,11) if counts[str(c)]==mx]; comp={str(c):pos[c][-1] for c in tied}; calc=min(tied,key=lambda c:(comp[str(c)],c))
 return {'counts':counts,'max':mx,'tied':tied,'completion':comp,'calculated':calc,'officialMatchesCorrected':calc==d['column']}

async def login(page,email,password):
 await page.goto(LOGIN_URL,wait_until='domcontentloaded',timeout=60000)
 for sel in ['input[type="email"]','input[autocomplete="username"]','input[name*="login" i]','input[type="text"]']:
  loc=page.locator(sel).first
  if await loc.count():await loc.fill(email);break
 else:raise RuntimeError('Не найден логин Stoloto OAuth')
 for sel in ['input[type="password"]','input[autocomplete="current-password"]']:
  loc=page.locator(sel).first
  if await loc.count():await loc.fill(password);break
 else:raise RuntimeError('Не найден пароль Stoloto OAuth')
 btn=page.get_by_role('button',name=re.compile('войти',re.I)).first
 if not await btn.count():btn=page.locator('button[type="submit"]').first
 await btn.click(); await page.wait_for_timeout(3000)

async def collect(page):
 await page.goto(ARCHIVE_URL,wait_until='domcontentloaded',timeout=60000); await page.wait_for_timeout(2500)
 raw=await page.locator('body').evaluate(r'''() => {
 const norm=s=>String(s||'').replace(/\u00a0/g,' ').replace(/[ \t]+/g,' ').trim();
 const drawRx=/№\s*\d{4,}/; const dateRx=/^(Сегодня|Вчера|\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4}|\d{1,2}\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)(?:\s+\d{4})?)$/i;
 const all=[...document.querySelectorAll('body *')];
 function dateBefore(el){let best='';for(const n of all){if(n===el||el.contains(n))continue;const p=n.compareDocumentPosition(el);if(!(p&Node.DOCUMENT_POSITION_FOLLOWING))continue;const t=norm(n.innerText||n.textContent);if(t&&t.length<40&&dateRx.test(t))best=t;}return best}
 let rows=[...document.querySelectorAll('tr')].filter(el=>drawRx.test(el.innerText||''));
 if(!rows.length)rows=all.filter(el=>{const t=norm(el.innerText);return drawRx.test(t)&&![...el.children].some(ch=>drawRx.test(norm(ch.innerText)))});
 return rows.map(el=>{
   const chunks=[];const add=n=>{if(n){const t=norm(n.innerText||n.textContent);if(t)chunks.push(t)}};add(el);let p=el.parentElement;for(let i=0;p&&i<4;i++,p=p.parentElement){add(p);if(/столб/i.test(chunks.join(' ')))break}add(el.previousElementSibling);add(el.nextElementSibling);
   const btn=[...el.querySelectorAll('button')].map(x=>norm(x.innerText||x.textContent));
   const atoms=[...el.querySelectorAll('[class*="ball" i],[class*="number" i],[class*="win" i]')].map(x=>norm(x.innerText||x.textContent));
   return {text:norm(el.innerText),context:chunks.join('\n'),dateLabel:dateBefore(el),buttons:btn,atoms};
 });
}''')
 out=[];carry=''
 for row in raw:
  text=norm(row.get('text')); draw=parse_draw(text)
  if not draw:continue
  tm=parse_time(text)
  if not tm or tm not in SCHEDULE:continue
  if row.get('dateLabel'):carry=row['dateLabel']
  ds=parse_date_label(row.get('dateLabel') or carry)
  if not ds:continue
  col=parse_column(row.get('context') or text)
  if not col:raise RuntimeError(f'№{draw}: не найден официальный столб. context={norm(row.get("context"))[:500]}')
  # Primary source: visible result buttons in DOM order.
  balls=[]
  for pool in (row.get('buttons') or [], row.get('atoms') or []):
   nums=[]
   for x in pool:
    if re.fullmatch(r'0?([1-9]|[1-7]\d|80)',norm(x)):
     n=int(x); nums.append(n)
   # Keep the first unique-looking 20-number result sequence.
   if len(nums)>=20:
    balls=nums[:20];break
  if len(balls)!=20:
   raise RuntimeError(f'№{draw}: найдено {len(balls)} чисел вместо 20; text={text[:500]}')
  if len(set(balls))!=20:raise RuntimeError(f'№{draw}: 20 чисел содержат дубли')
  d={'draw':draw,'date':ds,'time':tm,'column':col,'balls':balls,'source':'Официальный Столото OAuth · FULL20 tail10'};d['audit']=audit(d)
  if not d['audit']['officialMatchesCorrected']:
   raise RuntimeError(f'№{draw}: официальный столб {col} расходится с corrected tie-break {d["audit"]["calculated"]}')
  out.append(d)
 uniq={d['draw']:d for d in out};return sorted(uniq.values(),key=lambda d:d['draw'])[-TAIL:]

async def main():
 email=os.environ.get('STOLOTO_EMAIL');password=os.environ.get('STOLOTO_PASSWORD')
 if not email or not password:raise RuntimeError('Нет STOLOTO_EMAIL/STOLOTO_PASSWORD')
 async with async_playwright() as p:
  browser=await p.chromium.launch(headless=True)
  context=await browser.new_context(
   locale='ru-RU',
   timezone_id='Europe/Moscow',
   viewport={'width':390,'height':844},
   user_agent='Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36'
  )
  page=await context.new_page()
  await login(page,email,password)
  reads=[]
  for i in range(3):
   arr=await collect(page)
   if len(arr)<TAIL:raise RuntimeError(f'Чтение {i+1}: только {len(arr)} тиражей')
   reads.append(arr);print(f'Чтение {i+1}: №{arr[0]["draw"]}–№{arr[-1]["draw"]}');await page.wait_for_timeout(800)
  await browser.close()
 def key(arr):return [(d['draw'],d['date'],d['time'],d['column'],tuple(d['balls'])) for d in arr]
 if not (key(reads[0])==key(reads[1])==key(reads[2])):raise RuntimeError('Тройная FULL20 проверка не совпала 3/3')
 official=reads[0]; existing=json.loads(OUT.read_text(encoding='utf-8')) if OUT.exists() else []
 mp={int(d['draw']):d for d in existing}
 for d in official:mp[d['draw']]=d
 merged=sorted(mp.values(),key=lambda d:int(d['draw']));OUT.write_text(json.dumps(merged,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
 STATUS.write_text(json.dumps({'updatedAt':datetime.now(timezone.utc).isoformat(),'stableDraws':10,'latest':official[-1]},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
 print(f'FULL20 STOLOTO PASS: latest №{official[-1]["draw"]}, ст{official[-1]["column"]}, balls=20')
if __name__=='__main__':asyncio.run(main())
