export function policyAgent(lang='en'){
  const disclaimer =
    lang === 'hi'
      ? 'यह रिपोर्ट चिंतनशील ज्योतिषीय अंतर्दृष्टि और मान्यताएँ प्रस्तुत करती है। इसे सहायक मार्गदर्शन समझें, अंतिम भविष्यवाणी नहीं।'
      : 'Your report offers reflective astrological insights and beliefs. Treat it as supportive guidance, not an absolute prediction.';
  const thanks =
    lang === 'hi' ? 'धन्यवाद — टीम Astro-Baba.com'
                  : 'Thank you — Team Astro-Baba.com';
  return { disclaimer, thanks, footerBrand: 'Astro-Baba.com' };
}
