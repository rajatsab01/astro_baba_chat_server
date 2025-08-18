// Deterministic helpers + time formatting shared by agents

export function hashCode(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function pick(arr, seed) {
  return arr[arr.length ? (seed % arr.length) : 0];
}

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

/**
 * Bulletproof IST parts:
 * - Primary: Intl.DateTimeFormat parts with Asia/Kolkata
 * - Fallback: manual +05:30 offset (IST has no DST)
 * Returns:
 *  { ist: Date (IST-shifted epoch for convenience), dateStr: 'YYYY-MM-DD', timeStr: 'HH:MM IST', weekdayIndex: 0..6 }
 */
export function toISTParts(d = new Date()) {
  const date = (d instanceof Date) ? d : new Date(d);
  // helper to create an IST-shifted Date (epoch moved by +330 minutes)
  const makeISTDate = (base) => {
    const utcMs = base.getTime() + base.getTimezoneOffset() * 60000;
    return new Date(utcMs + 330 * 60000);
  };

  try {
    // Use Intl parts to avoid locale string round-trips
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
      weekday: 'short'
    });
    const parts = Object.fromEntries(fmt.formatToParts(date).map(p => [p.type, p.value]));
    const y   = Number(parts.year);
    const m   = parts.month;
    const day = parts.day;
    const hh  = parts.hour;
    const mm  = parts.minute;

    const wmap = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 };
    const weekdayIndex = wmap[parts.weekday] ?? 0;

    const istDate = makeISTDate(date); // convenient IST-shifted Date instance
    const dateStr = `${y}-${m}-${day}`;
    const timeStr = `${hh}:${mm} IST`;
    return { ist: istDate, dateStr, timeStr, weekdayIndex };
  } catch {
    // Fallback: constant +05:30 offset math
    const istDate = makeISTDate(date);
    const y  = istDate.getUTCFullYear();
    const m  = String(istDate.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(istDate.getUTCDate()).padStart(2, '0');
    const hh = String(istDate.getUTCHours()).padStart(2, '0');
    const mm = String(istDate.getUTCMinutes()).padStart(2, '0');
    const weekdayIndex = istDate.getUTCDay();
    return { ist: istDate, dateStr: `${y}-${m}-${dd}`, timeStr: `${hh}:${mm} IST`, weekdayIndex };
  }
}

/**
 * Uppercased day+date header rendered in target language for IST.
 * No string round-trip; formats directly in the timezone.
 */
export function dayDateHeaderUpper(lang='en', d=new Date()){
  const locale = lang === 'hi' ? 'hi-IN' : 'en-GB';
  const opts = lang === 'hi'
    ? { weekday:'long', day:'2-digit', month:'long', year:'numeric', timeZone: 'Asia/Kolkata' }
    : { weekday:'long', day:'2-digit', month:'short', year:'numeric', timeZone: 'Asia/Kolkata' };
  const text = new Intl.DateTimeFormat(locale, opts).format(d);
  return lang === 'hi' ? text : text.toUpperCase();
}

export function cleanText(s=''){
  return String(s || '')
    .replace(/\u00A0/g, ' ')
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

// --- Hindi cleanup & normalization ------------------------------------------

/**
 * Best-effort cleanup to remove Hinglish/English bleed-through
 * and common OCR/ligature issues in Devanagari.
 */
export function cleanHi(s = '') {
  let out = String(s || '').normalize('NFC');

  // WEEKLY THEMES & COMMON LINES (EN → HI)
  out = out.replace(/Stewardship\s*&\s*Savings/gi, 'संरक्षण और बचत');
  out = out.replace(/tighten one small leak/gi, 'एक छोटी रिसाव बंद करें');

  out = out.replace(/Creative\s*Spark/gi, 'रचनात्मक चिंगारी');
  out = out.replace(/test a playful idea quickly/gi, 'एक खिलंदड़े विचार को जल्दी परखें');

  out = out.replace(/Relationship\s*Warmth/gi, 'संबंधों में ऊष्मा');
  out = out.replace(/short honest (?:conversations?|बातचीत)s? go far/gi, 'छोटी ईमानदार बातचीत बहुत असर करती है');

  out = out.replace(/Pragmatic\s*Care/gi, 'व्यावहारिक देखभाल');
  out = out.replace(/body,\s*sleep,\s*budgeting,\s*tiny wins/gi, 'शरीर, नींद, बजट, छोटी-छोटी जीत');

  // Anti-mix: partial English+Hindi variants
  out = out.replace(/Learn\s+one\s+micro[-\s]?skill/gi, 'एक सूक्ष्म कौशल सीखें');
  out = out.replace(/you[’']?ll\s+reuse\s+this\s+week/gi, 'जिसे आप इस सप्ताह फिर उपयोग करेंगे');
  out = out.replace(/if you need an early start/gi, 'अगर आपको सुबह जल्दी शुरू करना है तो');

  out = out.replace(/Journal one page to clear mental fog/gi, 'मानसिक धुंध हटाने के लिए एक पृष्ठ जर्नल लिखें');

  out = out.replace(/Skip unplanned purchases sparked by mood/gi, 'मूड में की गई अनियोजित खरीद से बचें');
  out = out.replace(/Limit multitasking during crucial work/gi, 'महत्वपूर्ण काम के दौरान मल्टीटास्किंग सीमित रखें');

  out = out.replace(/Don[’']?t\s*overfill\s*the\s*calendar(?:\s*—|\s*-\s*)\s*leave\s*white\s*space/gi,
                     'कैलेंडर मत ठूँसें — थोड़ा खाली समय छोड़ें');

  out = out.replace(/Invest 20 minutes in a health micro[- ]habit/gi, 'स्वास्थ्य की एक सूक्ष्म आदत में 20 मिनट लगाएँ');
  out = out.replace(/Touch base with a senior\/mentor for a 30[- ]sec checkpoint/gi, 'किसी वरिष्ठ\/मार्गदर्शक से 30-सेकंड का चेकपॉइंट लें');
  out = out.replace(/Draft a quick 3[–-]6[- ]month outline so today fits a bigger arc/gi, 'आज को बड़े प्रवाह में फिट करने के लिए 3–6 माह की एक त्वरित रूपरेखा बनाएँ');

  // "let perfect kill good — ship version one" + variants
  out = out.replace(/let\s+perfect\s+kill\s+good(?:\s*—|\s*-\s*)\s*ship\s+version\s+one/gi,
                     'पूर्णता के लालच में अच्छे को मत मारें — संस्करण 1 जारी करें।');
  out = out.replace(/ship\s+version\s*1/gi, 'संस्करण 1 जारी करें');
  out = out.replace(/ship\s+version\s+one/gi, 'संस्करण 1 जारी करें');

  out = out.replace(/Before work, chant “?Om Gam Ganapataye”? ?21× for obstacle clearing/gi, 'कार्य से पहले “ॐ गं गणपतये” 21 बार जप करें — विघ्न शमन हेतु');
  out = out.replace(/At sunset, read a few names from Vishnu Sahasranama; offer chana dal\s*&\s*turmeric/gi, 'सूर्यास्त पर विष्णु सहस्रनाम के कुछ नाम पढ़ें; चना दाल और हल्दी अर्पित करें');
  out = out.replace(/Light a (?:pleasant )?fragrance; recite Sri Suktam or express gratitude for sufficiency/gi, 'सुगंधित धूप\/दीप जलाएँ; श्री सूक्त का पाठ करें या पर्याप्तता के लिए कृतज्ञता व्यक्त करें');
  out = out.replace(/Ship one starter task before lunch to unlock afternoon flow/gi, 'दोपहर भोजन से पहले एक प्रारंभिक काम पूरा करें ताकि दोपहर का प्रवाह खुले');
  out = out.replace(/At sunrise, face east and offer gratitude to the Sun; keep 2 minutes of stillness/gi, 'सूर्योदय पर पूर्वमुख होकर सूर्य को कृतज्ञता अर्पित करें; 2 मिनट शांत बैठें');
  out = out.replace(/At sunset, chant Hanuman Chalisa; keep conduct calm and fair/gi, 'सूर्यास्त पर हनुमान चालीसा जपें; आचरण शांत और न्यायपूर्ण रखें');
  out = out.replace(/In the evening, recite Hanuman Chalisa once; offer a little sesame oil/gi, 'संध्या में हनुमान चालीसा एक बार पढ़ें; थोड़ा तिल का तेल अर्पित करें');

  out = out.replace(/late-?night screens/gi, 'रात देर तक स्क्रीन');

  // OCR/LIGATURE & COMMON TYPO FIXES
  out = out.replace(/ईर्मेल/g, 'ईमेल');
  out = out.replace(/ईर्मानदार/g, 'ईमानदार');
  out = out.replace(/गमर्जोशी/g, 'गर्मजोशी');
  out = out.replace(/कायर्/g, 'कार्य');
  out = out.replace(/समयसीमाआें/g, 'समयसीमाओं');
  out = out.replace(/मानिसक/g, 'मानसिक');
  out = out.replace(/जनर्ल/g, 'जर्नल');
  out = out.replace(/अिपंत/g, 'अर्पित');
  out = out.replace(/पयार्प्तता/g, 'पर्याप्तता');
  out = out.replace(/सूयार्स्त/g, 'सूर्यास्त');
  out = out.replace(/सूयार्दय/g, 'सूर्योदय');
  out = out.replace(/संबंधाें/g, 'संबंधों');
  out = out.replace(/िरसाव/g, 'रिसाव');

  // GENERAL HINGLISH NORMALIZATIONS
  out = out.replace(/इनबॉक्स\s*ट्रिम/gi, 'इनबॉक्स साफ़ करें');
  out = out.replace(/ट्रिम/gi, 'छाँटें');

  out = out.replace(/परफेक्ट/gi, 'पूर्णता');
  out = out.replace(/\bगुड\b/gi, 'अच्छा');
  out = out.replace(/शिप/gi, 'जारी करें');
  out = out.replace(/वर्जन\s*वन/gi, 'संस्करण 1');
  out = out.replace(/माइक्रो[- ]स्किल/gi, 'सूक्ष्म कौशल');
  out = out.replace(/ग्राउंड/gi, 'स्थिर');
  out = out.replace(/ग्लो/gi, 'दीप्ति');

  // English tokens commonly leaking in bullets
  out = out.replace(/\bemail\b/gi, 'ईमेल');
  out = out.replace(/\binbox\b/gi, 'इनबॉक्स');

  // Collapse spaces/newlines
  out = out.replace(/\u00A0/g, ' ').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim();

  return out;
}

export function cleanHiList(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map(x => cleanHi(String(x ?? '')));
}
