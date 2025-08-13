// server.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
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
// Utils
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
function formatIST(dt = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit'
  }).formatToParts(dt).reduce((acc, p) => (acc[p.type] = p.value, acc), {});
  // yyyy-MM-dd HH:mm
  return `${fmt.year}-${fmt.month}-${fmt.day} ${fmt.hour}:${fmt.minute}`;
}

// Localized greeting
function greeting(lang) {
  return lang === 'hi' ? 'नमस्ते जी,' : 'Namaste ji,';
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

  // 3rd line (no brand duplication; include IST date+time)
  applyFont(doc, { lang, weight: 'regular' });
  doc.fontSize(10).fillColor('#444').text(subLine, titleX, startY + 40);
  doc.fillColor('black').moveDown(1);

  // divider
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

// New: short glossary for the four periods (requested)
function addVedicGlossary(doc, { lang }) {
  const L = (en, hi) => lang === 'hi' ? hi : en;
  applyFont(doc, { lang, weight: 'bold' });
  doc.fontSize(12).text(L('About the Vedic Periods', 'वैदिक कालखंड के बारे में'));
  applyFont(doc, { lang });
  doc.moveDown(0.2);
  const lines = lang === 'hi'
    ? [
        'राहु काल: नए कार्य/शुभ शुरुआत के लिए अनुकूल नहीं।',
        'यमगण्ड: यात्रा/महत्वपूर्ण कार्य से बचें।',
        'गुलिक काल: नियमित कार्य ठीक, पर शुभ शुरुआत टालें।',
        'अभिजीत मुहूर्त: शुभ कार्य प्रारम्भ करने के लिए अनुकूल।',
      ]
    : [
        'Rahu Kaal: Not favourable for new beginnings.',
        'Yamaganda: Avoid travel/major starts.',
        'Gulika Kaal: Routine is fine; avoid fresh starts.',
        'Abhijit Muhurat: Auspicious window for beginnings.',
      ];
  lines.forEach(t => doc.text(`• ${t}`, { paragraphGap: 2 }));
  doc.moveDown(0.6);
}

function addSection(doc, { lang, heading, paragraphs = [] }) {
  applyFont(doc, { lang, weight: 'bold' });
  doc.fontSize(14).text(cleanText(heading));
  applyFont(doc, { lang });
  doc.moveDown(0.2);
  paragraphs.forEach(p => doc.fontSize(12).text(
    cleanText(p),
    { paragraphGap: 6, align: 'justify' }   // ← center/justify body text
  ));
  doc.moveDown(0.4);
}

function addDisclaimerThankYou(doc, { lang }) {
  // Consistent disclaimer (same as personal)
  const disclaimer =
    lang === 'hi'
      ? 'आपकी रिपोर्ट चिंतनशील ज्योतिषीय अंतर्दृष्टि प्रदान करती है। इसे सहायक मार्गदर्शन मानें, न कि पूर्ण भविष्यवाणी।'
      : 'Your report offers reflective astrological insights. Treat it as supportive guidance, not an absolute prediction.';

  const thanks =
    lang === 'hi'
      ? 'धन्यवाद — टीम Astro-Baba.com'
      : 'Thank you — Team Astro-Baba.com';

  applyFont(doc, { lang, weight: 'bold' });
  doc.text(lang === 'hi' ? 'अंतिम नोट' : 'Final Note');
  applyFont(doc, { lang });
  doc.moveDown(0.2);
  doc.text(disclaimer, { align: 'justify' });
  doc.moveDown(0.6);
  doc.text(thanks);
  doc.moveDown(0.8);

  const year = new Date().getFullYear();
  doc.fontSize(9).fillColor('#555')
    .text(`© ${year} Astro-Baba.com`, { align: 'center' });
  doc.fillColor('black');
}

// Simple placeholders for now
function getVedicTimingsForTodayIST() {
  return {
    rahuKaal: '12:00–13:30',
    yamaganda: '07:30–09:00',
    gulikaKaal: '10:30–12:00',
    abhijitMuhurat: '12:05–12:52',
  };
}

// Sacred Day Focus (weekday deity + quick practice)
function addSacredDaySection(doc, { lang, date = new Date() }) {
  const weekday = new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'Asia/Kolkata' }).format(date);
  const map = {
    Monday:  { en: ['Monday • Shiva/Parvati', 'Offer milk to a Shivling; “Om Namah Shivaya” 108×'], hi: ['सोमवार • शिव/पार्वती', 'शिवलिंग पर दुग्धाभिषेक; “ॐ नमः शिवाय” 108 बार'] },
    Tuesday: { en: ['Tuesday • Hanuman/Mars',  'Read Hanuman Chalisa; offer sindoor & jaggery'], hi: ['मंगलवार • हनुमान/मंगल', 'हनुमान चालीसा; सिंदूर व गुड़ चढ़ाएँ'] },
    Wednesday:{en: ['Wednesday • Krishna/Mercury','Chant “Om Namo Bhagavate Vasudevaya”; donate greens'], hi: ['बुधवार • कृष्ण/बुध','“ॐ नमो भगवते वासुदेवाय” जप; हरी सब्ज़ियाँ दान']},
    Thursday:{ en: ['Thursday • Vishnu/Brihaspati','Vishnu Sahasranama; offer chana dal & turmeric'], hi: ['गुरुवार • विष्णु/बृहस्पति','विष्णु सहस्रनाम; चने की दाल व हल्दी अर्पित']},
    Friday:  { en: ['Friday • Lakshmi/Venus', 'Light a ghee diya; “Om Shreem Mahalakshmyai Namah”'], hi: ['शुक्रवार • लक्ष्मी/शुक्र','घी का दीपक; “ॐ श्रीं महालक्ष्म्यै नमः”'] },
    Saturday:{ en: ['Saturday • Shani', 'Oil lamp under Peepal; Shani mantra, serve the needy'], hi: ['शनिवार • शनि','पीपल के नीचे तेल का दीपक; शनि मंत्र; सेवाभाव'] },
    Sunday:  { en: ['Sunday • Surya', 'Arghya to Sun; “Om Suryaya Namah” 11×'], hi: ['रविवार • सूर्य','सूर्य को अर्घ्य; “ॐ सूर्याय नमः” 11 बार'] },
  };
  const info = map[weekday] || map['Sunday'];
  const [head, tip] = lang === 'hi' ? info.hi : info.en;

  addSection(doc, { lang, heading: head, paragraphs: [tip] });

  // NOTE (tithi): plug a real Panchang API later and add a second line here.
  // Example usage later: addSection(doc, { lang, heading: ..., paragraphs: [`Tithi: ${providedTithi}`] });
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
app.get('/debug/version', (req, res) => {
  res.json({
    time: new Date().toISOString(),
    node: process.version,
    env: process.env.NODE_ENV || 'production',
    commit: process.env.RENDER_GIT_COMMIT || null,
    cwd: process.cwd(),
    fontsReady: FONTS_READY,
  });
});

// DAILY JSON (deterministic EN/HI)
function capSign(sign='') {
  const s = (sign || '').toLowerCase();
  const map = {
    aries:'Aries', taurus:'Taurus', gemini:'Gemini', cancer:'Cancer',
    leo:'Leo', virgo:'Virgo', libra:'Libra', scorpio:'Scorpio',
    sagittarius:'Sagittarius', capricorn:'Capricorn', aquarius:'Aquarius', pisces:'Pisces'
  };
  return map[s] || (s.charAt(0).toUpperCase()+s.slice(1));
}
function luckyColorHi(enColor='') {
  const m = {
    'leaf green':'पत्तियों जैसा हरा',
    'amber':'अम्बर',
    'turquoise':'फ़िरोज़ी',
    'coral':'मूंगा',
    'royal blue':'रॉयल ब्लू',
    'maroon':'मरून',
    'violet':'बैंगनी',
    'saffron':'केसरिया',
    'silver':'चांदी'
  };
  return m[enColor] || enColor;
}

app.get('/daily', async (req, res) => {
  const signRaw = (req.query.sign || 'aries').toString().toLowerCase();
  const signCap = capSign(signRaw);
  const lang    = pickLang({ lang: req.query.lang });
  const dateStr = todayISOIST().slice(0, 10);

  const luckyNumber = ((new Date(dateStr).getTime() / 86400000) % 9 | 0) + 1; // 1..9
  const colorsEn = ['leaf green','amber','turquoise','coral','royal blue','maroon','violet','saffron','silver'];
  const luckyColorEn = colorsEn[(luckyNumber - 1) % colorsEn.length];
  const luckyColorHiStr = luckyColorHi(luckyColorEn);

  const textEn = `**${signCap} • ${dateStr}**
Today brings a refreshing boost of motivation. Focus your energy wisely.
Lucky color: ${luckyColorEn}. Lucky number: ${luckyNumber}. Use Abhijit Muhurat for key decisions; avoid Rahu Kaal for new beginnings.

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

  const textHi = `**${signCap} • ${dateStr}**
आज ऊर्जा में ताज़गी रहेगी—दिशा स्पष्ट रखें।
भाग्यशाली रंग: ${luckyColorHiStr}. भाग्यशाली अंक: ${luckyNumber}.
महत्वपूर्ण समय: महत्वपूर्ण कार्यों हेतु अभिजीत मुहूर्त का उपयोग करें; नए काम की शुरुआत के लिए राहु काल से बचें।

अवसर:
- दोपहर से पहले एक महत्वपूर्ण कार्य पूरा करें।
- मन को रीसेट करने के लिए थोड़ी देर टहलें।
- मध्यम-अवधि के लक्ष्यों के अनुरूप वित्त की समीक्षा करें।

सावधानियाँ:
- आवेग में खरीदारी से बचें।
- अधिक वादे न करें।
- जरूरी काम के समय मल्टीटास्किंग सीमित रखें।

उपाय:
शाम को दीपक जलाएँ और 3 मिनट श्वास पर सजगता का अभ्यास करें।`;

  res.json({
    date: dateStr,
    sign: signRaw,
    lang,
    text: lang === 'hi' ? textHi : textEn,
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
    const whenIST = formatIST(new Date());

    const daily = await (await fetch(
      `${req.protocol}://${req.get('host')}/daily?sign=${encodeURIComponent(sign)}&lang=${lang}`
    )).json();

    const doc = new PDFDocument({ margin: 36, bufferPages: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition',
      `attachment; filename="AstroBaba_Daily_${sign}_${dateStr}_${lang}.pdf"`);

    applyFont(doc, { lang, weight: 'regular' });

    const titleLine = lang === 'hi' ? 'दैनिक राशिफल' : 'Daily Horoscope';
    const who = (user?.name || '').trim() || (lang==='hi'?'मित्र':'Friend');
    const subLine   = `${who} • ${whenIST} IST`; // ← no brand duplication

    addBrandHeader(doc, { lang, brand, titleLine, subLine });
    addUserBlock(doc,   { lang, user: {
      name:  user?.name,
      phone: user?.phone,
      email: user?.email,
      gender:user?.gender,
      dob:   user?.dob,
      tob:   user?.time || user?.tob,
      place: user?.place,
    }});
    addVedicTimings(doc, { lang, timings: daily.vedic });

    // Sacred Day (weekday focus)
    addSacredDaySection(doc, { lang, date: new Date() });

    // Greeting (localized)
    applyFont(doc, { lang, weight: 'bold' });
    doc.fontSize(12).text(greeting(lang));
    applyFont(doc, { lang });
    doc.moveDown(0.5);

    // Body (flatten markdown; center/justify paragraphs)
    const paragraphs = (daily.text || '').split('\n').filter(Boolean);
    paragraphs.forEach(p => {
      const line = p.replace(/^\*+|^[-–•]\s*/g, '').trim();
      doc.fontSize(12).text(cleanText(line), { paragraphGap: 6, align: 'justify' });
    });

    doc.moveDown(0.4);

    // Short glossary for 4 periods (instead of brackets near each)
    addVedicGlossary(doc, { lang });

    addDisclaimerThankYou(doc, { lang });

    doc.pipe(res);
    doc.end();
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// GENERIC PACKAGE → PDF (gemstone / mantra / etc.)
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
    const whenIST = formatIST(new Date());

    let prompt =
`Create a concise report for package "${pkg}" using any provided inputs.
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
    const who = (user?.name || '').trim() || (lang==='hi'?'मित्र':'Friend');
    const subLine   = `${who} • ${whenIST} IST`; // ← no brand duplication

    addBrandHeader(doc, { lang, brand, titleLine, subLine });
    addUserBlock(doc,   { lang, user: {
      name:  user?.name,
      phone: user?.phone,
      email: user?.email,
      gender:user?.gender,
      dob:   user?.dob,
      tob:   user?.time || user?.tob,
      place: user?.place,
    }});

    addSacredDaySection(doc, { lang, date: new Date() });

    // Greeting (localized)
    applyFont(doc, { lang, weight: 'bold' });
    doc.fontSize(12).text(greeting(lang));
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

    addVedicTimings(doc, { lang, timings: getVedicTimingsForTodayIST() });
    addVedicGlossary(doc, { lang });

    addDisclaimerThankYou(doc, { lang });

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
    const whenIST = formatIST(new Date());

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
    const who = (user?.name || '').trim() || (lang==='hi'?'मित्र':'Friend');
    const subLine   = `${who} • ${whenIST} IST`;

    addBrandHeader(doc, { lang, brand, titleLine, subLine });
    addUserBlock(doc,   { lang, user: {
      name:  user?.name,
      phone: user?.phone,
      email: user?.email,
      gender:user?.gender,
      dob:   user?.dob,
      tob:   user?.time || user?.tob,
      place: user?.place,
    }});

    // Greeting (localized)
    applyFont(doc, { lang, weight: 'bold' });
    doc.fontSize(12).text(greeting(lang));
    applyFont(doc, { lang });
    doc.moveDown(0.6);

    days.forEach((d, idx) => {
      const head = lang === 'hi' ? `दिन ${idx + 1}` : `Day ${idx + 1}`;
      addSection(doc, { lang, heading: head, paragraphs: [] });

      const paragraphs = (d.text || '').split('\n').filter(Boolean);
      paragraphs.forEach(p => {
        const line = p.replace(/^\*+|^[-–•]\s*/g, '').trim();
        doc.fontSize(12).text(cleanText(line), { paragraphGap: 6, align: 'justify' });
      });
      doc.moveDown(0.4);
    });

    addDisclaimerThankYou(doc, { lang });

    doc.pipe(res);
    doc.end();
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('OPENAI_API_KEY:', maskKey(OPENAI_API_KEY));
  console.log(`Fonts ready: ${FONTS_READY}`);
  console.log(`Astro-Baba Chat API listening on ${PORT}`);
});
