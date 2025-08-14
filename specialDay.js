import { toISTParts } from './utils.js';

// Fixed-date national/festival days (add more anytime)
// key: "MM-DD"
const FIXED_DAYS = {
  '01-01': { en: ['New Year’s Day', 'Fresh starts and clean intentions.'], hi: ['नववर्ष', 'नए संकल्प और शुभ आरंभ।'] },
  '01-26': { en: ['Republic Day (India)', 'Honour unity and civic virtue.'], hi: ['गणतंत्र दिवस', 'एकता और नागरिक धर्म का मान।'] },
  '08-15': { en: ['Independence Day (India)', 'Gratitude for freedom; act with responsibility.'], hi: ['स्वतंत्रता दिवस', 'स्वाधीनता का आभार; उत्तरदायित्व से कार्य करें।'] },
  '10-02': { en: ['Gandhi Jayanti', 'Simple living, high thinking—practice ahimsa today.'], hi: ['गाँधी जयंती', 'सादा जीवन, उच्च विचार—अहिंसा का अभ्यास।'] },
  '12-25': { en: ['Christmas', 'Peace and goodwill to all.'], hi: ['क्रिसमस', 'शांति और सद्भावना।'] },
  // Add more fixed observances here
};

export function specialDayAgent({ now=new Date(), lang='en', user=null } = {}) {
  const { ist } = toISTParts(now);
  const mm = String(ist.getMonth()+1).padStart(2,'0');
  const dd = String(ist.getDate()).padStart(2,'0');
  const key = `${mm}-${dd}`;

  // Birthday check
  let birthday = null;
  if (user?.dob) {
    // dob "YYYY-MM-DD"
    const parts = String(user.dob).split('-');
    if (parts.length >= 3) {
      const m2 = parts[1], d2 = parts[2];
      if (m2 === mm && d2 === dd) {
        birthday = lang==='hi'
          ? `जन्मदिन की हार्दिक शुभकामनाएँ${user.name ? ' ' + user.name : ''}! ईश्वर आपको स्वास्थ्य, समृद्धि और सौभाग्य दे।`
          : `Birthday blessings${user.name ? ', ' + user.name : ''}! Wishing you health, prosperity, and grace.`;
      }
    }
  }

  // Fixed day
  const fixed = FIXED_DAYS[key];
  const fixedMsg = fixed ? (lang==='hi' ? fixed.hi : fixed.en) : null;

  if (!birthday && !fixedMsg) return null;
  return {
    title: lang==='hi' ? 'विशेष दिवस' : 'Special Day',
    birthday, // string | null
    observance: fixedMsg ? { title: fixedMsg[0], line: fixedMsg[1] } : null
  };
}
