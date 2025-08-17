// agents/translate.js
// Minimal universal translator (EN -> HI best-effort) used by server.js
// - Accepts either translateAgent("text","hi") OR translateAgent({text:"...", to:"hi"})
// - Returns a STRING (so server's callers work without changes)

function normalizeArgs(input, to) {
  if (typeof input === 'string') {
    return { text: input, to: to || 'hi' };
  }
  if (input && typeof input === 'object') {
    return { text: String(input.text ?? ''), to: String(input.to ?? to ?? 'hi') };
  }
  return { text: String(input ?? ''), to: to || 'hi' };
}

// Phrase bank (add over time as needed)
const PHRASES = [
  // Headlines / leads
  [/^Today favors\s+Health\s*&\s*Balance\s*—\s*pace yourself and hydrate\.?$/i, 'आज स्वास्थ्य और संतुलन के लिए अनुकूल है — गति संयत रखें और जल पिएँ.'],
  [/^Today favors\s+Learning\s*—\s*one micro-skill compounds quietly\.?$/i, 'आज सीखने के लिए अनुकूल है — एक सूक्ष्म कौशल चुपचाप बढ़त देता है।'],
  [/^Today favors Momentum.*$/i, 'आज गति के लिए अनुकूल है — पहले कदम स्पष्ट रखें।'],

  // Lucky line fragments
  [/Lucky color:/gi, 'भाग्यशाली रंग:'],
  [/Lucky number:/gi, 'भाग्यशाली अंक:'],
  [/Use Abhijit Muhurat for key actions; avoid Rahu Kaal for fresh launches\./gi,
   'महत्वपूर्ण कार्यों हेतु अभिजीत मुहूर्त का उपयोग करें; नई शुरुआत के लिए राहु काल से बचें।'],

  // Sections
  [/Opportunities:/gi, 'अवसर:'],
  [/Cautions:/gi, 'सावधानियाँ:'],
  [/Remedy:/gi, 'उपाय:'],

  // Common bullets (opportunities)
  [/Have one honest check[- ]?in with a key person\.?/gi, 'किसी महत्वपूर्ण व्यक्ति से एक ईमानदार बातचीत करें।'],
  [/Make a tiny improvement to your budgeting\/saving\.?/gi, 'अपने बजट/बचत में छोटा सुधार करें।'],
  [/Do a 10[- ]minute inbox trim to lower noise\.?/gi, 'शोर कम करने के लिए 10 मिनट इनबॉक्स साफ़ करें।'],

  // Common bullets (cautions)
  [/Don’t accept every request — protect a 2[- ]hour deep[- ]work block\.?/gi,
   'हर अनुरोध न मानें — 2 घंटे का गहन-कार्य खंड सुरक्षित रखें।'],
  [/Beware emotional emails; sleep on them\.?/gi,
   'भावनात्मक ईमेल पर तुरंत उत्तर न दें; पहले ठहरें/एक रात सोचें।'],
  [/Avoid promising timelines you haven’t pressure[- ]tested\.?/gi,
   'जिन समयसीमाओं का परीक्षण नहीं किया है, उनका वादा न करें।'],

  // Remedies (keep mantra as-is)
  [/At dusk, light a diya and chant “?Om Namah Shivaya”? 11×\.?/gi,
   'संध्या में दीपक जलाएँ और “ॐ नमः शिवाय” 11 बार जप करें।'],

  // Quote/affirmation/mood (common)
  [/“The best way out is always through.” — Robert Frost/gi,
   '“बाहर निकलने का सबसे अच्छा तरीका होता है–सीधे होकर निकलना।” — रॉबर्ट फ़्रॉस्ट'],
  [/I move with calm focus and steady courage\./gi,
   'मैं शांत एकाग्रता और स्थिर साहस के साथ आगे बढ़ता/बढ़ती हूँ।'],
  [/Open and kind — your warmth attracts support\./gi,
   'खुले और दयालु रहें — आपकी गर्मजोशी सहयोग को आकर्षित करती है।'],

  // Day deity lines (server already localizes many, but keep fallbacks)
  [/^Today being\s+Surya\/Aditya\s+day\.$/gi, 'आज सूर्य/आदित्य दिवस है।'],
  [/^Today being\s+Shiva\/Som\s+day\.$/gi, 'आज शिव/सोम दिवस है।'],
];

// Word/phrase level replacements
const REPLACEMENTS = [
  [/^Today favors\s+/gi, 'आज अनुकूल है '],
  [/Health\s*&\s*Balance/gi, 'स्वास्थ्य और संतुलन'],
  [/pace yourself/gi, 'गति संयत रखें'],
  [/hydrate/gi, 'जल पिएँ'],

  [/micro[- ]skill/gi, 'सूक्ष्म कौशल'],
  [/deep[- ]work/gi, 'गहन कार्य'],
  [/check[- ]in/gi, 'बातचीत'],
  [/inbox\s*trim/gi, 'इनबॉक्स साफ़'],

  [/Avoid/gi, 'बचें'],
  [/Don’t/gi, 'न करें'],
  [/Beware/gi, 'सावधान रहें'],
];

// Clean-ups for Hinglish leftovers
function cleanHi(s) {
  let out = s;

  // Apply phrase-level exact/regex matches first
  for (const [pattern, hi] of PHRASES) {
    out = out.replace(pattern, hi);
  }
  // Then word/fragment-level replacements
  for (const [pattern, hi] of REPLACEMENTS) {
    out = out.replace(pattern, hi);
  }

  // Minor tidy-ups
  out = out
    .replace(/\s+—\s+/g, ' — ')
    .replace(/\s+/g, match => match.includes('\n') ? match : ' ')
    .replace(/\. \./g, '.')
    .trim();

  return out;
}

async function translateOne(text, to) {
  if (!text || to !== 'hi') return text;
  // Best-effort: try phrase bank + cleanups
  return cleanHi(String(text));
}

export async function translateAgent(input, to) {
  const { text, to: lang } = normalizeArgs(input, to);

  // Strings
  if (typeof text === 'string') {
    return await translateOne(text, lang);
  }

  // Arrays
  if (Array.isArray(text)) {
    const out = [];
    for (const t of text) out.push(await translateOne(t, lang));
    return out;
  }

  // Objects (rare) — translate leaf strings
  if (text && typeof text === 'object') {
    const clone = Array.isArray(text) ? [] : {};
    for (const k of Object.keys(text)) {
      const v = text[k];
      if (typeof v === 'string') clone[k] = await translateOne(v, lang);
      else if (Array.isArray(v)) clone[k] = await Promise.all(v.map(it => translateOne(it, lang)));
      else clone[k] = v;
    }
    // Server expects a string or {text: "..."} if not a string; return {text: "..."} for safety
    return { text: JSON.stringify(clone) };
  }

  return String(text ?? '');
}

// Export default for ESM default import compatibility
export default translateAgent;
