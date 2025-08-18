import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// agents (unchanged external files)
import contentBank from './agents/contentBank.js';
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

// ⬇️ App
const app  = express();
const PORT = process.env.PORT || 10000;
const OPENAI_API_KEY = (process.env.OPENAI_API_KEY || '').trim();

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// Build/meta headers
const BUILD = '2025-08-17.04';
app.use((req, res, next) => {
  res.setHeader('X-AB-Build', BUILD);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

// ── Try to import yearly & family agents (ESM/CJS safe) ──────────────────────
let getYearlyForUser = null;
let buildFamilySections = null;
try {
  const yearlyAgentMod = await import('./agents/yearlyAgent.js');
  getYearlyForUser = yearlyAgentMod?.getYearlyForUser || yearlyAgentMod?.default?.getYearlyForUser || null;
} catch {}
try {
  const familyAgentMod = await import('./agents/familyAgent.js');
  buildFamilySections = familyAgentMod?.buildFamilySections || familyAgentMod?.default?.buildFamilySections || null;
} catch {}

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

// ── Translation helpers (best-effort, safe no-ops if agent missing) ─────────
async function toLang(text, lang) {
  if (!text || lang !== 'hi') return text;
  try {
    if (typeof translateAgent === 'function') {
      return await translateAgent(text, 'hi');
    }
    if (translateAgent && typeof translateAgent.translate === 'function') {
      return await translateAgent.translate(text, 'hi');
    }
  } catch {}
  return text;
}
async function toLangList(arr, lang) {
  if (!Array.isArray(arr) || lang !== 'hi') return arr || [];
  const out = [];
  for (const t of arr) out.push(await toLang(t, 'hi'));
  return out;
}

// --- Post-translate cleanup for Hindi (Hinglish→Hindi + typos + weekly lines) ---
function cleanHi(s) {
  if (!s) return s;
  let out = String(s);

  // ── WEEKLY THEMES & LINES (EN → HI) ───────────────────────────────────
  out = out.replace(/Stewardship\s*&\s*Savings/gi, 'संरक्षण और बचत');
  out = out.replace(/tighten one small leak/gi, 'एक छोटी रिसाव बंद करें');

  out = out.replace(/Creative\s*Spark/gi, 'रचनात्मक चिंगारी');
  out = out.replace(/test a playful idea quickly/gi, 'एक खिलंदड़े विचार को जल्दी परखें');

  out = out.replace(/Relationship\s*Warmth/gi, 'संबंधों में ऊष्मा');
  out = out.replace(/short honest (?:conversations?|बातचीत)s? go far/gi, 'छोटी ईमानदार बातचीत बहुत असर करती है');

  out = out.replace(/Pragmatic\s*Care/gi, 'व्यावहारिक देखभाल');
  out = out.replace(/body,\s*sleep,\s*budgeting,\s*tiny wins/gi, 'शरीर, नींद, बजट, छोटी-छोटी जीत');

  out = out.replace(/Learn one micro[- ]skill you[’']?ll reuse this week/gi, 'एक सूक्ष्म कौशल सीखें जिसे आप इस सप्ताह फिर उपयोग करेंगे');
  out = out.replace(/Journal one page to clear mental fog/gi, 'मानसिक धुंध हटाने के लिए एक पृष्ठ जर्नल लिखें');

  out = out.replace(/Skip unplanned purchases sparked by mood/gi, 'मूड में की गई अनियोजित खरीद से बचें');
  out = out.replace(/Limit multitasking during crucial work/gi, 'महत्वपूर्ण काम के दौरान मल्टीटास्किंग सीमित रखें');
  out = out.replace(/Don[’']?t overfill the calendar\s*—\s*leave white space/gi, 'कैलेंडर मत ठूँसें — थोड़ा खाली समय छोड़ें');

  out = out.replace(/Invest 20 minutes in a health micro[- ]habit/gi, 'स्वास्थ्य की एक सूक्ष्म आदत में 20 मिनट लगाएँ');
  out = out.replace(/Touch base with a senior\/mentor for a 30[- ]sec checkpoint/gi, 'किसी वरिष्ठ\/मार्गदर्शक से 30-सेकंड का चेकपॉइंट लें');
  out = out.replace(/Draft a quick 3[–-]6[- ]month outline so today fits a bigger arc/gi, 'आज को बड़े प्रवाह में फिट करने के लिए 3–6 माह की एक त्वरित रूपरेखा बनाएँ');
  out = out.replace(/Polish one thing already working instead of adding new/gi, 'जो काम चल रहा है उसी को थोड़ा और सँवारें — नया जोड़ने से बेहतर');

  out = out.replace(/Before work, chant “?Om Gam Ganapataye”? ?21× for obstacle clearing/gi, 'कार्य से पहले “ॐ गं गणपतये” 21 बार जप करें — विघ्न शमन हेतु');
  out = out.replace(/At sunset, read a few names from Vishnu Sahasranama; offer chana dal\s*&\s*turmeric/gi, 'सूर्यास्त पर विष्णु सहस्रनाम के कुछ नाम पढ़ें; चना दाल और हल्दी अर्पित करें');
  out = out.replace(/Light a (?:pleasant )?fragrance; recite Sri Suktam or express gratitude for sufficiency/gi, 'सुगंधित धूप\/दीप जलाएँ; श्री सूक्त का पाठ करें या पर्याप्तता के लिए कृतज्ञता व्यक्त करें');
  out = out.replace(/Ship one starter task before lunch to unlock afternoon flow/gi, 'दोपहर भोजन से पहले एक प्रारंभिक काम पूरा करें ताकि दोपहर का प्रवाह खुले');
  out = out.replace(/At sunrise, face east and offer gratitude to the Sun; keep 2 minutes of stillness/gi, 'सूर्योदय पर पूर्वमुख होकर सूर्य को कृतज्ञता अर्पित करें; 2 मिनट शांत बैठें');
  out = out.replace(/At sunset, chant Hanuman Chalisa; keep conduct calm and fair/gi, 'सूर्यास्त पर हनुमान चालीसा जपें; आचरण शांत और न्यायपूर्ण रखें');
  out = out.replace(/In the evening, recite Hanuman Chalisa once; offer a little sesame oil/gi, 'संध्या में हनुमान चालीसा एक बार पढ़ें; थोड़ा तिल का तेल अर्पित करें');

  out = out.replace(/late-?night screens/gi, 'रात देर तक स्क्रीन');

  // ── OCR/LIGATURE & COMMON TYPO FIXES ──────────────────────────────────
  out = out.replace(/ईर्मेल/g, 'ईमेल');
  out = out.replace(/ईर्मानदार/g, 'ईमानदार');
  out = out.replace(/गमर्जोशी/g, 'गर्मजोशी');
  out = out.replace(/कायर्/g, 'कार्य');
  out = out.replace(/समयसीमाआें/g, 'समयसीमाओं');
  out = out.replace(/मानिसक/g, 'मानसिक');
  out = out.replace(/जनर्ल/g, 'जर्नल');
  out = out.replace(/अिपंत/g, 'अर्पित');
  out = out.replace(/पयार्प्तता/g, 'पर्याप्तता');
  out = out.replace(/सूयार्स्त/g, 'सूर्यास्त');
  out = out.replace(/सूयार्दय/g, 'सूर्योदय');
  out = out.replace(/संबंधाें/g, 'संबंधों');
  out = out.replace(/िरसाव/g, 'रिसाव');

  // ── GENERAL HINGLISH NORMALIZATIONS ───────────────────────────────────
  out = out.replace(/परफेक्ट.*गुड.*वर्जन.*वन/gi, 'पूर्णता के लालच में अच्छे को मत मारें — संस्करण 1 जारी करें।');
  out = out.replace(/स्थिर\s*बीट्स\s*चमकीले/gi, 'स्थिरता दिखावे से बेहतर');
  out = out.replace(/बीट्स\s*चमक(दार|ीले)/gi, 'दिखावे से बेहतर');
  out = out.replace(/ग्राउंड\s*और\s*दीप्ति/gi, 'स्थिरता और दीप्ति');

  out = out.replace(/(जहाज़|जहाज|शिप)\s*संस्करण\s*1/gi, 'संस्करण 1 जारी करें');
  out = out.replace(/संपूर्णता/gi, 'पूर्णता');
  out = out.replace(/अच्छाई\s*को/gi, 'अच्छे को');

  out = out.replace(/इनबॉक्स\s*ट्रिम/gi, 'इनबॉक्स साफ़ करें');
  out = out.replace(/ट्रिम/gi, 'छाँटें');

  out = out.replace(/परफेक्ट/gi, 'पूर्णता');
  out = out.replace(/\bगुड\b/gi, 'अच्छा');
  out = out.replace(/शिप/gi, 'जारी करें');
  out = out.replace(/वर्जन\s*वन/gi, 'संस्करण 1');
  out = out.replace(/माइक्रो[- ]स्किल/gi, 'सूक्ष्म कौशल');
  out = out.replace(/ग्राउंड/gi, 'स्थिर');
  out = out.replace(/ग्लो/gi, 'दीप्ति');

  return out;
}

// ✅ MUST be top-level (used by composeDaily)
function cleanHiList(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map(x => cleanHi(x));
}

// ── Zodiac display helper ─────────────────────────────────────────────────────
const ZODIAC_HI = {
  aries: 'मेष', taurus: 'वृषभ', gemini: 'मिथुन', cancer: 'कर्क',
  leo: 'सिंह', virgo: 'कन्या', libra: 'तुला', scorpio: 'वृश्चिक',
  sagittarius: 'धनु', capricorn: 'मकर', aquarius: 'कुंभ', pisces: 'मीन'
};
function signDisplay(sign, lang = 'en') {
  const s = String(sign || '').toLowerCase();
  return lang === 'hi' ? (ZODIAC_HI[s] || capSign(s)) : capSign(s);
}

// Localized Vedic labels for UI (JSON helpers)
function getVedicNames(lang = 'en') {
  if (lang === 'hi') {
    return {
      rahuKaal: 'राहु काल',
      yamaganda: 'यमगण्ड',
      gulikaKaal: 'गुलिक काल',
      abhijitMuhurat: 'अभिजीत मुहूर्त',
    };
  }
  return {
    rahuKaal: 'Rahu Kaal',
    yamaganda: 'Yamaganda',
    gulikaKaal: 'Gulika Kaal',
    abhijitMuhurat: 'Abhijit Muhurat',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Small utils + TRANSLATION HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function maskKey(k) {
  if (!k) return '(none)';
  if (k.length < 10) return k;
  return `${k.slice(0, 8)}...${k.slice(-4)}`;
}
function pickLang(source = {}, headers = {}) {
  const direct = (source?.lang || '').toString().toLowerCase();
  if (direct) return direct.startsWith('hi') ? 'hi' : 'en';

  const x = (headers['x-lang'] || '').toString().toLowerCase();
  if (x) return x.startsWith('hi') ? 'hi' : 'en';

  const al = (headers['accept-language'] || '').toString().toLowerCase();
  if (al.startsWith('hi')) return 'hi';

  return 'en';
}
async function txOne(lang, s) {
  if (lang !== 'hi') return s;
  try {
    const out = await translateAgent?.(s, 'hi') ?? await translateAgent?.({ text: s, to: 'hi' });
    if (!out) return s;
    if (typeof out === 'string') return out;
    return out?.text || s;
  } catch { return s; }
}
async function tx(lang, v) {
  if (lang !== 'hi') return v;
  if (Array.isArray(v)) {
    const arr = [];
    for (const s of v) arr.push(await txOne(lang, String(s)));
    return arr;
  }
  return await txOne(lang, String(v));
}

// Try a local logo if client didn’t send one
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

// Blessing line
const BLESS = {
  en: 'Have a blessed day!! We wish you a very cheerful, prosperous and wonderful day ahead with lots of blessings.',
  hi: 'आपका दिन मंगलमय हो! हम आपको अत्यंत हर्ष, समृद्धि और मंगलकामनाओं से भरा, आशीर्वादपूर्ण दिन की शुभकामनाएँ देते हैं।'
};

// ─────────────────────────────────────────────────────────────────────────────
// Vedic windows (12-hour day approximation; 6:00–18:00 with sunrise 06:00)
// ─────────────────────────────────────────────────────────────────────────────
function approxVedicSlots12h(weekday /*0..6*/) {
  const rahu = {
    0: '16:30–18:00', 1: '07:30–09:00', 2: '15:00–16:30',
    3: '12:00–13:30', 4: '13:30–15:00', 5: '10:30–12:00', 6: '09:00–10:30',
  }[weekday];
  const yamaganda = {
    0: '12:00–13:30', 1: '10:30–12:00', 2: '09:00–10:30',
    3: '07:30–09:00', 4: '06:00–07:30', 5: '15:00–16:30', 6: '13:30–15:00',
  }[weekday];
  const gulika = {
    0: '15:00–16:30', 1: '13:30–15:00', 2: '12:00–13:30',
    3: '10:30–12:00', 4: '09:00–10:30', 5: '07:30–09:00', 6: '06:00–07:30',
  }[weekday];
  const abhijit = '12:05–12:52';
  return { rahuKaal: rahu, yamaganda, gulikaKaal: gulika, abhijitMuhurat: abhijit };
}
function vedicAssumptionNote(lang='en') {
  return lang === 'hi'
    ? 'टिप्पणी: वैदिक समय 06:00 सूर्योदय और 12 घंटे के दिन पर आधारित सरलीकृत अनुमान हैं — स्थान/ऋतु के अनुसार बदल सकते हैं।'
    : 'Note: Vedic windows use a 6:00 AM sunrise and 12-hour day approximation — actual times vary by location/season.';
}

// ─────────────────────────────────────────────────────────────────────────────
// PDF helpers
// ─────────────────────────────────────────────────────────────────────────────
function applyFont(doc, { lang = 'en', weight = 'regular' } = {}) {
  if (!FONTS_READY) return;
  if (lang === 'hi') doc.font(weight === 'bold' ? FONT.hi.bold : FONT.hi.regular);
  else doc.font(weight === 'bold' ? FONT.en.bold : FONT.en.regular);
}
function drawBullets(doc, items = [], { lang = 'en' } = {}) {
  const bullet = '•';
  doc.fontSize(12);
  (items || []).forEach(t => {
    doc.text(`${bullet} ${cleanText(t)}`, { paragraphGap: 2, align: 'left' });
  });
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
  const subSafe = String(subLine || '').replace(/^\s*[^0-9]+?\s*•\s*/, '').trim();
  doc.fontSize(10).fillColor('#444').text(subSafe, titleX, startY + 40);
  doc.fillColor('black').moveDown(1);

  doc.moveTo(doc.page.margins.left, doc.y)
     .lineTo(doc.page.width - doc.page.margins.right, doc.y)
     .strokeColor('#cccccc').stroke()
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
  doc.fontSize(12).text(L('Vedic Timings (IST)', 'वैदिक समय (भारतीय मानक समय)'));
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
  doc.fontSize(12);
}
function addSection(doc, { lang, heading, paragraphs = [] }) {
  applyFont(doc, { lang, weight: 'bold' });
  doc.fontSize(14).text(cleanText(heading));
  applyFont(doc, { lang });
  doc.moveDown(0.2);
  (paragraphs || []).forEach(p => doc.fontSize(12).text(cleanText(p), { paragraphGap: 6, align: 'justify' }));
  doc.moveDown(0.4);
}

// ── Yearly helpers (kept for future) ─────────────────────────────────────────
function labelFor(dt, lang='en') {
  const locale = lang === 'hi' ? 'hi-IN' : 'en-GB';
  return dt.toLocaleDateString(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' });
}
function startOfMonthUTC(d) {
  const x = new Date(d);
  return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), 1));
}
function addMonthsUTC(d, n) {
  const x = new Date(d);
  return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + n, 1));
}
function addPhaseBlocks(doc, { lang, phaseBlocks }) {
  const pairs = [
    ['Good','अच्छा'], ['Caution','सावधानियाँ'], ['Fun','मज़ा'], ['Gains','लाभ'],
    ['Health','स्वास्थ्य'], ['Relationships','संबंध'], ['Opportunities','अवसर'], ['Remedies','उपाय']
  ];
  pairs.forEach(([en, hi]) => {
    const items = phaseBlocks?.[en.toLowerCase()] || [];
    applyFont(doc, { lang, weight: 'bold' }); doc.fontSize(14).text(lang==='hi'?hi:en); applyFont(doc, { lang });
    drawBullets(doc, items, { lang });
    doc.moveDown(0.3);
  });
}
function addMonthPage(doc, { lang, m, dt }) {
  doc.addPage();
  const title = `${labelFor(dt, lang)} — ${m?.label?.split('—').pop()?.trim() || (lang==='hi'?'केंद्रित रहें • प्रवाह':'Focus & Flow')}`;
  applyFont(doc, { lang, weight: 'bold' }); doc.fontSize(16).text(title, { underline: true }); applyFont(doc, { lang });
  doc.moveDown(0.6);
  const healthConcerns = (m?.health?.concerns || '').trim();
  const healthTips = (m?.health?.tips || '').trim();
  const healthText = (healthConcerns || healthTips)
    ? `${healthConcerns}${healthConcerns && healthTips ? ' — ' : ''}${lang==='hi'?'सुझाव':'Tips'}: ${healthTips}`
    : '';
  const kv = [
    [lang==='hi'?'परिदृश्य':'Outlook', m.outlook],
    [lang==='hi'?'करियर/प्रयास':'Career/Effort', m.career],
    [lang==='hi'?'धन':'Money', m.money],
    [lang==='hi'?'संबंध/परिवार':'Relationships/Family', m.relationships],
    [lang==='hi'?'स्वास्थ्य':'Health', healthText],
    [lang==='hi'?'सीख':'Learning', m.learning],
    [lang==='hi'?'यात्रा':'Travel', m.travel],
    [lang==='hi'?'अवसर':'Opportunity', m.opportunity],
    [lang==='hi'?'रक्षा':'Protection', m?.protection?.text || ''],
    [lang==='hi'?'चेकपॉइंट':'Checkpoint', m.checkpoint],
  ];
  kv.forEach(([k,v]) => { if (v) { applyFont(doc, { lang, weight:'bold' }); doc.fontSize(12).text(`${k}:`); applyFont(doc, { lang }); doc.text(cleanText(v)).moveDown(0.25); } });
}

// Fallback if agents are missing: read from contentBank.yearly
function fallbackYearly({ sign, persona, anchorDate }) {
  const s = String(sign || '').toLowerCase();
  const pb = contentBank?.yearly?.[s] || null;
  const bucket = (persona && pb?.[persona]) || pb?.default || null;
  if (!bucket) throw new Error(`No yearly content for sign=${s}`);
  const monthsRaw = Array.isArray(bucket.months) ? bucket.months : [];
  const phaseBlocks = bucket.phaseBlocks || { good:[], caution:[], fun:[], gains:[], health:[], relationships:[], opportunities:[], remedies:[] };

  const anchor = startOfMonthUTC(anchorDate ? new Date(anchorDate) : new Date());
  const months = Array.from({ length: 13 }, (_, i) => monthsRaw[i % monthsRaw.length] || {});
  return { phaseBlocks, months, anchor };
}

// ─────────────────────────────────────────────────────────────────────────────
// Composer — DAILY  (ASYNC + localized)
// ─────────────────────────────────────────────────────────────────────────────
async function composeDaily({ sign='aries', lang='en', now=new Date(), user=null } = {}) {
  const s = (sign || '').toLowerCase();
  const signLabel = signDisplay(s, lang);
  const { ist, dateStr, timeStr, weekdayIndex } = toISTParts(now);
  const timeShort = ist.toLocaleTimeString(lang === 'hi' ? 'hi-IN' : 'en-GB', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata'
  }) + (lang === 'hi' ? ' बजे' : ' IST');
  const monthSalt = dateStr.slice(0,7);
  const seed = hashCode(`${monthSalt}|${s}|${dateStr}`);

  const deity   = dayDeityAgent(weekdayIndex, lang);
  const format  = formatAgent({ lang, dateIST: ist, deityPair: deity.pair });
  const panchang= panchangAgent();
  const variety = varietyAgent({ sign: s, seed, weekdayIndex });
  const fortune = fortuneLineAgent({ sign: s, ist, seed, lang });
  const qm      = quoteMoodAgent(seed);
  const policy  = policyAgent(lang);
  const special = specialDayAgent({ now, lang, user });

  let themeLead  = await tx(lang, variety.themeLead);
  let opp        = await tx(lang, variety.opportunities);
  let caut       = await tx(lang, variety.cautions);
  let remedy     = await tx(lang, variety.remedy);
  let quote       = await tx(lang, qm.quote);
  let affirmation = await tx(lang, qm.affirmation);
  let mood        = await tx(lang, qm.mood);
  let luckyLine   = await tx(lang, fortune.luckyLine);

  if (lang === 'hi') {
    themeLead   = cleanHi(themeLead);
    opp         = cleanHiList(opp);
    caut        = cleanHiList(caut);
    remedy      = cleanHi(remedy);
    quote       = cleanHi(quote);
    affirmation = cleanHi(affirmation);
    mood        = cleanHi(mood);
    luckyLine   = cleanHi(luckyLine);
  }
  const labels = lang==='hi'
    ? { opp:'अवसर', caut:'सावधानियाँ', rem:'उपाय' }
    : { opp:'Opportunities', caut:'Cautions', rem:'Remedy' };
  const vedicNames = getVedicNames(lang);
  const vedicList = [
    { key: 'rahuKaal',       label: vedicNames.rahuKaal,       value: panchang.rahuKaal },
    { key: 'yamaganda',      label: vedicNames.yamaganda,      value: panchang.yamaganda },
    { key: 'gulikaKaal',     label: vedicNames.gulikaKaal,     value: panchang.gulikaKaal },
    { key: 'abhijitMuhurat', label: vedicNames.abhijitMuhurat, value: panchang.abhijitMuhurat },
  ];

  return {
    date: dateStr,
    timeIST: timeShort,
    lang,
    sign: s,
    signLabel,
    vedicNames,
    vedicList,
    header: { dayHeader: format.dayHeader },
    greeting: greeting(lang),
    deityLine: format.deitySentenceParts,
    quote,
    affirmation,
    mood,
    waterGlasses: qm.waterGlasses,
    themeLead,
    luckyLine,
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

    text:
      `**${signLabel} • ${dateStr}**\n` +
      `${themeLead}\n${luckyLine}\n\n` +
      `${labels.opp}:\n- ${opp.join('\n- ')}\n\n` +
      `${labels.caut}:\n- ${caut.join('\n- ')}\n\n` +
      `${labels.rem}:\n${remedy}`
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Debug routes
// ─────────────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.json({ ok: true, service: 'Astro-Baba Chat API' }));
app.get('/debug/fonts', (req, res) => res.json(checkFonts()));
app.get('/debug/version', (req, res) => res.json({
  time: new Date().toISOString(),
  build: BUILD,
  node: process.version,
  env: process.env.NODE_ENV || 'production',
  commit: process.env.RENDER_GIT_COMMIT || null,
  cwd: process.cwd(),
  fontsReady: FONTS_READY,
}));

app.get('/debug/routes', (req, res) => {
  const routes = [];
  (app._router?.stack || []).forEach((m) => {
    if (m.route) {
      routes.push({ methods: Object.keys(m.route.methods).map(x=>x.toUpperCase()), path: m.route.path });
    } else if (m.name === 'router' && m.handle?.stack) {
      m.handle.stack.forEach((h) => {
        if (h.route) routes.push({ methods: Object.keys(h.route.methods).map(x=>x.toUpperCase()), path: h.route.path });
      });
    }
  });
  res.json({ ok: true, count: routes.length, routes });
});

// Simple 7-day JSON dry run (no cache, no PDF)
app.get('/debug/weekly-dryrun', async (req, res) => {
  try {
    const sign = String(req.query.sign || 'aries').toLowerCase();
    const lang = pickLang({ lang: req.query.lang }, req.headers);

    const start = new Date();
    const items = [];
    const roll  = new Date(start);

    for (let i = 0; i < 7; i++) {
      const ts = new Date(roll);
      const { dateStr } = toISTParts(ts);
      const d = await composeDaily({ sign, lang, now: ts, user: null });
      items.push({ date: dateStr, header: d?.header?.dayHeader, themeLead: d?.themeLead, ok: true });
      roll.setDate(roll.getDate() + 1);
    }

    res.json({ ok: true, sign, lang, days: items.length, items });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

app.get('/debug/routes', (req, res) => {
  const routes = [];
  const push = (r) => routes.push({ method: Object.keys(r.methods)[0]?.toUpperCase() || 'GET', path: r.path });
  app._router?.stack?.forEach((m) => {
    if (m.route) push(m.route);
    else if (m.name === 'router' && m.handle?.stack) {
      m.handle.stack.forEach((h) => h.route && push(h.route));
    }
  });
  res.json({ ok: true, build: BUILD, routes });
});

app.get('/debug/weekly-dryrun', async (req, res) => {
  try {
    const sign = String(req.query.sign || 'aries').toLowerCase();
    const lang = pickLang({ lang: req.query.lang }, req.headers);
    const start = new Date();
    const out = [];
    const roll = new Date(start);
    for (let i = 0; i < 7; i++) {
      const ts = new Date(roll);
      const { dateStr } = toISTParts(ts);
      const d = await composeDaily({ sign, lang, now: ts, user: null });
      out.push({ date: dateStr, header: d?.header?.dayHeader, themeLead: d?.themeLead, ok: true });
      roll.setDate(roll.getDate() + 1);
    }
    res.json({ ok: true, sign, lang, days: out.length, items: out });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DAILY JSON
// ─────────────────────────────────────────────────────────────────────────────
app.get('/daily', async (req, res) => {
  const sign = (req.query.sign || 'aries').toString().toLowerCase();
  const lang = pickLang({ lang: req.query.lang }, req.headers);
  const data = await composeDaily({ sign, lang });
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
app.post('/daily', async (req, res) => {
  const { sign='aries', lang='en', user=null } = req.body || {};
  const data = await composeDaily({ sign, lang: pickLang({ lang }, req.headers), user });
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
    const lang  = pickLang({ lang: rawLang }, req.headers);
    const daily = await composeDaily({ sign, lang, user });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="AstroBaba_Daily_${sign}_${daily.date}_${lang}.pdf"`);

    const doc = new PDFDocument({ margin: 36, bufferPages: true });
    doc.pipe(res);

    applyFont(doc, { lang, weight: 'regular' });

    const titleLine = lang==='hi' ? 'दैनिक राशिफल' : 'Daily Horoscope';
    const subLine   = `${daily.date} ${daily.timeIST}`;
    const brandFixed = ensureBrandWithLogo({ ...brand, appName: brand?.appName || 'Astro-Baba' });
    addBrandHeader(doc, { lang, brand: brandFixed, titleLine, subLine });

    addUserBlock(doc, { lang, user: {
      name:  user?.name, phone: user?.phone, email: user?.email, gender:user?.gender,
      dob:   user?.dob,  tob:   user?.time || user?.tob,       place: user?.place,
    }});

    addVedicTimings(doc, { lang, timings: daily.vedic });

    applyFont(doc, { lang, weight: 'bold' });
    doc.fontSize(14).text(daily.header.dayHeader, { align: 'center' });
    applyFont(doc, { lang });
    doc.moveDown(0.5);

    applyFont(doc, { lang, weight: 'bold' }); doc.fontSize(12).text(daily.greeting); applyFont(doc, { lang });

    doc.moveDown(0.2);
    doc.fontSize(12);
    doc.text(daily.deityLine.pre, { continued: true });
    applyFont(doc, { lang, weight: 'bold' });
    doc.text(daily.deityLine.bold, { continued: true });
    applyFont(doc, { lang });
    doc.text(daily.deityLine.post);

    if (daily.special) {
      doc.moveDown(0.6);
      applyFont(doc, { lang, weight: 'bold' });
      doc.fontSize(13).text(daily.special.title);
      applyFont(doc, { lang });
      if (daily.special.birthday) doc.text(daily.special.birthday);
      if (daily.special.observance) doc.text(`${daily.special.observance.title} — ${daily.special.observance.line}`);
    }

    doc.moveDown(0.6);
    doc.fontSize(11).text(daily.quote);
    doc.moveDown(0.2);
    doc.fontSize(11).text(lang==='hi' ? 'स्व-वचन: ' : 'Affirmation: ', { continued: true });
    applyFont(doc, { lang, weight: 'bold' }); doc.text(daily.affirmation); applyFont(doc, { lang });
    doc.moveDown(0.2);
    doc.fontSize(11).text(lang==='hi' ? `आज का मूड: ${daily.mood}` : `Mood: ${daily.mood}`);
    doc.fontSize(11).text(lang==='hi' ? `जल सेवन: कम से कम ${daily.waterGlasses} गिलास` : `Water: at least ${daily.waterGlasses} glasses`);

    doc.moveDown(0.6);
    doc.fontSize(12).text(daily.themeLead, { paragraphGap: 6 });
    doc.fontSize(12).text(daily.luckyLine);

    doc.moveDown(0.8);
    applyFont(doc, { lang, weight: 'bold' }); doc.fontSize(14).text(lang==='hi'?'अवसर':'Opportunities'); applyFont(doc, { lang });
    drawBullets(doc, daily.sections.opportunities, { lang });

    doc.moveDown(0.4);
    applyFont(doc, { lang, weight: 'bold' }); doc.fontSize(14).text(lang==='hi'?'सावधानियाँ':'Cautions'); applyFont(doc, { lang });
    drawBullets(doc, daily.sections.cautions, { lang });

    doc.moveDown(0.4);
    applyFont(doc, { lang, weight: 'bold' }); doc.fontSize(14).text(lang==='hi'?'उपाय':'Remedy'); applyFont(doc, { lang });
    doc.fontSize(12).text(daily.sections.remedy);

    doc.moveDown(0.8);
    applyFont(doc, { lang, weight: 'bold' });
    doc.fontSize(14).text(lang==='hi' ? 'वैदिक अवधियाँ' : 'About the Vedic Periods');
    applyFont(doc, { lang });
    drawBullets(doc, daily.sections.vedicExplain, { lang });
    addVedicNote(doc, { lang });

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

    doc.moveDown(0.8);
    const year = new Date().getFullYear();
    doc.fontSize(9).fillColor('#555').text(`© ${year} ${daily.brandFooter}`, { align: 'center' });
    doc.fillColor('black');

    doc.end();
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: e.message || String(e) });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GEMSTONE → PDF
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
  const plan = {
    mars:   { primary:'Red Coral (Moonga)', alt:'Carnelian', tone:'discipline, courage, decisive action' },
    venus:  { primary:'Diamond / White Sapphire (caution: chart-specific)', alt:'Opal / Zircon', tone:'harmony, relationships, aesthetics' },
    mercury:{ primary:'Emerald (Panna)', alt:'Peridot', tone:'clarity, learning, communication' },
    moon:   { primary:'Pearl (Moti)', alt:'Moonstone', tone:'emotional balance, calm, nourishment' },
    sun:    { primary:'Ruby (Manik)', alt:'Garnet', tone:'confidence, leadership, vitality' },
    jupiter:{ primary:'Yellow Sapphire (Pukhraj)', alt:'Citrine', tone:'wisdom, growth, blessings' },
    saturn: { primary:'Blue Sapphire (Neelam — test first)', alt:'Amethyst', tone:'steadiness, structure, patience' },
  }[r];
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
    ? 'ज्योतिष परंपरा के अनुसार, रत्न सूक्ष्म लेंस की तरह सहायक ग्रह धाराओं की ओर ध्यान ट्यून करते हैं। आकार में छोटे पर प्रभाव में समर्थ—मानो बड़े ताले की छोटी चाबी...'
    : 'As per Jyotish tradition, gemstones act like tiny lenses that tune you toward supportive planetary currents—small yet potent, like a small key for a big lock...';
}
function powerMantraText(lang) {
  return lang === 'hi'
    ? 'मंत्र छोटी चाबी की तरह बड़े ताले के लिए हो सकता है—सही ध्वनि, सही विधि और नियमितता से मन, एकाग्रता और अनुग्रह संवरते हैं...'
    : 'A mantra can be a small key for a big lock—the right sound, done correctly and regularly, reshapes mood, focus, and grace...';
}

app.post('/report/gemstone', async (req, res) => {
  try {
    const { sign='aries', user={}, brand={}, lang: rawLang } = req.body || {};
    const lang = pickLang({ lang: rawLang }, req.headers);
    const { dateStr, timeStr } = toISTParts(new Date());
    const plan = gemPlanForSign(sign);
    const planet = rulerForSign(sign);

    const toneHI = await tx(lang, plan.tone);
    const noteHI = plan?.note ? await tx(lang, plan.note) : null;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="AstroBaba_Gemstone_${sign}_${dateStr}_${lang}.pdf"`);

    const doc = new PDFDocument({ margin: 36, bufferPages: true });
    doc.pipe(res);

    applyFont(doc, { lang });

    const titleLine = lang==='hi'
      ? `रत्न मार्गदर्शन — ${signDisplay(sign, 'hi')}`
      : `Gemstone Guidance — ${capSign(sign)}`;    
    const subLine   = `${dateStr} ${timeStr}`;
    const brandFixed = ensureBrandWithLogo({ ...brand, appName: brand?.appName || 'Astro-Baba' });
    addBrandHeader(doc, { lang, brand: brandFixed, titleLine, subLine });

    addUserBlock(doc, { lang, user: {
      name:user?.name, phone:user?.phone, email:user?.email, gender:user?.gender,
      dob:user?.dob, tob:user?.time || user?.tob, place:user?.place,
    }});

    applyFont(doc, { lang, weight: 'bold' }); doc.fontSize(12).text(greeting(lang)); applyFont(doc, { lang }); doc.moveDown(0.6);

    const snapHead = lang==='hi' ? 'ग्रह संकेत (संक्षेप)' : 'Planetary Snapshot (brief)';
    const snapPara = lang==='hi'
      ? `आपके सूर्य राशि हेतु प्राथमिक ग्रह संकेत: ${capSign(sign)} के लिए ${planet.toUpperCase()} — ${toneHI}.`
      : `Primary support for your sun sign: ${capSign(sign)} leans on ${planet.toUpperCase()} — ${plan.tone}.`;
    addSection(doc, { lang, heading: snapHead, paragraphs: [snapPara] });

    const recHead = lang==='hi' ? 'मुख्य सुझाव' : 'Recommendation';
    const lines = lang==='hi'
      ? [
          `प्रमुख रत्न: ${plan.primary}`,
          `वैकल्पिक (उप्रत्न): ${plan.alt}`,
          `उद्देश्य: ${toneHI}`,
          noteHI ? `नोट: ${noteHI}` : null
        ].filter(Boolean)
      : [
          `Primary gemstone: ${plan.primary}`,
          `Alternate (upratna): ${plan.alt}`,
          `Planet focus: ${plan.tone}`,
          plan?.note ? `Note: ${plan.note}` : null
        ].filter(Boolean);
    addSection(doc, { lang, heading: recHead, paragraphs: lines });

    const howHead = lang==='hi' ? 'कैसे पहनें' : 'How to Wear';
    const howParas = lang==='hi'
      ? ['आरंभ: मंगलवार/शनिवार, अभिजीत मुहूर्त में।','परीक्षण: 45–60 दिन।','धातु: सिल्वर/पंचधातु।','उंगली: दाएँ हाथ की अनामिका।','शुद्धि: जल + कच्चा दूध।','ऊर्जन: “ॐ क्राम क्रीम क्रौं सह भौमाय नमः” 108×।']
      : ['Start: Tue/Sat, Abhijit Muhurat.','Trial: 45–60 days.','Metal: Silver/Panchdhatu.','Finger: Right ring finger.','Cleansing: Water + raw milk.','Energizing: “Om Kraam… Bhaumaya Namah” 108×.'];
    addSection(doc, { lang, heading: howHead, paragraphs: howParas });

    const ddHead = lang==='hi' ? 'क्या करें / क्या न करें' : 'Do / Don’t';
    const ddLines = lang==='hi'
      ? ['करें: टूटा/दरार पत्थर हटाएँ।','न करें: असंगत/सिंथेटिक साथ न पहनें।','रखरखाव: हल्की सफ़ाई, मासिक ऊर्जन।']
      : ['Do: Remove cracked stones.','Don’t: Mix incompatible/synthetic stones.','Care: Gentle cleaning; monthly energizing.'];
    addSection(doc, { lang, heading: ddHead, paragraphs: ddLines });

    const sankHead = lang==='hi' ? 'संकल्प (एक वाक्य)' : 'Sankalpa (intention)';
    const sankLine = lang==='hi'
      ? '“श्रद्धा और अनुशासन के साथ, यह रत्न मेरी ऊर्जा को स्थिर करे और सही अवसर खोले।”'
      : '“With faith and discipline, may this stone steady my energy and open right opportunities.”';
    addSection(doc, { lang, heading: sankHead, paragraphs: [sankLine] });

    addSection(doc, { lang, heading: lang==='hi'?'रत्न की शक्ति':'Power of Gemstones', paragraphs: [powerGemText(lang)] });

    const pol = policyAgent(lang);
    doc.moveDown(0.8);
    applyFont(doc, { lang, weight: 'bold' }); doc.fontSize(12).text(lang==='hi' ? 'अंतिम नोट' : 'Final Note'); applyFont(doc, { lang });
    doc.moveDown(0.2); doc.fontSize(11).text(pol.disclaimer);
    doc.moveDown(0.6); doc.fontSize(12).text(pol.thanks);
    doc.moveDown(0.2); applyFont(doc, { lang, weight: 'bold' }); doc.fontSize(12).text(lang==='hi' ? BLESS.hi : BLESS.en); applyFont(doc, { lang });
    const year = new Date().getFullYear();
    doc.moveDown(0.8); doc.fontSize(9).fillColor('#555').text(`© ${year} ${pol.footerBrand}`, { align:'center' }); doc.fillColor('black');

    doc.end();
  } catch (e) { if (!res.headersSent) res.status(500).json({ error: e.message || String(e) }); }
});

// GENERIC PACKAGE → PDF
app.post('/report/generate', async (req, res) => {
  try {
    const { package: pkg = 'gemstone', user = {}, brand = {}, lang: rawLang } = req.body || {};
    const lang = pickLang({ lang: rawLang }, req.headers);
    const now  = new Date();
    const { dateStr, timeStr } = toISTParts(now);

    const titleLine = lang === 'hi' ? (pkg === 'mantra' ? 'मंत्र रिपोर्ट' : 'रत्न रिपोर्ट') : (pkg === 'mantra' ? 'Mantra Report' : 'Gemstone Report');
    const intro = lang === 'hi'
      ? ['यह संक्षिप्त, व्यावहारिक मार्गदर्शिका है — सरल कदमों में पालन करें।','पहले 45–60 दिनों तक नियमितता बनाए रखें और अनुभव दर्ज करें।']
      : ['This is a concise, practical guide — follow in simple steps.','Maintain regularity for 45–60 days and track observations.'];
    const opp = lang === 'hi'
      ? ['आज एक छोटा लेकिन स्पष्ट कदम उठाएँ।','सही समय/उंगली/धातु पर ध्यान दें।','साप्ताहिक नोट्स बनाएं — ऊर्जा/मूड/नींद।']
      : ['Take one small, clear step today.','Mind the correct time/finger/metal.','Keep weekly notes: energy/mood/sleep.'];
    const caut = lang === 'hi'
      ? ['अत्यधिक अपेक्षाओं से बचें — क्रमिक प्रगति सर्वोत्तम है।','कृत्रिम/हीट-ट्रीटेड से बचें।','एलर्जी/चोट की स्थिति में विराम लें।']
      : ['Avoid over-expectation — steady progress is best.','Avoid synthetic/heat-treated pieces.','Pause in case of allergy/injury.'];
    const remedy = lang === 'hi' ? 'शाम को दीपक जलाएँ, 11 बार जप करें और 2 मिनट शांति रखें।' : 'In the evening, light a diya, chant 11×, and sit calmly for 2 minutes.';

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="AstroBaba_${pkg}_${dateStr}_${lang}.pdf"`);

    const doc = new PDFDocument({ margin: 36, bufferPages: true });
    doc.pipe(res);

    applyFont(doc, { lang });

    const subLine = `${dateStr} ${timeStr}`;
    const brandFixed = ensureBrandWithLogo({ ...brand, appName: brand?.appName || 'Astro-Baba' });
    addBrandHeader(doc, { lang, brand: brandFixed, titleLine, subLine });

    addUserBlock(doc, { lang, user: { name:user?.name, phone:user?.phone, email:user?.email, gender:user?.gender, dob:user?.dob, tob:user?.time || user?.tob, place:user?.place } });

    applyFont(doc, { lang, weight: 'bold' }); doc.fontSize(12).text(greeting(lang)); applyFont(doc, { lang }); doc.moveDown(0.6);

    addSection(doc, { lang, heading: lang === 'hi' ? 'परिचय' : 'Introduction', paragraphs: intro });

    applyFont(doc, { lang, weight: 'bold' }); doc.fontSize(14).text(lang === 'hi' ? 'अवसर' : 'Opportunities'); applyFont(doc, { lang });
    drawBullets(doc, opp, { lang }); doc.moveDown(0.4);

    applyFont(doc, { lang, weight: 'bold' }); doc.fontSize(14).text(lang === 'hi' ? 'सावधानियाँ' : 'Cautions'); applyFont(doc, { lang });
    drawBullets(doc, caut, { lang }); doc.moveDown(0.4);

    addSection(doc, { lang, heading: lang === 'hi' ? 'अभ्यास/उपाय' : 'Practice / Remedy', paragraphs: [remedy] });

    doc.moveDown(0.8);
    applyFont(doc, { lang, weight: 'bold' });
    doc.fontSize(12).text(lang === 'hi' ? BLESS.hi : BLESS.en);
    applyFont(doc, { lang });

    const pol = policyAgent(lang);
    doc.moveDown(0.6);
    const year = new Date().getFullYear();
    doc.fontSize(9).fillColor('#555').text(`© ${year} ${pol.footerBrand}`, { align: 'center' });
    doc.fillColor('black');

    doc.end();
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: e.message || String(e) });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// MANTRA → PDF
// ─────────────────────────────────────────────────────────────────────────────
app.post('/report/mantra', async (req, res) => {
  try {
    const { sign='aries', user={}, brand={}, lang: rawLang } = req.body || {};
    const lang    = pickLang({ lang: rawLang }, req.headers);
    const { dateStr, timeStr } = toISTParts(new Date());
    const planet  = rulerForSign(sign);
    const seedMan = mantraForPlanet(planet);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="AstroBaba_Mantra_${sign}_${dateStr}_${lang}.pdf"`);

    const doc = new PDFDocument({ margin: 36, bufferPages: true });
    doc.pipe(res);

    applyFont(doc, { lang });

    const titleLine = lang==='hi'
         ? `मंत्र मार्गदर्शन — ${signDisplay(sign, 'hi')}`
         : `Mantra Guidance — ${capSign(sign)}`;
    const subLine   = `${dateStr} ${timeStr}`;
    const brandFixed = ensureBrandWithLogo({ ...brand, appName: brand?.appName || 'Astro-Baba' });
    addBrandHeader(doc, { lang, brand: brandFixed, titleLine, subLine });

    addUserBlock(doc, { lang, user: {
      name:user?.name, phone:user?.phone, email:user?.email, gender:user?.gender,
      dob:user?.dob, tob:user?.time || user?.tob, place:user?.place,
    }});

    applyFont(doc, { lang, weight: 'bold' }); doc.fontSize(12).text(greeting(lang)); applyFont(doc, { lang }); doc.moveDown(0.6);

    const toneHead = lang==='hi' ? 'ग्रह प्रवृत्ति (टोन)' : 'Planetary Tone';
    const toneText = await tx(lang, 'supportive vibration for balance and progress.');
    const toneLine = lang==='hi'
      ? `${planet.toUpperCase()} — ${toneText}`
      : `${planet.toUpperCase()} — supportive vibration for balance and progress.`;
    addSection(doc, { lang, heading: toneHead, paragraphs: [toneLine] });

    const manHead  = lang==='hi' ? 'मुख्य मंत्र' : 'Primary Mantra';
    const manLine  = seedMan.seed;
    const schedHead= lang==='hi' ? 'अनुष्ठान / नियम' : 'Practice';
    const sched = lang==='hi'
      ? ['समय: सूर्योदय/सूर्यास्त','गणना: 108×','आसन: रीढ़ सीधी','पूर्व/पश्चात: दीपक/अगरबत्ती','नियम: हफ्ते में 4 दिन+']
      : ['Timing: Sunrise/Sunset','Count: 108×','Posture: Spine tall','Before/After: diya/incense','Cadence: 4+ days/week'];
    addSection(doc, { lang, heading: manHead, paragraphs: [manLine] });
    addSection(doc, { lang, heading: schedHead, paragraphs: sched });

    const sankHead = lang==='hi' ? 'संकल्प (एक वाक्य)' : 'Sankalpa (intention)';
    const sankLine = lang==='hi'
      ? '“मैं शुद्ध भाव और अनुशासन के साथ जप करता/करती हूँ; मार्ग प्रशस्त हो।”'
      : '“I chant with pure intention and discipline; may right paths open.”';
    addSection(doc, { lang, heading: sankHead, paragraphs: [sankLine] });

    addSection(doc, { lang, heading: lang==='hi'?'मंत्र की शक्ति':'Power of the Mantra', paragraphs: [powerMantraText(lang)] });

    const pol = policyAgent(lang);
    doc.moveDown(0.8);
    applyFont(doc, { lang, weight: 'bold' }); doc.fontSize(12).text(lang==='hi' ? 'अंतिम नोट' : 'Final Note'); applyFont(doc, { lang });
    doc.moveDown(0.2); doc.fontSize(11).text(pol.disclaimer);
    doc.moveDown(0.6); doc.fontSize(12).text(pol.thanks);
    doc.moveDown(0.2); applyFont(doc, { lang, weight: 'bold' }); doc.fontSize(12).text(lang==='hi' ? BLESS.hi : BLESS.en); applyFont(doc, { lang });
    const year = new Date().getFullYear();
    doc.moveDown(0.8); doc.fontSize(9).fillColor('#555').text(`© ${year} ${pol.footerBrand}`, { align:'center' }); doc.fillColor('black');

    doc.end();
  } catch (e) { if (!res.headersSent) res.status(500).json({ error: e.message || String(e) }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// WEEKLY → PDF (simple, cache-free, Hindi-safe)
// ─────────────────────────────────────────────────────────────────────────────
app.post('/report/weekly', async (req, res) => {
  let doc = null;
  try {
    const { sign = 'aries', user = {}, brand = {}, lang: rawLang } = req.body || {};
    const lang = pickLang({ lang: rawLang }, req.headers);

    // If Devanagari fonts are missing, fall back to EN to avoid PDF crashes.
    const effLang = (lang === 'hi' && !FONTS_READY) ? 'en' : lang;
    if (lang !== effLang) res.setHeader('X-AB-Lang-Fallback', `${lang}->${effLang}`);

    const start = new Date();
    const { ist, dateStr } = toISTParts(start);
    const subLineTime =
      ist.toLocaleTimeString(effLang === 'hi' ? 'hi-IN' : 'en-GB', {
        hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata',
      }) + (effLang === 'hi' ? ' बजे' : ' IST');

    const filename = `AstroBaba_Weekly_${sign}_${dateStr}_${effLang}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const PDFDocument = (await import('pdfkit')).default; // in case your env lazy-loads
    doc = new PDFDocument({ margin: 36, bufferPages: true });
    doc.pipe(res);

    // Header
    applyFont(doc, { lang: effLang });
    const titleLine = effLang === 'hi' ? 'साप्ताहिक राशिफल' : 'Weekly Horoscope';
    const subLine   = `${dateStr} ${subLineTime}`;
    const brandFixed = ensureBrandWithLogo({ ...brand, appName: brand?.appName || 'Astro-Baba' });
    addBrandHeader(doc, { lang: effLang, brand: brandFixed, titleLine, subLine });

    // User block
    addUserBlock(doc, {
      lang: effLang,
      user: {
        name:  user?.name,
        phone: user?.phone,
        email: user?.email,
        gender:user?.gender,
        dob:   user?.dob,
        tob:   user?.time || user?.tob,
        place: user?.place,
      },
    });

    applyFont(doc, { lang: effLang, weight: 'bold' });
    doc.fontSize(12).text(greeting(effLang));
    applyFont(doc, { lang: effLang });
    doc.moveDown(0.6);

    // 7 days, no cache calls
    const roll = new Date(start);
    for (let i = 0; i < 7; i++) {
      const ts = new Date(roll);
      const { dateStr: stamp } = toISTParts(ts);
      let d;
      try {
        d = await composeDaily({ sign, lang: effLang, now: ts, user });
      } catch {
        d = { header: { dayHeader: `${stamp} — ${signDisplay(sign, effLang)}` }, sections: {} };
      }

      addSection(doc, {
        lang: effLang,
        heading: d?.header?.dayHeader || `${stamp} — ${signDisplay(sign, effLang)}`,
        paragraphs: [],
      });
      addVedicTimings(doc, { lang: effLang, timings: approxVedicSlots12h(ts.getDay()) });

      const paras = [
        d?.themeLead || '',
        d?.luckyLine || '',
        '',
        ...(Array.isArray(d?.sections?.opportunities) ? d.sections.opportunities.map(o => `• ${o}`) : []),
        '',
        ...(Array.isArray(d?.sections?.cautions) ? d.sections.cautions.map(c => `• ${c}`) : []),
        '',
        (effLang === 'hi' ? 'उपाय: ' : 'Remedy: ') + (d?.sections?.remedy || '-'),
      ];
      for (const p of paras) doc.fontSize(12).text(String(p), { paragraphGap: 6, align: 'justify' });
      doc.moveDown(0.4);

      roll.setDate(roll.getDate() + 1);
    }

    addVedicNote(doc, { lang: effLang });

    const pol = policyAgent(effLang);
    doc.moveDown(0.8);
    applyFont(doc, { lang: effLang, weight: 'bold' });
    doc.fontSize(12).text(effLang === 'hi' ? 'अंतिम नोट' : 'Final Note');
    applyFont(doc, { lang: effLang });
    doc.moveDown(0.2);
    doc.fontSize(11).text(pol?.disclaimer || '');
    doc.moveDown(0.6);
    doc.fontSize(12).text(pol?.thanks || '');
    doc.moveDown(0.2);
    applyFont(doc, { lang: effLang, weight: 'bold' });
    doc.fontSize(12).text(effLang === 'hi' ? BLESS.hi : BLESS.en);

    const year = new Date().getFullYear();
    doc.moveDown(0.8);
    doc.fontSize(9).fillColor('#555').text(`© ${year} ${pol?.footerBrand || 'Astro-Baba.com'}`, { align: 'center' });
    doc.fillColor('black');

    doc.end();
  } catch (e) {
    console.error('WEEKLY_ROUTE_ERROR:', e?.stack || e);
    try { doc && doc.end(); } catch {}
    if (!res.headersSent) res.status(500).json({ error: e?.message || String(e) });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DAILY CACHE BOT: prewarm & fetch  (memory + disk persistence)
// ─────────────────────────────────────────────────────────────────────────────
const dailyCache = globalThis.__AB_DAILY_CACHE__ || new Map();
globalThis.__AB_DAILY_CACHE__ = dailyCache;

const ALL_SIGNS = [
  'aries','taurus','gemini','cancer','leo','virgo',
  'libra','scorpio','sagittarius','capricorn','aquarius','pisces'
];

function cacheKey(dateStr, sign, lang) {
  return `${dateStr}|${sign}|${lang}`;
}

async function prewarmAndSave(days, langs) {
  const details = [];
  const start = new Date();

  for (let offset = 0; offset < days; offset++) {
    const dt = new Date(start);
    dt.setDate(dt.getDate() + offset);
    const { dateStr } = toISTParts(dt);

    for (const sign of ALL_SIGNS) {
      for (const lang of langs) {
        const d = await composeDaily({ sign, lang, now: dt });
        dailyCache.set(cacheKey(dateStr, sign, lang), d);

        try {
          const dir  = path.join(__dirname, 'data', 'cache', 'daily', dateStr);
          fs.mkdirSync(dir, { recursive: true });
          const file = path.join(dir, `${sign}.${lang}.json`);
          fs.writeFileSync(
            file,
            JSON.stringify({ date: dateStr, sign, lang, rich: d }, null, 2)
          );
          details.push({ date: dateStr, sign, lang, file: file.replace(__dirname + path.sep, '') });
        } catch {}
      }
    }
  }

  return {
    ok: true,
    days,
    langs,
    inserted: details.length,
    cacheSize: dailyCache.size,
    details,
    note: 'saved under data/cache/daily/YYYY-MM-DD/<sign>.<lang>.json'
  };
}

// GET: /cron/prewarm-daily?days=8&langs=en,hi
app.get('/cron/prewarm-daily', async (req, res) => {
  try {
    const days  = Math.max(1, parseInt(req.query.days || '8', 10));
    const langs = String(req.query.langs || 'en,hi')
      .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    const result = await prewarmAndSave(days, langs);
    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// POST: /cron/prewarm-daily
app.post('/cron/prewarm-daily', async (req, res) => {
  try {
    const daysRaw  = req.body?.days ?? 8;
    const langsRaw = req.body?.langs ?? 'en,hi';
    const days  = Math.max(1, parseInt(daysRaw, 10));
    const langs = Array.isArray(langsRaw)
      ? langsRaw.map(s => String(s).toLowerCase())
      : String(langsRaw).split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

    const result = await prewarmAndSave(days, langs);
    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// GET /cache/daily
app.get('/cache/daily', (req, res) => {
  const sign = String(req.query.sign || 'aries').toLowerCase();
  const lang = pickLang({ lang: req.query.lang }, req.headers);
  const date = req.query.date || toISTParts(new Date()).dateStr;

  let hit = dailyCache.get(cacheKey(date, sign, lang));
  if (!hit) {
    try {
      const file = path.join(__dirname, 'data', 'cache', 'daily', date, `${sign}.${lang}.json`);
      if (fs.existsSync(file)) {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        hit = parsed.rich || parsed;
        dailyCache.set(cacheKey(date, sign, lang), hit);
      }
    } catch {}
  }

  if (!hit) {
    return res.status(404).json({
      ok: false,
      miss: { date, sign, lang },
      hint: '/cron/prewarm-daily?days=8&langs=en,hi'
    });
  }

  res.json({
    ok: true,
    date: hit.date,
    sign: hit.sign,
    lang: hit.lang,
    text: hit.text,
    vedic: hit.vedic,
    rich: hit,
  });
});

// Disk cache helpers
function cacheFilePath(dateStr, sign, lang) {
  const s = String(sign).toLowerCase();
  const l = String(lang).toLowerCase().startsWith('hi') ? 'hi' : 'en';
  return path.join(__dirname, 'data', 'cache', 'daily', dateStr, `${s}.${l}.json`);
}
function loadCachedDaily(dateStr, sign, lang) {
  sign = String(sign).toLowerCase();
  lang = String(lang).toLowerCase().startsWith('hi') ? 'hi' : 'en';
  const key = cacheKey(dateStr, sign, lang);

  const mem = dailyCache.get(key);
  if (mem) return mem;
  try {
    const file = cacheFilePath(dateStr, sign, lang);
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      const d = parsed.rich || parsed;
      dailyCache.set(key, d);
      return d;
    }
  } catch {}
  return null;
}
function saveCachedDaily(dateStr, sign, lang, d) {
  sign = String(sign).toLowerCase();
  lang = String(lang).toLowerCase().startsWith('hi') ? 'hi' : 'en';
  const key  = cacheKey(dateStr, sign, lang);
  const file = cacheFilePath(dateStr, sign, lang);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ date: dateStr, sign, lang, rich: d }, null, 2));
  } catch {}
  dailyCache.set(key, d);
}

// ─────────────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('OPENAI_API_KEY:', maskKey(OPENAI_API_KEY));
  console.log(`Fonts ready: ${FONTS_READY}`);
  console.log(`Astro-Baba Chat API listening on ${PORT}`);
});
