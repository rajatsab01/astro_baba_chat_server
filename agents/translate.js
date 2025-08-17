// agents/translate.js (ESM)
import OpenAI from "openai";

const hasKey = !!(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim());
const client = hasKey ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

/**
 * Translate English -> Hindi while preserving numbers, times, bullets,
 * and NOT translating Sanskrit/proper-noun terms.
 * If no API key, returns the input unchanged (safe no-op).
 */
export async function translateAgent(input, to = "hi") {
  try {
    if (!input || to !== "hi" || !client) return input;

    // We call this function with single strings in your server; still normalize to string:
    const text = Array.isArray(input) ? input.join("\n") : String(input);

    const sys =
      "You are a precise translator. Translate user content into Hindi (hi-IN). " +
      "Preserve numbers, punctuation, time ranges (e.g., 12:05–12:52), and bullet symbols. " +
      "Do NOT translate Sanskrit mantras, and keep proper nouns like Hanuman, Rahu Kaal, Abhijit Muhurat, Surya, etc. " +
      "Keep formatting and line breaks. Reply with Hindi text only.";

    const resp = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: text }
      ]
    });

    const out = resp?.choices?.[0]?.message?.content?.trim();
    return out || input;
  } catch {
    return input; // fail-safe
  }
}

export default translateAgent;
