function like(term) {
  return `%${term}%`;
}

function inConvOrCalEvent(term) {
  const p = like(term);
  return {
    sql: `(
      c.convTitle LIKE ?
      OR EXISTS (
        SELECT 1 FROM SHADOW_CAL_EVENT e
        WHERE e.eventId = c.eventId AND (
          e.eventTitle LIKE ?
          OR e.eventDescription LIKE ?
          OR e.eventAttendees LIKE ?
        )
      )
    )`,
    params: [p, p, p, p],
  };
}

function hasDomain(domain) {
  const atDomain = `%@${domain}%`;
  const jsonDomain = `%${domain}%`;
  return {
    sql: `(
      EXISTS (
        SELECT 1 FROM SHADOW_ATTENDEE a
        WHERE a.convUuid = c.convUuid AND a.isSelf = 0 AND a.email LIKE ?
      )
      OR EXISTS (
        SELECT 1 FROM SHADOW_CAL_EVENT e
        WHERE e.eventId = c.eventId AND (
          e.eventDescription LIKE ?
          OR e.eventAttendees LIKE ?
        )
      )
    )`,
    params: [atDomain, atDomain, jsonDomain],
  };
}

function hasEmail(email) {
  const e = email.toLowerCase();
  return {
    sql: `(
      EXISTS (
        SELECT 1 FROM SHADOW_ATTENDEE a
        WHERE a.convUuid = c.convUuid AND lower(a.email) = ?
      )
      OR EXISTS (
        SELECT 1 FROM SHADOW_CAL_EVENT e
        WHERE e.eventId = c.eventId AND (
          lower(e.eventDescription) LIKE ?
          OR lower(e.eventAttendees) LIKE ?
        )
      )
    )`,
    params: [e, `%${e}%`, `%${e}%`],
  };
}

function buildPreset(name, description, parts, grep) {
  const params = parts.flatMap((p) => p.params);
  return {
    name,
    description,
    sql: parts.map((p) => `(${p.sql})`).join(' OR '),
    extraParams: params,
    grep,
  };
}

const GANTTSY_SIGNALS = [inConvOrCalEvent('Ganttsy'), hasDomain('ganttsy.com')];
const GANTTSY_PLANNING = [inConvOrCalEvent('Ganttsy Planning')];
const GANTTSY_STRATEGY = [inConvOrCalEvent('Ganttsy Strategy')];
const COPPERTEAMS_SIGNALS = [
  inConvOrCalEvent('CopperTeams'),
  inConvOrCalEvent('Copper Teams'),
  inConvOrCalEvent('Copper Team'),
  hasDomain('copperteams.ai'),
];
const COGNITIVETECH_SIGNALS = [
  inConvOrCalEvent('CTC:'),
  {
    sql: `EXISTS (
      SELECT 1 FROM SHADOW_CAL_EVENT e
      WHERE e.eventId = c.eventId
        AND e.eventAttendees != '[]'
        AND e.eventAttendees NOT LIKE '%ganttsy.com%'
        AND e.eventAttendees NOT LIKE '%copperteams.ai%'
        AND e.eventTitle NOT LIKE '%Ganttsy%'
        AND e.eventTitle NOT LIKE '%Copper%'
        AND (
          e.eventAttendees LIKE '%cian@cognitivetech.net%'
          OR e.eventDescription LIKE '%cian@cognitivetech.net%'
        )
    )`,
    params: [],
  },
];
const COACHING_TITLE = [inConvOrCalEvent('Coaching'), inConvOrCalEvent('coaching')];
const CHRISTINA_SIGNALS = [
  hasEmail('christina3lane@gmail.com'),
  inConvOrCalEvent('Christina'),
  inConvOrCalEvent('christina'),
];
const KEVIN_SIGNALS = [
  hasEmail('ktlee@pwcpa.ca'),
  hasEmail('kevin@kevintlee.ca'),
  inConvOrCalEvent('Kevin'),
];
const MONDO_ZEN_SIGNALS = [
  hasDomain('mondozen.org'),
  hasDomain('shiningbrightlotus.org'),
  inConvOrCalEvent('Mondo Zen'),
  inConvOrCalEvent('mondo zen'),
  inConvOrCalEvent('Shining Bright Lotus'),
];

export const PRESETS = {
  ganttsy: buildPreset(
    'ganttsy',
    'Ganttsy meetings — title, cal event metadata, or @ganttsy.com attendees',
    GANTTSY_SIGNALS,
  ),
  'ganttsy-planning': buildPreset(
    'ganttsy-planning',
    'Ganttsy Planning recurring series',
    GANTTSY_PLANNING,
  ),
  'ganttsy-strategy': buildPreset(
    'ganttsy-strategy',
    'Ganttsy Strategy recurring series',
    GANTTSY_STRATEGY,
  ),
  'ganttsy-onboarding': {
    ...buildPreset(
      'ganttsy-onboarding',
      'Ganttsy meetings where transcript mentions onboarding',
      GANTTSY_SIGNALS,
      'onboarding',
    ),
    grep: 'onboarding',
  },
  copperteams: buildPreset(
    'copperteams',
    'CopperTeams — title patterns or @copperteams.ai in attendees/cal metadata',
    COPPERTEAMS_SIGNALS,
  ),
  cognitivetech: buildPreset(
    'cognitivetech',
    'CTCI client work — CTC: titles or cal eventAttendees with external client emails (excl. ganttsy/copper)',
    COGNITIVETECH_SIGNALS,
  ),
  coaching: buildPreset('coaching', 'Coaching sessions — title contains Coaching', COACHING_TITLE),
  christina: buildPreset(
    'christina',
    'Christina coaching — email, name in title, or cal metadata',
    CHRISTINA_SIGNALS,
  ),
  kevin: buildPreset('kevin', 'Kevin coaching — email or name in title/cal metadata', KEVIN_SIGNALS),
  'mondo-zen': buildPreset('mondo-zen', 'Mondo Zen / Shining Bright Lotus', MONDO_ZEN_SIGNALS),
};

export function listPresets() {
  return Object.values(PRESETS);
}

export function getPreset(name) {
  return PRESETS[name.toLowerCase()];
}
