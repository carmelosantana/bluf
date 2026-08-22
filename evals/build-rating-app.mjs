#!/usr/bin/env node
// Build the standalone blinded-rating web app: inline rating-data.json into a self-contained HTML file
// (no external requests except Google Fonts). Output goes to the scratchpad (it embeds transcripts, so
// it is never committed). Raters open the published artifact, score, and copy their ratings JSON back.

import { readFile, writeFile } from 'node:fs/promises'

const ROOT = new URL('../', import.meta.url)
const rel = p => new URL(p, ROOT).pathname
const data = await readFile(rel('evals/results/phase2b-judge/rating-data.json'), 'utf8')
const OUT = process.argv[2] || '/tmp/claude-1001/-home-carmelo-Projects-Claude-less-chatty/7384f11b-2696-465e-b720-2ace311f1d10/scratchpad/rating-app.html'

const html = `<title>Blinded Answer Review</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap">
<style>
:root{
  --ground:#F7F8FA; --surface:#FFFFFF; --raised:#FFFFFF; --ink:#1C2230; --muted:#616B7C;
  --line:#E3E7EE; --accent:#3A4FB0; --accent-ink:#FFFFFF; --accent-soft:#EAEDFA;
  --good:#2E7D5B; --warn:#B4791F; --warn-soft:#FBF1DC; --code-bg:#F2F4F8; --shadow:0 1px 2px rgba(20,28,50,.06),0 8px 24px rgba(20,28,50,.05);
}
:root:not([data-theme="light"]){ @media (prefers-color-scheme:dark){
  --ground:#0F131A; --surface:#171C26; --raised:#1C2230; --ink:#E7EAF0; --muted:#95A0B2;
  --line:#2A3140; --accent:#8A9BF0; --accent-ink:#0F131A; --accent-soft:#232A46;
  --good:#5FBF93; --warn:#E0A94A; --warn-soft:#2A2415; --code-bg:#12161F; --shadow:0 1px 2px rgba(0,0,0,.3),0 10px 30px rgba(0,0,0,.35);
}}
:root[data-theme="dark"]{
  --ground:#0F131A; --surface:#171C26; --raised:#1C2230; --ink:#E7EAF0; --muted:#95A0B2;
  --line:#2A3140; --accent:#8A9BF0; --accent-ink:#0F131A; --accent-soft:#232A46;
  --good:#5FBF93; --warn:#E0A94A; --warn-soft:#2A2415; --code-bg:#12161F; --shadow:0 1px 2px rgba(0,0,0,.3),0 10px 30px rgba(0,0,0,.35);
}
*{box-sizing:border-box}
body{margin:0;background:var(--ground);color:var(--ink);font-family:"IBM Plex Sans",system-ui,sans-serif;line-height:1.55;-webkit-font-smoothing:antialiased}
.mono{font-family:"IBM Plex Mono",ui-monospace,monospace}
h1,h2,h3{text-wrap:balance;margin:0}
button{font-family:inherit;cursor:pointer}
a{color:var(--accent)}

/* top bar */
.bar{position:sticky;top:0;z-index:20;background:color-mix(in srgb,var(--surface) 88%,transparent);backdrop-filter:blur(8px);border-bottom:1px solid var(--line);display:flex;align-items:center;gap:16px;padding:10px 20px;flex-wrap:wrap}
.bar .title{font-weight:700;letter-spacing:-.01em;font-size:15px;white-space:nowrap}
.bar .who{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--muted)}
.bar input{font:inherit;font-size:13px;padding:5px 9px;border:1px solid var(--line);border-radius:7px;background:var(--raised);color:var(--ink);width:120px}
.bar input:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.prog{flex:1;min-width:140px;display:flex;align-items:center;gap:10px}
.track{flex:1;height:6px;background:var(--line);border-radius:99px;overflow:hidden}
.fill{height:100%;background:var(--accent);width:0;transition:width .3s ease}
.prog .pct{font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap}
.ghost{background:none;border:1px solid var(--line);color:var(--muted);border-radius:7px;padding:6px 10px;font-size:12px}
.ghost:hover{color:var(--ink);border-color:var(--muted)}

.wrap{max-width:900px;margin:0 auto;padding:22px 20px 120px}

/* stepper */
.steps{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 20px}
.dot{width:26px;height:26px;border-radius:7px;border:1px solid var(--line);background:var(--surface);color:var(--muted);font-size:12px;font-weight:600;display:grid;place-items:center;font-variant-numeric:tabular-nums}
.dot.cur{border-color:var(--accent);color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
.dot.done{background:var(--good);border-color:var(--good);color:#fff}

/* question header */
.qhead{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:18px 20px;box-shadow:var(--shadow);position:sticky;top:52px;z-index:10}
.eyebrow{font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:var(--muted);font-weight:600}
.qhead h2{font-size:20px;line-height:1.3;margin:8px 0 0;letter-spacing:-.01em}
.check{margin-top:14px;padding:12px 14px;background:var(--accent-soft);border-radius:10px;font-size:14px}
.check .eyebrow{color:var(--accent)}
.check p{margin:5px 0 0}

.hint{font-size:13px;color:var(--muted);margin:18px 2px 10px}

/* response card */
.resp{background:var(--surface);border:1px solid var(--line);border-radius:14px;margin:12px 0;overflow:hidden;box-shadow:var(--shadow)}
.resp.scored{border-color:color-mix(in srgb,var(--good) 40%,var(--line))}
.resp .rhead{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid var(--line)}
.rlabel{font-family:"IBM Plex Mono",monospace;font-weight:600;font-size:13px;background:var(--code-bg);border:1px solid var(--line);padding:3px 9px;border-radius:7px}
.rhead .tick{margin-left:auto;color:var(--good);font-size:13px;font-weight:600;opacity:0;transition:opacity .2s}
.resp.scored .tick{opacity:1}
.body{max-height:300px;overflow:auto;padding:14px 16px;font-size:14px}
.body.expanded{max-height:none}
.body p{margin:0 0 10px;word-break:break-word}
.body pre{margin:0 0 10px;background:var(--code-bg);border:1px solid var(--line);border-radius:8px;padding:10px 12px;overflow-x:auto;font-family:"IBM Plex Mono",monospace;font-size:12.5px;line-height:1.5;white-space:pre}
.body code{font-family:"IBM Plex Mono",monospace;font-size:.88em;background:var(--code-bg);border:1px solid var(--line);border-radius:5px;padding:1px 5px}
.body pre code{background:none;border:none;padding:0}
.body .mdh{font-size:14px;font-weight:700;margin:12px 0 6px;letter-spacing:-.01em}
.body h1.mdh{font-size:16px}.body h2.mdh{font-size:15px}
.body ul,.body ol{margin:0 0 10px;padding-left:22px}
.body li{margin:2px 0}
.body strong{font-weight:600}
.body a{text-decoration:underline}
.more{display:block;width:100%;text-align:center;padding:7px;font-size:12px;color:var(--accent);background:var(--code-bg);border:none;border-top:1px solid var(--line)}

.controls{display:flex;flex-wrap:wrap;gap:18px;padding:14px 16px;background:var(--raised);border-top:1px solid var(--line)}
.field{display:flex;flex-direction:column;gap:6px}
.field>span{font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:var(--muted);font-weight:600}
.seg{display:flex;gap:4px}
.seg button{width:34px;height:32px;border:1px solid var(--line);background:var(--surface);color:var(--muted);border-radius:8px;font-size:13px;font-weight:600;font-variant-numeric:tabular-nums}
.seg button[aria-pressed="true"]{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}
.seg.pref button{width:auto;padding:0 12px}
.seg button:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.omit{margin-left:auto;display:flex;align-items:center;gap:8px;font-size:13px;align-self:flex-end}
.omit button{border:1px solid var(--line);background:var(--surface);color:var(--muted);border-radius:8px;padding:6px 12px;font-size:12px;font-weight:600}
.omit button[aria-pressed="true"]{background:var(--warn);border-color:var(--warn);color:#fff}

/* preference block */
.prefs{background:var(--surface);border:1px solid var(--line);border-radius:14px;margin:20px 0;padding:16px 18px;box-shadow:var(--shadow)}
.prefs h3{font-size:15px;margin-bottom:4px}
.prefs .sub{font-size:13px;color:var(--muted);margin-bottom:12px}
.prow{display:flex;align-items:center;gap:12px;padding:9px 0;border-top:1px solid var(--line);flex-wrap:wrap}
.prow .plab{font-family:"IBM Plex Mono",monospace;font-size:13px;color:var(--muted);min-width:150px}
.prow .plab b{color:var(--ink)}

/* nav */
.nav{display:flex;gap:12px;margin-top:26px}
.nav button{flex:1;padding:13px;border-radius:11px;border:1px solid var(--line);background:var(--surface);color:var(--ink);font-size:15px;font-weight:600}
.nav .next{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}
.nav button:disabled{opacity:.45;cursor:not-allowed}
.nav button:hover:not(:disabled){border-color:var(--muted)}
.nav .next:hover:not(:disabled){filter:brightness(1.05)}

/* finish */
.finish{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:26px;box-shadow:var(--shadow);text-align:center}
.finish h2{font-size:22px}
.finish p{color:var(--muted);max-width:52ch;margin:10px auto 0;font-size:14.5px}
.copy{margin:22px auto 0;display:inline-flex;align-items:center;gap:9px;padding:14px 26px;border-radius:12px;border:none;background:var(--accent);color:var(--accent-ink);font-size:16px;font-weight:700}
.copy:hover{filter:brightness(1.05)}
.copy.ok{background:var(--good)}
.summ{display:flex;justify-content:center;gap:26px;margin-top:20px;flex-wrap:wrap;font-size:13px;color:var(--muted)}
.summ b{display:block;font-size:24px;color:var(--ink);font-variant-numeric:tabular-nums;font-weight:700}
textarea{width:100%;margin-top:16px;height:120px;border:1px solid var(--line);border-radius:10px;background:var(--code-bg);color:var(--ink);font-family:"IBM Plex Mono",monospace;font-size:12px;padding:12px;resize:vertical}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
@media(max-width:560px){.wrap{padding:16px 14px 120px}.controls{gap:12px}.qhead{position:static}}
</style>

<div class="bar">
  <div class="title">Blinded Answer Review</div>
  <label class="who">Your initials <input id="rater" maxlength="16" placeholder="e.g. CS" autocomplete="off"></label>
  <div class="prog"><div class="track"><div class="fill" id="fill"></div></div><span class="pct" id="pct">0%</span></div>
  <button class="ghost" id="theme">Theme</button>
</div>
<div class="wrap" id="app"></div>

<script id="rating-data" type="application/json">${data.replace(/<\//g, '<\\/')}</script>
<script>
const DATA = JSON.parse(document.getElementById('rating-data').textContent);
const PROMPTS = DATA.prompts;
const KEY = 'bluf-rating-v1';
let state = load();
let step = state.step || 0;

function load(){ try{ return JSON.parse(localStorage.getItem(KEY)) || fresh(); }catch(e){ return fresh(); } }
function fresh(){ const r={rater:'',step:0,ratings:{}}; for(const p of PROMPTS){ r.ratings[p.caseId]={responses:{},preferences:{}}; } return r; }
function save(){ state.step=step; try{ localStorage.setItem(KEY, JSON.stringify(state)); }catch(e){} render(); }

// count scored items: 10 responses (need correctness+completeness+omission) + 5 prefs per prompt
function promptDone(p){ const r=state.ratings[p.caseId]; let n=0; const tot=15;
  for(let i=1;i<=10;i++){ const s=r.responses['R'+i]; if(s&&s.correctness&&s.completeness&&('omission'in s)) n++; }
  for(let i=1;i<=5;i++){ if(r.preferences['P'+i]) n++; }
  return {n,tot}; }
function totalProgress(){ let n=0,tot=0; for(const p of PROMPTS){ const d=promptDone(p); n+=d.n; tot+=d.tot; } return {n,tot}; }

function esc(s){ return String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
// Safe markdown subset (escape FIRST, then structure): headings, bold, italic, inline code, links,
// fenced code, ordered/unordered lists, paragraphs. Never injects HTML from the model text.
function renderBody(src){
  const lines=String(src).replace(/\\r\\n?/g,'\\n').split('\\n');
  const inline=t=>esc(t)
    .replace(/\`([^\`]+)\`/g,(m,c)=>'<code>'+c+'</code>')
    .replace(/\\*\\*([^*]+)\\*\\*/g,'<strong>$1</strong>')
    .replace(/(^|[^*])\\*([^*\\n]+)\\*/g,'$1<em>$2</em>')
    .replace(/\\[([^\\]]+)\\]\\((https?:[^)\\s]+)\\)/g,'<a href="$2" target="_blank" rel="noopener">$1</a>');
  let html='',i=0;
  while(i<lines.length){ const l=lines[i];
    if(/^\\s*\`\`\`/.test(l)){ i++; let code=''; while(i<lines.length&&!/^\\s*\`\`\`/.test(lines[i])){ code+=lines[i]+'\\n'; i++; } i++; html+='<pre>'+esc(code.replace(/\\n$/,''))+'</pre>'; continue; }
    const h=l.match(/^(#{1,6})\\s+(.*)/); if(h){ const n=h[1].length; html+='<h'+n+' class="mdh">'+inline(h[2])+'</h'+n+'>'; i++; continue; }
    if(/^\\s*[-*+]\\s+/.test(l)){ html+='<ul>'; while(i<lines.length&&/^\\s*[-*+]\\s+/.test(lines[i])){ html+='<li>'+inline(lines[i].replace(/^\\s*[-*+]\\s+/,''))+'</li>'; i++; } html+='</ul>'; continue; }
    if(/^\\s*\\d+\\.\\s+/.test(l)){ html+='<ol>'; while(i<lines.length&&/^\\s*\\d+\\.\\s+/.test(lines[i])){ html+='<li>'+inline(lines[i].replace(/^\\s*\\d+\\.\\s+/,''))+'</li>'; i++; } html+='</ol>'; continue; }
    if(l.trim()===''){ i++; continue; }
    let par=l; i++; while(i<lines.length&&lines[i].trim()!==''&&!/^\\s*(#{1,6}\\s|\`\`\`|[-*+]\\s|\\d+\\.\\s)/.test(lines[i])){ par+='\\n'+lines[i]; i++; }
    html+='<p>'+inline(par).replace(/\\n/g,'<br>')+'</p>';
  }
  return html||'<p>'+esc(src)+'</p>'; }

function seg(kind,cid,rid,val){ let h='<div class="seg">'; for(let v=1;v<=5;v++){ h+='<button aria-pressed="'+(val===v)+'" onclick="setScore(\\''+cid+'\\',\\''+rid+'\\',\\''+kind+'\\','+v+')">'+v+'</button>'; } return h+'</div>'; }

window.setScore=(cid,rid,kind,v)=>{ const r=state.ratings[cid].responses; r[rid]=r[rid]||{}; r[rid][kind]=v; save(); };
window.setOmit=(cid,rid)=>{ const r=state.ratings[cid].responses; r[rid]=r[rid]||{}; r[rid].omission=!r[rid].omission; save(); };
window.setPref=(cid,pid,val)=>{ state.ratings[cid].preferences[pid]=val; save(); };
window.toggleBody=(el)=>{ el.previousElementSibling.classList.toggle('expanded'); el.textContent=el.previousElementSibling.classList.contains('expanded')?'Show less':'Show full answer'; };
window.go=(d)=>{ step=Math.max(0,Math.min(PROMPTS.length,step+d)); window.scrollTo(0,0); save(); };
window.jump=(i)=>{ step=i; window.scrollTo(0,0); save(); };

document.getElementById('rater').value=state.rater||'';
document.getElementById('rater').addEventListener('input',e=>{ state.rater=e.target.value.trim(); save(); });
document.getElementById('theme').addEventListener('click',()=>{ const r=document.documentElement; const cur=r.getAttribute('data-theme')|| (matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light'); r.setAttribute('data-theme',cur==='dark'?'light':'dark'); });

function render(){
  const tp=totalProgress(); const pct=Math.round(tp.n/tp.tot*100);
  document.getElementById('fill').style.width=pct+'%'; document.getElementById('pct').textContent=pct+'%';
  const app=document.getElementById('app');
  // stepper
  let steps='<div class="steps">'; for(let i=0;i<PROMPTS.length;i++){ const d=promptDone(PROMPTS[i]); const cls=i===step?'cur':(d.n===d.tot?'done':''); steps+='<button class="dot '+cls+'" onclick="jump('+i+')" title="'+esc(PROMPTS[i].category)+'">'+(i+1)+'</button>'; }
  steps+='<button class="dot '+(step===PROMPTS.length?'cur':'')+'" onclick="jump('+PROMPTS.length+')" title="Finish">✓</button></div>';

  if(step===PROMPTS.length){ app.innerHTML=steps+finishView(tp,pct); return; }
  const p=PROMPTS[step]; const r=state.ratings[p.caseId];
  let h=steps;
  h+='<div class="qhead"><div class="eyebrow">Question '+(step+1)+' of '+PROMPTS.length+' · '+esc(p.category)+'</div><h2>'+esc(p.question)+'</h2>';
  h+='<div class="check"><div class="eyebrow">Reference checklist</div><p>'+esc(p.checklist)+'</p></div></div>';
  h+='<div class="hint">Rate each answer against the checklist only — correctness (facts right), completeness (points covered). Mark <b>omission</b> if it drops a load-bearing item. Do not reward length or penalise brevity.</div>';
  for(let i=1;i<=10;i++){ const rid='R'+i; const s=r.responses[rid]||{}; const done=s.correctness&&s.completeness&&('omission'in s);
    h+='<div class="resp'+(done?' scored':'')+'"><div class="rhead"><span class="rlabel">'+rid+'</span><span class="tick">scored</span></div>';
    h+='<div class="body">'+renderBody(p.responses[rid])+'</div><button class="more" onclick="toggleBody(this)">Show full answer</button>';
    h+='<div class="controls"><div class="field"><span>Correctness</span>'+seg('correctness',p.caseId,rid,s.correctness)+'</div>';
    h+='<div class="field"><span>Completeness</span>'+seg('completeness',p.caseId,rid,s.completeness)+'</div>';
    h+='<div class="omit"><button aria-pressed="'+(!!s.omission)+'" onclick="setOmit(\\''+p.caseId+'\\',\\''+rid+'\\')">Omits load-bearing item</button></div></div></div>';
  }
  // preferences
  h+='<div class="prefs"><h3>Preference pairs</h3><div class="sub">For each pair, which answer better answers the question for a working developer? Ties are fine.</div>';
  for(let i=1;i<=5;i++){ const pid='P'+i; const pr=p.pairs.find(x=>x.label===pid); const val=r.preferences[pid];
    h+='<div class="prow"><span class="plab"><b>'+pid+'</b> · <b>'+pr.a+'</b> vs <b>'+pr.b+'</b></span><div class="seg pref">';
    h+='<button aria-pressed="'+(val==='A')+'" onclick="setPref(\\''+p.caseId+'\\',\\''+pid+'\\',\\'A\\')">'+pr.a+'</button>';
    h+='<button aria-pressed="'+(val==='tie')+'" onclick="setPref(\\''+p.caseId+'\\',\\''+pid+'\\',\\'tie\\')">tie</button>';
    h+='<button aria-pressed="'+(val==='B')+'" onclick="setPref(\\''+p.caseId+'\\',\\''+pid+'\\',\\'B\\')">'+pr.b+'</button></div></div>';
  }
  h+='</div>';
  h+='<div class="nav"><button onclick="go(-1)" '+(step===0?'disabled':'')+'>← Previous</button><button class="next" onclick="go(1)">'+(step===PROMPTS.length-1?'Review & finish':'Next question')+' →</button></div>';
  app.innerHTML=h;
}

function safeName(){ return (state.rater||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,24); }
function buildPayload(){
  const out={rater:state.rater||'anonymous', ratings:{}};
  for(const p of PROMPTS){ const r=state.ratings[p.caseId]; const resp={},pref={};
    for(let i=1;i<=10;i++){ const s=r.responses['R'+i]; if(s&&s.correctness&&s.completeness&&('omission'in s)) resp['R'+i]={correctness:s.correctness,completeness:s.completeness,omission:!!s.omission}; }
    for(let i=1;i<=5;i++){ if(r.preferences['P'+i]) pref['P'+i]={preference:r.preferences['P'+i]}; }
    out.ratings[p.caseId]={responses:resp,preferences:pref};
  }
  return out;
}
function finishView(tp,pct){
  const complete=tp.n===tp.tot; const name=safeName();
  return '<div class="finish"><div class="eyebrow" style="color:var(--accent)">Almost done</div>'+
    '<h2>'+(complete?'All answers rated':'Ratings in progress')+'</h2>'+
    '<div class="summ"><div><b>'+tp.n+'</b>of '+tp.tot+' scored</div><div><b>'+pct+'%</b>complete</div><div><b>'+PROMPTS.length+'</b>questions</div></div>'+
    '<p>'+(complete?'Submit your ratings — they save straight to the study. If submit is unavailable, use “Copy” and paste the text into the Slack thread. Your work stays on this device until you submit or copy.':'You can submit or copy partial ratings now and finish later on this same device (your progress is saved).')+'</p>'+
    (name?'':'<p style="color:var(--warn)"><b>Add your initials in the top bar first</b> so your ratings are attributed.</p>')+
    '<div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-top:6px">'+
    '<button class="copy" id="submitBtn" '+(name?'':'disabled')+' onclick="submitRatings()">Submit ratings</button>'+
    '<button class="copy" id="copyBtn" style="background:var(--surface);color:var(--ink);border:1px solid var(--line)" onclick="copyOut()">Copy instead</button></div>'+
    '<div id="submitMsg" style="margin-top:14px;font-size:13.5px;color:var(--muted)"></div>'+
    '<textarea id="out" readonly placeholder="If you Copy, your ratings JSON appears here."></textarea>'+
    '<p style="font-size:12px">Rater: <b>'+(esc(state.rater||'')||'(none)')+'</b></p></div>';
}

window.copyOut=async()=>{
  const txt=JSON.stringify(buildPayload());
  document.getElementById('out').value=txt;
  try{ await navigator.clipboard.writeText(txt); const b=document.getElementById('copyBtn'); b.textContent='Copied ✓'; setTimeout(()=>{b.textContent='Copy instead';},2200); }
  catch(e){ document.getElementById('out').select(); }
};

window.submitRatings=async()=>{
  const msg=document.getElementById('submitMsg'); const btn=document.getElementById('submitBtn');
  const name=safeName(); if(!name){ msg.textContent='Add your initials first.'; return; }
  btn.disabled=true; btn.textContent='Submitting…'; msg.style.color='var(--muted)'; msg.textContent='Saving your ratings…';
  const payload=buildPayload();
  let art=null; try{ art = window.claude && claude.use ? await claude.use('artifact') : null; }catch(e){ art=null; }
  if(!art){ btn.textContent='Submit ratings'; btn.disabled=false; msg.style.color='var(--warn)';
    msg.innerHTML='Direct submit isn’t available in this view. Click <b>Copy instead</b> and paste your ratings into the Slack thread.'; window.copyOut(); return; }
  try{
    await art.publish({['submissions/'+name+'.json']: JSON.stringify(payload)});
    btn.textContent='Submitted ✓'; btn.classList.add('ok'); msg.style.color='var(--good)';
    msg.innerHTML='<b>Saved.</b> Thank you — you can close this tab. (Re-submitting updates your ratings.)';
  }catch(e){ const code=e&&e.code;
    btn.disabled=false; btn.textContent='Submit ratings';
    if(code==='conflict'){ msg.textContent='Another submission just landed — this view is reloading; press Submit again.'; }
    else if(code==='not_writer'||code==='not_granted'||code==='consent_required'||code==='capability_disabled'){ msg.style.color='var(--warn)'; msg.innerHTML='This shared view is read-only for direct submit. Click <b>Copy instead</b> and paste into Slack.'; window.copyOut(); }
    else if(code==='rate_limited'){ msg.textContent='Saving too fast — wait a moment and press Submit again.'; }
    else { msg.style.color='var(--warn)'; msg.innerHTML='Submit failed ('+(code||'error')+'). Click <b>Copy instead</b> and paste into Slack.'; window.copyOut(); }
  }
};
render();
</script>`

await writeFile(OUT, html)
console.log(`wrote rating app: ${OUT} (${Math.round(html.length / 1024)} KB)`)
