import { pick, pickN, signIndex } from './utils.js';

// Short daily leads
const LEADS = [
  'Today favors Momentum with crisp first steps. Your natural drive works best when anchored to one clear priority before noon.',
  'Today favors Clarity & Centering with a clean first move.',
  'Today favors Grounded Focus — fewer tabs, deeper attention.',
  'Today favors Listening & Patience — let inputs shape the next step.',
  'Today favors Strategic Planning — sketch the next 3–6 months.',
  'Today favors Relationship Warmth — short honest check-ins go far.',
  'Today favors Pragmatic Care — body, sleep, budgeting, tiny wins.',
  'Today favors Creative Spark — test a playful idea quickly.',
  'Today favors Learning — one micro-skill compounds quietly.',
  'Today favors Renewal & Cleanup — small resets make room for growth.',
  'Today favors Courageous Outreach — send that message/pitch.',
  'Today favors Stewardship & Savings — tighten one small leak.',
  'Today favors Health & Balance — pace yourself and hydrate.',
];

// Rotating actionable pools
const OPP_POOL = [
  'Ship one starter task before lunch to unlock afternoon flow.',
  'Touch base with a senior/mentor for a 30-sec checkpoint.',
  'Draft a quick 3–6-month outline so today fits a bigger arc.',
  'Do a 10-minute inbox trim to lower noise.',
  'Have one honest check-in with a key person.',
  'Make a tiny improvement to your budgeting/saving.',
  'Invest 20 minutes in a health micro-habit.',
  'Journal one page to clear mental fog.',
  'Learn one micro-skill you’ll reuse this week.',
  'Polish one thing already working instead of adding new.',
];
const CAUT_POOL = [
  'Don’t accept every request — protect a 2-hour deep-work block.',
  'Skip unplanned purchases sparked by mood.',
  'Avoid promising timelines you haven’t pressure-tested.',
  'Don’t overfill the calendar — leave white space.',
  'Limit multitasking during crucial work.',
  'Avoid late-night screens if you need an early start.',
  'Don’t let perfect kill good — ship version one.',
  'Beware emotional emails; sleep on them.',
];

// Weekday-tuned remedies
const REMEDY_MAP = {
  0: 'At sunrise, face east and offer gratitude to the Sun; keep 2 minutes of stillness.',
  1: 'At dusk, light a diya and chant “Om Namah Shivaya” 11×.',
  2: 'In the evening, recite Hanuman Chalisa once; offer a little sesame oil.',
  3: 'Before work, chant “Om Gam Ganapataye” 21× for obstacle clearing.',
  4: 'At sunset, read a few names from Vishnu Sahasranama; offer chana dal & turmeric.',
  5: 'Light a pleasant fragrance; recite Sri Suktam or express gratitude for sufficiency.',
  6: 'At sunset, chant Hanuman Chalisa; keep conduct calm and fair.',
};

export function varietyAgent({ sign='aries', seed=0, weekdayIndex=0 }) {
  const lead = pick(LEADS, seed + signIndex(sign) * 7);
  const opportunities = pickN(OPP_POOL, 3, seed + 101);
  const cautions      = pickN(CAUT_POOL, 3, seed + 211);
  const remedy        = REMEDY_MAP[weekdayIndex] || REMEDY_MAP[0];
  return { themeLead: lead, opportunities, cautions, remedy };
}
