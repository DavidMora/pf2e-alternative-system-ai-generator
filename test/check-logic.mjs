import path from 'node:path';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
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

// The same guard for the four subsystems added after chases. Only chase relays
// were covered, and these are the messages that would double-count a player's
// points if two GM clients both applied them.
const { shouldApplyInfluence, shouldApplyResearch, shouldApplyInfiltration, shouldApplyLeadership } =
  await import(`file://${base}/socket.js`);
const relays = [
  ['influence', shouldApplyInfluence, { action: 'applyInfluence', influenceId: 'e', participantId: 'p', entryId: 'x', kind: 'influence', degree: 2 }, 'entryId'],
  ['research', shouldApplyResearch, { action: 'applyResearch', researchId: 'e', participantId: 'p', sourceId: 's', checkId: 'c', degree: 2 }, 'sourceId'],
  // `kind` is part of every message the emitter builds and the handler reads it
  // to know where to look, so the predicate requires it too.
  ['infiltration', shouldApplyInfiltration, { action: 'applyInfiltration', infiltrationId: 'e', participantId: 'p', kind: 'complication', ownerId: 'o', checkId: 'c', degree: 2 }, 'ownerId'],
  ['leadership', shouldApplyLeadership, { action: 'applyLeadership', leadershipId: 'e', participantId: 'p', eventId: 'v', checkId: 'c', degree: 2 }, 'eventId'],
];
for (const [name, predicate, base_, idField] of relays) {
  const at = (over = {}) => ({ ...base_, ...over });
  check(`${name}: designated GM applies`, predicate(at({ gmId: 'gm1' }), gm), true);
  check(`${name}: other GM does not double-apply`, predicate(at({ gmId: 'gm2' }), gm), false);
  check(`${name}: falls back to the active GM`, predicate(at(), gm), true);
  check(`${name}: non-active GM ignores fallback`, predicate(at(), { userId: 'gm2', isGM: true, activeGMId: 'gm1' }), false);
  check(`${name}: players never apply`, predicate(at({ gmId: 'p1' }), { userId: 'p1', isGM: false, activeGMId: 'gm1' }), false);
  check(`${name}: rejects out-of-range degree`, predicate(at({ degree: 7, gmId: 'gm1' }), gm), false);
  check(`${name}: rejects a non-integer degree`, predicate(at({ degree: '2', gmId: 'gm1' }), gm), false);
  check(`${name}: rejects a missing ${idField}`, predicate(at({ [idField]: '', gmId: 'gm1' }), gm), false);
  check(`${name}: a chase roll is not one of these`, predicate(roll({ gmId: 'gm1' }), gm), false);
  check(`${name}: junk is ignored`, [predicate(null, gm), predicate('x', gm)], [false, false]);
}

// Each relay must also refuse the others, or one player roll could be applied
// by more than one handler.
for (const [name, predicate] of relays.map(([n, p]) => [n, p])) {
  const foreign = relays.filter(([other]) => other !== name).map(([, , payload]) => predicate(payload, { ...gm, gmId: 'gm1' }));
  check(`${name}: refuses the other subsystems' messages`, foreign, [false, false, false]);
}

// --- every string a template asks for must exist ---
// A missing key renders as the raw key. It looks like a typo in the UI and
// gives no clue which file to open, so pin the whole surface at once.
{
  const lang = JSON.parse(readFileSync(path.join(root, 'lang/en.json'), 'utf8'));
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(hbs|js)$/.test(entry.name)) files.push(full);
    }
  };
  walk(path.join(root, 'templates'));
  walk(path.join(root, 'scripts'));

  const missing = new Set();
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    // localize/format in templates and code, plus bare 'PFAI.*' string literals.
    for (const [, key] of source.matchAll(/(?:localize|format)\(?\s*'(PFAI\.[\w.]+)'/g)) {
      if (!(key in lang)) missing.add(key);
    }
    for (const [, key] of source.matchAll(/localize '(PFAI\.[\w.]+)'/g)) {
      if (!(key in lang)) missing.add(key);
    }
  }
  check('every localisation key a template or script asks for exists', [...missing].sort(), []);
}

// --- the published scale table ---
// Table 3-1 reproduced, not computed. Without this the forefront row silently
// lost a threshold and nothing noticed.
{
  const { VICTORY_SCALES } = await import(`file://${base}/constants.js`);
  const asTable = Object.fromEntries(
    Object.entries(VICTORY_SCALES).map(([key, row]) => [key, [row.goal, row.thresholds]]),
  );
  check('scale table matches GM Core Table 3-1', asTable, {
    quick: [5, []],
    long: [10, [4]],
    session: [20, [5, 10, 15]],
    sideline: [18, [5, 10, 15]],
    forefront: [50, [10, 20, 30, 40]],
  });

  const { victoryPointsForDegree } = await import(`file://${base}/helpers.js`);
  check('accumulating rolls follow the published table',
    [3, 2, 1, 0].map((d) => victoryPointsForDegree(d, 'accumulating')), [2, 1, 0, -1]);
  check('diminishing rolls follow the published table',
    [3, 2, 1, 0].map((d) => victoryPointsForDegree(d, 'diminishing')), [1, 0, -1, -2]);
  check('and a diminishing critical success only recovers where recovery is possible',
    victoryPointsForDegree(3, 'diminishing', false), 0);
}

// --- localisation keys must expand into a tree ---
// Foundry runs expandObject over the language file, turning dotted keys into
// nested objects. A key that is both a value and the prefix of another key
// cannot be both a leaf and a branch, so expandObject throws - and the whole
// file is dropped, taking every other string in the module with it. The symptom
// is the entire UI rendering raw keys, which points nowhere near the cause.
{
  const lang = JSON.parse(readFileSync(path.join(root, 'lang/en.json'), 'utf8'));
  const keys = Object.keys(lang);
  const collisions = keys.filter((key) => keys.some((other) => other.startsWith(`${key}.`)));
  check('no localisation key is both a value and a branch', collisions, []);

  const nonString = keys.filter((key) => typeof lang[key] !== 'string');
  check('every localisation value is a string', nonString, []);
}

// --- the API key must never be a world setting ---
// `restricted: true` only stops players editing a setting. Foundry's server
// sends every world Setting to every client that joins, so a world-scoped key
// is handed to the whole table and readable from any player's console.
{
  const settingsSource = readFileSync(path.join(base, 'settings.js'), 'utf8');
  const registration = settingsSource.slice(settingsSource.indexOf('SETTINGS.apiKey'));
  const scope = registration.match(/scope: '(\w+)'/)?.[1];
  check('the OpenAI key is client scope, not world', scope, 'client');

  const migrateSource = readFileSync(path.join(base, 'migrate.js'), 'utf8');
  check(
    'and a world-scoped one left by an older build is deleted',
    /migrateApiKeyOutOfWorld[\s\S]*?stored\.delete\(\)/.test(migrateSource),
    true,
  );
  const moduleSource = readFileSync(path.join(base, 'module.js'), 'utf8');
  check('and that migration actually runs', moduleSource.includes('migrateApiKeyOutOfWorld()'), true);
}

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

/* ------------------------------------------------- every language, in step */

/*
 * A translation drifts the moment somebody adds an English string and forgets
 * the rest. Worse, a missing placeholder is invisible until a GM sees "Generated
 * chase" with no name in it, so those are compared rather than just the keys.
 */
{
  const manifest = JSON.parse(readFileSync(path.join(root, 'module.json'), 'utf8'));
  const english = JSON.parse(readFileSync(path.join(root, 'lang/en.json'), 'utf8'));
  const placeholders = (value) => [...String(value).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

  check('every language in the manifest has a file that exists',
    manifest.languages.filter((l) => !existsSync(path.join(root, l.path))), []);

  for (const { lang, path: file } of manifest.languages) {
    if (lang === 'en') continue;
    const other = JSON.parse(readFileSync(path.join(root, file), 'utf8'));

    check(`${lang}: nothing is missing`,
      Object.keys(english).filter((k) => !(k in other)), []);
    check(`${lang}: nothing is left over from a removed string`,
      Object.keys(other).filter((k) => !(k in english)), []);
    check(`${lang}: every placeholder survives translation`,
      Object.keys(english)
        .filter((k) => k in other)
        .filter((k) => String(placeholders(english[k])) !== String(placeholders(other[k]))),
      []);
    check(`${lang}: nothing was left blank`,
      Object.entries(other).filter(([, v]) => !String(v).trim()).map(([k]) => k), []);
  }
}

// --- Scene tags on influence checks ------------------------------------------
/*
 * An adventure can hang forty checks off one influence total across many
 * scenes. Tags group them; the filter is what turns "which of these forty can
 * the party roll right now" into one glance.
 */
const { tagKey, parseTags, matchesCheckFilter, buildTagSummary, nextActiveScene, resolveSharedScene, UNTAGGED } = await import(`file://${base}/helpers.js`);

check('tags compare without case or spacing',
  [tagKey('The Feast'), tagKey('the  feast'), tagKey(' THE FEAST ')].every((k) => k === 'the-feast'), true);
check('a comma list becomes trimmed, deduplicated tags',
  parseTags(' the feast , Pepper Contest ,the  feast, '), ['the feast', 'Pepper Contest']);
check('an empty field is no tags', [parseTags(''), parseTags(null), parseTags(' , , ')], [[], [], []]);

const feastRow = { tags: ['The Feast'], hidden: true };
const huntRow = { tags: ['The Hunt'], hidden: false };
const bothRow = { tags: ['The Feast', 'The Hunt'], hidden: false };
const untaggedRow = { tags: [], hidden: true };
const noFilter = { tag: null, reveal: 'all' };

check('no filter shows everything',
  [feastRow, huntRow, bothRow, untaggedRow].every((e) => matchesCheckFilter(e, noFilter)), true);
check('a scene filter shows only that scene, including multi-tagged rows',
  [feastRow, huntRow, bothRow, untaggedRow].map((e) => matchesCheckFilter(e, { tag: 'the-feast', reveal: 'all' })),
  [true, false, true, false]);
check('the filter matches by key, so capitalisation cannot hide a row',
  matchesCheckFilter({ tags: ['the feast'], hidden: false }, { tag: 'the-feast', reveal: 'all' }), true);
check('the untagged bucket is only rows with no tags at all',
  [feastRow, untaggedRow].map((e) => matchesCheckFilter(e, { tag: UNTAGGED, reveal: 'all' })), [false, true]);
check('the reveal filter narrows to what is still hidden',
  [feastRow, huntRow].map((e) => matchesCheckFilter(e, { tag: null, reveal: 'hidden' })), [true, false]);
check('and to what is already revealed',
  [feastRow, huntRow].map((e) => matchesCheckFilter(e, { tag: null, reveal: 'revealed' })), [false, true]);
check('scene and reveal filters combine',
  matchesCheckFilter(bothRow, { tag: 'the-feast', reveal: 'hidden' }), false);
// A row saved before tags existed has no array at all.
check('a legacy row with no tags field survives every filter without throwing', [
  matchesCheckFilter({ hidden: true }, noFilter),
  matchesCheckFilter({ hidden: true }, { tag: 'the-feast', reveal: 'all' }),
  matchesCheckFilter({ hidden: true }, { tag: UNTAGGED, reveal: 'all' }),
], [true, false, true]);

/*
 * The scene bar, and the leak it caused.
 *
 * Built over every entry it listed scenes the party had not reached and said
 * how many checks each still held - a spoiler in a status bar. It is a pure
 * function over "the rows this viewer may see" precisely so that rule is
 * testable rather than buried in a context builder.
 */
const sceneRows = [
  { tags: ['The Feast'], hidden: false },
  { tags: ['The Feast'], hidden: true },
  { tags: ['Pepper contest'], hidden: true },
  { tags: [], hidden: false },
];
const gmSummary = buildTagSummary(sceneRows);
check('a GM sees every scene, with its still-hidden count',
  gmSummary.tags.map((t) => [t.label, t.total, t.hidden]),
  [['Pepper contest', 1, 1], ['The Feast', 2, 1]]);
check('and untagged rows are counted separately', gmSummary.untaggedCount, 1);

// What the view passes for a player: only rows the player can see.
const playerSummary = buildTagSummary(sceneRows.filter((r) => !r.hidden));
check('a player never sees a scene with nothing revealed in it',
  playerSummary.tags.map((t) => t.label), ['The Feast']);
check('and never a count of what is still to come',
  playerSummary.tags.every((t) => t.hidden === 0), true);
check('an entirely hidden scene contributes nothing to a player\'s bar',
  playerSummary.tags.some((t) => t.label === 'Pepper contest'), false);

check('scenes are ordered by name, so the bar does not reshuffle on reveal',
  buildTagSummary([{ tags: ['Zither'] }, { tags: ['Arrival'] }, { tags: ['Marsh'] }])
    .tags.map((t) => t.label), ['Arrival', 'Marsh', 'Zither']);
check('one scene spelled two ways is still one scene',
  buildTagSummary([{ tags: ['The Feast'] }, { tags: ['the feast'] }]).tags.map((t) => [t.label, t.total]),
  [['The Feast', 2]]);

/*
 * The scene is shared: the GM picks it and every open window follows, because
 * it is stored on the event rather than in one window. What that means per
 * viewer is `resolveSharedScene`.
 */
const playerKeys = new Set(playerSummary.tags.map((t) => t.key));
const gmKeys = new Set(gmSummary.tags.map((t) => t.key));
check('the GM\'s chosen scene is the scene a player is put on',
  resolveSharedScene('the-feast', playerKeys), 'the-feast');
check('a scene nothing is revealed in leaves that player on their whole list',
  resolveSharedScene('pepper-contest', playerKeys), null);
check('the GM is never filtered out of their own choice',
  resolveSharedScene('pepper-contest', gmKeys), 'pepper-contest');
check('no scene chosen means no filter', resolveSharedScene('', playerKeys), null);
check('clicking a scene moves the table to it', nextActiveScene('', 'the-feast'), 'the-feast');
check('clicking another moves it there', nextActiveScene('the-feast', 'the-hunt'), 'the-hunt');
check('clicking the one already showing releases the table',
  nextActiveScene('the-feast', 'the-feast'), '');
check('the untagged bucket is not a scene and is never withheld',
  resolveSharedScene(UNTAGGED, playerKeys), UNTAGGED);


/*
 * The call site, guarded at source level.
 *
 * buildTagSummary is pure and tested above, but the leak was in what the view
 * *passed* it, and no suite can call _prepareContext without Foundry. This is
 * the same trick check-imports uses: read the source and assert the wiring.
 */
const viewSource = readFileSync(path.join(base, 'apps', 'subsystem-view.js'), 'utf8');

/*
 * And the guards on the shared state itself. Both are one line in the view and
 * both are the difference between a shared scene and a broken one, so they are
 * asserted against the source: a player must not be able to move the table,
 * and choosing a scene must write to the event - a local field would leave
 * every other window where it was.
 */
const sceneHandler = viewSource.match(
  /static async #onFilterCheckTag\([^)]*\) \{([\s\S]*?)\n  \}/,
)?.[1] ?? '';
check('only a GM may choose the scene the table sees',
  /if \(!game\.user\.isGM\) return;/.test(sceneHandler), true);
check('and the choice is written to the event, which is what syncs it',
  /updateInfluence\(/.test(sceneHandler)
  && /draft\.activeScene = nextActiveScene\(draft\.activeScene, tag\)/.test(sceneHandler), true);
/*
 * The hint that says the table is following. Cosmetic, but it is the only
 * thing telling a GM that picking a scene moved everyone, so it is pinned to
 * the chosen scene rather than to anything a caller passes in.
 */
check('and both sides are told the view is shared, from the chosen scene',
  /sharedWithPlayers: Boolean\(activeTag\) && activeTag !== UNTAGGED,/.test(viewSource), true);
check('the reveal-state filter stays local to the window that set it',
  /this\.#revealFilter = order\[/.test(viewSource)
  && !/draft\.\w*[Rr]evealFilter/.test(viewSource), true);
const taggedLine = viewSource.match(/const tagged = \[([^\]]*)\];/)?.[1] ?? '';
check('the scene bar is built from entries the viewer may see',
  /visible\(event\.discoveries\)/.test(taggedLine) && /visible\(event\.influenceSkills\)/.test(taggedLine), true);
check('and never from the raw collections',
  /Object\.values\(event\.(discoveries|influenceSkills)/.test(taggedLine), false);
// The per-viewer resolution sits between the two and is the reason a player
// is never filtered to a scene that means nothing to them yet.
check('and the shared scene is resolved against what this viewer can see',
  /resolveSharedScene\(shared\.tag, summary\)/.test(viewSource), true);

/*
 * Every field the view writes must be declared in its DataModel.
 *
 * The stores are settings typed by those models, so Foundry cleans each save
 * through the schema and drops what it does not know. An undeclared field
 * therefore writes without error, reads back as undefined, and syncs to
 * nobody - which is what a missing `activeScene` would have looked like: the
 * GM picks a scene, their own window filters because it re-rendered from its
 * own call, and no other window ever moves.
 */
const MODELS = {
  Chase: 'chase.js',
  Influence: 'influence.js',
  Research: 'research.js',
  Infiltration: 'infiltration.js',
  Leadership: 'leadership.js',
  Victory: 'victory.js',
};
const undeclared = [];
for (const [subsystem, file] of Object.entries(MODELS)) {
  const schema = readFileSync(path.join(base, 'data', file), 'utf8');
  const calls = new RegExp(`update${subsystem}\\(([\\s\\S]{0,700}?)\\}\\);`, 'g');
  for (const [, body] of viewSource.matchAll(calls)) {
    for (const [, field] of body.matchAll(/\bdraft\.([A-Za-z_$][\w$]*)/g)) {
      // Declared, however it is built: some schemas share field factories.
      if (!new RegExp(`^\\s*${field}:`, 'm').test(schema)) undeclared.push(`${subsystem}.${field}`);
    }
  }
}
check('nothing the view writes is missing from its schema', undeclared, []);

/*
 * The release contract, checked here rather than discovered on a pushed tag.
 *
 * The workflow refuses a tag that disagrees with `module.json`, and refuses a
 * version with no changelog section - both correct, and both failing after the
 * tag is public, which then has to be deleted and re-pushed. The same three
 * facts are cheap to assert now.
 *
 * `package.json` drifting matters less to Foundry, which never reads it, and
 * more to anyone reading the repo: it sat at 1.0.1 through two releases
 * because nothing compared them.
 */
const manifest = JSON.parse(readFileSync(path.join(root, 'module.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
check('the manifest and the package agree on the version', pkg.version, manifest.version);
check('the version is a plain x.y.z, which is what the tag is built from',
  /^\d+\.\d+\.\d+$/.test(manifest.version), true);
const changelog = readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
const section = new RegExp(`^## ${manifest.version.replace(/\./g, '\\.')}\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm')
  .exec(changelog);
check(`the changelog has notes for ${manifest.version}`, Boolean(section?.[1].trim()), true);
// Every path the manifest names has to exist, or Foundry loads a module that
// is missing a script and says nothing useful about why.
const missing = [
  ...(manifest.esmodules ?? []),
  ...(manifest.styles ?? []),
  ...(manifest.languages ?? []).map((l) => l.path),
].filter((rel) => !existsSync(path.join(root, rel)));
check('every file the manifest names is present', missing, []);

process.exit(failed);
