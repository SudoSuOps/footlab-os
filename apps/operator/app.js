const views = {
  today:{title:"Today",subtitle:"Exceptions first. Every item has an owner and a next step.",render:renderToday},
  review:{title:"Needs Review",subtitle:"Only work that crossed a configured human-review threshold.",render:()=>renderQueue("Review queue",reviewItems)},
  clients:{title:"Clients",subtitle:"Longitudinal monitoring at a glance — not another charting maze.",render:()=>renderQueue("Active clients",clientItems)},
  flights:{title:"Flights",subtitle:"The operating story generated from canonical timeline events.",render:()=>renderQueue("Recent Flight Sheets",flightItems)},
  manufacturing:{title:"Manufacturing",subtitle:"Requirement to delivery, with every version traceable to its source.",render:()=>renderQueue("Active manufacturing",manufacturingItems)},
  edge:{title:"Edge",subtitle:"Local trust anchor, appliance health, and consent-aware movement of data.",render:renderEdge}
};

const reviewItems=[
 ["Client F-018","Change flagged · left plantar","Clinical review","18 min"],
 ["Client F-004","Capture + reported discomfort","Operator","41 min"],
 ["Client F-027","Image comparison uncertain","Clinical review","1 h 06"]
];
const clientItems=[
 ["Client F-018","Weekly · last capture today","1 open action","V003"],
 ["Client F-021","Weekly · due tomorrow","No open actions","V001"],
 ["Client F-027","2× weekly · captured today","1 open action","—"]
];
const flightItems=[
 ["FLIGHT-F018","Capture → review","Updated 18 min ago","13 events"],
 ["FLIGHT-F004","Wear feedback → adjustment","Updated 41 min ago","28 events"],
 ["FLIGHT-F021","Monitoring","Updated yesterday","19 events"]
];
const manufacturingItems=[
 ["REQ-104","F-004 · adjustment","Design","V004"],
 ["REQ-108","F-031 · initial insert","Fabrication","V001"],
 ["REQ-109","F-012 · fit revision","QA","V002"],
 ["REQ-110","F-018 · review pending","Blocked","—"]
];

function renderToday(){
 return `
 <div class="notice">FootLabOS is a coordination and manufacturing system. Model output is advisory; routed items remain human-owned.</div>
 <div class="stats">
  ${stat("Captures due","8","5 completed · 3 remaining")}
  ${stat("Needs review","3","Oldest waiting 1 h 06")}
  ${stat("Manufacturing","4","1 blocked by review")}
  ${stat("Edge","Healthy","Vault + queues nominal")}
 </div>
 <div class="grid">
  <section class="panel table-panel"><div class="panel-head"><h2>Needs attention</h2><span>Ordered by operational urgency</span></div>${reviewItems.map(row).join("")}</section>
  <section class="panel"><div class="panel-head"><h2>Next actions</h2><span>Today</span></div><div class="action-list">
   ${action("Review F-018","Compare the current capture against the selected baseline and record human disposition.")}
   ${action("Close QA for REQ-109","Fabrication finished. QA is the remaining step before delivery scheduling.")}
   ${action("3 capture reminders","Three clients have not completed today's requested capture.")}
  </div></section>
 </div>`;
}

function renderQueue(name,items){
 return `<section class="panel table-panel"><div class="panel-head"><h2>${name}</h2><span>${items.length} shown</span></div>${items.map(row).join("")}</section>`;
}
function renderEdge(){
 return `<div class="stats">
 ${stat("Appliance","EDGE-001","Local trust anchor")}
 ${stat("Vault","OK","Integrity check passed")}
 ${stat("Inference queue","2","No stalled jobs")}
 ${stat("Backup","OK","Last checkpoint 07:42")}
 </div><section class="panel"><div class="panel-head"><h2>Trust controls</h2><span>No client content leaves by default</span></div><div class="action-list">
 ${action("Local system of record","Client media, events, Flight Sheets, and manufacturing lineage are stored on the assigned appliance in V1.")}
 ${action("Consent-aware export","External sharing must have an explicit purpose, recipient scope, and auditable consent state.")}
 ${action("Model inventory","Every model-assisted observation records the model version used.")}
 </div></section>`;
}
function stat(label,value,hint){return `<div class="stat"><div class="label">${label}</div><div class="value">${value}</div><div class="hint">${hint}</div></div>`;}
function row(values){const[a,b,c,d]=values;const attention=/review|blocked|discomfort|uncertain/i.test(`${b} ${c}`);return `<div class="row"><div class="person"><strong>${a}</strong><span>${b}</span></div><span class="badge ${attention?"attn":"good"}">${c}</span><span class="owner">${d}</span></div>`;}
function action(title,body){return `<div class="action"><strong>${title}</strong><p>${body}</p></div>`;}

const nav=document.querySelector("#nav"),title=document.querySelector("#title"),subtitle=document.querySelector("#subtitle"),view=document.querySelector("#view");
function show(key){const selected=views[key];title.textContent=selected.title;subtitle.textContent=selected.subtitle;view.innerHTML=selected.render();document.querySelectorAll(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.view===key));}
nav.addEventListener("click",e=>{const b=e.target.closest("[data-view]");if(b)show(b.dataset.view);});
show("today");
