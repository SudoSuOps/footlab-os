import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
const root = fileURLToPath(new URL("../", import.meta.url));
const read = (path) => readFileSync(root + path, "utf8");
const protocol = read("packages/capture-links/src/protocol.mjs").replaceAll("export ", "");
let source = read("apps/client-link/app.js").replace(/^import[\s\S]*?;\s*/, "");
const replace = (pattern, value) => {
  const changed = source.replace(pattern, value);
  if (changed === source) throw new Error("Client changed: review public-demo adaptation before building");
  source = changed;
};
replace(/function bindFile\(inputId, slot\) \{[\s\S]*?\n\}\nfunction upload/, `function bindFile(inputId, slot) {
  document.getElementById(inputId).onclick = () => {
    state.photos.set(slot, { url: demoSample, status: 'ready', meta: { id: 'sample', mimeType: 'image/svg+xml', size: 0 } });
    render();
  };
}
function upload`);
replace(/function fileControl\(id, label\) \{[\s\S]*?\n\}\nfunction photoStatus/, `function fileControl(id, label) {
  return '<button class="secondary" id="'+id+'">Use sample image</button>';
}
function photoStatus`);
for (const [before, after] of [
  ["LOCAL PROTOTYPE · Use test photos", "PUBLIC DEMO · Sample images only"],
  ["✓ Photo received", "✓ Sample ready"],
  ["Check-in received", "Demo complete"],
  ["Upload complete", "Simulated receipt"],
  ["This test receipt confirms storage, not clinical review or clearance.", "Nothing was uploaded or saved. This is a sample-only demonstration."],
  ["Your check-in is a conversation with your care team.", "Try the FLO experience with sample images."],
]) source = source.replaceAll(before, after);
replace('have been saved to ${state.info?.privatePilot ? "your private FLO vault" : "the local FLO prototype"}', "were used in this demonstration. Nothing was uploaded");
replace('${state.info?.privatePilot ? "Your photos stay in your private FLO vault. This pilot does not notify a care team." : "Your photos go to this local prototype vault. This test does not notify a care team."}', 'Sample images only. Your answers stay in this browser until you close or reload the page. Nothing is sent to FootLab.');
replace('`Send my ${state.photos.size} photos →`', '`Finish ${state.photos.size}-image demo →`');
const mock = `
const demoSample='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="300" height="300" rx="30" fill="#dff0ce"/><path d="M120 250c-45-15-40-65-30-100 8-28-7-55 7-80 10-18 24-12 25 0 15-40 45-35 43-8 22-20 40-2 29 22 28-3 25 22 10 39-28 30-30 68-32 89-2 30-20 43-52 38z" fill="#b6ff67" stroke="#355823" stroke-width="4"/><text x="150" y="284" text-anchor="middle" font-family="sans-serif" font-size="16" fill="#355823">FLO SAMPLE</text></svg>');
window.fetch=async(path,options={})=>({ok:true,json:async()=>path.endsWith('/complete') ? {ok:true,receipt:{requestId:'DEMO-SIMULATED',photoCount:JSON.parse(options.body).slots.length,receivedAt:new Date().toISOString()}} : options.method ? {ok:true} : {state:'valid',protocolId:'flo-bilateral-v2',uploads:{},localPrototype:true}});
window.XMLHttpRequest=class{constructor(){throw new Error('Uploads are disabled in this demo');}};
`;
const js = protocol + "\n" + mock + "\n" + source;
const hash = createHash("sha256").update(js).digest("base64");
const css = read("apps/client-link/styles.css");
const html = read("apps/client-link/index.html")
  .replace(/<link\s+rel="stylesheet"\s+href="\/client\/styles\.css"\s*\/?>/, `<style>${css}</style>`)
  .replace('<script type="module" src="/client/app.js"></script>', `<script type="module">${js}</script>`)
  .replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-${hash}'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'">`)
  .replace("FLO · Checking your link…", "PUBLIC DEMO · Sample images only");
if (/type="file"/.test(html.match(/<body>[\s\S]*?<script/)?.[0] ?? "")) throw new Error("Public demo must not offer file selection");
mkdirSync(root + "docs/preview", { recursive: true });
writeFileSync(root + "docs/preview/flo-public-demo.html", html);
console.log("Built sample-only public FLO demo. No server, uploads, vault access or real receipt.");
