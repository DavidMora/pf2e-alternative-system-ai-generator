/*
 * What every subsystem does with a model's answer.
 *
 * This is where the non-negotiables are enforced, and it was the least covered
 * code in the project: two of the six mappers had any test at all. The same
 * three promises are asserted against all six, because a promise kept in five
 * places and broken in the sixth is not a promise.
 *
 * Every schema is also walked for strict-mode compliance. That check existed but
 * was pointed only at the chase schemas, so five subsystems' schemas could have
 * drifted out of what OpenAI accepts without anything noticing.
 */
import { installGlobals, load, makeCheck } from './harness.mjs';

installGlobals();
const { check, done } = makeCheck();

const { DC_ADJUSTMENTS } = await load('constants.js');
const chase = await load('ai/chase.js');
const influence = await load('ai/influence.js');
const research = await load('ai/research.js');
const infiltration = await load('ai/infiltration.js');
const leadership = await load('ai/leadership.js');
const victory = await load('ai/victory.js');

const BASE_DC = 20;
const LEGAL_DCS = Object.values(DC_ADJUSTMENTS).map((d) => BASE_DC + d);

/** A skill entry in the shape every schema uses. */
const skill = (name, adjustment = 'standard', extra = {}) => ({
  skill: name,
  loreName: '',
  dcAdjustment: adjustment,
  description: `Do something with ${name}.`,
  ...extra,
});

/** Walk an object for every `dc` it contains, however deeply nested. */
function everyDC(value, found = []) {
  if (Array.isArray(value)) for (const v of value) everyDC(v, found);
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (k === 'dc' && typeof v === 'number') found.push(v);
      else everyDC(v, found);
    }
  }
  return found;
}

/** Every string anywhere in the object, for checking prose survived intact. */
function allText(value, found = []) {
  if (typeof value === 'string') found.push(value);
  else if (Array.isArray(value)) for (const v of value) allText(v, found);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) allText(v, found);
  return found;
}

const PREMISE = 'A GM-WRITTEN-PREMISE that must survive word for word.';
const GOAL = 'A GM-WRITTEN-GOAL that must survive too.';

/*
 * One case per subsystem: the payload a model would return, the options a GM
 * supplies, and which prose fields must come back untouched.
 */
const CASES = [
  {
    name: 'chase',
    toData: chase.toChaseData,
    schemas: { CHASE_SCHEMA: chase.CHASE_SCHEMA, OBSTACLES_SCHEMA: chase.OBSTACLES_SCHEMA, FORK_SCHEMA: chase.FORK_SCHEMA },
    options: { premise: PREMISE, baseDC: BASE_DC, level: 5, partySize: 4, title: '', model: 'm' },
    payload: {
      name: 'A Chase',
      gmNotes: 'notes',
      roundLimit: 0,
      obstacles: [
        {
          name: 'The Wall', description: 'A wall.', roundAllowance: 1,
          skillOptions: [skill('athletics'), skill('acrobatics', 'hard')],
          criticalSuccess: 'Over it.', failure: 'Not over it.',
        },
      ],
    },
    prose: [PREMISE],
  },
  {
    name: 'influence',
    toData: influence.toInfluenceData,
    schemas: { INFLUENCE_SCHEMA: influence.INFLUENCE_SCHEMA, APPROACH_SCHEMA: influence.APPROACH_SCHEMA },
    options: { premise: PREMISE, npcName: 'Consul Venn', npcDescription: 'A diplomat.', goal: GOAL, baseDC: BASE_DC, level: 5, partySize: 4, title: '', model: 'm' },
    payload: {
      title: 'A Conversation', npcWants: 'w', disposition: 'guarded', perception: 12, will: 14,
      roundLimit: 5, gmNotes: 'notes',
      discoveries: [skill('society', 'easy', { reveals: 'Something.' })],
      influenceSkills: [skill('diplomacy'), skill('deception', 'very-hard')],
      thresholds: [{ points: 3, name: 'A', description: 'a' }],
      weaknesses: [{ name: 'W', description: 'w', strong: true }],
      resistances: [{ name: 'R', description: 'r', strong: false }],
      penalties: [{ name: 'P', description: 'p', strong: true }],
    },
    prose: [PREMISE, GOAL],
  },
  {
    name: 'research',
    toData: research.toResearchData,
    schemas: { RESEARCH_SCHEMA: research.RESEARCH_SCHEMA, SOURCE_SCHEMA: research.SOURCE_SCHEMA },
    options: { premise: PREMISE, topic: 'A topic.', goal: GOAL, baseDC: BASE_DC, level: 5, partySize: 4, title: '', model: 'm' },
    payload: {
      title: 'A Study', gmNotes: 'notes', roundUnit: 'hour', roundLimit: 9,
      sources: [{ name: 'A Shelf', description: 'd', maxResearchPoints: 5, checks: [skill('society'), skill('arcana', 'incredibly-hard')] }],
      thresholds: [{ points: 4, name: 'A', description: 'a' }],
      events: [{ name: 'E', description: 'd', triggerKind: 'points', triggerAt: 4, dcShift: 0 }],
    },
    prose: [PREMISE, GOAL],
  },
  {
    name: 'infiltration',
    toData: infiltration.toInfiltrationData,
    schemas: { INFILTRATION_SCHEMA: infiltration.INFILTRATION_SCHEMA, OBSTACLE_SCHEMA: infiltration.OBSTACLE_SCHEMA },
    options: { premise: PREMISE, target: 'A target.', goal: GOAL, baseDC: BASE_DC, level: 5, partySize: 4, title: '', model: 'm' },
    payload: {
      title: 'A Job', gmNotes: 'notes', roundLimit: 0,
      objectives: [{
        name: 'Get In', description: 'd',
        obstacles: [{ name: 'The Gate', description: 'd', individual: false, infiltrationPoints: 2, checks: [skill('stealth'), skill('deception', 'incredibly-easy')] }],
      }],
      awarenessBreakpoints: [{ at: 5, name: 'Noticed', description: 'd', dcIncrease: 1 }],
      complications: [{ name: 'C', description: 'd', triggerKind: 'awareness', triggerAt: 5, checks: [skill('athletics')] }],
      opportunities: [{ name: 'O', description: 'd', benefit: 'b', checks: [skill('thievery')] }],
      preparations: [{ name: 'P', description: 'd', ...skill('society') }],
    },
    prose: [PREMISE, GOAL],
  },
  {
    name: 'leadership',
    toData: leadership.toLeadershipData,
    schemas: { LEADERSHIP_SCHEMA: leadership.LEADERSHIP_SCHEMA, EVENT_SCHEMA: leadership.EVENT_SCHEMA },
    options: { premise: PREMISE, organization: 'A society.', goal: GOAL, baseDC: BASE_DC, level: 5, partySize: 4, organizationLevel: 6, title: '', model: 'm' },
    payload: {
      title: 'An Order', kind: 'society', seat: 'a hall', gmNotes: 'notes',
      lieutenants: [{ name: 'L', role: 'r', description: 'd', level: 2 }],
      events: [
        { kind: 'opportunity', name: 'Now', description: 'd', outcome: 'o', atLevel: 6, checks: [skill('diplomacy')] },
        { kind: 'trouble', name: 'Later', description: 'd', outcome: 'o', atLevel: 12, checks: [skill('intimidation', 'hard')] },
      ],
    },
    prose: [PREMISE, GOAL],
  },
  {
    name: 'victory',
    toData: victory.toVictoryData,
    schemas: { VICTORY_SCHEMA: victory.VICTORY_SCHEMA, CHECK_SCHEMA: victory.CHECK_SCHEMA },
    options: { premise: PREMISE, objective: 'An objective.', goal: GOAL, failure: 'A cost.', baseDC: BASE_DC, level: 5, partySize: 4, structure: 'accumulating', scale: 'long', title: '', model: 'm' },
    payload: {
      title: 'A Contest', gmNotes: 'notes', roundUnit: 'minute', roundLimit: 8,
      checks: [skill('athletics', 'standard', { exploitsWeakness: false }), skill('thievery', 'very-hard', { exploitsWeakness: true })],
      thresholds: [{ name: 'A', description: 'a' }],
      events: [{ name: 'E', description: 'd', triggerKind: 'rounds', triggerAt: 3 }],
    },
    prose: [PREMISE, GOAL],
  },
];

/* ------------------------------------------- the three promises, six times */

for (const { name, toData, options, payload, prose } of CASES) {
  const stored = toData(payload, options);

  // 1. The GM owns the DCs.
  const dcs = everyDC(stored);
  check(`${name}: produces DCs at all`, dcs.length > 0, true);
  check(
    `${name}: every DC is the base plus a published adjustment`,
    dcs.filter((dc) => !LEGAL_DCS.includes(dc)),
    [],
  );

  // 2. GM prose is verbatim.
  const text = allText(stored).join('\n');
  for (const written of prose) {
    check(`${name}: keeps GM prose word for word`, text.includes(written), true);
  }

  // 3. Provenance is recorded, so a GM can tell what came from where.
  check(`${name}: records that a model wrote it`, stored.ai.generated, true);
  check(`${name}: and which model`, stored.ai.model, 'm');

  // The event is the GM's until they show it.
  check(`${name}: starts hidden from players`, stored.hidden, true);
  check(`${name}: and not yet running`, stored.started, false);
  check(`${name}: carries an id`, typeof stored.id === 'string' && stored.id.length > 0, true);
  check(`${name}: and the party numbers it was built for`, stored.level, 5);
}

/* ------------------------------------------------ strict mode, every schema */

function assertStrict(node, path, problems) {
  if (!node || typeof node !== 'object') return problems;
  if (node.type === 'object') {
    if (node.additionalProperties !== false) problems.push(`${path}: additionalProperties must be false`);
    const props = Object.keys(node.properties ?? {});
    const required = node.required ?? [];
    const missing = props.filter((p) => !required.includes(p));
    if (missing.length) problems.push(`${path}: not required: ${missing.join(', ')}`);
    for (const [k, v] of Object.entries(node.properties ?? {})) assertStrict(v, `${path}.${k}`, problems);
  } else if (node.type === 'array') {
    assertStrict(node.items, `${path}[]`, problems);
  }
  return problems;
}

for (const { name, schemas } of CASES) {
  for (const [schemaName, schema] of Object.entries(schemas)) {
    check(
      `${name}: ${schemaName} satisfies strict mode`,
      assertStrict(schema, '$', []),
      [],
    );
  }
}

/* ------------------------------------------------------- no smuggled fields */

// A schema that let a model name a DC would defeat the whole arrangement, so
// prove none of them has such a field anywhere.
function fieldNames(node, found = new Set()) {
  if (!node || typeof node !== 'object') return found;
  for (const key of Object.keys(node.properties ?? {})) found.add(key);
  for (const child of Object.values(node.properties ?? {})) fieldNames(child, found);
  if (node.items) fieldNames(node.items, found);
  return found;
}

for (const { name, schemas } of CASES) {
  const names = new Set();
  for (const schema of Object.values(schemas)) for (const n of fieldNames(schema)) names.add(n);
  check(
    `${name}: no schema field lets a model write a DC`,
    [...names].filter((n) => /^dc$|^difficultyClass$/i.test(n)),
    [],
  );
  check(
    `${name}: difficulty is only ever expressed as an adjustment`,
    names.has('dcAdjustment') || name === 'chase' || names.size === 0,
    true,
  );
}

/* ------------------------------------------- what each subsystem does extra */

// Chase goals come from the published formula, not from the model.
{
  const stored = chase.toChaseData(CASES[0].payload, CASES[0].options);
  const goals = Object.values(stored.obstacles).map((o) => o.chasePoints.goal);
  check('chase: obstacle goals come from the party-size formula', goals, [3]);
}

// Research caps are what stop a party grinding one shelf.
{
  const stored = research.toResearchData(CASES[2].payload, CASES[2].options);
  const source = Object.values(stored.sources)[0];
  check('research: a source carries the cap the model asked for', source.researchPoints.max, 5);
  check('research: and starts empty', source.researchPoints.current, 0);
  check('research: only the first source is open', Object.values(stored.sources).every((s, i) => s.hidden === (i > 0)), true);
}

// Leadership reveals what the organisation has already grown into.
{
  const stored = leadership.toLeadershipData(CASES[4].payload, CASES[4].options);
  const events = Object.values(stored.events).sort((a, b) => a.revealAt - b.revealAt);
  check('leadership: an event at or below the current level is live', events[0].hidden, false);
  check('leadership: one above it waits', events[1].hidden, true);
  check('leadership: the size comes from the published table', stored.organizationLevel, 6);
}

// Victory takes its endpoint from the scale, never from the model.
{
  const stored = victory.toVictoryData(CASES[5].payload, CASES[5].options);
  check('victory: the endpoint comes from the chosen scale', stored.points, { current: 0, goal: 10 });
  check('victory: a diminishing contest would start full',
    victory.toVictoryData(CASES[5].payload, { ...CASES[5].options, structure: 'diminishing' }).points,
    { current: 10, goal: 10 });
  const earned = Object.values(stored.checks).filter((c) => c.award > 0);
  check('victory: the check needing groundwork pays more and starts hidden',
    earned.map((c) => [c.award > 0, c.hidden]), [[true, true]]);
}

// Infiltration failure costs secrecy, so its obstacles carry goals not caps.
{
  const stored = infiltration.toInfiltrationData(CASES[3].payload, CASES[3].options);
  const objective = Object.values(stored.objectives)[0];
  const obstacle = Object.values(objective.obstacles)[0];
  check('infiltration: an obstacle carries the goal the model asked for', obstacle.infiltrationPoints.goal, 2);
  check('infiltration: and starts at zero', obstacle.infiltrationPoints.current, 0);
  check('infiltration: awareness starts clean', stored.awareness.current, 0);
  check('infiltration: breakpoints start hidden', Object.values(stored.awarenessBreakpoints).every((b) => b.hidden), true);
}

/* ------------------------------------------------------- list positioning */

for (const [name, mod] of [['chase', chase], ['influence', influence], ['research', research],
                           ['infiltration', infiltration], ['leadership', leadership], ['victory', victory]]) {
  if (typeof mod.withListPosition !== 'function') continue;
  const placed = mod.withListPosition({ id: 'x' }, { a: { position: 4 } });
  check(`${name}: a new event lands after the last one`, placed.position, 5);
}

done('all six mappers, schemas and their published formulas');
