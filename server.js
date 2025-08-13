import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import PDFDocument from 'pdfkit';

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' })); // allow base64 logos

// --- Key sanitize (strip < > and whitespace) ---
const RAW_OPENAI = process.env.OPENAI_API_KEY || '';
const OPENAI_API_KEY = RAW_OPENAI.trim().replace(/[<>]/g, '');
const mask = (k) => (k ? `${k.slice(0, 10)}...${k.slice(-4)}` : '(missing)');
console.log('OPENAI_API_KEY raw (masked):', mask(RAW_OPENAI));
console.log('OPENAI_API_KEY used (masked):', mask(OPENAI_API_KEY));

/** Utilities **/
function nowInIST() {
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

/** Health + debug **/
app.get('/', (_req, res) => {
  res.json({ ok: true, service: 'Astro-Baba Chat API' });
});

app.get('/debug/key', (_req, res) => {
  res.json({
    present: !!OPENAI_API_KEY,
    masked: mask(OPENAI_API_KEY),
    length: OPENAI_API_KEY.length,
  });
});

/** CHAT (kept for your test page) **/
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

    if (!r.ok) {
      const errText = await r.text();
      return res.status(r.status).json({ error: errText });
    }

    const data = await r.json();
    const text = data?.choices?.[0]?.message?.content ?? '';
    res.json({ text });
  } catch (e) {
    console.error('POST /chat error', e);
    res.status(500).json({ error: 'Server error' });
  }
});

/** REPORT GENERATOR (PDF) **/
app.post('/report/generate', async (req, res) => {
  try {
    if (!OPENAI_API_KEY) return res.status(500).json({ error: 'OPENAI_API_KEY not set' });

    const {
      package: pkg = 'daily_horoscope',
      user = {},
      brand = {},
      inputs = {},
      model = 'gpt-4o-mini',
      temperature = 0.7
    } = req.body || {};

    const userName = user.name || 'Friend';
    const phone = user.phone || '';
    const appName = brand.appName || 'Astro-Baba';
    const logoBase64 = stripDataUrlPrefix(brand.logoBase64 || null); // optional
    const logoUrl = brand.logoUrl || null; // optional

    // Build a strong system prompt based on package
    const sys = buildSystemPrompt(pkg, userName, inputs);

    // Ask OpenAI for content (non-stream)
    const payload = {
      model, temperature,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: `Generate the complete ${pkg} report now. Return plain text, with clear section headings and short paragraphs.` }
      ]
    };

    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!r.ok) {
      const errText = await r.text();
      return res.status(r.status).json({ error: errText });
    }
    const j = await r.json();
    const content = j?.choices?.[0]?.message?.content ?? 'No content generated.';

    // Prepare PDF response
    const fname = `${appName.replace(/\s+/g,'_')}_${pkg}_${Date.now()}.pdf`;
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${fname}"`,
      'Cache-Control': 'no-store'
    });

    // Create PDF
    const doc = new PDFDocument({ size: 'A4', margins: { top: 56, left: 56, right: 56, bottom: 56 }});
    doc.pipe(res);

    // Header + logo
    if (logoBase64 || logoUrl) {
      try {
        let logoBuf = null;
        if (logoBase64) {
          logoBuf = Buffer.from(logoBase64, 'base64');
        } else if (logoUrl) {
          const imgResp = await fetch(logoUrl);
          if (imgResp.ok) logoBuf = Buffer.from(await imgResp.arrayBuffer());
        }
        if (logoBuf) {
          doc.image(logoBuf, 56, 40, { fit: [80, 80] });
        }
      } catch (_) { /* ignore logo errors */ }
    }

    doc.font('Helvetica-Bold').fontSize(20).text(appName, 150, 56, { continued: false });
    doc.moveDown(0.5);
    doc.font('Helvetica').fontSize(12).fillColor('#333')
      .text(`Report: ${prettyPackageName(pkg)}`)
      .text(`User: ${userName}${phone ? '  •  ' + phone : ''}`)
      .text(`Generated: ${nowInIST()} (IST)`);
    doc.moveDown(1);

    doc.moveTo(56, doc.y).lineTo(539, doc.y).strokeColor('#999').stroke();
    doc.moveDown(1);

    // Body
    doc.font('Helvetica').fontSize(12).fillColor('#000');
    const paragraphs = content.split(/\n{2,}/);
    paragraphs.forEach(p => {
      doc.text(p.trim(), { align: 'justify' });
      doc.moveDown(0.7);
    });

    // Footer
    doc.moveDown(1.2);
    doc.font('Helvetica-Oblique').fontSize(10).fillColor('#666')
      .text(`${appName} • Personalized guidance for ${userName}`);

    doc.end(); // stream ends to response
  } catch (e) {
    console.error('POST /report/generate error', e);
    if (!res.headersSent) res.status(500).json({ error: 'Server error' });
  }
});

function prettyPackageName(pkg) {
  switch (pkg) {
    case 'daily_horoscope': return 'Daily Horoscope';
    case 'gemstone': return 'Gemstone Recommendation';
    case 'matching': return 'Horoscope Matching';
    case 'mantra': return 'Mantra Recommendation';
    case 'name_change': return 'Name Change Recommendation';
    case 'roadmap': return 'One-Year Roadmap';
    case 'family_package': return 'Family Package';
    default: return pkg.replace(/_/g,' ');
  }
}

function buildSystemPrompt(pkg, userName, inputs = {}) {
  const base = [
    `You are "Astro-Baba", a kind, practical Vedic astrology expert.`,
    `Tone: positive, grounded, no fluff, easy to follow.`,
    `Audience: ${userName}. Keep advice specific and useful.`,
    `Avoid medical, legal, or financial guarantees; frame as guidance.`,
  ];

  const sections = {
    daily_horoscope: [
      'Title: Today’s Guidance',
      'Sections: Overview; Opportunities; Cautions; 1–2 Actionable Tips.',
      'Keep total length: ~180–250 words.',
    ],
    gemstone: [
      'Title: Your Gemstone Prescription',
      'Include: 1 primary gemstone (why & how to wear); 1 optional alternative; cleansing/energizing steps; dos/don’ts.',
      'Keep total length: ~200–300 words.',
    ],
    matching: [
      'Title: Compatibility Overview',
      'Include: strengths, friction points, communication tips, 3 relationship rituals to try.',
      'Length: ~300–450 words.',
    ],
    mantra: [
      'Title: Personalized Mantra',
      'Include: the mantra (IAST transliteration), meaning, how to chant (count, days, time), simple ritual.',
      'Length: ~180–280 words.',
    ],
    name_change: [
      'Title: Name Vibration Suggestions',
      'Include: lucky initials/letters, 2–3 name examples, numerology angle, signature practice.',
      'Length: ~220–320 words.',
    ],
    roadmap: [
      'Title: Your One-Year Roadmap',
      'Include: quarterly themes, 3 priority goals, monthly rituals, checkpoints.',
      'Length: ~500–700 words.',
    ],
    family_package: [
      'Title: Family Harmony Blueprint',
      'Include: household rituals, weekly sync, auspicious windows, conflict de-escalation steps.',
      'Length: ~400–600 words.',
    ],
  };

  const pkgSpec = sections[pkg] || ['Title: Personalized Guidance', 'Length: ~250–400 words.'];
  const inputNote = Object.keys(inputs || {}).length
    ? `User inputs/hints: ${JSON.stringify(inputs)}`
    : 'No additional inputs provided.';

  return [...base, ...pkgSpec, inputNote].join('\n');
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Astro-Baba Chat API listening on ${PORT}`));
