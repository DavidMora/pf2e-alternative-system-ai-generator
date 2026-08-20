import { DC_ADJUSTMENTS, PF2E_SKILLS } from '../constants.js';
import { capitalize, dcFromBase, loreSlug, nextPosition, premiseToHTML } from '../helpers.js';
import { requestStructured } from './openai.js';

/** A skill approach the model proposes. Shared by discoveries and influence. */
function skillItem(extraProps = {}, extraRequired = []) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['skill', 'loreName', 'dcAdjustment', 'description', ...extraRequired],
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
          'Difficulty relative to the GM-supplied base DC. The approach this NPC most welcomes should be the easiest.',
      },
      description: {
        type: 'string',
        description: 'How a character uses this approach on this person, in one sentence.',
      },
      ...extraProps,
    },
  };
}

function revealableItem(modifierHint) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['name', 'description', 'strong'],
    properties: {
      name: { type: 'string', description: 'Short label, a few words.' },
      description: { type: 'string', description: 'One sentence the GM can read at the table.' },
      strong: { type: 'boolean', description: modifierHint },
    },
  };
}

export const INFLUENCE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'title',
    'npcWants',
    'disposition',
    'perception',
    'will',
    'roundLimit',
    'gmNotes',
    'discoveries',
    'influenceSkills',
    'thresholds',
    'weaknesses',
    'resistances',
    'penalties',
  ],
  properties: {
    title: { type: 'string', description: 'Short evocative name for this encounter.' },
    npcWants: {
      type: 'string',
      description:
        'What this person actually wants, including what they will never concede. Two or three sentences of GM guidance.',
    },
    disposition: {
      type: 'string',
      description: 'Their starting attitude in a few words, e.g. "guarded but curious".',
    },
    perception: { type: 'integer', description: 'Perception modifier for the stat block.' },
    will: { type: 'integer', description: 'Will modifier for the stat block.' },
    roundLimit: {
      type: 'integer',
      description: 'Rounds of conversation available before the opportunity closes, or 0 for open-ended.',
    },
    gmNotes: {
      type: 'string',
      description: 'Pacing advice, what failure costs, and any twist worth foreshadowing.',
    },
    discoveries: {
      type: 'array',
      description:
        'Two to four ways to learn about this person before working on them. Vary the skills.',
      items: skillItem(
        {
          reveals: {
            type: 'string',
            description: 'What a success actually tells the party about them.',
          },
        },
        ['reveals'],
      ),
    },
    influenceSkills: {
      type: 'array',
      description:
        'Three to six ways to win them over, so different party members can each contribute. Do not repeat a skill.',
      items: skillItem(),
    },
    thresholds: {
      type: 'array',
      description:
        'What they concede as influence accumulates, in ascending order of cost. Three or four.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['points', 'name', 'description'],
        properties: {
          points: { type: 'integer', description: 'Influence points needed, ascending.' },
          name: { type: 'string', description: 'Short label for the concession.' },
          description: { type: 'string', description: 'What they actually do or give.' },
        },
      },
    },
    weaknesses: {
      type: 'array',
      description: 'One or two soft spots that make them easier to sway once discovered.',
      items: revealableItem('True for a major soft spot (-5 DC), false for a minor one (-2 DC).'),
    },
    resistances: {
      type: 'array',
      description: 'One or two things that make them harder to sway.',
      items: revealableItem('True for a strong resistance (+5 DC), false for a minor one (+2 DC).'),
    },
    penalties: {
      type: 'array',
      description: 'Nought to two blunders that would set the party back if they commit them.',
      items: revealableItem('True for a serious blunder (+5 DC), false for a minor one (+2 DC).'),
    },
  },
};

const SYSTEM_PROMPT = `You are a Pathfinder Second Edition Game Master preparing an Influence encounter using the subsystem from GM Core.

Rules you must respect:
- The party spends rounds of conversation trying to win an NPC over. Each round every character may attempt one Influence check or one Discovery check.
- An Influence check earns 1 influence point on a success and 2 on a critical success; a critical failure costs 1 point.
- Influence thresholds are point totals that buy a specific concession. List them in ascending order, each worth more than the last.
- Discovery checks reveal information: the NPC's easiest skill, their bias, a weakness or a resistance. They do not earn points.
- Weaknesses lower the DC once found, resistances and penalties raise it. Minor ones shift by 2, strong ones by 5.
- Never invent numeric DCs. The GM supplies one base DC. You only choose a difficulty adjustment per approach, and the caller applies it.
- The person, the situation, and what the party wants are all written by the GM and are authoritative. Build on them. Do not contradict, restate or rewrite them.
- Write usable table prose, not stat blocks. Every approach must sound like something a player would actually say or do to this specific person.`;

function promptLines(options) {
  const { premise, npcName, npcDescription, goal, baseDC, level, partySize, tone, language } = options;
  const lines = [
    'GM-written situation (authoritative, do not rewrite):',
    premise,
    '',
    `The person to be won over: ${npcName}`,
    npcDescription,
    '',
    `What the party wants from them: ${goal}`,
    '',
    `Base DC: ${baseDC}. Every approach's DC is this number plus your chosen adjustment, from -10 ("incredibly-easy") to +10 ("incredibly-hard").`,
  ];

  if (level) lines.push(`The party is around level ${level}; pitch the fiction and the stat block accordingly.`);
  if (partySize) {
    lines.push(
      `There are ${partySize} characters, so provide enough distinct influence skills that each of them has something worthwhile to try in the same round.`,
    );
    lines.push(
      `Scale the thresholds so the final concession is a real achievement for ${partySize} characters over several rounds.`,
    );
  }
  if (options.roundLimit > 0) {
    lines.push(`The conversation lasts ${options.roundLimit} rounds; set roundLimit to ${options.roundLimit}.`);
  } else {
    lines.push('Decide yourself whether a round limit suits the situation; use 0 for open-ended.');
  }
  if (tone) lines.push(`Tone and setting details to honour: ${tone}`);
  if (language && language.toLowerCase() !== 'en') {
    lines.push(`Write all prose in this language: ${language}. Keep skill names in English.`);
  }
  return lines;
}

/** One further approach for an encounter already in play. */
export const APPROACH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['approach'],
  properties: { approach: skillItem({ reveals: { type: 'string', description: 'For a discovery, what a success tells the party; otherwise an empty string.' } }, ['reveals']) },
};

/**
 * Generate one more way to reach this person, for a conversation that has
 * opened up. The existing approaches are passed so it does not repeat them.
 */
export async function generateApproach(options, { signal } = {}) {
  const lines = promptLines(options);
  lines.push('');
  if (options.existingLabels?.length) {
    lines.push(`These approaches already exist: ${options.existingLabels.join('; ')}. Do not repeat them.`);
  }
  if (options.kind === 'discovery') {
    lines.push('Produce exactly one further discovery check: a new way to learn something about this person, and what it tells the party.');
  } else {
    lines.push('Produce exactly one further way to win them over. Leave "reveals" as an empty string.');
  }
  if (options.becauseOf) {
    lines.push(`It becomes available because: ${options.becauseOf}. Let that show in how it reads.`);
  }

  const result = await requestStructured({
    schemaName: 'pf2e_influence_approach',
    schema: APPROACH_SCHEMA,
    system: SYSTEM_PROMPT,
    user: lines.join('\n'),
    signal,
  });
  return result.approach;
}

/** Map one generated approach onto the stored entry shape. */
export function toApproachEntry(item, baseDC, { position = 0, hidden = true, revealAt = null } = {}) {
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
    ...(item.reveals ? { reveals: `<p>${item.reveals}</p>` } : {}),
  };
}

export async function generateInfluence(options, { signal } = {}) {
  const result = await requestStructured({
    schemaName: 'pf2e_influence',
    schema: INFLUENCE_SCHEMA,
    system: SYSTEM_PROMPT,
    user: promptLines(options).join('\n'),
    signal,
  });
  return toInfluenceData(result, options);
}

/** Map generated skill entries onto the stored id-keyed shape. */
function toSkillRecord(items, baseDC, { hidden }) {
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
      hidden,
      ...(item.reveals !== undefined ? { reveals: `<p>${item.reveals}</p>` } : {}),
    };
  });
  return record;
}

function toRevealableRecord(items, sign) {
  const record = {};
  (items ?? []).forEach((item, index) => {
    const id = foundry.utils.randomID();
    record[id] = {
      id,
      position: index,
      name: item.name,
      description: `<p>${item.description ?? ''}</p>`,
      // Published values: minor shifts by 2, strong by 5.
      modifier: sign * (item.strong ? 5 : 2),
      used: false,
      hidden: true,
    };
  });
  return record;
}

export function toInfluenceData(result, options) {
  const { premise, npcName, npcDescription, goal, baseDC, level, partySize, title, model } = options;
  const id = foundry.utils.randomID();

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

  return {
    id,
    // The GM's title wins; the model's is only a fallback.
    name: title || result.title || npcName || game.i18n.localize('PFAI.Influence.Untitled'),
    position: 0,
    img: '',
    premise: premiseToHTML(premise),
    gmNotes: `<p>${result.gmNotes ?? ''}</p>`,
    npc: {
      name: npcName,
      // Stored verbatim, exactly as the GM wrote it.
      description: premiseToHTML(npcDescription),
      wants: `<p>${result.npcWants ?? ''}</p>`,
      disposition: String(result.disposition ?? ''),
      uuid: options.npcUuid ?? '',
    },
    goal: premiseToHTML(goal),
    baseDC,
    level: level ?? 1,
    partySize: partySize ?? 4,
    perception: Number(result.perception) || 0,
    will: Number(result.will) || 0,
    hidden: true,
    started: false,
    influencePoints: 0,
    rounds: { current: 0, max: result.roundLimit > 0 ? result.roundLimit : null },
    // Discoveries are how you find things out, so they start visible.
    discoveries: toSkillRecord(result.discoveries, baseDC, { hidden: false }),
    // Influence skills are what discovery reveals, so they start hidden.
    influenceSkills: toSkillRecord(result.influenceSkills, baseDC, { hidden: true }),
    thresholds,
    weaknesses: toRevealableRecord(result.weaknesses, -1),
    resistances: toRevealableRecord(result.resistances, 1),
    penalties: toRevealableRecord(result.penalties, 1),
    participants: {},
    ai: {
      generated: true,
      model: model ?? '',
      prompt: premise ?? '',
      generatedAt: Date.now(),
    },
  };
}

export function withListPosition(data, existing) {
  return { ...data, position: nextPosition(existing) };
}
