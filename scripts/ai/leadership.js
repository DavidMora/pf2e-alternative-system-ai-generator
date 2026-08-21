import { DC_ADJUSTMENTS, LEADERSHIP_EVENT_KINDS, PF2E_SKILLS } from '../constants.js';
import {
  capitalize,
  dcFromBase,
  loreSlug,
  nextPosition,
  organizationSize,
  premiseToHTML,
} from '../helpers.js';
import { requestStructured } from './openai.js';

const CHECK_ITEM = {
  type: 'object',
  additionalProperties: false,
  required: ['skill', 'loreName', 'dcAdjustment', 'description'],
  properties: {
    skill: { type: 'string', enum: PF2E_SKILLS },
    loreName: { type: 'string', description: 'Lore subject, or an empty string.' },
    dcAdjustment: { type: 'string', enum: Object.keys(DC_ADJUSTMENTS) },
    description: { type: 'string', description: 'What a character does about it, in one sentence.' },
  },
};

const EVENT_ITEM = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'name', 'description', 'outcome', 'atLevel', 'checks'],
  properties: {
    kind: {
      type: 'string',
      enum: Object.keys(LEADERSHIP_EVENT_KINDS),
      description:
        'An opportunity is a decision that shapes the organisation. A trouble is something gone wrong that needs the party. A windfall is an unexpected benefit.',
    },
    name: { type: 'string' },
    description: { type: 'string', description: 'What lands on the party’s desk, in GM-readable prose.' },
    outcome: {
      type: 'string',
      description: 'What handling it well actually gets them, and what it costs if they do not.',
    },
    atLevel: {
      type: 'integer',
      description:
        'Organisation level at which this becomes relevant, from 1 to 20. Space them out across the range.',
    },
    checks: {
      type: 'array',
      description:
        'Nought to three ways to deal with it. A windfall usually needs none; a trouble usually needs two or three.',
      items: CHECK_ITEM,
    },
  },
};

export const LEADERSHIP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'kind', 'seat', 'gmNotes', 'lieutenants', 'events'],
  properties: {
    title: { type: 'string', description: 'The organisation’s name, if the GM gave none.' },
    kind: { type: 'string', description: 'What sort of body it is, in a few words: guild, crew, cult, company.' },
    seat: { type: 'string', description: 'Where it operates from.' },
    gmNotes: {
      type: 'string',
      description: 'How it might grow, who resents it, and any twist worth foreshadowing.',
    },
    lieutenants: {
      type: 'array',
      description:
        'Two to four named subordinates worth remembering, each with a job and a reason they are interesting.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'role', 'description', 'level'],
        properties: {
          name: { type: 'string' },
          role: { type: 'string', description: 'Their job in the organisation, a few words.' },
          description: { type: 'string', description: 'Who they are and what they want, in one or two sentences.' },
          level: { type: 'integer', description: 'Creature level, within the range the caller gives.' },
        },
      },
    },
    events: {
      type: 'array',
      description:
        'Four to six things that will happen to the organisation over time. Include at least one of each kind.',
      items: EVENT_ITEM,
    },
  },
};

const SYSTEM_PROMPT = `You are a Pathfinder Second Edition Game Master preparing an organisation for the Leadership subsystem from the Gamemastery Guide.

Rules you must respect:
- This subsystem has no point track. An organisation gains levels because the party earned them through play, not by filling a meter.
- The organisation's level determines how many followers and lieutenants it has. The caller supplies those numbers; do not invent different ones.
- Followers and lieutenants never accompany the party on adventures and provide no free labour, magic or resources. Write them as people with their own lives, not as equipment.
- Events happen in downtime and come in three kinds. An opportunity is a decision with consequences from neutral to mixed. A trouble is a problem needing the party, and should cost less than it gives. A windfall is an unexpected benefit.
- Never invent numeric DCs. The GM supplies one base DC. You only choose a difficulty adjustment per check, and the caller applies it.
- The organisation and its purpose are written by the GM and are authoritative. Build on them; do not contradict, restate or rewrite them.
- Write usable table prose. Every event should read like something a GM could drop into a session unchanged.`;

function promptLines(options) {
  const { premise, organization, goal, baseDC, level, partySize, organizationLevel, tone, language } = options;
  const size = organizationSize(organizationLevel);
  const lines = [
    'GM-written organisation (authoritative, do not rewrite):',
    organization,
    '',
  ];
  if (premise) lines.push(`How it came to be, and what it is for: ${premise}`, '');
  if (goal) lines.push(`What the party wants it to become: ${goal}`, '');

  lines.push(
    `It is currently organisation level ${size.level}: ${size.followers} followers of up to level ${size.maxFollowerLevel}, and ${size.lieutenants} lieutenant(s) of level ${size.lieutenantLevels}.`,
    `Write lieutenants within that level range. Do not exceed the follower counts.`,
    '',
    `Base DC: ${baseDC}. Every check's DC is this number plus your chosen adjustment, from -10 ("incredibly-easy") to +10 ("incredibly-hard").`,
  );

  if (level) lines.push(`The party is around level ${level}; pitch the fiction accordingly.`);
  if (partySize) lines.push(`There are ${partySize} characters leading it.`);
  if (tone) lines.push(`Tone and setting details to honour: ${tone}`);
  if (language && language.toLowerCase() !== 'en') {
    lines.push(`Write all prose in this language: ${language}. Keep skill names in English.`);
  }
  return lines;
}

export async function generateLeadership(options, { signal } = {}) {
  const result = await requestStructured({
    schemaName: 'pf2e_leadership',
    schema: LEADERSHIP_SCHEMA,
    system: SYSTEM_PROMPT,
    user: promptLines(options).join('\n'),
    signal,
  });
  return toLeadershipData(result, options);
}

/** One further downtime event for an organisation already running. */
export const EVENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['event'],
  properties: { event: EVENT_ITEM },
};

export async function generateLeadershipEvent(options, { signal } = {}) {
  const lines = promptLines(options);
  lines.push('');
  if (options.existingNames?.length) {
    lines.push(`These events already exist: ${options.existingNames.join('; ')}. Do not repeat them.`);
  }
  if (options.kind) lines.push(`Produce exactly one further event of kind "${options.kind}".`);
  else lines.push('Produce exactly one further event.');

  const result = await requestStructured({
    schemaName: 'pf2e_leadership_event',
    schema: EVENT_SCHEMA,
    system: SYSTEM_PROMPT,
    user: lines.join('\n'),
    signal,
  });
  return result.event;
}

function toCheckRecord(items, baseDC) {
  const record = {};
  (items ?? []).forEach((item, index) => {
    const id = foundry.utils.randomID();
    const isLore = item.skill === 'lore' && item.loreName;
    record[id] = {
      id,
      position: index,
      slug: isLore ? loreSlug(item.loreName) : item.skill,
      label: isLore ? `${item.loreName} Lore` : capitalize(item.skill),
      dc: dcFromBase(baseDC, item.dcAdjustment),
      description: String(item.description ?? ''),
      hidden: false,
      revealAt: null,
    };
  });
  return record;
}

/** Map one generated event onto the stored shape. */
export function toEventEntry(item, baseDC, { position = 0, hidden = true } = {}) {
  const id = foundry.utils.randomID();
  return {
    id,
    position,
    kind: Object.hasOwn(LEADERSHIP_EVENT_KINDS, item.kind) ? item.kind : 'opportunity',
    name: item.name,
    description: `<p>${item.description ?? ''}</p>`,
    outcome: `<p>${item.outcome ?? ''}</p>`,
    hidden,
    resolved: false,
    revealAt: Math.clamp(item.atLevel ?? 1, 1, 20),
    checks: toCheckRecord(item.checks, baseDC),
  };
}

export function toLeadershipData(result, options) {
  const { premise, organization, goal, baseDC, level, partySize, organizationLevel, title, model } = options;
  const id = foundry.utils.randomID();

  const lieutenants = {};
  (result.lieutenants ?? []).forEach((lieutenant, index) => {
    const lid = foundry.utils.randomID();
    lieutenants[lid] = {
      id: lid,
      position: index,
      name: lieutenant.name,
      role: String(lieutenant.role ?? ''),
      description: `<p>${lieutenant.description ?? ''}</p>`,
      level: Math.clamp(lieutenant.level ?? 1, 0, 20),
      uuid: '',
      img: '',
      hidden: false,
    };
  });

  const startingLevel = Math.clamp(organizationLevel ?? 1, 1, 20);
  const events = {};
  [...(result.events ?? [])]
    .sort((a, b) => (a.atLevel ?? 1) - (b.atLevel ?? 1))
    .forEach((item, index) => {
      // An organisation that already stands at this level has already grown
      // into these; only later ones wait.
      const entry = toEventEntry(item, baseDC, {
        position: index,
        hidden: (item.atLevel ?? 1) > startingLevel,
      });
      events[entry.id] = entry;
    });

  return {
    id,
    name: title || result.title || game.i18n.localize('PFAI.Leadership.Untitled'),
    position: 0,
    img: '',
    premise: premiseToHTML(premise),
    organization: premiseToHTML(organization),
    goal: premiseToHTML(goal),
    gmNotes: `<p>${result.gmNotes ?? ''}</p>`,
    kind: String(result.kind ?? ''),
    seat: String(result.seat ?? ''),
    organizationLevel: startingLevel,
    baseDC,
    level: level ?? 1,
    partySize: partySize ?? 4,
    hidden: true,
    started: false,
    lieutenants,
    events,
    participants: {},
    ai: {
      generated: true,
      model: model ?? '',
      prompt: organization ?? premise ?? '',
      generatedAt: Date.now(),
    },
  };
}

export function withListPosition(data, existing) {
  return { ...data, position: nextPosition(existing) };
}
