import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(root + p, "utf8");
const protocol = read("packages/capture-links/src/protocol.mjs").replaceAll(
  "export ",
  "",
);
const source = read("apps/client-link/app.js").replace(/^import[^\n]+\n/, "");
const fixture = `
// Isolated visual preview: no server, SMS or media transmission.
const previewPhotos={};
window.fetch=async(path,options={})=>{
 let result={ok:true};
 if(options.method==='DELETE')delete previewPhotos[path.split('/').at(-1)];
 else if(path.endsWith('/complete')){const input=JSON.parse(options.body);result.receipt={requestId:'preview-receipt',photoCount:input.slots.length,receivedAt:new Date().toISOString()};}
 else if(!options.method)result={state:'valid',protocolId:'flo-bilateral-v2',uploads:{},localPrototype:true};
 return {ok:true,json:async()=>result};
};
window.XMLHttpRequest=class {
 constructor(){this.upload={};}open(method,url){this.slot=url.split('/').at(-1);}setRequestHeader(){}
 send(blob){previewPhotos[this.slot]=blob;this.status=200;this.responseText=JSON.stringify({photo:{id:'preview',mimeType:blob.type,size:blob.size}});queueMicrotask(()=>this.onload());}
};
`;
const sampleControls = `
const previewMenu=document.createElement('div');previewMenu.className='preview-menu';
previewMenu.innerHTML='<strong>VISUAL PREVIEW · No uploads or SMS</strong><button id="preview-welcome">Welcome</button><button id="preview-camera">Camera step</button><button id="preview-extras">Extras</button><button id="preview-review">Review</button><button id="preview-receipt">Receipt</button>';
document.body.prepend(previewMenu);
const sample='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 130 190"><rect width="130" height="190" fill="#edf4fd"/><path d="M44 170c-12-2-18-13-18-25 0-22 6-32 6-53 0-18-8-29-3-50 3-12 9-14 14-10 3-17 16-23 23-10 8-13 18-12 22 1 9-6 17 1 17 11 10 0 13 10 10 18-4 11-11 19-18 27-11 13-14 29-13 48 1 24-7 43-23 45z" fill="#d7e7fc" stroke="#7399cb" stroke-width="2"/><text x="65" y="184" text-anchor="middle" font-size="7" fill="#54759e">SAMPLE ILLUSTRATION</text></svg>');
function seed(){for(const s of CAPTURE_STEPS)state.photos.set(s.id,{url:sample,status:'ready',meta:{id:'preview'}});}
document.querySelector('#preview-welcome').onclick=()=>{state.photos.clear();navigate('welcome');};
document.querySelector('#preview-camera').onclick=()=>{state.photos.clear();navigate('capture',0);};
document.querySelector('#preview-extras').onclick=()=>{seed();navigate('extras');};
document.querySelector('#preview-review').onclick=()=>{seed();navigate('review');};
document.querySelector('#preview-receipt').onclick=()=>{state.receipt={requestId:'preview-receipt',photoCount:6,receivedAt:new Date().toISOString()};navigate('complete');};
`;
const css =
  read("apps/client-link/styles.css") +
  "\n.preview-menu{display:flex;gap:8px;align-items:center;justify-content:center;flex-wrap:wrap;background:#d6f6e9;padding:12px;font-size:11px}.preview-menu button{border:1px solid #a9cfbc;background:white;border-radius:8px;padding:8px;color:#235e49;font-size:11px}";
const html = read("apps/client-link/index.html")
  .replace(
    '<link rel="stylesheet" href="/client/styles.css">',
    `<style>${css}</style>`,
  )
  .replace(
    '<script type="module" src="/client/app.js"></script>',
    `<script type="module">${protocol}\n${fixture}\n${source}\n${sampleControls}</script>`,
  )
  .replace(
    "LOCAL PROTOTYPE · Use test photos",
    "VISUAL PREVIEW · All receipts are simulated",
  );
mkdirSync(root + "docs/preview", { recursive: true });
writeFileSync(root + "docs/preview/flo-time.html", html);
console.log("Built docs/preview/flo-time.html from the actual client source.");
