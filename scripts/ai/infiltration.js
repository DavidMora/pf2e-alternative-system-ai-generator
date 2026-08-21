import { DC_ADJUSTMENTS, PF2E_SKILLS } from '../constants.js';
import { capitalize, dcFromBase, loreSlug, nextPosition, premiseToHTML } from '../helpers.js';
import { requestStructured } from './openai.js';

const CHECK_ITEM = {
  type: 'object',
  additionalProperties: false,
  required: ['skill', 'loreName', 'dcAdjustment', 'description'],
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
        'Difficulty relative to the GM-supplied base DC. Quiet, patient approaches should be easier than brazen ones.',
    },
    description: {
      type: 'string',
      description: 'What a character actually does, in one sentence.',
    },
  },
};

function checkArray(description, min = 'Two to four') {
  return {
    type: 'array',
    description: `${min} ways to handle this. Vary the skills so different characters can contribute. ${description}`,
    items: CHECK_ITEM,
  };
}

export const INFILTRATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'title',
    'gmNotes',
    'roundLimit',
    'objectives',
    'awarenessBreakpoints',
    'complications',
    'opportunities',
    'preparations',
  ],
  properties: {
    title: { type: 'string', description: 'Short evocative name for the job.' },
    gmNotes: {
      type: 'string',
      description: 'Pacing advice, what being caught actually means, and any twist worth foreshadowing.',
    },
    roundLimit: {
      type: 'integer',
      description: 'Rounds before the window closes, or 0 for no hard limit.',
    },
    objectives: {
      type: 'array',
      description:
        'Two or three broad goals in the order the party meets them: get inside, reach the vault, get out again.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'description', 'obstacles'],
        properties: {
          name: { type: 'string' },
          description: { type: 'string', description: 'One sentence on what this stage is.' },
          obstacles: {
            type: 'array',
            description: 'Two to four specific problems standing in the way of this objective.',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['name', 'description', 'pointsNeeded', 'individual', 'checks'],
              properties: {
                name: { type: 'string' },
                description: { type: 'string', description: 'The problem, in one or two sentences.' },
                pointsNeeded: {
                  type: 'integer',
                  description: 'Infiltration points to clear it, from 1 to 3.',
                },
                individual: {
                  type: 'boolean',
                  description:
                    'True when every character must get past it themselves, such as slipping by a guard, rather than the party clearing it together.',
                },
                checks: checkArray('These earn infiltration points.'),
              },
            },
          },
        },
      },
    },
    awarenessBreakpoints: {
      type: 'array',
      description:
        'What happens as the place notices them, ascending. Three or four, typically around 5, 10, 15 and 20 awareness.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['at', 'name', 'description', 'dcIncrease'],
        properties: {
          at: { type: 'integer', description: 'Awareness points at which this bites.' },
          name: { type: 'string', description: 'Short label, e.g. "The watch doubles".' },
          description: { type: 'string', description: 'What changes, in GM-readable prose.' },
          dcIncrease: {
            type: 'integer',
            description:
              'Ongoing rise in every infiltration DC once passed, from 0 to 4. The last breakpoint may instead mean the job is blown; use 0 and say so in the description.',
          },
        },
      },
    },
    complications: {
      type: 'array',
      description:
        'One to three problems that interrupt everything until dealt with: a patrol doubling back, a door found locked from the far side.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'description', 'triggerKind', 'triggerAt', 'checks'],
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          triggerKind: {
            type: 'string',
            enum: ['awareness', 'rounds', 'manual'],
            description:
              'Whether this fires at an awareness total, after so many rounds, or only when the GM calls for it.',
          },
          triggerAt: { type: 'integer', description: 'The awareness total or round number; 0 for manual.' },
          checks: checkArray('These resolve the complication rather than earning progress.', 'One to three'),
        },
      },
    },
    opportunities: {
      type: 'array',
      description:
        'One or two optional risks that pay off in something other than progress: a password overheard, a ledger worth stealing.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'description', 'benefit', 'checks'],
        properties: {
          name: { type: 'string' },
          description: { type: 'string', description: 'What the chance is.' },
          benefit: {
            type: 'string',
            description: 'What taking it earns — lowered awareness, a bonus later, a way past something.',
          },
          checks: checkArray('These seize the opportunity.', 'One to three'),
        },
      },
    },
    preparations: {
      type: 'array',
      description:
        'Two to four things the party can do beforehand to earn edge points: bribe a contact, forge papers, scout the place.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'description', 'skill', 'loreName', 'dcAdjustment'],
        properties: {
          name: { type: 'string' },
          description: { type: 'string', description: 'What the character spends the time doing.' },
          skill: { type: 'string', enum: PF2E_SKILLS },
          loreName: { type: 'string', description: 'Lore subject, or an empty string.' },
          dcAdjustment: { type: 'string', enum: Object.keys(DC_ADJUSTMENTS) },
        },
      },
    },
  },
};

const SYSTEM_PROMPT = `You are a Pathfinder Second Edition Game Master preparing an Infiltration using the subsystem from GM Core.

Rules you must respect:
- The party works through objectives. Each objective has obstacles, and each obstacle needs infiltration points to clear.
- A check earns 1 infiltration point on a success and 2 on a critical success. A failure earns nothing and raises awareness by 1; a critical failure raises it by 2.
- Awareness also rises by 1 at the end of every round. It is the real clock: the party is racing being noticed, not the sun.
- Awareness breakpoints are what being noticed costs. They typically bite around 5, 10, 15 and 20, and usually raise every DC.
- Complications stop everything until resolved. Opportunities are optional and pay off in something other than progress.
- Preparations happen before the job and earn edge points, which the party spends to turn a failure into a success.
- Never invent numeric DCs. The GM supplies one base DC. You only choose a difficulty adjustment per check, and the caller applies it.
- The target and the situation are written by the GM and are authoritative. Build on them; do not contradict, restate or rewrite them.
- Write usable table prose. Every check should sound like something a player would actually try in that specific place.`;

function promptLines(options) {
  const { premise, target, goal, baseDC, level, partySize, tone, language } = options;
  const lines = [
    'GM-written situation (authoritative, do not rewrite):',
    premise,
    '',
    `What is being infiltrated: ${target}`,
  ];
  if (goal) lines.push(`What getting away with it buys them: ${goal}`);
  lines.push(
    '',
    `Base DC: ${baseDC}. Every check's DC is this number plus your chosen adjustment, from -10 ("incredibly-easy") to +10 ("incredibly-hard").`,
  );

  if (level) lines.push(`The party is around level ${level}; pitch the fiction accordingly.`);
  if (partySize) {
    lines.push(
      `There are ${partySize} characters. Give each obstacle enough distinct checks that several of them have something worthwhile to try in the same round, and size the point goals so the job takes several rounds without dragging.`,
    );
  }
  if (options.roundLimit > 0) {
    lines.push(`The window is ${options.roundLimit} rounds; set roundLimit to ${options.roundLimit}.`);
  } else {
    lines.push('Decide yourself whether a hard time limit suits this; use 0 if awareness alone is pressure enough.');
  }
  if (tone) lines.push(`Tone and setting details to honour: ${tone}`);
  if (language && language.toLowerCase() !== 'en') {
    lines.push(`Write all prose in this language: ${language}. Keep skill names in English.`);
  }
  return lines;
}

export async function generateInfiltration(options, { signal } = {}) {
  const result = await requestStructured({
    schemaName: 'pf2e_infiltration',
    schema: INFILTRATION_SCHEMA,
    system: SYSTEM_PROMPT,
    user: promptLines(options).join('\n'),
    signal,
  });
  return toInfiltrationData(result, options);
}

/** One further obstacle for an infiltration already under way. */
export const OBSTACLE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['obstacle'],
  properties: {
    obstacle: INFILTRATION_SCHEMA.properties.objectives.items.properties.obstacles.items,
  },
};

export async function generateObstacle(options, { signal } = {}) {
  const lines = promptLines(options);
  lines.push('');
  if (options.objectiveName) lines.push(`It belongs to the objective: ${options.objectiveName}.`);
  if (options.existingNames?.length) {
    lines.push(`These obstacles already exist: ${options.existingNames.join('; ')}. Do not repeat them.`);
  }
  lines.push('Produce exactly one further obstacle for that objective.');
  if (options.becauseOf) lines.push(`It appears because: ${options.becauseOf}.`);

  const result = await requestStructured({
    schemaName: 'pf2e_infiltration_obstacle',
    schema: OBSTACLE_SCHEMA,
    system: SYSTEM_PROMPT,
    user: lines.join('\n'),
    signal,
  });
  return result.obstacle;
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

/** Map one generated obstacle onto the stored shape. */
export function toObstacleEntry(obstacle, baseDC, { position = 0, hidden = false } = {}) {
  const id = foundry.utils.randomID();
  return {
    id,
    position,
    name: obstacle.name,
    description: `<p>${obstacle.description ?? ''}</p>`,
    hidden,
    revealAt: null,
    individual: Boolean(obstacle.individual),
    infiltrationPoints: { current: 0, goal: Math.clamp(obstacle.pointsNeeded ?? 2, 1, 6) },
    individualPoints: {},
    checks: toCheckRecord(obstacle.checks, baseDC),
  };
}

export function toInfiltrationData(result, options) {
  const { premise, target, goal, baseDC, level, partySize, title, model } = options;
  const id = foundry.utils.randomID();

  const objectives = {};
  (result.objectives ?? []).forEach((objective, index) => {
    const oid = foundry.utils.randomID();
    const obstacles = {};
    (objective.obstacles ?? []).forEach((obstacle, oIndex) => {
      const entry = toObstacleEntry(obstacle, baseDC, { position: oIndex });
      obstacles[entry.id] = entry;
    });
    objectives[oid] = {
      id: oid,
      position: index,
      name: objective.name,
      description: `<p>${objective.description ?? ''}</p>`,
      // Later stages are hidden until the party gets that far.
      hidden: index > 0,
      obstacles,
    };
  });

  const awarenessBreakpoints = {};
  [...(result.awarenessBreakpoints ?? [])]
    .sort((a, b) => a.at - b.at)
    .forEach((breakpoint, index) => {
      const bid = foundry.utils.randomID();
      awarenessBreakpoints[bid] = {
        id: bid,
        position: index,
        at: Math.max(1, breakpoint.at ?? (index + 1) * 5),
        name: breakpoint.name,
        description: `<p>${breakpoint.description ?? ''}</p>`,
        dcIncrease: Math.clamp(breakpoint.dcIncrease ?? 0, 0, 10),
        hidden: true,
        fired: false,
      };
    });

  const complications = {};
  (result.complications ?? []).forEach((complication, index) => {
    const cid = foundry.utils.randomID();
    complications[cid] = {
      id: cid,
      position: index,
      name: complication.name,
      description: `<p>${complication.description ?? ''}</p>`,
      hidden: true,
      trigger: {
        kind: ['awareness', 'rounds', 'manual'].includes(complication.triggerKind)
          ? complication.triggerKind
          : 'awareness',
        at: Math.max(0, complication.triggerAt ?? 0),
      },
      fired: false,
      resolved: false,
      checks: toCheckRecord(complication.checks, baseDC),
    };
  });

  const opportunities = {};
  (result.opportunities ?? []).forEach((opportunity, index) => {
    const oid = foundry.utils.randomID();
    opportunities[oid] = {
      id: oid,
      position: index,
      name: opportunity.name,
      description: `<p>${opportunity.description ?? ''}</p>`,
      benefit: `<p>${opportunity.benefit ?? ''}</p>`,
      hidden: true,
      used: false,
      checks: toCheckRecord(opportunity.checks, baseDC),
    };
  });

  const preparations = {};
  (result.preparations ?? []).forEach((preparation, index) => {
    const pid = foundry.utils.randomID();
    const isLore = preparation.skill === 'lore' && preparation.loreName;
    preparations[pid] = {
      id: pid,
      position: index,
      name: preparation.name,
      description: `<p>${preparation.description ?? ''}</p>`,
      slug: isLore ? loreSlug(preparation.loreName) : preparation.skill,
      label: isLore ? `${preparation.loreName} Lore` : capitalize(preparation.skill),
      dc: dcFromBase(baseDC, preparation.dcAdjustment),
      hidden: false,
      used: false,
    };
  });

  return {
    id,
    name: title || result.title || game.i18n.localize('PFAI.Infiltration.Untitled'),
    position: 0,
    img: '',
    premise: premiseToHTML(premise),
    target: premiseToHTML(target),
    goal: premiseToHTML(goal),
    gmNotes: `<p>${result.gmNotes ?? ''}</p>`,
    baseDC,
    level: level ?? 1,
    partySize: partySize ?? 4,
    hidden: true,
    started: false,
    rounds: { current: 0, max: result.roundLimit > 0 ? result.roundLimit : null },
    awareness: { current: 0, perRound: 1 },
    awarenessBreakpoints,
    edgePoints: 0,
    preparations,
    objectives,
    complications,
    opportunities,
    participants: {},
    ai: {
      generated: true,
      model: model ?? '',
      prompt: target ?? premise ?? '',
      generatedAt: Date.now(),
    },
  };
}

export function withListPosition(data, existing) {
  return { ...data, position: nextPosition(existing) };
}
