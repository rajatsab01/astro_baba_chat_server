import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import PDFDocument from 'pdfkit';
import crypto from 'node:crypto';

/** ───────────────────── App Setup ───────────────────── **/
const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Sanitize OPENAI key (strip angle brackets and whitespace)
const RAW_OPENAI = process.env.OPENAI_API_KEY || '';
const OPENAI_API_KEY = RAW_OPENAI.trim().replace(/[<>]/g, '');
const mask = (k) => (k ? `${k.slice(0, 10)}...${k.slice(-4)}` : '(missing)');
console.log('OPENAI_API_KEY raw (masked):', mask(RAW_OPENAI));
console.log('OPENAI_API_KEY used (masked):', mask(OPENAI_API_KEY));

/** ───────────────────── Constants ───────────────────── **/
const SIGNS = [
  'aries','taurus','gemini','cancer','leo','virgo',
  'libra','scorpio','sagittarius','capricorn','aquarius','pisces'
];

const WEEKDAY_PLANET = ['Sun','Moon','Mars','Mercury','Jupiter','Venus','Saturn']; // Sun..Sat
const PLANET_COLORS = {
  Sun: ['saffron','gold','ruby red'],
  Moon: ['pearl white','silver','cream'],
  Mars: ['coral','scarlet','brick red'],
  Mercury: ['leaf green','emerald','olive'],
  Jupiter: ['mustard','turmeric yellow','golden'],
  Venus: ['rose pink','pastel blue','white'],
  Saturn: ['navy','indigo','black']
};
const PLANET_NUMBERS = { Sun: 1, Moon: 2, Mars: 9, Mercury: 5, Jupiter: 3, Venus: 6, Saturn: 8 };

const FOCUS_AREAS = [
  'career', 'relationships', 'finances', 'health',
  'learning', 'creativity', 'home & family', 'networking'
];
const REMEDIES = [
  'Offer water to the rising Sun and chant Om Suryaaya Namah 11 times.',
  'Light a diya in the evening and sit quietly for 3 minutes of mindful breathing.',
  'Donate a handful of grains or feed birds as a gesture of sattvic charity.',
  'Chant “Om Namah Shivaya” 21 times with calm, steady breathing.',
  'Keep your desk clutter-free; discard one unnecessary item today.',
  'Drink warm water upon waking; avoid screens for the first 15 minutes.',
  'Write 3 gratitude points before sleep; keep it simple and sincere.'
];
const DO_LIST = [
  'Prioritize one key task before noon',
  'Speak gently and clearly in discussions',
  'Review finances for 10 minutes',
  'Take a 15-minute walk to reset your mind',
  'Check in on a loved one briefly'
];
const DONT_LIST = [
  'Don’t make impulse purchases',
  'Don’t promise beyond capacity',
  'Don’t escalate minor disagreements',
  'Don’t skip meals or water',
  'Don’t multitask during crucial work'
];
const OPENINGS = [
  'Your spark is noticeable today—use it with intention.',
  'Quiet confidence serves you better than loud urgency.',
  'Today favors steady action over quick wins.',
  'You may feel a lift in motivation—direct it wisely.',
  'Patience turns into progress if you give it space.',
  'Luck meets preparation—get your basics right.'
];

/** ───────────────────── Time Helpers (IST) ───────────────────── **/
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
  const istNow = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
  const future = new Date(istNow.getTime() + n * 24 * 60 * 60 * 1000);
  return new Date(future.getTime() - (5.5 * 60 * 60 * 1000));
}
function nowInISTText() {
  const fmt = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
  return fmt.format(new Date());
}
function prettySign(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

/** ─────────────── Agent: Vedic Times (static) ─────────────── **/
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

/** ─────────────── Agent: Deterministic Outline ─────────────── **/
function shaSeed(str) {
  const buf = crypto.createHash('sha256').update(str).digest();
  return buf.readUInt32BE(0); // 32-bit seed
}
function pickSeeded(arr, seed, salt = '') {
  const n = crypto.createHash('sha256').update(seed + ':' + salt).digest().readUInt32BE(0);
  return arr[n % arr.length];
}
function digitalRootFromISO(dateISO) {
  const nums = (dateISO || '').replaceAll('-', '').split('').map(Number).filter(n => !Number.isNaN(n));
  let sum = nums.reduce((a,b)=>a+b,0);
  while (sum > 9) sum = String(sum).split('').map(Number).reduce((a,b)=>a+b,0);
  if (sum === 0) sum = 9;
  return sum; // 1..9
}
function buildOutline({ sign, dateISO, dayIdx }) {
  const seedBase = `${sign}:${dateISO}`;
  const seed = shaSeed(seedBase);
  const planet = WEEKDAY_PLANET[dayIdx];
  const luckyNumber = PLANET_NUMBERS[planet];
  const dayNumber = digitalRootFromISO(dateISO);
  const color = pickSeeded(PLANET_COLORS[planet], String(seed), 'color');
  const focus = pickSeeded(FOCUS_AREAS, String(seed), 'focus');
  const opening = pickSeeded(OPENINGS, String(seed), 'opening');
  const remedy = pickSeeded(REMEDIES, String(seed), 'remedy');
  const do1 = pickSeeded(DO_LIST, String(seed), 'do1');
  const do2 = pickSeeded(DO_LIST, String(seed+1), 'do2');
  const dont1 = pickSeeded(DONT_LIST, String(seed), 'dont1');
  const dont2 = pickSeeded(DONT_LIST, String(seed+1), 'dont2');

  return {
    planet, color, luckyNumber, dayNumber, focus, opening, remedy,
    dos: Array.from(new Set([do1, do2])).slice(0,2),
    donts: Array.from(new Set([dont1, dont2])).slice(0,2),
  };
}

/** ─────────────── Agent: Safety/Style Guard ─────────────── **/
function sanitizeClaims(text) {
  if (!text) return text;
  // soften over-confident claims
  return text
    .replace(/\b(guarantee|guaranteed|assured|sure[- ]?shot)\b/gi, 'aim')
    .replace(/\b(cure|diagnose|prescribe)\b/gi, 'support')
    .replace(/\b(will\s+surely|100%\s*(success|profit|win))\b/gi, 'can improve')
    .trim();
}
function ensureDisclaimer(text, lang = 'en') {
  const disclaimerEN = '\n\n*Disclaimer: Guidance is indicative, not a substitute for professional advice.*';
  const disclaimerHI = '\n\n*अस्वीकरण: यह मार्गदर्शन संकेतक है, किसी पेशेवर सलाह का विकल्प नहीं है।*';
  const disclaimerHG = '\n\n*Disclaimer: Yeh margdarshan sanketik hai, professional salah ka vikalp nahin.*';

  const hasDisc = /\bdisclaimer\b|अस्वीकरण|salah ka vikalp/i.test(text);
  if (hasDisc) return text;
  if (lang.startsWith('hi-') || lang === 'hi') return text + disclaimerHI;
  if (lang === 'hinglish' || lang === 'hi-Latn') return text + disclaimerHG;
  return text + disclaimerEN;
}

/** ─────────────── Agent: LLM Polisher ─────────────── **/
async function polishWithLLM({ sign, dateISO, outline, timings }) {
  // Base template (works even with no API key)
  const base = [
    `**${prettySign(sign)} • ${dateISO}**`,
    `${outline.opening} Your ruling influence today is **${outline.planet}**, so keep your attention on **${outline.focus}**.`,
    `Lucky color: **${outline.color}**, Lucky number: **${outline.luckyNumber}** (Day number: ${outline.dayNumber}).`,
    `Auspicious focus window: **Abhijit Muhurat ${timings.abhijitMuhurat}**. Avoid key beginnings during Rahu Kaal **${timings.rahuKaal}**.`,
    ``,
    `**Do**`,
    `• ${outline.dos[0]}\n• ${outline.dos[1]}`,
    ``,
    `**Don’t**`,
    `• ${outline.donts[0]}\n• ${outline.donts[1]}`,
    ``,
    `**Remedy**`,
    `${outline.remedy}`,
  ].join('\n');

  if (!OPENAI_API_KEY) return base;

  const system = [
    `You are Astro-Baba, a practical Vedic-aware guide for Indian audiences.`,
    `Polish and expand the user's outline into ~130–170 words.`,
    `Keep **exact** values for Lucky color/number, Abhijit Muhurat, and Rahu Kaal.`,
    `Keep a warm, modern, non-fatalistic tone. No medical/financial guarantees.`,
    `End with three sections: Opportunities (3 bullets), Cautions (3 bullets), Remedy (1–2 lines).`,
  ].join('\n');

  const user = [
    `Sign: ${prettySign(sign)} • Date (IST): ${dateISO}`,
    `Planet: ${outline.planet}, Focus: ${outline.focus}`,
    `Lucky color: ${outline.color}, Lucky number: ${outline.luckyNumber}, Day number: ${outline.dayNumber}`,
    `Abhijit: ${timings.abhijitMuhurat}, Rahu Kaal: ${timings.rahuKaal}`,
    `Use this base as factual reference:\n\n${base}`
  ].join('\n');

  try {
    const payload = {
      model: 'gpt-4o-mini',
      temperature: 0.55,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      stream: false
    };
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!r.ok) {
      console.warn('LLM polish error', r.status, await r.text());
      return base;
    }
    const j = await r.json();
    return j?.choices?.[0]?.message?.content || base;
  } catch (e) {
    console.warn('LLM polish exception', e);
    return base;
  }
}

/** ─────────────── Agent: Translator (EN / HI / Hinglish) ─────────────── **/
async function translateTextLLM(text, lang = 'en') {
  const L = (lang || 'en').toLowerCase();
  if (L === 'en') return text;

  if (!OPENAI_API_KEY) {
    // Fallback: return English if no key
    return text;
  }

  // Hinglish aliases
  const isHinglish = (L === 'hinglish' || L === 'hi-latn' || L === 'hi_latn');

  const system = isHinglish
    ? `Translate to natural Hinglish (Romanized Hindi). Keep formatting, bullets, headers, and all time ranges unchanged.`
    : `Translate to natural Hindi. Keep formatting, bullets, headers, and all time ranges unchanged.`;

  const user = `Translate the following:\n\n${text}`;

  try {
    const payload = {
      model: 'gpt-4o-mini',
      temperature: 0.2,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      stream: false
    };
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!r.ok) {
      console.warn('LLM translate error', r.status, await r.text());
      return text;
    }
    const j = await r.json();
    return j?.choices?.[0]?.message?.content || text;
  } catch (e) {
    console.warn('LLM translate exception', e);
    return text;
  }
}

/** ─────────────── Orchestrator ─────────────── **/
async function orchestrateDaily({ sign, dateISO, dayIdx, lang }) {
  const vedic = vedicTimesForDayIndex(dayIdx);
  const outline = buildOutline({ sign, dateISO, dayIdx });
  let text = await polishWithLLM({ sign, dateISO, outline, timings: vedic });
  text = sanitizeClaims(text);

  // Translate if needed
  let final = await translateTextLLM(text, lang);
  final = sanitizeClaims(final);
  final = ensureDisclaimer(final, lang);

  return { text: final, extras: { ...outline, vedic } };
}

/** ─────────────── Cache (per date) ─────────────── **/
// We cache per {dateISO, sign, lang} (lang variant stored separately from EN polish)
let currentDateISO = null;
let enCache = {};        // sign -> { text, extras, generatedAtISO }
let langCache = {};      // sign -> { [lang]: text }

function resetCache(dateISO) {
  currentDateISO = dateISO;
  enCache = {};
  langCache = {};
}
function ensureDate(dateISO) {
  if (currentDateISO !== dateISO) resetCache(dateISO);
}

async function getDaily(sign, dateISO, dayIdx, lang = 'en') {
  ensureDate(dateISO);
  // Ensure EN polished baseline
  if (!enCache[sign]) {
    const { text, extras } = await orchestrateDaily({ sign, dateISO, dayIdx, lang: 'en' });
    enCache[sign] = { text, extras, generatedAtISO: new Date().toISOString() };
  }
  // If requested language is EN, return baseline
  if (lang === 'en') return enCache[sign];

  // Else, translate/cache per lang
  if (!langCache[sign]) langCache[sign] = {};
  if (!langCache[sign][lang]) {
    const translated = await translateTextLLM(enCache[sign].text, lang);
    const safe = ensureDisclaimer(sanitizeClaims(translated), lang);
    langCache[sign][lang] = safe;
  }
  return {
    text: langCache[sign][lang],
    extras: enCache[sign].extras,
    generatedAtISO: enCache[sign].generatedAtISO
  };
}

/** ─────────────── Small helpers ─────────────── **/
function getLangFrom(req) {
  const q = (req.query.lang || '').toString().toLowerCase();
  return q || 'en';
}
function stripDataUrlPrefix(b64) {
  if (!b64) return null;
  const idx = b64.indexOf('base64,');
  return idx >= 0 ? b64.slice(idx + 7) : b64;
}
function writeHeader(doc, { appName, logoBuf, subtitleLines = [] }) {
  if (logoBuf) {
    try { doc.image(logoBuf, 56, 40, { fit: [80, 80] }); } catch {}
  }
  doc.font('Helvetica-Bold').fontSize(20).text(appName, 150, 56);
  doc.moveDown(0.5);
  doc.font('Helvetica').fontSize(12).fillColor('#333');
  subtitleLines.forEach((line) => doc.text(line));
  doc.moveDown(1);
  doc.moveTo(56, doc.y).lineTo(539, doc.y).strokeColor('#999').stroke();
  doc.moveDown(1);
}

/** ───────────────── Health ───────────────── **/
app.get('/', (_req, res) => res.json({ ok: true, service: 'Astro-Baba Chat API' }));

/** ───────────────── NEW: Warmup all 12 signs ───────────────── **/
app.post('/warmup', async (req, res) => {
  try {
    const { lang = 'en' } = req.body || {};
    const dateISO = istDateKey();
    const dayIdx = weekdayIST();
    ensureDate(dateISO);
    for (const sign of SIGNS) {
      await getDaily(sign, dateISO, dayIdx, 'en'); // baseline EN
      if (lang !== 'en') await getDaily(sign, dateISO, dayIdx, lang); // translated variant
    }
    res.json({ ok: true, date: dateISO, lang });
  } catch (e) {
    console.error('POST /warmup error', e);
    res.status(500).json({ error: 'Server error' });
  }
});

/** ───────────────── Daily / Weekly JSON ───────────────── **/
app.get('/daily', async (req, res) => {
  try {
    const sign = String((req.query.sign || '')).toLowerCase();
    if (!SIGNS.includes(sign)) {
      return res.status(400).json({ error: 'Invalid sign. Use: ' + SIGNS.join(', ') });
    }
    const lang = getLangFrom(req); // en | hi | hinglish
    const dateISO = istDateKey();
    const dayIdx = weekdayIST();
    const node = await getDaily(sign, dateISO, dayIdx, lang);
    res.json({
      date: dateISO,
      sign,
      lang,
      text: node.text,
      vedic: node.extras.vedic,
      lucky: {
        color: node.extras.color,
        number: node.extras.luckyNumber,
        dayNumber: node.extras.dayNumber,
        focus: node.extras.focus,
        planet: node.extras.planet,
      },
      generatedAt: node.generatedAtISO,
    });
  } catch (e) {
    console.error('GET /daily error', e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/weekly', async (req, res) => {
  try {
    const sign = String((req.query.sign || '')).toLowerCase();
    if (!SIGNS.includes(sign)) {
      return res.status(400).json({ error: 'Invalid sign. Use: ' + SIGNS.join(', ') });
    }
    const lang = getLangFrom(req);
    const out = [];
    for (let i = 0; i < 7; i++) {
      const dateISO = istDateKey(addDaysIST(i));
      const dayIdx = weekdayIST(addDaysIST(i));
      const node = await getDaily(sign, dateISO, dayIdx, lang);
      out.push({
        date: dateISO,
        text: node.text,
        vedic: node.extras.vedic,
        lucky: {
          color: node.extras.color,
          number: node.extras.luckyNumber,
          dayNumber: node.extras.dayNumber,
          focus: node.extras.focus,
          planet: node.extras.planet,
        }
      });
    }
    res.json({ sign, lang, days: out });
  } catch (e) {
    console.error('GET /weekly error', e);
    res.status(500).json({ error: 'Server error' });
  }
});

/** ───────────── PDF: from cached daily ───────────── **/
app.post('/report/from-daily', async (req, res) => {
  try {
    const { sign = 'aries', user = {}, brand = {}, lang = 'en' } = req.body || {};
    const s = String(sign).toLowerCase();
    if (!SIGNS.includes(s)) return res.status(400).json({ error: 'Invalid sign' });

    const dateISO = istDateKey();
    const dayIdx = weekdayIST();
    const node = await getDaily(s, dateISO, dayIdx, lang);

    const userName = user.name || 'Friend';
    const phone = user.phone || '';
    const appName = brand.appName || 'Astro-Baba';
    const logoBase64 = stripDataUrlPrefix(brand.logoBase64 || null);
    const logoUrl = brand.logoUrl || null;

    const fname = `${appName.replace(/\s+/g,'_')}_daily_${s}_${lang}_${Date.now()}.pdf`;
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${fname}"`,
      'Cache-Control': 'no-store'
    });

    const doc = new PDFDocument({ size: 'A4', margins: { top: 56, left: 56, right: 56, bottom: 56 }});
    doc.pipe(res);

    let logoBuf = null;
    try {
      if (logoBase64) logoBuf = Buffer.from(logoBase64, 'base64');
      else if (logoUrl) {
        const imgResp = await fetch(logoUrl);
        if (imgResp.ok) logoBuf = Buffer.from(await imgResp.arrayBuffer());
      }
    } catch {}

    const timings = node.extras.vedic;
    writeHeader(doc, {
      appName,
      logoBuf,
      subtitleLines: [
        `Report: Daily Horoscope (${prettySign(s)} • ${lang.toUpperCase()})`,
        `User: ${userName}${phone ? '  •  ' + phone : ''}`,
        `Generated: ${nowInISTText()} (IST)`,
      ],
    });

    doc.font('Helvetica-Bold').fontSize(13).fillColor('#000')
      .text(lang.startsWith('hi') ? 'वैदिक समय (IST)' :
            (lang === 'hinglish' || lang === 'hi-latn') ? 'Vaidik Samay (IST)' : 'Vedic Timings (IST)');
    doc.font('Helvetica').fontSize(12)
      .text(`• Rahu Kaal: ${timings.rahuKaal}`)
      .text(`• Yamaganda: ${timings.yamaganda}`)
      .text(`• Gulika Kaal: ${timings.gulikaKaal}`)
      .text(`• Abhijit Muhurat: ${timings.abhijitMuhurat}`);
    doc.moveDown(0.8);
    doc.moveTo(56, doc.y).lineTo(539, doc.y).strokeColor('#ddd').stroke();
    doc.moveDown(0.8);

    doc.font('Helvetica').fontSize(12).fillColor('#000');
    node.text.split(/\n{2,}/).forEach(p => {
      doc.text(p.trim(), { align: 'justify' });
      doc.moveDown(0.6);
    });

    doc.moveDown(1.2);
    doc.font('Helvetica-Oblique').fontSize(10).fillColor('#666')
      .text(`${appName} • ${userName}`);
    doc.end();
  } catch (e) {
    console.error('POST /report/from-daily error', e);
    if (!res.headersSent) res.status(500).json({ error: 'Server error' });
  }
});

/** ───────────── PDF: weekly ───────────── **/
app.post('/report/weekly', async (req, res) => {
  try {
    const { sign = 'aries', user = {}, brand = {}, lang = 'en' } = req.body || {};
    const s = String(sign).toLowerCase();
    if (!SIGNS.includes(s)) return res.status(400).json({ error: 'Invalid sign' });

    const userName = user.name || 'Friend';
    const phone = user.phone || '';
    const appName = brand.appName || 'Astro-Baba';
    const logoBase64 = stripDataUrlPrefix(brand.logoBase64 || null);
    const logoUrl = brand.logoUrl || null;

    const fname = `${appName.replace(/\s+/g,'_')}_weekly_${s}_${lang}_${Date.now()}.pdf`;
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${fname}"`,
      'Cache-Control': 'no-store'
    });

    const doc = new PDFDocument({ size: 'A4', margins: { top: 56, left: 56, right: 56, bottom: 56 }});
    doc.pipe(res);

    let logoBuf = null;
    try {
      if (logoBase64) logoBuf = Buffer.from(logoBase64, 'base64');
      else if (logoUrl) {
        const imgResp = await fetch(logoUrl);
        if (imgResp.ok) logoBuf = Buffer.from(await imgResp.arrayBuffer());
      }
    } catch {}

    writeHeader(doc, {
      appName,
      logoBuf,
      subtitleLines: [
        `Report: Weekly Horoscope (${prettySign(s)} • ${lang.toUpperCase()})`,
        `User: ${userName}${phone ? '  •  ' + phone : ''}`,
        `Generated: ${nowInISTText()} (IST)`,
      ],
    });

    for (let i = 0; i < 7; i++) {
      const dateISO = istDateKey(addDaysIST(i));
      const dayIdx = weekdayIST(addDaysIST(i));
      const node = await getDaily(s, dateISO, dayIdx, lang);

      doc.font('Helvetica-Bold').fontSize(14).text(`${i === 0 ? 'Day 1 (Today)' : `Day ${i+1}`} • ${dateISO}`);
      doc.moveDown(0.3);
      doc.font('Helvetica').fontSize(12)
        .text(`• Lucky color: ${node.extras.color}`)
        .text(`• Lucky number: ${node.extras.luckyNumber} (Day number: ${node.extras.dayNumber})`)
        .text(`• Focus: ${node.extras.focus}`)
        .text(`• Planet influence: ${node.extras.planet}`)
        .text(`• Abhijit: ${node.extras.vedic.abhijitMuhurat}; Avoid Rahu Kaal: ${node.extras.vedic.rahuKaal}`);
      doc.moveDown(0.5);

      node.text.split(/\n{2,}/).forEach(p => {
        doc.text(p.trim(), { align: 'justify' });
        doc.moveDown(0.5);
      });
      doc.moveDown(0.8);
      doc.moveTo(56, doc.y).lineTo(539, doc.y).strokeColor('#eee').stroke();
      doc.moveDown(0.8);
    }

    doc.font('Helvetica-Oblique').fontSize(10).fillColor('#666')
      .text(`${appName} • Weekly guidance for ${userName}`);
    doc.end();
  } catch (e) {
    console.error('POST /report/weekly error', e);
    if (!res.headersSent) res.status(500).json({ error: 'Server error' });
  }
});

/** ───────────── Generic hybrid PDF (gemstone / mantra / etc) ───────────── **/
app.post('/report/generate', async (req, res) => {
  try {
    const { package: pkg = 'daily_horoscope', user = {}, brand = {}, inputs = {}, model = 'gpt-4o-mini', temperature = 0.6, lang = 'en' } = req.body || {};
    const appName = brand.appName || 'Astro-Baba';
    const logoBase64 = stripDataUrlPrefix(brand.logoBase64 || null);
    const logoUrl = brand.logoUrl || null;
    const userName = user.name || 'Friend';
    const phone = user.phone || '';

    const pkgKey = String(pkg).toLowerCase();
    let system, userPrompt, title;
    if (pkgKey.includes('gemstone')) {
      title = 'Personal Gemstone Guidance';
      system = `You are Astro-Baba. Give practical, safe gemstone guidance for Indian audience.
- Avoid guarantees, say “indicative”.
- Include 3 sections: Why this gem, Wearing guidance, Care & cautions.
- Tone: warm, modern, respectful.`;
      userPrompt = `User: ${userName} (${phone}). Zodiac: ${inputs.zodiac || 'unknown'}. DOB: ${inputs.dob || 'unknown'}.
Write ~300–400 words.`;
    } else if (pkgKey.includes('mantra')) {
      title = 'Mantra Recommendation';
      system = `You are Astro-Baba. Recommend 1–2 simple, safe mantras.
- Include: Mantra text (IAST), Meaning, Best time to chant, Simple procedure, Cautions.
- No medical/financial claims.`;
      userPrompt = `User: ${userName} (${phone}). Zodiac: ${inputs.zodiac || 'unknown'}. DOB: ${inputs.dob || 'unknown'}.
Write ~250–350 words.`;
    } else {
      title = 'Astro-Baba Report';
      system = `You are Astro-Baba. Produce a short, safe, practical spiritual guidance.`;
      userPrompt = `User: ${userName}. Keep it concise (200–300 words).`;
    }

    // Get body text (fallback if no key)
    let bodyText = `${title}\n\nNamaste ji, ${userName}.\n\n(Offline mode) Practical guidance will appear here.`;
    if (OPENAI_API_KEY) {
      const payload = {
        model, temperature,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userPrompt }
        ],
        stream: false
      };
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (r.ok) {
        const j = await r.json();
        bodyText = j?.choices?.[0]?.message?.content || bodyText;
      } else {
        console.warn('LLM error for /report/generate:', await r.text());
      }
    }

    bodyText = sanitizeClaims(bodyText);
    bodyText = await translateTextLLM(bodyText, lang);
    bodyText = ensureDisclaimer(bodyText, lang);

    const fname = `${appName.replace(/\s+/g,'_')}_${pkgKey}_${lang}_${Date.now()}.pdf`;
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${fname}"`,
      'Cache-Control': 'no-store'
    });

    const doc = new PDFDocument({ size: 'A4', margins: { top: 56, left: 56, right: 56, bottom: 56 }});
    doc.pipe(res);

    let logoBuf = null;
    try {
      if (logoBase64) logoBuf = Buffer.from(logoBase64, 'base64');
      else if (logoUrl) {
        const imgResp = await fetch(logoUrl);
        if (imgResp.ok) logoBuf = Buffer.from(await imgResp.arrayBuffer());
      }
    } catch {}

    writeHeader(doc, {
      appName,
      logoBuf,
      subtitleLines: [
        `Report: ${title} (${lang.toUpperCase()})`,
        `User: ${userName}${phone ? '  •  ' + phone : ''}`,
        `Generated: ${nowInISTText()} (IST)`,
      ],
    });

    doc.font('Helvetica-Bold').fontSize(16).text(title);
    doc.moveDown(0.5);
    doc.font('Helvetica').fontSize(12);

    bodyText.split(/\n{2,}/).forEach(p => {
      doc.text(p.trim(), { align: 'justify' });
      doc.moveDown(0.6);
    });

    doc.moveDown(1.2);
    doc.font('Helvetica-Oblique').fontSize(10).fillColor('#666')
      .text(`${appName} • Personalized guidance for ${userName}`);
    doc.end();
  } catch (e) {
    console.error('POST /report/generate error', e);
    if (!res.headersSent) res.status(500).json({ error: 'Server error' });
  }
});

/** ───────────── Chat endpoints (as before) ───────────── **/
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

/** ───────────────── Listen ───────────────── **/
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Astro-Baba Chat API listening on ${PORT}`));
