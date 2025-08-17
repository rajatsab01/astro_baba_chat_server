// agents/yearlyAgent.js
// Builds Yearly data (Phase Blocks + 13 anchored months) from contentBank

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
];

function monthLabel(dt) {
  return `${MONTHS[dt.getMonth()]} ${dt.getFullYear()}`;
}

function addMonths(dt, n) {
  const d = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), 1));
  d.setUTCMonth(d.getUTCMonth() + n);
  return d;
}

function buildAnchoredMonths(anchorDateUtc, items13) {
  // Ensure 13 entries; pad if needed
  const items = [...items13];
  while (items.length < 13) items.push(items[items.length % items13.length]);

  return items.slice(0,13).map((item, idx) => {
    const dt = addMonths(anchorDateUtc, idx);
    const labelPrefix = monthLabel(dt);
    return {
      ...item,
      label: item.label?.includes("Anchor") ? `${labelPrefix} — ${item.label.split("—").pop().trim()}` : `${labelPrefix} — ${item.label || "Focus & Flow"}`
    };
  });
}

function getBucket(contentBank, sign, persona = "default") {
  const bySign = contentBank.yearly?.[sign?.toLowerCase?.()] || null;
  if (!bySign) return null;
  return bySign[persona] || bySign.default || null;
}

/**
 * @param {Object} params
 * @param {String} params.sign - zodiac sign in english (e.g., "aries")
 * @param {String} params.persona - one of personas or undefined
 * @param {String|Date} params.anchorDate - ISO date; anchoring to first day of that month (UTC)
 * @param {Object} params.contentBank - injected content bank
 */
function getYearlyForUser({ sign, persona, anchorDate, contentBank }) {
  if (!contentBank?.yearly) throw new Error("contentBank.yearly missing");
  const bucket = getBucket(contentBank, sign, persona);
  if (!bucket) throw new Error(`No yearly bucket for sign=${sign}`);

  const dateObj = new Date(anchorDate || new Date());
  const anchorUtc = new Date(Date.UTC(dateObj.getUTCFullYear(), dateObj.getUTCMonth(), 1));

  const months = buildAnchoredMonths(anchorUtc, bucket.months || []);
  const phaseBlocks = bucket.phaseBlocks || {
    good: [], caution: [], fun: [], gains: [], health: [], relationships: [], opportunities: [], remedies: []
  };

  return { phaseBlocks, months };
}

module.exports = { getYearlyForUser };