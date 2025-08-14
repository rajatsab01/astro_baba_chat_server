// Optional: translate to Hindi if OPENAI_API_KEY is set
export async function translateAgent({ lang='en', lines=[] }) {
  if (lang !== 'hi') return lines;
  const key = (process.env.OPENAI_API_KEY || '').trim();
  if (!key) return lines;

  const joined = lines.join('\n@@\n');
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      messages: [
        { role: 'system', content: 'Translate to natural, respectful Hindi (Devanagari). Keep each line intact separated by @@.' },
        { role: 'user', content: joined }
      ]
    })
  });
  if (!resp.ok) return lines;
  const data = await resp.json();
  const out = data?.choices?.[0]?.message?.content || joined;
  return out.split('@@').map(s => s.trim());
}
