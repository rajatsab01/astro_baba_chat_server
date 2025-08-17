// agents/familyAgent.js
const { getYearlyForUser } = require("./yearlyAgent");

function buildFamilySections(members, contentBank) {
  // members: [{ name, sign, persona, anchorDate }]
  return members.map(m => ({
    name: m.name,
    sign: m.sign,
    persona: m.persona,
    ...getYearlyForUser({ sign: m.sign, persona: m.persona, anchorDate: m.anchorDate, contentBank })
  }));
}

module.exports = { buildFamilySections };