#!/usr/bin/env python3
import asyncio,json,os,re
from collections import Counter
from pathlib import Path
from datetime import datetime,date,timezone,timedelta
from playwright.async_api import async_playwright

ROOT=Path(__file__).resolve().parents[1]
DATA=ROOT/'data'
OUT=DATA/'full20_draws.json'
STATUS=DATA/'full20_sync.json'

LOGIN_URL='https://oauth.stoloto.ru/login'
ARCHIVE_URL='https://m.stoloto.ru/keno2/archive/'
TAIL=10
MAX_READS=9
READ_DELAY_MS=2500

SCHEDULE={
'00:02','00:17','00:32','01:02','01:17','01:32','02:02','02:17','02:32',
'03:02','03:32','04:02','04:17','04:32','05:02','05:17','05:32','06:02',
'06:17','06:32','07:02','07:32','08:02','08:17','08:32','09:02','09:17',
'09:32','10:02','10:17','10:32','11:02','11:32','12:02','12:17','12:32',
'13:02','13:17','13:32','14:02','14:17','14:32','15:02','15:32','16:02',
'16:17','16:32','17:02','17:17','17:32','18:02','18:17','18:32','19:02',
'19:32','20:02','20:17','20:32','21:02','21:17','21:32','22:02','22:17',
'22:32','23:02','23:32'
}
MONTHS={'января':1,'февраля':2,'марта':3,'апреля':4,'мая':5,'июня':6,
'июля':7,'августа':8,'сентября':9,'октября':10,'ноября':11,'декабря':12}

def norm(s):
    return re.sub(r'[ \t]+',' ',str(s or '').replace('\xa0',' ')).strip()

def parse_draw(t):
    m=re.search(r'№\s*(\d{4,})',t)
    return int(m.group(1)) if m else None

def parse_time(t):
    m=re.search(r'\b([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?\b',t)
    return f'{int(m.group(1)):02d}:{m.group(2)}' if m else None

def parse_column(t):
    s=norm(t)
    for rx in [
        r'столб(?:ец|ца|цу|цом|це)?\s*[:№#-]?\s*(10|[1-9])\b',
        r'(?:^|\s)(10|[1-9])\s*(?:-?й)?\s*столб(?:ец|ца|цу|цом|це)?\b'
    ]:
        m=re.search(rx,s,re.I)
        if m:return int(m.group(1))
    return None

def parse_date_label(label):
    raw=norm(label).lower()
    today=(datetime.now(timezone.utc)+timedelta(hours=3)).date()
    if raw=='сегодня':
        d=today
    elif raw=='вчера':
        d=today-timedelta(days=1)
    else:
        m=re.fullmatch(r'(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})',raw)
        if m:
            y=int(m.group(3)); y=y+2000 if y<100 else y
            d=date(y,int(m.group(2)),int(m.group(1)))
        else:
            m=re.fullmatch(r'(\d{1,2})\s+([а-яё]+)(?:\s+(\d{4}))?',raw)
            if not m or m.group(2) not in MONTHS:return None
            y=int(m.group(3)) if m.group(3) else today.year
            mm=MONTHS[m.group(2)]
            if not m.group(3) and mm>today.month+6:y-=1
            d=date(y,mm,int(m.group(1)))
    return d.strftime('%d.%m.%y')

def audit(d):
    counts={str(i):0 for i in range(1,11)}
    pos={i:[] for i in range(1,11)}
    for i,n in enumerate(d['balls'],1):
        c=((n-1)%10)+1
        counts[str(c)]+=1
        pos[c].append(i)
    mx=max(counts.values())
    tied=[c for c in range(1,11) if counts[str(c)]==mx]
    comp={str(c):pos[c][-1] for c in tied}
    calc=min(tied,key=lambda c:(comp[str(c)],c))
    return {'counts':counts,'max':mx,'tied':tied,'completion':comp,
            'calculated':calc,'officialMatchesCorrected':calc==d['column']}

# EXACT working login method from the last successful AUTO.
async def login(page,email,password):
    await page.goto(LOGIN_URL,wait_until='domcontentloaded',timeout=60000)

    for sel in [
        'input[type="email"]',
        'input[autocomplete="username"]',
        'input[name*="login" i]',
        'input[type="text"]'
    ]:
        loc=page.locator(sel).first
        if await loc.count():
            await loc.fill(email)
            break
    else:
        raise RuntimeError('Не найден логин Stoloto OAuth')

    for sel in ['input[type="password"]','input[autocomplete="current-password"]']:
        loc=page.locator(sel).first
        if await loc.count():
            await loc.fill(password)
            break
    else:
        raise RuntimeError('Не найден пароль Stoloto OAuth')

    btn=page.get_by_role('button',name=re.compile('войти',re.I)).first
    if not await btn.count():
        btn=page.locator('button[type="submit"]').first
    await btn.click()
    await page.wait_for_timeout(2500)

def auth_url(url):
    s=str(url or '').lower()
    return 'oauth.stoloto.ru' in s or '/login' in s

# EXACT working archive URL/navigation from the last successful AUTO.
# IMPORTANT: NO ?ts query parameter on Stoloto archive page.
async def collect(page):
    await page.goto(ARCHIVE_URL,wait_until='domcontentloaded',timeout=60000)
    await page.wait_for_timeout(1800)

    if auth_url(page.url):
        return []

    raw=await page.locator('body').evaluate("""() => {
 const norm=s=>String(s||'').replace(/\\u00a0/g,' ').replace(/[ \\t]+/g,' ').trim();
 const drawRx=/№\\s*\\d{4,}/;
 const dateRx=/^(Сегодня|Вчера|\\d{1,2}[.\\/-]\\d{1,2}[.\\/-]\\d{2,4}|\\d{1,2}\\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)(?:\\s+\\d{4})?)$/i;
 const all=[...document.querySelectorAll('body *')];

 function dateBefore(el){
   let best='';
   for(const n of all){
     if(n===el||el.contains(n))continue;
     const p=n.compareDocumentPosition(el);
     if(!(p&Node.DOCUMENT_POSITION_FOLLOWING))continue;
     const t=norm(n.innerText||n.textContent);
     if(t&&t.length<40&&dateRx.test(t))best=t;
   }
   return best;
 }

 let rows=[...document.querySelectorAll('tr')].filter(el=>drawRx.test(el.innerText||''));
 if(!rows.length)rows=all.filter(el=>{
   const t=norm(el.innerText);
   return drawRx.test(t)&&![...el.children].some(ch=>drawRx.test(norm(ch.innerText)));
 });

 return rows.map(el=>{
   const chunks=[];
   const add=n=>{if(n){const t=norm(n.innerText||n.textContent);if(t)chunks.push(t)}};
   add(el);
   let p=el.parentElement;
   for(let i=0;p&&i<4;i++,p=p.parentElement){
     add(p);
     if(/столб/i.test(chunks.join(' ')))break;
   }
   add(el.previousElementSibling);
   add(el.nextElementSibling);

   const btn=[...el.querySelectorAll('button')].map(x=>norm(x.innerText||x.textContent));
   const atoms=[...el.querySelectorAll('[class*="ball" i],[class*="number" i],[class*="win" i]')]
     .map(x=>norm(x.innerText||x.textContent));

   return {
     text:norm(el.innerText),
     context:chunks.join('\\n'),
     dateLabel:dateBefore(el),
     buttons:btn,
     atoms
   };
 });
}""")

    out=[]
    carry=''
    for row in raw:
        text=norm(row.get('text'))
        draw=parse_draw(text)
        if not draw:continue

        tm=parse_time(text)
        if not tm or tm not in SCHEDULE:continue

        if row.get('dateLabel'):carry=row['dateLabel']
        ds=parse_date_label(row.get('dateLabel') or carry)
        if not ds:continue

        col=parse_column(row.get('context') or text)
        if not col:
            raise RuntimeError(f'№{draw}: не найден официальный столб')

        balls=[]
        for pool in (row.get('buttons') or [],row.get('atoms') or []):
            nums=[]
            for x in pool:
                if re.fullmatch(r'0?([1-9]|[1-7]\d|80)',norm(x)):
                    nums.append(int(x))
            if len(nums)>=20:
                balls=nums[:20]
                break

        if len(balls)!=20:
            raise RuntimeError(f'№{draw}: найдено {len(balls)} чисел вместо 20')
        if len(set(balls))!=20:
            raise RuntimeError(f'№{draw}: 20 чисел содержат дубли')

        d={
            'draw':draw,'date':ds,'time':tm,'column':col,'balls':balls,
            'source':'Официальный Столото OAuth · FULL20 stable-v1.2'
        }
        d['audit']=audit(d)

        if not d['audit']['officialMatchesCorrected']:
            raise RuntimeError(
                f'№{draw}: официальный столб {col} расходится '
                f'с corrected tie-break {d["audit"]["calculated"]}'
            )
        out.append(d)

    uniq={d['draw']:d for d in out}
    return sorted(uniq.values(),key=lambda d:d['draw'])[-TAIL:]

def snapshot_key(arr):
    return tuple(
        (d['draw'],d['date'],d['time'],d['column'],tuple(d['balls']))
        for d in arr
    )

async def get_stable_tail(page,email,password,known_last_draw):
    snapshots=[]
    keys=[]
    latest_by_key={}
    counts=Counter()
    bad=0
    zero_streak=0

    for i in range(MAX_READS):
        try:
            arr=await collect(page)

            if len(arr)<TAIL:
                bad+=1
                zero_streak=zero_streak+1 if not arr else 0
                print(f'Чтение {i+1}: неполный архив {len(arr)}/{TAIL} — повторяю')

                # If archive redirected us back to OAuth, restore the SAME
                # known-working login flow and then reopen the plain archive URL.
                if auth_url(page.url):
                    print('Архив вернул OAuth — повторный вход')
                    await login(page,email,password)

                # If page returned 0 several times without OAuth redirect,
                # do a hard new navigation via about:blank, then continue.
                if zero_streak>=2 and not auth_url(page.url):
                    print('Два пустых чтения — переоткрываю архив с чистой навигацией')
                    await page.goto('about:blank')
                    await page.wait_for_timeout(500)

                if i<MAX_READS-1:
                    await page.wait_for_timeout(READ_DELAY_MS)
                continue

            zero_streak=0
            latest_draw=arr[-1]['draw']

            if latest_draw < known_last_draw:
                bad+=1
                print(
                    f'Чтение {i+1}: старый хвост №{latest_draw} < '
                    f'сохранённого №{known_last_draw} — повторяю'
                )
                if i<MAX_READS-1:
                    await page.wait_for_timeout(READ_DELAY_MS)
                continue

            k=snapshot_key(arr)
            snapshots.append(arr)
            keys.append(k)
            latest_by_key[k]=latest_draw
            counts[k]+=1

            print(
                f'Чтение {i+1}: №{arr[0]["draw"]}–№{latest_draw}; '
                f'подтверждение {counts[k]}'
            )

            if len(keys)>=3 and keys[-1]==keys[-2]==keys[-3]:
                print(f'STABLE PASS 3/3: №{latest_draw}')
                return arr

            freshest=max(latest_by_key.values())
            candidates=[
                key for key,cnt in counts.items()
                if cnt>=2 and latest_by_key[key]==freshest
            ]
            if candidates:
                chosen=candidates[-1]
                idx=max(j for j,x in enumerate(keys) if x==chosen)
                print(f'SMART PASS 2/2: свежее состояние №{freshest}')
                return snapshots[idx]

        except Exception as e:
            bad+=1
            print(f'Чтение {i+1}: временный сбой {type(e).__name__}: {e}')
            try:
                if auth_url(page.url):
                    print('После сбоя страница на OAuth — восстанавливаю вход')
                    await login(page,email,password)
            except Exception as le:
                print(f'Повторный OAuth пока не удался: {le}')

        if i<MAX_READS-1:
            await page.wait_for_timeout(READ_DELAY_MS)

    seen=[a[-1]['draw'] for a in snapshots if a]
    raise RuntimeError(
        f'FULL20 не стабилизирован за {MAX_READS} чтений; '
        f'валидные latest={seen}; bad={bad}. Старые данные не изменены.'
    )

async def main():
    email=os.environ.get('STOLOTO_EMAIL')
    password=os.environ.get('STOLOTO_PASSWORD')
    if not email or not password:
        raise RuntimeError('Нет STOLOTO_EMAIL/STOLOTO_PASSWORD')

    existing=json.loads(OUT.read_text(encoding='utf-8')) if OUT.exists() else []
    known_last_draw=max((int(d['draw']) for d in existing),default=0)

    async with async_playwright() as p:
        browser=await p.chromium.launch(headless=True)
        context=await browser.new_context(
            locale='ru-RU',
            timezone_id='Europe/Moscow',
            viewport={'width':390,'height':844},
            user_agent='Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36'
        )
        page=await context.new_page()

        # EXACT same initial login as the successful #3889.
        await login(page,email,password)
        official=await get_stable_tail(page,email,password,known_last_draw)
        await browser.close()

    # No write happens before stable confirmation.
    mp={int(d['draw']):d for d in existing}
    for d in official:
        mp[d['draw']]=d

    merged=sorted(mp.values(),key=lambda d:int(d['draw']))
    OUT.write_text(
        json.dumps(merged,ensure_ascii=False,indent=2)+'\n',
        encoding='utf-8'
    )
    STATUS.write_text(
        json.dumps({
            'updatedAt':datetime.now(timezone.utc).isoformat(),
            'stableDraws':TAIL,
            'latest':official[-1],
            'mode':'working-login-plus-stable-retry-v1.2'
        },ensure_ascii=False,indent=2)+'\n',
        encoding='utf-8'
    )
    print(
        f'FULL20 STOLOTO PASS v1.2: №{official[-1]["draw"]} '
        f'{official[-1]["time"]} ст{official[-1]["column"]}'
    )

if __name__=='__main__':
    asyncio.run(main())
