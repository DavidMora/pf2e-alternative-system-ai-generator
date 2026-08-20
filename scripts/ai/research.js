import { DC_ADJUSTMENTS, PF2E_SKILLS } from '../constants.js';
import { capitalize, dcFromBase, loreSlug, nextPosition, premiseToHTML } from '../helpers.js';
import { requestStructured } from './openai.js';

/** A skill approach inside a source. */
const CHECK_ITEM = {
  type: 'object',
  additionalProperties: false,
  required: ['skill', 'loreName', 'dcAdjustment', 'description'],
  properties: {
    skill: { type: 'string', enum: PF2E_SKILLS },
    loreName: {
      type: 'string',
      description:
        'Subject of the Lore skill when skill is "lore" (e.g. "Academia"); otherwise an empty string.',
    },
    dcAdjustment: {
      type: 'string',
      enum: Object.keys(DC_ADJUSTMENTS),
      description:
        'Difficulty relative to the GM-supplied base DC. The obvious way in should be the easiest.',
    },
    description: {
      type: 'string',
      description: 'What a character actually does here, in one sentence.',
    },
  },
};

export const RESEARCH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'gmNotes', 'roundUnit', 'roundLimit', 'sources', 'thresholds', 'events'],
  properties: {
    title: { type: 'string', description: 'Short evocative name for this piece of research.' },
    gmNotes: {
      type: 'string',
      description: 'Pacing advice, what failure costs, and any twist worth foreshadowing.',
    },
    roundUnit: {
      type: 'string',
      description:
        'What one research round represents at this table: "hour", "afternoon", "day". One or two words.',
    },
    roundLimit: {
      type: 'integer',
      description: 'Rounds before the opportunity closes, or 0 for open-ended.',
    },
    sources: {
      type: 'array',
      description:
        'Three to five places or people the party can work: a library wing, an archive, an informant. Each yields only so much.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'description', 'maxResearchPoints', 'checks'],
        properties: {
          name: { type: 'string', description: 'The place or person.' },
          description: {
            type: 'string',
            description: 'One or two sentences on what working here is like.',
          },
          maxResearchPoints: {
            type: 'integer',
            description:
              'Most research points obtainable here, from 1 to 6. A rich archive gives more than a nervous informant.',
          },
          checks: {
            type: 'array',
            description:
              'Two to four ways to work this source. Vary the skills so different characters can contribute.',
            items: CHECK_ITEM,
          },
        },
      },
    },
    thresholds: {
      type: 'array',
      description:
        'What the party learns as points accumulate, ascending. Three or four. Crucial clues should cost fewer points than lavish rewards.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['points', 'name', 'description'],
        properties: {
          points: { type: 'integer', description: 'Research points needed, ascending.' },
          name: { type: 'string', description: 'Short label for what is learned.' },
          description: { type: 'string', description: 'What they actually find out.' },
        },
      },
    },
    events: {
      type: 'array',
      description:
        'One to three complications that interrupt the work: a rival arriving, a librarian growing suspicious, a passage that should not have been disturbed.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'description', 'triggerKind', 'triggerAt', 'dcShift'],
        properties: {
          name: { type: 'string' },
          description: { type: 'string', description: 'What happens, in GM-readable prose.' },
          triggerKind: {
            type: 'string',
            enum: ['points', 'rounds'],
            description:
              'Whether this fires at a research point total or after so much time has passed.',
          },
          triggerAt: { type: 'integer', description: 'The point total or round number.' },
          dcShift: {
            type: 'integer',
            description:
              'Ongoing change to every research DC while this is in play, from -5 to 5. Use 0 for an event that is pure fiction.',
          },
        },
      },
    },
  },
};

const SYSTEM_PROMPT = `You are a Pathfinder Second Edition Game Master preparing a Research encounter using the subsystem from GM Core.

Rules you must respect:
- The party spends research rounds working sources. Each round every character may attempt one research check.
- A check earns 1 research point on a success and 2 on a critical success; a critical failure costs 1 and represents a false lead.
- Each source caps how many research points can be taken from it. That cap is what stops a party grinding one shelf forever, so no single source may hold enough to finish the job.
- The sources together must offer comfortably more points than the highest threshold requires, or the research becomes unwinnable.
- Thresholds are point totals that yield something specific. Crucial clues should cost fewer points than lavish rewards. List them ascending.
- Events interrupt the work. They fire either at a point total or after so much time.
- Never invent numeric DCs. The GM supplies one base DC. You only choose a difficulty adjustment per check, and the caller applies it.
- The topic and the situation are written by the GM and are authoritative. Build on them; do not contradict, restate or rewrite them.
- Write usable table prose. Every check should sound like something a player would actually try in that specific place.`;

function promptLines(options) {
  const { premise, topic, goal, baseDC, level, partySize, tone, language } = options;
  const lines = [
    'GM-written situation (authoritative, do not rewrite):',
    premise,
    '',
    `What the party is researching: ${topic}`,
  ];
  if (goal) lines.push(`What they hope it buys them: ${goal}`);
  lines.push(
    '',
    `Base DC: ${baseDC}. Every check's DC is this number plus your chosen adjustment, from -10 ("incredibly-easy") to +10 ("incredibly-hard").`,
  );

  if (level) lines.push(`The party is around level ${level}; pitch the fiction accordingly.`);
  if (partySize) {
    lines.push(
      `There are ${partySize} characters, so each source needs enough distinct checks that several of them have something worthwhile to try in the same round.`,
    );
    lines.push(
      `Scale the thresholds and the source caps so the final threshold is a real achievement for ${partySize} characters over several rounds, but still reachable.`,
    );
  }
  if (options.roundLimit > 0) {
    lines.push(`The work must be done in ${options.roundLimit} rounds; set roundLimit to ${options.roundLimit}.`);
  } else {
    lines.push('Decide yourself whether a time limit suits the situation; use 0 for open-ended.');
  }
  if (tone) lines.push(`Tone and setting details to honour: ${tone}`);
  if (language && language.toLowerCase() !== 'en') {
    lines.push(`Write all prose in this language: ${language}. Keep skill names in English.`);
  }
  return lines;
}

export async function generateResearch(options, { signal } = {}) {
  const result = await requestStructured({
    schemaName: 'pf2e_research',
    schema: RESEARCH_SCHEMA,
    system: SYSTEM_PROMPT,
    user: promptLines(options).join('\n'),
    signal,
  });
  return toResearchData(result, options);
}

/** One further source for research already under way. */
export const SOURCE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['source'],
  properties: {
    source: RESEARCH_SCHEMA.properties.sources.items,
  },
};

export async function generateSource(options, { signal } = {}) {
  const lines = promptLines(options);
  lines.push('');
  if (options.existingNames?.length) {
    lines.push(`These sources already exist: ${options.existingNames.join('; ')}. Do not repeat them.`);
  }
  lines.push('Produce exactly one further source: somewhere else the party could turn.');
  if (options.becauseOf) lines.push(`It opens up because: ${options.becauseOf}.`);

  const result = await requestStructured({
    schemaName: 'pf2e_research_source',
    schema: SOURCE_SCHEMA,
    system: SYSTEM_PROMPT,
    user: lines.join('\n'),
    signal,
  });
  return result.source;
}

/** Map one generated check onto the stored entry shape. */
export function toCheckEntry(item, baseDC, { position = 0, hidden = false, revealAt = null } = {}) {
  const id = foundry.utils.randomID();
  const isLore = item.skill === 'lore' && item.loreName;
  return {
    id,
    position,
    slug: isLore ? loreSlug(item.loreName) : item.skill,
    label: isLore ? `${item.loreName} Lore` : capitalize(item.skill),
    dc: dcFromBase(baseDC, item.dcAdjustment),
    description: String(item.description ?? ''),
    hidden,
    revealAt,
  };
}

/** Map one generated source, checks included, onto the stored shape. */
export function toSourceEntry(source, baseDC, { position = 0, hidden = false, revealAt = null } = {}) {
  const id = foundry.utils.randomID();
  const checks = {};
  (source.checks ?? []).forEach((check, index) => {
    const entry = toCheckEntry(check, baseDC, { position: index });
    checks[entry.id] = entry;
  });

  return {
    id,
    position,
    name: source.name,
    description: `<p>${source.description ?? ''}</p>`,
    hidden,
    revealAt,
    researchPoints: {
      current: 0,
      // Capped low enough that no one source can finish the job alone.
      max: Math.clamp(source.maxResearchPoints ?? 3, 1, 12),
    },
    checks,
  };
}

export function toResearchData(result, options) {
  const { premise, topic, goal, baseDC, level, partySize, title, model } = options;
  const id = foundry.utils.randomID();

  const sources = {};
  (result.sources ?? []).forEach((source, index) => {
    // Only the first source starts open; the GM reveals the rest as they go.
    const entry = toSourceEntry(source, baseDC, { position: index, hidden: index > 0 });
    sources[entry.id] = entry;
  });

  const thresholds = {};
  [...(result.thresholds ?? [])]
    .sort((a, b) => a.points - b.points)
    .forEach((threshold, index) => {
      const tid = foundry.utils.randomID();
      thresholds[tid] = {
        id: tid,
        position: index,
        points: Math.max(1, threshold.points ?? index + 1),
        name: threshold.name,
        description: `<p>${threshold.description ?? ''}</p>`,
        hidden: true,
      };
    });

  const events = {};
  (result.events ?? []).forEach((event, index) => {
    const eid = foundry.utils.randomID();
    events[eid] = {
      id: eid,
      position: index,
      name: event.name,
      description: `<p>${event.description ?? ''}</p>`,
      hidden: true,
      trigger: {
        kind: event.triggerKind === 'rounds' ? 'rounds' : 'points',
        at: Math.max(1, event.triggerAt ?? 1),
      },
      fired: false,
      modifier: { value: Math.clamp(event.dcShift ?? 0, -5, 5), active: false },
    };
  });

  return {
    id,
    name: title || result.title || game.i18n.localize('PFAI.Research.Untitled'),
    position: 0,
    img: '',
    premise: premiseToHTML(premise),
    topic: premiseToHTML(topic),
    goal: premiseToHTML(goal),
    gmNotes: `<p>${result.gmNotes ?? ''}</p>`,
    baseDC,
    level: level ?? 1,
    partySize: partySize ?? 4,
    hidden: true,
    started: false,
    researchPoints: 0,
    rounds: {
      current: 0,
      max: result.roundLimit > 0 ? result.roundLimit : null,
      unit: String(result.roundUnit ?? ''),
    },
    sources,
    thresholds,
    events,
    participants: {},
    ai: {
      generated: true,
      model: model ?? '',
      prompt: topic ?? premise ?? '',
      generatedAt: Date.now(),
    },
  };
}

export function withListPosition(data, existing) {
  return { ...data, position: nextPosition(existing) };
}
