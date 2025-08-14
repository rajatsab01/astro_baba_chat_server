// Deterministic helpers + time formatting shared by agents

export function hashCode(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function pick(arr, seed) { return arr[arr.length ? (seed % arr.length) : 0]; }
export function pickN(arr, n, seed) {
  const out = []; const used = new Set(); let k = seed >>> 0;
  while (out.length < Math.min(n, arr.length)) {
    const idx = k % arr.length;
    if (!used.has(idx)) { out.push(arr[idx]); used.add(idx); }
    k = (k * 1664525 + 1013904223) >>> 0; // LCG
  }
  return out;
}
export function signIndex(sign='aries'){
  const order = ['aries','taurus','gemini','cancer','leo','virgo','libra','scorpio','sagittarius','capricorn','aquarius','pisces'];
  const i = order.indexOf(String(sign).toLowerCase());
  return i === -1 ? 0 : i;
}

export function toISTParts(d = new Date()) {
  // Convert to IST using Intl (portable)
  const ist = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const y = ist.getFullYear();
  const m = String(ist.getMonth()+1).padStart(2,'0');
  const day = String(ist.getDate()).padStart(2,'0');
  const hh = String(ist.getHours()).padStart(2,'0');
  const mm = String(ist.getMinutes()).padStart(2,'0');
  const dateStr = `${y}-${m}-${day}`;
  const timeStr = `${hh}:${mm} IST`;
  const weekdayIndex = ist.getDay(); // 0..6
  return { ist, dateStr, timeStr, weekdayIndex };
}

export function dayDateHeaderUpper(lang='en', d=new Date()){
  const ist = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  if (lang === 'hi') {
    return ist.toLocaleDateString('hi-IN', { weekday:'long', day:'2-digit', month:'long', year:'numeric' });
  }
  return ist.toLocaleDateString('en-GB', { weekday:'long', day:'2-digit', month:'short', year:'numeric' }).toUpperCase();
}

export function cleanText(s=''){
  return s.replace(/\u00A0/g, ' ')
          .replace(/[ \t]+/g, ' ')
          .replace(/ *\n */g, '\n')
          .trim();
}

export function capSign(sign='') {
  const s = (sign || '').toLowerCase();
  const map = {
    aries:'Aries', taurus:'Taurus', gemini:'Gemini', cancer:'Cancer',
    leo:'Leo', virgo:'Virgo', libra:'Libra', scorpio:'Scorpio',
    sagittarius:'Sagittarius', capricorn:'Capricorn', aquarius:'Aquarius', pisces:'Pisces'
  };
  return map[s] || (s.charAt(0).toUpperCase()+s.slice(1));
}
