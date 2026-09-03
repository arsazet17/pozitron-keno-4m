#!/usr/bin/env python3
import json,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];D=ROOT/'data'
state=json.loads((D/'full20_model_state.json').read_text()); frozen=json.loads((D/'full20_frozen.json').read_text()); draws=json.loads((D/'full20_draws.json').read_text())
assert state['version']=='RETIE-FULL20-19:32-v1'
assert state['processedThrough']['draw']==326816
r=next(x for x in frozen['records'] if x['target']['draw']==326817)
assert [x['column'] for x in r['options']]==[7,1,9,8,10]
assert [x['score'] for x in r['options']]==[16385,13328,12982,12601,11055]
assert r['ranking']==[[7,16385],[1,13328],[9,12982],[8,12601],[10,11055],[5,10948],[2,10242],[4,9922],[6,9748],[3,9612]]
assert r['options'][0]['combo']==[16,28,32,49,65]
assert r['options'][1]['combo']==[4,23,26,52,60]
assert r['options'][2]['combo']==[44,50,57,75,76]
assert r['options'][3]['combo']==[16,50,53,67,69]
assert r['options'][4]['combo']==[2,16,45,49,68]
for d in draws:
 assert len(d['balls'])==20 and len(set(d['balls']))==20
 assert d['audit']['officialMatchesCorrected'] is True
print('SELFTEST PASS: RETIE seed, frozen 20:02, FULL20 draws, combos')
