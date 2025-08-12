import express from 'express';
import cors from 'cors';
import 'dotenv/config';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// ── 1) Read & sanitize key ─────────────────────────────────────────────
const RAW_OPENAI = process.env.OPENAI_API_KEY || '';
const OPENAI_API_KEY = RAW_OPENAI.trim().replace(/[<>]/g, ''); // strip < >
const SHARED_TOKEN = process.env.SHARED_TOKEN || null;

const mask = (k) => (k ? `${k.slice(0, 10)}...${k.slice(-4)}` : '(missing)');
console.log('OPENAI_API_KEY raw (masked):', mask(RAW_OPENAI));
console.log('OPENAI_API_KEY used (masked):', mask(OPENAI_API_KEY));

// ── 2) Optional shared token for /chat* (OFF if not set) ───────────────
app.use((req, res, next) => {
  if (SHARED_TOKEN && req.path.startsWith('/chat')) {
    if (req.headers['x-api-key'] !== SHARED_TOKEN) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }
  next();
});

// ── 3) Health & debug ──────────────────────────────────────────────────
app.get('/', (_req, res) => {
  res.json({ ok: true, service: 'Astro-Baba Chat API' });
});

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

// Simple SSE test (no OpenAI)
app.get('/sse-test', async (_req, res) => {
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Access-Control-Allow-Origin': '*',
  });
  if (res.flushHeaders) res.flushHeaders();
  res.write(':\n\n');
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

// ── 4) Non-stream endpoint ─────────────────────────────────────────────
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

// ── 5) Streaming endpoint with fallback ────────────────────────────────
app.post('/chat/stream', async (req, res) => {
  const ac = new AbortController();

  // Helper: send one SSE chunk in OpenAI chunk shape
  const sendChunk = (piece) => {
    const payload = { id: 'local', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: piece }, finish_reason: null }] };
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  // Helper: fake stream if real SSE is stuck (drip text)
  const fakeStream = async (messages, system, model, temperature) => {
    try {
      const payload = {
        model,
        temperature,
        messages: [
          ...(system ? [{ role: 'system', content: system }] : []),
          ...messages
        ],
        stream: false
      };
      const r2 = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!r2.ok) {
        const t = await r2.text();
        res.write(`event: error\n`);
        res.write(`data: ${JSON.stringify({ status: r2.status, message: t })}\n\n`);
        return res.end();
      }
      const j = await r2.json();
      const full = j?.choices?.[0]?.message?.content ?? '';
      if (!full) {
        sendChunk('(no content)');
        res.write('data: [DONE]\n\n');
        return res.end();
      }
      // Drip by small chunks
      const CHUNK = 12; // characters per tick
      for (let i = 0; i < full.length; i += CHUNK) {
        sendChunk(full.slice(i, i + CHUNK));
        await new Promise(r => setTimeout(r, 25));
      }
      res.write('data: [DONE]\n\n');
      res.end();
    } catch (err) {
      console.error('fakeStream error', err);
      res.write(`event: error\n`);
      res.write(`data: ${JSON.stringify({ message: 'Server error (fallback)' })}\n\n`);
      res.end();
    }
  };

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
    res.write(':\n\n'); // heartbeat immediately

    const { messages = [], system, model = 'gpt-4o-mini', temperature = 0.7 } = req.body || {};

    // Start a fallback timer: if no token in X ms, abort and fake-stream
    let sawAnyToken = false;
    const FALLBACK_MS = 3500;
    const fallbackTimer = setTimeout(() => {
      if (!sawAnyToken) {
        try { ac.abort(); } catch {}
        fakeStream(messages, system, model, temperature);
      }
    }, FALLBACK_MS);

    // Kick off real SSE request
    req.on('close', () => { try { ac.abort(); } catch {} });

    const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream'
      },
      body: JSON.stringify({
        model,
        temperature,
        messages: [
          ...(system ? [{ role: 'system', content: system }] : []),
          ...messages
        ],
        stream: true
      }),
      signal: ac.signal
    });

    if (!upstream.ok || !upstream.body) {
      clearTimeout(fallbackTimer);
      const errText = await upstream.text();
      res.write(`event: error\n`);
      res.write(`data: ${JSON.stringify({ status: upstream.status, message: errText })}\n\n`);
      return res.end();
    }

    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of upstream.body) {
      buffer += decoder.decode(chunk, { stream: true });

      let idx;
      while ((idx = buffer.search(/\r?\n\r?\n/)) !== -1) {
        const event = buffer.slice(0, idx);
        buffer = buffer.slice(idx + (buffer[idx] === '\r' ? 4 : 2));

        for (const line of event.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          if (trimmed.startsWith('data:')) {
            const dataPart = trimmed.slice(5).trim();
            // forward
            res.write(`data: ${dataPart}\n\n`);
            if (dataPart !== '[DONE]') {
              sawAnyToken = true;        // got at least one token
              clearTimeout(fallbackTimer);
            }
            if (dataPart === '[DONE]') {
              res.end();
              return;
            }
          }
        }
      }
    }

    // If we got here with no tokens (very rare), fake-stream as last resort
    if (!sawAnyToken) {
      clearTimeout(fallbackTimer);
      await fakeStream(messages, system, model, temperature);
      return;
    }

    if (buffer.trim()) res.write(`data: ${buffer.trim()}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (e) {
    if (ac.signal.aborted) return; // client closed or we aborted for fallback
    console.error('POST /chat/stream error', e);
    res.write(`event: error\n`);
    res.write(`data: ${JSON.stringify({ message: 'Server error' })}\n\n`);
    res.end();
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Astro-Baba Chat API listening on ${PORT}`));
