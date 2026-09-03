#!/usr/bin/env python3
import json, re
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
DATA=ROOT/'data'
SYNC=ROOT/'scripts'/'full20_stoloto_sync.py'

EXPECTED = {
    326817: ('03.09.26','20:02'),
    326818: ('03.09.26','20:17'),
    326819: ('03.09.26','20:32'),
    326820: ('03.09.26','21:02'),
    326821: ('03.09.26','21:17'),
    326822: ('03.09.26','21:32'),
    326823: ('03.09.26','22:02'),
}

def load(path):
    return json.loads(path.read_text(encoding='utf-8'))

def save(path,obj,compact=False):
    txt=json.dumps(
        obj,ensure_ascii=False,
        separators=(',',':') if compact else None,
        indent=None if compact else 2
    )
    path.write_text(txt+'\n',encoding='utf-8')

def patch_sync():
    s=SYNC.read_text(encoding='utf-8')
    if "timezone_id='Europe/Moscow'" in s:
        print('SYNC timezone: already patched')
        return False

    old=(
        "  browser=await p.chromium.launch(headless=True);"
        "page=await browser.new_page(viewport={'width':1440,'height':1200});"
        "await login(page,email,password)\n"
        "  reads=[]"
    )
    new=(
        "  browser=await p.chromium.launch(headless=True)\n"
        "  context=await browser.new_context(\n"
        "   locale='ru-RU',\n"
        "   timezone_id='Europe/Moscow',\n"
        "   viewport={'width':390,'height':844},\n"
        "   user_agent='Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36'\n"
        "  )\n"
        "  page=await context.new_page()\n"
        "  await login(page,email,password)\n"
        "  reads=[]"
    )
    if old not in s:
        raise RuntimeError('Не найдена текущая точка browser.new_page в full20_stoloto_sync.py')
    s=s.replace(old,new,1)
    SYNC.write_text(s,encoding='utf-8')
    print('SYNC timezone: Europe/Moscow installed')
    return True

def repair_draws():
    path=DATA/'full20_draws.json'
    draws=load(path)
    changed=0
    for d in draws:
        no=int(d.get('draw',0))
        if no in EXPECTED and no<=326822:
            date_s,time_s=EXPECTED[no]
            if d.get('date')!=date_s or d.get('time')!=time_s:
                print(f"DRAW {no}: {d.get('date')} {d.get('time')} -> {date_s} {time_s}")
                d['date']=date_s
                d['time']=time_s
                changed+=1
    save(path,draws)
    return draws,changed

def repair_frozen():
    path=DATA/'full20_frozen.json'
    fr=load(path)
    changed=0
    for r in fr.get('records',[]):
        no=int((r.get('target') or {}).get('draw',0))
        if no in EXPECTED:
            date_s,time_s=EXPECTED[no]
            target=r.setdefault('target',{})
            if target.get('date')!=date_s or target.get('time')!=time_s:
                print(f"FROZEN {no}: {target.get('date')} {target.get('time')} -> {date_s} {time_s}")
                target['date']=date_s
                target['time']=time_s
                changed+=1
    save(path,fr)
    return fr,changed

def repair_state(draws):
    path=DATA/'full20_model_state.json'
    st=load(path)
    p=st.get('processedThrough') or {}
    no=int(p.get('draw',0))
    hit=next((d for d in draws if int(d.get('draw',0))==no),None)
    if hit:
        p['date']=hit['date']
        p['time']=hit['time']
        st['processedThrough']=p
    save(path,st,compact=True)
    return st

def repair_meta(draws,fr):
    path=DATA/'full20_meta.json'
    meta=load(path)
    latest=draws[-1] if draws else None
    if latest:
        meta['latestDraw']=latest
    openrec=next((r for r in reversed(fr.get('records',[])) if not r.get('closed')),None)
    meta['nextFrozen']=(openrec or {}).get('target')
    save(path,meta)
    return meta

def repair_sync_status(draws):
    path=DATA/'full20_sync.json'
    if not path.exists():
        return None
    st=load(path)
    latest=st.get('latest') or {}
    no=int(latest.get('draw',0))
    hit=next((d for d in draws if int(d.get('draw',0))==no),None)
    if hit:
        st['latest']=hit
    save(path,st)
    return st

def verify(draws,fr,state,meta):
    by={int(d['draw']):d for d in draws}
    for no,(date_s,time_s) in EXPECTED.items():
        if no<=326822 and no in by:
            assert by[no]['date']==date_s and by[no]['time']==time_s, f'№{no}: время не исправлено'

    recs={int(r['target']['draw']):r for r in fr.get('records',[]) if r.get('target',{}).get('draw')}
    for no,(date_s,time_s) in EXPECTED.items():
        if no in recs:
            t=recs[no]['target']
            assert t['date']==date_s and t['time']==time_s, f'frozen №{no}: время не исправлено'

    processed=int((state.get('processedThrough') or {}).get('draw',0))
    if processed in by:
        assert state['processedThrough']['time']==by[processed]['time']
        assert state['processedThrough']['date']==by[processed]['date']

    latest=draws[-1]
    assert meta['latestDraw']['draw']==latest['draw']
    assert meta['latestDraw']['time']==latest['time']

    open_records=[r for r in fr.get('records',[]) if not r.get('closed')]
    assert len(open_records)==1, f'Открытых frozen должно быть 1, сейчас {len(open_records)}'
    assert meta['nextFrozen']==open_records[0]['target']

    # Critical anti-leakage invariant: only timestamps were repaired.
    seed=next(r for r in fr['records'] if int(r['target']['draw'])==326817)
    assert [o['column'] for o in seed['options']]==[7,1,9,8,10]
    assert [o['score'] for o in seed['options']]==[16385,13328,12982,12601,11055]

    print(
        f"VERIFY PASS: latest №{latest['draw']} {latest['date']} {latest['time']}; "
        f"open frozen №{open_records[0]['target']['draw']} {open_records[0]['target']['time']}"
    )

def main():
    patch_sync()
    draws,_=repair_draws()
    fr,_=repair_frozen()
    state=repair_state(draws)
    meta=repair_meta(draws,fr)
    repair_sync_status(draws)
    verify(draws,fr,state,meta)

if __name__=='__main__':
    main()
