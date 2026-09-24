'use strict';

(() => {
  // FULL20 v1.0.7 — активное автообновление экрана без постоянной перерисовки.
  // Данные остаются официальными серверными JSON из GitHub main.
  const POLL_MS = 8000;
  let probing = false;
  let lastRemoteSignature = '';

  function localSignature(){
    try{
      const m = DATA?.meta || {};
      return [m?.latestDraw?.draw || DATA?.draws?.at?.(-1)?.draw || '', m?.nextFrozen?.draw || '', m?.updatedAt || ''].join('|');
    }catch{
      return '';
    }
  }

  function remoteSignature(meta){
    return [meta?.latestDraw?.draw || '', meta?.nextFrozen?.draw || '', meta?.updatedAt || ''].join('|');
  }

  function activePage(){
    return document.querySelector('.page.active')?.dataset?.page || 'home';
  }

  async function probe(reason='timer', force=false){
    if(probing) return;
    if(document.hidden && !force) return;
    probing = true;

    try{
      const meta = await j('data/full20_meta.json');
      const remoteSig = remoteSignature(meta);
      const localSig = localSignature();

      if(!lastRemoteSignature) lastRemoteSignature = remoteSig;

      // Перерисовываем ТОЛЬКО если на сервере реально появился новый факт
      // или новый frozen. Обычный опрос раз в 8 секунд экран не трогает.
      if(remoteSig && remoteSig !== localSig){
        const beforeDraw = Number(DATA?.draws?.at?.(-1)?.draw || 0);
        const scrollY = window.scrollY;
        const page = activePage();

        await loadAll();

        const afterDraw = Number(DATA?.draws?.at?.(-1)?.draw || 0);
        lastRemoteSignature = localSignature();

        // На внутренних экранах сохраняем позицию, чтобы автообновление
        // не бросало пользователя вверх страницы.
        if(page !== 'home'){
          requestAnimationFrame(() => window.scrollTo({top:scrollY,left:0,behavior:'auto'}));
        }

        if(afterDraw && afterDraw !== beforeDraw){
          toast(`Новый тираж №${afterDraw} · прогноз обновлён`);
        }
      }else{
        lastRemoteSignature = remoteSig || lastRemoteSignature;
      }
    }catch(e){
      // Временный обрыв сети не ломает текущий экран и не стирает данные.
      console.warn('FULL20 live refresh:', reason, e);
    }finally{
      probing = false;
    }
  }

  // Пока приложение открыто — тихая проверка каждые 8 секунд.
  setInterval(() => probe('timer', false), POLL_MS);

  // После возврата в приложение обновляемся сразу, не ждём таймера.
  document.addEventListener('visibilitychange', () => {
    if(!document.hidden) probe('visible', true);
  });
  window.addEventListener('focus', () => probe('focus', true));
  window.addEventListener('online', () => probe('online', true));
  window.addEventListener('pageshow', () => probe('pageshow', true));

  // Контроль после первоначальной загрузки приложения.
  setTimeout(() => probe('startup', true), 1500);

  window.FULL20LiveRefresh = {
    probe: () => probe('manual-api', true),
    intervalMs: POLL_MS
  };
})();
