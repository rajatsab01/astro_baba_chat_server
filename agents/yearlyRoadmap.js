// agents/yearlyRoadmap.js
import contentBank from './contentBank.js';
import { capSign, toISTParts, hashCode } from './utils.js';
import { normalizePersona } from './occupationAgent.js';

// Fixed 5 personas we support
const PERSONAS = ['self_employed','job_working','not_working','homemaker','student'];

// Month labels like "AUG 2025"
function monthLabel(d) {
  return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).toUpperCase();
}

// Simple, persona-aware phrasing helpers
function personaHint(persona, bucket) {
  // small flavor depending on persona and topic bucket
  const P = persona || 'not_working';
  const H = {
    studies: {
      student: 'Focus hours earlier in the day work best.',
      homemaker: 'Learn in short, consistent sessions amid home flow.',
      self_employed: 'Micro-learning that ties directly to revenue.',
      job_working: 'Skill-up aligned to current role.',
      not_working: 'Gentle, curiosity-led learning.',
    },
    money: {
      student: 'Budget tools, course fees, and small subscriptions.',
      homemaker: 'Household budgeting and mindful shopping.',
      self_employed: 'Cashflow buffers, invoicing clarity.',
      job_working: 'Salary add-ons, subscriptions, certifications.',
      not_working: 'Keep it simple; tiny buffer helps.',
    },
    travel: {
      student: 'Keep documents handy and rest well.',
      homemaker: 'Plan around family routines.',
      self_employed: 'Combine errands to save time/money.',
      job_working: 'Purposeful trips with buffers.',
      not_working: 'Short, refreshing visits are enough.',
    }
  };
  return (H[bucket] && H[bucket][P]) || '';
}

const PROTECTION = {
  ganesha: 'Om Gam Ganapataye Namah',
  shiva: 'Om Namah Shivaya',
  lakshmi: 'Om Shreem Mahalakshmiyei Namah',
  narayan: 'Om Namo Narayanaya',
  saraswati: 'Om Aim Saraswatyai Namah',
};

// Option-2 builder (Phase Blocks)
function buildOption2({ sign, lang, persona }) {
  const sCap = capSign(sign);
  const personaLine = {
    self_employed: 'independent work and steady systems',
    job_working: 'responsibilities and quiet, compounding wins',
    homemaker: 'care, coordination, and peaceful spaces',
    student: 'study rhythm and simple presentations',
    not_working: 'gentle resets and hopeful steps'
  }[persona];

  return {
    header: `Holistic Overview`,
    zodiac: `${sCap}: pioneering, energetic, direct; learns fast when action is paired with structure.`,
    vedic: `Mars supports initiative; periodic “slow-and-review” phases ask for patience and tidy routines.`,
    numerology: `A communicative, creative arc that favors consistent practice and clear presentations.`,
    summary: `A communicative, creative year with periodic structure sprints and two change waves in the middle and late winter. Family/friends warmth peaks around year end and early spring. Money matters respond to calm planning mid-year, tailored for ${personaLine}.`,
    good: [
      'Sep 2025, Jul 2026: new starts feel smooth; small launches shine.',
      'May 2026: resources window — good for applications, budgets, or negotiations.',
      'Dec 2025, Mar 2026: harmony at home; supportive environment.'
    ],
    caution: [
      'Nov 2025, Feb 2026: movement & change — verify forms/travel; avoid over-commitment.',
      'Apr 2026: deep work beats expansion; keep focus narrow.',
      'Jun 2026: finish and let go before fresh starts.'
    ],
    fun: [
      'Nov 2025, Feb 2026: short trips and meets — keep plans flexible.'
    ],
    gains: [
      'May 2026: present calmly; clear schedules and numbers.',
      'Sep 2025, Feb 2026: quick follow-ups and small collaborations click.'
    ],
    letgo: [
      'Jun 2026: declutter notes/devices; donate old material; archive neatly.'
    ],
    health: [
      'Oct 2025, Jan 2026: sleep rhythm, hydration, gentle strength/walks; avoid extremes.'
    ],
    relationships: [
      'Dec 2025, Mar 2026: short, honest check-ins; small gestures matter.'
    ],
    opportunities: [
      'Mentor guidance/creative collabs in Sep 2025; resource clarity in May 2026.'
    ],
    remedies: [
      'Launch: start in a favorable midday window; avoid inauspicious periods.',
      `Change months: morning Protection — “${PROTECTION.ganesha}”.`,
      `Closure: dusk calm — “${PROTECTION.shiva}” + one-line gratitude.`
    ]
  };
}

// Month skeleton builder (Option-3)
function buildMonth({ d, persona, sign }) {
  const label = monthLabel(d);
  const seed = hashCode(`${sign}|${persona}|${label}`);
  const rand = (mod) => Math.abs(seed % mod);

  // Simple tone rotation
  const tones = [
    'Clean Start, Gentle Pace',
    'Momentum with Clarity',
    'Health & Discipline Reset',
    'Change & Movement',
    'Home & Harmony',
    'Refine & Rebuild Routines',
    'Open Doors & Outreach',
    'Care & Maintenance',
    'Study & Depth',
    'Negotiation & Resources',
    'Wrap & Release',
    'Fresh Seeds'
  ];
  const tone = tones[rand(tones.length)];

  // Persona-aware hints:
  const learnHint = personaHint(persona, 'studies');
  const moneyHint = personaHint(persona, 'money');
  const travelHint= personaHint(persona, 'travel');

  // Pick a protection line based on tone
  let prot = PROTECTION.shiva;
  if (/Change|Open Doors|Movement/i.test(tone)) prot = PROTECTION.ganesha;
  if (/Harmony|Resources/i.test(tone)) prot = PROTECTION.lakshmi;
  if (/Study|Clarity/i.test(tone)) prot = PROTECTION.saraswati;
  if (/Depth|Narayan/i.test(tone)) prot = PROTECTION.narayan; // rare

  // Health concerns + diet nudge
  const health = (() => {
    if (/Health|Discipline|Refine|Reset/i.test(tone)) {
      return 'Watch sleep and neck/eye strain; prefer warm water, soups/khichdi; add greens/lentils; limit late caffeine.';
    }
    if (/Change|Movement|Open Doors/i.test(tone)) {
      return 'Travel/stress can tighten shoulders; hydrate; avoid heavy roadside food; carry nuts/fruit.';
    }
    if (/Home|Harmony|Care/i.test(tone)) {
      return 'Festival/comfort foods: keep portions moderate; evening walk; warm water after meals.';
    }
    return 'Keep a steady sleep window; 20-minute walk; prefer home-cooked over deep fried.';
  })();

  // Build month block
  return {
    label,                     // e.g., "AUG 2025"
    title: tone,               // e.g., “Momentum with Clarity”
    outlook: 'Cooperate, simplify, and begin each day with one meaningful task.',
    career: 'Present clean drafts; ask for clarity; polish systems before expanding.',
    money: `Keep budgets simple; avoid impulse tools. ${moneyHint}`,
    relationships: 'Short, honest, kind check-ins; gentle tone in messages.',
    health,                    // concerns + diet/care lens
    learning: `Pick one micro-module and repeat. ${learnHint}`,
    travel: `Short/local is fine; keep buffers; documents ready. ${travelHint}`,
    opportunity: 'A small collaboration or helpful contact may appear.',
    protection: prot,          // full mantra string
    checkpoint: 'What tiny action proves progress this week?'
  };
}

// Main export
export function buildYearlyRoadmap({ sign='aries', lang='en', persona='not_working', startDate=null } = {}) {
  const p = normalizePersona(persona);
  const now = startDate ? new Date(startDate) : new Date();
  // Make an IST-aligned copy for month stepping
  const { ist } = toISTParts(now);
  ist.setDate(1); // from 1st of current month

  // Option-2 Phase Blocks
  const option2 = buildOption2({ sign, lang, persona: p });

  // Option-3 13 months
  const months = [];
  for (let i = 0; i < 13; i++) {
    const d = new Date(ist);
    d.setMonth(ist.getMonth() + i);
    months.push(buildMonth({ d, persona: p, sign }));
  }

  // Notes (closing & vedic note from contentBank if present)
  const closing = (contentBank?.closing?.[lang]) || (contentBank?.closing?.en) ||
    'Have a blessed day!! We wish you a very cheerful, prosperous and wonderful day ahead with lots of blessings...';
  const vedicNote = (contentBank?.vedicNote?.[lang]) || (contentBank?.vedicNote?.en) ||
    'Note: Vedic windows use a 6:00 AM sunrise and 12-hour day approximation — actual times vary by location/season.';

  return { option2, months, notes: { closing, vedicNote } };
}
