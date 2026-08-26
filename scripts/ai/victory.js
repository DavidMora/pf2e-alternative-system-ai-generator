import { DC_ADJUSTMENTS, PF2E_SKILLS } from '../constants.js';
import {
  capitalize,
  dcFromBase,
  loreSlug,
  nextPosition,
  premiseToHTML,
  victoryScale,
} from '../helpers.js';
import { requestStructured } from './openai.js';

/**
 * The generic Victory Points subsystem.
 *
 * The model proposes ways to earn points and what they buy. It does not choose
 * the endpoint or where the thresholds sit: those come from the published scale
 * table via the GM's chosen scale, for the same reason DCs are computed here.
 */

function checkItem() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['skill', 'loreName', 'dcAdjustment', 'description', 'exploitsWeakness'],
    properties: {
      skill: { type: 'string', enum: PF2E_SKILLS },
      loreName: {
        type: 'string',
        description: 'Subject of the Lore skill when skill is "lore"; otherwise an empty string.',
      },
      dcAdjustment: {
        type: 'string',
        enum: Object.keys(DC_ADJUSTMENTS),
        description:
          'Difficulty relative to the GM-supplied base DC. Vary these; an obstacle everyone can clear is not a choice.',
      },
      description: {
        type: 'string',
        description:
          'What a character actually does, in one sentence, specific to this situation rather than generic.',
      },
      exploitsWeakness: {
        type: 'boolean',
        description:
          'True if this approach only works because the party found something out or set it up. The caller pays extra points for these.',
      },
    },
  };
}

export const VICTORY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'gmNotes', 'roundUnit', 'roundLimit', 'checks', 'thresholds', 'events'],
  properties: {
    title: { type: 'string', description: 'Short evocative name for this contest.' },
    gmNotes: {
      type: 'string',
      description:
        'How to pace it, what pressure the party is under, and what a run of failures should look like at the table.',
    },
    roundUnit: {
      type: 'string',
      description:
        'What one round represents here, e.g. "hour", "watch", "exchange", "day". Empty for abstract rounds.',
    },
    roundLimit: {
      type: 'integer',
      description: 'Rounds available before the opportunity closes, or 0 for open-ended.',
    },
    checks: {
      type: 'array',
      description:
        'Four to eight ways to earn points, on distinct skills so every character has something to try. Include at least one that only opens up after the party works something out.',
      items: checkItem(),
    },
    thresholds: {
      type: 'array',
      description:
        'What the party gets partway. The caller supplies the point totals; write one entry per total it asks for, in the order given.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'description'],
        properties: {
          name: { type: 'string', description: 'Short label for what they gain.' },
          description: { type: 'string', description: 'What it actually changes for them.' },
        },
      },
    },
    events: {
      type: 'array',
      description:
        'Two or three twists that interrupt the contest. Each fires either at a point total or after so many rounds.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'description', 'triggerKind', 'triggerAt'],
        properties: {
          name: { type: 'string' },
          description: { type: 'string', description: 'What happens, in a sentence or two.' },
          triggerKind: { type: 'string', enum: ['points', 'rounds'] },
          triggerAt: { type: 'integer', description: 'The total or round number it fires on.' },
        },
      },
    },
  },
};

const SYSTEM_PROMPT = `You are a Pathfinder Second Edition Game Master building a contest with the Victory Points subsystem from GM Core.

Rules you must respect:
- Victory Points are a generic frame. The specific fiction is whatever the GM described; your job is to turn it into things a character can roll for.
- Accumulating rolls: a critical success earns 2 points, a success 1, a critical failure costs 1. Diminishing rolls: the party starts at the endpoint and is trying not to lose it, a success holds ground and a failure costs a point.
- Never invent numeric DCs. The GM supplies one base DC. You only choose a difficulty adjustment per check, and the caller applies it.
- Never choose the endpoint or the threshold totals. The caller sets those from the published scale table and tells you how many thresholds to write.
- Vary the skills. A contest where everything is Diplomacy excludes most of the party.
- Mark a check as exploiting a weakness only when it genuinely depends on the party having learned or arranged something first. Those pay more, so they should cost something to unlock.
- The premise and the objective are written by the GM and are authoritative. Build on them; do not contradict, restate or rewrite them.
- Write usable table prose. Every check should sound like something a player would actually try in that specific situation.`;

function promptLines(options) {
  const {
    premise,
    objective,
    goal,
    failure,
    baseDC,
    level,
    partySize,
    structure,
    scale,
    tone,
    language,
  } = options;
  const { goal: endpoint, thresholds } = victoryScale(scale);

  const lines = [
    'GM-written situation (authoritative, do not rewrite):',
    premise,
    '',
    `What the party is trying to do: ${objective}`,
  ];
  if (goal) lines.push(`What reaching the end buys them: ${goal}`);
  if (failure) lines.push(`What happens if they fail: ${failure}`);

  lines.push(
    '',
    `Base DC: ${baseDC}. Every check's DC is this number plus your chosen adjustment, from -10 ("incredibly-easy") to +10 ("incredibly-hard").`,
  );

  if (structure === 'diminishing') {
    lines.push(
      `This is a diminishing contest: the party starts with ${endpoint} points and is trying not to lose them. Write checks that are about holding on, and make the failure state feel close.`,
    );
  } else {
    lines.push(
      `This is an accumulating contest: the party starts at 0 and needs ${endpoint} points. Pace it so that is several rounds of work for ${partySize} characters.`,
    );
  }

  if (thresholds.length) {
    lines.push(
      `Write exactly ${thresholds.length} thresholds, in order, for these point totals: ${thresholds.join(', ')}. Do not include the totals in your answer; just write them in that order.`,
    );
  } else {
    lines.push('This scale has no thresholds. Return an empty thresholds array.');
  }

  if (level) lines.push(`The party is around level ${level}; pitch the fiction accordingly.`);
  if (partySize) {
    lines.push(
      `There are ${partySize} characters, so provide enough distinct checks that several of them have something worthwhile to try in the same round.`,
    );
  }
  if (options.roundLimit > 0) {
    lines.push(`It must be done in ${options.roundLimit} rounds; set roundLimit to ${options.roundLimit}.`);
  } else {
    lines.push('Decide yourself whether a time limit suits the situation; use 0 for open-ended.');
  }
  if (tone) lines.push(`Tone and setting details to honour: ${tone}`);
  if (language && language.toLowerCase() !== 'en') {
    lines.push(`Write all prose in this language: ${language}. Keep skill names in English.`);
  }
  return lines;
}

/*
 * The same two halves of the request, exposed so a GM can hand them to an
 * agent of their own instead of spending an API call here.
 */
export const BRIEF = {
  system: SYSTEM_PROMPT,
  user: (options) => promptLines(options).join('\n'),
};

export async function generateVictory(options, { signal } = {}) {
  const result = await requestStructured({
    schemaName: 'pf2e_victory_points',
    schema: VICTORY_SCHEMA,
    system: SYSTEM_PROMPT,
    user: promptLines(options).join('\n'),
    signal,
  });
  return toVictoryData(result, options);
}

export const CHECK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['checks'],
  properties: { checks: { type: 'array', items: checkItem() } },
};

export async function generateVictoryCheck(options, { signal } = {}) {
  const result = await requestStructured({
    schemaName: 'pf2e_victory_check',
    schema: CHECK_SCHEMA,
    system: SYSTEM_PROMPT,
    user: [
      ...promptLines(options),
      '',
      'Write one further way to earn points that the list does not already cover. Return it as a single-entry checks array.',
    ].join('\n'),
    signal,
  });
  return (result.checks ?? []).map((item, index) =>
    toCheckEntry(item, options.baseDC, { position: index }),
  );
}

/**
 * One check, with its DC computed here and its award decided here.
 *
 * A check the model flagged as exploiting a weakness pays 2 rather than the
 * table's 1, which is the rules' advice for rewarding a party that did the
 * groundwork. Everything else takes 0, meaning "use the structure's table".
 */
export function toCheckEntry(item, baseDC, { position = 0, hidden = false, revealAt = null } = {}) {
  const id = foundry.utils.randomID();
  const isLore = item.skill === 'lore';
  const label = isLore ? `${item.loreName} Lore` : capitalize(item.skill);
  return {
    id,
    position,
    slug: isLore ? loreSlug(item.loreName) : item.skill,
    label,
    dc: dcFromBase(baseDC, item.dcAdjustment),
    description: item.description ?? '',
    award: item.exploitsWeakness ? 2 : 0,
    hidden,
    revealAt,
  };
}

export function toVictoryData(result, options) {
  const {
    premise,
    objective,
    goal,
    failure,
    baseDC,
    level,
    partySize,
    structure = 'accumulating',
    scale = 'session',
    title,
    model,
  } = options;
  const id = foundry.utils.randomID();
  const { goal: endpoint, thresholds: positions } = victoryScale(scale);

  const checks = {};
  (result.checks ?? []).forEach((item, index) => {
    // A check that needs groundwork starts hidden; the GM reveals it when the
    // party has actually done the groundwork.
    const entry = toCheckEntry(item, baseDC, {
      position: index,
      hidden: Boolean(item.exploitsWeakness),
    });
    checks[entry.id] = entry;
  });

  const thresholds = {};
  positions.forEach((points, index) => {
    const written = result.thresholds?.[index];
    const tid = foundry.utils.randomID();
    thresholds[tid] = {
      id: tid,
      position: index,
      points,
      name: written?.name ?? `Threshold ${index + 1}`,
      description: premiseToHTML(written?.description ?? ''),
      hidden: true,
    };
  });

  const events = {};
  (result.events ?? []).forEach((item, index) => {
    const eid = foundry.utils.randomID();
    events[eid] = {
      id: eid,
      position: index,
      name: item.name,
      description: premiseToHTML(item.description ?? ''),
      trigger: {
        kind: item.triggerKind === 'rounds' ? 'rounds' : 'points',
        at: Math.max(0, Math.trunc(item.triggerAt ?? 0)),
      },
      fired: false,
      hidden: true,
    };
  });

  return {
    id,
    name: title?.trim() || result.title || 'Victory Points',
    position: 0,
    img: '',
    premise: premiseToHTML(premise),
    objective: premiseToHTML(objective),
    goal: premiseToHTML(goal ?? ''),
    failure: premiseToHTML(failure ?? ''),
    gmNotes: premiseToHTML(result.gmNotes ?? ''),
    baseDC,
    level: level ?? 0,
    partySize: partySize ?? 4,
    structure: structure === 'diminishing' ? 'diminishing' : 'accumulating',
    scale,
    hidden: true,
    started: false,
    // Diminishing contests start full and fall; accumulating start empty.
    points: { current: structure === 'diminishing' ? endpoint : 0, goal: endpoint },
    rounds: {
      current: 0,
      max: Math.max(0, Number(result.roundLimit) || 0) || null,
      unit: String(result.roundUnit ?? ''),
    },
    checks,
    thresholds,
    events,
    participants: {},
    ai: {
      generated: true,
      model: model ?? '',
      prompt: promptLines(options).join('\n'),
      generatedAt: Date.now(),
    },
  };
}

export function withListPosition(data, existing) {
  return { ...data, position: nextPosition(existing) };
}
