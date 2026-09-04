const fs = require('fs');
const cp = require('child_process');

function read(path){ return fs.readFileSync(path,'utf8'); }
function write(path,text){ fs.writeFileSync(path,text,'utf8'); }

function replaceOnce(text, oldText, newText, label){
  const n = text.split(oldText).length - 1;
  if(n !== 1){
    throw new Error(`${label}: ожидалось 1 совпадение, найдено ${n}`);
  }
  return text.replace(oldText,newText);
}

// 1) Архив прогнозов: после времени показываем ФАКТИЧЕСКИЙ вышедший столб.
let app = read('full20-app.js');

const oldHistory =
  '<div class="dh-title">№${r.target.draw} · ${r.target.time}</div>';

const newHistory =
  '<div class="dh-title">№${r.target.draw} · ${r.target.time} · ст${r.actual?.column??\'—\'}</div>';

app = replaceOnce(
  app,
  oldHistory,
  newHistory,
  'history actual column'
);

write('full20-app.js',app);

// 2) Видимая версия приложения.
let html = read('index.html');
const beforeVersion = (html.match(/v1\.0\.5/g) || []).length;
if(beforeVersion < 2){
  throw new Error(`index version: ожидалось минимум 2 v1.0.5, найдено ${beforeVersion}`);
}
html = html.replace(/v1\.0\.5/g,'v1.0.6');
write('index.html',html);

// 3) Технические SHA по M5M-архитектуре.
cp.execFileSync('node',['refresh-asset-versions.mjs'],{stdio:'inherit'});

// 4) Финальная проверка.
cp.execFileSync('node',['--check','full20-app.js'],{stdio:'inherit'});
cp.execFileSync('node',['--check','sw.js'],{stdio:'inherit'});

const finalApp = read('full20-app.js');
const finalIndex = read('index.html');

if(!finalApp.includes(
  '<div class="dh-title">№${r.target.draw} · ${r.target.time} · ст${r.actual?.column??\'—\'}</div>'
)){
  throw new Error('Фактический столб не установлен в заголовок истории');
}

if(!finalIndex.includes('v1.0.6')){
  throw new Error('Версия v1.0.6 не установлена');
}

if(!/full20-app\.js\?v=[0-9a-f]{12}/.test(finalIndex)){
  throw new Error('M5M SHA для full20-app.js не обновился');
}

console.log('PASS: history = №... · TIME · стФАКТ');
console.log('PASS: visible version = v1.0.6');
console.log('PASS: M5M asset SHA refreshed');
