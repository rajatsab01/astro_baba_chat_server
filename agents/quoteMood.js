import { pick } from './utils.js';

const QUOTES = [
  '“What you do every day matters more than what you do once in a while.” — Gretchen Rubin',
  '“The best way out is always through.” — Robert Frost',
  '“Act as if what you do makes a difference. It does.” — William James',
  '“Energy flows where attention goes.” — Tony Robbins',
  '“Small deeds done are better than great deeds planned.” — Peter Marshall',
  '“Simplicity is the ultimate sophistication.” — Leonardo da Vinci',
  '“Well done is better than well said.” — Benjamin Franklin',
];
const AFFIRMATIONS = [
  'I move with calm focus and steady courage.',
  'I choose clarity, kindness, and consistent effort.',
  'I honour my energy and channel it wisely.',
  'I welcome good opportunities and act with grace.',
  'I am disciplined, patient, and quietly powerful.',
  'I make small steps that compound into big gains.',
];
const MOODS = [
  'Rise & shine — keep your heart light.',
  'Center and breathe — pace the day gently.',
  'Ground and glow — steady beats flashy.',
  'Open and kind — your warmth attracts support.',
  'Calm and clear — pick one thing and finish it.',
];

export function quoteMoodAgent(seed=0) {
  const quote = pick(QUOTES, seed + 31);
  const affirmation = pick(AFFIRMATIONS, seed + 63);
  const mood = pick(MOODS, seed + 95);
  const waterGlasses = 8 + ((seed >> 5) % 5); // 8..12
  return { quote, affirmation, mood, waterGlasses };
}
