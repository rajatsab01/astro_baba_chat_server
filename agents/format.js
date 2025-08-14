import { dayDateHeaderUpper } from './utils.js';

export function greeting(lang='en'){ return lang==='hi' ? 'नमस्ते जी,' : 'Namaste ji,'; }

export function formatAgent({ lang='en', dateIST=new Date(), deityPair='Vishnu/Brihaspati' } = {}) {
  const dayHeader = dayDateHeaderUpper(lang, dateIST); // EN: CAPS, HI: natural
  const deitySentenceParts = {
    pre: lang==='hi' ? 'आज ' : 'Today being ',
    bold: deityPair,
    post: lang==='hi' ? ' दिवस है।' : ' day.'
  };
  return { dayHeader, deitySentenceParts };
}
