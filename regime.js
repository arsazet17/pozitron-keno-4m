(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  function val(x){const n=Number(x);return Number.isInteger(n)&&n>=1&&n<=10?n:null}
  function v1(){return [...document.querySelectorAll('#v1Balls .ball')].map(x=>val(x.textContent)).filter(Boolean)}
  async function render(){
    const box=$('recentRegime'); if(!box) return;
    try{
      const r=await fetch(`data/archive.json?_regime=${Date.now()}`,{cache:'no-store'});
      const j=await r.json(), rows=j.rows, E=window.KenoEngine, hm=E.headerMap(rows);
      const seq=[];
      for(let ri=1;ri<rows.length;ri++){
        for(const t of E.SCHEDULE){
          const c=hm[t]; if(c==null)continue;
          const n=val(rows[ri]?.[c]); if(n!=null)seq.push(n);
        }
      }
      const last=seq.slice(-12), counts={};
      last.forEach(n=>counts[n]=(counts[n]||0)+1);
      const hot=Object.entries(counts).sort((a,b)=>b[1]-a[1]||a[0]-b[0]).slice(0,3).map(x=>Number(x[0]));
      const main=v1(), overlap=main.filter(n=>hot.includes(n));
      const state=overlap.length>=2?'🟢 режим согласован':overlap.length===1?'🟡 частичное согласование':'🔴 расхождение с текущим режимом';
      box.innerHTML=`<div class="detail-line"><b>Последние 12:</b> ${last.join(' · ')||'—'}</div>
        <div class="detail-line"><b>Активные столбы режима:</b> ${hot.join(' · ')||'—'}</div>
        <div class="detail-line"><b>${state}</b></div>
        <div class="small muted">Это отдельный контрольный слой. Основной В1 не переписывается.</div>`;
    }catch(e){box.innerHTML='<div class="scanner-empty">Режим последних тиражей временно недоступен.</div>'}
  }
  const obs=new MutationObserver(render);
  const n=$('v1Balls'); if(n)obs.observe(n,{childList:true,subtree:true});
  render(); setInterval(render,30000);
})();
