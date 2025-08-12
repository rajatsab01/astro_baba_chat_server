import express from 'express';
import cors from 'cors';
import 'dotenv/config';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const { OPENAI_API_KEY, SHARED_TOKEN } = process.env;
if (!OPENAI_API_KEY) {
  console.warn('WARNING: OPENAI_API_KEY is not set');
}

// Optional shared-token auth: only enforced if SHARED_TOKEN is set
app.use((req, res, next) => {
  if (SHARED_TOKEN && req.headers['x-api-key'] !== SHARED_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});

// Health
app.get('/', (_req, res) => {
  res.json({ ok: true, service: 'Astro-Baba Chat API' });
});

// Non-streaming
app.post('/chat', async (req, res) => {
  try {
    const { messages = [], system, model = 'gpt-4o-mini', temperature = 0.7 } = req.body || {};
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

// Streaming (SSE bridge)
app.post('/chat/stream', async (req, res) => {
  const ac = new AbortController();
  try {
    res.set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',    // hint for reverse proxies not to buffer
      'Access-Control-Allow-Origin': '*'
    });
    if (res.flushHeaders) res.flushHeaders();

    // Kick open the pipe for some proxies
    res.write(':\n\n');

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

    // Abort upstream if client disconnects
    req.on('close', () => {
      try { ac.abort(); } catch {}
    });

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

    // Robust SSE bridge: parse upstream chunks and re-emit clean data lines
    const decoder = new TextDecoder();
    let buffer = '';

    for await (const chunk of r.body) {
      buffer += decoder.decode(chunk, { stream: true });

      // Process complete events separated by blank lines
      let sepIndex;
      while ((sepIndex = buffer.indexOf('\n\n')) !== -1) {
        const event = buffer.slice(0, sepIndex);
        buffer = buffer.slice(sepIndex + 2);

        // Each event can have multiple lines like "data: {...}"
        const lines = event.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          if (trimmed.startsWith('data:')) {
            const dataPart = trimmed.slice(5).trim();

            // Forward the data line as-is
            res.write(`data: ${dataPart}\n\n`);

            // Stop condition (OpenAI sends [DONE])
            if (dataPart === '[DONE]') {
              res.end();
              return;
            }
          }
          // Ignore other fields like "event:" or "id:"; not needed for our client
        }
      }
    }

    // Flush any remaining partial data (unlikely) then close
    if (buffer.trim()) {
      res.write(`data: ${buffer.trim()}\n\n`);
    }
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (e) {
    if (ac.signal.aborted) return res.end(); // client disconnected
    console.error('POST /chat/stream error', e);
    res.write(`event: error\n`);
    res.write(`data: ${JSON.stringify({ message: 'Server error' })}\n\n`);
    res.end();
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Astro-Baba Chat API listening on ${PORT}`));
