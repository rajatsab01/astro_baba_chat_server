import express from 'express';
import cors from 'cors';
import 'dotenv/config';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Read & sanitize the key once (strip < > and whitespace)
const RAW_OPENAI = process.env.OPENAI_API_KEY || '';
const OPENAI_API_KEY = RAW_OPENAI.trim().replace(/[<>]/g, '');

// Optional shared token (we are not enforcing it now to keep things simple)
const SHARED_TOKEN = process.env.SHARED_TOKEN || null;

// Mask helper for safe logging
const mask = (k) => (k ? `${k.slice(0, 10)}...${k.slice(-4)}` : '(missing)');
console.log('OPENAI_API_KEY raw (masked):', mask(RAW_OPENAI));
console.log('OPENAI_API_KEY used (masked):', mask(OPENAI_API_KEY));

// Token middleware ONLY for /chat* AND only if SHARED_TOKEN is set
app.use((req, res, next) => {
  if (SHARED_TOKEN && req.path.startsWith('/chat')) {
    if (req.headers['x-api-key'] !== SHARED_TOKEN) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }
  next();
});

// Health
app.get('/', (_req, res) => {
  res.json({ ok: true, service: 'Astro-Baba Chat API' });
});

// Debug: see what key the server is actually using (masked)
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

// SSE self-test (no OpenAI call) — proves streaming works end-to-end
app.get('/sse-test', async (_req, res) => {
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

// Non-streaming
app.post('/chat', async (req, res) => {
  try {
    const { messages = [], system, model = 'gpt-4o-mini', temperature = 0.7 } = req.body || {};

    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: 'OPENAI_API_KEY not set' });
    }

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
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
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

// Streaming (robust SSE bridge)
app.post('/chat/stream', async (req, res) => {
  const ac = new AbortController();
  try {
    if (!OPENAI_API_KEY) {
      res.set({ 'Content-Type': 'text/event-stream; charset=utf-8' });
      res.write('event: error\n');
      res.write('data: {"message":"OPENAI_API_KEY not set"}\n\n');
      return res.end();
    }

    res.set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*'
    });
    if (res.flushHeaders) res.flushHeaders();
    res.write(':\n\n'); // heartbeat

    const { messages = [], system, model = 'gpt-4o-mini', temperature = 0.7 } = req.body || {};
    const payload = {
      model,
      temperature,
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        ...messages
      ],
      stream: true
    };

    req.on('close', () => { try { ac.abort(); } catch {} });

    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream'
      },
      body: JSON.stringify(payload),
      signal: ac.signal
    });

    if (!r.ok || !r.body) {
      const errText = await r.text();
      res.write(`event: error\n`);
      res.write(`data: ${JSON.stringify({ status: r.status, message: errText })}\n\n`);
      return res.end();
    }

    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of r.body) {
      buffer += decoder.decode(chunk, { stream: true });
      let sepIndex;
      while ((sepIndex = buffer.indexOf('\n\n')) !== -1) {
        const event = buffer.slice(0, sepIndex);
        buffer = buffer.slice(sepIndex + 2);
        for (const line of event.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          if (trimmed.startsWith('data:')) {
            const dataPart = trimmed.slice(5).trim();
            res.write(`data: ${dataPart}\n\n`);
            if (dataPart === '[DONE]') {
              res.end();
              return;
            }
          }
        }
      }
    }
    if (buffer.trim()) res.write(`data: ${buffer.trim()}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (e) {
    if (ac.signal.aborted) return res.end();
    console.error('POST /chat/stream error', e);
    res.write(`event: error\n`);
    res.write(`data: ${JSON.stringify({ message: 'Server error' })}\n\n`);
    res.end();
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Astro-Baba Chat API listening on ${PORT}`));
