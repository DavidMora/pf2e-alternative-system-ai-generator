/*
 * Rolling, and what a roll does to the track.
 *
 * Two halves. The first applies results for chase, influence, research and
 * infiltration — invariants verified by hand in a live world and written down
 * so they stay verified. The second drives the roll entry points themselves.
 *
 * The largest untested file in the module. Two things are worth the trouble of
 * driving the real entry points rather than asserting on hand-written payloads.
 *
 * One: the player→GM relay only works if the payload `rolls.js` builds satisfies
 * the predicate `socket.js` guards with. Those live in different files and
 * nothing connects them — a missing field is not an error, it is a roll that
 * vanishes. So these tests roll as a player and feed whatever actually went out
 * to the real predicate.
 *
 * Two: the award ladder here had an inverted sign that made a success on the
 * best check in the game cost the party two points, and no test caught it
 * because nothing exercised the maths. It is exercised now.
 */
import {
  asPlayer, installGlobals, load, makeActor, makeCheck, notes, reset, store,
} from './harness.mjs';

installGlobals();
const { check, done } = makeCheck();

const rolls = await load('rolls.js');
const socket = await load('socket.js');
const h = await load('helpers.js');

const sent = [];
globalThis.game.socket = { emit: (_c, data) => sent.push(data) };

const gmContext = { userId: 'gm1', isGM: true, activeGMId: 'gm1' };

/** A minimal stored victory event with one participant and the given checks. */
function victoryEvent(overrides = {}) {
  return {
    id: 'v1', name: 'Kettle Bridge', hidden: false, started: true,
    structure: 'accumulating', scale: 'session', recoveryPossible: true,
    baseDC: 20, level: 5, partySize: 4, outcome: '',
    points: { current: 0, goal: 20 },
    rounds: { current: 0, max: null, unit: '' },
    checks: {
      open: { id: 'open', label: 'Athletics', slug: 'athletics', dc: 20, award: 0, hidden: false, revealAt: null, position: 0 },
      secret: { id: 'secret', label: 'Thievery', slug: 'thievery', dc: 25, award: 2, hidden: true, revealAt: null, position: 1 },
    },
    thresholds: {}, events: {},
    participants: {
      p1: {
        id: 'p1', name: 'Kyra', uuid: 'Actor.kyra', hidden: false, hasActed: false,
        contribution: { total: 0, successes: 0, rolls: 0 },
      },
    },
    ...overrides,
  };
}

async function seedVictory(overrides) {
  reset();
  await h.setVictories({ events: { v1: victoryEvent(overrides) } });
}

/* ------------------------------------------- the relay, driven for real */

/*
 * Rolling as a player must produce a message the receiving GM accepts. The
 * payload is whatever rolls.js built — not something written here to match.
 */
await seedVictory();
makeActor({ uuid: 'Actor.kyra', name: 'Kyra', degree: 2, slugs: ['athletics'] });
sent.length = 0;
const relayed = await asPlayer(() =>
  rolls.rollVictoryCheck({ victoryId: 'v1', participantId: 'p1', checkId: 'open' }));

check('a player rolling reports the degree back to their own sheet', relayed, { degree: 2 });
check('and sends exactly one message', sent.length, 1);
check('which the designated GM accepts', socket.shouldApplyVictory(sent[0], gmContext), true);
check('a player never applies their own roll to the track',
  h.getVictory('v1').points.current, 0);

// The same message must not be applied twice by a second GM.
check('a second GM ignores it',
  socket.shouldApplyVictory(sent[0], { userId: 'gm2', isGM: true, activeGMId: 'gm1' }), false);

// And the GM path applies directly, without going near the socket.
await seedVictory();
makeActor({ uuid: 'Actor.kyra', degree: 2, slugs: ['athletics'] });
sent.length = 0;
await rolls.rollVictoryCheck({ victoryId: 'v1', participantId: 'p1', checkId: 'open' });
check('a GM applies directly rather than relaying', sent.length, 0);
check('and the track moved', h.getVictory('v1').points.current, 1);

/* ------------------------------------------------------------ the guards */

await seedVictory();
makeActor({ uuid: 'Actor.kyra', degree: 3, slugs: ['athletics', 'thievery'] });
check('a hidden check is unrollable by the GM, who should reveal it first',
  await rolls.rollVictoryCheck({ victoryId: 'v1', participantId: 'p1', checkId: 'secret' }), null);
const byPlayer = await asPlayer(() =>
  rolls.rollVictoryCheck({ victoryId: 'v1', participantId: 'p1', checkId: 'secret' }));
check('and unrollable by a player who guesses its id', byPlayer, null);
check('so nothing was scored off it', h.getVictory('v1').points.current, 0);

await seedVictory();
makeActor({ uuid: 'Actor.kyra', degree: 2, slugs: ['athletics'] });
await rolls.rollVictoryCheck({ victoryId: 'v1', participantId: 'p1', checkId: 'open' });
check('having acted blocks a second roll',
  await rolls.rollVictoryCheck({ victoryId: 'v1', participantId: 'p1', checkId: 'open' }), null);
check('but the GM may force one anyway, because the GM runs the game',
  await rolls.rollVictoryCheck({ victoryId: 'v1', participantId: 'p1', checkId: 'open', force: true }),
  { degree: 2 });
check('and a player cannot force it', await asPlayer(() =>
  rolls.rollVictoryCheck({ victoryId: 'v1', participantId: 'p1', checkId: 'open', force: true })), null);

await seedVictory();
makeActor({ uuid: 'Actor.kyra', degree: 2, slugs: ['athletics'], isOwner: false });
check('an actor the roller does not own is refused',
  await rolls.rollVictoryCheck({ victoryId: 'v1', participantId: 'p1', checkId: 'open' }), null);

await seedVictory();
makeActor({ uuid: 'Actor.kyra', degree: 2, slugs: ['acrobatics'] });
check('a participant without the statistic is refused rather than rolled at zero',
  await rolls.rollVictoryCheck({ victoryId: 'v1', participantId: 'p1', checkId: 'open' }), null);

check('an unknown event id is a no-op',
  await rolls.rollVictoryCheck({ victoryId: 'nope', participantId: 'p1', checkId: 'open' }), null);

/* -------------------------------------------------------- the award ladder */

/*
 * The bug that shipped: an award multiplied by direction, so the best check in
 * a diminishing contest punished a success. An award is a reward — it moves the
 * total the way the party wants, in both structures — and a critical success
 * must still beat a plain one, or rolling well stops mattering on exactly the
 * check the GM made special.
 */
/*
 * Sequential by construction: every case seeds the same single-event store, so
 * running them concurrently would have them overwrite each other. (They did,
 * and reported the last writer's answer four times.)
 */
async function applyEach(cases) {
  const out = [];
  for (const c of cases) out.push(await applyOn(c));
  return out;
}

async function applyOn({ structure, current, degree, award, recoveryPossible = true }) {
  await seedVictory({
    structure, recoveryPossible,
    points: { current, goal: 20 },
    checks: {
      open: { id: 'open', label: 'Athletics', slug: 'athletics', dc: 20, award, hidden: false, revealAt: null, position: 0 },
    },
  });
  await rolls.applyVictoryResult({ victoryId: 'v1', participantId: 'p1', checkId: 'open', degree });
  return h.getVictory('v1').points.current - current;
}

check('accumulating, no award: the shared table applies',
  await applyEach([3, 2, 1, 0].map((d) => ({ structure: 'accumulating', current: 10, degree: d, award: 0 }))),
  [2, 1, 0, -1]);
check('diminishing, no award: the falling table applies',
  await applyEach([3, 2, 1, 0].map((d) => ({ structure: 'diminishing', current: 10, degree: d, award: 0 }))),
  [1, 0, -1, -2]);
check('an award pays out on a success in an accumulating contest',
  await applyOn({ structure: 'accumulating', current: 10, degree: 2, award: 2 }), 2);
check('and pays out the same way in a diminishing one, rather than costing points',
  await applyOn({ structure: 'diminishing', current: 10, degree: 2, award: 2 }), 2);
check('a critical success on an awarded check still beats a plain one',
  await applyOn({ structure: 'accumulating', current: 10, degree: 3, award: 2 }), 3);
check('an award does not rescue a failure',
  await applyEach([1, 0].map((d) => ({ structure: 'accumulating', current: 10, degree: d, award: 5 }))),
  [0, -1]);
check('with no recovery possible a diminishing critical success is only a success',
  await applyOn({ structure: 'diminishing', current: 10, degree: 3, award: 0, recoveryPossible: false }), 0);

/* --------------------------------------------------- both ends of the track */

check('an accumulating track gains nothing past its endpoint',
  await applyOn({ structure: 'accumulating', current: 20, degree: 3, award: 0 }), 0);
check('a diminishing track cannot fall below zero',
  await applyOn({ structure: 'diminishing', current: 0, degree: 0, award: 0 }), 0);

// Credit what actually changed, not the nominal value.
await seedVictory({ structure: 'diminishing', points: { current: 0, goal: 20 } });
await rolls.applyVictoryResult({ victoryId: 'v1', participantId: 'p1', checkId: 'open', degree: 0 });
check('a point absorbed by the floor costs its roller nothing',
  h.getVictory('v1').participants.p1.contribution.total, 0);
check('though the roll is still counted',
  h.getVictory('v1').participants.p1.contribution.rolls, 1);
check('and a failure is not counted as a success',
  h.getVictory('v1').participants.p1.contribution.successes, 0);

/* --------------------------------------------- what the total unlocks */

const advance = (overrides) => rolls.advanceVictory(victoryEvent(overrides));

check('an accumulating threshold opens once the total reaches it',
  advance({
    points: { current: 5, goal: 20 },
    thresholds: { t: { id: 't', points: 5, name: 'The Crowd Thins', hidden: true, position: 0 } },
  }).reached.map((t) => t.name), ['The Crowd Thins']);

check('a diminishing one opens on the way down instead',
  advance({
    structure: 'diminishing', points: { current: 4, goal: 20 },
    thresholds: { t: { id: 't', points: 5, name: 'The Line Bends', hidden: true, position: 0 } },
  }).reached.map((t) => t.name), ['The Line Bends']);

check('and not before the total gets there',
  advance({
    points: { current: 4, goal: 20 },
    thresholds: { t: { id: 't', points: 5, name: 'The Crowd Thins', hidden: true, position: 0 } },
  }).reached, []);

check('a check set to reveal at a total unlocks there',
  advance({
    points: { current: 10, goal: 20 },
    checks: { s: { id: 's', label: 'Thievery', slug: 'thievery', dc: 25, award: 2, hidden: true, revealAt: 10, position: 0 } },
  }).unlocked, ['Thievery']);

check('a check with no reveal point stays where the GM put it',
  advance({
    points: { current: 19, goal: 20 },
    checks: { s: { id: 's', label: 'Thievery', slug: 'thievery', dc: 25, award: 2, hidden: true, revealAt: null, position: 0 } },
  }).unlocked, []);

check('an event fires at its point trigger',
  advance({
    points: { current: 12, goal: 20 },
    events: { e: { id: 'e', name: 'The Span Cracks', trigger: { kind: 'points', at: 12 }, fired: false, hidden: true, position: 0 } },
  }).fired, ['The Span Cracks']);

check('an event can fire on rounds instead of points',
  advance({
    points: { current: 0, goal: 20 }, rounds: { current: 3, max: 8, unit: 'minute' },
    events: { e: { id: 'e', name: 'Reinforcements', trigger: { kind: 'rounds', at: 3 }, fired: false, hidden: true, position: 0 } },
  }).fired, ['Reinforcements']);

check('one already fired does not fire again',
  advance({
    points: { current: 12, goal: 20 },
    events: { e: { id: 'e', name: 'The Span Cracks', trigger: { kind: 'points', at: 12 }, fired: true, hidden: false, position: 0 } },
  }).fired, []);

/* ------------------------------------------ the end is a fact, not a verdict */

/*
 * The GM decides whether reaching the end was a win. The module says the track
 * arrived, once, and says nothing about what it means.
 */
await seedVictory({ points: { current: 19, goal: 20 } });
notes.length = 0;
await rolls.applyVictoryResult({ victoryId: 'v1', participantId: 'p1', checkId: 'open', degree: 2 });
check('reaching the endpoint is announced', notes.some((n) => n.includes('TrackFull')), true);
check('and it is not called a win', notes.some((n) => /Won|Victory\.Win/.test(n)), false);

notes.length = 0;
await rolls.applyVictoryResult({ victoryId: 'v1', participantId: 'p1', checkId: 'open', degree: 2, });
check('a further roll at the endpoint does not announce it a second time',
  notes.some((n) => n.includes('TrackFull')), false);

await seedVictory({ structure: 'diminishing', points: { current: 1, goal: 20 } });
notes.length = 0;
await rolls.applyVictoryResult({ victoryId: 'v1', participantId: 'p1', checkId: 'open', degree: 1 });
check('running out is announced as an empty track', notes.some((n) => n.includes('TrackEmpty')), true);
check('and is not called a loss either', notes.some((n) => /Lost|Victory\.Lose/.test(n)), false);
check('the GM verdict is still theirs to give', h.getVictory('v1').outcome, '');

/* --------------------------------- the relay contract for the other five */

/*
 * Every subsystem builds its payload in its own function. Each is driven here
 * as a player so the message that goes out is the real one.
 */
const CASES = [
  ['influence', h.setInfluences, socket.shouldApplyInfluence, () => rolls.rollInfluenceCheck({
    influenceId: 'e1', participantId: 'p1', entryId: 'x1', kind: 'influence' })],
  ['research', h.setResearches, socket.shouldApplyResearch, () => rolls.rollResearchCheck({
    researchId: 'e1', participantId: 'p1', sourceId: 's1', checkId: 'c1' })],
];

// Influence keeps its approaches at the event level, not under the NPC.
reset();
await h.setInfluences({ events: { e1: {
  id: 'e1', name: 'The Magistrate', hidden: false, started: true, baseDC: 20,
  rounds: { current: 1, max: 6, unit: 'round' },
  points: { current: 0, goal: 6 },
  influenceSkills: {
    x1: { id: 'x1', label: 'Diplomacy', slug: 'diplomacy', dc: 20, hidden: false, position: 0 },
  },
  discoveries: {}, thresholds: {}, resistances: {}, weaknesses: {}, penalties: {},
  participants: { p1: { id: 'p1', name: 'Kyra', uuid: 'Actor.kyra', hasActed: false,
    contribution: { total: 0, successes: 0, rolls: 0 } } },
} } });
makeActor({ uuid: 'Actor.kyra', degree: 2, slugs: ['diplomacy'] });
sent.length = 0;
await asPlayer(() => rolls.rollInfluenceCheck({
  influenceId: 'e1', participantId: 'p1', entryId: 'x1', kind: 'influence' }));
check('influence: a player roll goes out', sent.length, 1);
check('influence: and the receiving GM accepts it',
  socket.shouldApplyInfluence(sent[0], gmContext), true);
check('influence: no other relay claims it',
  [socket.shouldApplyVictory, socket.shouldApplyResearch, socket.shouldApplyRoll,
   socket.shouldApplyLeadership, socket.shouldApplyInfiltration]
    .some((p) => p(sent[0], gmContext)), false);

/* ============================================================================
 * Applying a result: chase, influence, research and infiltration.
 *
 * These call the apply* functions directly, which is the GM half of the path
 * the tests above drive end to end.
 * ==========================================================================*/

reset();

const participant = (id, name) => ({
  id,
  name,
  uuid: `Actor.${id}`,
  hidden: false,
  hasActed: false,
  contribution: { total: 0, successes: 0, rolls: 0, discoveries: 0, awarenessCaused: 0 },
});

/* ---------------------------------------------------------------- influence */

function seedInfluence() {
  store.influences = {
    events: {
      inf: {
        id: 'inf',
        name: 'Test',
        influencePoints: 0,
        rounds: { current: 1, max: 5 },
        participants: { p1: participant('p1', 'One'), p2: participant('p2', 'Two') },
        influenceSkills: {
          s1: { id: 's1', skill: 'diplomacy', label: 'Diplomacy', dc: 20, hidden: false },
          // Hidden, and cheaper, so a discovery has something to uncover and
          // the cheapest-first rule is under test rather than assumed.
          s2: { id: 's2', skill: 'deception', label: 'Deception', dc: 15, hidden: true },
          s3: { id: 's3', skill: 'intimidation', label: 'Intimidation', dc: 25, hidden: true },
        },
        discoveries: { d1: { id: 'd1', skill: 'society', label: 'Society', dc: 15, hidden: false } },
        thresholds: {
          t1: { id: 't1', points: 2, name: 'First', hidden: true },
          t2: { id: 't2', points: 9, name: 'Later', hidden: true },
        },
        weaknesses: {},
        resistances: {},
        penalties: {},
      },
    },
  };
}

const influence = () => store.influences.events.inf;
const apply = (over) =>
  rolls.applyInfluenceResult({ influenceId: 'inf', entryId: 's1', kind: 'influence', ...over });

seedInfluence();
await apply({ participantId: 'p1', degree: 3 });
check('influence: critical success is worth two', influence().influencePoints, 2);
check('influence: a crossed threshold is revealed', influence().thresholds.t1.hidden, false);
check('influence: a distant threshold stays hidden', influence().thresholds.t2.hidden, true);

await apply({ participantId: 'p2', degree: 2 });
check('influence: success is worth one', influence().influencePoints, 3);

await apply({ participantId: 'p2', degree: 1 });
check('influence: failure changes nothing', influence().influencePoints, 3);

await apply({ participantId: 'p1', degree: 0 });
check('influence: critical failure costs one', influence().influencePoints, 2);
check('influence: and is charged to whoever rolled it', influence().participants.p1.contribution.total, 1);

// Drain the total so the floor is the thing under test.
await apply({ participantId: 'p2', degree: 0 });
await apply({ participantId: 'p2', degree: 0 });
check('influence: the total floors at zero', influence().influencePoints, 0);
const p2Before = influence().participants.p2.contribution.total;
await apply({ participantId: 'p2', degree: 0 });
check('influence: a critical failure the floor absorbed costs nobody a point', influence().participants.p2.contribution.total, p2Before);

/*
 * These two used to assert the fixture's own starting state — points already 0,
 * the approach already visible — so neither could fail. The fixture now starts
 * with two approaches hidden, and the reveal is the thing being observed.
 */
seedInfluence();
check('influence: the approaches start hidden, so a reveal is visible',
  [influence().influenceSkills.s2.hidden, influence().influenceSkills.s3.hidden], [true, true]);
await rolls.applyInfluenceResult({ influenceId: 'inf', participantId: 'p1', entryId: 'd1', kind: 'discovery', degree: 2 });
check('influence: a successful discovery earns no influence points', influence().influencePoints, 0);
check('influence: it uncovers the cheapest approach', influence().influenceSkills.s2.hidden, false);
check('influence: and only that one', influence().influenceSkills.s3.hidden, true);
check('influence: the discovery is credited to its roller',
  influence().participants.p1.contribution.discoveries, 1);

seedInfluence();
await rolls.applyInfluenceResult({ influenceId: 'inf', participantId: 'p1', entryId: 'd1', kind: 'discovery', degree: 3 });
check('influence: a critical discovery uncovers two, as published',
  [influence().influenceSkills.s2.hidden, influence().influenceSkills.s3.hidden], [false, false]);

seedInfluence();
await rolls.applyInfluenceResult({ influenceId: 'inf', participantId: 'p1', entryId: 'd1', kind: 'discovery', degree: 1 });
check('influence: a failed discovery uncovers nothing',
  [influence().influenceSkills.s2.hidden, influence().influenceSkills.s3.hidden], [true, true]);
check('influence: and still earns no points', influence().influencePoints, 0);

/* ----------------------------------------------------------------- research */

store.researches = {
  events: {
    res: {
      id: 'res',
      name: 'Test',
      researchPoints: 0,
      rounds: { current: 1, max: 9, unit: 'hour' },
      participants: { p1: participant('p1', 'One') },
      sources: {
        src: {
          id: 'src',
          name: 'A source',
          hidden: false,
          revealAt: null,
          researchPoints: { current: 0, max: 2 },
          checks: { c1: { id: 'c1', skill: 'society', label: 'Society', dc: 16, hidden: false, revealAt: null } },
        },
      },
      thresholds: { t1: { id: 't1', points: 2, name: 'A finding', hidden: true } },
      events: {},
    },
  },
};

const research = () => store.researches.events.res;
const study = (degree) =>
  rolls.applyResearchResult({ researchId: 'res', participantId: 'p1', sourceId: 'src', checkId: 'c1', degree });

await study(2);
await study(2);
check('research: a source pays out up to its cap', research().researchPoints, 2);
check('research: a reached finding is revealed', research().thresholds.t1.hidden, false);

const creditedBefore = research().participants.p1.contribution.total;
await study(2);
check('research: a dry source pays nothing', research().researchPoints, 2);
check('research: and credits nobody for drawing on it', research().participants.p1.contribution.total, creditedBefore);
check('research: the roll is still counted', research().participants.p1.contribution.rolls, 3);

/* -------------------------------------------------------------- infiltration */

function seedInfiltration({ individual }) {
  store.infiltrations = {
    events: {
      job: {
        id: 'job',
        name: 'Test',
        rounds: { current: 1, max: 0 },
        awareness: { current: 0, perRound: 1 },
        edgePoints: 0,
        participants: { p1: participant('p1', 'One'), p2: participant('p2', 'Two') },
        awarenessBreakpoints: {
          b1: { id: 'b1', at: 2, name: 'Noticed', hidden: true, fired: false, dcIncrease: 1 },
          b2: { id: 'b2', at: 4, name: 'Hunted', hidden: true, fired: false, dcIncrease: 3 },
        },
        objectives: {
          o1: {
            id: 'o1',
            name: 'Get in',
            hidden: false,
            obstacles: {
              ob1: {
                id: 'ob1',
                name: 'The gate',
                hidden: false,
                revealAt: null,
                individual,
                infiltrationPoints: { current: 0, goal: 2 },
                individualPoints: {},
                checks: { c1: { id: 'c1', skill: 'stealth', label: 'Stealth', dc: 19, hidden: false } },
              },
            },
          },
        },
        complications: {},
        opportunities: {},
        preparations: {},
      },
    },
  };
}

const job = () => store.infiltrations.events.job;
const obstacle = () => job().objectives.o1.obstacles.ob1;
const sneak = (participantId, degree) =>
  rolls.applyInfiltrationResult({
    infiltrationId: 'job',
    participantId,
    kind: 'obstacle',
    ownerId: 'ob1',
    objectiveId: 'o1',
    checkId: 'c1',
    degree,
  });

seedInfiltration({ individual: false });
await sneak('p1', 1);
check('infiltration: failure costs no progress', obstacle().infiltrationPoints.current, 0);
check('infiltration: failure costs secrecy instead', job().awareness.current, 1);

await sneak('p1', 0);
check('infiltration: critical failure costs two awareness', job().awareness.current, 3);
check('infiltration: a passed breakpoint fires', job().awarenessBreakpoints.b1.fired, true);
check('infiltration: and reveals itself', job().awarenessBreakpoints.b1.hidden, false);
check('infiltration: a breakpoint not yet reached holds', job().awarenessBreakpoints.b2.fired, false);

notes.length = 0;
await sneak('p2', 3);
check('infiltration: critical success is worth two', obstacle().infiltrationPoints.current, 2);
check(
  'infiltration: clearing the obstacle is announced',
  notes.filter((n) => n.includes('ObstacleCleared')).length,
  1,
);

// The bug this guards: cleared was read as state, so every later roll on an
// obstacle already behind the party announced it again - including failures.
notes.length = 0;
await sneak('p1', 0);
check(
  'infiltration: an obstacle already behind them is not announced again',
  notes.filter((n) => n.includes('ObstacleCleared')).length,
  0,
);

seedInfiltration({ individual: true });
notes.length = 0;
await sneak('p1', 3);
check('infiltration: an individual obstacle counts people through', obstacle().infiltrationPoints.current, 1);
check(
  'infiltration: getting one person through is announced once',
  notes.filter((n) => n.includes('ObstacleCleared')).length,
  1,
);
notes.length = 0;
await sneak('p1', 3);
check(
  'infiltration: the same character getting through again is not',
  notes.filter((n) => n.includes('ObstacleCleared')).length,
  0,
);
await sneak('p2', 3);
check('infiltration: a second character is counted', obstacle().infiltrationPoints.current, 2);

/* -------------------------------------------------------------------- chase */

function seedChase() {
  store.chases = {
    events: {
      run: {
        id: 'run',
        name: 'Test',
        rounds: { current: 1, max: null },
        participants: { p1: participant('p1', 'One'), p2: participant('p2', 'Two') },
        obstacles: {
          ob1: {
            id: 'ob1',
            position: 0,
            name: 'The wall',
            chasePoints: { current: 0, goal: 2 },
            branch: '',
          },
        },
      },
    },
  };
}

const chase = () => store.chases.events.run;
const obstacleRun = () => chase().obstacles.ob1;
const run = (participantId, degree) =>
  rolls.applyRollResult({ chaseId: 'run', obstacleId: 'ob1', participantId, degree, skillLabel: 'Athletics' });

seedChase();
notes.length = 0;
await run('p1', 3);
check('chase: critical success is worth two', obstacleRun().chasePoints.current, 2);
check('chase: overcoming the obstacle is announced', notes.filter((n) => n.includes('Roll.Cleared')).length, 1);

// The bug this guards: points past the goal were banked and credited, and the
// obstacle announced itself as overcome on every later roll, failures included.
notes.length = 0;
const creditBefore = chase().participants.p2.contribution.total;
await run('p2', 2);
check('chase: points stop at the goal', obstacleRun().chasePoints.current, 2);
check('chase: a point that moved nothing credits nobody', chase().participants.p2.contribution.total, creditBefore);
check('chase: and an obstacle already behind them is not announced again', notes.filter((n) => n.includes('Roll.Cleared')).length, 0);
check(
  'chase: the message reports what moved, not the nominal value',
  notes.some((n) => n.includes('Roll.Applied') && n.includes('"points":"+0"')),
  true,
);

await run('p1', 0);
check('chase: critical failure costs one', obstacleRun().chasePoints.current, 1);
await run('p1', 0);
await run('p1', 0);
check('chase: the obstacle floors at zero', obstacleRun().chasePoints.current, 0);
const floorBefore = chase().participants.p2.contribution.total;
await run('p2', 0);
check('chase: a critical failure the floor absorbed costs nobody a point', chase().participants.p2.contribution.total, floorBefore);

/* ============================================================================
 * The GM moving points by hand.
 *
 * The GM runs the game, so every point track can be nudged without a roll. Four
 * functions do it, one per track, and they must agree on what "helping" means.
 *
 * Victory's used to live inline in the view instead of here, and drifted: it
 * negated the credit in a diminishing contest, so a GM awarding a point docked
 * the character they meant to reward. The invariant below is the one that was
 * broken — an award credits the same direction as an equivalent good roll.
 * ==========================================================================*/

reset();

for (const [name, fn, args] of [
  ['chase', rolls.adjustContribution, { chaseId: 'x', obstacleId: 'o', participantId: 'p1', delta: 1 }],
  ['influence', rolls.adjustInfluenceContribution, { influenceId: 'x', participantId: 'p1', delta: 1 }],
  ['research', rolls.adjustResearchContribution, { researchId: 'x', participantId: 'p1', sourceId: 's', delta: 1 }],
  ['victory', rolls.adjustVictoryContribution, { victoryId: 'x', participantId: 'p1', delta: 1 }],
]) {
  check(`${name}: adjusting an event that is not there is a no-op`, await fn(args), null);
  check(`${name}: a zero delta does nothing`, await fn({ ...args, delta: 0 }), null);
  check(`${name}: a player cannot move the track by hand`,
    await asPlayer(() => fn(args)), null);
}

/* -------------------------------------------- victory, both structures */

async function award({ structure, current, delta }) {
  await seedVictory({ structure, points: { current, goal: 20 } });
  const summary = await rolls.adjustVictoryContribution({
    victoryId: 'v1', participantId: 'p1', delta,
  });
  const after = h.getVictory('v1');
  return {
    moved: after.points.current - current,
    credited: after.participants.p1.contribution.total,
    summary,
  };
}

check('victory: a GM award moves the accumulating total',
  (await award({ structure: 'accumulating', current: 10, delta: 3 })).moved, 3);
check('victory: and credits the character it helped',
  (await award({ structure: 'accumulating', current: 10, delta: 3 })).credited, 3);

// The bug: this credited -3.
check('victory: an award in a diminishing contest also moves the total up',
  (await award({ structure: 'diminishing', current: 10, delta: 3 })).moved, 3);
check('victory: and credits it positively, the same as a good roll does',
  (await award({ structure: 'diminishing', current: 10, delta: 3 })).credited, 3);

/*
 * Stated as the invariant rather than as two numbers: helping the party is
 * credited the same way whichever direction the track runs.
 */
for (const structure of ['accumulating', 'diminishing']) {
  const byHand = await award({ structure, current: 10, delta: 1 });
  await seedVictory({ structure, points: { current: 10, goal: 20 } });
  await rolls.applyVictoryResult({
    victoryId: 'v1', participantId: 'p1', checkId: 'open',
    // The degree worth exactly one point on this track.
    degree: structure === 'diminishing' ? 3 : 2,
  });
  const byRoll = h.getVictory('v1').participants.p1.contribution.total;
  check(`victory: ${structure} — an award and a roll that move the track alike credit alike`,
    byHand.credited, byRoll);
}

check('victory: removing points is credited as the setback it is',
  (await award({ structure: 'accumulating', current: 10, delta: -2 })).credited, -2);
check('victory: an award absorbed by the endpoint costs nobody',
  (await award({ structure: 'accumulating', current: 20, delta: 5 })).credited, 0);
check('victory: and one absorbed by the floor costs nobody either',
  (await award({ structure: 'diminishing', current: 0, delta: -5 })).credited, 0);
check('victory: an award that moves nothing reports nothing to announce',
  (await award({ structure: 'accumulating', current: 20, delta: 5 })).summary, null);

// An award can carry the track over a threshold, so it must advance it too.
await seedVictory({
  points: { current: 4, goal: 20 },
  thresholds: { t: { id: 't', points: 5, name: 'The Crowd Thins', hidden: true, position: 0 } },
});
const crossed = await rolls.adjustVictoryContribution({
  victoryId: 'v1', participantId: 'p1', delta: 1,
});
check('victory: an award that crosses a threshold reveals it',
  h.getVictory('v1').thresholds.t.hidden, false);
check('victory: and says so', crossed.reached.map((t) => t.name), ['The Crowd Thins']);


/* ============================================================================
 * The relay, for every subsystem that has one.
 *
 * Seven emitters, seven predicates, in two files that nothing ties together. A
 * caller that forgets a field the predicate demands does not raise an error —
 * the player rolls, the dice land, and nothing happens. So each entry point is
 * driven as a player here and the message that actually goes out is handed to
 * the real predicate.
 * ==========================================================================*/

const others = (except) =>
  [['roll', socket.shouldApplyRoll], ['pass', socket.shouldApplyPass],
   ['influence', socket.shouldApplyInfluence], ['research', socket.shouldApplyResearch],
   ['infiltration', socket.shouldApplyInfiltration], ['leadership', socket.shouldApplyLeadership],
   ['victory', socket.shouldApplyVictory]]
    .filter(([n]) => n !== except)
    .filter(([, fn]) => fn(sent[0], gmContext))
    .map(([n]) => n);

/** Roll as a player and assert the message survives the trip. */
async function relays(name, predicate, roll, except = name) {
  sent.length = 0;
  const result = await asPlayer(roll);
  check(`${name}: the roll goes through`, result?.degree, 2);
  check(`${name}: exactly one message goes out`, sent.length, 1);
  check(`${name}: the designated GM accepts what the caller built`,
    predicate(sent[0], gmContext), true);
  check(`${name}: a second GM does not double-apply it`,
    predicate(sent[0], { userId: 'gm2', isGM: true, activeGMId: 'gm1' }), false);
  // Applying writes a world setting, which only a GM may do.
  check(`${name}: a player receiving it never applies it`,
    predicate(sent[0], { userId: 'p1', isGM: false, activeGMId: 'gm1' }), false);
  check(`${name}: not even the player who rolled it`,
    predicate(sent[0], { userId: 'p1', isGM: false, activeGMId: 'p1' }), false);
  check(`${name}: and no other relay claims it`, others(except), []);
}

/* -------------------------------------------------------------------- chase */

reset();
await h.setChases({ events: { c1: {
  id: 'c1', name: 'Down the Rooftops', hidden: false, started: true, baseDC: 20,
  rounds: { current: 1, max: 6, unit: 'round' },
  obstacles: { o1: {
    id: 'o1', name: 'The Gap', position: 0, hidden: false, locked: false,
    chasePoints: { current: 0, goal: 3 }, rounds: { current: 0 },
    skillOptions: { s1: { id: 's1', label: 'Athletics', slug: 'athletics', dc: 20, position: 0 } },
    leadsTo: '',
  } },
  participants: { p1: { id: 'p1', name: 'Kyra', uuid: 'Actor.kyra', hasActed: false,
    contribution: { total: 0, byObstacle: {}, successes: 0, rolls: 0 } } },
} } });
makeActor({ uuid: 'Actor.kyra', degree: 2, slugs: ['athletics'] });
await relays('chase', socket.shouldApplyRoll, () => rolls.rollChaseCheck({
  chaseId: 'c1', obstacleId: 'o1', participantId: 'p1', optionId: 's1' }), 'roll');

// Passing a turn is its own relay and must not be mistaken for a roll.
sent.length = 0;
await asPlayer(() => rolls.applyPassResult({ chaseId: 'c1', obstacleId: 'o1', participantId: 'p1' }));
check('pass: a player passing does not apply it themselves',
  h.getChase('c1').participants.p1.hasActed, false);

await rolls.applyPassResult({ chaseId: 'c1', obstacleId: 'o1', participantId: 'p1' });
check('pass: the GM applying it marks the character as having acted',
  h.getChase('c1').participants.p1.hasActed, true);

/* ----------------------------------------------------------------- research */

reset();
await h.setResearches({ events: { r1: {
  id: 'r1', name: 'The Sunken Library', hidden: false, started: true, baseDC: 20,
  researchPoints: { current: 0, goal: 20 },
  rounds: { current: 1, max: 6, unit: 'hour' },
  sources: { s1: {
    id: 's1', name: 'The Ledgers', position: 0, hidden: false,
    researchPoints: { current: 0, max: 5 },
    checks: { c1: { id: 'c1', label: 'Society', slug: 'society', dc: 20, hidden: false, position: 0 } },
  } },
  thresholds: {}, events: {},
  participants: { p1: { id: 'p1', name: 'Kyra', uuid: 'Actor.kyra', hasActed: false,
    contribution: { total: 0, successes: 0, rolls: 0 } } },
} } });
makeActor({ uuid: 'Actor.kyra', degree: 2, slugs: ['society'] });
await relays('research', socket.shouldApplyResearch, () => rolls.rollResearchCheck({
  researchId: 'r1', participantId: 'p1', sourceId: 's1', checkId: 'c1' }));

/* -------------------------------------------------------------- infiltration */

reset();
await h.setInfiltrations({ events: { i1: {
  id: 'i1', name: 'The Embassy', hidden: false, started: true, baseDC: 20,
  infiltrationPoints: { current: 0, goal: 8 },
  awareness: { current: 0, max: 12 }, edgePoints: 1,
  rounds: { current: 1, max: 6, unit: 'hour' },
  objectives: { j1: {
    id: 'j1', name: 'Get Inside', position: 0, hidden: false,
    points: { current: 0, goal: 4 },
    obstacles: { o1: {
      id: 'o1', name: 'The Gate', position: 0, hidden: false, individual: false,
      points: { current: 0, goal: 2 }, clearedBy: {},
      checks: { c1: { id: 'c1', label: 'Deception', slug: 'deception', dc: 20, hidden: false, position: 0 } },
    } },
  } },
  complications: {}, opportunities: {}, preparations: {}, awarenessBreakpoints: {},
  participants: { p1: { id: 'p1', name: 'Kyra', uuid: 'Actor.kyra', hasActed: false,
    contribution: { total: 0, successes: 0, rolls: 0, awarenessCaused: 0 } } },
} } });
makeActor({ uuid: 'Actor.kyra', degree: 2, slugs: ['deception'] });
await relays('infiltration', socket.shouldApplyInfiltration, () => rolls.rollInfiltrationCheck({
  infiltrationId: 'i1', participantId: 'p1', kind: 'obstacle',
  ownerId: 'o1', objectiveId: 'j1', checkId: 'c1' }));

// findInfiltrationCheck is how every one of those ids is resolved.
const inf = h.getInfiltration('i1');
check('infiltration: an obstacle check resolves through its objective',
  rolls.findInfiltrationCheck(inf, { kind: 'obstacle', ownerId: 'o1', objectiveId: 'j1', checkId: 'c1' })?.check.label,
  'Deception');
check('infiltration: a wrong objective resolves to nothing rather than the wrong check',
  rolls.findInfiltrationCheck(inf, { kind: 'obstacle', ownerId: 'o1', objectiveId: 'nope', checkId: 'c1' }), null);
check('infiltration: an unknown kind finds nothing',
  rolls.findInfiltrationCheck(inf, { kind: 'nonsense', ownerId: 'o1', objectiveId: 'j1', checkId: 'c1' }), null);

/* ------------------------------------------------------------- leadership */

reset();
await h.setLeaderships({ events: { l1: {
  id: 'l1', name: 'The Free Company', hidden: false, started: true, baseDC: 20,
  organizationLevel: 3,
  events: { e1: {
    id: 'e1', name: 'A Rival Recruits', position: 0, hidden: false, resolved: false, atLevel: 1,
    checks: { c1: { id: 'c1', label: 'Diplomacy', slug: 'diplomacy', dc: 20, hidden: false, position: 0 } },
  } },
  lieutenants: {},
  participants: { p1: { id: 'p1', name: 'Kyra', uuid: 'Actor.kyra', hasActed: false,
    contribution: { total: 0, successes: 0, rolls: 0 } } },
} } });
makeActor({ uuid: 'Actor.kyra', degree: 2, slugs: ['diplomacy'] });
await relays('leadership', socket.shouldApplyLeadership, () => rolls.rollLeadershipCheck({
  leadershipId: 'l1', participantId: 'p1', eventId: 'e1', checkId: 'c1' }));

// Leadership has no point track, so an event is settled once and then closed.
await rolls.applyLeadershipResult({
  leadershipId: 'l1', participantId: 'p1', eventId: 'e1', degree: 2 });
check('leadership: a settled event is marked resolved',
  h.getLeadership('l1').events.e1.resolved, true);
// Clear hasActed first, or this would pass because the character has acted
// rather than because the event is settled.
await h.updateLeadership('l1', (draft) => {
  draft.participants.p1.hasActed = false;
});
notes.length = 0;
check('leadership: and cannot be rolled again',
  await rolls.rollLeadershipCheck({
    leadershipId: 'l1', participantId: 'p1', eventId: 'e1', checkId: 'c1' }), null);
check('leadership: and the GM is told why, rather than being told nothing',
  notes.some((n) => n.includes('AlreadyResolved')), true);
check('leadership: not even the GM forcing it, because the event is closed',
  await rolls.rollLeadershipCheck({
    leadershipId: 'l1', participantId: 'p1', eventId: 'e1', checkId: 'c1', force: true }), null);


/* ============================================================================
 * What progress reveals, in every subsystem.
 *
 * Each subsystem has an advance-then-announce pair that opens up thresholds,
 * checks and twists as the numbers move. They are called from three places
 * each — the roll, the GM's award, and the point stepper — and the influence
 * stepper had drifted into its own copy that revealed thresholds without
 * telling anyone. One copy each now, and these are the tests that hold it.
 * ==========================================================================*/

reset();

/* ------------------------------------------------------------- influence */

const infEvent = (over = {}) => ({
  id: 'inf', influencePoints: 0,
  thresholds: {
    t1: { id: 't1', points: 2, name: 'A Nod', hidden: true },
    t2: { id: 't2', points: 9, name: 'A Favour', hidden: true },
  },
  influenceSkills: {
    open: { id: 'open', label: 'Diplomacy', hidden: false, revealAt: null },
    later: { id: 'later', label: 'Deception', hidden: true, revealAt: 4 },
    never: { id: 'never', label: 'Occultism', hidden: true, revealAt: null },
  },
  discoveries: {},
  ...over,
});

check('influence: a concession below the total opens',
  rolls.advanceInfluence(infEvent({ influencePoints: 2 })).justReached.map((t) => t.name), ['A Nod']);
check('influence: one above it stays shut',
  rolls.advanceInfluence(infEvent({ influencePoints: 2 })).unlocked, []);
check('influence: an approach opens at its own total',
  rolls.advanceInfluence(infEvent({ influencePoints: 4 })).unlocked, ['Deception']);
check('influence: one with no reveal point stays where the GM put it',
  rolls.advanceInfluence(infEvent({ influencePoints: 99 })).unlocked, ['Deception']);
check('influence: crossing both opens both',
  rolls.advanceInfluence(infEvent({ influencePoints: 9 })).justReached.map((t) => t.name),
  ['A Nod', 'A Favour']);

// It mutates, so a second pass has nothing left to announce.
const twice = infEvent({ influencePoints: 9 });
rolls.advanceInfluence(twice);
check('influence: a second pass announces nothing again',
  rolls.advanceInfluence(twice), { justReached: [], unlocked: [] });

notes.length = 0;
rolls.announceInfluenceProgress(rolls.advanceInfluence(infEvent({ influencePoints: 9 })));
check('influence: every concession crossed is announced',
  notes.filter((n) => n.includes('ThresholdReached')).length, 2);
check('influence: and the approaches that opened, in one message',
  notes.filter((n) => n.includes('Unlocked')).length, 1);

notes.length = 0;
rolls.announceInfluenceProgress({ justReached: [], unlocked: [] });
check('influence: a move that revealed nothing says nothing', notes.length, 0);

// revealByProgress is the half of it that opens approaches.
const byProgress = infEvent({ influencePoints: 4 });
check('influence: revealByProgress returns what it opened',
  rolls.revealByProgress(byProgress), ['Deception']);
check('influence: and actually opens it', byProgress.influenceSkills.later.hidden, false);

/* -------------------------------------------------------------- research */

const resEvent = (over = {}) => ({
  researchPoints: 0, rounds: { current: 0 },
  thresholds: { t: { id: 't', points: 5, name: 'A Name in the Margin', hidden: true } },
  sources: { s: {
    id: 's', name: 'The Ledgers', hidden: true, revealAt: 3,
    checks: { c: { id: 'c', label: 'Society', hidden: true, revealAt: 6 } },
  } },
  events: { e: {
    id: 'e', name: 'The Librarian Returns', hidden: true, fired: false,
    trigger: { kind: 'points', at: 4 }, modifier: { value: 0, active: false },
  } },
  ...over,
});

check('research: a finding surfaces at its total',
  rolls.advanceResearch(resEvent({ researchPoints: 5 })).reached.map((t) => t.name),
  ['A Name in the Margin']);
check('research: a source opens at its own total',
  rolls.advanceResearch(resEvent({ researchPoints: 3 })).unlocked, ['The Ledgers']);
check('research: and a check inside it at a later one',
  rolls.advanceResearch(resEvent({ researchPoints: 6 })).unlocked, ['The Ledgers', 'Society']);
check('research: an event fires on points',
  rolls.advanceResearch(resEvent({ researchPoints: 4 })).fired, ['The Librarian Returns']);
check('research: or on rounds, so a GM winding the clock still gets it',
  rolls.advanceResearch(resEvent({
    rounds: { current: 7 },
    events: { e: { id: 'e', name: 'Closing Time', hidden: true, fired: false,
      trigger: { kind: 'rounds', at: 7 }, modifier: { value: 0, active: false } } },
  })).fired, ['Closing Time']);

// A complication carrying a modifier turns it on when it fires.
const withMod = resEvent({
  researchPoints: 4,
  events: { e: { id: 'e', name: 'Bad Light', hidden: true, fired: false,
    trigger: { kind: 'points', at: 4 }, modifier: { value: -2, active: false } } },
});
rolls.advanceResearch(withMod);
check('research: a complication that changes the DC comes into effect',
  withMod.events.e.modifier.active, true);

notes.length = 0;
rolls.announceResearchProgress(rolls.advanceResearch(resEvent({ researchPoints: 6 })));
check('research: what surfaced is announced', notes.length > 0, true);

/* ----------------------------------------------------------- infiltration */

const infilEvent = (over = {}) => ({
  awareness: { current: 0, max: 12 }, rounds: { current: 0 },
  awarenessBreakpoints: { b: { id: 'b', at: 5, name: 'Doubled Patrols', fired: false, hidden: true } },
  complications: { c: { id: 'c', name: 'A Locked Wing', fired: false, hidden: true,
    trigger: { kind: 'awareness', at: 3 } } },
  objectives: { j: { id: 'j', obstacles: {
    o: { id: 'o', name: 'The Inner Door', hidden: true, revealAt: 2 },
  } } },
  ...over,
});

check('infiltration: a breakpoint passes when awareness reaches it',
  rolls.advanceInfiltration(infilEvent({ awareness: { current: 5, max: 12 } })).passed,
  ['Doubled Patrols']);
check('infiltration: a complication triggers on awareness',
  rolls.advanceInfiltration(infilEvent({ awareness: { current: 3, max: 12 } })).triggered,
  ['A Locked Wing']);
check('infiltration: an obstacle opens at its own awareness',
  rolls.advanceInfiltration(infilEvent({ awareness: { current: 2, max: 12 } })).unlocked,
  ['The Inner Door']);
check('infiltration: a manual complication waits for the GM, whatever the number',
  rolls.advanceInfiltration(infilEvent({
    awareness: { current: 99, max: 12 },
    complications: { c: { id: 'c', name: 'The GM Calls It', fired: false, hidden: true,
      trigger: { kind: 'manual', at: 0 } } },
  })).triggered, []);
check('infiltration: nothing fires twice',
  rolls.advanceInfiltration(infilEvent({
    awareness: { current: 9, max: 12 },
    awarenessBreakpoints: { b: { id: 'b', at: 5, name: 'Doubled Patrols', fired: true, hidden: false } },
  })).passed, []);

notes.length = 0;
rolls.announceInfiltrationProgress(
  rolls.advanceInfiltration(infilEvent({ awareness: { current: 5, max: 12 } })));
check('infiltration: what happened is announced', notes.length > 0, true);

/* ------------------------------------------------------------- leadership */

const org = (level, revealAt) => ({
  organizationLevel: level,
  events: { e: { id: 'e', name: 'A Rival Recruits', hidden: true, revealAt } },
});
check('leadership: an event surfaces once the organisation reaches its level',
  rolls.advanceLeadership(org(4, 4)), ['A Rival Recruits']);
check('leadership: and not before',
  rolls.advanceLeadership(org(3, 4)), []);
check('leadership: one with no level waits for the GM',
  rolls.advanceLeadership(org(20, null)), []);

/* ----------------------------------------------------- spending an edge point */

/*
 * An edge point buys back a failure: it undoes the awareness the failure drew
 * and credits the success it should have been. Wired to a button and never
 * covered.
 */
async function seedInfil(over = {}) {
  reset();
  await h.setInfiltrations({ events: { i1: {
    id: 'i1', name: 'The Embassy', hidden: false, started: true, baseDC: 20,
    infiltrationPoints: { current: 0, goal: 8 },
    awareness: { current: 3, max: 12 }, edgePoints: 1,
    rounds: { current: 1, max: 6, unit: 'hour' },
    objectives: { j1: { id: 'j1', name: 'Get Inside', position: 0, hidden: false,
      points: { current: 0, goal: 4 },
      obstacles: { o1: { id: 'o1', name: 'The Gate', position: 0, hidden: false,
        individual: false, individualPoints: {},
        infiltrationPoints: { current: 0, goal: 2 },
        checks: { c1: { id: 'c1', label: 'Deception', slug: 'deception', dc: 20, hidden: false, position: 0 } },
      } },
    } },
    complications: { x1: { id: 'x1', name: 'A Locked Wing', fired: true, resolved: false, hidden: false,
      trigger: { kind: 'manual', at: 0 }, checks: {} } },
    opportunities: { y1: { id: 'y1', name: 'An Open Ledger', used: false, hidden: false, checks: {} } },
    preparations: {}, awarenessBreakpoints: {},
    participants: { p1: { id: 'p1', name: 'Kyra', uuid: 'Actor.kyra', hasActed: false,
      contribution: { total: 0, successes: 0, rolls: 0, awarenessCaused: 2 } } },
    ...over,
  } } });
}

await seedInfil();
const spent = await rolls.spendEdgePoint({
  infiltrationId: 'i1', participantId: 'p1', kind: 'obstacle', ownerId: 'o1', objectiveId: 'j1' });
const afterSpend = h.getInfiltration('i1');
check('edge: the point is spent', afterSpend.edgePoints, 0);
check('edge: the awareness the failure drew is taken back', afterSpend.awareness.current, 2);
check('edge: and stops being held against whoever drew it',
  afterSpend.participants.p1.contribution.awarenessCaused, 1);
check('edge: the obstacle gains the point the success would have earned',
  afterSpend.objectives.j1.obstacles.o1.infiltrationPoints.current, 1);
check('edge: credited to the character who spent it',
  afterSpend.participants.p1.contribution.total, 1);
check('edge: and the GM is told what is left', spent.remaining, 0);

check('edge: a second spend with none left is refused',
  await rolls.spendEdgePoint({
    infiltrationId: 'i1', participantId: 'p1', kind: 'obstacle', ownerId: 'o1', objectiveId: 'j1' }), null);

await seedInfil();
await rolls.spendEdgePoint({ infiltrationId: 'i1', participantId: 'p1', kind: 'complication', ownerId: 'x1' });
check('edge: spent on a complication settles it',
  h.getInfiltration('i1').complications.x1.resolved, true);

await seedInfil();
await rolls.spendEdgePoint({ infiltrationId: 'i1', participantId: 'p1', kind: 'opportunity', ownerId: 'y1' });
check('edge: spent on an opportunity marks it taken',
  h.getInfiltration('i1').opportunities.y1.used, true);

await seedInfil();
check('edge: a player cannot spend one',
  await asPlayer(() => rolls.spendEdgePoint({
    infiltrationId: 'i1', participantId: 'p1', kind: 'obstacle', ownerId: 'o1', objectiveId: 'j1' })), null);
check('edge: and nothing was spent', h.getInfiltration('i1').edgePoints, 1);

// An individual obstacle counts people through rather than pooling points.
await seedInfil();
await h.updateInfiltration('i1', (draft) => {
  draft.objectives.j1.obstacles.o1.individual = true;
  draft.objectives.j1.obstacles.o1.infiltrationPoints.goal = 1;
});
await rolls.spendEdgePoint({
  infiltrationId: 'i1', participantId: 'p1', kind: 'obstacle', ownerId: 'o1', objectiveId: 'j1' });
check('edge: on an individual obstacle it counts that character through',
  h.getInfiltration('i1').objectives.j1.obstacles.o1.infiltrationPoints.current, 1);


done('rolling, applying, the maths, GM adjustment, what progress reveals, and every relay');
