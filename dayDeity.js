// Weekday → deity pair + ritual (constant)
const DOW_INFO = {
  0: { en: { name: 'Sunday',    pair: 'Surya/Aditya',       ritual: 'Recite Aditya Hridayam; offer red flowers.' },
       hi: { name: 'रविवार',     pair: 'सूर्य/आदित्य',        ritual: 'आदित्य हृदय स्तोत्र; लाल पुष्प अर्पित करें।' } },
  1: { en: { name: 'Monday',    pair: 'Shiva/Som',          ritual: 'Chant “Om Namah Shivaya”; offer white rice or milk.' },
       hi: { name: 'सोमवार',     pair: 'शिव/सोम',             ritual: '“ॐ नमः शिवाय” जप; चावल/दूध अर्पित करें।' } },
  2: { en: { name: 'Tuesday',   pair: 'Hanuman/Mangal',     ritual: 'Recite Hanuman Chalisa; offer sindoor & jaggery.' },
       hi: { name: 'मंगलवार',    pair: 'हनुमान/मंगल',         ritual: 'हनुमान चालीसा; सिंदूर व गुड़ अर्पित करें।' } },
  3: { en: { name: 'Wednesday', pair: 'Ganesha/Budh',       ritual: 'Chant “Om Gam Ganapataye”; offer green moong.' },
       hi: { name: 'बुधवार',     pair: 'गणेश/बुध',            ritual: '“ॐ गं गणपतये नमः”; हरी मूंग अर्पित करें।' } },
  4: { en: { name: 'Thursday',  pair: 'Vishnu/Brihaspati',  ritual: 'Recite Vishnu Sahasranama; offer chana dal & turmeric.' },
       hi: { name: 'गुरुवार',     pair: 'विष्णु/बृहस्पति',      ritual: 'विष्णु सहस्रनाम; चना दाल व हल्दी अर्पित करें।' } },
  5: { en: { name: 'Friday',    pair: 'Lakshmi/Shukra',     ritual: 'Recite Sri Suktam; offer white sweets & fragrance.' },
       hi: { name: 'शुक्रवार',    pair: 'लक्ष्मी/शुक्र',        ritual: 'श्री सूक्त; सफ़ेद मिष्ठान व सुगंध अर्पित करें।' } },
  6: { en: { name: 'Saturday',  pair: 'Shani/Hanuman',      ritual: 'Chant Hanuman Chalisa; offer sesame oil & black til.' },
       hi: { name: 'शनिवार',     pair: 'शनि/हनुमान',           ritual: 'हनुमान चालीसा; तिल-तेल व काला तिल अर्पित करें।' } },
};

export function dayDeityAgent(weekdayIndex=0, lang='en'){
  const info = DOW_INFO[weekdayIndex] || DOW_INFO[0];
  return lang==='hi' ? info.hi : info.en;
}
