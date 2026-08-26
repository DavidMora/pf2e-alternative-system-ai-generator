/*
 * The maths, and the store beneath it.
 *
 * These are the functions CLAUDE.md calls non-negotiable: values that scale with
 * the party come from the published formula, DCs come from the published table,
 * and credit reflects what actually changed. Almost none of it was covered — the
 * degree tables were, the rest was not.
 */
import { installGlobals, load, makeCheck, reset, store } from './harness.mjs';

installGlobals();
const { check, done } = makeCheck();

const h = await load('helpers.js');
const { DC_ADJUSTMENTS, LEVEL_DCS, ORGANIZATION_TABLE } = await load('constants.js');

/* ------------------------------------------------------------------ the DCs */

// The whole module rests on this: the GM gives a base, the model gives a word,
// and the number is computed here.
check('every published adjustment applies', Object.keys(DC_ADJUSTMENTS).map((k) => h.dcFromBase(20, k)),
  [10, 15, 18, 20, 22, 25, 30]);
check('an unknown adjustment is inert rather than guessed', h.dcFromBase(20, 'quite-hard'), 20);
check('a missing adjustment is inert', h.dcFromBase(20, undefined), 20);
check('a fractional base is rounded, not truncated', h.dcFromBase(19.6, 'standard'), 20);

// levelDC is the table models get wrong, which is why they are never asked.
check('level DCs come from the published table', [0, 1, 5, 10, 20, 25].map((l) => h.levelDC(l)),
  [0, 1, 5, 10, 20, 25].map((l) => LEVEL_DCS[l]));
check('a level past the table clamps rather than returning undefined',
  Number.isInteger(h.levelDC(99)), true);

/* ------------------------------------------------- values that scale by party */

// The published chase formula alternates partySize-1 and partySize-2.
check('chase goals alternate down the obstacle list',
  [0, 1, 2, 3].map((i) => h.chasePointGoal(4, i)), [3, 2, 3, 2]);
check('and never drop below one, however small the party',
  [0, 1].map((i) => h.chasePointGoal(1, i)), [1, 1]);
check('a missing party size is treated as one, not as zero',
  h.chasePointGoal(undefined, 0) >= 1, true);

/* ------------------------------------------------------------ degree tables */

check('chase/influence/research share one published table',
  [3, 2, 1, 0].map(h.chasePointsForDegree), [2, 1, 0, -1]);
check('infiltration pays progress only on a success',
  [3, 2, 1, 0].map(h.infiltrationPointsForDegree), [2, 1, 0, 0]);
check('and charges awareness only on a failure',
  [3, 2, 1, 0].map(h.awarenessForDegree), [0, 0, 1, 2]);
// Failure costing secrecy rather than progress is the thing that makes
// infiltration different from every other subsystem.
check('so a failed infiltration check costs no progress at all',
  h.infiltrationPointsForDegree(1) === 0 && h.awarenessForDegree(1) > 0, true);

check('victory accumulating reuses the shared table',
  [3, 2, 1, 0].map((d) => h.victoryPointsForDegree(d, 'accumulating')), [2, 1, 0, -1]);
check('victory diminishing runs the other way',
  [3, 2, 1, 0].map((d) => h.victoryPointsForDegree(d, 'diminishing')), [1, 0, -1, -2]);
check('an unknown structure falls back to accumulating rather than zero',
  h.victoryPointsForDegree(3, 'nonsense'), 2);

/* -------------------------------------------------------- end of the track */

check('an accumulating contest ends at its endpoint',
  [h.victoryReached({ structure: 'accumulating', points: { current: 19, goal: 20 } }),
   h.victoryReached({ structure: 'accumulating', points: { current: 20, goal: 20 } })],
  [false, true]);
check('a diminishing contest ends at zero',
  [h.victoryReached({ structure: 'diminishing', points: { current: 1, goal: 10 } }),
   h.victoryReached({ structure: 'diminishing', points: { current: 0, goal: 10 } })],
  [false, true]);
check('and a malformed event is not "reached"', h.victoryReached(undefined), false);

/* ------------------------------------------------------- the published table */

check('the organisation table has all twenty levels', ORGANIZATION_TABLE.length, 20);
check('organisation size reads the table, one-indexed, and says which level',
  h.organizationSize(1), { level: 1, ...ORGANIZATION_TABLE[0] });
check('and clamps rather than reading off the end',
  [h.organizationSize(0).followers, h.organizationSize(21).followers],
  [ORGANIZATION_TABLE[0].followers, ORGANIZATION_TABLE[19].followers]);
check('followers never shrink as an organisation grows',
  (() => {
    // The published table writes thousands with commas.
    const first = (r) => Number(String(r.followers).split('-')[0].replace(/,/g, ''));
    return ORGANIZATION_TABLE.every((row, i) => i === 0 || first(row) >= first(ORGANIZATION_TABLE[i - 1]));
  })(), true);

/* --------------------------------------------------------------- the scale */

const scales = ['quick', 'long', 'session', 'sideline', 'forefront'];
check('every scale names an endpoint above zero',
  scales.every((s) => h.victoryScale(s).goal > 0), true);
check('and thresholds that sit below it',
  scales.every((s) => h.victoryScale(s).thresholds.every((t) => t < h.victoryScale(s).goal)), true);
check('thresholds ascend',
  scales.every((s) => {
    const t = h.victoryScale(s).thresholds;
    return t.every((v, i) => i === 0 || v > t[i - 1]);
  }), true);
check('an unknown scale falls back rather than returning undefined',
  h.victoryScale('enormous'), h.victoryScale('session'));

/* ---------------------------------------------------------------- the slugs */

check('a lore skill becomes a pf2e slug', h.loreSlug('Absalom Law'), 'absalom-law-lore');
check('an already-suffixed lore is not double-suffixed', h.loreSlug('Sailing Lore'), 'sailing-lore');
check('an empty lore does not produce a bare "-lore"', h.loreSlug(''), '');
check('capitalize leaves the rest of the word alone', h.capitalize('thievery'), 'Thievery');

/*
 * htmlToPromptText is not here: it uses `document` to strip tags, so testing it
 * in Node would mean testing a DOM shim rather than the function. It is
 * exercised for real every time an encounter is generated.
 */

/* ------------------------------------------------------------- positioning */

check('the first entry in an empty record takes position zero', h.nextPosition({}), 0);
check('and the next takes one past the highest, not the count',
  h.nextPosition({ a: { position: 0 }, b: { position: 7 } }), 8);
check('a record with no positions still yields a number',
  Number.isInteger(h.nextPosition({ a: {} })), true);

/* -------------------------------------------------- the store, all six of them */

const stores = [
  ['chase', 'chases', h.getChases, h.setChases, h.getChase, h.updateChase, h.deleteChase],
  ['influence', 'influences', h.getInfluences, h.setInfluences, h.getInfluence, h.updateInfluence, h.deleteInfluence],
  ['research', 'researches', h.getResearches, h.setResearches, h.getResearch, h.updateResearch, h.deleteResearch],
  ['infiltration', 'infiltrations', h.getInfiltrations, h.setInfiltrations, h.getInfiltration, h.updateInfiltration, h.deleteInfiltration],
  ['leadership', 'leaderships', h.getLeaderships, h.setLeaderships, h.getLeadership, h.updateLeadership, h.deleteLeadership],
  ['victory', 'victories', h.getVictories, h.setVictories, h.getVictory, h.updateVictory, h.deleteVictory],
];

for (const [name, key, getAll, setAll, get, update, remove] of stores) {
  reset();
  check(`${name}: an empty store reads as an empty event map`, getAll(), { events: {} });

  await setAll({ events: { e1: { id: 'e1', name: 'One' } } });
  check(`${name}: what was saved is what is read back`, get('e1').name, 'One');
  check(`${name}: and an id that is not there reads as null`, get('nope'), null);

  await update('e1', (draft) => {
    draft.name = 'Two';
  });
  check(`${name}: update mutates through the draft`, get('e1').name, 'Two');

  const missing = await update('nope', () => {
    throw new Error('the mutator must not run for an id that is absent');
  });
  check(`${name}: updating an absent id is a no-op, not a throw`, missing, null);

  await remove('e1');
  check(`${name}: delete removes it`, get('e1'), null);
  check(`${name}: and leaves the store readable`, getAll(), { events: {} });

  // Each subsystem must own its own setting key, or two of them share a store.
  await setAll({ events: { x: { id: 'x' } } });
  check(`${name}: writes to its own key`, Object.keys(store), [key]);
  reset();
}

done('helpers, formulas and every store');
