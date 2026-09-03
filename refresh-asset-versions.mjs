'use strict';

import fs from 'node:fs/promises';
import crypto from 'node:crypto';

const INDEX='index.html';
const APP='full20-app.js';
const CSS='style.css';
const SW='sw.js';
const MANIFEST='manifest.webmanifest';

async function read(path){return fs.readFile(path,'utf8')}
async function write(path,text){return fs.writeFile(path,text,'utf8')}
function hashText(text){
  return crypto.createHash('sha256').update(text).digest('hex').slice(0,12);
}
function normalizeIndex(html){
  return html
    .replace(/(\b(?:src|href)=["'](?:full20-app\.js|style\.css|manifest\.webmanifest))\?v=[^"']*/g,'$1')
    .replace(/(['"]\.\/sw\.js)\?v=[^'"]*/g,'$1');
}
function normalizeSW(text){
  return text.replace(/const CACHE='keno-full20-shell-[^']+';/,"const CACHE='keno-full20-shell-HASH';");
}
function normalizeManifest(text){
  try{
    const m=JSON.parse(text);
    m.start_url='./?shell=HASH';
    return JSON.stringify(m);
  }catch{
    return text;
  }
}

let [html,app,css,sw,manifestText]=await Promise.all([
  read(INDEX),read(APP),read(CSS),read(SW),read(MANIFEST)
]);

// One deterministic shell hash. No circular dependency:
// version query strings, SW cache name and manifest start_url are normalized first.
const shellSeed=[
  normalizeIndex(html),
  app,
  css,
  normalizeSW(sw),
  normalizeManifest(manifestText)
].join('\n---FULL20-SHELL---\n');

const shellHash=hashText(shellSeed);

// Update SW cache namespace.
sw=sw.replace(
  /const CACHE='keno-full20-shell-[^']+';/,
  `const CACHE='keno-full20-shell-${shellHash}';`
);
await write(SW,sw);

// Update manifest start_url and then hash the final manifest.
const manifest=JSON.parse(manifestText);
manifest.start_url=`./?shell=${shellHash}`;
manifestText=JSON.stringify(manifest,null,2)+'\n';
await write(MANIFEST,manifestText);

const appHash=hashText(app);
const cssHash=hashText(css);
const swHash=hashText(sw);
const manifestHash=hashText(manifestText);

// Update technical asset versions in index.html.
html=normalizeIndex(html);
html=html.replace(
  /(<script\b[^>]*\bsrc=["'])full20-app\.js(["'][^>]*><\/script>)/i,
  `$1full20-app.js?v=${appHash}$2`
);
html=html.replace(
  /(<link\b[^>]*\bhref=["'])style\.css(["'][^>]*>)/i,
  `$1style.css?v=${cssHash}$2`
);
html=html.replace(
  /(<link\b[^>]*\brel=["']manifest["'][^>]*\bhref=["'])manifest\.webmanifest(["'][^>]*>)/i,
  `$1manifest.webmanifest?v=${manifestHash}$2`
);
// Handle href before rel as well.
html=html.replace(
  /(<link\b[^>]*\bhref=["'])manifest\.webmanifest(["'][^>]*\brel=["']manifest["'][^>]*>)/i,
  `$1manifest.webmanifest?v=${manifestHash}$2`
);
html=html.replace(
  /(['"]\.\/sw\.js)(['"])/g,
  `$1?v=${swHash}$2`
);

await write(INDEX,html);

console.log(`PASS shell=${shellHash}`);
console.log(`  full20-app.js -> ${appHash}`);
console.log(`  style.css -> ${cssHash}`);
console.log(`  sw.js(register) -> ${swHash}`);
console.log(`  manifest -> ${manifestHash}`);
