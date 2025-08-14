import { pick, signIndex } from './utils.js';

const COLORS_EN = ['saffron','leaf green','amber','turquoise','coral','royal blue','maroon','violet','silver','teal','indigo','crimson','pearl white','charcoal'];
const COLORS_HI = {
  'saffron':'केसरिया','leaf green':'पत्तियों जैसा हरा','amber':'अम्बर','turquoise':'फ़िरोज़ी','coral':'मूंगा',
  'royal blue':'रॉयल ब्लू','maroon':'मरून','violet':'बैंगनी','silver':'चांदी','teal':'टील','indigo':'नील',
  'crimson':'गहरा लाल','pearl white':'मोती-सा सफ़ेद','charcoal':'गहरा स्लेटी'
};

export function fortuneLineAgent({ sign='aries', ist=new Date(), seed=0, lang='en' } = {}) {
  const luckyNumber = ((ist.getDate() + signIndex(sign)) % 9) + 1;
  const colorEn = pick(COLORS_EN, seed + 17);
  const colorHi = COLORS_HI[colorEn] || colorEn;
  const luckyLine = lang==='hi'
    ? `भाग्यशाली रंग: ${colorHi}   भाग्यशाली अंक: ${luckyNumber}. महत्वपूर्ण कार्यों हेतु अभिजीत मुहूर्त का उपयोग करें; नई शुरुआत के लिए राहु काल से बचें।`
    : `Lucky color: ${colorEn}   Lucky number: ${luckyNumber}. Use Abhijit Muhurat for key actions; avoid Rahu Kaal for fresh launches.`;
  return { luckyNumber, luckyColor: lang==='hi' ? colorHi : colorEn, luckyLine };
}
