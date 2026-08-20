import { DC_ADJUSTMENTS, PF2E_SKILLS } from '../constants.js';
import {
  buildOvercomeHTML,
  premiseToHTML,
  buildSkillOptions,
  chasePointGoal,
  guessPartySize,
  nextPosition,
} from '../helpers.js';
import { requestStructured } from './openai.js';

/**
 * One obstacle, as the model returns it.
 *
 * Structured Outputs requires every property to appear in `required` and every
 * object to set `additionalProperties: false`, so optional-ish fields (loreName)
 * are modelled as always-present strings that may be empty.
 */
const OBSTACLE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'description', 'roundAllowance', 'skillOptions', 'criticalSuccess', 'failure'],
  properties: {
    name: { type: 'string' },
    description: {
      type: 'string',
      description: 'One or two sentences describing the obstacle in play.',
    },
    roundAllowance: {
      type: 'integer',
      description:
        'Rounds the party may spend on this obstacle before it is called, from 1 to 5. Use 1 for a quick beat and 4 or 5 for a set piece.',
    },
    skillOptions: {
      type: 'array',
      description:
        'Two to four distinct ways to overcome the obstacle. Vary the skills so different party roles contribute.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['skill', 'loreName', 'dcAdjustment', 'description'],
        properties: {
          skill: { type: 'string', enum: PF2E_SKILLS },
          loreName: {
            type: 'string',
            description:
              'Subject of the Lore skill when skill is "lore" (e.g. "Sailing"); otherwise an empty string.',
          },
          dcAdjustment: {
            type: 'string',
            enum: Object.keys(DC_ADJUSTMENTS),
            description:
              'Difficulty relative to the GM-supplied base DC. Use "standard" for the obvious approach and "hard" or "very-hard" for clever shortcuts.',
          },
          description: {
            type: 'string',
            description: 'What the character does, in one sentence.',
          },
        },
      },
    },
    criticalSuccess: {
      type: 'string',
      description: 'What an extra-good result earns beyond the usual 2 chase points.',
    },
    failure: {
      type: 'string',
      description: 'The cost of failing here, phrased as fiction rather than raw mechanics.',
    },
  },
};

/**
 * Full generation payload. Note there is no `premise`: the GM writes that and it
 * is stored verbatim, so the model only ever elaborates on it.
 */
export const CHASE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'gmNotes', 'roundLimit', 'obstacles'],
  properties: {
    name: {
      type: 'string',
      description: 'Short evocative title drawn from the premise.',
    },
    gmNotes: {
      type: 'string',
      description:
        'GM-only guidance: pacing advice, what total failure means, and any twist worth foreshadowing.',
    },
    roundLimit: {
      type: 'integer',
      description: 'Rounds before the chase is lost, or 0 for an untimed chase.',
    },
    obstacles: {
      type: 'array',
      description: 'Obstacles in the order the party encounters them.',
      items: OBSTACLE_SCHEMA,
    },
  },
};

/** Obstacles-only payload, for regenerating inside an existing chase. */
export const OBSTACLES_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['obstacles'],
  properties: {
    obstacles: {
      type: 'array',
      description: 'Obstacles in the order the party encounters them.',
      items: OBSTACLE_SCHEMA,
    },
  },
};

/** One-obstacle payload, for appending to a chase already in progress. */
export const SINGLE_OBSTACLE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['obstacle'],
  properties: { obstacle: OBSTACLE_SCHEMA },
};

/**
 * A fork: one contrasting alternative route, plus how the approaches at the
 * forking obstacle route the party onto each side.
 */
export const FORK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['alternative', 'routing'],
  properties: {
    alternative: OBSTACLE_SCHEMA,
    routing: {
      type: 'array',
      description:
        'One entry per existing approach at the forking obstacle, saying which route succeeding with it commits the character to.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['optionLabel', 'leadsTo'],
        properties: {
          optionLabel: {
            type: 'string',
            description: 'The approach, copied exactly from the list supplied.',
          },
          leadsTo: {
            type: 'string',
            enum: ['A', 'B'],
            description: 'Route this approach commits the character to.',
          },
        },
      },
    },
  },
};

const SYSTEM_PROMPT = `You are a Pathfinder Second Edition Game Master designing a chase using the chase subsystem from GM Core.

Rules you must respect:
- A chase is a sequence of obstacles. Each round every participant attempts one check against the obstacle they face.
- A success earns 1 chase point, a critical success earns 2, a critical failure may cost a chase point. An obstacle is cleared once the party accumulates its chase point goal.
- Do not decide how many chase points an obstacle needs. The caller computes that from party size. Instead choose a round allowance: how long the party should be able to linger here.
- Every obstacle needs several skill options so that characters with different skills can all contribute. Do not offer the same skill twice on one obstacle.
- Perception and Lore are valid options. Use Lore sparingly and give it a concrete subject.
- Never invent numeric DCs. The GM supplies one base DC for the whole chase. You only choose a difficulty adjustment per skill option, and the caller applies it.
- The premise is written by the GM and is authoritative. Build obstacles that follow from it. Do not contradict it, restate it, or rewrite it.
- Write fiction, not stat blocks. Keep prose tight and usable at the table.`;

/** Shared instruction body for both full-chase and obstacles-only runs. */
function promptLines(options) {
  const { premise, baseDC, obstacleCount, difficulty, level, tone, language } = options;
  const lines = [
    'GM-written premise (authoritative, do not rewrite):',
    premise,
    '',
    `Base DC for this chase: ${baseDC}. Every skill option's DC is this number plus your chosen adjustment, which ranges from -10 ("incredibly-easy") to +10 ("incredibly-hard").`,
  ];

  if (level) lines.push(`The party is roughly level ${level}; pitch the fiction accordingly.`);
  if (options.partySize) {
    lines.push(
      `There are ${options.partySize} characters, so every obstacle needs enough distinct approaches for that many people to contribute in the same round.`,
    );
  }

  if (obstacleCount > 0) {
    lines.push(`Produce exactly ${obstacleCount} obstacles.`);
  } else if (obstacleCount === 0) {
    lines.push(
      'Choose the number of obstacles yourself, between 3 and 6, based on how much the premise can sustain.',
    );
  }

  if (difficulty === 'low') {
    lines.push('Overall difficulty is low: favour "easy" and "standard" adjustments and goals of 1 to 2.');
  } else if (difficulty === 'high') {
    lines.push('Overall difficulty is high: favour "hard" and "very-hard" adjustments and goals of 3 to 4.');
  } else if (difficulty === 'moderate') {
    lines.push('Overall difficulty is moderate: mostly "standard" adjustments with occasional outliers.');
  } else {
    lines.push(
      'Choose the difficulty spread yourself from what the premise implies, ramping up toward the final obstacle.',
    );
  }

  const existing = options.existingObstacles ?? [];
  if (existing.length) {
    lines.push(
      `The chase already contains these obstacles, in order: ${existing.join('; ')}. Do not repeat them or reuse their imagery.`,
    );
  }

  if (tone) lines.push(`Tone and setting details to honour: ${tone}`);
  if (language && language.toLowerCase() !== 'en') {
    lines.push(`Write all prose in this language: ${language}. Keep skill names in English.`);
  }

  return lines;
}

/** Generate a whole chase around a GM-written premise. */
export async function generateChase(options, { signal } = {}) {
  const lines = promptLines(options);
  if (options.roundLimit > 0) {
    lines.push(`The chase is lost after ${options.roundLimit} rounds; set roundLimit to ${options.roundLimit}.`);
  } else {
    lines.push('Decide yourself whether a round limit suits the premise; use 0 for untimed.');
  }
  if (options.title) {
    lines.push(`Use exactly this title: ${options.title}`);
  }

  const result = await requestStructured({
    schemaName: 'pf2e_chase',
    schema: CHASE_SCHEMA,
    system: SYSTEM_PROMPT,
    user: lines.join('\n'),
    signal,
  });

  return toChaseData(result, options);
}

/** Generate replacement obstacles for a chase that already has a premise. */
export async function generateObstacles(options, { signal } = {}) {
  const result = await requestStructured({
    schemaName: 'pf2e_chase_obstacles',
    schema: OBSTACLES_SCHEMA,
    system: SYSTEM_PROMPT,
    user: promptLines(options).join('\n'),
    signal,
  });

  return toObstacleRecord(result.obstacles ?? [], options.baseDC, options.partySize);
}

/**
 * Generate one further obstacle for a chase already in play. The existing
 * obstacle names are passed as context so the model continues the sequence
 * instead of restarting it.
 */
export async function generateOneObstacle(options, { signal } = {}) {
  const lines = promptLines({ ...options, obstacleCount: -1 });
  lines.push(
    'Produce exactly one new obstacle that follows on from the ones listed above and escalates the pressure.',
  );

  const result = await requestStructured({
    schemaName: 'pf2e_chase_obstacle',
    schema: SINGLE_OBSTACLE_SCHEMA,
    system: SYSTEM_PROMPT,
    user: lines.join('\n'),
    signal,
  });

  return result.obstacle;
}

/**
 * Generate an alternative route for a step, and decide which of the forking
 * obstacle's approaches leads onto each side.
 */
export async function generateFork(options, { signal } = {}) {
  const lines = promptLines({ ...options, obstacleCount: -1 });
  lines.push('');
  lines.push(
    `The party reaches an obstacle called "${options.forkFrom.name}", which is about to become a fork with two routes.`,
  );
  if (options.forkFrom.description) {
    lines.push(`That obstacle: ${options.forkFrom.description}`);
  }
  lines.push(
    'Route A is that existing obstacle, unchanged. Invent Route B: a genuinely different way through the same moment in the chase, favouring different skills and carrying a different risk. It is an alternative, not a sequel.',
  );
  if (options.forkFrom.optionLabels?.length) {
    lines.push(
      `Then, for each of these approaches at the fork, say whether succeeding with it puts the character on Route A or Route B: ${options.forkFrom.optionLabels.join('; ')}`,
    );
    lines.push('Split them sensibly and do not put every approach on the same route.');
  }

  return requestStructured({
    schemaName: 'pf2e_chase_fork',
    schema: FORK_SCHEMA,
    system: SYSTEM_PROMPT,
    user: lines.join('\n'),
    signal,
  });
}

/**
 * Map one generated obstacle onto the stored shape.
 *
 * The chase point goal is not the model's to choose: it comes from the
 * published formula, alternating partySize-1 and partySize-2 by position.
 */
export function toObstacleEntry(obstacle, baseDC, { position = 0, locked = true, partySize } = {}) {
  const id = foundry.utils.randomID();
  const size = partySize ?? guessPartySize();

  return {
    id,
    position,
    name: obstacle.name,
    img: '',
    locked,
    chasePoints: {
      goal: chasePointGoal(size, position),
      current: 0,
    },
    rounds: {
      current: 0,
      max: Math.clamp(obstacle.roundAllowance ?? 2, 1, 10),
    },
    skillOptions: buildSkillOptions(obstacle, baseDC),
    overcome: buildOvercomeHTML(obstacle, baseDC),
  };
}

/** Map generated obstacles onto the stored id-keyed shape. */
export function toObstacleRecord(obstacles, baseDC, partySize) {
  const record = {};
  obstacles.forEach((obstacle, index) => {
    // Only the first obstacle starts revealed; the GM unlocks the rest in play.
    const entry = toObstacleEntry(obstacle, baseDC, {
      position: index,
      locked: index > 0,
      partySize,
    });
    record[entry.id] = entry;
  });
  return record;
}

/** Map a full generated payload onto the stored chase shape. */
export function toChaseData(result, options) {
  const { premise, baseDC, level, title, model } = options;
  const partySize = options.partySize ?? guessPartySize();
  const id = foundry.utils.randomID();

  return {
    id,
    // The GM's title wins; the model's suggestion is only a fallback.
    name: title || result.name || game.i18n.localize('PFAI.Chase.Untitled'),
    position: 0,
    img: '',
    // Stored verbatim, exactly as typed.
    premise: premiseToHTML(premise),
    gmNotes: `<p>${result.gmNotes ?? ''}</p>`,
    baseDC,
    level: level ?? 1,
    partySize,
    hidden: true,
    started: false,
    rounds: {
      current: 0,
      max: result.roundLimit > 0 ? result.roundLimit : null,
    },
    obstacles: toObstacleRecord(result.obstacles ?? [], baseDC, partySize),
    participants: {},
    ai: {
      generated: true,
      model: model ?? '',
      prompt: premise ?? '',
      generatedAt: Date.now(),
    },
  };
}

/** Position a freshly generated chase at the end of the existing list. */
export { premiseToHTML };

export function withListPosition(chaseData, existing) {
  return { ...chaseData, position: nextPosition(existing) };
}
