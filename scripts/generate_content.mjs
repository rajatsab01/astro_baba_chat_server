#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ─────────────────────────────────────────────────────────────
// paths (robust to where you run the script from)
// ─────────────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const repoRoot   = path.resolve(__dirname, '..'); // .../astro_baba_chat_server

const OUT_DIR    = path.join(repoRoot, 'data');
const AGENTS_DIR = path.join(repoRoot, 'agents');

// try multiple locations for the template
const TEMPLATE_CANDIDATES = [
  // run from repo root
  path.join(process.cwd(), 'data', 'content.template.json'),
  // explicit repo paths
  path.join(repoRoot, 'data', 'content.template.json'),
  path.join(__dirname, 'data', 'content.template.json'), // if you keep a copy under scripts/data
];

function firstExisting(paths) {
  for (const p of paths) {
    try { if (fs.existsSync(p)) return p; } catch {}
  }
  return null;
}
const TEMPLATE = firstExisting(TEMPLATE_CANDIDATES);

// ─────────────────────────────────────────────────────────────
// config
// ─────────────────────────────────────────────────────────────
const MODEL   = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const API_KEY = process.env.OPENAI_API_KEY;

// ─────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────
function yyyymm(d = new Date()) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}
function readJSON(p, fallback = null) {
  try {
    let s = fs.readFileSync(p, 'utf8');
    // strip UTF-8 BOM if present
    if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
    return JSON.parse(s);
  } catch (e) {
    console.error('[readJSON] failed for', p, '-', e.message);
    return fallback;
  }
}
function writeJSON(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8');
}
function writeJSModule(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const body = `// Auto-generated. Do not edit by hand.\nexport default ${JSON.stringify(obj, null, 2)};\n`;
  fs.writeFileSync(p, body, 'utf8');
}

async function callOpenAI(prompt, schema) {
  if (!API_KEY) throw new Error('OPENAI_API_KEY missing');
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.7,
      messages: [
        {
          role: 'system',
          content: `You are a careful content generator for a Vedic astrology app.
- Output strictly valid JSON that matches the provided schema and template keys.
- Keep language warm, clear, non-urban-biased (works for students, homemakers, job, self-employed, and not-working personas).
- Provide modest, practical lines. No medical/financial claims. Keep 1–2 sentences per item.
- For each persona: 6 opportunities, 6 cautions, 3 remedy_addons (EN+HI).
- For gemstone/mantra: fill for all 12 signs; keep names authentic; include concise “why now” tones.
- Preserve provided “closing” and “vedicNote” texts unchanged.
- Avoid duplicate lines within the same month; rotate phrasing.`,
        },
        { role: 'user', content: JSON.stringify({ template: schema }, null, 2) },
      ],
      response_format: { type: 'json_object' },
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`OpenAI error ${res.status}: ${txt}`);
  }
  return await res.json();
}

// ─────────────────────────────────────────────────────────────
// main
// ─────────────────────────────────────────────────────────────
(async () => {
  if (!TEMPLATE) {
    console.error('[generator] looked for template in:');
    TEMPLATE_CANDIDATES.forEach(p => console.error(' -', p));
    throw new Error('content.template.json missing');
  }
  console.log('[generator] using template:', TEMPLATE);

  const now = new Date();
  const ver = yyyymm(now);

  const template = readJSON(TEMPLATE);
  if (!template) throw new Error('content.template.json missing or invalid JSON');

  // ask the model to fill the template
  const payload = await callOpenAI(
    `Fill the template for version ${ver}. Return the entire completed object.`,
    template
  );

  // some APIs put JSON under choices[0].message.content
  const raw = payload?.choices?.[0]?.message?.content;
  const content = raw ? JSON.parse(raw) : payload;

  // set month/version metadata
  content.version = ver;
  if (content.meta) {
    content.meta.month = ver;
    if (!content.meta.version) content.meta.version = 1;
  }

  // write outputs
  const outJson = path.join(OUT_DIR, `content.${ver}.json`);
  const outJs   = path.join(AGENTS_DIR, 'contentBank.js');
  writeJSON(outJson, content);
  writeJSModule(outJs, content);

  console.log(`Generated content for ${ver}`);
  console.log(`- ${path.relative(repoRoot, outJson)}`);
  console.log(`- ${path.relative(repoRoot, outJs)}`);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
