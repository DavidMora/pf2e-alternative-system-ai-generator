/*
 * Applying a roll is where the rules actually live, and none of it was covered:
 * check-logic tested the degree tables in isolation, but nothing tested what
 * happens to the event when a result lands. These are the invariants that were
 * verified by hand in a live world, written down so they stay verified.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = path.join(root, 'scripts');

const MODULE_ID = 'matadragones-subsystems';

// One in-memory store standing in for world settings.
const store = {};
const notes = [];

Math.clamp = (v, min, max) => Math.min(Math.max(v, min), max);
let idCounter = 0;
globalThis.foundry = { utils: { randomID: () => `id${++idCounter}` } };
globalThis.game = {
  user: { isGM: true },
  users: { activeGM: { id: 'gm' } },
  settings: {
    get: (_mod, key) => ({ toObject: () => structuredClone(store[key] ?? { events: {} }) }),
    set: (_mod, key, value) => {
      store[key] = structuredClone(value);
    },
  },
  i18n: {
    localize: (k) => k,
    format: (k, d) => `${k} ${JSON.stringify(d)}`,
    lang: 'en',
  },
};
const record = (kind) => (message) => notes.push(`${kind}:${message}`);
globalThis.ui = { notifications: { info: record('info'), warn: record('warn'), error: record('error') } };

const rolls = await import(`file://${base}/rolls.js`);

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failed = 1;
    console.error(`FAIL ${label}\n  got      ${JSON.stringify(actual)}\n  expected ${JSON.stringify(expected)}`);
  } else console.log(`ok  ${label}`);
};

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
        influenceSkills: { s1: { id: 's1', skill: 'diplomacy', label: 'Diplomacy', dc: 20, hidden: false } },
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

seedInfluence();
await rolls.applyInfluenceResult({ influenceId: 'inf', participantId: 'p1', entryId: 'd1', kind: 'discovery', degree: 3 });
check('influence: discovery earns no influence', influence().influencePoints, 0);
check('influence: discovery uncovers an approach', influence().influenceSkills.s1.hidden, false);

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

if (failed) console.error('\nFAILED');
else console.log('\nok  roll application holds for chase, influence, research and infiltration');
process.exit(failed);
