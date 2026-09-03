#!/usr/bin/env python3
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
D=ROOT/'data'

def load(name):
    return json.loads((D/name).read_text(encoding='utf-8'))

state=load('full20_model_state.json')
frozen=load('full20_frozen.json')
draws=load('full20_draws.json')

assert state.get('version')=='RETIE-FULL20-19:32-v1', 'Неверная версия RETIE state'
assert draws, 'FULL20 draws пуст'

draws=sorted(draws,key=lambda d:int(d['draw']))
latest=draws[-1]
latest_no=int(latest['draw'])

# ==========================================================
# 1. НЕИЗМЕНЯЕМЫЙ ЭТАЛОН ПЕРЕНОСА
# Он обязан оставаться в архиве неизменным даже после обучения.
# ==========================================================
seed=next((x for x in frozen.get('records',[]) if int(x.get('target',{}).get('draw',-1))==326817),None)
assert seed is not None, 'Потерян frozen-эталон №326817 / 20:02'
assert [x['column'] for x in seed['options']]==[7,1,9,8,10], 'Изменён frozen 20:02: столбы'
assert [x['score'] for x in seed['options']]==[16385,13328,12982,12601,11055], 'Изменён frozen 20:02: SCORE'
assert seed['ranking']==[
    [7,16385],[1,13328],[9,12982],[8,12601],
    [10,11055],[5,10948],[2,10242],[4,9922],[6,9748],[3,9612]
], 'Изменён полный рейтинг frozen 20:02'

expected_combos=[
    [16,28,32,49,65],
    [4,23,26,52,60],
    [44,50,57,75,76],
    [16,50,53,67,69],
    [2,16,45,49,68],
]
assert [x.get('combo') for x in seed['options']]==expected_combos, 'Изменены комбы frozen 20:02'

# ==========================================================
# 2. ДИНАМИЧЕСКОЕ ТЕКУЩЕЕ СОСТОЯНИЕ
# После каждого нового факта processedThrough ОБЯЗАН двигаться.
# ==========================================================
processed=int(state.get('processedThrough',{}).get('draw',0))
assert processed==latest_no, (
    f"processedThrough={processed}, но последний сохранённый факт={latest_no}"
)

# Все официальные факты должны содержать полные 20 уникальных чисел
# и проходить corrected tie-break audit.
for d in draws:
    balls=d.get('balls') or []
    assert len(balls)==20, f"№{d.get('draw')}: не 20 чисел"
    assert len(set(map(int,balls)))==20, f"№{d.get('draw')}: есть дубликаты"
    assert 1<=int(d.get('column',0))<=10, f"№{d.get('draw')}: неверный официальный столб"
    audit=d.get('audit') or {}
    assert audit.get('officialMatchesCorrected') is True, (
        f"№{d.get('draw')}: официальный столб не совпал с corrected tie-break"
    )

records=frozen.get('records',[])

# Для каждого факта новее seed уже существовавший frozen должен быть закрыт.
for d in draws:
    no=int(d['draw'])
    if no<326817:
        continue
    rec=next((r for r in records if int(r.get('target',{}).get('draw',-1))==no),None)
    assert rec is not None, f"Нет frozen-записи для факта №{no}"
    assert rec.get('closed') is True, f"Frozen №{no} не закрыт после появления факта"
    assert int((rec.get('actual') or {}).get('column',0))==int(d['column']), (
        f"Frozen №{no}: записан неправильный факт"
    )
    # У новой архитектуры В1/В2/В3/R1/R2 всегда фиксируются заранее.
    assert len(rec.get('options',[]))==5, f"Frozen №{no}: должно быть 5 вариантов"

# Должен существовать ровно один актуальный открытый frozen на следующий тираж.
open_records=[r for r in records if not r.get('closed')]
assert len(open_records)==1, f"Открытых frozen должно быть 1, сейчас {len(open_records)}"
open_rec=open_records[0]

assert int(open_rec['target']['draw'])==latest_no+1, (
    f"Открытый frozen №{open_rec['target']['draw']} не следует за последним фактом №{latest_no}"
)
assert int(open_rec.get('createdAfterDraw',0))==latest_no, 'Новый frozen создан не после последнего факта'
assert open_rec.get('frozen') is True, 'Текущий прогноз не помечен frozen'
assert len(open_rec.get('options',[]))==5, 'В текущем frozen должно быть В1/В2/В3/R1/R2'
assert len(open_rec.get('ranking',[]))==10, 'Полный рейтинг должен содержать 10 столбов'

labels=[x.get('label') for x in open_rec['options']]
assert labels==['В1','В2','В3','R1','R2'], f"Неверные метки вариантов: {labels}"

ranking_cols=[int(x[0]) for x in open_rec['ranking']]
assert sorted(ranking_cols)==list(range(1,11)), 'В ranking должны присутствовать все столбы 1–10 ровно один раз'

for opt in open_rec['options']:
    assert isinstance(opt.get('score'),int), f"{opt.get('label')}: отсутствует SCORE"
    combo=opt.get('combo')
    assert combo is not None, f"{opt.get('label')}: отсутствует заранее закреплённая комба"
    assert 2<=len(combo)<=10, f"{opt.get('label')}: размер комбы вне 2–10"
    assert int(opt.get('support',0))>=8, f"{opt.get('label')}: support < 8"
    assert int(opt.get('all',0))>=int(opt.get('support',0)), f"{opt.get('label')}: support_ALL ошибочен"
    assert 0<float(opt.get('specificity',-1))<=1, f"{opt.get('label')}: specificity ошибочна"

print(
    f"SELFTEST PASS: seed 20:02 immutable; processed through №{latest_no}; "
    f"open frozen №{open_rec['target']['draw']} {open_rec['target']['time']}"
)
