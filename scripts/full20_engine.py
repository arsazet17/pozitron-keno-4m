#!/usr/bin/env python3
import json, re, os
from pathlib import Path
from datetime import datetime, timezone

ROOT=Path(__file__).resolve().parents[1]
DATA=ROOT/'data'
BASE=DATA/'full20_base_archive.json'
DRAWS=DATA/'full20_draws.json'
STATE=DATA/'full20_model_state.json'
FROZEN=DATA/'full20_frozen.json'
COMBO_VIEW=DATA/'full20_combo_view.json'
META=DATA/'full20_meta.json'

SCHEDULE=[
'00:02','00:17','00:32','01:02','01:17','01:32','02:02','02:17','02:32','03:02','03:32',
'04:02','04:17','04:32','05:02','05:17','05:32','06:02','06:17','06:32','07:02','07:32',
'08:02','08:17','08:32','09:02','09:17','09:32','10:02','10:17','10:32','11:02','11:32',
'12:02','12:17','12:32','13:02','13:17','13:32','14:02','14:17','14:32','15:02','15:32',
'16:02','16:17','16:32','17:02','17:17','17:32','18:02','18:17','18:32','19:02','19:32',
'20:02','20:17','20:32','21:02','21:17','21:32','22:02','22:17','22:32','23:02','23:32']

def load(path,default):
    try:return json.loads(path.read_text(encoding='utf-8'))
    except:return default

def save(path,obj,compact=False):
    text=json.dumps(obj,ensure_ascii=False,separators=(',',':') if compact else None,indent=None if compact else 2)
    path.write_text(text+'\n',encoding='utf-8')

def col_of(n): return ((int(n)-1)%10)+1

def audit_draw(draw):
    counts={str(i):0 for i in range(1,11)}
    positions={i:[] for i in range(1,11)}
    for pos,n in enumerate(draw['balls'],1):
        c=col_of(n); counts[str(c)]+=1; positions[c].append(pos)
    mx=max(counts.values()); tied=[i for i in range(1,11) if counts[str(i)]==mx]
    completion={str(c):positions[c][-1] for c in tied}
    calc=min(tied,key=lambda c:(completion[str(c)],c))
    return {'counts':counts,'max':mx,'tied':tied,'completion':completion,'calculated':calc,
            'officialMatchesCorrected':calc==int(draw['column'])}

def deserialize_top(raw):
    out={c:{k:[] for k in range(1,11)} for c in range(1,11)}
    for cs,ks in raw.items():
        c=int(cs)
        for kstr,arr in ks.items():
            k=int(kstr); out[c][k]=[(tuple(x['combo']),int(x['freq'])) for x in arr]
    return out

def serialize_top(top):
    return {str(c):{str(k):[{'combo':list(combo),'freq':freq} for combo,freq in top[c][k]] for k in range(1,11)} for c in range(1,11)}

def add_bits(bits, tx, idx):
    bit=1<<idx
    for n in tx: bits[int(n)] |= bit

def support(bits,combo):
    b=None
    for n in combo:
        b=bits[n] if b is None else b & bits[n]
        if not b:return 0
    return b.bit_count() if b is not None else 0

def update_top50(top_by_size,item_bits,tx):
    tx=tuple(sorted(set(map(int,tx)))); txset=set(tx)
    cand={k:{} for k in range(1,11)}; floor={}
    for k in range(1,11):
        for combo,freq in top_by_size[k]:
            cand[k][combo]=freq+(1 if set(combo).issubset(txset) else 0)
        floor[k]=min((f for _,f in top_by_size[k]),default=0)
    n=len(tx)
    def dfs(start,combo,bits):
        k=len(combo)
        if k:
            sup=bits.bit_count()
            if sup+1>=floor[k]: cand[k][combo]=max(cand[k].get(combo,0),sup+1)
            if k>=10:return
            if not any(sup+1>=floor[kk] for kk in range(k+1,min(10,k+n-start)+1)):return
        for j in range(start,n):
            if len(combo)>=10:return
            nb=item_bits[tx[j]] if bits is None else bits & item_bits[tx[j]]
            if nb==0 and floor[len(combo)+1]>1:continue
            dfs(j+1,combo+(tx[j],),nb)
    dfs(0,tuple(),None)
    # deterministic: freq desc, tuple asc. Current exact state was seeded from authoritative RETIE delta.
    return {k:sorted(cand[k].items(),key=lambda x:(-x[1],x[0]))[:50] for k in range(1,11)}

def build_bits(base,processed_draws):
    global_bits=[0]*81; global_count=0
    out_bits={c:[0]*81 for c in range(1,11)}; out_count={c:0 for c in range(1,11)}
    next_bits={c:[0]*81 for c in range(1,11)}; next_count={c:0 for c in range(1,11)}
    for row in base:
        balls=row['balls']; c=int(row['column'])
        add_bits(global_bits,balls,global_count); global_count+=1
        reduced=[n for n in balls if col_of(n)!=c]
        add_bits(out_bits[c],reduced,out_count[c]); out_count[c]+=1
        if row.get('next'):
            t=int(row['next']); add_bits(next_bits[t],balls,next_count[t]); next_count[t]+=1
    processed=sorted(processed_draws,key=lambda d:int(d['draw']))
    for i,d in enumerate(processed):
        # global/output includes live fact after base 18:02 only; base already contains draw326812.
        if int(d['draw'])<=326812:continue
        c=int(d['column']); balls=d['balls']
        add_bits(global_bits,balls,global_count); global_count+=1
        add_bits(out_bits[c],[n for n in balls if col_of(n)!=c],out_count[c]); out_count[c]+=1
        # transition predecessor -> this column. predecessor may be base last or prior live.
        prev=next((x for x in processed if int(x['draw'])==int(d['draw'])-1),None)
        if prev:
            add_bits(next_bits[c],prev['balls'],next_count[c]); next_count[c]+=1
    return global_bits,global_count,out_bits,out_count,next_bits,next_count

def score_columns(patterns,balls):
    s=set(map(int,balls)); scores={}
    for c in range(1,11):
        total=0
        for k in range(1,11):
            for combo,freq in patterns[c][k]:
                if set(combo).issubset(s): total+=freq
        scores[c]=total
    return scores

def choose_combo(col,combo_top,global_bits):
    cand=[]
    for k in range(2,11):
        for combo,sup in combo_top[col][k]:
            if sup<8:continue
            allsup=support(global_bits,combo)
            if not allsup:continue
            spec=sup/allsup
            cand.append((spec,k,sup,combo,allsup))
    cand.sort(key=lambda x:(-x[0],-x[1],-x[2],x[3]))
    if not cand:return None
    spec,k,sup,combo,allsup=cand[0]
    return {'combo':list(combo),'size':k,'support':sup,'all':allsup,'specificity':spec}

def top_combo_view(combo_top,global_bits):
    out={}
    for c in range(1,11):
        cand=[]
        for k in range(2,11):
            for combo,sup in combo_top[c][k]:
                if sup<8:continue
                allsup=support(global_bits,combo)
                if not allsup:continue
                cand.append({'combo':list(combo),'size':k,'support':sup,'all':allsup,'specificity':sup/allsup})
        cand.sort(key=lambda x:(-x['specificity'],-x['size'],-x['support'],tuple(x['combo'])))
        out[str(c)]=cand[:20]
    return out

def next_slot(date_s,time_s,draw):
    idx=SCHEDULE.index(time_s)
    if idx<len(SCHEDULE)-1:return {'draw':draw+1,'date':date_s,'time':SCHEDULE[idx+1]}
    dt=datetime.strptime(date_s,'%d.%m.%y')
    from datetime import timedelta
    nd=dt+timedelta(days=1)
    return {'draw':draw+1,'date':nd.strftime('%d.%m.%y'),'time':SCHEDULE[0]}

def evaluate_record(rec,draw):
    balls=set(draw['balls']); fact=int(draw['column'])
    rank=next((i+1 for i,x in enumerate(rec.get('ranking',[])) if int(x[0])==fact),None)
    for o in rec.get('options',[]):
        combo=o.get('combo') or []
        hits=[n for n in combo if n in balls]
        o['columnHit']=int(o['column'])==fact
        o['comboHits']=len(hits); o['comboHitNumbers']=hits
    if rank==1:cls='V1'
    elif rank in (2,3):cls=f'V{rank}'
    elif rank in (4,5):cls='reserve-hit'
    elif rank is not None and rank<=6:cls='selector-miss'
    else:cls='deep-miss'
    rec['actual']={'column':fact,'draw':draw['draw'],'balls':draw['balls'],'audit':draw.get('audit')}
    rec['actualRank']=rank; rec['classification']=cls; rec['closed']=True

def main():
    base=load(BASE,[]); draws=load(DRAWS,[]); st=load(STATE,{}); fr=load(FROZEN,{'version':1,'records':[]})
    draws=sorted(draws,key=lambda d:int(d['draw']))
    processed_draw=int(st.get('processedThrough',{}).get('draw',326816))
    processed=[d for d in draws if int(d['draw'])<=processed_draw]
    global_bits,global_count,out_bits,out_count,next_bits,next_count=build_bits(base,processed)
    patterns=deserialize_top(st['patterns']); combos=deserialize_top(st['combos'])

    pending=[d for d in draws if int(d['draw'])>processed_draw]
    changed=False
    for draw in pending:
        draw['audit']=audit_draw(draw)
        # Close immutable frozen first.
        rec=next((r for r in fr['records'] if int(r.get('target',{}).get('draw',-1))==int(draw['draw']) and not r.get('closed')),None)
        if rec:evaluate_record(rec,draw)
        # Find predecessor from all known draws; must be immediately previous draw.
        prev=next((d for d in draws if int(d['draw'])==int(draw['draw'])-1),None)
        if not prev:raise RuntimeError(f"Нет предыдущего FULL20 тиража для №{draw['draw']}")
        fact=int(draw['column'])
        # Update model only AFTER frozen check.
        patterns[fact]=update_top50(patterns[fact],next_bits[fact],prev['balls'])
        add_bits(next_bits[fact],prev['balls'],next_count[fact]); next_count[fact]+=1
        reduced=[n for n in draw['balls'] if col_of(n)!=fact]
        combos[fact]=update_top50(combos[fact],out_bits[fact],reduced)
        add_bits(out_bits[fact],reduced,out_count[fact]); out_count[fact]+=1
        add_bits(global_bits,draw['balls'],global_count); global_count+=1
        st['processedThrough']={'draw':draw['draw'],'date':draw['date'],'time':draw['time']}
        processed_draw=int(draw['draw']); changed=True
        # New frozen only if it does not already exist. Never overwrite old frozen.
        target=next_slot(draw['date'],draw['time'],int(draw['draw']))
        exists=next((r for r in fr['records'] if int(r.get('target',{}).get('draw',-1))==target['draw']),None)
        if not exists:
            scores=score_columns(patterns,draw['balls'])
            ranking=sorted(scores.items(),key=lambda x:(-x[1],x[0]))
            opts=[]
            labels=['В1','В2','В3','R1','R2']
            for label,(c,score) in zip(labels,ranking[:5]):
                o={'label':label,'column':c,'score':score}
                cc=choose_combo(c,combos,global_bits)
                if cc:o.update(cc)
                opts.append(o)
            fr['records'].append({'target':target,'createdAfterDraw':draw['draw'],'createdAt':datetime.now(timezone.utc).isoformat(),
                                  'options':opts,'ranking':[[c,s] for c,s in ranking],'frozen':True,'closed':False})
    # Always refresh views/meta.
    st['patterns']=serialize_top(patterns); st['combos']=serialize_top(combos)
    save(STATE,st,compact=True); save(DRAWS,draws); save(FROZEN,fr)
    save(COMBO_VIEW,top_combo_view(combos,global_bits))
    latest=draws[-1] if draws else None
    openrec=next((r for r in reversed(fr['records']) if not r.get('closed')),None)
    meta={'updatedAt':datetime.now(timezone.utc).isoformat(),'version':'FULL20-RETIE-1.0.0','latestDraw':latest,
          'nextFrozen':openrec.get('target') if openrec else None,'baseDraws':len(base),'liveDraws':len(draws),
          'retieChanged':st.get('benchmark',{}).get('retieChanged',6984),'benchmark':st.get('benchmark',{}),
          'antiLeakage':'FROZEN → FACT → CHECK → UPDATE → NEW FROZEN'}
    save(META,meta)
    print(f"FULL20 PASS: processed {len(pending)} new draws; through {processed_draw}")

if __name__=='__main__':main()
