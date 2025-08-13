// server.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import { fileURLToPath } from 'url';

// ─────────────────────────────────────────────────────────────────────────────
// Paths / Fonts
// ─────────────────────────────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const FONT = {
  en: {
    regular: path.join(__dirname, 'fonts', 'NotoSans-Regular.ttf'),
    bold:    path.join(__dirname, 'fonts', 'NotoSans-Bold.ttf'),
  },
  hi: {
    regular: path.join(__dirname, 'fonts', 'NotoSansDevanagari-Regular.ttf'),
    bold:    path.join(__dirname, 'fonts', 'NotoSansDevanagari-Bold.ttf'),
  },
};

function checkFonts() {
  const exists = {
    'NotoSans-Regular.ttf':            fs.existsSync(FONT.en.regular),
    'NotoSans-Bold.ttf':               fs.existsSync(FONT.en.bold),
    'NotoSansDevanagari-Regular.ttf':  fs.existsSync(FONT.hi.regular),
    'NotoSansDevanagari-Bold.ttf':     fs.existsSync(FONT.hi.bold),
  };
  return { exists, ready: Object.values(exists).every(Boolean) };
}
const { ready: FONTS_READY } = checkFonts();

// ─────────────────────────────────────────────────────────────────────────────
// App / ENV
// ─────────────────────────────────────────────────────────────────────────────
const app  = express();
const PORT = process.env.PORT || 10000;
const OPENAI_API_KEY = (process.env.OPENAI_API_KEY || '').trim();

app.use(cors());
app.use(express.json({ limit: '1mb' }));

// ─────────────────────────────────────────────────────────────────────────────
function todayISOIST() {
  // Using ISO; we label IST in the PDF text where needed.
  return new Date().toISOString();
}
function maskKey(k) {
  if (!k) return '(none)';
  if (k.length < 10) return k;
  return `${k.slice(0, 8)}...${k.slice(-4)}`;
}
function assertOpenAI() {
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set');
}
function pickLang(source = {}) {
  const l = (source?.lang || 'en').toString().toLowerCase();
  return l === 'hi' ? 'hi' : 'en';
}
function cleanText(s = '') {
  return s
    .replace(/\u00A0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim();
}

// Greeting locked EXACTLY as requested (same for both languages)
const GREETING = 'Namaste ji,';

// ─────────────────────────────────────────────────────────────────────────────
// PDF helpers
// ─────────────────────────────────────────────────────────────────────────────
function applyFont(doc, { lang = 'en', weight = 'regular' } = {}) {
  // If fonts missing on server, pdfkit will use its fallback.
  if (!FONTS_READY) return;
  if (lang === 'hi') {
    doc.font(weight === 'bold' ? FONT.hi.bold : FONT.hi.regular);
  } else {
    doc.font(weight === 'bold' ? FONT.en.bold : FONT.en.regular);
  }
}

function drawBullets(doc, items = [], { lang = 'en' } = {}) {
  const bullet = '•';
  items.forEach(t => doc.text(`${bullet} ${cleanText(t)}`, { paragraphGap: 2 }));
}

function addBrandHeader(doc, { lang, brand, titleLine, subLine }) {
  const logoSize = 52;
  const hasLogo  = !!brand?.logoBase64;
  const startY   = doc.y;
  const startX   = doc.x;

  // Left: logo (optional)
  if (hasLogo) {
    try {
      const buf = Buffer.from(brand.logoBase64, 'base64');
      doc.image(buf, startX, startY, { width: logoSize, height: logoSize });
    } catch {}
  }

  // Right: app + title + subline
  const titleX = hasLogo ? startX + logoSize + 12 : startX;
  applyFont(doc, { lang, weight: 'bold' });
  doc.fontSize(16).text(brand?.appName || 'Astro-Baba', titleX, startY);
  applyFont(doc, { lang, weight: 'bold' });
  doc.fontSize(18).text(titleLine, titleX, startY + 18);
  applyFont(doc, { lang, weight: 'regular' });
  doc.fontSize(10).fillColor('#444').text(subLine, titleX, startY + 40);
  doc.fillColor('black').moveDown(1);

  // divider
  doc.moveTo(doc.page.margins.left, doc.y)
    .lineTo(doc.page.width - doc.page.margins.right, doc.y)
    .strokeColor('#cccccc')
    .stroke()
    .strokeColor('black');
  doc.moveDown(0.6);
}

function addUserBlock(doc, { lang, user }) {
  const L = (en, hi) => lang === 'hi' ? hi : en;
  const rows = [];
  if (user?.name)  rows.push([L('Name', 'नाम'), user.name]);
  if (user?.phone) rows.push([L('Phone', 'फ़ोन'), user.phone]);
  if (user?.email) rows.push([L('Email', 'ईमेल'), user.email]);
  if (user?.dob)   rows.push([L('DOB', 'जन्म तिथि'), user.dob]);
  if (user?.tob)   rows.push([L('Time', 'जन्म समय'), user.tob]);
  if (user?.place) rows.push([L('Place', 'जन्म स्थान'), user.place]);
  if (!rows.length) return;

  applyFont(doc, { lang, weight: 'bold' });
  doc.fontSize(12).text(L('Details:', 'विवरण:'));
  applyFont(doc, { lang });
  doc.moveDown(0.5);
  rows.forEach(([k, v]) => doc.text(`${k}: ${cleanText(v)}`));
  doc.moveDown(0.8);
}

function addVedicTimings(doc, { lang, timings }) {
  const L = (en, hi) => lang === 'hi' ? hi : en;
  applyFont(doc, { lang, weight: 'bold' });
  doc.fontSize(12).text(L('Vedic Timings (IST)', 'वैदिक समय (IST)'));
  applyFont(doc, { lang });
  doc.moveDown(0.2);

  const { rahuKaal, yamaganda, gulikaKaal, abhijitMuhurat } = timings || {};
  const rows = [
    [L('Rahu Kaal', 'राहु काल'), rahuKaal || '-'],
    [L('Yamaganda', 'यमगण्ड'), yamaganda || '-'],
    [L('Gulika Kaal', 'गुलिक काल'), gulikaKaal || '-'],
    [L('Abhijit Muhurat', 'अभिजीत मुहूर्त'), abhijitMuhurat || '-'],
  ];
  rows.forEach(([k, v]) => doc.text(`${k}: ${v}`));
  doc.moveDown(0.8);
}

function addSection(doc, { lang, heading, paragraphs = [] }) {
  applyFont(doc, { lang, weight: 'bold' });
  doc.fontSize(14).text(cleanText(heading));
  applyFont(doc, { lang });
  doc.moveDown(0.2);
  paragraphs.forEach(p => doc.fontSize(12).text(cleanText(p), { paragraphGap: 6 }));
  doc.moveDown(0.4);
}

function addDisclaimerThankYou(doc, { lang, brand }) {
  const disclaimer =
    lang === 'hi'
      ? 'अस्वीकरण: यह मार्गदर्शन केवल संकेतात्मक है, किसी भी पेशेवर सलाह का विकल्प नहीं है।'
      : 'Disclaimer: Guidance is indicative and not a substitute for professional advice.';

  const thanks =
    lang === 'hi'
      ? 'धन्यवाद — टीम Astro-Baba'
      : 'Thank you — Team Astro-Baba';

  applyFont(doc, { lang, weight: 'bold' });
  doc.text(lang === 'hi' ? 'अंतिम नोट' : 'Final Note');
  applyFont(doc, { lang });
  doc.moveDown(0.2);
  doc.text(disclaimer);
  doc.moveDown(0.6);
  doc.text(thanks);
  doc.moveDown(0.8);

  const year = new Date().getFullYear();
  doc.fontSize(9).fillColor('#555')
    .text(`© ${year} ${brand?.appName || 'Astro-Baba'}`, { align: 'center' });
  doc.fillColor('black');
}

// Static placeholders for now
function getVedicTimingsForTodayIST() {
  return {
    rahuKaal: '12:00–13:30',
    yamaganda: '07:30–09:00',
    gulikaKaal: '10:30–12:00',
    abhijitMuhurat: '12:05–12:52',
  };
}

// OpenAI translate / content (optional)
async function callOpenAIChat({ system, messages, temperature = 0.4, model = 'gpt-4o-mini' }) {
  assertOpenAI();
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, temperature, messages }),
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`OpenAI error ${resp.status}: ${t}`);
  }
  const data = await resp.json();
  return data.choices?.[0]?.message?.content || '';
}

// ─────────────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ ok: true, service: 'Astro-Baba Chat API' });
});

app.get('/debug/key', (req, res) => {
  res.json({ openai_key_present: !!OPENAI_API_KEY, masked: maskKey(OPENAI_API_KEY) });
});

app.get('/debug/fonts', (req, res) => {
  res.json(checkFonts());
});

app.post('/warmup', async (req, res) => {
  const lang = pickLang(req.body);
  res.json({ ok: true, date: todayISOIST().slice(0, 10), lang });
});

// DAILY JSON (hybrid text)
app.get('/daily', async (req, res) => {
  const sign = (req.query.sign || 'aries').toString().toLowerCase();
  const lang = pickLang({ lang: req.query.lang });
  const dateStr = todayISOIST().slice(0, 10);

  const luckyNumber = ((new Date(dateStr).getTime() / 86400000) % 9 | 0) + 1; // 1..9-ish
  const colors = ['leaf green', 'amber', 'turquoise', 'coral', 'royal blue', 'maroon', 'violet', 'saffron', 'silver'];
  const luckyColor = colors[(luckyNumber - 1) % colors.length];

  const baseEn =
`**${sign[0].toUpperCase() + sign.slice(1)} • ${dateStr}**
Today brings a refreshing boost of motivation. Focus your energy wisely.
Lucky color: ${luckyColor}. Lucky number: ${luckyNumber}. Use Abhijit Muhurat for key decisions; avoid Rahu Kaal for new beginnings.

Opportunities:
- Prioritize one important task before noon.
- Take a short mindful walk to reset focus.
- Align finances with medium-term goals.

Cautions:
- Avoid impulsive purchases.
- Don’t overpromise.
- Limit multitasking during crucial work.

Remedy:
Light a diya in the evening and do 3 minutes of mindful breathing.`;

  let text = baseEn;
  if (lang === 'hi') {
    try {
      text = await callOpenAIChat({
        system: 'Translate to natural, respectful Hindi (Devanagari). Keep markdown headings and bullet list shapes.',
        messages: [{ role: 'user', content: baseEn }],
        temperature: 0.2,
      });
    } catch {
      // fallback to English if translation fails
      text = baseEn;
    }
  }

  res.json({
    date: dateStr,
    sign,
    lang,
    text,
    vedic: getVedicTimingsForTodayIST(),
    generatedAt: new Date().toISOString(),
  });
});

// DAILY → PDF
app.post('/report/from-daily', async (req, res) => {
  try {
    const { sign = 'aries', user = {}, brand = {}, lang: rawLang } = req.body || {};
    const lang    = pickLang({ lang: rawLang });
    const dateStr = todayISOIST().slice(0, 10);

    const daily = await (await fetch(
      `${req.protocol}://${req.get('host')}/daily?sign=${encodeURIComponent(sign)}&lang=${lang}`
    )).json();

    const doc = new PDFDocument({ margin: 36, bufferPages: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition',
      `attachment; filename="AstroBaba_Daily_${sign}_${dateStr}_${lang}.pdf"`);

    applyFont(doc, { lang, weight: 'regular' });

    const titleLine = lang === 'hi' ? 'दैनिक राशिफल' : 'Daily Horoscope';
    const subLine   = `${(brand?.appName || 'Astro-Baba')} • ${(user?.name || '').trim() || (lang==='hi'?'मित्र':'Friend')} • ${dateStr} (IST)`;

    addBrandHeader(doc, { lang, brand, titleLine, subLine });
    addUserBlock(doc,   { lang, user: {
      name:  user?.name,
      phone: user?.phone,
      email: user?.email,
      dob:   user?.dob,
      tob:   user?.time || user?.tob,
      place: user?.place,
    }});
    addVedicTimings(doc, { lang, timings: daily.vedic });

    // Greeting (locked)
    applyFont(doc, { lang, weight: 'bold' });
    doc.fontSize(12).text(GREETING);
    applyFont(doc, { lang });
    doc.moveDown(0.5);

    // Body (flatten markdown to plain paragraphs)
    const paragraphs = (daily.text || '').split('\n').filter(Boolean);
    paragraphs.forEach(p => {
      const line = p.replace(/^\*+|^[-–•]\s*/g, '').trim();
      doc.fontSize(12).text(cleanText(line), { paragraphGap: 6 });
    });

    doc.moveDown(0.4);
    addDisclaimerThankYou(doc, { lang, brand });

    doc.pipe(res);
    doc.end();
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// GENERIC PACKAGE → PDF (gemstone / mantra / etc.)
app.post('/report/generate', async (req, res) => {
  try {
    const {
      package: pkg = 'gemstone',
      user = {},
      brand = {},
      inputs = {},
      lang: rawLang,
      model = 'gpt-4o-mini',
      temperature = 0.4,
    } = req.body || {};

    const lang    = pickLang({ lang: rawLang });
    const dateStr = todayISOIST().slice(0, 10);

    let prompt =
`Create a concise report for package "${pkg}".
Return sections: Title, Intro (2 short paragraphs), Opportunities (3 bullets), Cautions (3 bullets), Remedy (1 paragraph).
Keep it practical for a general audience.`;
    if (lang === 'hi') prompt += ` Write fully in natural Hindi (Devanagari).`;

    let content = '';
    try {
      content = await callOpenAIChat({
        system: 'You are an expert astrology writer. Keep it crisp and helpful. No emojis.',
        messages: [{ role: 'user', content: prompt }],
        temperature,
        model,
      });
    } catch (err) {
      content = `Title: ${pkg}\nIntro: A helpful report.\nOpportunities:\n- One\n- Two\n- Three\nCautions:\n- One\n- Two\n- Three\nRemedy:\nA short remedy.`;
    }

    function extractBlock(name) {
      const r = new RegExp(`${name}\\s*:?\\s*([\\s\\S]*?)(?:\\n\\n|$)`, 'i');
      const m = content.match(r);
      return m ? m[1].trim() : '';
    }
    const Title  = extractBlock('Title') || (lang === 'hi' ? 'रिपोर्ट' : 'Report');
    const Intro  = extractBlock('Intro')  || content;
    const Opp    = extractBlock('Opportunities').split('\n').map(s => s.replace(/^[-–•]\s*/,'').trim()).filter(Boolean).slice(0,3);
    const Caut   = extractBlock('Cautions').split('\n').map(s => s.replace(/^[-–•]\s*/,'').trim()).filter(Boolean).slice(0,3);
    const Remedy = extractBlock('Remedy') || '';

    const doc = new PDFDocument({ margin: 36, bufferPages: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition',
      `attachment; filename="AstroBaba_${pkg}_${dateStr}_${lang}.pdf"`);

    applyFont(doc, { lang });

    const titleLine = Title;
    const subLine   = `${(brand?.appName || 'Astro-Baba')} • ${(user?.name || '').trim() || (lang==='hi'?'मित्र':'Friend')} • ${dateStr} (IST)`;

    addBrandHeader(doc, { lang, brand, titleLine, subLine });
    addUserBlock(doc,   { lang, user: {
      name:  user?.name,
      phone: user?.phone,
      email: user?.email,
      dob:   user?.dob,
      tob:   user?.time || user?.tob,
      place: user?.place,
    }});

    // Greeting (locked)
    applyFont(doc, { lang, weight: 'bold' });
    doc.fontSize(12).text(GREETING);
    applyFont(doc, { lang });
    doc.moveDown(0.5);

    addSection(doc, { lang, heading: lang==='hi'?'परिचय':'Introduction', paragraphs: Intro.split('\n').filter(Boolean) });

    applyFont(doc, { lang, weight: 'bold' });
    doc.fontSize(14).text(lang==='hi'?'अवसर':'Opportunities');
    applyFont(doc, { lang });
    drawBullets(doc, Opp, { lang });
    doc.moveDown(0.4);

    applyFont(doc, { lang, weight: 'bold' });
    doc.fontSize(14).text(lang==='hi'?'सावधानियाँ':'Cautions');
    applyFont(doc, { lang });
    drawBullets(doc, Caut, { lang });
    doc.moveDown(0.4);

    addSection(doc, { lang, heading: lang==='hi'?'उपाय':'Remedy', paragraphs: [Remedy] });

    addDisclaimerThankYou(doc, { lang, brand });

    doc.pipe(res);
    doc.end();
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// WEEKLY (today + 6) → PDF
app.post('/report/weekly', async (req, res) => {
  try {
    const { sign = 'aries', user = {}, brand = {}, lang: rawLang } = req.body || {};
    const lang    = pickLang({ lang: rawLang });
    const dateStr = todayISOIST().slice(0, 10);

    const days = [];
    for (let i = 0; i < 7; i++) {
      const q = `${req.protocol}://${req.get('host')}/daily?sign=${encodeURIComponent(sign)}&lang=${lang}`;
      const d = await (await fetch(q)).json();
      days.push(d);
    }

    const doc = new PDFDocument({ margin: 36, bufferPages: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition',
      `attachment; filename="AstroBaba_Weekly_${sign}_${dateStr}_${lang}.pdf"`);

    applyFont(doc, { lang });

    const titleLine = lang === 'hi' ? 'साप्ताहिक राशिफल (आज + 6)' : 'Weekly Horoscope (Today + 6)';
    const subLine   = `${(brand?.appName || 'Astro-Baba')} • ${(user?.name || '').trim() || (lang==='hi'?'मित्र':'Friend')} • ${dateStr} (IST)`;

    addBrandHeader(doc, { lang, brand, titleLine, subLine });
    addUserBlock(doc,   { lang, user: {
      name:  user?.name,
      phone: user?.phone,
      email: user?.email,
      dob:   user?.dob,
      tob:   user?.time || user?.tob,
      place: user?.place,
    }});

    // Greeting (locked)
    applyFont(doc, { lang, weight: 'bold' });
    doc.fontSize(12).text(GREETING);
    applyFont(doc, { lang });
    doc.moveDown(0.6);

    days.forEach((d, idx) => {
      const head = lang === 'hi' ? `दिन ${idx + 1}` : `Day ${idx + 1}`;
      addSection(doc, { lang, heading: head, paragraphs: [] });

      const paragraphs = (d.text || '').split('\n').filter(Boolean);
      paragraphs.forEach(p => {
        const line = p.replace(/^\*+|^[-–•]\s*/g, '').trim();
        doc.fontSize(12).text(cleanText(line), { paragraphGap: 6 });
      });
      doc.moveDown(0.4);
    });

    addDisclaimerThankYou(doc, { lang, brand });

    doc.pipe(res);
    doc.end();
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('OPENAI_API_KEY:', maskKey(OPENAI_API_KEY));
  console.log(`Astro-Baba Chat API listening on ${PORT}`);
});
