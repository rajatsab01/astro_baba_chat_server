// agents/translate.js
// UNIVERSAL translator: Hindi for any incoming text, with caching.
// Uses OpenAI (OPENAI_API_KEY) and falls back gracefully if the call fails.

const MAX_CACHE = 500;
const cache = new Map();

/** Evict oldest cache entry when over limit */
function prune() {
  if (cache.size <= MAX_CACHE) return;
  const firstKey = cache.keys().next().value;
  cache.delete(firstKey);
}

/** Normalize whitespace a little (keep markdown/bullets) */
function tidy(s) {
  return String(s)
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Build a single prompt instructing rock-solid, domain-aware translation */
function buildMessages(text) {
  const system =
    "You are a precise Hindi translator for an astrology app. Translate to NATURAL, CLEAR Hindi only. " +
    "Preserve meaning, tone, and intent. Keep formatting (markdown **bold**, lists with '-' bullets, em dashes —). " +
    "Keep mantras and seed sounds in Sanskrit as-is (e.g., “Om Namah Shivaya”, “Om Graam Greem Graum…”). " +
    "Leave placeholders like {name}, {{var}}, <b> tags, and emojis unchanged. " +
    "Prefer widely used Hindi terms:\n" +
    "- Rahu Kaal → राहु काल, Yamaganda → यमगण्ड, Gulika Kaal → गुलिक काल, Abhijit Muhurat → अभिजीत मुहूर्त.\n" +
    "- Money/budget → बजट, save/saving → बचत, inbox → इनबॉक्स, micro-skill → सूक्ष्म कौशल.\n" +
    "Keep numbers and times (e.g., 12:05–12:52, 108×) as-is. " +
    "Do NOT add extra commentary. Output ONLY the translated text.";
  const user = `Translate to Hindi:\n\n${text}`;
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/** Core translator */
export async function translateAgent(input, to = "hi") {
  if (input == null) return input;

  // If not Hindi, pass-through (we only handle 'hi' today)
  if (to !== "hi") return input;

  // Array support
  if (Array.isArray(input)) {
    const out = [];
    for (const item of input) out.push(await translateAgent(item, to));
    return out;
  }

  // Primitive → string
  const text = String(input);
  const key = `hi:${text}`;

  // Cache hit
  if (cache.has(key)) return cache.get(key);

  // Fast-path: empty/short punctuation
  if (!text.trim() || /^[\-\*\s•.]+$/.test(text)) {
    cache.set(key, text);
    return text;
  }

  // Call OpenAI
  let translated = text;
  try {
    const messages = buildMessages(text);
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY || ""}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.2,
        messages,
      }),
    });

    if (resp.ok) {
      const data = await resp.json();
      const out = data?.choices?.[0]?.message?.content ?? "";
      translated = out ? tidy(out) : text;
    } else {
      // Non-200 → graceful fallback (return original)
      translated = text;
    }
  } catch {
    // Network/other error → graceful fallback (return original)
    translated = text;
  }

  // Light cleanups that frequently appear in mixed outputs
  translated = translated
    .replace(/\bToday favors\b/gi, "आज अनुकूल है")
    .replace(/\bmicro[- ]skill\b/gi, "सूक्ष्म कौशल")
    .replace(/\binbox trim\b/gi, "इनबॉक्स साफ़")
    .replace(/\bhydrate\b/gi, "जल पिएँ")
    .replace(/Rahu Kaal/gi, "राहु काल")
    .replace(/Yamaganda/gi, "यमगण्ड")
    .replace(/Gulika Kaal/gi, "गुलिक काल")
    .replace(/Abhijit Muhurat/gi, "अभिजीत मुहूर्त")
    .replace(/\s+—\s+/g, " — ");

  cache.set(key, translated);
  prune();
  return translated;
}

export default translateAgent;
