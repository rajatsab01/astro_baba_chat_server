// agents/occupationAgent.js
// Normalizes occupation/persona into one of our 5 buckets.

export function normalizePersona(raw) {
  if (!raw) return 'not_working';
  const s = String(raw).toLowerCase().trim();
  if (['self','self-employed','self_employed','business','freelance','freelancer','entrepreneur'].some(x => s.includes(x))) {
    return 'self_employed';
  }
  if (['job','working','employee','office','service','it','engineer','teacher'].some(x => s.includes(x))) {
    return 'job_working';
  }
  if (['home','homemaker','housewife','house wife','house-maker'].some(x => s.includes(x))) {
    return 'homemaker';
  }
  if (['student','college','school','university','study','studies'].some(x => s.includes(x))) {
    return 'student';
  }
  if (['not working','unemployed','break','career break','sabbatical','looking'].some(x => s.includes(x))) {
    return 'not_working';
  }
  return 'not_working';
}
