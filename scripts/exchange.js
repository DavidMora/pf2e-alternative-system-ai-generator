import { DEFAULT_BASE_DC, MODULE_ID } from './constants.js';
import { guessPartyLevel, guessPartySize, nextPosition } from './helpers.js';
import { isSubsystem, subsystem } from './subsystems.js';
import { BRIEF as CHASE_BRIEF, CHASE_SCHEMA, toChaseData } from './ai/chase.js';
import { BRIEF as INFLUENCE_BRIEF, INFLUENCE_SCHEMA, toInfluenceData } from './ai/influence.js';
import { BRIEF as RESEARCH_BRIEF, RESEARCH_SCHEMA, toResearchData } from './ai/research.js';
import {
  BRIEF as INFILTRATION_BRIEF,
  INFILTRATION_SCHEMA,
  toInfiltrationData,
} from './ai/infiltration.js';
import {
  BRIEF as LEADERSHIP_BRIEF,
  LEADERSHIP_SCHEMA,
  toLeadershipData,
} from './ai/leadership.js';

/**
 * Trading events with an agent that is not this module.
 *
 * Two file shapes travel over this boundary:
 *
 *   brief    what a GM hands to an outside agent: the schema, the prompt this
 *            module would have sent, and the prose the GM already wrote.
 *   payload  what comes back: the same JSON the model would have returned,
 *            which goes through the ordinary mapping so DCs are still computed
 *            here from difficulty adjustments and the GM's prose is still the
 *            GM's. An agent cannot smuggle a DC in, because the schema has no
 *            field for one.
 *
 * A stored event exported for backup is a third shape and still imports; it
 * skips the mapping, having been through it once already.
 */

export const EXCHANGE_VERSION = 1;

export const EXCHANGE_KINDS = { brief: 'brief', payload: 'payload', event: 'event' };

/**
 * What each subsystem needs from the GM, and what it does with what comes back.
 *
 * `given` mirrors the fields the generate dialog collects, because the brief is
 * that dialog's contents written to a file.
 */
export const EXCHANGE = {
  chase: {
    schema: CHASE_SCHEMA,
    brief: CHASE_BRIEF,
    toData: toChaseData,
    required: ['premise'],
    optional: ['title', 'obstacleCount', 'difficulty', 'tone', 'language'],
  },
  influence: {
    schema: INFLUENCE_SCHEMA,
    brief: INFLUENCE_BRIEF,
    toData: toInfluenceData,
    required: ['premise', 'npcName', 'npcDescription'],
    optional: ['title', 'goal', 'roundLimit', 'tone', 'language'],
  },
  research: {
    schema: RESEARCH_SCHEMA,
    brief: RESEARCH_BRIEF,
    toData: toResearchData,
    required: ['premise', 'topic'],
    optional: ['title', 'goal', 'roundLimit', 'tone', 'language'],
  },
  infiltration: {
    schema: INFILTRATION_SCHEMA,
    brief: INFILTRATION_BRIEF,
    toData: toInfiltrationData,
    required: ['premise', 'target'],
    optional: ['title', 'goal', 'roundLimit', 'tone', 'language'],
  },
  leadership: {
    schema: LEADERSHIP_SCHEMA,
    brief: LEADERSHIP_BRIEF,
    toData: toLeadershipData,
    required: ['premise', 'organization'],
    optional: ['title', 'goal', 'organizationLevel', 'tone', 'language'],
  },
};

/** Numbers the GM supplies, and the range each has to sit in. */
const GIVEN_RANGES = {
  baseDC: [1, 60],
  level: [0, 25],
  partySize: [1, 10],
  organizationLevel: [1, 20],
  obstacleCount: [1, 12],
  roundLimit: [0, 99],
};

const problem = (path, message, severity = 'error') => ({ path, message, severity });

/* -------------------------------------------------------------- the schema */

const typeName = (value) => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
};

const quote = (value) =>
  typeof value === 'string' ? `"${value}"` : JSON.stringify(value) ?? String(value);

/** Format a long enum without pasting eighty skill names into one line. */
function listEnum(values) {
  if (values.length <= 8) return values.join(', ');
  return `${values.slice(0, 8).join(', ')} … and ${values.length - 8} more`;
}

/**
 * Check a value against the JSON Schema subset the generation schemas use.
 *
 * That subset is what OpenAI's strict mode allows and no more, which
 * check-logic already asserts, so the validator only has to cover object,
 * array, string, integer, number, boolean, and enum. Anything richer appearing
 * in a schema is reported rather than skipped, so an unimplemented keyword can
 * never quietly pass a file.
 */
export function validateAgainstSchema(schema, value, path = 'payload') {
  const problems = [];

  if (schema.enum) {
    if (!schema.enum.includes(value)) {
      problems.push(
        problem(path, `${quote(value)} is not one of: ${listEnum(schema.enum)}`),
      );
    }
    return problems;
  }

  const actual = typeName(value);

  if (schema.type === 'object') {
    if (actual !== 'object') {
      problems.push(problem(path, `expected an object, found ${actual}`));
      return problems;
    }
    for (const key of schema.required ?? []) {
      if (!(key in value)) problems.push(problem(`${path}.${key}`, 'required, but missing'));
    }
    if (schema.additionalProperties === false) {
      const known = Object.keys(schema.properties ?? {});
      for (const key of Object.keys(value)) {
        if (!known.includes(key)) {
          problems.push(
            problem(`${path}.${key}`, `not part of this format; expected one of: ${listEnum(known)}`),
          );
        }
      }
    }
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      if (key in value) problems.push(...validateAgainstSchema(child, value[key], `${path}.${key}`));
    }
    return problems;
  }

  if (schema.type === 'array') {
    if (actual !== 'array') {
      problems.push(problem(path, `expected an array, found ${actual}`));
      return problems;
    }
    value.forEach((item, index) => {
      problems.push(...validateAgainstSchema(schema.items, item, `${path}[${index}]`));
    });
    return problems;
  }

  if (schema.type === 'integer') {
    if (!Number.isInteger(value)) {
      problems.push(problem(path, `expected a whole number, found ${quote(value)}`));
    }
    return problems;
  }

  if (schema.type === 'number') {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      problems.push(problem(path, `expected a number, found ${quote(value)}`));
    }
    return problems;
  }

  if (schema.type === 'string' || schema.type === 'boolean') {
    if (actual !== schema.type) {
      problems.push(problem(path, `expected a ${schema.type}, found ${actual}`));
    }
    return problems;
  }

  problems.push(problem(path, `this module cannot check schema type "${schema.type}"`));
  return problems;
}

/* ------------------------------------------------------------ the GM fields */

/** Check the prose and numbers the GM is responsible for. */
export function validateGiven(key, given) {
  const spec = EXCHANGE[key];
  const problems = [];
  if (!given || typeof given !== 'object') {
    return [problem('given', 'missing; this is the prose and numbers the GM supplies')];
  }

  for (const field of spec.required) {
    if (!String(given[field] ?? '').trim()) {
      problems.push(problem(`given.${field}`, 'required, and cannot be empty'));
    }
  }

  for (const [field, [min, max]] of Object.entries(GIVEN_RANGES)) {
    if (given[field] === undefined || given[field] === null || given[field] === '') continue;
    const value = Number(given[field]);
    if (!Number.isFinite(value)) {
      problems.push(problem(`given.${field}`, `expected a number, found ${quote(given[field])}`));
    } else if (value < min || value > max) {
      problems.push(problem(`given.${field}`, `${value} is outside ${min}–${max}`));
    }
  }

  if (given.baseDC === undefined || given.baseDC === null || given.baseDC === '') {
    problems.push(
      problem('given.baseDC', `not set; ${DEFAULT_BASE_DC} will be used`, 'warning'),
    );
  }

  return problems;
}

/* ---------------------------------------------------- beyond the schema */

const ascending = (items, field, path, label) => {
  const problems = [];
  let previous = null;
  items.forEach((item, index) => {
    const value = item?.[field];
    if (typeof value !== 'number') return;
    if (previous !== null && value < previous) {
      problems.push(
        problem(`${path}[${index}].${field}`, `${value} comes after ${previous}; ${label}`, 'warning'),
      );
    }
    previous = value;
  });
  return problems;
};

/** A lore approach with no subject produces a check nobody can roll. */
const loreNamed = (items, path) =>
  (items ?? []).flatMap((item, index) =>
    item?.skill === 'lore' && !String(item.loreName ?? '').trim()
      ? [problem(`${path}[${index}].loreName`, 'a Lore check needs a subject, e.g. "Sailing"')]
      : [],
  );

/** Two approaches on the same skill leave one of them unreachable in the row. */
const distinctSkills = (items, path, label) => {
  const seen = new Map();
  const problems = [];
  (items ?? []).forEach((item, index) => {
    const slug = item?.skill === 'lore' ? `lore:${item.loreName}` : item?.skill;
    if (!slug) return;
    if (seen.has(slug)) {
      problems.push(
        problem(`${path}[${index}].skill`, `${label} already uses ${slug} at index ${seen.get(slug)}`, 'warning'),
      );
    } else seen.set(slug, index);
  });
  return problems;
};

const nonEmpty = (items, field, path) =>
  (items ?? []).flatMap((item, index) =>
    String(item?.[field] ?? '').trim() ? [] : [problem(`${path}[${index}].${field}`, 'is empty')],
  );

/**
 * The checks the schema cannot make.
 *
 * A file can satisfy every type and still describe something unplayable: a
 * research encounter whose sources cannot between them reach the last
 * threshold, an influence NPC every approach of which uses Diplomacy, a
 * leadership event that surfaces at level 0. These are the ones seen to
 * actually break a table, reported as warnings when the GM can fix them by
 * hand and as errors when the content would not work at all.
 */
export function checkSemantics(key, payload, given = {}) {
  const problems = [];
  if (!payload || typeof payload !== 'object') return problems;

  if (key === 'influence') {
    problems.push(
      ...loreNamed(payload.discoveries, 'payload.discoveries'),
      ...loreNamed(payload.influenceSkills, 'payload.influenceSkills'),
      ...distinctSkills(payload.influenceSkills, 'payload.influenceSkills', 'another approach'),
      ...ascending(payload.thresholds ?? [], 'points', 'payload.thresholds', 'concessions are listed cheapest first'),
    );
    if ((payload.influenceSkills?.length ?? 0) < (Number(given.partySize) || 0)) {
      problems.push(
        problem(
          'payload.influenceSkills',
          `${payload.influenceSkills?.length ?? 0} approaches for ${given.partySize} characters; some will have nothing to try`,
          'warning',
        ),
      );
    }
  }

  if (key === 'research') {
    problems.push(
      ...ascending(payload.thresholds ?? [], 'points', 'payload.thresholds', 'findings are listed cheapest first'),
    );
    (payload.sources ?? []).forEach((source, index) => {
      problems.push(...loreNamed(source.checks, `payload.sources[${index}].checks`));
      if (!(source.maxResearchPoints > 0)) {
        problems.push(
          problem(`payload.sources[${index}].maxResearchPoints`, 'a source that yields nothing can never be worked'),
        );
      }
    });
    const available = (payload.sources ?? []).reduce(
      (sum, source) => sum + (Number(source.maxResearchPoints) || 0),
      0,
    );
    const needed = Math.max(0, ...(payload.thresholds ?? []).map((t) => Number(t.points) || 0));
    if (needed > available) {
      problems.push(
        problem(
          'payload.sources',
          `the sources hold ${available} research points between them but the last finding needs ${needed}; it can never be reached`,
        ),
      );
    }
  }

  if (key === 'infiltration') {
    problems.push(
      ...ascending(payload.awarenessBreakpoints ?? [], 'at', 'payload.awarenessBreakpoints', 'breakpoints are listed in ascending order'),
      ...loreNamed(payload.preparations, 'payload.preparations'),
    );
    (payload.objectives ?? []).forEach((objective, index) => {
      if (!(objective.obstacles?.length > 0)) {
        problems.push(
          problem(`payload.objectives[${index}].obstacles`, 'an objective with no obstacles cannot be attempted'),
        );
      }
      (objective.obstacles ?? []).forEach((obstacle, oIndex) => {
        problems.push(...loreNamed(obstacle.checks, `payload.objectives[${index}].obstacles[${oIndex}].checks`));
        if (!(obstacle.checks?.length > 0)) {
          problems.push(
            problem(
              `payload.objectives[${index}].obstacles[${oIndex}].checks`,
              'an obstacle with no checks gives the party nothing to roll',
            ),
          );
        }
      });
    });
  }

  if (key === 'leadership') {
    const top = Number(given.organizationLevel) || 1;
    (payload.events ?? []).forEach((event, index) => {
      const at = Number(event.atLevel);
      if (!Number.isFinite(at) || at < 1 || at > 20) {
        problems.push(
          problem(`payload.events[${index}].atLevel`, `${quote(event.atLevel)} is outside organisation levels 1–20`),
        );
      }
      problems.push(...loreNamed(event.checks, `payload.events[${index}].checks`));
    });
    const live = (payload.events ?? []).filter((e) => (Number(e.atLevel) || 1) <= top);
    if (!live.length && (payload.events ?? []).length) {
      problems.push(
        problem(
          'payload.events',
          `every event waits for a level above ${top}, so the organisation opens with nothing to do`,
          'warning',
        ),
      );
    }
    (payload.lieutenants ?? []).forEach((lt, index) => {
      if (Number(lt.level) > top) {
        problems.push(
          problem(
            `payload.lieutenants[${index}].level`,
            `level ${lt.level} outranks the organisation itself (${top})`,
            'warning',
          ),
        );
      }
    });
  }

  if (key === 'chase') {
    problems.push(...nonEmpty(payload.obstacles, 'name', 'payload.obstacles'));
    (payload.obstacles ?? []).forEach((obstacle, index) => {
      problems.push(...loreNamed(obstacle.skillOptions, `payload.obstacles[${index}].skillOptions`));
      if (!(obstacle.skillOptions?.length > 0)) {
        problems.push(
          problem(`payload.obstacles[${index}].skillOptions`, 'an obstacle with no skills gives the party nothing to roll'),
        );
      }
    });
    if (!(payload.obstacles?.length > 0)) {
      problems.push(problem('payload.obstacles', 'a chase needs at least one obstacle'));
    }
  }

  return problems;
}

/** Everything wrong with one payload file, schema first then playability. */
export function verifyPayload(key, payload, given) {
  if (!isSubsystem(key)) {
    return [problem('type', `${quote(key)} is not a subsystem this module knows`)];
  }
  return [
    ...validateGiven(key, given),
    ...validateAgainstSchema(EXCHANGE[key].schema, payload),
    ...checkSemantics(key, payload, given ?? {}),
  ];
}

/* ------------------------------------------------------------------ briefs */

const INSTRUCTIONS = [
  'Give an agent the systemPrompt and userPrompt below, and require a JSON object matching schema exactly.',
  'Return that object as the "payload" of a copy of this file with "kind" changed to "payload"; leave "given" as it is.',
  'Do not write DCs. Each check names a dcAdjustment and this module computes the DC from the base DC in "given".',
  'Do not rewrite anything in "given". That prose is the GM\'s and is stored exactly as written.',
];

/** The contents of a generate dialog, written out for somebody else to fill in. */
export function buildBrief(key, given) {
  const spec = EXCHANGE[key];
  return {
    module: MODULE_ID,
    kind: EXCHANGE_KINDS.brief,
    version: EXCHANGE_VERSION,
    type: key,
    instructions: INSTRUCTIONS,
    given,
    systemPrompt: spec.brief.system,
    userPrompt: spec.brief.user(given),
    schema: spec.schema,
    payload: null,
  };
}

/**
 * Read a generate dialog's form into the `given` half of a brief.
 *
 * Level and party size are filled from the world when a dialog does not ask
 * for them, because a brief may well be filled in elsewhere and imported into
 * a different world, where guessing again would give a different answer.
 */
export function givenFromForm(key, data) {
  const given = {};
  for (const [field, value] of Object.entries(data ?? {})) {
    if (field in GIVEN_RANGES) {
      const number = Number(value);
      if (Number.isFinite(number) && String(value).trim() !== '') given[field] = number;
    } else {
      const text = String(value ?? '').trim();
      if (text) given[field] = text;
    }
  }
  given.baseDC ??= DEFAULT_BASE_DC;
  given.level ??= guessPartyLevel();
  given.partySize ??= guessPartySize();
  return given;
}

/**
 * The action every generate dialog uses to write a brief instead of spending
 * an API call. One implementation, since all five dialogs are the same form.
 */
export function makeSaveBrief(key) {
  return function onSaveBrief() {
    const form = this.element?.tagName === 'FORM' ? this.element : this.element?.querySelector('form');
    if (!form) return;
    const given = givenFromForm(key, new foundry.applications.ux.FormDataExtended(form).object);

    const missing = validateGiven(key, given).filter((p) => p.severity === 'error');
    if (missing.length) {
      ui.notifications.warn(
        game.i18n.format('PFAI.Influence.MissingFields', {
          fields: missing.map((p) => p.path.replace('given.', '')).join(', '),
        }),
      );
      return;
    }

    const file = `${(given.title || key).slugify?.({ strict: true }) || key}-brief.json`;
    foundry.utils.saveDataToFile(JSON.stringify(buildBrief(key, given), null, 2), 'text/json', file);
    ui.notifications.info(game.i18n.format('PFAI.Brief.Saved', { file }));
  };
}

/* ------------------------------------------------------------------ import */

/**
 * Work out what a file is and what is wrong with it.
 *
 * Never throws: a GM handed a file by an agent wants to be told what to fix,
 * not to watch the window do nothing. The result carries `problems` whatever
 * the outcome, and `ok` only when nothing is fatal.
 */
export function parseExchange(text) {
  let file;
  try {
    file = JSON.parse(text);
  } catch (error) {
    return { ok: false, kind: null, key: null, problems: [problem('file', `not valid JSON: ${error.message}`)] };
  }

  if (!file || typeof file !== 'object' || Array.isArray(file)) {
    return { ok: false, kind: null, key: null, problems: [problem('file', 'expected a JSON object')] };
  }

  const key = file.type;
  if (!isSubsystem(key)) {
    return {
      ok: false,
      kind: file.kind ?? null,
      key: null,
      problems: [
        problem('type', `${quote(file.type)} is not one of: ${Object.keys(EXCHANGE).join(', ')}`),
      ],
    };
  }

  // A stored event exported from this module, which has already been mapped.
  const looksLikeEvent = file.kind === EXCHANGE_KINDS.event || (!file.kind && file.data);
  if (looksLikeEvent) {
    if (!file.data || typeof file.data !== 'object') {
      return { ok: false, kind: EXCHANGE_KINDS.event, key, problems: [problem('data', 'required, but missing')] };
    }
    return { ok: true, kind: EXCHANGE_KINDS.event, key, data: file.data, problems: [] };
  }

  if (file.kind === EXCHANGE_KINDS.brief && !file.payload) {
    return {
      ok: false,
      kind: EXCHANGE_KINDS.brief,
      key,
      problems: [
        problem(
          'payload',
          'this is still the brief. Fill in "payload" with the agent\'s answer and set "kind" to "payload".',
        ),
      ],
    };
  }

  const given = file.given ?? {};
  const payload = file.payload ?? null;
  if (!payload) {
    return { ok: false, kind: EXCHANGE_KINDS.payload, key, problems: [problem('payload', 'required, but missing')] };
  }

  const problems = verifyPayload(key, payload, given);
  return {
    ok: !problems.some((p) => p.severity === 'error'),
    kind: EXCHANGE_KINDS.payload,
    key,
    given,
    payload,
    problems,
  };
}

/** Store whatever a parse produced. Call only when the parse said `ok`. */
export async function applyExchange(parsed) {
  if (!parsed?.ok || !isSubsystem(parsed.key)) return null;
  const api = subsystem(parsed.key);
  const store = api.getAll();
  const id = foundry.utils.randomID();

  const event =
    parsed.kind === EXCHANGE_KINDS.event
      ? { ...parsed.data, id }
      : {
          ...EXCHANGE[parsed.key].toData(parsed.payload, {
            ...parsed.given,
            baseDC: Number(parsed.given.baseDC) || DEFAULT_BASE_DC,
            level: Number(parsed.given.level) || 0,
            partySize: Number(parsed.given.partySize) || 4,
            model: 'imported',
          }),
          id,
        };

  store.events[id] = { ...event, position: nextPosition(store.events) };
  await api.save(store);
  return { key: parsed.key, id };
}
