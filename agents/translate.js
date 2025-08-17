// agents/translate.js  (ESM)
// Simple, safe Hindi translator. Uses OpenAI if key exists, else falls back to light dictionary.

const HAS_KEY = !!(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim());

// quick no-op if already Hindi
function isHindi(s) { return /[\u0900-\u097F]/.test(s || ''); }

// tiny dictionary to clean common lines before/without API
const DICT = [
  // phrases first
  [/Well done is better than well said/gi, 'अच्छा किया गया, अच्छा कहा गया से बेहतर है'],
  [/Focus & Flow/gi, 'केंद्रित रहें • प्रवाह'],
  [/Auspicious window for beginnings/gi, 'नई शुरुआत के लिए शुभ'],
  [/Not favourable for new beginnings/gi, 'नई शुरुआत के लिए अनुकूल नहीं'],
  // words
  [/\bLearning\b/gi, 'सीख'],
  [/\bOpportunities?\b/gi, 'अवसर'],
  [/\bCautions?\b/gi, 'सावधानियाँ'],
  [/\bRemedy\b/gi, 'उपाय'],
  [/\bRahu Kaal\b/gi, 'राहु काल'],
  [/\bYamaganda\b/gi, 'यमगण्ड'],
  [/\bGulika Kaal\b/gi, 'गुलिक काल'],
  [/\bAbhijit Muhurat\b/gi, 'अभिजीत मुहूर्त'],
];

async function translateWithOpenAI(text, to) {
  // use native fetch; no extra deps
  const body = {
    model: 'gpt-4o-mini',
    temperature: 0.2,
    messages: [
      { role: 'system', content: 'You are a precise Hindi translator. Keep proper nouns. No quotes around output.' },
      { role: 'user', content: `Translate to Hindi (natural, concise, neutral tone):\n${text}` },
    ],
  };
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}`);
  const json = await res.json();
  return (json.choices?.[0]?.message?.content || '').trim();
}

export async function translateAgent(input, to = 'hi') {
  if (!input) return input;
  if (to !== 'hi' || isHindi(input)) return input;

  // pre-clean with dictionary
  let pre = String(input);
  for (const [re, rep] of DICT) pre = pre.replace(re, rep);

  if (!HAS_KEY) return pre; // no API → return cleaned

  try {
    const out = await translateWithOpenAI(pre, 'hi');
    return out || pre;
  } catch {
    return pre; // fail-safe
  }
}

export default { translateAgent };
