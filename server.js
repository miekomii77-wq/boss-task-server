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
app.use(cors());
app.use(express.json());

// ─── Helper: send LINE push message ───
async function pushLine(to, text) {
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + TOKEN },
    body: JSON.stringify({ to, messages: [{ type: 'text', text }] }),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error('LINE push error:', err);
  }
  return res.ok;
}

// ─── Helper: reply LINE message ───
async function replyLine(replyToken, text) {
  await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + TOKEN },
    body: JSON.stringify({ replyToken, messages: [{ type: 'text', text }] }),
  });
}

// ─── Helper: generate task ID ───
function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

// ─── Helper: format date Thai ───
function fmtDate() { return new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }); }

// ============================================================
// API: Health check
// ============================================================
app.get('/', (req, res) => {
  res.json({
    status: 'Boss Task Manager is running!',
    tasks: tasks.length,
    pending: tasks.filter(t => t.status !== 'done' && t.status !== 'replied').length,
  });
});

// ============================================================
// API: Add task + send LINE to boss
// ============================================================
app.post('/api/tasks', async (req, res) => {
  try {
    const task = { id: genId(), ...req.body, status: 'sent', reply: null, createdAt: new Date().toISOString(), doneAt: null };
    tasks.push(task);

    const cat = { urgent: '🔴 งานด่วน', normal: '🔵 งานทั่วไป', question: '💬 คำถามจากทีม', schedule: '📅 ตารางงาน' };
    let msg = `${cat[task.category] || '📌 งาน'}\n━━━━━━━━━━━━━━\n📌 ${task.title}\n`;
    if (task.detail) msg += `📝 ${task.detail}\n`;
    if (task.dueDate) msg += `⏰ กำหนด: ${task.dueDate} ${task.dueTime || ''}\n`;
    if (task.from) msg += `👤 จาก: ${task.from}\n`;
    msg += `━━━━━━━━━━━━━━\n`;
    msg += task.category === 'question'
      ? `💬 ตอบ: พิมพ์ "ตอบ ${task.id.slice(-4)}: [คำตอบ]"`
      : `✅ เสร็จ: พิมพ์ "เสร็จ ${task.id.slice(-4)}"`;

    await pushLine(BOSS, msg);
    console.log(`📤 ส่งงาน "${task.title}" → เจ้านาย`);
    res.json({ success: true, task });
  } catch (err) {
    console.error('Add task error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// API: Get all tasks
// ============================================================
app.get('/api/tasks', (req, res) => res.json(tasks));

// ============================================================
// API: Update task
// ============================================================
app.patch('/api/tasks/:id', async (req, res) => {
  const task = tasks.find(t => t.id === req.params.id);
  if (!task) return res.status(404).json({ error: 'Not found' });
  if (req.body.status) task.status = req.body.status;
  if (req.body.reply) task.reply = req.body.reply;
  if (task.status === 'done' || task.status === 'replied') task.doneAt = new Date().toISOString();
  res.json({ success: true, task });
});

// ============================================================
// API: Send daily summary now
// ============================================================
app.post('/api/daily-summary', async (req, res) => {
  try { await sendDailySummary(); res.json({ success: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// API: Test LINE connection
// ============================================================
app.post('/api/test-line', async (req, res) => {
  try {
    const target = req.body.target || 'boss';
    const userId = target === 'secretary' ? SEC : BOSS;
    const name = target === 'secretary' ? 'เลขา (ป๊อปปี้)' : 'เจ้านาย';
    const ok = await pushLine(userId, `🧪 ทดสอบจาก Boss Task Manager\n━━━━━━━━━━━━━━\n📩 ส่งถึง: ${name}\n⏰ ${fmtDate()}\n✅ ระบบเชื่อมต่อสำเร็จ!`);
    res.json({ success: ok, message: ok ? `ส่งถึง${name}แล้ว` : 'ส่งไม่สำเร็จ' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// WEBHOOK: Boss replies via LINE
// ============================================================
app.post('/webhook', (req, res) => {
  const events = req.body.events || [];
  events.forEach(async (event) => {
    if (event.type !== 'message' || event.message.type !== 'text') return;
    const text = event.message.text.trim();
    const replyToken = event.replyToken;

    console.log(`📨 LINE message: "${text}"`);

    // ─── "เสร็จ XXXX" ───
    if (text.startsWith('เสร็จ')) {
      const code = text.replace('เสร็จ', '').trim();
      const task = tasks.find(t => t.id.slice(-4) === code && t.status !== 'done' && t.status !== 'replied');
      if (task) {
        task.status = 'done';
        task.doneAt = new Date().toISOString();
        const remaining = tasks.filter(t => t.status !== 'done' && t.status !== 'replied').length;

        await replyLine(replyToken, `✅ เรียบร้อย! "${task.title}" เสร็จแล้ว`);

        // 📩 แจ้งเลขาผ่าน LINE
        await pushLine(SEC,
          `✅ เจ้านายทำงานเสร็จแล้ว\n━━━━━━━━━━━━━━\n📌 ${task.title}\n${task.detail ? '📝 ' + task.detail + '\n' : ''}⏰ เสร็จเมื่อ: ${fmtDate()}\n━━━━━━━━━━━━━━\n📋 งานค้างคงเหลือ: ${remaining} รายการ`
        );
        console.log(`✅ "${task.title}" done → แจ้งเลขาแล้ว`);
      } else {
        await replyLine(replyToken, `❌ ไม่พบงานรหัส "${code}"`);
      }
      return;
    }

    // ─── "ตอบ XXXX: คำตอบ" ───
    if (text.startsWith('ตอบ')) {
      const rest = text.slice(3).trim();
      const colonIdx = rest.indexOf(':');
      if (colonIdx === -1) {
        await replyLine(replyToken, `❓ รูปแบบ: ตอบ XXXX: คำตอบ\nเช่น: ตอบ A1B2: อนุมัติครับ`);
        return;
      }
      const code = rest.slice(0, colonIdx).trim();
      const reply = rest.slice(colonIdx + 1).trim();
      const task = tasks.find(t => t.id.slice(-4) === code && t.category === 'question');
      if (task && reply) {
        task.status = 'replied';
        task.reply = reply;
        task.doneAt = new Date().toISOString();

        await replyLine(replyToken, `💬 ส่งคำตอบเรียบร้อย!\n📌 ${task.title}\n💬 "${reply}"`);

        // 📩 แจ้งเลขาผ่าน LINE
        await pushLine(SEC,
          `💬 เจ้านายตอบคำถามแล้ว\n━━━━━━━━━━━━━━\n📌 ${task.title}\n💬 คำตอบ: ${reply}\n${task.from ? '👤 ถามโดย: ' + task.from + '\n' : ''}━━━━━━━━━━━━━━\n📩 ส่งต่อคำตอบให้ทีมได้เลย`
        );
        console.log(`💬 "${task.title}" replied → แจ้งเลขาแล้ว`);
      } else {
        await replyLine(replyToken, `❌ ไม่พบคำถามรหัส "${code}"`);
      }
      return;
    }

    // ─── Other messages → show menu ───
    const pending = tasks.filter(t => t.status !== 'done' && t.status !== 'replied');
    let menu = `📋 งานค้าง ${pending.length} รายการ\n━━━━━━━━━━━━━━\n`;
    if (!pending.length) { menu += '🎉 ไม่มีงานค้าง!\n'; }
    else {
      const emoji = { urgent: '🔴', normal: '🔵', question: '💬', schedule: '📅' };
      pending.forEach((t, i) => { menu += `${i + 1}. ${emoji[t.category] || '📌'} ${t.title} [${t.id.slice(-4)}]\n`; });
    }
    menu += `━━━━━━━━━━━━━━\n📖 คำสั่ง:\n• "เสร็จ XXXX" → ติ๊กเสร็จ\n• "ตอบ XXXX: คำตอบ" → ตอบคำถาม`;
    await replyLine(replyToken, menu);
  });
  res.json({ ok: true });
});

// ============================================================
// CRON: Daily summary at 08:30 Bangkok time
// ============================================================
async function sendDailySummary() {
  const pending = tasks.filter(t => t.status !== 'done' && t.status !== 'replied');
  if (!pending.length) { console.log('🌅 ไม่มีงานค้าง'); return; }

  const emoji = { urgent: '🔴', normal: '🔵', question: '💬', schedule: '📅' };
  let msg = `🌅 สรุปงานประจำวัน (08:30)\n━━━━━━━━━━━━━━\n📋 งานค้าง ${pending.length} รายการ\n\n`;
  pending.forEach((t, i) => { msg += `${i + 1}. ${emoji[t.category] || '📌'} ${t.title} [${t.id.slice(-4)}]\n`; });
  msg += `\n━━━━━━━━━━━━━━\nตอบ "เสร็จ [ID]" เพื่อติ๊กเสร็จ`;

  await pushLine(BOSS, msg);
  await pushLine(SEC, `📩 สำเนาสรุปงาน (ส่งเจ้านายแล้ว)\n\n${msg}`);
  console.log(`🌅 ส่งสรุปงาน ${pending.length} รายการ → เจ้านาย + เลขา`);
}

cron.schedule('30 8 * * *', () => {
  console.log('⏰ 08:30 — ส่งสรุปงานประจำวัน');
  sendDailySummary().catch(err => console.error('Cron error:', err.message));
}, { timezone: 'Asia/Bangkok' });

// ============================================================
// START
// ============================================================
app.listen(PORT, () => {
  console.log('');
  console.log('══════════════════════════════════════');
  console.log('  🚀 Boss Task Manager — LINE Server');
  console.log(`  📡 Port ${PORT}`);
  console.log(`  👔 Boss: ${BOSS ? '✅' : '❌'}`);
  console.log(`  💼 Secretary: ${SEC ? '✅' : '❌'}`);
  console.log(`  🌅 Daily summary: 08:30 Bangkok`);
  console.log('══════════════════════════════════════');
});
