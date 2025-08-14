import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// agents
import { hashCode, toISTParts, cleanText, capSign } from './agents/utils.js';
import { policyAgent } from './agents/policy.js';
import { dayDeityAgent } from './agents/dayDeity.js';
import { specialDayAgent } from './agents/specialDay.js';
import { fortuneLineAgent } from './agents/fortuneLine.js';
import { quoteMoodAgent } from './agents/quoteMood.js';
import { panchangAgent } from './agents/panchang.js';
import { varietyAgent } from './agents/variety.js';
import { translateAgent } from './agents/translate.js';
import { greeting, formatAgent } from './agents/format.js';

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
  return { exists, ready: Object.values(exists).every(Boolean), paths: FONT };
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
// Small utils
// ─────────────────────────────────────────────────────────────────────────────
function maskKey(k) {
  if (!k) return '(none)';
  if (k.length < 10) return k;
  return `${k.slice(0, 8)}...${k.slice(-4)}`;
}
function pickLang(source = {}) {
  const l = (source?.lang || 'en').toString().toLowerCase();
  return l === 'hi' ? 'hi' : 'en';
}
function formatISTFull(dt = new Date()) {
  const { ist } = toISTParts(dt);
  const dateStr = ist.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric', timeZone:'Asia/Kolkata' });
  const timeStr = ist.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit', hour12:false, timeZone:'Asia/Kolkata' });
  return `${dateStr} ${timeStr} IST`;
}

// ─────────────────────────────────────────────────────────────────────────────
// PDF helpers
// ─────────────────────────────────────────────────────────────────────────────
function applyFont(doc, { lang = 'en', weight = 'regular' } = {}) {
  if (!FONTS_READY) return;
  if (lang === 'hi') {
    doc.font(weight === 'bold' ? FONT.hi.bold : FONT.hi.regular);
  } else {
    doc.font(weight === 'bold' ? FONT.en.bold : FONT.en.regular);
  }
}
function drawBullets(doc, items = [], { lang = 'en' } = {}) {
  const bullet = '•';
  items.forEach(t => doc.text(`${bullet} ${cleanText(t)}`, { paragraphGap: 2, align: 'left' }));
}
function addBrandHeader(doc, { lang, brand, titleLine, subLine }) {
  const logoSize = 52;
  const hasLogo  = !!brand?.logoBase64;
  const startY   = doc.y;
  const startX   = doc.x;

  if (hasLogo) {
    try {
      const buf = Buffer.from(brand.logoBase64, 'base64');
      doc.image(buf, startX, startY, { width: logoSize, height: logoSize });
    } catch {}
  }

  const titleX = hasLogo ? startX + logoSize + 12 : startX;

  applyFont(doc, { lang, weight: 'bold' });
  doc.fontSize(16).text(brand?.appName || 'Astro-Baba', titleX, startY);

  applyFont(doc, { lang, weight: 'bold' });
  doc.fontSize(18).text(titleLine, titleX, startY + 18);

  applyFont(doc, { lang, weight: 'regular' });
  doc.fontSize(10).fillColor('#444').text(subLine, titleX, startY + 40);
  doc.fillColor('black').moveDown(1);

  doc
    .moveTo(doc.page.margins.left, doc.y)
    .lineTo(doc.page.width - doc.page.margins.right, doc.y)
    .strokeColor('#cccccc')
    .stroke()
    .strokeColor('black');
  doc.moveDown(0.6);
}
function addUserBlock(doc, { lang, user }) {
  const L = (en, hi) => lang === 'hi' ? hi : en;
  const rows = [];
  if (user?.name)    rows.push([L('Name', 'नाम'), user.name]);
  if (user?.phone)   rows.push([L('Phone', 'फ़ोन'), user.phone]);
  if (user?.email)   rows.push([L('Email', 'ईमेल'), user.email]);
  if (user?.gender)  rows.push([L('Gender', 'लिंग'), user.gender]);
  if (user?.dob)     rows.push([L('DOB', 'जन्म तिथि'), user.dob]);
  if (user?.tob || user?.time) rows.push([L('Time', 'जन्म समय'), user?.tob || user?.time]);
  if (user?.place)   rows.push([L('Place', 'जन्म स्थान'), user.place]);
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
  paragraphs.forEach(p => doc.fontSize(12).text(cleanText(p), { paragraphGap: 6, align: 'justify' }));
  doc.moveDown(0.4);
}

// ─────────────────────────────────────────────────────────────────────────────
// Composer (pulls from all agents)
// ─────────────────────────────────────────────────────────────────────────────
function composeDaily({ sign='aries', lang='en', now=new Date(), user=null } = {}) {
  const s = (sign || '').toLowerCase();
  const { ist, dateStr, timeStr, weekdayIndex } = toISTParts(now);
  const monthSalt = dateStr.slice(0,7); // YYYY-MM
  const seed = hashCode(`${monthSalt}|${s}|${dateStr}`);

  const deity = dayDeityAgent(weekdayIndex, lang);
  const format = formatAgent({ lang, dateIST: ist, deityPair: deity.pair });
  const panchang = panchangAgent();
  const variety = varietyAgent({ sign: s, seed, weekdayIndex });
  const fortune = fortuneLineAgent({ sign: s, ist, seed, lang });
  const qm = quoteMoodAgent(seed);
  const policy = policyAgent(lang);
  const special = specialDayAgent({ now, lang, user }); // may be null

  // Optional translate for Hindi (lead + bullets + remedy only)
  let themeLead = variety.themeLead;
  let opp = variety.opportunities;
  let caut = variety.cautions;
  let remedy = variety.remedy;
  // (If you want live Hindi via OpenAI, uncomment)
  // if (lang === 'hi' && OPENAI_API_KEY) {
  //   // translate lines while preserving bullet separation
  //   const lines = [themeLead, ...opp, ...caut, remedy];
  //   try {
    //     const out = await translateAgent({ lang, lines });
  //     themeLead = out[0] || themeLead;
  //     opp = out.slice(1,4).filter(Boolean).length===3 ? out.slice(1,4) : opp;
  //     caut= out.slice(4,7).filter(Boolean).length===3 ? out.slice(4,7) : caut;
  //     remedy = out[7] || remedy;
  //   } catch {}
  // }

  return {
    date: dateStr,
    timeIST: timeStr,
    lang,
    sign: s,
    header: { dayHeader: format.dayHeader },
    greeting: greeting(lang),
    deityLine: format.deitySentenceParts,
    quote: qm.quote,
    affirmation: qm.affirmation,
    mood: qm.mood,
    waterGlasses: qm.waterGlasses,
    themeLead,
    luckyLine: fortune.luckyLine,
    sections: {
      opportunities: opp,
      cautions: caut,
      remedy,
      vedicExplain: lang==='hi'
        ? [
            'राहु काल — नई शुरुआत के लिए अनुकूल नहीं।',
            'यमगण्ड — यात्रा/बड़ी शुरुआत से बचें।',
            'गुलिक काल — सामान्य कार्य ठीक; नई शुरुआत टालें।',
            'अभिजीत मुहूर्त — नई शुरुआत के लिए शुभ।',
          ]
        : [
            'Rahu Kaal — Not favourable for new beginnings.',
            'Yamaganda — Avoid travel/major starts.',
            'Gulika Kaal — Routine is fine; avoid fresh starts.',
            'Abhijit Muhurat — Auspicious window for beginnings.',
          ],
    },
    vedic: panchang,
    policy,
    special, // may be null
    brandFooter: policy.footerBrand,

    // legacy flat text (kept for compatibility)
    text: `**${capSign(s)} • ${dateStr}**\n${themeLead}\n${fortune.luckyLine}\n\nOpportunities:\n- ${opp.join('\n- ')}\n\nCautions:\n- ${caut.join('\n- ')}\n\nRemedy:\n${remedy}`
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.json({ ok: true, service: 'Astro-Baba Chat API' }));
app.get('/debug/fonts', (req, res) => res.json(checkFonts()));
app.get('/debug/version', (req, res) => res.json({
  time: new Date().toISOString(),
  node: process.version,
  env: process.env.NODE_ENV || 'production',
  commit: process.env.RENDER_GIT_COMMIT || null,
  cwd: process.cwd(),
  fontsReady: FONTS_READY,
}));

// DAILY JSON — now supports optional user in body via POST too
app.get('/daily', (req, res) => {
  const sign = (req.query.sign || 'aries').toString().toLowerCase();
  const lang = pickLang({ lang: req.query.lang });
  const data = composeDaily({ sign, lang });
  res.json({ date: data.date, sign: data.sign, lang: data.lang, text: data.text, vedic: data.vedic, generatedAt: new Date().toISOString(), rich: data });
});
app.post('/daily', (req, res) => {
  const { sign='aries', lang='en', user=null } = req.body || {};
  const data = composeDaily({ sign, lang: pickLang({ lang }), user });
  res.json({ date: data.date, sign: data.sign, lang: data.lang, text: data.text, vedic: data.vedic, generatedAt: new Date().toISOString(), rich: data });
});

// DAILY → PDF (hybrid)
app.post('/report/from-daily', async (req, res) => {
  try {
    const { sign='aries', user={}, brand={}, lang: rawLang } = req.body || {};
    const lang  = pickLang({ lang: rawLang });
    const daily = composeDaily({ sign, lang, user });

    const doc = new PDFDocument({ margin: 36, bufferPages: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="AstroBaba_Daily_${sign}_${daily.date}_${lang}.pdf"`);

    applyFont(doc, { lang, weight: 'regular' });

    // Header (brand once; subline with name + IST stamp)
    const titleLine = lang==='hi' ? 'दैनिक राशिफल' : 'Daily Horoscope';
    const subLine   = `${(user?.name || (lang==='hi'?'मित्र':'Friend'))} • ${daily.date} ${daily.timeIST}`;
    addBrandHeader(doc, { lang, brand: { ...brand, appName: brand?.appName || 'Astro-Baba' }, titleLine, subLine });

    // User block
    addUserBlock(doc, { lang, user: {
      name:  user?.name, phone: user?.phone, email: user?.email, gender:user?.gender,
      dob:   user?.dob,  tob:   user?.time || user?.tob,       place: user?.place,
    }});

    // Vedic timings
    addVedicTimings(doc, { lang, timings: daily.vedic });

    // Day header (EN CAPS / HI natural)
    applyFont(doc, { lang, weight: 'bold' });
    doc.fontSize(14).text(daily.header.dayHeader, { align: 'center' });
    applyFont(doc, { lang });
    doc.moveDown(0.5);

    // Greeting (bold)
    applyFont(doc, { lang, weight: 'bold' });
    doc.fontSize(12).text(daily.greeting);
    applyFont(doc, { lang });

    // “Today being **X** day.”
    doc.moveDown(0.2);
    doc.fontSize(12);
    doc.text(daily.deityLine.pre, { continued: true });
    applyFont(doc, { lang, weight: 'bold' });
    doc.text(daily.deityLine.bold, { continued: true });
    applyFont(doc, { lang });
    doc.text(daily.deityLine.post);

    // Special Day (optional)
    if (daily.special) {
      doc.moveDown(0.6);
      applyFont(doc, { lang, weight: 'bold' });
      doc.fontSize(13).text(daily.special.title);
      applyFont(doc, { lang });
      if (daily.special.birthday) doc.text(daily.special.birthday);
      if (daily.special.observance) {
        doc.text(`${daily.special.observance.title} — ${daily.special.observance.line}`);
      }
    }

    // Quote / affirmation / mood / water
    doc.moveDown(0.6);
    doc.fontSize(11).text(daily.quote);
    doc.moveDown(0.2);
    doc.fontSize(11).text(lang==='hi' ? 'स्व-वचन: ' : 'Affirmation: ', { continued: true });
    applyFont(doc, { lang, weight: 'bold' }); doc.text(daily.affirmation); applyFont(doc, { lang });
    doc.moveDown(0.2);
    doc.fontSize(11).text(lang==='hi' ? `आज का मूड: ${daily.mood}` : `Mood: ${daily.mood}`);
    doc.fontSize(11).text(lang==='hi' ? `जल सेवन: कम से कम ${daily.waterGlasses} गिलास` : `Water: at least ${daily.waterGlasses} glasses`);

    // Lead + lucky
    doc.moveDown(0.6);
    doc.fontSize(12).text(daily.themeLead, { paragraphGap: 6 });
    doc.fontSize(12).text(daily.luckyLine);

    // Sections
    doc.moveDown(0.8);
    applyFont(doc, { lang, weight: 'bold' }); doc.fontSize(14).text(lang==='hi'?'अवसर':'Opportunities'); applyFont(doc, { lang });
    drawBullets(doc, daily.sections.opportunities, { lang });

    doc.moveDown(0.4);
    applyFont(doc, { lang, weight: 'bold' }); doc.fontSize(14).text(lang==='hi'?'सावधानियाँ':'Cautions'); applyFont(doc, { lang });
    drawBullets(doc, daily.sections.cautions, { lang });

    doc.moveDown(0.4);
    applyFont(doc, { lang, weight: 'bold' }); doc.fontSize(14).text(lang==='hi'?'उपाय':'Remedy'); applyFont(doc, { lang });
    doc.fontSize(12).text(daily.sections.remedy);

    // About the Vedic Periods
    doc.moveDown(0.8);
    applyFont(doc, { lang, weight: 'bold' });
    doc.fontSize(14).text(lang==='hi' ? 'वैदिक अवधियाँ' : 'About the Vedic Periods');
    applyFont(doc, { lang });
    drawBullets(doc, daily.sections.vedicExplain, { lang });

    // Final note + thanks + blessing
    doc.moveDown(0.8);
    applyFont(doc, { lang, weight: 'bold' }); doc.fontSize(12).text(lang==='hi' ? 'अंतिम नोट' : 'Final Note'); applyFont(doc, { lang });
    doc.moveDown(0.2);
    doc.fontSize(11).text(daily.policy.disclaimer);
    doc.moveDown(0.6);
    doc.fontSize(12).text(daily.policy.thanks);
    doc.moveDown(0.2);
    applyFont(doc, { lang, weight: 'bold' });
    doc.fontSize(12).text(lang==='hi' ? 'आपका दिन मंगलमय हो!' : 'Have a blessed day!!');
    applyFont(doc, { lang });

    // Footer ©
    doc.moveDown(0.8);
    const year = new Date().getFullYear();
    doc.fontSize(9).fillColor('#555').text(`© ${year} ${daily.brandFooter}`, { align: 'center' });
    doc.fillColor('black');

    doc.pipe(res); doc.end();
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// GENERIC PACKAGE → PDF (kept, but subline shows only name + IST)
app.post('/report/generate', async (req, res) => {
  try {
    const { package: pkg='gemstone', user={}, brand={}, inputs={}, lang: rawLang } = req.body || {};
    const lang = pickLang({ lang: rawLang });
    const now  = new Date();
    const { dateStr, timeStr } = toISTParts(now);

    // Minimal content (your existing OpenAI logic can live here)
    const titleLine = lang==='hi' ? 'रिपोर्ट' : 'Report';
    const intro = lang==='hi'
      ? ['संक्षिप्त परिचय अनुच्छेद 1', 'परिचय अनुच्छेद 2']
      : ['A short introduction paragraph one.', 'Introduction paragraph two.'];
    const opp = ['One action', 'Second action', 'Third action'];
    const caut= ['One caution', 'Second caution', 'Third caution'];
    const remedy = lang==='hi' ? 'एक छोटा उपाय।' : 'A short remedy.';

    const doc = new PDFDocument({ margin: 36, bufferPages: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="AstroBaba_${pkg}_${dateStr}_${lang}.pdf"`);

    applyFont(doc, { lang });

    const subLine = `${(user?.name || (lang==='hi'?'मित्र':'Friend'))} • ${dateStr} ${timeStr}`;
    addBrandHeader(doc, { lang, brand, titleLine, subLine });
    addUserBlock(doc, { lang, user: {
      name:user?.name, phone:user?.phone, email:user?.email, gender:user?.gender,
      dob:user?.dob, tob:user?.time || user?.tob, place:user?.place,
    }});

    applyFont(doc, { lang, weight: 'bold' }); doc.fontSize(12).text(greeting(lang)); applyFont(doc, { lang });
    addSection(doc, { lang, heading: lang==='hi'?'परिचय':'Introduction', paragraphs: intro });

    applyFont(doc, { lang, weight: 'bold' }); doc.fontSize(14).text(lang==='hi'?'अवसर':'Opportunities'); applyFont(doc, { lang });
    drawBullets(doc, opp, { lang });

    applyFont(doc, { lang, weight: 'bold' }); doc.fontSize(14).text(lang==='hi'?'सावधानियाँ':'Cautions'); applyFont(doc, { lang });
    drawBullets(doc, caut, { lang });

    addSection(doc, { lang, heading: lang==='hi'?'उपाय':'Remedy', paragraphs: [remedy] });

    const pol = policyAgent(lang);
    doc.moveDown(0.8);
    applyFont(doc, { lang, weight: 'bold' }); doc.fontSize(12).text(lang==='hi' ? 'अंतिम नोट' : 'Final Note'); applyFont(doc, { lang });
    doc.moveDown(0.2); doc.fontSize(11).text(pol.disclaimer);
    doc.moveDown(0.6); doc.fontSize(12).text(pol.thanks);
    doc.moveDown(0.2); applyFont(doc, { lang, weight: 'bold' }); doc.fontSize(12).text(lang==='hi' ? 'आपका दिन मंगलमय हो!' : 'Have a blessed day!!'); applyFont(doc, { lang });
    const year = new Date().getFullYear();
    doc.moveDown(0.8); doc.fontSize(9).fillColor('#555').text(`© ${year} ${pol.footerBrand}`, { align:'center' }); doc.fillColor('black');

    doc.pipe(res); doc.end();
  } catch (e) { res.status(500).json({ error: e.message || String(e) }); }
});

// WEEKLY → PDF (unchanged layout; cleaner subline)
app.post('/report/weekly', async (req, res) => {
  try {
    const { sign='aries', user={}, brand={}, lang: rawLang } = req.body || {};
    const lang = pickLang({ lang: rawLang });
    const now  = new Date();
    const { dateStr, timeStr } = toISTParts(now);

    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = composeDaily({ sign, lang, now }); // same composer
      days.push(d); now.setDate(now.getDate()+1);
    }

    const doc = new PDFDocument({ margin: 36, bufferPages: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="AstroBaba_Weekly_${sign}_${dateStr}_${lang}.pdf"`);

    applyFont(doc, { lang });

    const titleLine = lang==='hi' ? 'साप्ताहिक राशिफल (आज + 6)' : 'Weekly Horoscope (Today + 6)';
    const subLine   = `${(user?.name || (lang==='hi'?'मित्र':'Friend'))} • ${dateStr} ${timeStr}`;
    addBrandHeader(doc, { lang, brand, titleLine, subLine });
    addUserBlock(doc, { lang, user: {
      name:user?.name, phone:user?.phone, email:user?.email, gender:user?.gender,
      dob:user?.dob, tob:user?.time || user?.tob, place:user?.place,
    }});

    applyFont(doc, { lang, weight: 'bold' });
    doc.fontSize(12).text(greeting(lang));
    applyFont(doc, { lang });
    doc.moveDown(0.6);

    days.forEach((d, idx) => {
      const head = lang==='hi' ? `दिन ${idx+1}` : `Day ${idx+1}`;
      addSection(doc, { lang, heading: head, paragraphs: [] });
      const paras = [d.themeLead, d.luckyLine, '', ...(d.sections.opportunities.map(o=>`• ${o}`)), '', ...(d.sections.cautions.map(c=>`• ${c}`)), '', `Remedy: ${d.sections.remedy}`];
      paras.forEach(p => doc.fontSize(12).text(cleanText(p), { paragraphGap: 6, align: 'justify' }));
      doc.moveDown(0.4);
    });

    const pol = policyAgent(lang);
    doc.moveDown(0.8);
    applyFont(doc, { lang, weight: 'bold' }); doc.fontSize(12).text(lang==='hi' ? 'अंतिम नोट' : 'Final Note'); applyFont(doc, { lang });
    doc.moveDown(0.2); doc.fontSize(11).text(pol.disclaimer);
    doc.moveDown(0.6); doc.fontSize(12).text(pol.thanks);
    doc.moveDown(0.2); applyFont(doc, { lang, weight: 'bold' }); doc.fontSize(12).text(lang==='hi' ? 'आपका दिन मंगलमय हो!' : 'Have a blessed day!!'); applyFont(doc, { lang });
    const year = new Date().getFullYear();
    doc.moveDown(0.8); doc.fontSize(9).fillColor('#555').text(`© ${year} ${pol.footerBrand}`, { align:'center' }); doc.fillColor('black');

    doc.pipe(res); doc.end();
  } catch (e) { res.status(500).json({ error: e.message || String(e) }); }
});

// ─────────────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('OPENAI_API_KEY:', maskKey(OPENAI_API_KEY));
  console.log(`Fonts ready: ${FONTS_READY}`);
  console.log(`Astro-Baba Chat API listening on ${PORT}`);
});
