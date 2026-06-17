// Christina's Daily Cycle Briefing Calculator
// Run: node cycle_briefing.mjs [YYYY-MM-DD]
// Profile: Sun Leo · Moon Scorpio · Ascendant Libra · HD Projector 2/4 Splenic
// Goal: Preconception preparation for 4th child

import { getDailyQuote, getDailySutra } from "./quotes.mjs";

const CYCLE_START = new Date('2026-05-02T00:00:00-04:00');
const CYCLE_LENGTH = 27;
const PERIOD_LENGTH = 6;

const MOON_PHASES_2026 = [
  { date: '2026-04-01', phase: 'Full', sign: 'Libra' },
  { date: '2026-04-10', phase: 'ThirdQuarter', sign: 'Capricorn' },
  { date: '2026-04-17', phase: 'New', sign: 'Aries' },
  { date: '2026-04-23', phase: 'FirstQuarter', sign: 'Leo' },
  { date: '2026-05-01', phase: 'Full', sign: 'Scorpio' },
  { date: '2026-05-09', phase: 'ThirdQuarter', sign: 'Aquarius' },
  { date: '2026-05-16', phase: 'New', sign: 'Taurus' },
  { date: '2026-05-23', phase: 'FirstQuarter', sign: 'Virgo' },
  { date: '2026-05-31', phase: 'Full', sign: 'Sagittarius' },
  { date: '2026-06-08', phase: 'ThirdQuarter', sign: 'Pisces' },
  { date: '2026-06-14', phase: 'New', sign: 'Gemini' },
  { date: '2026-06-21', phase: 'FirstQuarter', sign: 'Libra' },
  { date: '2026-06-29', phase: 'Full', sign: 'Capricorn' },
];

const MOON_SIGN_DATES = [
  { from: '2026-04-10', sign: 'Aquarius' },
  { from: '2026-04-12', sign: 'Pisces' },
  { from: '2026-04-15', sign: 'Aries' },
  { from: '2026-04-17', sign: 'Taurus' },
  { from: '2026-04-20', sign: 'Gemini' },
  { from: '2026-04-22', sign: 'Cancer' },
  { from: '2026-04-24', sign: 'Leo' },
  { from: '2026-04-27', sign: 'Virgo' },
  { from: '2026-04-29', sign: 'Libra' },
  { from: '2026-05-01', sign: 'Scorpio' },
  { from: '2026-05-04', sign: 'Sagittarius' },
  { from: '2026-05-06', sign: 'Capricorn' },
  { from: '2026-05-08', sign: 'Aquarius' },
  { from: '2026-05-11', sign: 'Pisces' },
  { from: '2026-05-13', sign: 'Aries' },
  { from: '2026-05-16', sign: 'Taurus' },
  { from: '2026-05-18', sign: 'Gemini' },
  { from: '2026-05-20', sign: 'Cancer' },
  { from: '2026-05-23', sign: 'Leo' },
  { from: '2026-05-25', sign: 'Virgo' },
  { from: '2026-05-27', sign: 'Libra' },
  { from: '2026-05-30', sign: 'Scorpio' },
];

const MOON_SIGN_MEANINGS = {
  Aries: 'bold and initiating — good for starting new things and asserting your needs',
  Taurus: 'sensual and grounding — lean into nourishment, pleasure, and slow presence',
  Gemini: 'curious and communicative — good for conversation, writing, and ideas',
  Cancer: 'emotional and nurturing — feelings are amplified today, honour what surfaces',
  Leo: 'expressive and playful — good for creativity, joy, and being seen',
  Virgo: 'analytical and health-focused — good for routines, refinement, and detail work',
  Libra: 'relational and balancing — good for harmony, beauty, and partnerships',
  Scorpio: 'deep and transformative — old patterns may surface for release',
  Sagittarius: 'expansive and free — good for big-picture thinking and seeking meaning',
  Capricorn: 'disciplined and grounded — good for structure, ambition, and long-term plans',
  Aquarius: 'innovative and collective — good for community, original thinking, and detachment',
  Pisces: 'dreamy and dissolving — good for rest, spiritual work, creativity, and letting go',
};

// O.W. daily work focus — sourced directly from Christina's cycle tracking sheet
const OW_DAILY = {
  1:  { focus: 'Meditation & letting go. Touch base with your authentic self. Drop baggage.', taskType: 'Inner work only. No decisions, no new projects. Journal, rest, dream.', cognitive: 'Right brain / intuitive — visioning, not analysing.' },
  2:  { focus: 'Rediscover fulfillment. Re-evaluate priorities. Internal list.', taskType: 'Reflective review. What matters, what doesn\'t. Shed shoulds.', cognitive: 'Right brain — big picture, values-led thinking.' },
  3:  { focus: 'Shoulds to coulds. Identify pressure sources. Letting go of resistance.', taskType: 'Journalling. Identify where you\'re forcing. No output work.', cognitive: 'Intuitive + emotional — trust what surfaces.' },
  4:  { focus: 'Discovering resistance. Take a new direction.', taskType: 'Sit with what keeps coming up. New perspective only — no action yet.', cognitive: 'Incubation mode — ideas percolating below the surface.' },
  5:  { focus: 'Reviewing, reflecting, getting an overview.', taskType: 'Review progress. Check on bigger goals. Light admin ok.', cognitive: 'Synthesis — pulling threads together, not launching new ones.' },
  6:  { focus: 'Set up for the Dynamic phase. Choose adventures. Target action. Focus energy.', taskType: 'Light planning only. Identify 1-3 priorities for the week ahead. No execution yet.', cognitive: 'Transitioning — bridge between inner and outer.' },
  7:  { focus: 'Dynamic phase begins! New energy — catch up on tasks.', taskType: 'Clear the backlog. Emails, admin, catch-up tasks. Momentum building.', cognitive: 'Left brain rising — analytical, organised, task-oriented.' },
  8:  { focus: 'Planning and analysis.', taskType: 'Strategic planning, research, analysis. Excellent for deep focus work.', cognitive: 'Left brain peak — data, details, decisions.' },
  9:  { focus: 'Starting projects. Push yourself. New learning.', taskType: 'Start something new. Learn a skill. Push into harder tasks.', cognitive: 'Analytical + curious — absorb new information fast.' },
  10: { focus: 'Individual empowerment. Thought power. Focusing on yourself.', taskType: 'Work that builds your capabilities or platform. Solo focused work.', cognitive: 'Confident and capable — tackle what you\'ve been avoiding.' },
  11: { focus: 'Positivity and focusing on what you enjoy.', taskType: 'Work you love. Creative projects, client work that energises you.', cognitive: 'Peak focus + enthusiasm — do the work that lights you up.' },
  12: { focus: 'Righting wrongs. Being a champion.', taskType: 'Difficult conversations, advocacy, standing up for something.', cognitive: 'Whole-brain — courage + clarity combined.' },
  13: { focus: 'Reaching out. Nurturing your projects. Feeling comfortable at work.', taskType: 'Collaboration, networking, checking in on ongoing work. Connect with others.', cognitive: 'Social brain — empathy and connection at their best.' },
  14: { focus: 'Expressive phase: Building confidence. Positive daydreaming. Recognising your success.', taskType: 'Visibility work: presenting, pitching, publishing, leading. Show up and be seen.', cognitive: 'Whole-brain integration — best day for presentations, negotiations, big moves.' },
  15: { focus: 'Communication. Accepting yourself. Multiple viewpoints.', taskType: 'Client calls, collaborative work. Evaluate and discuss, don\'t decide alone.', cognitive: 'Still strong — good for listening and synthesis.' },
  16: { focus: 'Expressing appreciation. Enjoying what you have.', taskType: 'Gratitude practice. Acknowledge what\'s working. Light, positive output work.', cognitive: 'Emotional intelligence heightened — good for heartfelt communication.' },
  17: { focus: 'Compromise and balance. Harmonising your space. Creating win-wins.', taskType: 'Conflict resolution, mediation, team dynamics. Remove blocks.', cognitive: 'Relational thinking — seeing all sides clearly.' },
  18: { focus: 'Persuasion and networking. Being social. Goal-oriented networking.', taskType: 'Outreach, sales conversations, social media, community building.', cognitive: 'Charismatic and expressive — use it for relationship-building.' },
  19: { focus: 'Selling ideas and presenting new concepts.', taskType: 'Pitch, present, sell your vision. Last strong window before energy turns inward.', cognitive: 'Creative + articulate — bridge between expressive and creative phases.' },
  20: { focus: 'Organising the week ahead. Optimising resources.', taskType: 'Creative phase begins: Admin, planning, scheduling. Set up systems.', cognitive: 'Right brain rising — creative, pattern-seeing, systems thinking.' },
  21: { focus: 'Creative phase: Creative breaks. Apply creative flair to work.', taskType: 'Creative projects, brainstorming, physical creative work (art, writing, making).', cognitive: 'Right brain dominant — divergent thinking, creative leaps.' },
  22: { focus: 'Seeding the subconscious. Brainstorming. Looking for synchronicity.', taskType: 'Free-write, mind-map, capture ideas without filtering. Let the unconscious speak.', cognitive: 'Deep creative — follow the threads, don\'t force structure.' },
  23: { focus: 'Doing the small stuff. Nurture yourself. Small steps.', taskType: 'Bite-sized tasks only. Tick off small items. Don\'t attempt big projects.', cognitive: 'Fragmented attention is normal — work with it, not against it.' },
  24: { focus: 'Creating free time. Prioritising. Schedule solutions.', taskType: 'Clear and simplify your calendar. Protect time for the approaching inner season.', cognitive: 'Discernment — ruthlessly prioritise what actually matters.' },
  25: { focus: 'Slowing down. Being realistic. Allocating more time to things.', taskType: 'Reduce scope. Give yourself more time than you think you need. No new launches.', cognitive: 'Right brain / emotional — truth-telling, not production.' },
  26: { focus: 'Clearing the decks. Clear emotionally and physically.', taskType: 'Tie up loose ends. Clear inbox, clear space, clear what\'s unresolved.', cognitive: 'Releasing mode — completion, not initiation.' },
  27: { focus: 'Listening to your needs. Focus on underlying needs. Take nothing personally.', taskType: 'Minimal work. Protect yourself. Notice what your body and emotions need.', cognitive: 'Heightened sensitivity — honour it as information, not obstacle.' },
};

// Human Design Projector guidance by cycle phase + day
const HD_PROJECTOR_DAILY = {
  // Menstrual (1-6): Mandatory recharge — no guilt
  1: 'Projector rest day. This is not optional — it is your biological and energetic reset. No sacral energy = deep depletion risk if you push today. Honour it fully.',
  2: 'Withdraw further if possible. 2/4 Hermit line: you need solo time to process. What came up in the last cycle? Let it integrate.',
  3: 'Splenic hits may surface now — flashes of knowing about what isn\'t working. Note them but don\'t act yet.',
  4: 'Still in hermit mode. Your 4th line network will come back when you\'re ready. Rest without explaining yourself.',
  5: 'Energy beginning to return. Review: where were you trying to generate like a Generator last cycle? Where did bitterness show up?',
  6: 'Transitioning out. Light preparation for what\'s coming. What invitations feel alive? Don\'t chase — notice.',
  // Follicular (7-13): Study, master, wait for invitations
  7: 'Dynamic phase begins. Projector window: study and master. Deepen your expertise. Invitations will come to those who are ready.',
  8: 'Excellent day for deep research and skill-building. Your penetrating Projector perception is sharp. Analyse systems.',
  9: 'Gate 57 (Intuition/Splenic Clarity) is part of your cross — trust the in-the-moment hits today. They are accurate.',
  10: 'Your 2/4 profile: the Hermit has a gift they don\'t always know they have. What are others seeing in you? Follow curiosity.',
  11: 'Networking day for your 4th line. Reach out within your existing network — opportunities come through relationship, not cold outreach.',
  12: 'Gate 53 (Beginnings) is in your cross — you have a gift for initiating cycles. Where is something ready to begin through you?',
  13: 'Pre-ovulation: your receptivity to invitations is highest. Be visible. Let yourself be seen and recognised.',
  // Ovulatory (14): Accept invitations, full visibility
  14: 'Expressive phase. For Projectors: this is your window to ACCEPT invitations and show up fully. Don\'t hide. Your signature is Success — claim it today.',
  // Luteal (15-27): Wind down, Splenic assessment, creative
  15: 'Use your Splenic authority: assess what has felt correct this cycle. The Spleen doesn\'t explain — it just knows.',
  16: 'Creative phase for Projectors means inner-directed mastery. What do you want to go deeper into?',
  17: 'Gate 51 (Shock/Initiation) in your cross: you are designed to meet challenges and initiate others into awareness. What shocks or surprises you today is data.',
  18: 'Your penetrating Projector perception is heightened. You\'ll see what others can\'t. Journal what you notice.',
  19: 'Last outward energy window. What needs to be communicated before you turn inward?',
  20: 'Turning inward. Begin clearing your energy field. Projectors absorb others\' energy — time for energetic hygiene.',
  21: 'Creative deep work. Solo projects that express your mastery. This is what the Hermit (line 2) does best.',
  22: 'Gate 54 (Ambition/Ascension): your drive is real, but it must be channelled through recognition. Who needs to see this work?',
  23: 'Rest is productive for Projectors. Watching, waiting, receiving is your genius — not doing.',
  24: 'Simplify. Projectors can\'t sustain what Generators can. What can you release from your plate?',
  25: 'Protect your aura. Be selective about who and what you take in. Your empathic perception amplifies late luteal.',
  26: 'Clear and close. What invitations are you waiting for? Release what isn\'t coming.',
  27: 'Deepest rest before the next cycle begins. Honour this threshold. What is complete? What are you ready to be seen for next cycle?',
};

// Preconception biohacking by cycle phase + day
const FERTILITY_DAILY = {
  1:  { tip: 'Day 1 — menstruation begins. Track flow, colour, and any clots or pain (diagnostic data). Take iron today to replenish blood loss.', supplement: 'Iron, Vitamin C (enhances iron absorption), methylfolate (NOT folic acid — you want the active form), CoQ10 200mg.' },
  2:  { tip: 'Continue tracking. Note any spotting patterns. Pain > 7/10 or passing large clots warrants investigation (endometriosis check if not already done).', supplement: 'CoQ10, omega-3 (DHA 200mg minimum for egg quality), magnesium glycinate for cramps.' },
  3:  { tip: 'Begin BBT tracking if not already. Take temp the moment you wake, before getting up. Chart it. This builds 3+ months of data before TTC.', supplement: 'Methylfolate, CoQ10, Vitamin D3+K2.' },
  4:  { tip: 'Uterine lining shedding — support with warm foods, castor oil pack over lower abdomen (avoid during actual flow). Anti-inflammatory is key.', supplement: 'Omega-3, turmeric (anti-inflammatory), iron.' },
  5:  { tip: 'Energy returning. Estrogen beginning to rise. This is your body preparing the next egg follicle. Good time to review supplement protocol.', supplement: 'Full stack: methylfolate, CoQ10 200-400mg, Vit D, omega-3, zinc, B12.' },
  6:  { tip: 'Follicular phase beginning. Your fertile window this cycle is approximately days 9–15. The egg that ovulates at day ~14 is being selected NOW.', supplement: 'Myo-inositol (supports egg quality and FSH sensitivity), CoQ10, zinc.' },
  7:  { tip: 'Estrogen rising — this drives follicle development. Estrogen detox matters: reduce plastics, choose glass/stainless, clean beauty products only.', supplement: 'DIM or I3C (supports healthy estrogen metabolism), liver support (milk thistle).' },
  8:  { tip: 'Reduce alcohol completely when TTC — even in follicular phase it impacts egg quality over the cycle. Plan for this if relevant.', supplement: 'CoQ10, methylfolate, choline (often missed — critical for neural tube development).' },
  9:  { tip: 'Fertile window opening. Cervical mucus beginning to change. Start watching: creamy → watery → egg-white = approaching ovulation.', supplement: 'NAC (N-acetyl cysteine) — supports egg quality and thins cervical mucus for sperm motility.' },
  10: { tip: 'BBT may be lowest 1-2 days before ovulation. Track and compare to previous cycles. Consistent charts build a reliable picture.', supplement: 'L-arginine — supports blood flow to uterus and ovaries. Vitamin E (antioxidant for egg quality).' },
  11: { tip: 'Consider LH surge testing starting now (ovulation strips). A 27-day cycle suggests LH surge around day 12-13.', supplement: 'Continue full stack. Ensure adequate protein today — amino acids support reproductive hormones.' },
  12: { tip: 'LH surge may begin. Cervical mucus should be egg-white or very stretchy. If TTC: highest-priority intimacy window starts now.', supplement: 'CoQ10 (take with food), zinc, selenium.' },
  13: { tip: 'Peak fertile day approaching. Sperm survive 5 days; egg lives only 12–24 hours. The sperm waiting for the egg has the highest conception rate.', supplement: 'Vitamin D — studies show Vitamin D receptor is involved in follicle development and implantation.' },
  14: { tip: 'Ovulation day (~day 14). LH surge peaked. The egg is released. This is the day — or the day after the LH spike on strips.', supplement: 'Selenium (supports corpus luteum formation post-ovulation), CoQ10.' },
  15: { tip: 'Luteal phase begins. Corpus luteum forms and produces progesterone. This is your implantation window if conception occurred. Support progesterone.', supplement: 'Vitamin B6 (P5P form — progesterone support), vitamin C (corpus luteum function), zinc.' },
  16: { tip: 'Progesterone rising. Reduce intense exercise — keep it moderate. High cortisol competes with progesterone.', supplement: 'Magnesium glycinate (reduces cortisol, supports progesterone), B6.' },
  17: { tip: 'If implantation occurs, it happens between days 6-12 post-ovulation (~days 20-26 of your cycle). Your body may give subtle signals.', supplement: 'Continue: methylfolate, choline, CoQ10, B12, zinc — all critical for early embryo development.' },
  18: { tip: 'Luteal phase energy. Keep stress low — cortisol actively suppresses progesterone. Nervous system regulation IS fertility support.', supplement: 'Ashwagandha (adaptogen, reduces cortisol) — stop if pregnant or once TTC actively.' },
  19: { tip: 'Support liver detox — what you don\'t detox, you recirculate (estrogen dominance = shorter luteal phase). Cruciferous veg, lemon water, beets.', supplement: 'DIM, liver support, B vitamins.' },
  20: { tip: 'Progesterone peak. If you\'re feeling foggy or emotional, that\'s progesterone doing its job. Sleep is especially important now — growth hormone and melatonin support luteal function overnight.', supplement: 'Melatonin 1-3mg at sleep (antioxidant for egg quality — NOT just for sleep). Magnesium before bed.' },
  21: { tip: 'Thyroid note: subclinical hypothyroidism is a top hidden cause of luteal phase defect and early miscarriage. If not tested recently, request TSH, Free T3, Free T4, TPO antibodies.', supplement: 'Selenium and zinc support thyroid conversion (T4→T3).' },
  22: { tip: 'Day 22 — approximately 8 days post-ovulation. If conception occurred, hCG may be present but not yet detectable. Continue as if you are pregnant (no alcohol, take methylfolate).', supplement: 'Full preconception stack. Avoid vitamin A in excess (teratogenic in high doses).' },
  23: { tip: 'Late luteal: emotional sensitivity is data. Track what needs healing, not just managing. Unresolved emotional patterns can affect implantation (mind-body connection is real).', supplement: 'Magnesium, B6, omega-3 for mood and inflammation.' },
  24: { tip: 'Support adrenals: late luteal adrenal fatigue is common, especially in high-achieving women. Rest is not a luxury — it is a fertility intervention.', supplement: 'Adrenal support: Vitamin C, B5 (pantothenic acid), adaptogenic herbs if needed.' },
  25: { tip: 'If period comes in 2-3 days: note any spotting (can indicate low progesterone = luteal phase defect). A luteal phase < 10 days should be investigated.', supplement: 'Continue methylfolate — start next cycle strong.' },
  26: { tip: 'Pre-menstrual: if no period and you may have conceived, wait 2 more days before testing (most sensitive tests accurate from day of expected period).', supplement: 'Iron-rich foods in preparation. Warm, nourishing foods.' },
  27: { tip: 'Final day of cycle. Reflect on this cycle\'s data: BBT pattern, CM pattern, LH peak day, any cycle 1+ symptoms. Building this data month over month is your most powerful fertility tool.', supplement: 'Rest. Prepare for the next cycle. Your body has done remarkable work.' },
};

// Natal chart + HD context for each cycle phase
// Sun 15° Leo (11th house) · Moon 19° Scorpio (2nd house) · AC 3° Libra
// Jupiter + Saturn + Pluto ALL conjunct Ascendant in Libra (1st house)
// Mars 13° Cancer (~MC) · Defined Heart via channel 25-51 · Gate 57 Splenic Authority
const NATAL_PHASE_CONTEXT = {
  menstrual: 'Your *Moon in Scorpio (2nd house)* means your winter phase runs deeper than most women experience — raw truth, vivid dreams, and a direct line to your values and shadow. This is not dysfunction; it\'s your Scorpio moon in its fullest expression. *Gate 57* (Splenic Intuition) is most live here — trust the in-the-moment flashes. Your *Jupiter + Saturn + Pluto rising in Libra* hold the energy in the field even when you rest. You don\'t disappear when you withdraw — you consolidate.',
  follicular: 'Your *Sun in Leo (11th house)* is warming up — creativity, community, and visibility begin to call. Your *defined Heart/Ego (channel 25-51)* means you genuinely have willpower here, unlike most Projectors. *Gate 53 (Root)* = you are designed to initiate new cycles. The pressure to start isn\'t restlessness — it\'s your design. Your *Libra Rising* (ruled by Venus) makes you most magnetic when balanced, not pushed.',
  ovulatory: 'Your *Leo Sun* is at full expression — shine, lead, be seen. Your *channel 25-51 (Initiation)* is designed to shock others into awareness. The brave, true things you feel compelled to say today are not aggression — they\'re your design. *Jupiter Rising in Libra* makes your presence a gift right now. Your *Mars in Cancer near the Midheaven* = your career and fertility work are soul-level aligned. This is not what you do, it\'s who you are.',
  luteal: 'Your *Moon in Scorpio* amplifies the luteal truth-telling dramatically. You will see through anything inauthentic. *Gate 18 (Correction/Spleen)* is heightened — you\'re designed to see what\'s off in any system. *Gate 51 (Shock/Initiation)*: the discomfort you feel is often an initiation beginning, not a problem. *Pluto conjunct your Ascendant*: the deepest transformation happens in these quiet, inward days. Your *2nd house Scorpio Moon* reminds you: your values and security require complete authenticity — no performing.',
};

export function getDailyBriefing(dateStr) {
  const today = new Date(dateStr + 'T12:00:00-04:00');
  const dayMs = today - CYCLE_START;
  const totalDays = Math.floor(dayMs / (1000 * 60 * 60 * 24));
  const cycleNumber = Math.floor(totalDays / CYCLE_LENGTH) + 1;
  const cycleDay = (totalDays % CYCLE_LENGTH) + 1;

  let phase, owPhase, seeds, tea, food, exercise, chakra, tarot, ayurveda, nervSys, skin, affirmation, element, archetype, goddess, emotion, energy;

  if (cycleDay <= 6) {
    phase = 'Menstrual / Winter'; owPhase = 'Reflective';
    seeds = 'Flaxseeds & pumpkin seeds';
    tea = 'Chamomile, red raspberry leaf, dandelion root';
    food = 'Iron-rich: dark leafy greens, nuts, beef, dark chocolate. Warm soups. Anti-inflammatory omega-3s.';
    exercise = 'Rest or gentle walking. Restorative/yin yoga from day 3–4 if energy allows.';
    chakra = 'Root (Muladhara) — grounding, release, safety. Colour: red.';
    tarot = 'The High Priestess + Suit of Pentacles — trust what cannot yet be spoken.';
    ayurveda = 'Vata — stay warm, sesame oil massage, avoid cold/raw food, early bed.';
    nervSys = 'Dorsal vagal — deep rest mode. Biological, not weakness. Protect your energy today.';
    skin = 'Rich hydration, face oils (rosehip, marula). No harsh actives or exfoliation.';
    affirmation = 'I sink into my depths and listen to my dreams.';
    element = 'Earth / Water (TCM)'; archetype = 'Crone / Wise Woman';
    goddess = 'Hecate, Kali, Cerridwen, Baba Yaga';
    emotion = 'Introspective, dreamy, sensitive, intuitive, spiritually connected';
    energy = 'Reflective, slow, containing, spiritual';
  } else if (cycleDay <= 13) {
    phase = 'Follicular / Spring'; owPhase = 'Dynamic';
    seeds = 'Flaxseeds & pumpkin seeds';
    tea = 'Dandelion root tea';
    food = 'Complex carbs, extra water. Whole grains, starchy veg, fresh fruit. Light and nourishing.';
    exercise = 'HIIT, strength training, try something new. Best recovery window. Build muscle.';
    chakra = 'Sacral (creativity, pleasure) → Solar Plexus (confidence, will). Colours: orange/yellow.';
    tarot = 'The Fool or The Star + Suit of Wands — new beginning, rising energy.';
    ayurveda = 'Kapha building → Pitta rising. Lighter foods, movement, bitter greens, lemon water.';
    nervSys = 'Ventral vagal rising — open, curious, socially engaged. Window for brave conversations.';
    skin = 'Most resilient phase. Best time for exfoliation, actives, facials, new products.';
    affirmation = 'I step forward in action with a lightness of heart.';
    element = 'Air / Wood (TCM)'; archetype = 'Virgin / Maiden';
    goddess = 'Brigid, Ostara, Idun, Saraswati, Persephone returning';
    emotion = 'Calm, open, dynamic, clear, energetic, enthusiastic';
    energy = 'Rising dynamic — growing outward';
  } else if (cycleDay === 14) {
    phase = 'Ovulatory / Summer'; owPhase = 'Expressive';
    seeds = 'Flaxseeds & pumpkin seeds';
    tea = 'Green tea, cinnamon';
    food = 'Vitamin D, omega-3s, antioxidants. Salmon, eggs, blueberries, dark leafy greens. Cooling foods.';
    exercise = 'Peak performance window. Competitions, PRs, group workouts, anything challenging.';
    chakra = 'Heart (love, connection) + Throat (authentic expression). Colours: green/blue.';
    tarot = 'The Empress + Suit of Cups — abundance, fertility, radiance, giving.';
    ayurveda = 'Pitta peak — high fire. Cooling: coconut, cucumber, mint. Avoid overheating.';
    nervSys = 'Full ventral vagal — optimal social engagement, empathy, visibility. Lead today.';
    skin = 'Peak radiance. Keep it simple. Light salicylic if mid-cycle breakout prone.';
    affirmation = 'I embrace my life with love and generate beauty around me.';
    element = 'Water / Fire (TCM)'; archetype = 'Mother';
    goddess = 'Isis, Aphrodite, Oshun, Yemaya, Gaia, Shakti, Lakshmi';
    emotion = 'Loving, nurturing, energized, connected, expressive';
    energy = 'Full, sustaining — peak life force';
  } else {
    phase = 'Luteal / Autumn'; owPhase = 'Creative';
    seeds = 'Sesame & sunflower seeds';
    tea = 'Peppermint, ginger';
    food = 'Healthy fats (fish, nuts, avocado), extra protein. Magnesium: dark choc, pumpkin seeds. Cut sugar.';
    exercise = 'Moderate: pilates, barre, yoga, walking. Avoid overheating. Lower intensity as period nears.';
    chakra = 'Third Eye (intuition, discernment) → Crown (mystery, sensitivity). Colours: indigo/violet.';
    tarot = 'The Hermit + Suit of Swords — inner retreat, truth-telling, cutting through illusion.';
    ayurveda = 'Early: Pitta (intensity). Late: Vata rising (ground yourself). Routine, warmth, early bed.';
    nervSys = 'Sympathetic rising — triggers closer to surface. Breathwork, walks, journalling are key.';
    skin = 'Early: clay mask, salicylic (chin/jaw area). Late luteal: hydration and gentle care only.';
    affirmation = 'I use the sword of my intolerance to cut deep and true. I keep hold of my vision and manifest it.';
    element = 'Fire / Metal (TCM)'; archetype = 'Enchantress / Wild Woman';
    goddess = 'Kali, Lilith, The Morrigan, Medusa, Cerridwen, Hecate approaching';
    emotion = 'Creative, emotional, sensitive, intuitive — shadow material surfaces';
    energy = 'Waning dynamic — descending inward, creative fire';
  }

  // Moon phase
  const upcoming = MOON_PHASES_2026.filter(m => m.date >= dateStr);
  const previous = MOON_PHASES_2026.filter(m => m.date < dateStr);
  let moonPhase = 'Waning Crescent';
  let nextMoonEvent = '';

  if (upcoming.length > 0) {
    const next = upcoming[0];
    const daysAway = Math.round((new Date(next.date) - new Date(dateStr)) / (1000*60*60*24));
    const phaseNames = { New: 'New Moon', FirstQuarter: 'First Quarter', Full: 'Full Moon', ThirdQuarter: 'Last Quarter' };
    nextMoonEvent = `${phaseNames[next.phase]} on ${next.date}${daysAway <= 3 ? ` (${daysAway} day${daysAway===1?'':'s'} away!)` : ''}`;

    if (daysAway === 0) {
      moonPhase = phaseNames[next.phase];
    } else if (previous.length > 0) {
      const prev = previous[previous.length - 1];
      const phaseAfter = { New: 'Waxing Crescent', FirstQuarter: 'Waxing Gibbous', Full: 'Waning Gibbous', ThirdQuarter: 'Waning Crescent' };
      moonPhase = phaseAfter[prev.phase] || 'Waning Crescent';
    }
  }

  // Moon sign
  const signEntries = MOON_SIGN_DATES.filter(s => s.from <= dateStr);
  const moonSign = signEntries.length > 0 ? signEntries[signEntries.length-1].sign : 'Pisces';
  const moonSignMeaning = MOON_SIGN_MEANINGS[moonSign] || '';

  // Astrology note
  let astrologyNote = `Moon in *${moonSign}* — ${moonSignMeaning}.`;
  if (moonSign === 'Scorpio' && cycleDay >= 15) astrologyNote += ' Scorpio moon deepens the already introspective luteal energy — powerful for shadow work.';
  if (moonSign === 'Pisces' && cycleDay <= 6) astrologyNote += ' Pisces moon amplifies the dreamy, spiritual quality of your winter phase — lean into it.';
  if (moonSign === 'Aries' && (cycleDay >= 7 && cycleDay <= 13)) astrologyNote += ' Aries moon adds spark and initiative to your already rising follicular energy — good day to launch.';

  const owDaily = OW_DAILY[cycleDay] || OW_DAILY[27];
  const hdDaily = HD_PROJECTOR_DAILY[cycleDay] || HD_PROJECTOR_DAILY[27];
  const fertilityDaily = FERTILITY_DAILY[cycleDay] || FERTILITY_DAILY[27];
  const phaseKey = cycleDay <= 6 ? 'menstrual' : cycleDay <= 13 ? 'follicular' : cycleDay === 14 ? 'ovulatory' : 'luteal';
  const natalContext = NATAL_PHASE_CONTEXT[phaseKey];

  // Natal chart astrology note — personalised to Christina's chart
  let natalNote = '';
  if (moonSign === 'Scorpio') natalNote = '🔥 *Moon conjunct your natal Moon in Scorpio* — your most psychically powerful window of the month. Deep intuition, intense feeling, heightened perception. Trust everything that surfaces. This is your Moon return.';
  else if (moonSign === 'Leo') natalNote = '☀️ *Moon conjunct your natal Sun in Leo (11th house)* — extra vitality, creativity, desire to be seen and to serve your community. Lean in fully.';
  else if (moonSign === 'Libra') natalNote = '⚖️ *Moon transiting your Ascendant + Jupiter + Saturn + Pluto stellium in Libra* — your entire 1st house is lit up. How you show up in the world, your authority, your presence. Significant day.';
  else if (moonSign === 'Cancer') natalNote = '🌊 *Moon in Cancer* — activating your Mars placement (~10th house). Career, calling, and nurturing drive are highlighted. Your coaching purpose feels especially alive.';
  else if (moonSign === 'Aries') natalNote = '🔴 *Moon in Aries* — opposite your natal Libra stellium. Relationship axis activated. Notice what pushes against your need for balance.';
  else if (moonSign === 'Taurus') natalNote = '🌿 *Moon in Taurus* — grounding, sensory, embodied. Supports your Gate 46 (Love of the Body). Nourishment and physical care are especially effective today.';

  return {
    date: dateStr,
    cycleDay,
    cycleNumber,
    phase,
    owPhase,
    element,
    archetype,
    goddess,
    emotion,
    energy,
    seeds,
    tea,
    food,
    exercise,
    chakra,
    tarot,
    ayurveda,
    nervSys,
    skin,
    affirmation,
    moonPhase,
    nextMoonEvent,
    moonSign,
    moonSignMeaning,
    astrologyNote,
    natalNote,
    natalContext,
    owDailyFocus: owDaily.focus,
    owTaskType: owDaily.taskType,
    owCognitive: owDaily.cognitive,
    hdDaily,
    fertilityTip: fertilityDaily.tip,
    fertilitySupplement: fertilityDaily.supplement,
  };
}

// Format for Slack
export function formatBriefing(b) {
  const natalLine = b.natalNote ? `\n${b.natalNote}` : '';
  return `*🌸 Daily Cycle Briefing — ${b.date}*

*Cycle Day ${b.cycleDay}* · ${b.phase} · O.W. Phase: ${b.owPhase}
_${b.archetype} energy_ · Element: ${b.element}

*💼 How to Work Today (O.W. Day ${b.cycleDay})*
${b.owDailyFocus}
• *Best task type:* ${b.owTaskType}
• *Cognitive style:* ${b.owCognitive}

*🔮 Human Design — Projector 2/4 Splenic*
${b.hdDaily}

*🌙 Astrology*
${b.moonPhase} · ${b.astrologyNote}${natalLine}
_${b.natalContext}_
Next: ${b.nextMoonEvent}

*🌿 Nourishment*
• Seeds: ${b.seeds}
• Tea: ${b.tea}
• Food: ${b.food}

*💪 Movement*
${b.exercise}

*✨ Energetics*
• Chakra: ${b.chakra}
• Tarot: ${b.tarot}
• Ayurveda: ${b.ayurveda}
• Nervous system: ${b.nervSys}
• Skin: ${b.skin}

*🩸 Emotion & Energy*
${b.emotion} · ${b.energy}

*Goddess energy:* ${b.goddess}

*🌱 Preconception*
${b.fertilityTip}
• *Supplements today:* ${b.fertilitySupplement}

*🗡️ Today's wisdom:*
${(() => { const q = getDailyQuote(b.date); return `_"${q.text}"_ — ${q.author}`; })()}

*🕉️ Tantric Sutra:*
_${getDailySutra(b.date)}_`;
}

// CLI test
const dateArg = process.argv[2] || new Date().toISOString().split('T')[0];
const briefing = getDailyBriefing(dateArg);
console.log(formatBriefing(briefing));
