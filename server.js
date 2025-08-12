import express from 'express';
import cors from 'cors';
import 'dotenv/config';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// --- Read & sanitize the key (remove stray < > and whitespace) ---
const RAW_OPENAI = process.env.OPENAI_API_KEY || '';
const OPENAI_API_KEY = RAW_OPENAI.trim().replace(/[<>]/g, '');

const mask = (k) => (k ? `${k.slice(0, 10)}...${k.slice(-4)}` : '(missing)');
console.log('OPENAI_API_KEY raw (masked):', mask(RAW_OPENAI));
console.log('OPENAI_API_KEY used (masked):', mask(OPENAI_API_KEY));

// Health
app.get('/', (_req, res) => {
  res.json({ ok: true, service: 'Astro-Baba Chat API' });
});

// Debug (masked): see exactly what the service is using
app.get('/debug/key', (_req, res) => {
  const raw = RAW_OPENAI;
  const used = OPENAI_API_KEY;
  res.json({
    present_raw: !!raw,
    present_used: !!used,
    length_raw: raw.length,
    length_used: used.length,
    hasAngleBrackets_raw: /[<>]/.test(raw),
    hasAngleBrackets_used: /[<>]/.test(used),
    trimmed_raw: raw === raw.trim(),
    trimmed_used: used === used.trim(),
    raw_masked: mask(raw),
    used_masked: mask(used),
  });
});

// SSE self-test (no OpenAI) — proves Render streaming path works
app.get('/sse-test', (_req, res) => {
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Access-Control-Allow-Origin': '*',
  });
  if (res.flushHeaders) res.flushHeaders();
  res.write(':\n\n'); // heartbeat

  let i = 0;
  const timer = setInterval(() => {
    i++;
    res.write(`data: {"ping": ${i}}\n\n`);
    if (i >= 5) {
      clearInterval(timer);
      res.write('data: [DONE]\n\n');
      res.end();
    }
  }, 300);
});

// --- Non-streaming: standard OpenAI call (one-shot) ---
app.post('/chat', async (req, res) => {
  try {
    const { messages = [], system, model = 'gpt-4o-mini', temperature = 0.7 } = req.body || {};
    if (!OPENAI_API_KEY) return res.status(500).json({ error: 'OPENAI_API_KEY not set' });

    const payload = {
      model,
      temperature,
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

// --- Streaming (SAFE fallback): fetch once, then drip chunks as SSE ---
app.post('/chat/stream', async (req, res) => {
  try {
    const { messages = [], system, model = 'gpt-4o-mini', temperature = 0.7 } = req.body || {};
    if (!OPENAI_API_KEY) {
      res.set({ 'Content-Type': 'text/event-stream; charset=utf-8' });
      res.write('event: error\n');
      res.write('data: {"message":"OPENAI_API_KEY not set"}\n\n');
      return res.end();
    }

    // 1) Call OpenAI non-stream to get full text
    const payload = {
      model,
      temperature,
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

    // Prepare SSE response headers (so client starts reading)
    res.set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*',
    });
    if (res.flushHeaders) res.flushHeaders();
    res.write(':\n\n'); // heartbeat

    if (!r.ok) {
      const errText = await r.text();
      res.write('event: error\n');
      res.write(`data: ${JSON.stringify({ status: r.status, message: errText })}\n\n`);
      return res.end();
    }

    const j = await r.json();
    const full = j?.choices?.[0]?.message?.content ?? '';

    // 2) Drip the text as small "delta" chunks that match OpenAI shape
    const sendChunk = (piece) => {
      const chunk = {
        id: 'local',
        object: 'chat.completion.chunk',
        choices: [{ index: 0, delta: { content: piece }, finish_reason: null }],
      };
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    };

    if (!full) {
      sendChunk('(no content)');
      res.write('data: [DONE]\n\n');
      return res.end();
    }

    const CHARS_PER_TICK = 16;
    const TICK_MS = 25;
    for (let i = 0; i < full.length; i += CHARS_PER_TICK) {
      sendChunk(full.slice(i, i + CHARS_PER_TICK));
      // small pause to feel like streaming
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r2) => setTimeout(r2, TICK_MS));
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (e) {
    console.error('POST /chat/stream error', e);
    try {
      res.write('event: error\n');
      res.write(`data: ${JSON.stringify({ message: 'Server error' })}\n\n`);
    } catch {}
    res.end();
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Astro-Baba Chat API listening on ${PORT}`));
