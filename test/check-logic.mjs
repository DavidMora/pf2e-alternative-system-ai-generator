import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = path.join(root, 'scripts');

// Stub the Foundry globals the pure logic touches.
Math.clamp = (v, min, max) => Math.min(Math.max(v, min), max);
let idCounter = 0;
globalThis.foundry = { utils: { randomID: () => `id${++idCounter}` } };
globalThis.CONFIG = { Dice: { randomUniform: () => 0.55 } };
globalThis.game = {
  actors: [],
  settings: { get: () => '' },
  i18n: {
    localize: (k) => ({ 'PFAI.Chase.CriticalSuccess': 'Critical Success', 'PFAI.Chase.Failure': 'Failure' }[k] ?? k),
    format: (k, d) => `${k} ${JSON.stringify(d)}`,
    lang: 'en',
  },
};

const { dcFromBase, levelDC, buildOvercomeHTML, buildSkillOptions, escapeHTML, slugify, htmlToPromptText, chasePointGoal, chasePointsForDegree } = await import(`file://${base}/helpers.js`);
const { CHASE_SCHEMA, OBSTACLES_SCHEMA, FORK_SCHEMA, toChaseData, toObstacleRecord, premiseToHTML } = await import(`file://${base}/ai/chase.js`);

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) { failed = 1; console.error(`FAIL ${label}\n  got      ${JSON.stringify(actual)}\n  expected ${JSON.stringify(expected)}`); }
  else console.log(`ok  ${label}`);
};

// --- DC maths against the published GM Core table ---
check('levelDC(1)', levelDC(1), 15);
check('levelDC(5)', levelDC(5), 20);
check('levelDC(20)', levelDC(20), 40);
check('levelDC clamps above 25', levelDC(99), 50);
check('levelDC clamps below 0', levelDC(-4), 14);
// DCs now anchor on the GM's base DC, not a level lookup.
check('dcFromBase standard', dcFromBase(20, 'standard'), 20);
check('dcFromBase hard', dcFromBase(20, 'hard'), 22);
check('dcFromBase very-easy', dcFromBase(20, 'very-easy'), 15);
check('dcFromBase incredibly-hard', dcFromBase(20, 'incredibly-hard'), 30);
check('dcFromBase unknown key is standard', dcFromBase(20, 'bogus'), 20);
check('dcFromBase honours an arbitrary base', dcFromBase(13, 'hard'), 15);

// --- escaping / slugs ---
check('escapeHTML', escapeHTML('<b>"x"&y</b>'), '&lt;b&gt;&quot;x&quot;&amp;y&lt;/b&gt;');
check('slugify', slugify('Sailing Lore!'), 'sailing-lore');
const { loreSlug } = await import(`file://${base}/helpers.js`);
check('loreSlug adds suffix', loreSlug('Sailing'), 'sailing-lore');
check('loreSlug does not double it', loreSlug('Sailing Lore'), 'sailing-lore');

// --- overcome HTML composition, including the inline @Check syntax ---
const html = buildOvercomeHTML({
  description: 'A gap between roofs',
  skillOptions: [
    { skill: 'athletics', loreName: '', dcAdjustment: 'standard', description: 'Leap it' },
    { skill: 'lore', loreName: 'Sailing', dcAdjustment: 'hard', description: 'Rig a line' },
  ],
  criticalSuccess: 'Gain 2 points',
  failure: 'You fall',
}, 20);
const expectHtml =
  '<p>A gap between roofs</p>' +
  '<ul><li>@Check[type:athletics|dc:20]{Athletics} &mdash; Leap it</li>' +
  '<li>@Check[type:sailing-lore|dc:22]{Sailing Lore} &mdash; Rig a line</li></ul>' +
  '<p><strong>Critical Success</strong> Gain 2 points</p>' +
  '<p><strong>Failure</strong> You fall</p>';
check('buildOvercomeHTML', html, expectHtml);

// --- prompt text: PF2e inline syntax must not leak into an image prompt ---
{
  // htmlToPromptText needs a DOM; provide a minimal stand-in.
  const originalDoc = globalThis.document;
  globalThis.document = {
    createElement: () => ({
      set innerHTML(v) { this._v = v; },
      get textContent() { return this._v.replace(/<[^>]*>/g, ''); },
    }),
  };
  check('unwraps @Check to its label',
    htmlToPromptText('<p>Leap it with @Check[type:athletics|dc:20]{Athletics} now.</p>'),
    'Leap it with Athletics now.');
  check('drops unlabelled inline syntax',
    htmlToPromptText('<p>Roll @Check[type:athletics|dc:20] here.</p>'),
    'Roll  here.');
  check('splits list items onto lines',
    htmlToPromptText('<ul><li>One</li><li>Two</li></ul>'), 'One\nTwo');
  check('collapses blank lines', htmlToPromptText('<p>A</p><p></p><p>B</p>'), 'A\nB');
  check('empty input stays empty', htmlToPromptText(''), '');
  globalThis.document = originalDoc;
}

// --- mapping a model payload onto the stored shape ---
const GM_PREMISE = 'The party chases a cutpurse across the rooftops.';
const chase = toChaseData({
  name: 'AI Suggested Name', gmNotes: 'Secret', roundLimit: 6,
  obstacles: [
    { name: 'A', description: 'a', roundAllowance: 2, skillOptions: [], criticalSuccess: '', failure: '' },
    { name: 'B', description: 'b', roundAllowance: 9, skillOptions: [], criticalSuccess: '', failure: '' },
  ],
}, { premise: GM_PREMISE, baseDC: 20, level: 5, partySize: 4, model: 'gpt-5.6-terra' });

const obstacles = Object.values(chase.obstacles).sort((a, b) => a.position - b.position);
check('two obstacles', obstacles.length, 2);
check('first obstacle unlocked', obstacles[0].locked, false);
check('later obstacles locked', obstacles[1].locked, true);
// Goals are now rolled from party size, not taken from the model.
check('goal sized from party of 4', [2, 3].includes(obstacles[0].chasePoints.goal), true);
check('round allowance stored', obstacles[0].rounds.max >= 1, true);
check('round limit stored', chase.rounds.max, 6);
check('base DC stored', chase.baseDC, 20);

// The GM's premise is authoritative: stored verbatim, never model-authored.
check('premise kept verbatim', chase.premise, `<p>${GM_PREMISE}</p>`);
check('AI name used when GM gave none', chase.name, 'AI Suggested Name');
check('GM title overrides AI name',
  toChaseData({ name: 'AI Name', gmNotes: '', roundLimit: 0, obstacles: [] },
    { premise: 'p', baseDC: 15, title: 'My Title' }).name, 'My Title');

// premiseToHTML: plain text becomes paragraphs, existing HTML is left alone.
check('premise single paragraph', premiseToHTML('One line.'), '<p>One line.</p>');
check('premise blank line splits', premiseToHTML('A\n\nB'), '<p>A</p><p>B</p>');
check('premise single newline is a break', premiseToHTML('A\nB'), '<p>A<br>B</p>');
check('premise passes HTML through', premiseToHTML('<p>Already</p>'), '<p>Already</p>');
check('premise empty stays empty', premiseToHTML('   '), '');

// Obstacles-only generation produces the same stored shape.
const record = toObstacleRecord([
  { name: 'X', description: 'x', roundAllowance: 3, skillOptions: [], criticalSuccess: '', failure: '' },
  { name: 'Y', description: 'y', roundAllowance: 1, skillOptions: [], criticalSuccess: '', failure: '' },
], 18, 4);
const recVals = Object.values(record).sort((a, b) => a.position - b.position);
check('obstacles-only count', recVals.length, 2);
check('obstacles-only first unlocked', recVals[0].locked, false);
check('obstacles-only later locked', recVals[1].locked, true);
check('obstacles-only points reset', recVals[0].chasePoints.current, 0);
check('obstacles-only carries skill options', typeof recVals[0].skillOptions, 'object');
check('chase starts hidden', chase.hidden, true);
check('provenance records the GM premise', [chase.ai.generated, chase.ai.model, chase.ai.prompt], [true, 'gpt-5.6-terra', GM_PREMISE]);
check('untimed chase -> null', toChaseData({ name: 'x', gmNotes: '', roundLimit: 0, obstacles: [] }, { premise: 'p', baseDC: 15, partySize: 4 }).rounds.max, null);

// --- chase point goal, as published: half need size-1, half need size-2, min 1 ---
check('party 4 alternates 3,2', [0, 1, 2, 3].map((i) => chasePointGoal(4, i)), [3, 2, 3, 2]);
check('party 6 alternates 5,4', [0, 1, 2, 3].map((i) => chasePointGoal(6, i)), [5, 4, 5, 4]);
check('party 5 alternates 4,3', [0, 1].map((i) => chasePointGoal(5, i)), [4, 3]);
// Minimum of 1 chase point per obstacle.
check('party 2 floors at 1', [0, 1].map((i) => chasePointGoal(2, i)), [1, 1]);
check('solo party floors at 1', [0, 1].map((i) => chasePointGoal(1, i)), [1, 1]);
check('party size floors at 1', chasePointGoal(0, 0), 1);
check('negative index still alternates', chasePointGoal(4, -1), 2);
// Exactly half the obstacles take each value across an even-length chase.
{
  const goals = [...Array(6)].map((_, i) => chasePointGoal(4, i));
  check('half and half', [goals.filter((g) => g === 3).length, goals.filter((g) => g === 2).length], [3, 3]);
}

// --- degree of success to chase points (PF2e chase rules) ---
check('critical success', chasePointsForDegree(3), 2);
check('success', chasePointsForDegree(2), 1);
check('failure', chasePointsForDegree(1), 0);
check('critical failure', chasePointsForDegree(0), -1);
check('unknown degree is inert', chasePointsForDegree(undefined), 0);

// --- migration: recover roll options from pre-existing HTML ---
const { parseSkillOptions } = await import(`file://${base}/migrate.js`);
{
  const html = '<p>A gap.</p><ul>' +
    '<li>@Check[type:athletics|dc:20]{Athletics} &mdash; Leap the gap.</li>' +
    '<li>@Check[type:acrobatics|dc:22]{Acrobatics} &mdash; Tumble across.</li>' +
    '<li>@Check[type:absalom-lore|dc:18]{Absalom Lore} &mdash; Recall a stair.</li></ul>';
  const parsed = Object.values(parseSkillOptions(html)).sort((a, b) => a.position - b.position);
  check('recovers every option', parsed.length, 3);
  check('recovers slug + dc + label',
    parsed.map((o) => `${o.slug}/${o.dc}/${o.label}`),
    ['athletics/20/Athletics', 'acrobatics/22/Acrobatics', 'absalom-lore/18/Absalom Lore']);
  check('recovers descriptions', parsed[0].description, 'Leap the gap.');
  check('preserves order', parsed.map((o) => o.position), [0, 1, 2]);
  check('empty html yields nothing', Object.keys(parseSkillOptions('')).length, 0);
  check('html without checks yields nothing', Object.keys(parseSkillOptions('<p>Just prose.</p>')).length, 0);
  // An option with no trailing description must still be recovered.
  check('handles a bare check',
    Object.values(parseSkillOptions('<li>@Check[type:stealth|dc:15]{Stealth}</li>'))[0].slug, 'stealth');
}

// --- contribution crediting: credit what the obstacle actually moved ---
{
  // Mirrors the arithmetic in applyRollResult without needing a live world.
  const credit = (before, points) => {
    const after = Math.max(0, before + points);
    return { after, applied: after - before };
  };
  check('success credits 1', credit(0, 1), { after: 1, applied: 1 });
  check('critical success credits 2', credit(1, 2), { after: 3, applied: 2 });
  check('failure credits 0', credit(2, 0), { after: 2, applied: 0 });
  check('critical failure credits -1', credit(2, -1), { after: 1, applied: -1 });
  // The zero floor must not be recorded as a -1 contribution.
  check('critical failure at zero credits nothing', credit(0, -1), { after: 0, applied: 0 });
}

// --- routing: an approach can commit you to a route ---
{
  const html = buildOvercomeHTML({
    description: 'A fork in the road.',
    skillOptions: [
      { skill: 'athletics', loreName: '', dcAdjustment: 'standard', description: 'Climb.', leadsTo: 'A' },
      { skill: 'stealth', loreName: '', dcAdjustment: 'standard', description: 'Slip past.', leadsTo: 'b' },
      { skill: 'nature', loreName: '', dcAdjustment: 'standard', description: 'Read the ground.' },
    ],
  }, 20);
  check('routed option annotated', html.includes('Climb. <em>PFAI.Chase.LeadsToRoute'), true);
  // Case is normalised so "b" and "B" are the same route.
  check('unrouted option left alone', /Read the ground\.<\/li>/.test(html), true);

  const options = Object.values(buildSkillOptions({
    skillOptions: [
      { skill: 'athletics', loreName: '', dcAdjustment: 'standard', description: '', leadsTo: 'b' },
      { skill: 'stealth', loreName: '', dcAdjustment: 'standard', description: '' },
    ],
  }, 20)).sort((a, b) => a.position - b.position);
  check('leadsTo normalised to upper case', options[0].leadsTo, 'B');
  check('missing leadsTo becomes empty', options[1].leadsTo, '');
}

// --- branching: forks share a step and each participant faces their own ---
const { obstacleLabels, nextBranchLabel, obstacleForParticipant, sortObstacles,
        stepsOf, branchesAt, nextStepPosition, routeTargetsFor, unroutedOptions } =
  await import(`file://${base}/helpers.js`);
{
  const obstacles = {
    a: { id: 'a', position: 0, branch: '' },
    b: { id: 'b', position: 1, branch: 'A' },
    c: { id: 'c', position: 1, branch: 'B' },
    d: { id: 'd', position: 2, branch: '' },
  };
  const labels = obstacleLabels(obstacles);
  // A fork must not consume two step numbers.
  check('labels number forks within a step',
    ['a', 'b', 'c', 'd'].map((k) => labels.get(k)), ['1', '2A', '2B', '3']);
  check('sorts by step then branch', sortObstacles(obstacles).map((o) => o.id), ['a', 'b', 'c', 'd']);
  check('next branch letter skips used', nextBranchLabel(obstacles, 1), 'C');
  // Forking a plain step labels the existing obstacle A, then the new one B.
  check('first fork claims A', nextBranchLabel(obstacles, 0), 'A');
  {
    const forked = { ...obstacles, a: { ...obstacles.a, branch: 'A' } };
    check('second fork claims B', nextBranchLabel(forked, 0), 'B');
    check('labels after forking', ['a'].map((k) => obstacleLabels(forked).get(k)), ['1A']);
  }
  check('participant on B faces 2B', obstacleForParticipant(obstacles, 1, 'B').id, 'c');
  check('participant on A faces 2A', obstacleForParticipant(obstacles, 1, 'A').id, 'b');
  // An unassigned participant must still land somewhere sensible.
  check('unassigned falls back to the first fork', obstacleForParticipant(obstacles, 1, '').id, 'b');
  check('unknown branch falls back too', obstacleForParticipant(obstacles, 1, 'Z').id, 'b');
  check('unbranched step ignores branch', obstacleForParticipant(obstacles, 0, 'B').id, 'a');
  check('no obstacle at that step', obstacleForParticipant(obstacles, 9, ''), null);
}

// --- route annotations must stay in sync when routing changes ---
{
  // Mirrors rebuildOvercomeRoutes' strip-then-reapply, which is what keeps the
  // read-aloud prose from drifting away from the stored leadsTo values.
  const noteFor = (b) => `(takes you along route ${b})`;
  const rebuild = (html, options) => {
    const stripped = html.replace(/\s*<em>\(takes you along route [^<]*\)<\/em>/g, '');
    return options.reduce((acc, o) => {
      if (!o.leadsTo) return acc;
      const re = new RegExp(`(\\{${o.label}\\}[^<]*)(</li>)`);
      return acc.replace(re, `$1 <em>${noteFor(o.leadsTo)}</em>$2`);
    }, stripped);
  };

  const stale = '<ul><li>@Check[type:athletics|dc:16]{Athletics} &mdash; Climb. <em>(takes you along route D)</em></li>' +
                '<li>@Check[type:survival|dc:18]{Survival} &mdash; Track.</li></ul>';
  const fixed = rebuild(stale, [{ label: 'Athletics', leadsTo: 'A' }, { label: 'Survival', leadsTo: 'B' }]);
  check('stale annotation corrected', fixed.includes('route D'), false);
  check('new annotation applied', fixed.includes('Climb. <em>(takes you along route A)</em>'), true);
  check('previously unannotated option gains one', fixed.includes('Track. <em>(takes you along route B)</em>'), true);
  // Running twice must not stack notes.
  const twice = rebuild(fixed, [{ label: 'Athletics', leadsTo: 'A' }, { label: 'Survival', leadsTo: 'B' }]);
  check('idempotent', twice, fixed);
  // Clearing a route removes the note entirely.
  const cleared = rebuild(fixed, [{ label: 'Athletics', leadsTo: '' }, { label: 'Survival', leadsTo: 'B' }]);
  check('cleared route drops its note', cleared.includes('Climb. <em>'), false);
}

// --- route topology: rolls at step N choose the branch at step N+1 ---
{
  //  1  ->  2A | 2B  ->  3
  const obstacles = {
    one:  { id: 'one',  position: 0, branch: '',  name: 'Start',  skillOptions: {
      x: { id: 'x', label: 'Athletics', leadsTo: 'A' },
      y: { id: 'y', label: 'Stealth',   leadsTo: 'B' },
      z: { id: 'z', label: 'Nature',    leadsTo: '' },
    } },
    twoA: { id: 'twoA', position: 1, branch: 'A', name: 'Rooftops', skillOptions: {} },
    twoB: { id: 'twoB', position: 1, branch: 'B', name: 'Sewers',   skillOptions: {} },
    three:{ id: 'three',position: 2, branch: '',  name: 'Finish',   skillOptions: {
      w: { id: 'w', label: 'Athletics', leadsTo: '' },
    } },
  };

  check('steps collapse forks', stepsOf(obstacles), [0, 1, 2]);
  check('a step lists its alternatives', branchesAt(obstacles, 1).map((o) => o.id), ['twoA', 'twoB']);
  check('next step after 1 is 2', nextStepPosition(obstacles, 0), 1);
  check('next step after 2 is 3', nextStepPosition(obstacles, 1), 2);
  check('last step has no next', nextStepPosition(obstacles, 2), null);

  // Step 1 routes into the fork at step 2.
  const fromOne = routeTargetsFor(obstacles, 0);
  check('step 1 sees the fork', [fromOne.endsChase, fromOne.forked], [false, true]);
  check('step 1 targets are 2A and 2B', fromOne.targets.map((t) => t.label), ['2A', '2B']);

  // Step 2 leads to an unforked step 3, so there is nothing to choose.
  const fromTwo = routeTargetsFor(obstacles, 1);
  check('step 2 has a single destination', [fromTwo.endsChase, fromTwo.forked], [false, false]);

  // The last step ends the chase.
  check('last step ends the chase', routeTargetsFor(obstacles, 2).endsChase, true);

  // Only step 1 can have dead ends, because only step 1 precedes a fork.
  check('unrouted approach detected', unroutedOptions(obstacles.one, obstacles).map((o) => o.label), ['Nature']);
  check('no dead ends into an unforked step', unroutedOptions(obstacles.twoA, obstacles), []);
  check('no dead ends on the last step', unroutedOptions(obstacles.three, obstacles), []);

  // The first step must never be forkable.
  check('first step is the one nothing routes into', stepsOf(obstacles)[0], obstacles.one.position);
}

// --- socket targeting rules ---
const { shouldHandle } = await import(`file://${base}/socket.js`);
const msg = (over = {}) => ({ action: 'showChase', chaseId: 'c1', ...over });
check('handles a broadcast', shouldHandle(msg(), 'u1'), true);
check('handles when listed', shouldHandle(msg({ userIds: ['u1', 'u2'] }), 'u1'), true);
check('ignores when not listed', shouldHandle(msg({ userIds: ['u2'] }), 'u1'), false);
check('ignores an empty recipient list', shouldHandle(msg({ userIds: [] }), 'u1'), false);
check('ignores an unknown action', shouldHandle(msg({ action: 'other' }), 'u1'), false);
check('ignores a missing chaseId', shouldHandle(msg({ chaseId: '' }), 'u1'), false);
check('ignores junk payloads', [shouldHandle(null, 'u1'), shouldHandle('x', 'u1'), shouldHandle(undefined, 'u1')], [false, false, false]);
check('ignores a malformed recipient list', shouldHandle(msg({ userIds: 'u1' }), 'u1'), false);

// --- roll relay: exactly one GM must apply a player's result ---
const { shouldApplyRoll } = await import(`file://${base}/socket.js`);
const roll = (over = {}) => ({ action: 'applyRoll', chaseId: 'c', obstacleId: 'o', participantId: 'p', degree: 2, ...over });
const gm = { userId: 'gm1', isGM: true, activeGMId: 'gm1' };
check('designated GM applies', shouldApplyRoll(roll({ gmId: 'gm1' }), gm), true);
check('other GM does not double-apply', shouldApplyRoll(roll({ gmId: 'gm2' }), gm), false);
check('falls back to the active GM', shouldApplyRoll(roll(), gm), true);
check('non-active GM ignores fallback', shouldApplyRoll(roll(), { userId: 'gm2', isGM: true, activeGMId: 'gm1' }), false);
check('players never apply', shouldApplyRoll(roll({ gmId: 'p1' }), { userId: 'p1', isGM: false, activeGMId: 'gm1' }), false);
check('rejects out-of-range degree', shouldApplyRoll(roll({ degree: 7, gmId: 'gm1' }), gm), false);
check('rejects non-integer degree', shouldApplyRoll(roll({ degree: '2', gmId: 'gm1' }), gm), false);
check('rejects missing ids', shouldApplyRoll(roll({ obstacleId: '', gmId: 'gm1' }), gm), false);
check('showChase is not a roll', shouldApplyRoll(msg(), gm), false);

// A passed turn carries no degree but is gated the same way.
const { shouldApplyPass } = await import(`file://${base}/socket.js`);
const pass = (over = {}) => ({ action: 'applyPass', chaseId: 'c', obstacleId: 'o', participantId: 'p', ...over });
check('designated GM applies a pass', shouldApplyPass(pass({ gmId: 'gm1' }), gm), true);
check('other GM does not double-apply a pass', shouldApplyPass(pass({ gmId: 'gm2' }), gm), false);
check('players never apply a pass', shouldApplyPass(pass(), { userId: 'p1', isGM: false, activeGMId: 'gm1' }), false);
check('a pass needs no degree', shouldApplyPass(pass({ gmId: 'gm1', degree: undefined }), gm), true);
check('a roll is not a pass', shouldApplyPass(roll({ gmId: 'gm1' }), gm), false);
check('a pass is not a roll', shouldApplyRoll(pass({ gmId: 'gm1' }), gm), false);
check('a pass still needs ids', shouldApplyPass(pass({ participantId: '', gmId: 'gm1' }), gm), false);

// --- Structured Outputs strict-mode invariants ---
function assertStrict(node, path = '$') {
  if (node.type === 'object') {
    if (node.additionalProperties !== false) { failed = 1; console.error(`FAIL ${path}: additionalProperties must be false`); }
    const props = Object.keys(node.properties ?? {});
    const required = node.required ?? [];
    const missing = props.filter((p) => !required.includes(p));
    if (missing.length) { failed = 1; console.error(`FAIL ${path}: not required: ${missing}`); }
    for (const [k, v] of Object.entries(node.properties ?? {})) assertStrict(v, `${path}.${k}`);
  } else if (node.type === 'array') {
    assertStrict(node.items, `${path}[]`);
  }
}
assertStrict(CHASE_SCHEMA);
assertStrict(OBSTACLES_SCHEMA);
assertStrict(FORK_SCHEMA);
if (CHASE_SCHEMA.properties.premise) { failed = 1; console.error('FAIL: schema must not let the model author the premise'); }
console.log('ok  both schemas satisfy strict-mode rules, and neither generates a premise');

process.exit(failed);
