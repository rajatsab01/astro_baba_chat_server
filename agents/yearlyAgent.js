// agents/yearlyAgent.js

// Small date helpers (local to this module)
function startOfMonthUTC(d = new Date()) {
  const x = new Date(d);
  return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), 1));
}
function nearestAugStart(from = new Date()) {
  // if we're past Aug already, anchor at this year's Aug; otherwise last Aug
  const y = from.getUTCFullYear();
  const aug = new Date(Date.UTC(y, 7, 1)); // Aug index = 7
  return from >= aug ? aug : new Date(Date.UTC(y - 1, 7, 1));
}

// Month builder
function m(label, {
  outlook='', career='', money='', relationships='',
  healthConcerns='', healthTips='',
  learning='', travel='', opportunity='',
  protection='', checkpoint=''
} = {}) {
  return {
    label,
    outlook,
    career,
    money,
    relationships,
    health: { concerns: healthConcerns, tips: healthTips },
    learning,
    travel,
    opportunity,
    protection: { text: protection },
    checkpoint
  };
}

// Homemaker-focused 12 months (calm, clear, useful)
function homemakerMonths() {
  const months = [];

  // Aug
  months.push(m('Clean Start, Gentle Pace', {
    outlook:        'Declutter gently. Reset two daily anchors (wake, meal).',
    career:         'Home flow: 10-minute night tidy; weekly menu on the fridge.',
    money:          'Buy by list; review subscriptions; avoid shiny extras.',
    relationships:  'Small appreciation before requests.',
    healthConcerns: 'Irregular sleep.',
    healthTips:     'Early dinner; warm water; 10–15 min walk.',
    learning:       'One micro-course/video to improve a daily chore.',
    travel:         'Combine errands; prefer daylight.',
    opportunity:    'Old contact revives a useful lead.',
    protection:     '“Om Namah Shivaya” ×11 at dusk; start in Abhijit, avoid Rahu Kaal.',
    checkpoint:     'Are mornings calmer this week?'
  }));

  // Sep (sample month from Option D)
  months.push(m('Set a Calm Rhythm', {
    outlook:        'Begin with one small personal task, then settle household flow.',
    career:         'Simple weekly menu; 10-minute Sunday reset.',
    money:          'Buy by list; skip mood purchases.',
    relationships:  'A short “thank you” first; then requests.',
    healthConcerns: '',
    healthTips:     'Keep a water bottle visible; 15-minute evening walk.',
    learning:       'Two quick recipes; note cooker/OTG timings.',
    travel:         'Combine errands; protect mid-day for calls.',
    opportunity:    'A friendly neighbour tip saves weekly time.',
    protection:     'Morning “Om Gam Ganapataye Namah” ×11; three calm breaths. Use Abhijit for starts.',
    checkpoint:     'What one change will save 20 minutes this week?'
  }));

  // Oct (sample month from Option D)
  months.push(m('Care & Housekeeping Reset', {
    outlook:        'Use 25/5 focus blocks (25 work, 5 rest), three rounds.',
    career:         'Fix laundry day; tidy one corner daily.',
    money:          'Compare prices; one batch-cook to reduce outside food.',
    relationships:  'Keep promises realistic; speak gently and clearly.',
    healthConcerns: 'Neck/shoulders stiffness.',
    healthTips:     'Stretch; warm water; fixed sleep time.',
    learning:       'Simple home-budget notes; write small amounts.',
    travel:         'Short trips only; prefer home/library focus.',
    opportunity:    'A small daily fix makes the whole week easier.',
    protection:     'After sunset “Om Namah Shivaya” ×11; one-line gratitude.',
    checkpoint:     'Which small habit makes everything else easier today?'
  }));

  // Nov
  months.push(m('Flexible Plans', {
    outlook:        'Movement and changes — keep buffers.',
    career:         'Prepare a travel/outing checklist; confirm logistics.',
    money:          'Avoid impulse décor buys; hold big spends.',
    relationships:  'Keep plans flexible; inform early if plans shift.',
    healthConcerns: 'Fatigue from over-booking.',
    healthTips:     'One rest day per week; light meals on busy days.',
    learning:       'Short video learning during commute breaks.',
    travel:         'Short trips, meets, fests — pack light.',
    opportunity:    'Quick follow-ups and small collabs click.',
    protection:     'Morning “Om Gam Ganapataye Namah” ×21; travel light.',
    checkpoint:     'Did I leave buffer around busy days?'
  }));

  // Dec
  months.push(m('Warm Family Window', {
    outlook:        'Gentle warmth and togetherness.',
    career:         'Home corners: one shelf, one drawer; label & store.',
    money:          'Gifts within budget; prioritize shared meals over stuff.',
    relationships:  'Short, kind check-ins; appreciation first.',
    healthConcerns: 'Late nights.',
    healthTips:     'Wind-down routine; herbal tea; soft lights.',
    learning:       'Family recipe or tradition notes.',
    travel:         'Local visits; light schedules.',
    opportunity:    'Cooperative work vibe; plan one simple gathering.',
    protection:     'Evening gratitude; diya for 2 minutes.',
    checkpoint:     'What makes home feel warmer this month?'
  }));

  // Jan
  months.push(m('Gentle Discipline', {
    outlook:        'New year, small steps only.',
    career:         'Checklist for mornings; weekly planning on Sunday.',
    money:          'Track basics; avoid subscriptions creeping back.',
    relationships:  'One promise at a time; keep it.',
    healthConcerns: 'Sleep rhythm.',
    healthTips:     'Consistent lights-out; light strength + walk.',
    learning:       'Read 10 pages/day or 10-min video.',
    travel:         'Errands in one loop; avoid late returns.',
    opportunity:    'A mentor-type nudge helps direction.',
    protection:     '“Om Namah Shivaya” ×11; keep evenings quiet.',
    checkpoint:     'Which routine stayed steady 2+ weeks?'
  }));

  // Feb
  months.push(m('Route Corrections', {
    outlook:        'Adjust without drama; it’s a course correction.',
    career:         'Review tools; drop one app creating clutter.',
    money:          'Re-check forms/payments; keep copies.',
    relationships:  'Share changes early; invite simple help.',
    healthConcerns: 'Travel/lifestyle disruptions.',
    healthTips:     'Hydration; stretch after rides.',
    learning:       'Short refreshers; simple checklists.',
    travel:         'Keep tickets & IDs ready; double-check times.',
    opportunity:    'Quick follow-ups land well.',
    protection:     '“Om Gam Ganapataye Namah” ×21; buffers on plans.',
    checkpoint:     'What got simpler after this change?'
  }));

  // Mar
  months.push(m('Family First', {
    outlook:        'Warm, cooperative tone.',
    career:         'Share chores fairly; use a visible roster.',
    money:          'Plan groceries weekly; avoid waste.',
    relationships:  'Praise publicly, correct privately.',
    healthConcerns: '',
    healthTips:     'Walk after dinner; sunlight in the morning.',
    learning:       'A small parenting/home course or article series.',
    travel:         'Local picnics; early returns.',
    opportunity:    'Teamwork improves; one joint task completes.',
    protection:     'Evening gratitude; small diyas on Fridays.',
    checkpoint:     'What tiny habit made family calmer?'
  }));

  // Apr
  months.push(m('Depth over Spread', {
    outlook:        'Do less, do it well.',
    career:         'One focus area; fewer meetings, more reading.',
    money:          'Pause large purchases; maintain tools.',
    relationships:  'Say no kindly to over-commitments.',
    healthConcerns: 'Mental clutter.',
    healthTips:     'Longer focus blocks; short breaks outdoors.',
    learning:       'Read a booklet/guide fully.',
    travel:         'Local only; avoid new starts on rush days.',
    opportunity:    'Clarity grows when distractions drop.',
    protection:     'Sunset “Om Namo Narayanaya” ×11.',
    checkpoint:     'What did I remove to focus better?'
  }));

  // May
  months.push(m('Calm Numbers', {
    outlook:        'Resources and negotiations steady.',
    career:         'Organize bills/warranties; label folders.',
    money:          'Compare calmly; ask for fair quotes.',
    relationships:  'Discuss budgets kindly.',
    healthConcerns: '',
    healthTips:     'Light dinners; steady water.',
    learning:       'Learn one money/household tool.',
    travel:         'Errands grouped; noon calls for offices.',
    opportunity:    'Present calmly (portfolio, proposal).',
    protection:     'Friday gratitude + “Om Shreem Mahalakshmiyei Namah” ×11.',
    checkpoint:     'Which monthly bill can reduce 5–10%?'
  }));

  // Jun
  months.push(m('Clean Closures', {
    outlook:        'Wrap-ups, backups, letting go.',
    career:         'Archive neatly; label boxes; donate unused.',
    money:          'Close pending refunds/dues.',
    relationships:  'Thank-you messages for help received.',
    healthConcerns: 'Over-tiredness from pushy schedules.',
    healthTips:     'One full rest day; gentle stretches.',
    learning:       'Learn one backup/organizing habit.',
    travel:         'Short, purposeful trips.',
    opportunity:    'Space opens when clutter leaves.',
    protection:     'Keep starts light; avoid big launches.',
    checkpoint:     'What did I archive or donate this month?'
  }));

  // Jul
  months.push(m('Fresh Seeds', {
    outlook:        'Begin softly; pilot, then learn.',
    career:         'Tiny v1s at home: new shelf, new routine.',
    money:          'Plan simple budgets for the quarter.',
    relationships:  'Plan one family evening per week.',
    healthConcerns: '',
    healthTips:     'Morning light; easy movement.',
    learning:       'One short skill adds daily ease.',
    travel:         'Local exploration; note timings.',
    opportunity:    'A small pilot shows what to keep.',
    protection:     'Start in Abhijit; close the day with gratitude.',
    checkpoint:     'What seed did I plant for next quarter?'
  }));

  // Ensure 12
  return months.slice(0, 12);
}

export async function getYearlyForUser({
  sign = 'aries',
  persona = 'homemaker',
  anchorDate = null,
  lang = 'en'
} = {}) {
  const anchor = startOfMonthUTC(anchorDate ? new Date(anchorDate) : nearestAugStart());

  // Holistic Overview + meta (Option D final, neutral—no hard-coded name)
  const meta = {
    holisticOverview:
      'This period begins with gentle cleanup and small starts. Momentum builds through simple steps, steady feedback, and patient improvement. Saturn rewards tidy routines, written checklists, and promises kept. Jupiter supports learning, mentors, and ethical clarity. Rahu may bring two change pulses in mid-winter—treat them as course corrections, not crises. Late year is warm and family-centred; early spring is ideal for care, maintenance, and re-centering habits. April asks for depth over spread. May steadies numbers and discussions. June is for wrap-ups and lightening your load. July begins fresh seeds with a soft pilot. Choose good timing (prefer Abhijit Muhurat, avoid Rahu Kaal), use brief mantras to protect transitions, and keep to small, regular steps.',
    vedicSciences: [
      'Mars favours initiative; Saturn rewards tidy routines; Jupiter supports learning/mentors; Rahu/Ketu bring adjustments—double-check steps.'
    ],
    numerologyArc: [
      "Apr ’25–Apr ’26: creative, communicative.",
      "Apr ’26–Apr ’27: systems, foundations."
    ],
    summary:
      'A communicative, steady year that benefits from small, regular actions and simple, reliable systems. Two change pulses in mid-winter; a warm family window around year-end; resources clarify in late spring.',
    planetHighlights: [
      'Saturn emphasizes habits, documentation, promises kept → use checklists, weekly reviews.',
      'Jupiter expands teachers/learning, ethical clarity → short course, mentor check-ins.',
      'Rahu/Ketu = adjustments, route changes → plan buffers, confirm logistics, travel light.',
      'Fast movers (Sun/Mercury/Venus/Mars) set monthly micro-tones → see monthly guidance.'
    ],
    favorableWindows: [
      'Prefer Abhijit Muhurat for starts; avoid Rahu Kaal for new beginnings.',
      'Mon/Thu for study & proposals, Tue/Sat for hard tasks/admin, Fri for relationships.',
      'Start important calls mid-day; if needed, sign calmly after sunset.'
    ],
    newOpportunities: [
      'Sep 2025: mentor nudge.',
      'May 2026: resource clarity (fees/tools/budgets).'
    ],
    remediesMantras: [
      'Launch: Abhijit start; evening gratitude + “Om Namah Shivaya” ×11.',
      'Change months (Nov/Feb): morning “Om Gam Ganapataye Namah” ×21; keep buffers.',
      'Study/Depth (Apr): sunset “Om Namo Narayanaya” ×11; longer focus blocks.',
      'Wealth/Negotiation (May): Friday gratitude + “Om Shreem Mahalakshmiyei Namah” ×11.'
    ],
    gemstoneNote:
      'We do not suggest stones here. For any gemstone guidance, please open the Gemstone Report on the home screen. 🙏',
    notesCare: [
      'Auspicious timing: prefer Abhijit Muhurat for important starts; avoid Rahu Kaal for new beginnings.',
      'Timing approximation: windows assume a six-o’clock sunrise and a twelve-hour day; local times vary by place and season.',
      'Gentle reminder: this roadmap is reflective guidance—supportive wisdom, not an absolute prediction. A positive mindset amplifies benefits.',
      'For greater precision: if you wish to refine further, consider verifying your birth chart with a trusted astrologer; a careful chart reading may improve accuracy further.'
    ]
  };

  // Phase blocks (Option D)
  const phaseBlocks = {
    good: [
      'Sep 2025, Jul 2026: fresh starts feel smooth; simple first versions settle well.',
      'May 2026: numbers and discussions line up; negotiations calmer.',
      'Dec 2025, Mar 2026: family warmth; cooperative work vibe.'
    ],
    caution: [
      'Nov 2025, Feb 2026: movement/change; verify forms and travel; avoid over-booking.',
      'Apr 2026: depth over spread; narrow focus.',
      'Jun 2026: closures & handovers; do not start big.'
    ],
    fun: [
      'Nov 2025, Feb 2026: short trips, meets, simple gatherings—keep plans flexible.'
    ],
    gains: [
      'May 2026: calm presentation (proposal, home plan).',
      'Sep 2025, Feb 2026: quick follow-ups; small collaborations click.'
    ],
    health: [
      'Oct 2025, Jan 2026: steady sleep window, warm water, gentle walk/strength; protect neck/shoulders.'
    ],
    relationships: [
      'Dec 2025, Mar 2026: short, kind check-ins; appreciation first.'
    ],
    opportunities: [
      'Sep 2025: mentor nudge.',
      'May 2026: resource clarity (fees/tools/budgets).'
    ],
    remedies: [
      'Launch: Abhijit start; evening gratitude + “Om Namah Shivaya” ×11.',
      'Change months (Nov/Feb): morning “Om Gam Ganapataye Namah” ×21; keep buffers.',
      'Study/Depth (Apr): sunset “Om Namo Narayanaya” ×11; longer focus blocks.',
      'Wealth/Negotiation (May): Friday gratitude + “Om Shreem Mahalakshmiyei Namah” ×11.'
    ]
  };

  const months = homemakerMonths();
  return { anchor, meta, phaseBlocks, months };
}

export default { getYearlyForUser };
