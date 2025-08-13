import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import PDFDocument from 'pdfkit';

/** ───────────────────── Setup ───────────────────── **/
const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Sanitize key (strip <> and whitespace)
const RAW_OPENAI = process.env.OPENAI_API_KEY || '';
const OPENAI_API_KEY = RAW_OPENAI.trim().replace(/[<>]/g, '');
const mask = (k) => (k ? `${k.slice(0, 10)}...${k.slice(-4)}` : '(missing)');
console.log('OPENAI_API_KEY raw (masked):', mask(RAW_OPENAI));
console.log('OPENAI_API_KEY used (masked):', mask(OPENAI_API_KEY));

/** ───────────────────── Utils ───────────────────── **/
const SIGNS = [
  'aries','taurus','gemini','cancer','leo','virgo',
  'libra','scorpio','sagittarius','capricorn','aquarius','pisces'
];

function istDateKey(d = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit'
  });
  return fmt.format(d); // YYYY-MM-DD
}
function weekdayIST(d = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', weekday: 'short' });
  const w = fmt.format(d).toLowerCase();
  return ['sun','mon','tue','wed','thu','fri','sat'].findIndex(x => w.startsWith(x));
}
function addDaysIST(n) {
  const now = new Date();
  // Convert IST day boundary roughly by adding offset in ms (IST = UTC+5:30)
  const istNow = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
  const future = new Date(istNow.getTime() + n * 24 * 60 * 60 * 1000);
  // Return real Date (UTC) shifted back
  return new Date(future.getTime() - (5.5 * 60 * 60 * 1000));
}

// Fixed Vedic time slots (common Indian panchang convention)
function vedicTimesForDayIndex(dayIndex /*0=Sun..6=Sat*/) {
  const rahu = [
    '16:30–18:00', '07:30–09:00', '15:00–16:30', '12:00–13:30',
    '13:30–15:00', '10:30–12:00', '09:00–10:30',
  ];
  const yamaganda = [
    '12:00–13:30', '10:30–12:00', '09:00–10:30', '07:30–09:00',
    '06:00–07:30', '15:00–16:30', '13:30–15:00',
  ];
  const gulika = [
    '15:00–16:30', '13:30–15:00', '12:00–13:30', '10:30–12:00',
    '09:00–10:30', '07:30–09:00', '06:00–07:30',
  ];
  const abhijit = '12:05–12:52';
  return {
    rahuKaal: rahu[dayIndex],
    yamaganda: yamaganda[dayIndex],
    gulikaKaal: gulika[dayIndex],
    abhijitMuhurat: abhijit,
  };
}
function prettySign(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

/** ───────────────── Daily cache (per IST day) ─────────────── **/
let dailyCacheDate = null; // 'YYYY-MM-DD'
let dailyCache = {};       // { sign: { text, generatedAtISO } }

function ensureNewDay() {
  const today = istDateKey();
  if (dailyCacheDate !== today) {
    dailyCacheDate = today;
    dailyCache = {};
  }
}

async function generateDailyTextForDate(sign, dateISO) {
  // On-server fallback
  if (!OPENAI_API_KEY) {
    return `${prettySign(sign)}: Keep your focus tight, avoid overpromising, and take one kind action today. • Opportunities: tidy, help, learn • Cautions: rushing • Remedy: 11 calm breaths.`;
  }
  const system = [
    `You are Astro-Baba, a practical Vedic astrology guide.`,
    `Write a daily horoscope for "${prettySign(sign)}" in modern English.`,
    `Length: ~120–160 words, then exactly 3 bullets: Opportunities, Cautions, Remedy.`,
    `No medical/financial guarantees. Positive, grounded, culturally sensitive for India.`,
  ].join('\n');
  const user = `Date (IST): ${dateISO}. Focus only on ${prettySign(sign)}.`;
  const payload = {
    model: 'gpt-4o-mini',
    temperature: 0.6,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    stream: false
  };
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!r.ok) {
    const t = await r.text();
    console.error('daily gen error', r.status, t);
    return `${prettySign(sign)}: Focus on essentials and act calmly. • Opportunities: help someone • Cautions: impulse decisions • Remedy: drink water and breathe.`;
  }
  const j = await r.json();
  return j?.choices?.[0]?.message?.content ?? '';
}

async function ensureDailyForToday(sign) {
  ensureNewDay();
  if (!dailyCache[sign]) {
    const text = await generateDailyTextForDate(sign, dailyCacheDate);
    dailyCache[sign] = { text, generatedAtISO: new Date().toISOString() };
  }
}

/** ───────────────── Health & debug ───────────────────── **/
app.get('/', (_req, res) => res.json({ ok: true, service: 'Astro-Baba Chat API' }));

/** ───────────────── Daily endpoints ───────────────────── **/
app.get('/daily', async (req, res) => {
  try {
    const sign = String((req.query.sign || '')).toLowerCase();
    if (!SIGNS.includes(sign)) {
      return res.status(400).json({ error: 'Invalid sign. Use: ' + SIGNS.join(', ') });
    }
    ensureNewDay();
    await ensureDailyForToday(sign);
    const dayIdx = weekdayIST();
    const timings = vedicTimesForDayIndex(dayIdx);
    res.json({
      date: dailyCacheDate,
      sign,
      text: dailyCache[sign].text,
      vedic: timings,
      generatedAt: dailyCache[sign].generatedAtISO,
    });
  } catch (e) {
    console.error('GET /daily error', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// Weekly JSON: today (cached) + next 6 days
app.get('/weekly', async (req, res) => {
  try {
    const sign = String((req.query.sign || '')).toLowerCase();
    if (!SIGNS.includes(sign)) {
      return res.status(400).json({ error: 'Invalid sign. Use: ' + SIGNS.join(', ') });
    }
    ensureNewDay();
    await ensureDailyForToday(sign);

    const days = [];
    for (let i = 0; i < 7; i++) {
      const dateISO = istDateKey(addDaysIST(i));
      const dow = weekdayIST(addDaysIST(i));
      const vedic = vedicTimesForDayIndex(dow);
      if (i === 0) {
        days.push({ date: dateISO, text: dailyCache[sign].text, vedic });
      } else {
        const t = await generateDailyTextForDate(sign, dateISO);
        days.push({ date: dateISO, text: t, vedic });
      }
    }
    res.json({ sign, days });
  } catch (e) {
    console.error('GET /weekly error', e);
    res.status(500).json({ error: 'Server error' });
  }
});

/** ───────────── PDF helpers ───────────── **/
function nowInISTText() {
  const fmt = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
  return fmt.format(new Date());
}
function stripDataUrlPrefix(b64) {
  if (!b64) return null;
  const idx = b64.indexOf('base64,');
  return idx >= 0 ? b64.slice(idx + 7) : b64;
}

/** ─────── PDF: from cached daily (fast) ─────── **/
app.post('/report/from-daily', async (req, res) => {
  try {
    const { sign = 'aries', user = {}, brand = {} } = req.body || {};
    const s = String(sign).toLowerCase();
    if (!SIGNS.includes(s)) return res.status(400).json({ error: 'Invalid sign' });
    ensureNewDay();
    await ensureDailyForToday(s);

    const userName = user.name || 'Friend';
    const phone = user.phone || '';
    const appName = brand.appName || 'Astro-Baba';
    const logoBase64 = stripDataUrlPrefix(brand.logoBase64 || null);
    const logoUrl = brand.logoUrl || null;

    const dayIdx = weekdayIST();
    const timings = vedicTimesForDayIndex(dayIdx);
    const text = dailyCache[s].text;

    const fname = `${appName.replace(/\s+/g,'_')}_daily_${s}_${Date.now()}.pdf`;
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${fname}"`,
      'Cache-Control': 'no-store'
    });

    const doc = new PDFDocument({ size: 'A4', margins: { top: 56, left: 56, right: 56, bottom: 56 }});
    doc.pipe(res);

    // Logo
    if (logoBase64 || logoUrl) {
      try {
        let logoBuf = null;
        if (logoBase64) logoBuf = Buffer.from(logoBase64, 'base64');
        else if (logoUrl) {
          const imgResp = await fetch(logoUrl);
          if (imgResp.ok) logoBuf = Buffer.from(await imgResp.arrayBuffer());
        }
        if (logoBuf) doc.image(logoBuf, 56, 40, { fit: [80, 80] });
      } catch {}
    }

    doc.font('Helvetica-Bold').fontSize(20).text(appName, 150, 56);
    doc.moveDown(0.5);
    doc.font('Helvetica').fontSize(12).fillColor('#333')
      .text(`Report: Daily Horoscope (${prettySign(s)})`)
      .text(`User: ${userName}${phone ? '  •  ' + phone : ''}`)
      .text(`Generated: ${nowInISTText()} (IST)`);
    doc.moveDown(1);
    doc.moveTo(56, doc.y).lineTo(539, doc.y).strokeColor('#999').stroke();
    doc.moveDown(1);

    // Vedic timings
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#000').text('Vedic Timings (IST)');
    doc.font('Helvetica').fontSize(12)
      .text(`• Rahu Kaal: ${timings.rahuKaal}`)
      .text(`• Yamaganda: ${timings.yamaganda}`)
      .text(`• Gulika Kaal: ${timings.gulikaKaal}`)
      .text(`• Abhijit Muhurat: ${timings.abhijitMuhurat}`);
    doc.moveDown(0.8);
    doc.moveTo(56, doc.y).lineTo(539, doc.y).strokeColor('#ddd').stroke();
    doc.moveDown(0.8);

    // Body
    doc.font('Helvetica-Bold').fontSize(14).text(`Today’s Guidance for ${prettySign(s)}`);
    doc.moveDown(0.4);
    doc.font('Helvetica').fontSize(12).fillColor('#000');
    text.split(/\n{2,}/).forEach(p => {
      doc.text(p.trim(), { align: 'justify' });
      doc.moveDown(0.6);
    });

    doc.moveDown(1.2);
    doc.font('Helvetica-Oblique').fontSize(10).fillColor('#666')
      .text(`${appName} • Daily guidance for ${userName}`);
    doc.end();
  } catch (e) {
    console.error('POST /report/from-daily error', e);
    if (!res.headersSent) res.status(500).json({ error: 'Server error' });
  }
});

/** ─────── PDF: weekly (today + next 6) ─────── **/
app.post('/report/weekly', async (req, res) => {
  try {
    const { sign = 'aries', user = {}, brand = {} } = req.body || {};
    const s = String(sign).toLowerCase();
    if (!SIGNS.includes(s)) return res.status(400).json({ error: 'Invalid sign' });

    ensureNewDay();
    await ensureDailyForToday(s);

    // Build 7 days
    const days = [];
    for (let i = 0; i < 7; i++) {
      const dateISO = istDateKey(addDaysIST(i));
      const dow = weekdayIST(addDaysIST(i));
      const vedic = vedicTimesForDayIndex(dow);
      if (i === 0) {
        days.push({ date: dateISO, text: dailyCache[s].text, vedic });
      } else {
        const t = await generateDailyTextForDate(s, dateISO);
        days.push({ date: dateISO, text: t, vedic });
      }
    }

    const userName = user.name || 'Friend';
    const phone = user.phone || '';
    const appName = brand.appName || 'Astro-Baba';
    const logoBase64 = stripDataUrlPrefix(brand.logoBase64 || null);
    const logoUrl = brand.logoUrl || null;

    const fname = `${appName.replace(/\s+/g,'_')}_weekly_${s}_${Date.now()}.pdf`;
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${fname}"`,
      'Cache-Control': 'no-store'
    });

    const doc = new PDFDocument({ size: 'A4', margins: { top: 56, left: 56, right: 56, bottom: 56 }});
    doc.pipe(res);

    // Logo
    if (logoBase64 || logoUrl) {
      try {
        let logoBuf = null;
        if (logoBase64) logoBuf = Buffer.from(logoBase64, 'base64');
        else if (logoUrl) {
          const imgResp = await fetch(logoUrl);
          if (imgResp.ok) logoBuf = Buffer.from(await imgResp.arrayBuffer());
        }
        if (logoBuf) doc.image(logoBuf, 56, 40, { fit: [80, 80] });
      } catch {}
    }

    doc.font('Helvetica-Bold').fontSize(20).text(appName, 150, 56);
    doc.moveDown(0.5);
    doc.font('Helvetica').fontSize(12).fillColor('#333')
      .text(`Report: Weekly Horoscope (${prettySign(s)})`)
      .text(`User: ${userName}${phone ? '  •  ' + phone : ''}`)
      .text(`Generated: ${nowInISTText()} (IST)`);
    doc.moveDown(1);
    doc.moveTo(56, doc.y).lineTo(539, doc.y).strokeColor('#999').stroke();
    doc.moveDown(1);

    // 7 sections
    days.forEach((d, idx) => {
      doc.font('Helvetica-Bold').fontSize(14).text(`${idx === 0 ? 'Day 1 (Today)' : `Day ${idx+1}`}: ${d.date}`);
      doc.moveDown(0.3);
      doc.font('Helvetica').fontSize(12)
        .text(`• Rahu Kaal: ${d.vedic.rahuKaal}`)
        .text(`• Yamaganda: ${d.vedic.yamaganda}`)
        .text(`• Gulika Kaal: ${d.vedic.gulikaKaal}`)
        .text(`• Abhijit Muhurat: ${d.vedic.abhijitMuhurat}`);
      doc.moveDown(0.5);
      d.text.split(/\n{2,}/).forEach(p => {
        doc.text(p.trim(), { align: 'justify' });
        doc.moveDown(0.5);
      });
      doc.moveDown(0.8);
      doc.moveTo(56, doc.y).lineTo(539, doc.y).strokeColor('#eee').stroke();
      doc.moveDown(0.8);
    });

    doc.font('Helvetica-Oblique').fontSize(10).fillColor('#666')
      .text(`${appName} • Weekly guidance for ${userName}`);
    doc.end();
  } catch (e) {
    console.error('POST /report/weekly error', e);
    if (!res.headersSent) res.status(500).json({ error: 'Server error' });
  }
});

/** ───────────────── Chat endpoints (unchanged minimal) ───────────────── **/
app.post('/chat', async (req, res) => {
  try {
    const { messages = [], system, model = 'gpt-4o-mini', temperature = 0.7 } = req.body || {};
    if (!OPENAI_API_KEY) return res.status(500).json({ error: 'OPENAI_API_KEY not set' });
    const payload = {
      model, temperature,
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        ...messages
      ],
      stream: false
    };
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!r.ok) return res.status(r.status).json({ error: await r.text() });
    const data = await r.json();
    const text = data?.choices?.[0]?.message?.content ?? '';
    res.json({ text });
  } catch (e) {
    console.error('POST /chat error', e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/chat/stream', async (req, res) => {
  try {
    const { messages = [], system, model = 'gpt-4o-mini', temperature = 0.7 } = req.body || {};
    if (!OPENAI_API_KEY) {
      res.set({ 'Content-Type': 'text/event-stream; charset=utf-8' });
      res.write('event: error\n');
      res.write('data: {"message":"OPENAI_API_KEY not set"}\n\n');
      return res.end();
    }
    const payload = { model, temperature,
      messages: [ ...(system? [{role:'system',content:system}] : []), ...messages ],
      stream: false
    };
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    res.set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*',
    });
    if (res.flushHeaders) res.flushHeaders();
    res.write(':\n\n');

    if (!r.ok) {
      const errText = await r.text();
      res.write('event: error\n');
      res.write(`data: ${JSON.stringify({ status: r.status, message: errText })}\n\n`);
      return res.end();
    }

    const j = await r.json();
    const full = j?.choices?.[0]?.message?.content ?? '';
    const sendChunk = (piece) => {
      const chunk = {
        id: 'local',
        object: 'chat.completion.chunk',
        choices: [{ index: 0, delta: { content: piece }, finish_reason: null }],
      };
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    };
    if (!full) { sendChunk('(no content)'); res.write('data: [DONE]\n\n'); return res.end(); }
    const CHARS = 18, DELAY = 25;
    for (let i = 0; i < full.length; i += CHARS) {
      sendChunk(full.slice(i, i + CHARS));
      // eslint-disable-next-line no-await-in-loop
      await new Promise(r2 => setTimeout(r2, DELAY));
    }
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (e) {
    console.error('POST /chat/stream error', e);
    try {
      res.write('event: error\n');
      res.write(`data: ${JSON.stringify({ message: 'Server error' })}\n\n`);
    } catch {}
    res.end();
  }
});

/** ───────────────── Listen ─────────────────────────────── **/
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Astro-Baba Chat API listening on ${PORT}`));
