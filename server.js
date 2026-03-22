const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
require('dotenv').config();

const TOKEN = process.env.LINE_CHANNEL_TOKEN;
const BOSS = process.env.BOSS_LINE_USER_ID;
const SEC = process.env.SECRETARY_LINE_USER_ID;
const PORT = process.env.PORT || 3000;

let tasks = [];
const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

async function pushLine(to, text) {
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + TOKEN },
    body: JSON.stringify({ to, messages: [{ type: 'text', text }] }),
  });
  if (!res.ok) console.error('LINE error:', await res.text());
  return res.ok;
}

async function replyLine(replyToken, text) {
  await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + TOKEN },
    body: JSON.stringify({ replyToken, messages: [{ type: 'text', text }] }),
  });
}

function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function fmtDate() { return new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }); }

// ========== WEB UI ==========
app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Boss Task Manager</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Noto Sans Thai',Sarabun,-apple-system,sans-serif;background:linear-gradient(160deg,#F8FAFC,#EEF2FF,#F0FDF4);min-height:100vh}
.hdr{background:linear-gradient(135deg,#1E293B,#334155,#1E293B);padding:20px 16px 16px;color:#fff;border-radius:0 0 24px 24px}
.hdr h1{font-size:19px;font-weight:900;background:linear-gradient(90deg,#fff,#A5F3FC);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.hdr p{font-size:11px;color:#94A3B8;margin-top:2px}
.live{display:flex;align-items:center;gap:6px;margin-top:8px}
.live-dot{width:8px;height:8px;border-radius:4px;background:#06C755;box-shadow:0 0 6px rgba(6,199,85,.6)}
.live span{font-size:11px;color:#06C755;font-weight:600}
.stats{display:flex;gap:6px;margin-top:10px}
.stat{flex:1;padding:8px 4px;border-radius:10px;background:rgba(255,255,255,.08);text-align:center}
.stat b{display:block;font-size:17px;font-weight:900}
.stat small{font-size:9px;color:#94A3B8}
.wrap{max-width:560px;margin:0 auto;padding:12px 16px 100px}
.info{display:flex;align-items:center;gap:6px;padding:8px 12px;border-radius:10px;margin-bottom:10px;font-size:11px;font-weight:600}
.card{background:#fff;border-radius:14px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,.05);margin-bottom:10px}
.card.done{opacity:.55}
.card-head{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-bottom:5px}
.card-head .title{font-size:14px;font-weight:700;color:#1E293B}
.card.done .title{color:#94A3B8;text-decoration:line-through}
.badge{padding:2px 9px;border-radius:16px;font-size:10px;font-weight:600}
.detail{font-size:12px;color:#64748B;line-height:1.5;margin-top:3px}
.meta{display:flex;gap:12px;margin-top:6px;flex-wrap:wrap;font-size:11px;color:#94A3B8}
.reply-box{margin-top:8px;padding:8px 12px;border-radius:8px;background:#ECFDF5;border:1px solid #A7F3D0;font-size:12px;color:#065F46}
.btn{padding:10px 18px;border-radius:12px;border:none;font-size:14px;font-weight:700;cursor:pointer;width:100%}
.btn-green{background:#06C755;color:#fff}
.btn-blue{background:#3B82F6;color:#fff}
.btn-purple{background:#8B5CF6;color:#fff}
.btn-amber{background:#F59E0B;color:#fff}
.btn:disabled{background:#CBD5E1;cursor:not-allowed}
.fab{position:fixed;bottom:22px;right:22px;width:54px;height:54px;border-radius:16px;background:linear-gradient(135deg,#06C755,#05A847);color:#fff;border:none;font-size:24px;box-shadow:0 6px 20px rgba(6,199,85,.4);cursor:pointer;z-index:100;display:flex;align-items:center;justify-content:center}
.modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;z-index:1000;padding:16px}
.modal{background:#fff;border-radius:20px;padding:24px;max-width:480px;width:100%;max-height:90vh;overflow-y:auto}
.modal h3{font-size:17px;font-weight:800;color:#1E293B;margin-bottom:16px}
.field label{font-size:12px;font-weight:600;color:#64748B;display:block;margin-bottom:4px}
.field{margin-bottom:10px}
.field input,.field textarea,.field select{width:100%;padding:10px 14px;border-radius:10px;border:1.5px solid #E2E8F0;font-size:14px;color:#1E293B;outline:none;background:#FAFBFC;font-family:inherit}
.field textarea{resize:vertical}
.cat-btns{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:12px}
.cat-btn{padding:6px 12px;border-radius:8px;border:2px solid #E2E8F0;background:#fff;font-size:12px;font-weight:600;cursor:pointer}
.cat-btn.active{border-color:var(--cc);background:var(--bg)}
.row{display:flex;gap:8px}
.result{margin-top:12px;padding:12px 16px;border-radius:12px;font-size:14px;font-weight:700}
.tabs{display:flex;gap:4px;overflow-x:auto;margin-bottom:12px;-ms-overflow-style:none;scrollbar-width:none}
.tab{padding:7px 12px;border-radius:10px;border:none;font-size:12px;font-weight:500;cursor:pointer;white-space:nowrap;background:transparent;color:#64748B}
.tab.active{font-weight:700}
.top-btns{display:flex;gap:5px}
.top-btn{padding:6px 10px;border-radius:10px;font-size:11px;font-weight:700;cursor:pointer;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.1);color:#fff}
.hidden{display:none}
</style>
</head>
<body>
<div class="hdr">
<div style="max-width:560px;margin:0 auto">
  <div style="display:flex;justify-content:space-between;align-items:center">
    <div><h1>Boss Task Manager</h1><p>by poppy — Shopgenix</p></div>
    <div class="top-btns">
      <button class="top-btn" onclick="showTest()">test</button>
      <button class="top-btn" onclick="loadTasks()">refresh</button>
    </div>
  </div>
  <div class="live"><div class="live-dot"></div><span>LINE connected</span></div>
  <div class="stats">
    <div class="stat"><b id="s-pending" style="color:#F59E0B">0</b><small>pending</small></div>
    <div class="stat"><b id="s-urgent" style="color:#EF4444">0</b><small>urgent</small></div>
    <div class="stat"><b id="s-question" style="color:#8B5CF6">0</b><small>questions</small></div>
    <div class="stat"><b id="s-done" style="color:#10B981">0</b><small>done</small></div>
  </div>
</div>
</div>

<div class="wrap">
  <div class="info" style="background:#F0FDF4;border:1px solid #BBF7D0;color:#065F46">boss replies in LINE will notify poppy automatically</div>
  <div class="info" style="background:#EFF6FF;border:1px solid #BFDBFE;color:#1E40AF">daily summary at 08:30</div>
  <div class="tabs" id="tabs"></div>
  <div id="task-list"></div>
</div>

<button class="fab" onclick="showAdd()">+</button>

<!-- Add Task Modal -->
<div class="modal-bg hidden" id="add-modal" onclick="hideAdd()">
<div class="modal" onclick="event.stopPropagation()">
  <h3>add new task + send LINE to boss</h3>
  <div style="padding:8px 12px;border-radius:8px;background:#F0FDF4;border:1px solid #BBF7D0;margin-bottom:14px;font-size:12px;color:#065F46;font-weight:600">press add = send LINE to boss immediately!</div>
  <div class="cat-btns" id="cat-btns"></div>
  <div class="field"><label id="title-label">title *</label><input id="f-title" placeholder="e.g. Board Meeting"></div>
  <div class="field"><label>detail</label><textarea id="f-detail" rows="2"></textarea></div>
  <div class="row">
    <div class="field" style="flex:1"><label>due date</label><input type="date" id="f-date"></div>
    <div class="field" style="flex:1"><label>time</label><input type="time" id="f-time"></div>
  </div>
  <div class="field hidden" id="from-field"><label>asked by</label><input id="f-from" placeholder="e.g. Marketing team"></div>
  <div class="row" style="gap:8px;margin-top:6px">
    <button class="btn" style="flex:1;background:#fff;color:#64748B;border:1px solid #E2E8F0" onclick="hideAdd()">cancel</button>
    <button class="btn btn-green" style="flex:2" id="add-btn" onclick="addTask()">add + send LINE</button>
  </div>
</div>
</div>

<!-- Test Modal -->
<div class="modal-bg hidden" id="test-modal" onclick="hideTest()">
<div class="modal" onclick="event.stopPropagation()">
  <h3>test LINE connection</h3>
  <div style="display:flex;flex-direction:column;gap:10px">
    <button class="btn btn-amber" onclick="testLine('boss')">send test to boss</button>
    <button class="btn btn-blue" onclick="testLine('secretary')">send test to poppy</button>
    <button class="btn btn-purple" onclick="triggerDaily()">send daily summary now</button>
  </div>
  <div id="test-result"></div>
  <div style="margin-top:14px;padding:12px;border-radius:12px;background:#EFF6FF;border:1px solid #BFDBFE">
    <div style="font-size:12px;font-weight:700;color:#1E40AF;margin-bottom:4px">how boss replies in LINE:</div>
    <div style="font-size:12px;color:#334155;line-height:1.6">
      type <b>"done XXXX"</b> to mark done<br>
      type <b>"reply XXXX: answer"</b> to answer<br>
      type anything else to see pending tasks
    </div>
  </div>
  <button class="btn" style="margin-top:12px;background:#fff;color:#64748B;border:1px solid #E2E8F0" onclick="hideTest()">close</button>
</div>
</div>

<script>
const CATS={urgent:{l:'urgent',e:'\\u{1F534}',c:'#EF4444',bg:'#FEF2F2'},normal:{l:'normal',e:'\\u{1F535}',c:'#3B82F6',bg:'#EFF6FF'},question:{l:'question',e:'\\u{1F4AC}',c:'#8B5CF6',bg:'#F5F3FF'},schedule:{l:'schedule',e:'\\u{1F4C5}',c:'#F59E0B',bg:'#FFFBEB'}};
const STS={pending:{l:'pending',c:'#F59E0B',bg:'#FFFBEB'},sent:{l:'sent to LINE',c:'#3B82F6',bg:'#EFF6FF'},done:{l:'done',c:'#10B981',bg:'#ECFDF5'},replied:{l:'replied',c:'#10B981',bg:'#ECFDF5'}};
let tasks=[], curCat='urgent', curFilter='all';

function loadTasks(){
  fetch('/api/tasks').then(r=>r.json()).then(d=>{tasks=d||[];render();}).catch(()=>{});
}

function render(){
  const f=curFilter==='all'?tasks:tasks.filter(t=>t.category===curFilter);
  const counts={};Object.keys(CATS).forEach(k=>{counts[k]=tasks.filter(t=>t.category===k&&t.status!=='done'&&t.status!=='replied').length;});
  const pending=tasks.filter(t=>t.status!=='done'&&t.status!=='replied').length;
  const done=tasks.filter(t=>t.status==='done'||t.status==='replied').length;
  document.getElementById('s-pending').textContent=pending;
  document.getElementById('s-urgent').textContent=counts.urgent||0;
  document.getElementById('s-question').textContent=counts.question||0;
  document.getElementById('s-done').textContent=done;

  let tabs='<button class="tab '+(curFilter==='all'?'active':'')+'" style="'+(curFilter==='all'?'background:#1E293B;color:#fff':'')+'" onclick="setFilter(\\'all\\')">all ('+tasks.length+')</button>';
  Object.entries(CATS).forEach(([k,v])=>{
    const active=curFilter===k;
    tabs+='<button class="tab '+(active?'active':'')+'" style="'+(active?'background:'+v.c+';color:#fff':'')+'" onclick="setFilter(\\''+k+'\\')">'+v.e+' '+v.l+(counts[k]>0?' ('+counts[k]+')':'')+'</button>';
  });
  document.getElementById('tabs').innerHTML=tabs;

  if(f.length===0){
    document.getElementById('task-list').innerHTML='<div class="card" style="text-align:center;padding:30px;color:#94A3B8"><div style="font-size:32px">\\u{1F389}</div><div style="font-size:13px;font-weight:600;margin-top:4px">no tasks — press + to add</div></div>';
    return;
  }
  const sorted=[...f].sort((a,b)=>({pending:0,sent:1,done:3,replied:3}[a.status]||0)-({pending:0,sent:1,done:3,replied:3}[b.status]||0));
  let html='';
  sorted.forEach(t=>{
    const cat=CATS[t.category]||CATS.normal;
    const st=STS[t.status]||STS.pending;
    const isDone=t.status==='done'||t.status==='replied';
    html+='<div class="card'+(isDone?' done':'')+'" style="border-left:4px solid '+cat.c+'">';
    html+='<div class="card-head"><span style="font-size:15px">'+cat.e+'</span><span class="title">'+t.title+'</span><span class="badge" style="color:'+st.c+';background:'+st.bg+'">'+st.l+'</span></div>';
    if(t.detail)html+='<div class="detail">'+t.detail+'</div>';
    html+='<div class="meta">';
    if(t.dueDate)html+='<span>\\u23F0 '+t.dueDate+(t.dueTime?' '+t.dueTime:'')+'</span>';
    if(t.from)html+='<span>\\u{1F464} '+t.from+'</span>';
    html+='<span style="color:#CBD5E1">ID:'+t.id.slice(-4)+'</span></div>';
    if(t.reply)html+='<div class="reply-box">\\u{1F4AC} answer: '+t.reply+'</div>';
    if(t.doneAt&&isDone)html+='<div style="font-size:10px;color:#94A3B8;margin-top:4px">done: '+new Date(t.doneAt).toLocaleString("th-TH")+'</div>';
    html+='</div>';
  });
  document.getElementById('task-list').innerHTML=html;
}

function setFilter(f){curFilter=f;render();}

// Add task
function showAdd(){document.getElementById('add-modal').classList.remove('hidden');renderCats();}
function hideAdd(){document.getElementById('add-modal').classList.add('hidden');}
function renderCats(){
  let h='';
  Object.entries(CATS).forEach(([k,v])=>{
    h+='<button class="cat-btn'+(curCat===k?' active':'')+'" style="--cc:'+v.c+';--bg:'+v.bg+';'+(curCat===k?'border-color:'+v.c+';background:'+v.bg+';color:'+v.c:'')+'" onclick="setCat(\\''+k+'\\')">'+v.e+' '+v.l+'</button>';
  });
  document.getElementById('cat-btns').innerHTML=h;
  document.getElementById('title-label').textContent=curCat==='question'?'question *':'title *';
  document.getElementById('from-field').classList.toggle('hidden',curCat!=='question');
}
function setCat(c){curCat=c;renderCats();}

async function addTask(){
  const title=document.getElementById('f-title').value.trim();
  if(!title)return;
  const btn=document.getElementById('add-btn');
  btn.disabled=true;btn.textContent='sending LINE...';
  try{
    const res=await fetch('/api/tasks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      category:curCat,title,detail:document.getElementById('f-detail').value.trim(),
      dueDate:document.getElementById('f-date').value||null,
      dueTime:document.getElementById('f-time').value||null,
      from:document.getElementById('f-from').value.trim()||null
    })});
    const data=await res.json();
    if(data.success){tasks.unshift(data.task);render();hideAdd();
      document.getElementById('f-title').value='';document.getElementById('f-detail').value='';
      document.getElementById('f-date').value='';document.getElementById('f-time').value='';document.getElementById('f-from').value='';
    }else{alert('error: '+(data.error||'unknown'));}
  }catch(e){alert('error: '+e.message);}
  btn.disabled=false;btn.textContent='add + send LINE';
}

// Test
function showTest(){document.getElementById('test-modal').classList.remove('hidden');}
function hideTest(){document.getElementById('test-modal').classList.add('hidden');}
async function testLine(target){
  document.getElementById('test-result').innerHTML='<div class="result" style="background:#EFF6FF;color:#1E40AF">sending...</div>';
  try{
    const res=await fetch('/api/test-line',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({target})});
    const d=await res.json();
    document.getElementById('test-result').innerHTML='<div class="result" style="background:'+(d.success?'#F0FDF4;color:#065F46':'#FEF2F2;color:#991B1B')+'">'+(d.success?'\\u{1F389} ':'\\u274C ')+(d.message||d.error)+'</div>';
  }catch(e){document.getElementById('test-result').innerHTML='<div class="result" style="background:#FEF2F2;color:#991B1B">\\u274C '+e.message+'</div>';}
}
async function triggerDaily(){
  document.getElementById('test-result').innerHTML='<div class="result" style="background:#EFF6FF;color:#1E40AF">sending summary...</div>';
  try{
    const res=await fetch('/api/daily-summary',{method:'POST'});
    const d=await res.json();
    document.getElementById('test-result').innerHTML='<div class="result" style="background:#F0FDF4;color:#065F46">\\u{1F389} sent!</div>';
  }catch(e){document.getElementById('test-result').innerHTML='<div class="result" style="background:#FEF2F2;color:#991B1B">\\u274C '+e.message+'</div>';}
}

loadTasks();
</script>
</body>
</html>`);
});

// ========== API ==========
app.post('/api/tasks', async (req, res) => {
  try {
    const task = { id: genId(), ...req.body, status: 'sent', reply: null, createdAt: new Date().toISOString(), doneAt: null };
    tasks.push(task);
    const cat = { urgent: '\\u{1F534} urgent', normal: '\\u{1F535} normal', question: '\\u{1F4AC} question', schedule: '\\u{1F4C5} schedule' };
    let msg = (cat[task.category]||'task')+'\\n━━━━━━━━━━━━━━\\n\\u{1F4CC} '+task.title+'\\n';
    if (task.detail) msg += '\\u{1F4DD} '+task.detail+'\\n';
    if (task.dueDate) msg += '\\u23F0 due: '+task.dueDate+' '+(task.dueTime||'')+'\\n';
    if (task.from) msg += '\\u{1F464} from: '+task.from+'\\n';
    msg += '━━━━━━━━━━━━━━\\n';
    msg += task.category==='question' ? '\\u{1F4AC} reply: type "reply '+task.id.slice(-4)+': [answer]"' : '\\u2705 done: type "done '+task.id.slice(-4)+'"';
    await pushLine(BOSS, msg);
    res.json({ success: true, task });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/tasks', (req, res) => res.json(tasks));

app.patch('/api/tasks/:id', async (req, res) => {
  const task = tasks.find(t => t.id === req.params.id);
  if (!task) return res.status(404).json({ error: 'Not found' });
  if (req.body.status) task.status = req.body.status;
  if (req.body.reply) task.reply = req.body.reply;
  if (task.status === 'done' || task.status === 'replied') task.doneAt = new Date().toISOString();
  res.json({ success: true, task });
});

app.post('/api/daily-summary', async (req, res) => {
  try { await sendDailySummary(); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/test-line', async (req, res) => {
  try {
    const target = req.body.target || 'boss';
    const userId = target === 'secretary' ? SEC : BOSS;
    const name = target === 'secretary' ? 'poppy' : 'boss';
    const ok = await pushLine(userId, '\\u{1F9EA} Test from Boss Task Manager\\n━━━━━━━━━━━━━━\\nsent to: '+name+'\\n'+fmtDate()+'\\n\\u2705 Connection successful!');
    res.json({ success: ok, message: ok ? 'sent to '+name : 'failed' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ========== WEBHOOK ==========
app.post('/webhook', (req, res) => {
  const events = req.body.events || [];
  events.forEach(async (event) => {
    if (event.type !== 'message' || event.message.type !== 'text') return;
    const text = event.message.text.trim();
    const rt = event.replyToken;

    if (text.startsWith('done') || text.startsWith('เสร็จ')) {
      const code = text.replace(/^(done|เสร็จ)\s*/i, '').trim();
      const task = tasks.find(t => t.id.slice(-4) === code && t.status !== 'done' && t.status !== 'replied');
      if (task) {
        task.status = 'done'; task.doneAt = new Date().toISOString();
        const remaining = tasks.filter(t => t.status !== 'done' && t.status !== 'replied').length;
        await replyLine(rt, '\\u2705 "'+task.title+'" done!');
        await pushLine(SEC, '\\u2705 Boss completed task\\n━━━━━━━━━━━━━━\\n\\u{1F4CC} '+task.title+'\\n'+(task.detail?'\\u{1F4DD} '+task.detail+'\\n':'')+'\\u23F0 done: '+fmtDate()+'\\n━━━━━━━━━━━━━━\\nremaining: '+remaining+' tasks');
      } else { await replyLine(rt, '\\u274C Task "'+code+'" not found'); }
      return;
    }

    if (text.startsWith('reply') || text.startsWith('ตอบ')) {
      const rest = text.replace(/^(reply|ตอบ)\s*/i, '').trim();
      const ci = rest.indexOf(':');
      if (ci === -1) { await replyLine(rt, 'Format: reply XXXX: your answer'); return; }
      const code = rest.slice(0, ci).trim();
      const reply = rest.slice(ci + 1).trim();
      const task = tasks.find(t => t.id.slice(-4) === code && t.category === 'question');
      if (task && reply) {
        task.status = 'replied'; task.reply = reply; task.doneAt = new Date().toISOString();
        await replyLine(rt, '\\u{1F4AC} Reply sent!\\n\\u{1F4CC} '+task.title+'\\n\\u{1F4AC} "'+reply+'"');
        await pushLine(SEC, '\\u{1F4AC} Boss replied\\n━━━━━━━━━━━━━━\\n\\u{1F4CC} '+task.title+'\\n\\u{1F4AC} Answer: '+reply+'\\n'+(task.from?'\\u{1F464} Asked by: '+task.from+'\\n':'')+'━━━━━━━━━━━━━━\\nForward answer to team!');
      } else { await replyLine(rt, '\\u274C Question "'+code+'" not found'); }
      return;
    }

    const pending = tasks.filter(t => t.status !== 'done' && t.status !== 'replied');
    let menu = '\\u{1F4CB} Pending: '+pending.length+'\\n━━━━━━━━━━━━━━\\n';
    if (!pending.length) menu += '\\u{1F389} No pending tasks!\\n';
    else pending.forEach((t, i) => { menu += (i+1)+'. '+(CATS_E[t.category]||'')+' '+t.title+' ['+t.id.slice(-4)+']\\n'; });
    menu += '━━━━━━━━━━━━━━\\n"done XXXX" or "เสร็จ XXXX"\\n"reply XXXX: answer" or "ตอบ XXXX: คำตอบ"';
    await replyLine(rt, menu);
  });
  res.json({ ok: true });
});

const CATS_E = { urgent: '\\u{1F534}', normal: '\\u{1F535}', question: '\\u{1F4AC}', schedule: '\\u{1F4C5}' };

// ========== DAILY CRON ==========
async function sendDailySummary() {
  const pending = tasks.filter(t => t.status !== 'done' && t.status !== 'replied');
  if (!pending.length) return;
  let msg = '\\u{1F305} Daily Summary (08:30)\\n━━━━━━━━━━━━━━\\nPending: '+pending.length+'\\n\\n';
  pending.forEach((t, i) => { msg += (i+1)+'. '+(CATS_E[t.category]||'')+' '+t.title+' ['+t.id.slice(-4)+']\\n'; });
  msg += '\\n━━━━━━━━━━━━━━\\n"done [ID]" or "reply [ID]: answer"';
  await pushLine(BOSS, msg);
  await pushLine(SEC, '\\u{1F4E9} Copy of daily summary (sent to boss)\\n\\n'+msg);
}

cron.schedule('30 8 * * *', () => { sendDailySummary().catch(e => console.error(e)); }, { timezone: 'Asia/Bangkok' });

app.listen(PORT, () => { console.log('Boss Task Manager running on port '+PORT); });
