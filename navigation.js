(function(){
  const order=['home','stats','archive','settings'];
  const pages=[...document.querySelectorAll('.page')];
  const buttons=[...document.querySelectorAll('.nav-btn')];
  function go(name){
    if(!order.includes(name)) return;
    pages.forEach(p=>p.classList.toggle('active',p.dataset.page===name));
    buttons.forEach(b=>b.classList.toggle('active',b.dataset.target===name));
    history.replaceState(null,'','#'+name);
    scrollTo({top:0,behavior:'smooth'});
  }
  buttons.forEach(b=>b.addEventListener('click',()=>go(b.dataset.target)));
  const initial=location.hash.slice(1); if(order.includes(initial)) go(initial);
  const holder=document.getElementById('pages'); let sx=0,sy=0;
  holder.addEventListener('touchstart',e=>{if(e.touches.length===1){sx=e.touches[0].clientX;sy=e.touches[0].clientY;}},{passive:true});
  holder.addEventListener('touchend',e=>{if(!e.changedTouches.length)return;const dx=e.changedTouches[0].clientX-sx,dy=e.changedTouches[0].clientY-sy;if(Math.abs(dx)<70||Math.abs(dx)<Math.abs(dy)*1.4)return;const cur=document.querySelector('.page.active')?.dataset.page||'home';let i=order.indexOf(cur);if(dx<0&&i<order.length-1)i++;if(dx>0&&i>0)i--;go(order[i]);},{passive:true});
  const schedule=window.KenoEngine?.SCHEDULE||[];
  const box=document.getElementById('scheduleList'); if(box) box.innerHTML=schedule.map(t=>`<span class="chip">${t}</span>`).join('');
  window.Keno4MNav={go};
})();
