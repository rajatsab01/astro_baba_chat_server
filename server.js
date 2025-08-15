import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// agents (unchanged external files)
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

// Always try a local logo if client didn’t send one
function ensureBrandWithLogo(brand = {}) {
  if (brand?.logoBase64) return brand;
  const candidates = [
    path.join(__dirname, 'logo.png'),
    path.join(__dirname, 'assets', 'images', 'app_icon.png'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const b64 = fs.readFileSync(p).toString('base64');
        return { ...brand, logoBase64: b64 };
      }
    } catch {}
  }
  return brand;
}

// Blessing line (consistent everywhere)
const BLESS = {
  en: 'Have a blessed day!! We wish you a very cheerful, prosperous and wonderful day ahead with lots of blessings.',
  hi: 'आपका दिन मंगलमय हो! हम आपको अत्यंत हर्ष, समृद्धि और मंगलकामनाओं से भरा, आशीर्वादपूर्ण दिन की शुभकामनाएँ देते हैं।'
};

// ─────────────────────────────────────────────────────────────────────────────
// Vedic windows (12-hour day approximation; 6:00–18:00 with sunrise 06:00)
// ─────────────────────────────────────────────────────────────────────────────
// Mapping per weekday (0=Sun..6=Sat) for 12h-day approximation
function approxVedicSlots12h(weekday /*0..6*/) {
  // Rahu Kaal mapping you provided:
  const rahu = {
    0: '16:30–18:00', // Sun
    1: '07:30–09:00', // Mon
    2: '15:00–16:30', // Tue
    3: '12:00–13:30', // Wed
    4: '13:30–15:00', // Thu
    5: '10:30–12:00', // Fri
    6: '09:00–10:30', // Sat
  }[weekday];

  // Commonly used 12h patterns for Yamaganda / Gulika
  const yamaganda = {
    0: '12:00–13:30', // Sun
    1: '10:30–12:00', // Mon
    2: '09:00–10:30', // Tue
    3: '07:30–09:00', // Wed
    4: '06:00–07:30', // Thu
    5: '15:00–16:30', // Fri
    6: '13:30–15:00', // Sat
  }[weekday];

  const gulika = {
    0: '15:00–16:30', // Sun
    1: '13:30–15:00', // Mon
    2: '12:00–13:30', // Tue
    3: '10:30–12:00', // Wed
    4: '09:00–10:30', // Thu
    5: '07:30–09:00', // Fri
    6: '06:00–07:30', // Sat
  }[weekday];

  // Abhijit (12h day center)
  const abhijit = '12:05–12:52';
  return { rahuKaal: rahu, yamaganda, gulikaKaal: gulika, abhijitMuhurat: abhijit };
}

function vedicAssumptionNote(lang='en') {
  return lang === 'hi'
    ? 'टिप्पणी: वैदिक समय 6:00 AM सूर्योदय और 12 घंटे के दिन पर आधारित सरलीकृत अनुमान हैं — स्थान/ऋतु के अनुसार बदल सकते हैं।'
    : 'Note: Vedic windows use a 6:00 AM sunrise and 12-hour day approximation — actual times vary by location/season.';
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
  doc.moveDown(0.4);
}
function addVedicNote(doc, { lang }) {
  doc.fontSize(9).fillColor('#666').text(vedicAssumptionNote(lang));
  doc.fillColor('black').moveDown(0.6);
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
// Composer (pulls from all agents) — DAILY
// ─────────────────────────────────────────────────────────────────────────────
function composeDaily({ sign='aries', lang='en', now=new Date(), user=null } = {}) {
  const s = (sign || '').toLowerCase();
  const { ist, dateStr, timeStr, weekdayIndex } = toISTParts(now);
  const monthSalt = dateStr.slice(0,7); // YYYY-MM
  const seed = hashCode(`${monthSalt}|${s}|${dateStr}`);

  const deity = dayDeityAgent(weekdayIndex, lang);
  const format = formatAgent({ lang, dateIST: ist, deityPair: deity.pair });
  const panchang = panchangAgent(); // keep your agent
  const variety = varietyAgent({ sign: s, seed, weekdayIndex });
  const fortune = fortuneLineAgent({ sign: s, ist, seed, lang });
  const qm = quoteMoodAgent(seed);
  const policy = policyAgent(lang);
  const special = specialDayAgent({ now, lang, user }); // may be null

  let themeLead = variety.themeLead;
  let opp = variety.opportunities;
  let caut = variety.cautions;
  let remedy = variety.remedy;

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
    special,
    brandFooter: policy.footerBrand,

    // legacy
    text: `**${capSign(s)} • ${dateStr}**\n${themeLead}\n${fortune.luckyLine}\n\nOpportunities:\n- ${opp.join('\n- ')}\n\nCautions:\n- ${caut.join('\n- ')}\n\nRemedy:\n${remedy}`
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Gemstone / Mantra composers (sign-only safe fallbacks)
// ─────────────────────────────────────────────────────────────────────────────
function rulerForSign(sign) {
  const s = String(sign).toLowerCase();
  const map = {
    aries:'mars', taurus:'venus', gemini:'mercury', cancer:'moon',
    leo:'sun', virgo:'mercury', libra:'venus', scorpio:'mars',
    sagittarius:'jupiter', capricorn:'saturn', aquarius:'saturn', pisces:'jupiter'
  };
  return map[s] || 'sun';
}

function gemPlanForSign(sign) {
  const r = rulerForSign(sign);
  // Safe upratna alternates where needed; avoid default Venus for Aries
  const plan = {
    mars:   { primary:'Red Coral (Moonga)', alt:'Carnelian', tone:'discipline, courage, decisive action' },
    venus:  { primary:'Diamond / White Sapphire (caution: chart-specific)', alt:'Opal / Zircon', tone:'harmony, relationships, aesthetics' },
    mercury:{ primary:'Emerald (Panna)', alt:'Peridot', tone:'clarity, learning, communication' },
    moon:   { primary:'Pearl (Moti)', alt:'Moonstone', tone:'emotional balance, calm, nourishment' },
    sun:    { primary:'Ruby (Manik)', alt:'Garnet', tone:'confidence, leadership, vitality' },
    jupiter:{ primary:'Yellow Sapphire (Pukhraj)', alt:'Citrine', tone:'wisdom, growth, blessings' },
    saturn: { primary:'Blue Sapphire (Neelam — test first)', alt:'Amethyst', tone:'steadiness, structure, patience' },
  }[r];

  // Aries special guard: do not suggest Diamond by default
  if (String(sign).toLowerCase() === 'aries') {
    return { ...plan, note:'For Aries, avoid Venus stones by default unless a full chart approves.' };
  }
  return plan;
}

function mantraForPlanet(planet) {
  const map = {
    sun:     { seed:'Om Hram Hrim Hraum Suryaya Namah', count:108 },
    moon:    { seed:'Om Som Somaya Namah', count:108 },
    mars:    { seed:'Om Kraam Kreem Kraum Sah Bhaumaya Namah', count:108 },
    mercury: { seed:'Om Braam Breem Broum Sah Budhaya Namah', count:108 },
    jupiter: { seed:'Om Graam Greem Graum Sah Gurave Namah', count:108 },
    venus:   { seed:'Om Draam Dreem Draum Sah Shukraya Namah', count:108 },
    saturn:  { seed:'Om Praam Preem Praum Sah Shanaye Namah', count:108 },
    rahu:    { seed:'Om Ram Rahave Namah', count:108 },
    ketu:    { seed:'Om Kem Ketave Namah', count:108 },
  };
  return map[planet] || map.sun;
}

function powerGemText(lang) {
  return lang === 'hi'
    ? 'ज्योतिष परंपरा के अनुसार, रत्न सूक्ष्म लेंस की तरह सहायक ग्रह धाराओं की ओर ध्यान ट्यून करते हैं। आकार में छोटे पर प्रभाव में समर्थ—मानो बड़े ताले की छोटी चाबी। सही धातु, उचित उंगली और विधिपूर्वक ऊर्जन के साथ, रत्न अनुकूल ऊर्जा को छानकर केंद्रित करने में सहायक होता है। विश्वास और अनुशासन के साथ पहना गया सही रत्न मन को स्थिर कर सकता है, अटकी संभावनाएँ खोल सकता है और प्रतिकूल प्रभावों से सौम्य संरक्षण दे सकता है।'
    : 'As per Jyotish tradition, gemstones act like tiny lenses that tune you toward supportive planetary currents. Small yet potent—like a small key for a big lock. Set in the proper metal, on the correct finger, and duly energized, a stone helps filter and focus favourable energies. With steady faith and discipline, a correctly prescribed stone can steady the mind, unlock stuck opportunities, and gently shield against adverse influences.';
}

function powerMantraText(lang) {
  return lang === 'hi'
    ? 'मंत्र छोटी चाबी की तरह बड़े ताले के लिए हो सकता है। समस्याएँ बड़ी दिखें, फिर भी सही ध्वनि का सही जप मनोदशा, एकाग्रता और कृपा को सँवार देता है। नियमित जप आधुनिक काल का संकल्प-साधना है—उचित उच्चारण, निश्चित संख्या और स्पष्ट भाव से अटके रास्ते खुल सकते हैं। कुछ पंक्तियाँ भी, सही विधि और निरंतरता से, परिणाम बदलने में सक्षम हैं।'
    : 'A mantra can be a small key for a big lock. Problems may look large, but the right sound in the right way reshapes mood, focus, and grace around you. Regular chanting is modern-day manifestation—the precise vibration, count, and intention can unlock stuck paths. Even a few lines, done correctly and consistently, can shift outcomes.';
}

// ─────────────────────────────────────────────────────────────────────────────
// Routes — debug
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

// ─────────────────────────────────────────────────────────────────────────────
// DAILY JSON
// ─────────────────────────────────────────────────────────────────────────────
app.get('/daily', (req, res) => {
  const sign = (req.query.sign || 'aries').toString().toLowerCase();
  const lang = pickLang({ lang: req.query.lang });
  const data = composeDaily({ sign, lang });
  res.json({
    date: data.date,
    sign: data.sign,
    lang: data.lang,
    text: data.text,
    vedic: data.vedic,
    generatedAt: new Date().toISOString(),
    rich: data
  });
});
app.post('/daily', (req, res) => {
  const { sign='aries', lang='en', user=null } = req.body || {};
  const data = composeDaily({ sign, lang: pickLang({ lang }), user });
  res.json({
    date: data.date,
    sign: data.sign,
    lang: data.lang,
    text: data.text,
    vedic: data.vedic,
    generatedAt: new Date().toISOString(),
    rich: data
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DAILY → PDF
// ─────────────────────────────────────────────────────────────────────────────
app.post('/report/from-daily', async (req, res) => {
  try {
    const { sign='aries', user={}, brand={}, lang: rawLang } = req.body || {};
    const lang  = pickLang({ lang: rawLang });
    const daily = composeDaily({ sign, lang, user });

    const doc = new PDFDocument({ margin: 36, bufferPages: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="AstroBaba_Daily_${sign}_${daily.date}_${lang}.pdf"`);

    applyFont(doc, { lang, weight: 'regular' });

    // Header (brand once; subline with name + IST)
    const titleLine = lang==='hi' ? 'दैनिक राशिफल' : 'Daily Horoscope';
    const subLine   = `${(user?.name || (lang==='hi'?'मित्र':'Friend'))} • ${daily.date} ${daily.timeIST}`;
    const brandFixed = ensureBrandWithLogo({ ...brand, appName: brand?.appName || 'Astro-Baba' });
    addBrandHeader(doc, { lang, brand: brandFixed, titleLine, subLine });

    // User block
    addUserBlock(doc, { lang, user: {
      name:  user?.name, phone: user?.phone, email: user?.email, gender:user?.gender,
      dob:   user?.dob,  tob:   user?.time || user?.tob,       place: user?.place,
    }});

    // Vedic timings (+ note)
    addVedicTimings(doc, { lang, timings: daily.vedic });
    addVedicNote(doc, { lang });

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
    doc.fontSize(12).text(lang==='hi' ? BLESS.hi : BLESS.en);
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

// ─────────────────────────────────────────────────────────────────────────────
// GEMSTONE → PDF (hybrid; sign-safe)
// ─────────────────────────────────────────────────────────────────────────────
app.post('/report/gemstone', async (req, res) => {
  try {
    const { sign='aries', user={}, brand={}, lang: rawLang } = req.body || {};
    const lang = pickLang({ lang: rawLang });
    const { dateStr, timeStr } = toISTParts(new Date());
    const plan = gemPlanForSign(sign);
    const planet = rulerForSign(sign);

    const doc = new PDFDocument({ margin: 36, bufferPages: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="AstroBaba_Gemstone_${sign}_${dateStr}_${lang}.pdf"`);

    applyFont(doc, { lang });

    const titleLine = lang==='hi' ? `रत्न मार्गदर्शन — ${capSign(sign)}` : `Gemstone Guidance — ${capSign(sign)}`;
    const subLine   = `${(user?.name || (lang==='hi'?'मित्र':'Friend'))} • ${dateStr} ${timeStr}`;
    const brandFixed = ensureBrandWithLogo({ ...brand, appName: brand?.appName || 'Astro-Baba' });
    addBrandHeader(doc, { lang, brand: brandFixed, titleLine, subLine });

    addUserBlock(doc, { lang, user: {
      name:user?.name, phone:user?.phone, email:user?.email, gender:user?.gender,
      dob:user?.dob, tob:user?.time || user?.tob, place:user?.place,
    }});

    // Greeting
    applyFont(doc, { lang, weight: 'bold' }); doc.fontSize(12).text(greeting(lang)); applyFont(doc, { lang }); doc.moveDown(0.6);

    // Planetary snapshot
    const snapHead = lang==='hi' ? 'ग्रह संकेत (संक्षेप)' : 'Planetary Snapshot (brief)';
    const snapPara = lang==='hi'
      ? `आपके सूर्य राशि हेतु प्राथमिक ग्रह संकेत: ${capSign(sign)} के लिए ${planet.toUpperCase()} — ${plan.tone}.`
      : `Primary support for your sun sign: ${capSign(sign)} leans on ${planet.toUpperCase()} — ${plan.tone}.`;
    addSection(doc, { lang, heading: snapHead, paragraphs: [snapPara] });

    // Recommendations
    const recHead = lang==='hi' ? 'मुख्य सुझाव' : 'Recommendation';
    const lines = lang==='hi'
      ? [
          `प्रमुख रत्न: ${plan.primary}`,
          `वैकल्पिक (हल्का/उप्रत्न): ${plan.alt}`,
          `उद्देश्य: ${plan.tone}`,
          plan?.note ? `नोट: ${plan.note}` : null
        ].filter(Boolean)
      : [
          `Primary gemstone: ${plan.primary}`,
          `Alternate (upratna/gentler): ${plan.alt}`,
          `Planet focus: ${plan.tone}`,
          plan?.note ? `Note: ${plan.note}` : null
        ].filter(Boolean);
    addSection(doc, { lang, heading: recHead, paragraphs: lines });

    // How to wear
    const howHead = lang==='hi' ? 'कैसे पहनें' : 'How to Wear';
    const howParas = lang==='hi'
      ? [
          'आरंभ: मंगलवार/शनिवार, अभिजीत मुहूर्त में।',
          'परीक्षण अवधि: 45–60 दिन; मन की स्थिरता, ऊर्जा, ध्यान पर ध्यान दें।',
          'धातु: सिल्वर (या पंचधातु)।',
          'उंगली/हाथ: दाएँ हाथ की अनामिका उंगली (आम रूप से)।',
          'वज़न: सम्मत के अनुसार; पत्थर असली रखें — पारदर्शिता आकार से अधिक महत्त्वपूर्ण।',
          'शुद्धि: स्वच्छ जल + कच्चे दूध की कुछ बूँदें; मुलायम कपड़े से पोंछें।',
          'ऊर्जन: दीपक जलाएँ; “ॐ क्राम क्रीम क्रौं सह भौमाय नमः” 108×; संकल्प बोलें।',
          'पहनने के बाद 11 मिनट शांत रहें।'
        ]
      : [
          'Start: Tuesday/Saturday, during Abhijit Muhurat.',
          'Trial: 45–60 days; observe calmness, energy and focus.',
          'Metal: Silver (or Panchdhatu).',
          'Finger/hand: Ring finger (right) in most cases.',
          'Weight: As advised — keep it genuine; clarity > size.',
          'Cleansing: Clean water + a few drops of raw milk; pat dry.',
          'Energizing: Light a diya; chant “Om Kraam Kreem Kraum Sah Bhaumaya Namah” 108×; state your Sankalpa.',
          'After wearing, stay calm for ~11 minutes.'
        ];
    addSection(doc, { lang, heading: howHead, paragraphs: howParas });

    // Do / Don't
    const ddHead = lang==='hi' ? 'क्या करें / क्या न करें' : 'Do / Don’t';
    const ddLines = lang==='hi'
      ? [
          'करें: यदि पत्थर टूटे/दरारे हों तो हटाएँ; असंगत रत्नों के साथ एक साथ न पहनें।',
          'न करें: सिंथेटिक/उष्मा-उपचारित रत्नों को मिलाकर न पहनें; एलर्जी हो तो परहेज़ करें।',
          'रखरखाव: हल्का साफ़ करें; कठोर रसायनों से बचें; मासिक ऊर्जन (मंगलवार शाम)।'
        ]
      : [
          'Do: Remove if cracked/chipped; avoid wearing alongside incompatible stones.',
          'Don’t: Mix with synthetic/heat-treated stones; avoid during metal-allergy flare-ups.',
          'Maintenance: Gentle cleaning; avoid harsh chemicals; monthly re-energizing (Tuesday evening).'
        ];
    addSection(doc, { lang, heading: ddHead, paragraphs: ddLines });

    // Sankalpa
    const sankHead = lang==='hi' ? 'संकल्प (एक वाक्य)' : 'Sankalpa (intention)';
    const sankLine = lang==='hi'
      ? '“श्रद्धा और अनुशासन के साथ, यह रत्न मेरी ऊर्जा को स्थिर करे और सही अवसर खोले।”'
      : '“With faith and discipline, may this stone steady my energy and open right opportunities.”';
    addSection(doc, { lang, heading: sankHead, paragraphs: [sankLine] });

    // Observation checklist
    const obsHead = lang==='hi' ? 'अवलोकन जाँच सूची' : 'Observation checklist';
    const obs = lang==='hi'
      ? 'नींद ◻  ऊर्जा ◻  मनोदशा ◻  एकाग्रता ◻  वित्त ◻  संबंध ◻  स्वास्थ्य ◻'
      : 'Sleep ◻  Energy ◻  Mood ◻  Focus ◻  Finances ◻  Relationships ◻  Health ◻';
    addSection(doc, { lang, heading: obsHead, paragraphs: [obs] });

    // Power of Gemstones (philosophy)
    addSection(doc, { lang, heading: lang==='hi'?'रत्न की शक्ति':'Power of Gemstones', paragraphs: [powerGemText(lang)] });

    // Final note + thanks + blessing
    const pol = policyAgent(lang);
    doc.moveDown(0.8);
    applyFont(doc, { lang, weight: 'bold' }); doc.fontSize(12).text(lang==='hi' ? 'अंतिम नोट' : 'Final Note'); applyFont(doc, { lang });
    doc.moveDown(0.2); doc.fontSize(11).text(pol.disclaimer);
    doc.moveDown(0.6); doc.fontSize(12).text(pol.thanks);
    doc.moveDown(0.2); applyFont(doc, { lang, weight: 'bold' }); doc.fontSize(12).text(lang==='hi' ? BLESS.hi : BLESS.en); applyFont(doc, { lang });
    const year = new Date().getFullYear();
    doc.moveDown(0.8); doc.fontSize(9).fillColor('#555').text(`© ${year} ${pol.footerBrand}`, { align:'center' }); doc.fillColor('black');

    doc.pipe(res); doc.end();
  } catch (e) { res.status(500).json({ error: e.message || String(e) }); }
});

// GENERIC PACKAGE → PDF (Gemstone / Mantra etc.)
// Uses existing helpers: pickLang, toISTParts, applyFont, ensureBrandWithLogo,
// addBrandHeader, addUserBlock, addSection, drawBullets, greeting, policyAgent.
app.post('/report/generate', async (req, res) => {
  try {
    const { package: pkg = 'gemstone', user = {}, brand = {}, lang: rawLang } = req.body || {};
    const lang = pickLang({ lang: rawLang });
    const now  = new Date();
    const { dateStr, timeStr } = toISTParts(now);

    // Minimal sample content (you can swap in your Gemstone/Mantra composer later)
    const titleLine = lang === 'hi'
      ? (pkg === 'mantra' ? 'मंत्र रिपोर्ट' : 'रत्न रिपोर्ट')
      : (pkg === 'mantra' ? 'Mantra Report' : 'Gemstone Report');

    const intro = lang === 'hi'
      ? [
          'यह संक्षिप्त, व्यावहारिक मार्गदर्शिका है — सरल कदमों में पालन करें।',
          'पहले 45–60 दिनों तक नियमितता बनाए रखें और अनुभव दर्ज करें।'
        ]
      : [
          'This is a concise, practical guide — follow in simple steps.',
          'Maintain regularity for 45–60 days and track observations.'
        ];

    const opp = lang === 'hi'
      ? ['आज एक छोटा लेकिन स्पष्ट कदम उठाएँ।', 'सही समय/उंगली/धातु पर ध्यान दें।', 'साप्ताहिक नोट्स बनाएं — ऊर्जा/मूड/नींद।']
      : ['Take one small, clear step today.', 'Mind the correct time/finger/metal.', 'Keep weekly notes: energy/mood/sleep.'];

    const caut = lang === 'hi'
      ? ['अत्यधिक अपेक्षाओं से बचें — क्रमिक प्रगति सर्वोत्तम है।', 'कृत्रिम/हीट-ट्रीटेड से बचें।', 'एलर्जी/चोट की स्थिति में विराम लें।']
      : ['Avoid over-expectation — steady progress is best.', 'Avoid synthetic/heat-treated pieces.', 'Pause in case of allergy/injury.'];

    const remedy = lang === 'hi'
      ? 'शाम को दीपक जलाएँ, 11 बार जप करें और 2 मिनट शांति रखें।'
      : 'In the evening, light a diya, chant 11×, and sit calmly for 2 minutes.';

    const doc = new PDFDocument({ margin: 36, bufferPages: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="AstroBaba_${pkg}_${dateStr}_${lang}.pdf"`
    );

    applyFont(doc, { lang });

    const subLine = `${(user?.name || (lang === 'hi' ? 'मित्र' : 'Friend'))} • ${dateStr} ${timeStr}`;
    const brandFixed = ensureBrandWithLogo({ ...brand, appName: brand?.appName || 'Astro-Baba' });
    addBrandHeader(doc, { lang, brand: brandFixed, titleLine, subLine });

    addUserBlock(doc, {
      lang,
      user: {
        name: user?.name,
        phone: user?.phone,
        email: user?.email,
        gender: user?.gender,
        dob: user?.dob,
        tob: user?.time || user?.tob,
        place: user?.place
      }
    });

    // Greeting
    applyFont(doc, { lang, weight: 'bold' });
    doc.fontSize(12).text(greeting(lang));
    applyFont(doc, { lang });
    doc.moveDown(0.6);

    // Intro
    addSection(doc, { lang, heading: lang === 'hi' ? 'परिचय' : 'Introduction', paragraphs: intro });

    // Opportunities / Cautions
    applyFont(doc, { lang, weight: 'bold' }); doc.fontSize(14).text(lang === 'hi' ? 'अवसर' : 'Opportunities'); applyFont(doc, { lang });
    drawBullets(doc, opp, { lang }); doc.moveDown(0.4);

    applyFont(doc, { lang, weight: 'bold' }); doc.fontSize(14).text(lang === 'hi' ? 'सावधानियाँ' : 'Cautions'); applyFont(doc, { lang });
    drawBullets(doc, caut, { lang }); doc.moveDown(0.4);

    // Practice / Remedy
    addSection(doc, { lang, heading: lang === 'hi' ? 'अभ्यास/उपाय' : 'Practice / Remedy', paragraphs: [remedy] });

    // Standard blessing line (bold look via Unicode bold characters)
    doc.moveDown(0.8);
    applyFont(doc, { lang, weight: 'bold' });
    doc.fontSize(12).text(
      lang === 'hi'
        ? '𝗛𝗮𝘃𝗲 𝗮 𝗯𝗹𝗲𝘀𝘀𝗲𝗱 𝗱𝗮𝘆!! 𝗪𝗲 𝘄𝗶𝘀𝗵 𝘆𝗼𝘂 𝗮 𝘃𝗲𝗿𝘆 𝗰𝗵𝗲𝗲𝗿𝗳𝘂𝗹, 𝗽𝗿𝗼𝘀𝗽𝗲𝗿𝗼𝘂𝘀 𝗮𝗻𝗱 𝘄𝗼𝗻𝗱𝗲𝗿𝗳𝘂𝗹 𝗱𝗮𝘆 𝗮𝗵𝗲𝗮𝗱 𝘄𝗶𝘁𝗵 𝗹𝗼𝘁𝘀 𝗼𝗳 𝗯𝗹𝗲𝘀𝘀𝗶𝗻𝗴𝘀...'
        : '𝗛𝗮𝘃𝗲 𝗮 𝗯𝗹𝗲𝘀𝘀𝗲𝗱 𝗱𝗮𝘆!! 𝗪𝗲 𝘄𝗶𝘀𝗵 𝘆𝗼𝘂 𝗮 𝘃𝗲𝗿𝘆 𝗰𝗵𝗲𝗲𝗿𝗳𝘂𝗹, 𝗽𝗿𝗼𝘀𝗽𝗲𝗿𝗼𝘂𝘀 𝗮𝗻𝗱 𝘄𝗼𝗻𝗱𝗲𝗿𝗳𝘂𝗹 𝗱𝗮𝘆 𝗮𝗵𝗲𝗮𝗱 𝘄𝗶𝘁𝗵 𝗹𝗼𝘁𝘀 𝗼𝗳 𝗯𝗹𝗲𝘀𝘀𝗶𝗻𝗴𝘀...'
    );
    applyFont(doc, { lang });

    // Footer ©
    const pol = policyAgent(lang);
    doc.moveDown(0.6);
    const year = new Date().getFullYear();
    doc.fontSize(9).fillColor('#555').text(`© ${year} ${pol.footerBrand}`, { align: 'center' });
    doc.fillColor('black');

    doc.pipe(res);
    doc.end();
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// MANTRA → PDF (hybrid; sign-safe)
// ─────────────────────────────────────────────────────────────────────────────
app.post('/report/mantra', async (req, res) => {
  try {
    const { sign='aries', user={}, brand={}, lang: rawLang } = req.body || {};
    const lang    = pickLang({ lang: rawLang });
    const { dateStr, timeStr, weekdayIndex } = toISTParts(new Date());
    const planet  = rulerForSign(sign);
    const seedMan = mantraForPlanet(planet);

    const doc = new PDFDocument({ margin: 36, bufferPages: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="AstroBaba_Mantra_${sign}_${dateStr}_${lang}.pdf"`);

    applyFont(doc, { lang });

    const titleLine = lang==='hi' ? `मंत्र मार्गदर्शन — ${capSign(sign)}` : `Mantra Guidance — ${capSign(sign)}`;
    const subLine   = `${(user?.name || (lang==='hi'?'मित्र':'Friend'))} • ${dateStr} ${timeStr}`;
    const brandFixed = ensureBrandWithLogo({ ...brand, appName: brand?.appName || 'Astro-Baba' });
    addBrandHeader(doc, { lang, brand: brandFixed, titleLine, subLine });

    addUserBlock(doc, { lang, user: {
      name:user?.name, phone:user?.phone, email:user?.email, gender:user?.gender,
      dob:user?.dob, tob:user?.time || user?.tob, place:user?.place,
    }});

    // Greeting
    applyFont(doc, { lang, weight: 'bold' }); doc.fontSize(12).text(greeting(lang)); applyFont(doc, { lang }); doc.moveDown(0.6);

    // Planetary tone
    const toneHead = lang==='hi' ? 'ग्रह प्रवृत्ति (टोन)' : 'Planetary Tone';
    const toneLine = lang==='hi'
      ? `${planet.toUpperCase()} — संतुलन एवं प्रगति हेतु सहायक स्पंदन।`
      : `${planet.toUpperCase()} — supportive vibration for balance and progress.`;
    addSection(doc, { lang, heading: toneHead, paragraphs: [toneLine] });

    // Mantra prescription
    const manHead  = lang==='hi' ? 'मुख्य मंत्र' : 'Primary Mantra';
    const manLine  = seedMan.seed;
    const schedHead= lang==='hi' ? 'अनुष्ठान / नियम' : 'Practice';
    const sched = lang==='hi'
      ? [
          'समय: सूर्योदय या सूर्यास्त; शांत स्थान।',
          `गणना: ${seedMan.count}× माला (रुद्राक्ष/क्रिस्टल); स्वच्छ उच्चारण।`,
          'आसन: सुखासन; रीढ़ सीधी; दृष्टि कोमल।',
          'पूर्व/पश्चात: दीपक/अगरबत्ती; 1 मिनट शांत बैठना।',
          'साप्ताहिक अनुशंसा: कम-से-कम 4 दिन नियमित।'
        ]
      : [
          'Timing: Sunrise or sunset; a quiet spot.',
          `Count: ${seedMan.count}× (rudraksha/crystal mala); clear pronunciation.`,
          'Posture: Comfortable seat; spine tall; soft gaze.',
          'Before/After: Light a diya/incense; sit quietly for a minute.',
          'Weekly cadence: at least 4 days regular.'
        ];
    addSection(doc, { lang, heading: manHead, paragraphs: [manLine] });
    addSection(doc, { lang, heading: schedHead, paragraphs: sched });

    // Sankalpa
    const sankHead = lang==='hi' ? 'संकल्प (एक वाक्य)' : 'Sankalpa (intention)';
    const sankLine = lang==='hi'
      ? '“मैं शुद्ध भाव और अनुशासन के साथ जप करता/करती हूँ; मार्ग प्रशस्त हो।”'
      : '“I chant with pure intention and discipline; may right paths open.”';
    addSection(doc, { lang, heading: sankHead, paragraphs: [sankLine] });

    // Power of Mantra
    addSection(doc, { lang, heading: lang==='hi'?'मंत्र की शक्ति':'Power of the Mantra', paragraphs: [powerMantraText(lang)] });

    // Final note + thanks + blessing
    const pol = policyAgent(lang);
    doc.moveDown(0.8);
    applyFont(doc, { lang, weight: 'bold' }); doc.fontSize(12).text(lang==='hi' ? 'अंतिम नोट' : 'Final Note'); applyFont(doc, { lang });
    doc.moveDown(0.2); doc.fontSize(11).text(pol.disclaimer);
    doc.moveDown(0.6); doc.fontSize(12).text(pol.thanks);
    doc.moveDown(0.2); applyFont(doc, { lang, weight: 'bold' }); doc.fontSize(12).text(lang==='hi' ? BLESS.hi : BLESS.en); applyFont(doc, { lang });
    const year = new Date().getFullYear();
    doc.moveDown(0.8); doc.fontSize(9).fillColor('#555').text(`© ${year} ${pol.footerBrand}`, { align:'center' }); doc.fillColor('black');

    doc.pipe(res); doc.end();
  } catch (e) { res.status(500).json({ error: e.message || String(e) }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// WEEKLY → PDF (logo/user/greeting once; each day = real DAY, DATE + Vedic)
// ─────────────────────────────────────────────────────────────────────────────
app.post('/report/weekly', async (req, res) => {
  try {
    const { sign='aries', user={}, brand={}, lang: rawLang } = req.body || {};
    const lang = pickLang({ lang: rawLang });
    const start = new Date();
    const { dateStr, timeStr } = toISTParts(start);

    // Build 7 days from the same composer with correct advancing dates
    const days = [];
    const roll = new Date(start);
    for (let i = 0; i < 7; i++) {
      const d = composeDaily({ sign, lang, now: new Date(roll) });
      days.push({ d, dateObj: new Date(roll) });
      roll.setDate(roll.getDate() + 1);
    }

    const doc = new PDFDocument({ margin: 36, bufferPages: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="AstroBaba_Weekly_${sign}_${dateStr}_${lang}.pdf"`);

    applyFont(doc, { lang });

    const titleLine = lang==='hi' ? 'साप्ताहिक राशिफल' : 'Weekly Horoscope';
    const subLine   = `${(user?.name || (lang==='hi'?'मित्र':'Friend'))} • ${dateStr} ${timeStr}`;
    const brandFixed = ensureBrandWithLogo({ ...brand, appName: brand?.appName || 'Astro-Baba' });
    addBrandHeader(doc, { lang, brand: brandFixed, titleLine, subLine });

    // One-time user block + one-time greeting
    addUserBlock(doc, { lang, user: {
      name:user?.name, phone:user?.phone, email:user?.email, gender:user?.gender,
      dob:user?.dob, tob:user?.time || user?.tob, place:user?.place,
    }});

    applyFont(doc, { lang, weight: 'bold' });
    doc.fontSize(12).text(greeting(lang));
    applyFont(doc, { lang });
    doc.moveDown(0.6);

    // Each day: real DAY, DATE + that day's Vedic timings (12h approximation)
    days.forEach(({ d, dateObj }, idx) => {
      addSection(doc, { lang, heading: d.header.dayHeader, paragraphs: [] });

      // Vedic timings for that weekday (approx) — shown inline per day
      const wk = dateObj.getDay(); // 0..6
      const vt = approxVedicSlots12h(wk);
      addVedicTimings(doc, { lang, timings: vt });

      const paras = [
        d.themeLead,
        d.luckyLine,
        '',
        ...(d.sections.opportunities.map(o=>`• ${o}`)),
        '',
        ...(d.sections.cautions.map(c=>`• ${c}`)),
        '',
        (lang==='hi' ? 'उपाय: ' : 'Remedy: ') + d.sections.remedy
      ];

      paras.forEach(p => doc.fontSize(12).text(cleanText(p), { paragraphGap: 6, align: 'justify' }));
      doc.moveDown(0.4);
    });

    // One-time Vedic note at the end (applies to all 7 tables)
    addVedicNote(doc, { lang });

    // Final note + thanks + blessing (once)
    const pol = policyAgent(lang);
    doc.moveDown(0.8);
    applyFont(doc, { lang, weight: 'bold' }); doc.fontSize(12).text(lang==='hi' ? 'अंतिम नोट' : 'Final Note'); applyFont(doc, { lang });
    doc.moveDown(0.2); doc.fontSize(11).text(pol.disclaimer);
    doc.moveDown(0.6); doc.fontSize(12).text(pol.thanks);
    doc.moveDown(0.2); applyFont(doc, { lang, weight: 'bold' }); doc.fontSize(12).text(lang==='hi' ? BLESS.hi : BLESS.en); applyFont(doc, { lang });
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
