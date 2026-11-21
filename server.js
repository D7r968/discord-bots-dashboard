'use strict';

const express = require('express');
const path = require('path');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ─────────────────────────────────────────────
// الإعدادات
// ─────────────────────────────────────────────
const GH_TOKEN = process.env.GH_TOKEN || '';
const GH_OWNER = process.env.GH_OWNER || 'D7r968';
const GH_REPO = process.env.GH_REPO || 'discord-bots-dashboard';
const RENDER_KEY = process.env.RENDER_KEY || '';
const LOG_TOKEN = process.env.LOG_TOKEN || 'change-me';

const BOTS = {
  security: {
    id: process.env.SERVICE_SECURITY || 'srv-dc0rc0avcj2c73bhkucg',
    health: process.env.SECURITY_HEALTH || 'https://abuabdulaziz-security-bot.onrender.com/',
    invite:
      'https://discord.com/oauth2/authorize?client_id=1572299572229840978&scope=bot%20applications.commands&permissions=8'
  },
  ticket: {
    id: process.env.SERVICE_TICKET || 'srv-dc0qicuc6qcc73f5m0tg',
    health: process.env.TICKET_HEALTH || 'https://discord-ticket-bot-v2-3uzx.onrender.com/',
    invite:
      'https://discord.com/oauth2/authorize?client_id=1573686274420769012&scope=bot%20applications.commands&permissions=8'
  }
};

const DEFAULT_SETTINGS = {
  security: {
    ownerId: '',
    guildId: '',
    logChannelId: '',
    instantResponse: {
      enabled: true,
      alertEnabled: true,
      deleteWindowMs: 60000,
      deleteThreshold: 2,
      spamWindowMs: 5000,
      spamThreshold: 10,
      spamTimeoutMinutes: 10,
      channelCreateWindowMs: 10000,
      channelCreateThreshold: 3,
      kickBotsOnJoin: true,
      slowSpamWindowMs: 60000,
      slowSpamThreshold: 20,
      massBanThreshold: 2,
      massBanWindowMs: 60000,
      massKickThreshold: 3,
      massKickWindowMs: 60000,
      webhookStrikes: 1,
      emojiStrikes: 1,
      permissionEditStrikes: 1
    },
    protectionSettings: {
      roleProtection: true,
      channelProtection: true,
      memberProtection: true,
      messageProtection: true,
      emojiProtection: true,
      webhookProtection: true,
      banProtection: true,
      kickProtection: true
    },
    protectAllowed: []
  },
  ticket: {
    supportRoleId: '',
    categoryId: '',
    logChannelId: '',
    ticketLimit: 1,
    color: '#5865F2',
    panelTitle: '🎫 الدعم الفني',
    panelDescription: 'اضغط على الزر بالأسفل عشان تفتح تذكرة،\nوبيرد عليك فريق الدعم في أقرب وقت ممكن.',
    panelButtonLabel: 'افتح تذكرة',
    ticketWelcomeTitle: '🎫 تذكرتك جاهزة',
    ticketWelcomeDescription: 'اكتب تفاصيلك هنا، وأرفق أي صور أو ملفات تساعدنا نفهم طلبك.\nفريق الدعم بيوصلك قريب إن شاء الله.',
    mentionWarnHours: 24,
    mentionTimeoutHours: 3,
    mentionTimeoutEnabled: true
  }
};

let settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
const events = [];
const MAX_EVENTS = 200;

// ─────────────────────────────────────────────
// تخزين الإعدادات في GitHub عشان تبقى بعد إعادة التشغيل
// ─────────────────────────────────────────────
const ghHeaders = {
  Authorization: `Bearer ${GH_TOKEN}`,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'discord-bots-dashboard',
  'X-GitHub-Api-Version': '2022-11-28'
};
const settingsUrl = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/settings.json`;

async function loadSettings() {
  if (!GH_TOKEN) return;
  try {
    const res = await fetch(settingsUrl, { headers: ghHeaders, signal: AbortSignal.timeout(10000) });
    if (!res.ok) return;
    const json = await res.json();
    const parsed = JSON.parse(Buffer.from(json.content, 'base64').toString('utf8'));
    settings.security = { ...DEFAULT_SETTINGS.security, ...(parsed.security || {}) };
    settings.ticket = { ...DEFAULT_SETTINGS.ticket, ...(parsed.ticket || {}) };
    console.log('[i] تم تحميل الإعدادات من GitHub');
  } catch (err) {
    console.error('[!] فشل تحميل الإعدادات:', err.message);
  }
}

async function saveSettings() {
  if (!GH_TOKEN) return;
  try {
    let sha;
    const current = await fetch(settingsUrl, { headers: ghHeaders, signal: AbortSignal.timeout(10000) });
    if (current.ok) sha = (await current.json()).sha;

    const body = {
      message: 'Update bot settings from dashboard',
      content: Buffer.from(JSON.stringify(settings, null, 2)).toString('base64')
    };
    if (sha) body.sha = sha;

    const res = await fetch(settingsUrl, {
      method: 'PUT',
      headers: ghHeaders,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) throw new Error((await res.text()).slice(0, 200));
    console.log('[i] تم حفظ الإعدادات في GitHub');
  } catch (err) {
    console.error('[!] فشل حفظ الإعدادات:', err.message);
    throw err;
  }
}

function mergeDeep(target, source) {
  for (const [key, value] of Object.entries(source || {})) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (!target[key] || typeof target[key] !== 'object') target[key] = {};
      mergeDeep(target[key], value);
    } else {
      target[key] = value;
    }
  }
  return target;
}

// ─────────────────────────────────────────────
// endpoints
// ─────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptimeSeconds: Math.floor(process.uptime()), events: events.length });
});

app.get('/api/state', async (req, res) => {
  const status = {};
  for (const [name, bot] of Object.entries(BOTS)) {
    try {
      const r = await fetch(bot.health, { signal: AbortSignal.timeout(8000) });
      status[name] = { online: r.ok, data: await r.json() };
    } catch (err) {
      status[name] = { online: false, error: err.message };
    }
  }
  res.json({ settings, status, events: events.slice().reverse(), bots: BOTS });
});

app.get('/api/settings/:bot', (req, res) => {
  const bot = req.params.bot;
  if (!settings[bot]) return res.status(404).json({ error: 'unknown bot' });
  res.json(settings[bot]);
});

app.post('/api/settings/:bot', async (req, res) => {
  const bot = req.params.bot;
  if (!settings[bot]) return res.status(404).json({ error: 'unknown bot' });
  try {
    mergeDeep(settings[bot], req.body);
    await saveSettings();
    res.json({ ok: true, settings: settings[bot] });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/restart/:bot', async (req, res) => {
  const bot = BOTS[req.params.bot];
  if (!bot) return res.status(404).json({ error: 'unknown bot' });
  if (!RENDER_KEY) return res.status(500).json({ error: 'RENDER_KEY not configured' });
  try {
    const r = await fetch(`https://api.render.com/v1/services/${bot.id}/deploys`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RENDER_KEY}`,
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: '{}',
      signal: AbortSignal.timeout(20000)
    });
    const text = await r.text();
    events.unshift({
      ts: Date.now(),
      bot: req.params.bot,
      type: 'restart',
      title: '🔄 إعادة نشر',
      description: `${req.params.bot} → ${r.ok ? 'تم الطلب' : 'فشل'}`
    });
    res.json({ ok: r.ok, detail: text.slice(0, 300) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// البوتات تبعت الأحداث هنا
app.post('/api/log', (req, res) => {
  if (String(req.header('x-log-token') || '') !== String(LOG_TOKEN)) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const e = req.body || {};
  events.unshift({
    ts: e.ts || Date.now(),
    bot: e.bot || 'security',
    type: e.type || 'info',
    title: String(e.title || 'حدث').slice(0, 120),
    description: String(e.description || '').slice(0, 600),
    color: e.color || '#FF0000'
  });
  if (events.length > MAX_EVENTS) events.length = MAX_EVENTS;
  res.json({ ok: true });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─────────────────────────────────────────────
const PORT = Number(process.env.PORT) || 3000;
loadSettings().finally(() => {
  app.listen(PORT, '0.0.0.0', () => console.log(`[i] dashboard on ${PORT}`));

  // self-ping عشان الخدمة المجانية ما ترقد
  const selfUrl = String(process.env.SELF_PING_URL || '').trim();
  if (selfUrl) {
    setInterval(async () => {
      try {
        await fetch(selfUrl, { signal: AbortSignal.timeout(15000) });
      } catch (err) {
        console.error('[!] self ping failed:', err.message);
      }
    }, 5 * 60 * 1000).unref();
    console.log('[i] self ping: ' + selfUrl);
  }
});
