/*
 * The import verifier is the whole point of the exchange format: a file written
 * by somebody else's agent will be wrong sooner or later, and the GM needs to
 * be told where. These assert the diagnostics, not just the accept/reject.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = path.join(root, 'scripts');

const store = {};
Math.clamp = (v, min, max) => Math.min(Math.max(v, min), max);
let idCounter = 0;
globalThis.foundry = { utils: { randomID: () => `id${++idCounter}` } };
globalThis.game = {
  user: { isGM: true },
  settings: {
    get: (_mod, key) => ({ toObject: () => structuredClone(store[key] ?? { events: {} }) }),
    set: (_mod, key, value) => {
      store[key] = structuredClone(value);
    },
  },
  i18n: { localize: (k) => k, format: (k, d) => `${k} ${JSON.stringify(d)}`, lang: 'en' },
};
globalThis.ui = { notifications: { info: () => {}, warn: () => {}, error: () => {} } };

const {
  EXCHANGE,
  buildBrief,
  parseExchange,
  applyExchange,
  validateAgainstSchema,
  verifyPayload,
} = await import(`file://${base}/exchange.js`);

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failed = 1;
    console.error(`FAIL ${label}\n  got      ${JSON.stringify(actual)}\n  expected ${JSON.stringify(expected)}`);
  } else console.log(`ok  ${label}`);
};

/** Did the verifier complain about this path, and does the wording help? */
const at = (problems, prefix) => problems.filter((p) => p.path.startsWith(prefix));
const saidAt = (problems, prefix) => at(problems, prefix).length > 0;
const errorCount = (problems) => problems.filter((p) => p.severity === 'error').length;

/* ------------------------------------------------------------ the validator */

const toy = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'count', 'mode', 'items'],
  properties: {
    name: { type: 'string' },
    count: { type: 'integer' },
    mode: { type: 'string', enum: ['fast', 'slow'] },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label'],
        properties: { label: { type: 'string' }, flag: { type: 'boolean' } },
      },
    },
  },
};
const good = { name: 'x', count: 1, mode: 'fast', items: [{ label: 'a', flag: true }] };

check('a conforming object has nothing wrong with it', validateAgainstSchema(toy, good), []);
check(
  'a missing property is named',
  validateAgainstSchema(toy, { ...good, count: undefined, ...{} }).some(
    (p) => p.path === 'payload.count',
  ),
  true,
);
check(
  'a wrong type says what was expected and what arrived',
  validateAgainstSchema(toy, { ...good, count: '3' })[0],
  { path: 'payload.count', message: 'expected a whole number, found "3"', severity: 'error' },
);
check(
  'a bad enum lists the choices',
  validateAgainstSchema(toy, { ...good, mode: 'medium' })[0].message,
  '"medium" is not one of: fast, slow',
);
check(
  'an unexpected property is rejected, not ignored',
  validateAgainstSchema(toy, { ...good, dc: 22 })[0].path,
  'payload.dc',
);
check(
  'a problem inside an array carries its index',
  validateAgainstSchema(toy, { ...good, items: [{ label: 'a' }, { flag: true }] })[0].path,
  'payload.items[1].label',
);
check(
  'an array given an object is caught before its items are walked',
  validateAgainstSchema(toy, { ...good, items: {} }),
  [{ path: 'payload.items', message: 'expected an array, found object', severity: 'error' }],
);
check(
  'null is reported as null rather than object',
  validateAgainstSchema({ type: 'string' }, null, 'payload.x')[0].message,
  'expected a string, found null',
);
check(
  'a schema keyword the validator cannot check is reported, not skipped',
  validateAgainstSchema({ type: 'tuple' }, [], 'payload.x')[0].message,
  'this module cannot check schema type "tuple"',
);

/* ------------------------------------------------- a real subsystem payload */

const influenceGiven = {
  premise: 'A masked ball.',
  npcName: 'Consul Venn',
  npcDescription: 'A career diplomat.',
  goal: 'Her vote.',
  baseDC: 20,
  level: 5,
  partySize: 4,
};

const approach = (skill, dcAdjustment = 'standard', extra = {}) => ({
  skill,
  loreName: '',
  dcAdjustment,
  description: 'Do the thing.',
  ...extra,
});

const influencePayload = {
  title: 'The Vote',
  npcWants: 'To keep her post.',
  disposition: 'guarded',
  perception: 12,
  will: 14,
  roundLimit: 5,
  gmNotes: 'Pace it.',
  discoveries: [approach('society', 'easy', { reveals: 'Something.' })],
  influenceSkills: [approach('diplomacy'), approach('deception'), approach('nature'), approach('performance')],
  thresholds: [
    { points: 3, name: 'A', description: 'a' },
    { points: 6, name: 'B', description: 'b' },
  ],
  weaknesses: [{ name: 'W', description: 'w', strong: true }],
  resistances: [{ name: 'R', description: 'r', strong: false }],
  penalties: [{ name: 'P', description: 'p', strong: true }],
};

check('a well-formed influence payload passes', verifyPayload('influence', influencePayload, influenceGiven), []);

check(
  'a DC the agent tried to set is rejected: the module owns DCs',
  saidAt(
    verifyPayload(
      'influence',
      { ...influencePayload, influenceSkills: [{ ...approach('diplomacy'), dc: 22 }] },
      influenceGiven,
    ),
    'payload.influenceSkills[0].dc',
  ),
  true,
);
check(
  'an invented difficulty word is rejected',
  saidAt(
    verifyPayload(
      'influence',
      { ...influencePayload, influenceSkills: [approach('diplomacy', 'quite-hard')] },
      influenceGiven,
    ),
    'payload.influenceSkills[0].dcAdjustment',
  ),
  true,
);
check(
  'a skill PF2e does not have is rejected',
  saidAt(
    verifyPayload(
      'influence',
      { ...influencePayload, influenceSkills: [approach('haggling')] },
      influenceGiven,
    ),
    'payload.influenceSkills[0].skill',
  ),
  true,
);
check(
  'a Lore approach with no subject is flagged: nobody could roll it',
  verifyPayload(
    'influence',
    { ...influencePayload, influenceSkills: [approach('lore')] },
    influenceGiven,
  ).some((p) => p.path === 'payload.influenceSkills[0].loreName'),
  true,
);
check(
  'the same skill twice is a warning, not a refusal',
  verifyPayload(
    'influence',
    { ...influencePayload, influenceSkills: [approach('diplomacy'), approach('diplomacy')] },
    influenceGiven,
  ).filter((p) => p.path === 'payload.influenceSkills[1].skill'),
  [
    {
      path: 'payload.influenceSkills[1].skill',
      message: 'another approach already uses diplomacy at index 0',
      severity: 'warning',
    },
  ],
);
check(
  'concessions listed out of order are flagged',
  saidAt(
    verifyPayload(
      'influence',
      {
        ...influencePayload,
        thresholds: [
          { points: 9, name: 'A', description: 'a' },
          { points: 2, name: 'B', description: 'b' },
        ],
      },
      influenceGiven,
    ),
    'payload.thresholds[1].points',
  ),
  true,
);

// The GM's own fields are checked too, since a brief can be edited by hand.
check(
  'the GM prose the model must not invent is required',
  verifyPayload('influence', influencePayload, { ...influenceGiven, npcName: '  ' }).filter(
    (p) => p.path === 'given.npcName',
  ),
  [{ path: 'given.npcName', message: 'required, and cannot be empty', severity: 'error' }],
);
check(
  'a base DC outside the table is refused',
  saidAt(verifyPayload('influence', influencePayload, { ...influenceGiven, baseDC: 200 }), 'given.baseDC'),
  true,
);

/* ------------------------------------------------ research: unwinnable work */

const researchGiven = { premise: 'The archive.', topic: 'The ledger.', baseDC: 18, level: 5, partySize: 4 };
const researchPayload = {
  title: 'Ashes',
  gmNotes: 'notes',
  roundUnit: 'hour',
  roundLimit: 9,
  sources: [
    {
      name: 'Ledgers',
      description: 'd',
      maxResearchPoints: 5,
      checks: [approach('society')],
    },
  ],
  thresholds: [{ points: 4, name: 'A finding', description: 'a' }],
  events: [],
};
check('a workable research encounter passes', verifyPayload('research', researchPayload, researchGiven), []);
check(
  'research nobody could finish is refused, with the arithmetic',
  verifyPayload(
    'research',
    { ...researchPayload, thresholds: [{ points: 20, name: 'A', description: 'a' }] },
    researchGiven,
  ).filter((p) => p.path === 'payload.sources'),
  [
    {
      path: 'payload.sources',
      message:
        'the sources hold 5 research points between them but the last finding needs 20; it can never be reached',
      severity: 'error',
    },
  ],
);
check(
  'a source that yields nothing is refused',
  saidAt(
    verifyPayload(
      'research',
      { ...researchPayload, sources: [{ ...researchPayload.sources[0], maxResearchPoints: 0 }] },
      researchGiven,
    ),
    'payload.sources[0].maxResearchPoints',
  ),
  true,
);

/* ------------------------------------------- leadership: nothing to do yet */

const leadershipGiven = {
  premise: 'A society.',
  organization: 'The Kettle Rota.',
  baseDC: 18,
  level: 5,
  partySize: 4,
  organizationLevel: 4,
};
const leadershipPayload = {
  title: 'The Kettle Rota',
  kind: 'mutual-aid society',
  seat: 'A chandlery.',
  gmNotes: 'notes',
  lieutenants: [{ name: 'Mara', role: 'clerk', description: 'd', level: 1 }],
  events: [
    { kind: 'opportunity', name: 'A seat', description: 'd', outcome: 'o', atLevel: 4, checks: [approach('diplomacy')] },
  ],
};
check('a workable organisation passes', verifyPayload('leadership', leadershipPayload, leadershipGiven), []);
check(
  'an organisation whose events all wait is flagged',
  verifyPayload(
    'leadership',
    { ...leadershipPayload, events: [{ ...leadershipPayload.events[0], atLevel: 12 }] },
    leadershipGiven,
  ).filter((p) => p.path === 'payload.events'),
  [
    {
      path: 'payload.events',
      message: 'every event waits for a level above 4, so the organisation opens with nothing to do',
      severity: 'warning',
    },
  ],
);
check(
  'an event outside levels 1-20 is refused',
  saidAt(
    verifyPayload(
      'leadership',
      { ...leadershipPayload, events: [{ ...leadershipPayload.events[0], atLevel: 0 }] },
      leadershipGiven,
    ),
    'payload.events[0].atLevel',
  ),
  true,
);

/* -------------------------------------------------------------- whole files */

const file = (over = {}) => JSON.stringify({
  module: 'matadragones-subsystems-implementation-for-pf2e',
  kind: 'payload',
  version: 1,
  type: 'influence',
  given: influenceGiven,
  payload: influencePayload,
  ...over,
});

check('a good file parses', parseExchange(file()).ok, true);
check('a good file names its subsystem', parseExchange(file()).key, 'influence');
check(
  'broken JSON says so rather than failing silently',
  parseExchange('{ nope').problems[0].path,
  'file',
);
check('a JSON array is not a file', parseExchange('[]').problems[0].message, 'expected a JSON object');
check(
  // Derived from the registry, so adding a subsystem does not break this the
  // way a hand-written list would.
  'an unknown subsystem lists the real ones',
  parseExchange(file({ type: 'heist' })).problems[0].message,
  `"heist" is not one of: ${Object.keys(EXCHANGE).join(', ')}`,
);
check(
  'a brief handed back unfilled is told what to do with it',
  parseExchange(JSON.stringify({ ...JSON.parse(file()), kind: 'brief', payload: null })).problems[0].message,
  'this is still the brief. Fill in "payload" with the agent\'s answer and set "kind" to "payload".',
);
check(
  'a payload file with no payload is refused',
  parseExchange(file({ payload: null })).problems[0].path,
  'payload',
);
check(
  'warnings alone do not block an import',
  parseExchange(
    file({ payload: { ...influencePayload, influenceSkills: [approach('diplomacy'), approach('diplomacy')] } }),
  ).ok,
  true,
);
check(
  'an error does block it',
  parseExchange(file({ payload: { ...influencePayload, perception: 'high' } })).ok,
  false,
);

// An event exported from this module has already been mapped once and must not
// be run through the payload validator.
check(
  'a stored event exported for backup still imports',
  parseExchange(
    JSON.stringify({ module: 'matadragones-subsystems-implementation-for-pf2e', type: 'chase', version: 2, data: { name: 'x' } }),
  ),
  { ok: true, kind: 'event', key: 'chase', data: { name: 'x' }, problems: [] },
);

/* ------------------------------------------------------------ round tripping */

const brief = buildBrief('influence', influenceGiven);
check('a brief names the subsystem it is for', brief.type, 'influence');
check('a brief carries the schema the agent must match', brief.schema, EXCHANGE.influence.schema);
check('a brief carries the GM prose untouched', brief.given.npcDescription, influenceGiven.npcDescription);
check('a brief carries the prompt this module would have sent', brief.userPrompt.includes('A masked ball.'), true);
check('a brief starts with no payload, so it cannot be imported by mistake', brief.payload, null);
check(
  'a brief tells the agent not to write DCs',
  brief.instructions.some((line) => line.includes('Do not write DCs')),
  true,
);

const filled = { ...brief, kind: 'payload', payload: influencePayload };
const parsed = parseExchange(JSON.stringify(filled));
check('a filled-in brief is a valid payload file', parsed.ok, true);

const stored = await applyExchange(parsed);
check('importing it stores an influence event', stored.key, 'influence');
const event = store.influences.events[stored.id];
check('the stored event keeps the GM premise verbatim', event.premise.includes('A masked ball.'), true);
check('the GM name is used, not anything the payload said', event.npc.name, 'Consul Venn');
check(
  'DCs were computed here from the adjustments',
  Object.values(event.influenceSkills).map((s) => s.dc).sort((a, b) => a - b),
  [20, 20, 20, 20],
);
check(
  'an "easy" discovery came out two below the base DC, as the published table says',
  Object.values(event.discoveries)[0].dc,
  18,
);
check('the import is recorded as not machine-generated here', event.ai.model, 'imported');

check(
  'a parse that failed cannot be applied',
  await applyExchange(parseExchange(file({ payload: { ...influencePayload, perception: 'high' } }))),
  null,
);

/* ------------------------------------------------ victory: the generic case */

const victoryGiven = {
  premise: 'A running fight for the only bridge left.',
  objective: 'Hold it open until the district crosses.',
  goal: 'They get out.',
  failure: 'The span goes down with people on it.',
  baseDC: 20, level: 5, partySize: 4,
  structure: 'accumulating', scale: 'session',
};
const vCheck = (skill, adjustment = 'standard', exploitsWeakness = false) => ({
  skill, loreName: '', dcAdjustment: adjustment, description: 'Do the thing.', exploitsWeakness,
});
const victoryPayload = {
  title: 'Holding the Bridge',
  gmNotes: 'The militia will not hold past dusk.',
  roundUnit: 'minute', roundLimit: 8,
  checks: [vCheck('athletics'), vCheck('crafting', 'hard'), vCheck('diplomacy', 'easy'), vCheck('thievery', 'very-hard', true)],
  thresholds: [
    { name: 'The Crowd Thins', description: 'a' },
    { name: 'The Span Holds', description: 'b' },
    { name: 'Reinforcements', description: 'c' },
  ],
  events: [{ name: 'The Wind Turns', description: 'Smoke.', triggerKind: 'rounds', triggerAt: 3 }],
};

check('victory: a well-formed payload passes', verifyPayload('victory', victoryPayload, victoryGiven), []);
check(
  'victory: the objective is required, because nothing else says what they are doing',
  verifyPayload('victory', victoryPayload, { ...victoryGiven, objective: '  ' })
    .some((p) => p.path === 'given.objective'),
  true,
);
check(
  'victory: a DC the agent tried to set is rejected',
  verifyPayload('victory', { ...victoryPayload, checks: [{ ...vCheck('athletics'), dc: 22 }] }, victoryGiven)
    .some((p) => p.path === 'payload.checks[0].dc'),
  true,
);

/*
 * Victory had no semantic checks at all: it was added after the verifier and
 * nobody extended it, so a file that satisfied the schema and was unplayable
 * imported without a word. These are the ways it can be unplayable.
 */
const vProblems = (payload, given = victoryGiven) =>
  verifyPayload('victory', { ...victoryPayload, ...payload }, { ...victoryGiven, ...given });
const vPaths = (...args) => vProblems(...args).map((p) => p.path);
const vSay = (path, ...args) =>
  vProblems(...args).find((p) => p.path === path)?.message ?? 'no problem reported';

check('victory: a contest with no checks is rejected',
  vSay('payload.checks', { checks: [] }),
  'a contest with no checks gives the party nothing to roll');

// exploitsWeakness starts a check hidden, so all-of-them means a blank sheet.
check('victory: checks that all need groundwork leave the contest empty',
  vSay('payload.checks', { checks: [vCheck('athletics', 'standard', true), vCheck('thievery', 'hard', true)] }),
  'every check needs groundwork first, so the contest opens with nothing available');

check('victory: and that is an error, not a warning',
  vProblems({ checks: [vCheck('athletics', 'standard', true)] })
    .find((p) => p.path === 'payload.checks')?.severity, 'error');

check('victory: no check rewarding groundwork is only a warning',
  vProblems({ checks: [vCheck('athletics'), vCheck('crafting'), vCheck('diplomacy'), vCheck('thievery')] })
    .find((p) => p.path === 'payload.checks')?.severity, 'warning');

check('victory: a Lore check with no subject is caught',
  vPaths({ checks: [{ ...vCheck('lore'), loreName: '  ' }, vCheck('crafting'), vCheck('diplomacy'), vCheck('thievery', 'hard', true)] })
    .includes('payload.checks[0].loreName'), true);

check('victory: two checks on one skill leave a character with nothing to try',
  vSay('payload.checks[1].skill',
    { checks: [vCheck('athletics'), vCheck('athletics'), vCheck('diplomacy'), vCheck('thievery', 'hard', true)] }),
  'another check already uses athletics at index 0');

check('victory: fewer checks than characters is flagged',
  vSay('payload.checks', { checks: [vCheck('athletics'), vCheck('thievery', 'hard', true)] }, { partySize: 6 }),
  '2 checks for 6 characters; some will have nothing to try');

/*
 * The scale fixes the endpoint and the number of thresholds; the file only
 * writes their words. Neither mismatch is a schema error.
 */
check('victory: too few thresholds for the scale means some arrive unnamed',
  vSay('payload.thresholds', { thresholds: [{ name: 'One', description: 'a' }] }),
  'the "session" scale has 3 thresholds but only 1 are written; the rest arrive unnamed');

check('victory: too many are dropped, and the GM is told how many',
  vSay('payload.thresholds', {
    thresholds: [1, 2, 3, 4, 5].map((n) => ({ name: `T${n}`, description: 'x' })),
  }),
  '5 written for a scale with 3; the last 2 are dropped');

check('victory: a quick contest wants no thresholds at all',
  vSay('payload.thresholds', { thresholds: [] }, { scale: 'quick' }),
  'no problem reported');

check('victory: an event set past the endpoint never fires',
  vSay('payload.events[0].triggerAt', {
    events: [{ name: 'Too late', description: 'x', triggerKind: 'points', triggerAt: 99 }],
  }),
  '99 points is past the endpoint of 20, so this never fires');

check('victory: one at the endpoint itself is fine',
  vSay('payload.events[0].triggerAt', {
    events: [{ name: 'At the wire', description: 'x', triggerKind: 'points', triggerAt: 20 }],
  }),
  'no problem reported');

check('victory: an event set past the round limit never fires either',
  vSay('payload.events[0].triggerAt', {
    events: [{ name: 'Never', description: 'x', triggerKind: 'rounds', triggerAt: 12 }],
  }, { roundLimit: 8 }),
  'round 12 never arrives; the contest runs for 8');

check('victory: an open-ended contest imposes no round ceiling',
  vSay('payload.events[0].triggerAt', {
    events: [{ name: 'Someday', description: 'x', triggerKind: 'rounds', triggerAt: 99 }],
  }, { roundLimit: 0 }),
  'no problem reported');

const vParsed = parseExchange(JSON.stringify({
  module: 'matadragones-subsystems-implementation-for-pf2e', kind: 'payload', version: 1, type: 'victory',
  given: victoryGiven, payload: victoryPayload,
}));
check('victory: the file parses', vParsed.ok, true);
const vStored = await applyExchange(vParsed);
const vEvent = store.victories.events[vStored.id];
check(
  // The endpoint and the threshold positions come from the published scale
  // table, never from the model, the same rule DCs follow.
  'victory: the endpoint comes from the scale table, not the payload',
  vEvent.points,
  { current: 0, goal: 20 },
);
check(
  'victory: and so do the threshold totals',
  Object.values(vEvent.thresholds).map((t) => t.points).sort((a, b) => a - b),
  [5, 10, 15],
);
check(
  'victory: DCs were computed here from the adjustments',
  Object.values(vEvent.checks).map((c) => c.dc).sort((a, b) => a - b),
  [18, 20, 22, 25],
);
check(
  'victory: a check that needs groundwork pays more and starts hidden',
  Object.values(vEvent.checks).filter((c) => c.award > 0).map((c) => [c.award, c.hidden]),
  [[2, true]],
);
check('victory: the GM premise is kept verbatim', vEvent.premise.includes('only bridge left'), true);

// A diminishing contest starts full rather than empty.
const dimParsed = parseExchange(JSON.stringify({
  module: 'matadragones-subsystems-implementation-for-pf2e', kind: 'payload', version: 1, type: 'victory',
  given: { ...victoryGiven, structure: 'diminishing', scale: 'long' },
  payload: { ...victoryPayload, thresholds: [{ name: 'Fraying', description: 'a' }] },
}));
const dimStored = await applyExchange(dimParsed);
check(
  'victory: a diminishing contest starts at its endpoint',
  store.victories.events[dimStored.id].points,
  { current: 10, goal: 10 },
);

/* --------------------------------------- every subsystem can build a brief */

for (const key of Object.keys(EXCHANGE)) {
  const b = buildBrief(key, { premise: 'p', npcName: 'n', npcDescription: 'd', topic: 't', target: 'x', organization: 'o', baseDC: 15, level: 1, partySize: 4 });
  check(`${key}: brief has a system prompt`, b.systemPrompt.length > 100, true);
  check(`${key}: brief has a user prompt`, b.userPrompt.length > 20, true);
  check(`${key}: brief schema is strict`, b.schema.additionalProperties, false);
}

// The button is in the generate dialogs, which check-parity does not render,
// so nothing else would notice a subsystem losing it.
const { readFileSync } = await import('node:fs');
for (const key of Object.keys(EXCHANGE)) {
  const template = readFileSync(path.join(root, `templates/generate-${key}-dialog.hbs`), 'utf8');
  const dialog = readFileSync(path.join(root, `scripts/apps/generate-${key}-dialog.js`), 'utf8');
  check(`${key}: the dialog offers to save a brief`, template.includes('data-action="saveBrief"'), true);
  check(`${key}: and wires it to its own subsystem`, dialog.includes(`makeSaveBrief('${key}')`), true);
}

if (failed) console.error('\nFAILED');
else console.log('\nok  briefs, payload verification and import hold for every subsystem');
process.exit(failed);
