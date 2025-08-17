// Reads the generated bank and provides persona-aware lines with rotation.
import bank from './contentBank.js';
import { hashCode } from './utils.js'; // you already have this

export function pickLang(lang) { return (lang==='hi' ? 'hi' : 'en'); }

export function personaAgent({ lang='en', persona='job_working', sign='aries', seedStr='' }) {
  const L = pickLang(lang);
  const p = bank?.daily?.byPersona?.[persona]?.[L] || bank?.daily?.generic?.[L] || { opportunities:[], cautions:[], remedy_addons:[] };

  // rotate with a seed (month + sign + persona + date) to avoid repetition
  const seed = hashCode(seedStr || `${bank.version}|${sign}|${persona}`);
  function rotate(arr, want) {
    if (!Array.isArray(arr) || arr.length===0) return [];
    const start = Math.abs(seed) % arr.length;
    const out = [];
    for (let i=0; i<Math.min(want, arr.length); i++) out.push(arr[(start+i) % arr.length]);
    return out;
  }

  return {
    closing: bank?.texts?.closing?.[L] || '',
    vedicNote: bank?.texts?.vedic_note?.[L] || '',
    daily: {
      opportunities: rotate(p.opportunities, 3), // pick 3 for daily
      cautions: rotate(p.cautions, 3),
      remedy_addons: rotate(p.remedy_addons, 1)
    },
    gemstone: bank?.gemstone?.bySign?.[sign] || null,
    mantra:   bank?.mantra?.bySign?.[sign] || null,
    weeklyIntro: bank?.weekly?.intro?.[L] || []
  };
}
