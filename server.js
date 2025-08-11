import express from 'express';
import cors from 'cors';
import 'dotenv/config';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  console.warn('WARNING: OPENAI_API_KEY is not set');
}

// Health check
app.get('/', (_req, res) => {
  res.json({ ok: true, service: 'Astro-Baba Chat API' });
});

// Non-streaming chat
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
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
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
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

// Streaming chat (SSE passthrough)
app.post('/chat/stream', async (req, res) => {
  try {
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    if (res.flushHeaders) res.flushHeaders();

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

    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!r.ok || !r.body) {
      const errText = await r.text();
      res.write(`event: error\n`);
      res.write(`data: ${JSON.stringify({ status: r.status, message: errText })}\n\n`);
      return res.end();
    }

    for await (const chunk of r.body) {
      res.write(chunk);
    }
    res.end();
  } catch (e) {
    console.error(e);
    res.write(`event: error\n`);
    res.write(`data: ${JSON.stringify({ message: 'Server error' })}\n\n`);
    res.end();
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Astro-Baba Chat API listening on ${PORT}`));
