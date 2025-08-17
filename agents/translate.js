// File: agents/translate.js  (ESM)
// Purpose: Reliable Hindi translation used by composeDaily()
// Works when imported as:  import { translateAgent } from './agents/translate.js'
// Also provides default export:  import x from './agents/translate.js'

const API_KEY = (process.env.OPENAI_API_KEY || '').trim();

// Quick checks
const hasDevanagari = (s) => /[\u0900-\u097F]/.test(String(s || ''));
const isEmpty = (s) => s == null || String(s).trim().length === 0;

/**
 * Translate plain text -> Hindi.
 * - If already Hindi, returns as-is.
 * - If no API key, returns as-is (safe no-op).
 * - Keeps Sanskrit mantras / seed syllables untouched when the model respects the instruction.
 */
export async function translateAgent(text, to = 'hi') {
  try {
    if (isEmpty(text)) return text;
    if (to !== 'hi') return text;
    if (hasDevanagari(text)) return text;
    if (!API_KEY) return text; // safe no-op if key not set

    // OpenAI Chat Completions via fetch (no external npm deps)
    const sys =
      "You are a precise, natural Hindi translator. Translate the USER text into clean, natural Hindi. " +
      "Preserve list markers (•, -, 1.), emojis, punctuation, and spacing. " +
      "Keep Sanskrit seed mantras (e.g., 'Om Namah Shivaya', beej mantras) in original form. " +
      "Do not add explanations. Only output the translated text.";

    const body = {
      model: "gpt-4o-mini",
      temperature: 0.1,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: String(text) }
      ]
    };

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    if (!resp.ok) {
      // If API fails, fall back gracefully
      return text;
    }

    const data = await resp.json();
    const out = data?.choices?.[0]?.message?.content?.trim();
    return isEmpty(out) ? text : out;
  } catch {
    return text; // never break the server
  }
}

export default translateAgent;
