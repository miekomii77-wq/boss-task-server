const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const multer = require('multer');
const mammoth = require('mammoth');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const TOKEN = process.env.LINE_CHANNEL_TOKEN;
const BOSS = process.env.BOSS_LINE_USER_ID;
const SEC = process.env.SECRETARY_LINE_USER_ID;
const PORT = process.env.PORT || 3000;

// Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

let bossReplyState = {};
const uploadedImages = {};
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));

// ─── DB Helpers ───
async function dbGetAll() {
  const { data } = await supabase.from('tasks').select('*').order('created_at', { ascending: false });
  return (data || []).map(r => ({ id: r.id, category: r.category, title: r.title, detail: r.detail, dueDate: r.due_date, dueTime: r.due_time, from: r.from_who, status: r.status, reply: r.reply, imageUrl: r.image_url, createdAt: r.created_at, doneAt: r.done_at }));
}
async function dbInsert(task) {
  await supabase.from('tasks').insert({ id: task.id, category: task.category, title: task.title, detail: task.detail || '', due_date: task.dueDate, due_time: task.dueTime, from_who: task.from, status: task.status, reply: task.reply, image_url: task.imageUrl, created_at: task.createdAt, done_at: task.doneAt });
}
async function dbUpdate(id, fields) {
  const map = {};
  if (fields.status !== undefined) map.status = fields.status;
  if (fields.reply !== undefined) map.reply = fields.reply;
  if (fields.doneAt !== undefined) map.done_at = fields.doneAt;
  await supabase.from('tasks').update(map).eq('id', id);
}

// ─── LINE Helpers ───
async function pushLine(to, messages) {
  if (typeof messages === 'string') messages = [{ type: 'text', text: messages }];
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + TOKEN },
    body: JSON.stringify({ to, messages }),
  });
  if (!res.ok) console.error('LINE error:', await res.text());
  return res.ok;
}
async function replyLine(rt, messages) {
  if (typeof messages === 'string') messages = [{ type: 'text', text: messages }];
  await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + TOKEN },
    body: JSON.stringify({ replyToken: rt, messages }),
  });
}
function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function fmtDate() { return new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }); }
const CE = { urgent: '\u{1F534}', normal: '\u{1F535}', question: '\u{1F4AC}', schedule: '\u{1F4C5}', overdue: '\u26A0\uFE0F' };
const CL = { urgent: '\u{1F534} งานด่วน', normal: '\u{1F535} งานทั่วไป', question: '\u{1F4AC} คำถามจากทีม', schedule: '\u{1F4C5} ตารางงาน', overdue: '\u26A0\uFE0F งานค้าง' };

async function buildTaskListFlex() {
  const tasks = await dbGetAll();
  const pending = tasks.filter(t => t.status !== 'done' && t.status !== 'replied');
  if (!pending.length) return [{ type: 'text', text: '\u{1F389} ไม่มีงานค้าง!' }];
  let text = '\u{1F4CB} งานค้าง ' + pending.length + ' รายการ\n━━━━━━━━━━━━━━\n';
  pending.forEach((t, i) => { text += (i + 1) + '. ' + (CE[t.category] || '') + ' ' + t.title + '\n'; });
  text += '━━━━━━━━━━━━━━\n\u{1F447} กดปุ่มด้านล่างเพื่อเลือกงาน';
  const qr = { items: [] };
  pending.slice(0, 13).forEach(t => {
    const isQ = t.category === 'question';
    qr.items.push({ type: 'action', action: { type: 'message', label: (isQ ? '\u{1F4AC}ตอบ ' : '\u2705เสร็จ ') + t.title.slice(0, 14), text: isQ ? 'ตอบ ' + t.id.slice(-4) : 'เสร็จ ' + t.id.slice(-4) } });
  });
  return [{ type: 'text', text, quickReply: qr }];
}

app.get('/img/:id', (req, res) => {
  const data = uploadedImages[req.params.id];
  if (!data) return res.status(404).send('Not found');
  const match = data.match(/^data:image\/(\w+);base64,(.+)$/);
  if (!match) return res.status(400).send('Invalid');
  res.set('Content-Type', 'image/' + match[1]);
  res.send(Buffer.from(match[2], 'base64'));
});

// ========== WEB UI ==========
app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="th"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Boss Task Manager — Shopgenix</title>
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
.img-preview{margin-top:8px;border-radius:8px;max-width:100%;max-height:200px;object-fit:cover}
.btn{padding:10px 18px;border-radius:12px;border:none;font-size:14px;font-weight:700;cursor:pointer;width:100%}
.btn-green{background:#06C755;color:#fff}.btn-blue{background:#3B82F6;color:#fff}.btn-purple{background:#8B5CF6;color:#fff}.btn-amber{background:#F59E0B;color:#fff}
.btn:disabled{background:#CBD5E1;cursor:not-allowed}
.fab{position:fixed;bottom:22px;right:22px;width:54px;height:54px;border-radius:16px;background:linear-gradient(135deg,#06C755,#05A847);color:#fff;border:none;font-size:24px;box-shadow:0 6px 20px rgba(6,199,85,.4);cursor:pointer;z-index:100;display:flex;align-items:center;justify-content:center}
.fab2{position:fixed;bottom:22px;right:86px;width:54px;height:54px;border-radius:16px;background:linear-gradient(135deg,#3B82F6,#2563EB);color:#fff;border:none;font-size:20px;box-shadow:0 6px 20px rgba(59,130,246,.4);cursor:pointer;z-index:100;display:flex;align-items:center;justify-content:center}
.modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;z-index:1000;padding:16px}
.modal{background:#fff;border-radius:20px;padding:24px;max-width:480px;width:100%;max-height:90vh;overflow-y:auto}
.modal h3{font-size:17px;font-weight:800;color:#1E293B;margin-bottom:16px}
.field label{font-size:12px;font-weight:600;color:#64748B;display:block;margin-bottom:4px}
.field{margin-bottom:10px}
.field input,.field textarea{width:100%;padding:10px 14px;border-radius:10px;border:1.5px solid #E2E8F0;font-size:14px;color:#1E293B;outline:none;background:#FAFBFC;font-family:inherit}
.field textarea{resize:vertical}
.cat-btns{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:12px}
.cat-btn{padding:6px 12px;border-radius:8px;border:2px solid #E2E8F0;background:#fff;font-size:12px;font-weight:600;cursor:pointer}
.cat-btn.active{border-color:var(--cc);background:var(--bg)}
.row{display:flex;gap:8px}
.result{margin-top:12px;padding:12px 16px;border-radius:12px;font-size:14px;font-weight:700}
.tabs{display:flex;gap:4px;overflow-x:auto;margin-bottom:12px;scrollbar-width:none}
.tab{padding:7px 12px;border-radius:10px;border:none;font-size:12px;font-weight:500;cursor:pointer;white-space:nowrap;background:transparent;color:#64748B}
.tab.active{font-weight:700}
.top-btns{display:flex;gap:5px}
.top-btn{padding:6px 10px;border-radius:10px;font-size:11px;font-weight:700;cursor:pointer;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.1);color:#fff}
.hidden{display:none}
.upload-area{border:2px dashed #DDD6FE;border-radius:12px;padding:16px;text-align:center;cursor:pointer;background:#F5F3FF}
.upload-area:hover{border-color:#8B5CF6;background:#EDE9FE}
.upload-preview{position:relative;display:inline-block;margin-top:8px}
.upload-preview img{max-height:150px;border-radius:8px}
.upload-remove{position:absolute;top:-6px;right:-6px;width:22px;height:22px;border-radius:11px;background:#EF4444;color:#fff;border:none;font-size:12px;cursor:pointer;display:flex;align-items:center;justify-content:center}
.file-upload-area{border:2px dashed #BFDBFE;border-radius:12px;padding:20px;text-align:center;cursor:pointer;background:#EFF6FF;margin-bottom:12px}
.file-upload-area:hover{border-color:#3B82F6;background:#DBEAFE}
.task-preview{padding:10px 14px;border-radius:10px;background:#F8FAFC;border:1px solid #E2E8F0;margin-bottom:8px;font-size:13px}
.db-badge{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:8px;background:#ECFDF5;border:1px solid #A7F3D0;font-size:10px;color:#059669;font-weight:600;margin-left:6px}
</style></head><body>
<div class="hdr"><div style="max-width:560px;margin:0 auto">
  <div style="display:flex;justify-content:space-between;align-items:center">
    <div><h1>Boss Task Manager</h1><p>by ป๊อปปี้ — Shopgenix <span class="db-badge">\u{1F512} Supabase</span></p></div>
    <div class="top-btns">
      <button class="top-btn" onclick="showTest()">ทดสอบ</button>
      <button class="top-btn" onclick="loadTasks()">รีเฟรช</button>
    </div>
  </div>
  <div class="live"><div class="live-dot"></div><span>LINE เชื่อมต่อ + ฐานข้อมูลถาวร</span></div>
  <div class="stats">
    <div class="stat"><b id="s-pending" style="color:#F59E0B">0</b><small>งานค้าง</small></div>
    <div class="stat"><b id="s-urgent" style="color:#EF4444">0</b><small>ด่วน</small></div>
    <div class="stat"><b id="s-question" style="color:#8B5CF6">0</b><small>รอตอบ</small></div>
    <div class="stat"><b id="s-done" style="color:#10B981">0</b><small>เสร็จ</small></div>
  </div>
</div></div>
<div class="wrap">
  <div class="info" style="background:#ECFDF5;border:1px solid #A7F3D0;color:#065F46">\u{1F512} ข้อมูลเก็บถาวรในฐานข้อมูล — รีเฟรช/deploy ใหม่ก็ไม่หาย!</div>
  <div class="info" style="background:#F0FDF4;border:1px solid #BBF7D0;color:#065F46">\u2705 เจ้านายกดปุ่มเลือกงาน → พิมพ์คำตอบ → แจ้งป๊อปปี้อัตโนมัติ</div>
  <div class="info" style="background:#EFF6FF;border:1px solid #BFDBFE;color:#1E40AF">\u{1F305} สรุปงานค้างส่งอัตโนมัติทุกวัน 08:30 น.</div>
  <div class="tabs" id="tabs"></div>
  <div id="task-list"></div>
</div>
<button class="fab2" onclick="showImport()" title="นำเข้าไฟล์ Word">\u{1F4C4}</button>
<button class="fab" onclick="showAdd()">+</button>

<div class="modal-bg hidden" id="add-modal" onclick="hideAdd()"><div class="modal" onclick="event.stopPropagation()">
  <h3>\u2795 เพิ่มงานใหม่ + ส่ง LINE เจ้านาย</h3>
  <div style="padding:8px 12px;border-radius:8px;background:#F0FDF4;border:1px solid #BBF7D0;margin-bottom:14px;font-size:12px;color:#065F46;font-weight:600">\u{1F4E4} กดเพิ่มงาน = ส่ง LINE ถึงเจ้านายทันที!</div>
  <div class="cat-btns" id="cat-btns"></div>
  <div class="field"><label id="title-label">หัวข้องาน *</label><input id="f-title" placeholder="เช่น ประชุม Board Meeting"></div>
  <div class="field"><label>รายละเอียด</label><textarea id="f-detail" rows="2" placeholder="รายละเอียดเพิ่มเติม..."></textarea></div>
  <div class="row"><div class="field" style="flex:1"><label>วันกำหนด</label><input type="date" id="f-date"></div><div class="field" style="flex:1"><label>เวลา</label><input type="time" id="f-time"></div></div>
  <div class="field hidden" id="from-field"><label>ถามโดย</label><input id="f-from" placeholder="เช่น ทีม Marketing"></div>
  <div class="field hidden" id="img-field"><label>\u{1F4F7} แนบรูปภาพ</label><div class="upload-area" onclick="document.getElementById('f-img').click()"><div style="font-size:24px">\u{1F4F7}</div><div style="font-size:12px;color:#8B5CF6">กดเพื่อเลือกรูป</div></div><input type="file" id="f-img" accept="image/*" style="display:none" onchange="previewImg(this)"><div id="img-preview-wrap"></div></div>
  <div class="row" style="gap:8px;margin-top:6px"><button class="btn" style="flex:1;background:#fff;color:#64748B;border:1px solid #E2E8F0" onclick="hideAdd()">ยกเลิก</button><button class="btn btn-green" style="flex:2" id="add-btn" onclick="addTask()">\u{1F4E4} เพิ่มงาน + ส่ง LINE</button></div>
</div></div>

<div class="modal-bg hidden" id="import-modal" onclick="hideImport()"><div class="modal" onclick="event.stopPropagation()">
  <h3>\u{1F4C4} นำเข้างานจากไฟล์ Word</h3>
  <div style="padding:8px 12px;border-radius:8px;background:#EFF6FF;border:1px solid #BFDBFE;margin-bottom:14px;font-size:12px;color:#1E40AF;font-weight:600">\u{1F4DD} อัปโหลดไฟล์ .docx → แยกเป็นหลายงาน → ส่ง LINE เจ้านายทุกงาน!</div>
  <div class="field"><label>เลือกประเภทงาน</label><select id="imp-cat" style="width:100%;padding:10px;border-radius:10px;border:1.5px solid #E2E8F0;font-size:14px;background:#FAFBFC;font-family:inherit"><option value="urgent">\u{1F534} งานด่วน</option><option value="normal" selected>\u{1F535} งานทั่วไป</option><option value="question">\u{1F4AC} คำถามจากทีม</option><option value="schedule">\u{1F4C5} ตารางงาน</option><option value="overdue">\u26A0\uFE0F งานค้าง</option></select></div>
  <div class="file-upload-area" onclick="document.getElementById('f-docx').click()"><div style="font-size:32px">\u{1F4C4}</div><div style="font-size:13px;color:#3B82F6;font-weight:700">กดเพื่อเลือกไฟล์ .docx</div><div style="font-size:11px;color:#94A3B8;margin-top:4px">แต่ละบรรทัด = 1 งาน</div></div>
  <input type="file" id="f-docx" accept=".docx,.doc" style="display:none" onchange="handleDocx(this)">
  <div id="import-status"></div><div id="import-preview"></div>
  <div id="import-actions" class="hidden" style="margin-top:10px"><button class="btn btn-green" id="import-btn" onclick="sendImportedTasks()">\u{1F4E4} ส่งงานทั้งหมดให้เจ้านาย</button></div>
  <button class="btn" style="margin-top:10px;background:#fff;color:#64748B;border:1px solid #E2E8F0" onclick="hideImport()">ปิด</button>
</div></div>

<div class="modal-bg hidden" id="test-modal" onclick="hideTest()"><div class="modal" onclick="event.stopPropagation()">
  <h3>\u{1F9EA} ทดสอบส่ง LINE</h3>
  <div style="display:flex;flex-direction:column;gap:10px"><button class="btn btn-amber" onclick="testLine('boss')">\u{1F454} ส่งทดสอบถึงเจ้านาย</button><button class="btn btn-blue" onclick="testLine('secretary')">\u{1F4BC} ส่งทดสอบถึงป๊อปปี้</button><button class="btn btn-purple" onclick="triggerDaily()">\u{1F305} ส่งสรุปงานค้างตอนนี้</button></div>
  <div id="test-result"></div>
  <button class="btn" style="margin-top:12px;background:#fff;color:#64748B;border:1px solid #E2E8F0" onclick="hideTest()">ปิด</button>
</div></div>

<script>
const CATS={urgent:{l:'งานด่วน',e:'\\u{1F534}',c:'#EF4444',bg:'#FEF2F2'},normal:{l:'งานทั่วไป',e:'\\u{1F535}',c:'#3B82F6',bg:'#EFF6FF'},question:{l:'คำถามจากทีม',e:'\\u{1F4AC}',c:'#8B5CF6',bg:'#F5F3FF'},schedule:{l:'ตารางงาน',e:'\\u{1F4C5}',c:'#F59E0B',bg:'#FFFBEB'},overdue:{l:'งานค้าง',e:'\\u26A0\\uFE0F',c:'#DC2626',bg:'#FEF2F2'}};
const STS={pending:{l:'รอดำเนินการ',c:'#F59E0B',bg:'#FFFBEB'},sent:{l:'ส่งไลน์แล้ว',c:'#3B82F6',bg:'#EFF6FF'},done:{l:'เสร็จแล้ว \\u2713',c:'#10B981',bg:'#ECFDF5'},replied:{l:'ตอบแล้ว',c:'#10B981',bg:'#ECFDF5'}};
let tasks=[],curCat='urgent',curFilter='all',imgBase64=null,importedLines=[];
function loadTasks(){fetch('/api/tasks').then(r=>r.json()).then(d=>{tasks=d||[];render();}).catch(()=>{});}
function render(){const f=curFilter==='all'?tasks:tasks.filter(t=>t.category===curFilter);const counts={};Object.keys(CATS).forEach(k=>{counts[k]=tasks.filter(t=>t.category===k&&t.status!=='done'&&t.status!=='replied').length;});document.getElementById('s-pending').textContent=tasks.filter(t=>t.status!=='done'&&t.status!=='replied').length;document.getElementById('s-urgent').textContent=counts.urgent||0;document.getElementById('s-question').textContent=counts.question||0;document.getElementById('s-done').textContent=tasks.filter(t=>t.status==='done'||t.status==='replied').length;let tabs='<button class="tab '+(curFilter==='all'?'active':'')+'" style="'+(curFilter==='all'?'background:#1E293B;color:#fff':'')+'" onclick="setFilter(\\'all\\')">ทั้งหมด ('+tasks.length+')</button>';Object.entries(CATS).forEach(([k,v])=>{const a=curFilter===k;tabs+='<button class="tab '+(a?'active':'')+'" style="'+(a?'background:'+v.c+';color:#fff':'')+'" onclick="setFilter(\\''+k+'\\')">'+v.e+' '+v.l+(counts[k]>0?' ('+counts[k]+')':'')+'</button>';});document.getElementById('tabs').innerHTML=tabs;if(!f.length){document.getElementById('task-list').innerHTML='<div class="card" style="text-align:center;padding:30px;color:#94A3B8"><div style="font-size:32px">\\u{1F389}</div><div style="font-size:13px;font-weight:600;margin-top:4px">ยังไม่มีงาน — กด + หรือ \\u{1F4C4}</div></div>';return;}const sorted=[...f].sort((a,b)=>({pending:0,sent:1,done:3,replied:3}[a.status]||0)-({pending:0,sent:1,done:3,replied:3}[b.status]||0));let h='';sorted.forEach(t=>{const cat=CATS[t.category]||CATS.normal;const st=STS[t.status]||STS.pending;const isDone=t.status==='done'||t.status==='replied';h+='<div class="card'+(isDone?' done':'')+'" style="border-left:4px solid '+cat.c+'">';h+='<div class="card-head"><span style="font-size:15px">'+cat.e+'</span><span class="title">'+t.title+'</span><span class="badge" style="color:'+st.c+';background:'+st.bg+'">'+st.l+'</span></div>';if(t.detail)h+='<div class="detail">'+t.detail+'</div>';h+='<div class="meta">';if(t.dueDate)h+='<span>\\u23F0 '+t.dueDate+(t.dueTime?' '+t.dueTime:'')+'</span>';if(t.from)h+='<span>\\u{1F464} '+t.from+'</span>';h+='<span style="color:#CBD5E1">ID:'+t.id.slice(-4)+'</span></div>';if(t.imageUrl)h+='<img class="img-preview" src="'+t.imageUrl+'" alt="รูปแนบ">';if(t.reply)h+='<div class="reply-box">\\u{1F4AC} คำตอบ: '+t.reply+'</div>';if(t.doneAt&&isDone)h+='<div style="font-size:10px;color:#94A3B8;margin-top:4px">เสร็จเมื่อ: '+new Date(t.doneAt).toLocaleString("th-TH")+'</div>';h+='</div>';});document.getElementById('task-list').innerHTML=h;}
function setFilter(f){curFilter=f;render();}
function showAdd(){document.getElementById('add-modal').classList.remove('hidden');renderCats();imgBase64=null;document.getElementById('img-preview-wrap').innerHTML='';}
function hideAdd(){document.getElementById('add-modal').classList.add('hidden');}
function renderCats(){let h='';Object.entries(CATS).forEach(([k,v])=>{h+='<button class="cat-btn'+(curCat===k?' active':'')+'" style="--cc:'+v.c+';--bg:'+v.bg+';'+(curCat===k?'border-color:'+v.c+';background:'+v.bg+';color:'+v.c:'')+'" onclick="setCat(\\''+k+'\\')">'+v.e+' '+v.l+'</button>';});document.getElementById('cat-btns').innerHTML=h;document.getElementById('title-label').textContent=curCat==='question'?'คำถาม *':'หัวข้องาน *';document.getElementById('from-field').classList.toggle('hidden',curCat!=='question');document.getElementById('img-field').classList.toggle('hidden',curCat!=='question');}
function setCat(c){curCat=c;renderCats();}
function previewImg(input){const file=input.files[0];if(!file)return;const reader=new FileReader();reader.onload=function(e){imgBase64=e.target.result;document.getElementById('img-preview-wrap').innerHTML='<div class="upload-preview"><img src="'+imgBase64+'"><button class="upload-remove" onclick="removeImg()">\\u2715</button></div>';};reader.readAsDataURL(file);}
function removeImg(){imgBase64=null;document.getElementById('img-preview-wrap').innerHTML='';document.getElementById('f-img').value='';}
async function addTask(){const title=document.getElementById('f-title').value.trim();if(!title)return;const btn=document.getElementById('add-btn');btn.disabled=true;btn.textContent='กำลังส่ง LINE...';try{const body={category:curCat,title,detail:document.getElementById('f-detail').value.trim(),dueDate:document.getElementById('f-date').value||null,dueTime:document.getElementById('f-time').value||null,from:document.getElementById('f-from').value.trim()||null,imageBase64:imgBase64||null};const res=await fetch('/api/tasks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await res.json();if(data.success){tasks.unshift(data.task);render();hideAdd();document.getElementById('f-title').value='';document.getElementById('f-detail').value='';document.getElementById('f-date').value='';document.getElementById('f-time').value='';document.getElementById('f-from').value='';removeImg();}else{alert('ผิดพลาด: '+(data.error||''));}}catch(e){alert('ผิดพลาด: '+e.message);}btn.disabled=false;btn.textContent='\\u{1F4E4} เพิ่มงาน + ส่ง LINE';}
function showImport(){document.getElementById('import-modal').classList.remove('hidden');importedLines=[];document.getElementById('import-preview').innerHTML='';document.getElementById('import-status').innerHTML='';document.getElementById('import-actions').classList.add('hidden');}
function hideImport(){document.getElementById('import-modal').classList.add('hidden');}
async function handleDocx(input){const file=input.files[0];if(!file)return;document.getElementById('import-status').innerHTML='<div class="result" style="background:#EFF6FF;color:#1E40AF">\\u23F3 กำลังอ่านไฟล์...</div>';const fd=new FormData();fd.append('file',file);try{const res=await fetch('/api/import-docx',{method:'POST',body:fd});const data=await res.json();if(data.success&&data.lines.length){importedLines=data.lines;document.getElementById('import-status').innerHTML='<div class="result" style="background:#F0FDF4;color:#065F46">\\u{1F389} พบ '+data.lines.length+' รายการ</div>';let p='';data.lines.forEach((l,i)=>{p+='<div class="task-preview"><b>'+(i+1)+'. '+l.title+'</b>'+(l.detail?' <small>— '+l.detail.slice(0,50)+'</small>':'')+'</div>';});document.getElementById('import-preview').innerHTML=p;document.getElementById('import-actions').classList.remove('hidden');}else{document.getElementById('import-status').innerHTML='<div class="result" style="background:#FEF2F2;color:#991B1B">\\u274C ไม่พบเนื้อหา</div>';}}catch(e){document.getElementById('import-status').innerHTML='<div class="result" style="background:#FEF2F2;color:#991B1B">\\u274C '+e.message+'</div>';}}
async function sendImportedTasks(){if(!importedLines.length)return;const btn=document.getElementById('import-btn');btn.disabled=true;btn.textContent='กำลังส่ง LINE...';const cat=document.getElementById('imp-cat').value;let ok=0;for(const line of importedLines){try{const res=await fetch('/api/tasks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({category:cat,title:line.title,detail:line.detail||''})});const d=await res.json();if(d.success){tasks.unshift(d.task);ok++;}}catch(e){}}render();document.getElementById('import-status').innerHTML='<div class="result" style="background:#F0FDF4;color:#065F46">\\u{1F389} ส่งสำเร็จ '+ok+' งาน</div>';document.getElementById('import-preview').innerHTML='';document.getElementById('import-actions').classList.add('hidden');importedLines=[];btn.disabled=false;btn.textContent='\\u{1F4E4} ส่งงานทั้งหมดให้เจ้านาย';}
function showTest(){document.getElementById('test-modal').classList.remove('hidden');}
function hideTest(){document.getElementById('test-modal').classList.add('hidden');}
async function testLine(t){document.getElementById('test-result').innerHTML='<div class="result" style="background:#EFF6FF;color:#1E40AF">กำลังส่ง...</div>';try{const r=await fetch('/api/test-line',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({target:t})});const d=await r.json();document.getElementById('test-result').innerHTML='<div class="result" style="background:'+(d.success?'#F0FDF4;color:#065F46':'#FEF2F2;color:#991B1B')+'">'+(d.success?'\\u{1F389} ':'\\u274C ')+(d.message||d.error)+'</div>';}catch(e){document.getElementById('test-result').innerHTML='<div class="result" style="background:#FEF2F2;color:#991B1B">\\u274C '+e.message+'</div>';}}
async function triggerDaily(){document.getElementById('test-result').innerHTML='<div class="result" style="background:#EFF6FF;color:#1E40AF">กำลังส่งสรุป...</div>';try{await fetch('/api/daily-summary',{method:'POST'});document.getElementById('test-result').innerHTML='<div class="result" style="background:#F0FDF4;color:#065F46">\\u{1F389} ส่งสรุปแล้ว!</div>';}catch(e){document.getElementById('test-result').innerHTML='<div class="result" style="background:#FEF2F2;color:#991B1B">\\u274C '+e.message+'</div>';}}
loadTasks();
</script></body></html>`);
});

// ========== API ==========
app.post('/api/import-docx', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'ไม่พบไฟล์' });
    const result = await mammoth.extractRawText({ buffer: req.file.buffer });
    const lines = (result.value || '').split(/\n/).map(l => l.trim()).filter(l => l.length > 2);
    const parsed = lines.map(line => {
      const di = line.indexOf(' - '); const ci = line.indexOf(': ');
      if (di > 0 && di < 60) return { title: line.slice(0, di).trim(), detail: line.slice(di + 3).trim() };
      if (ci > 0 && ci < 60) return { title: line.slice(0, ci).trim(), detail: line.slice(ci + 2).trim() };
      if (line.length <= 80) return { title: line, detail: '' };
      return { title: line.slice(0, 60).trim(), detail: line.slice(60).trim() };
    });
    res.json({ success: true, lines: parsed });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/tasks', async (req, res) => {
  try {
    const BASE = req.protocol + '://' + req.get('host');
    const task = { id: genId(), category: req.body.category || 'normal', title: req.body.title, detail: req.body.detail || '', dueDate: req.body.dueDate || null, dueTime: req.body.dueTime || null, from: req.body.from || null, status: 'sent', reply: null, imageUrl: null, createdAt: new Date().toISOString(), doneAt: null };
    if (req.body.imageBase64) { const imgId = 'img_' + task.id; uploadedImages[imgId] = req.body.imageBase64; task.imageUrl = BASE + '/img/' + imgId; }
    await dbInsert(task);
    const isQ = task.category === 'question';
    let msg = (CL[task.category]||'งาน')+'\n━━━━━━━━━━━━━━\n\u{1F4CC} '+task.title+'\n';
    if (task.detail) msg += '\u{1F4DD} '+task.detail+'\n';
    if (task.dueDate) msg += '\u23F0 กำหนด: '+task.dueDate+' '+(task.dueTime||'')+'\n';
    if (task.from) msg += '\u{1F464} จาก: '+task.from+'\n';
    msg += '━━━━━━━━━━━━━━\n';
    msg += isQ ? '\u{1F447} กดปุ่ม "ตอบคำถามนี้" ด้านล่าง' : '\u{1F447} กดปุ่ม "ทำเสร็จแล้ว" ด้านล่าง';
    if (task.imageUrl) msg += '\n\u{1F4F7} ดูรูปแนบ: ' + task.imageUrl;
    const qr = { items: [{ type: 'action', action: { type: 'message', label: isQ ? '\u{1F4AC} ตอบคำถามนี้' : '\u2705 ทำเสร็จแล้ว', text: isQ ? 'ตอบ ' + task.id.slice(-4) : 'เสร็จ ' + task.id.slice(-4) } }, { type: 'action', action: { type: 'message', label: '\u{1F4CB} ดูงานทั้งหมด', text: 'งาน' } }] };
    await pushLine(BOSS, [{ type: 'text', text: msg, quickReply: qr }]);
    res.json({ success: true, task });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

app.get('/api/tasks', async (req, res) => { res.json(await dbGetAll()); });

app.patch('/api/tasks/:id', async (req, res) => {
  const updates = {};
  if (req.body.status) updates.status = req.body.status;
  if (req.body.reply) updates.reply = req.body.reply;
  if (updates.status === 'done' || updates.status === 'replied') updates.doneAt = new Date().toISOString();
  await dbUpdate(req.params.id, updates);
  res.json({ success: true });
});

app.post('/api/daily-summary', async (req, res) => { try { await sendDailySummary(); res.json({ success: true }); } catch (err) { res.status(500).json({ error: err.message }); } });

app.post('/api/test-line', async (req, res) => {
  try {
    const target = req.body.target || 'boss'; const userId = target === 'secretary' ? SEC : BOSS;
    const name = target === 'secretary' ? 'เลขา (ป๊อปปี้)' : 'เจ้านาย';
    const ok = await pushLine(userId, '\u{1F9EA} ทดสอบจาก Boss Task Manager\n━━━━━━━━━━━━━━\n\u{1F4E9} ส่งถึง: '+name+'\n\u23F0 '+fmtDate()+'\n\u2705 ระบบเชื่อมต่อสำเร็จ!\n\u{1F512} ฐานข้อมูล Supabase พร้อม');
    res.json({ success: ok, message: ok ? 'ส่งถึง'+name+'แล้ว' : 'ส่งไม่สำเร็จ' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ========== WEBHOOK ==========
app.post('/webhook', (req, res) => {
  const events = req.body.events || [];
  events.forEach(async (event) => {
    if (event.type !== 'message' || event.message.type !== 'text') return;
    const text = event.message.text.trim(); const rt = event.replyToken; const userId = event.source.userId;
    const tasks = await dbGetAll();

    if (bossReplyState[userId]) {
      const code = bossReplyState[userId]; delete bossReplyState[userId];
      const task = tasks.find(t => t.id.slice(-4) === code && t.category === 'question' && t.status !== 'replied');
      if (task) {
        await dbUpdate(task.id, { status: 'replied', reply: text, doneAt: new Date().toISOString() });
        const remaining = tasks.filter(t => t.id !== task.id && t.status !== 'done' && t.status !== 'replied').length;
        const qr = remaining > 0 ? { items: [{ type: 'action', action: { type: 'message', label: '\u{1F4CB} ดูงานที่เหลือ', text: 'งาน' } }] } : undefined;
        await replyLine(rt, [{ type: 'text', text: '\u{1F4AC} ส่งคำตอบเรียบร้อย!\n\u{1F4CC} '+task.title+'\n\u{1F4AC} "'+text+'"\n\u{1F4E9} แจ้งเลขาแล้ว', quickReply: qr }]);
        await pushLine(SEC, '\u{1F4AC} เจ้านายตอบคำถามแล้ว\n━━━━━━━━━━━━━━\n\u{1F4CC} '+task.title+'\n\u{1F4AC} คำตอบ: '+text+'\n'+(task.from?'\u{1F464} ถามโดย: '+task.from+'\n':'')+'━━━━━━━━━━━━━━\n\u{1F4E9} ส่งต่อคำตอบให้ทีมได้เลย');
      } else { await replyLine(rt, [{ type: 'text', text: '\u274C คำถามนี้ถูกตอบไปแล้ว' }]); }
      return;
    }

    if (text.startsWith('เสร็จ') || text.startsWith('done')) {
      const code = text.replace(/^(done|เสร็จ)\s*/i, '').trim();
      const task = tasks.find(t => t.id.slice(-4) === code && t.status !== 'done' && t.status !== 'replied');
      if (task) {
        if (task.category === 'question') { bossReplyState[userId] = code; await replyLine(rt, [{ type: 'text', text: '\u{1F4AC} คำถาม: "'+task.title+'"\n'+(task.from?'\u{1F464} จาก: '+task.from+'\n':'')+'\n\u{1F447} พิมพ์คำตอบแล้วกดส่งเลยครับ' }]); return; }
        await dbUpdate(task.id, { status: 'done', doneAt: new Date().toISOString() });
        const remaining = tasks.filter(t => t.id !== task.id && t.status !== 'done' && t.status !== 'replied').length;
        const qr = remaining > 0 ? { items: [{ type: 'action', action: { type: 'message', label: '\u{1F4CB} ดูงานที่เหลือ', text: 'งาน' } }] } : undefined;
        await replyLine(rt, [{ type: 'text', text: '\u2705 เรียบร้อย! "'+task.title+'" เสร็จแล้ว\n\u{1F4CB} งานค้างเหลือ: '+remaining+' รายการ', quickReply: qr }]);
        await pushLine(SEC, '\u2705 เจ้านายทำงานเสร็จแล้ว\n━━━━━━━━━━━━━━\n\u{1F4CC} '+task.title+'\n\u23F0 เสร็จเมื่อ: '+fmtDate()+'\n━━━━━━━━━━━━━━\n\u{1F4CB} งานค้างคงเหลือ: '+remaining+' รายการ');
      } else { await replyLine(rt, [{ type: 'text', text: '\u274C ไม่พบงานรหัส "'+code+'"' }]); }
      return;
    }

    if (text.startsWith('ตอบ') || text.startsWith('reply')) {
      const rest = text.replace(/^(reply|ตอบ)\s*/i, '').trim(); const ci = rest.indexOf(':');
      if (ci !== -1 && rest.slice(ci + 1).trim()) {
        const code = rest.slice(0, ci).trim(); const reply = rest.slice(ci + 1).trim();
        const task = tasks.find(t => t.id.slice(-4) === code && t.category === 'question');
        if (task) {
          await dbUpdate(task.id, { status: 'replied', reply, doneAt: new Date().toISOString() });
          const remaining = tasks.filter(t => t.id !== task.id && t.status !== 'done' && t.status !== 'replied').length;
          const qr = remaining > 0 ? { items: [{ type: 'action', action: { type: 'message', label: '\u{1F4CB} ดูงานที่เหลือ', text: 'งาน' } }] } : undefined;
          await replyLine(rt, [{ type: 'text', text: '\u{1F4AC} ส่งคำตอบเรียบร้อย!\n\u{1F4CC} '+task.title+'\n\u{1F4AC} "'+reply+'"', quickReply: qr }]);
          await pushLine(SEC, '\u{1F4AC} เจ้านายตอบคำถามแล้ว\n━━━━━━━━━━━━━━\n\u{1F4CC} '+task.title+'\n\u{1F4AC} คำตอบ: '+reply+'\n'+(task.from?'\u{1F464} ถามโดย: '+task.from+'\n':'')+'━━━━━━━━━━━━━━\n\u{1F4E9} ส่งต่อให้ทีมได้เลย');
        } else { await replyLine(rt, [{ type: 'text', text: '\u274C ไม่พบคำถามรหัสนี้' }]); }
        return;
      }
      const code = rest.replace(':', '').trim();
      const task = tasks.find(t => t.id.slice(-4) === code && t.category === 'question' && t.status !== 'replied');
      if (task) { bossReplyState[userId] = code; await replyLine(rt, [{ type: 'text', text: '\u{1F4AC} คำถาม: "'+task.title+'"\n'+(task.from?'\u{1F464} จาก: '+task.from+'\n':'')+(task.detail?'\u{1F4DD} '+task.detail+'\n':'')+'\n\u{1F447} พิมพ์คำตอบแล้วกดส่งเลยครับ' }]); }
      else { await replyLine(rt, [{ type: 'text', text: '\u274C ไม่พบคำถามรหัสนี้' }]); }
      return;
    }

    await replyLine(rt, await buildTaskListFlex());
  });
  res.json({ ok: true });
});

// ========== DAILY CRON ==========
async function sendDailySummary() {
  const tasks = await dbGetAll();
  const pending = tasks.filter(t => t.status !== 'done' && t.status !== 'replied');
  if (!pending.length) return;
  let msg = '\u{1F305} สรุปงานประจำวัน (08:30)\n━━━━━━━━━━━━━━\n\u{1F4CB} งานค้าง '+pending.length+' รายการ\n\n';
  pending.forEach((t, i) => { msg += (i+1)+'. '+(CE[t.category]||'')+' '+t.title+'\n'; });
  msg += '\n━━━━━━━━━━━━━━\n\u{1F447} กดปุ่มด้านล่างเพื่อเลือกงาน';
  const qr = { items: [] };
  pending.slice(0, 13).forEach(t => { const isQ = t.category === 'question'; qr.items.push({ type: 'action', action: { type: 'message', label: (isQ?'\u{1F4AC}ตอบ ':'\u2705เสร็จ ')+t.title.slice(0,14), text: isQ?'ตอบ '+t.id.slice(-4):'เสร็จ '+t.id.slice(-4) } }); });
  await pushLine(BOSS, [{ type: 'text', text: msg, quickReply: qr }]);
  await pushLine(SEC, '\u{1F4E9} สำเนาสรุปงาน (ส่งเจ้านายแล้ว)\n\n'+msg);
}
cron.schedule('30 8 * * *', () => { sendDailySummary().catch(e => console.error(e)); }, { timezone: 'Asia/Bangkok' });
app.listen(PORT, () => { console.log('Boss Task Manager v5 (Supabase) running on port '+PORT); });
