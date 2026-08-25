'use strict';
const fs=require('fs');
require('../engine.js');
const E=globalThis.KenoEngine;

const archivePath='data/archive.json';
const metaPath='data/last_sync.json';
const outPath='data/frozen_records.json';

function readJSON(p,fallback){
  try{return JSON.parse(fs.readFileSync(p,'utf8'))}catch(_){return fallback}
}
function writeJSON(p,v){fs.writeFileSync(p,JSON.stringify(v,null,2)+'\n','utf8')}
function key(r){return `${r.date}|${r.time}`}
function actualAt(matrix,date,time){
  const hm=E.headerMap(matrix),c=hm[time];
  if(c==null)return null;
  const r=matrix.findIndex((x,i)=>i>0&&String(x?.[0])===String(date));
  return r<1?null:E.val(matrix[r][c]);
}

const archive=readJSON(archivePath,{rows:[]});
if(!Array.isArray(archive.rows)||archive.rows.length<3) throw new Error('archive.json invalid');
const matrix=E.cloneMatrix(archive.rows);
const meta=readJSON(metaPath,{});
const store=readJSON(outPath,{version:1,storage:'github-repository',updatedAt:null,records:[]});
const records=Array.isArray(store.records)?store.records:[];

// Закрываем только уже существовавшие frozen, когда факт появился в официальном архиве.
for(const r of records){
  if(!r || !r.frozenAt || !Array.isArray(r.v1)) continue;
  if(r.actual!=null) continue;
  const a=actualAt(matrix,r.date,r.time);
  if(a==null) continue;
  r.actual=a;
  r.hitV1=r.v1.includes(a);
  r.hitConsensus=r.consensus!=null && r.consensus===a;
  r.closedAt=new Date().toISOString();
}

// Создаём frozen только на следующий ещё пустой тираж.
const target=E.nextTarget(matrix);
const k=`${target.date}|${target.time}`;
let current=records.find(r=>key(r)===k);
if(!current){
  const f=E.predict(matrix,target);
  const latestDraw=Number(meta?.latestOfficial?.draw);
  current={
    draw:Number.isFinite(latestDraw)?latestDraw+1:null,
    date:target.date,
    time:target.time,
    v1:[...f.v1.values],
    v2:f.v2.value,
    gg:f.gg.value,
    consensus:f.consensus,
    scanner:[...(f.scanner||[])],
    vChain:[...f.vChain],
    hChain:[...f.hChain],
    methodDepths:Object.fromEntries(Object.entries(f.methods).map(([n,m])=>[n,m.usedLen])),
    actual:null,
    frozenAt:new Date().toISOString(),
    frozen:true,
    storage:'github-repository'
  };
  records.push(current);
}

records.sort((a,b)=>E.parseDate(a.date)-E.parseDate(b.date)||E.SCHEDULE.indexOf(a.time)-E.SCHEDULE.indexOf(b.time));
writeJSON(outPath,{
  version:1,
  storage:'github-repository',
  updatedAt:new Date().toISOString(),
  latestTarget:{date:target.date,time:target.time,draw:current.draw},
  records
});
console.log(`frozen records=${records.length}; target=${target.date} ${target.time}`);
