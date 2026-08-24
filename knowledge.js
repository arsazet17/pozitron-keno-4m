(function(){
  'use strict';
  function esc(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
  function balls(values){return (values||[]).map(v=>`<span class="kb-ball">${esc(v)}</span>`).join('');}
  function injectStyles(){
    const s=document.createElement('style');
    s.textContent=`
      .kb-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
      .kb-panel{padding:14px;border-radius:16px;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.08)}
      .kb-label{font-size:11px;opacity:.65;text-transform:uppercase;letter-spacing:.08em}
      .kb-value{font-size:22px;font-weight:800;margin-top:5px}
      .kb-balls{display:flex;flex-wrap:wrap;gap:7px;margin-top:8px}
      .kb-ball{width:36px;height:36px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-weight:900;background:rgba(72,190,255,.14);border:1px solid rgba(72,190,255,.42)}
      .kb-repeats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:10px}
      .kb-repeat{padding:9px;border-radius:12px;background:rgba(255,255,255,.035);text-align:center;font-weight:800}
      .kb-frozen{margin-top:10px;padding:10px 12px;border-radius:12px;background:rgba(90,220,130,.09);border:1px solid rgba(90,220,130,.25);font-size:12px}
      .kb-stale{background:rgba(255,180,70,.08);border-color:rgba(255,180,70,.25)}
      @media(max-width:560px){.kb-grid{grid-template-columns:1fr}.kb-repeats{grid-template-columns:repeat(2,minmax(0,1fr))}}
    `;
    document.head.appendChild(s);
  }
  async function getState(){
    const r=await fetch(`data/current_state.json?_=${Date.now()}`,{cache:'no-store'});
    if(!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }
  function targetTime(){
    return document.getElementById('targetTime')?.textContent?.trim()||'';
  }
  function render(st){
    const home=document.querySelector('[data-page="home"]');
    if(!home) return;
    let card=document.getElementById('knowledgeLayerCard');
    if(!card){
      card=document.createElement('section');
      card.id='knowledgeLayerCard';
      card.className='card';
      const anchor=document.querySelector('.scanner-card')||home.querySelector('.time-card');
      if(anchor) anchor.insertAdjacentElement('afterend',card); else home.appendChild(card);
    }
    const n=st?.next||{};
    const active=targetTime()===String(n.time||'');
    const repeats=n.repeats||{};
    card.innerHTML=`
      <div class="title-row"><div><div class="eyebrow gold">НОВАЯ БАЗА ЗНАНИЙ</div><h2>Frozen · Повторы · Matrix · Shift</h2></div><span class="pill cyan">STRICT</span></div>
      <div class="kb-grid">
        <div class="kb-panel"><div class="kb-label">Frozen V1</div><div class="kb-balls">${balls(n.V1)}</div><div class="small muted">Главный: <b>${esc(n.main??'—')}</b> · V2: <b>${esc(n.V2??'—')}</b> · Г→Г: <b>${esc(n.GG??'—')}</b></div></div>
        <div class="kb-panel"><div class="kb-label">Отдельные слои</div><div class="kb-value">🧩 ${esc(n.matrix??'—')} &nbsp; 🔄 ${esc(n.shift??'—')}</div><div class="small muted">${esc(n.shift_regime||'')}</div></div>
      </div>
      <div class="kb-repeats">${Object.entries(repeats).map(([k,v])=>`<div class="kb-repeat">${esc(k)} ${esc(v)}</div>`).join('')}</div>
      <div class="kb-frozen ${active?'':'kb-stale'}">${active
        ? `✅ Предтиражный frozen на ${esc(n.time)} загружен ДО факта. Задним числом не пересчитывается.`
        : `ℹ️ Импортированный frozen относится к ${esc(n.time||'—')}; для другого тиража он не считается прогнозом.`}</div>
    `;
  }
  injectStyles();
  getState().then(render).catch(e=>console.warn('knowledge layer',e));
  setInterval(()=>getState().then(render).catch(()=>{}),30000);
})();
