/*
 * The seams between modules.
 *
 * Two contracts live here and neither was tested. The registry is what lets the
 * shared GM actions be written once: if one subsystem's entry is shaped
 * differently, those actions quietly stop working for it. And every relayed roll
 * crosses from an emitter to a predicate in another file — if the emitter omits
 * a field the predicate demands, the player's roll is dropped in silence, with
 * no error anywhere.
 *
 * That second one nearly shipped: leadership's predicate requires `checkId`, and
 * nothing but a reading of both files proved the emitter sent one.
 */
import { installGlobals, load, makeCheck, reset, store } from './harness.mjs';

installGlobals();
const { check, done } = makeCheck();

const subsystems = await load('subsystems.js');
const socket = await load('socket.js');
const { SUBSYSTEMS, isSubsystem, eventTarget, exportPayload, importPayload } = subsystems;

const KEYS = Object.keys(SUBSYSTEMS);
check('every subsystem is registered', KEYS.sort(), [
  'chase', 'infiltration', 'influence', 'leadership', 'research', 'victory',
].sort());

/* ------------------------------------------------------------- the registry */

// The shared actions read exactly these. A missing one is a feature that
// silently does nothing for one tab.
const REQUIRED = ['key', 'label', 'icon', 'blankName', 'get', 'getAll', 'save', 'update', 'remove'];
for (const key of KEYS) {
  const entry = SUBSYSTEMS[key];
  check(`${key}: registry entry is complete`, REQUIRED.filter((f) => !(f in entry)), []);
  check(`${key}: key field matches its own registry key`, entry.key, key);
  check(`${key}: names a label and a blank name to localise`,
    [entry.label, entry.blankName].every((s) => typeof s === 'string' && s.startsWith('PFAI.')), true);
  check(`${key}: the five store operations are callable`,
    ['get', 'getAll', 'save', 'update', 'remove'].every((f) => typeof entry[f] === 'function'), true);
}

check('isSubsystem accepts every registered key', KEYS.every(isSubsystem), true);
check('and rejects anything else',
  ['heist', '', null, undefined, 'Chase'].some(isSubsystem), false);

/* --------------------------------------------------------------- targeting */

// Buttons address an event through the dataset. Chases and influence predate
// the shared convention and still carry their own attribute, so both resolve.
for (const key of KEYS) {
  check(`${key}: the shared convention resolves`,
    eventTarget({ subsystem: key, eventId: 'e1' }).id, 'e1');
  check(`${key}: and picks the right registry entry`,
    eventTarget({ subsystem: key, eventId: 'e1' }).api.key, key);
}
check('a dataset with no subsystem falls back to chases rather than throwing',
  eventTarget({ eventId: 'e1' }).key, 'chase');
check('the older chaseId attribute still resolves', eventTarget({ chaseId: 'c1' }).id, 'c1');
check('and the older influenceId one', eventTarget({ subsystem: 'influence', influenceId: 'i1' }).id, 'i1');
check('an empty dataset yields no id, so handlers can bail',
  eventTarget({}).id, undefined);

/* ------------------------------------------------- export and import, all six */

for (const key of KEYS) {
  reset();
  const event = { id: 'original', name: `A ${key}`, position: 3, hidden: true };
  await SUBSYSTEMS[key].save({ events: { original: event } });

  const payload = exportPayload(key, SUBSYSTEMS[key].get('original'));
  check(`${key}: an export names the module`, payload.module.length > 0, true);
  check(`${key}: and its subsystem`, payload.type, key);
  check(`${key}: and declares which shape it is`, payload.kind, 'event');

  const imported = await importPayload(JSON.parse(JSON.stringify(payload)));
  check(`${key}: it imports back`, imported.key, key);
  check(`${key}: under a fresh id, so it does not overwrite the original`,
    imported.id !== 'original', true);
  const copy = SUBSYSTEMS[key].get(imported.id);
  check(`${key}: with the content intact`, copy.name, `A ${key}`);
  check(`${key}: and both now exist`, Object.keys(SUBSYSTEMS[key].getAll().events).length, 2);
}

reset();
check('importing something that is not a subsystem is refused',
  await importPayload({ type: 'heist', data: {} }), null);
check('and so is a payload with no data', await importPayload({ type: 'chase' }), null);

/* --------------------------------------- the emitter must satisfy the predicate */

/*
 * Each relay names its emitter, its predicate, and a payload of the shape the
 * caller in rolls.js actually passes. If the two ever disagree the roll is
 * dropped with no error, which is the worst kind of bug to find at a table.
 */
const sent = [];
globalThis.game.socket = { emit: (_channel, data) => sent.push(data) };

const RELAYS = [
  ['roll', socket.emitApplyRoll, socket.shouldApplyRoll,
    { chaseId: 'c', obstacleId: 'o', participantId: 'p', degree: 2, skillLabel: 'Athletics', leadsTo: '' }],
  ['pass', socket.emitApplyPass, socket.shouldApplyPass,
    { chaseId: 'c', obstacleId: 'o', participantId: 'p' }],
  ['influence', socket.emitApplyInfluence, socket.shouldApplyInfluence,
    { influenceId: 'e', participantId: 'p', entryId: 'x', kind: 'influence', degree: 2 }],
  ['research', socket.emitApplyResearch, socket.shouldApplyResearch,
    { researchId: 'e', participantId: 'p', sourceId: 's', checkId: 'c', degree: 2 }],
  ['infiltration', socket.emitApplyInfiltration, socket.shouldApplyInfiltration,
    { infiltrationId: 'e', participantId: 'p', kind: 'obstacle', ownerId: 'o', objectiveId: 'j', checkId: 'c', degree: 2 }],
  ['leadership', socket.emitApplyLeadership, socket.shouldApplyLeadership,
    { leadershipId: 'e', participantId: 'p', eventId: 'v', checkId: 'c', degree: 2 }],
  ['victory', socket.emitApplyVictory, socket.shouldApplyVictory,
    { victoryId: 'e', participantId: 'p', checkId: 'c', degree: 2 }],
];

const gm = { userId: 'gm1', isGM: true, activeGMId: 'gm1' };

for (const [name, emit, predicate, payload] of RELAYS) {
  sent.length = 0;
  emit(payload);
  check(`${name}: emitting produces exactly one message`, sent.length, 1);
  const message = sent[0];
  check(`${name}: the receiving GM accepts what the sender emitted`, predicate(message, gm), true);
  check(`${name}: it names the designated GM, so only one applies it`, message.gmId, 'gm1');
  check(`${name}: and carries an action`, typeof message.action === 'string' && message.action.length > 0, true);

  // Exactly one predicate may claim a message, or two handlers run.
  const claimed = RELAYS.filter(([, , other]) => other(message, gm)).map(([n]) => n);
  check(`${name}: no other relay claims it`, claimed, [name]);

  // A second GM must not double-apply.
  check(`${name}: a different GM ignores it`,
    predicate(message, { userId: 'gm2', isGM: true, activeGMId: 'gm1' }), false);
  check(`${name}: and a player never applies it`,
    predicate(message, { userId: 'p1', isGM: false, activeGMId: 'gm1' }), false);
}

/*
 * A socket message is whatever a client chose to send, so the predicate is the
 * only thing standing between a hand-crafted payload and a world-setting write.
 * Every id it names must be required, and the degree must be one of the four
 * published ones — a degree of 99 indexes off the end of the degree tables.
 */
for (const [name, emit, predicate, payload] of RELAYS) {
  sent.length = 0;
  emit(payload);
  const good = sent[0];

  // leadsTo and skillLabel travel with the message but carry no authority, so
  // they are not required; everything else names something the handler reads.
  const optional = ['degree', 'leadsTo', 'skillLabel'];
  for (const field of Object.keys(payload).filter((f) => !optional.includes(f))) {
    check(`${name}: a message missing ${field} is refused`,
      predicate({ ...good, [field]: undefined }, gm), false);
    check(`${name}: and one where ${field} is empty`,
      predicate({ ...good, [field]: '' }, gm), false);
  }

  if ('degree' in payload) {
    check(`${name}: every published degree is accepted`,
      [0, 1, 2, 3].every((d) => predicate({ ...good, degree: d }, gm)), true);
    check(`${name}: and nothing else is`,
      [4, -1, 99, 1.5, '2', null, undefined, NaN]
        .some((d) => predicate({ ...good, degree: d }, gm)), false);
  }

  check(`${name}: a message with no action is refused`,
    predicate({ ...good, action: undefined }, gm), false);
  check(`${name}: and one that is not an object at all`,
    [null, undefined, 'string', 42].some((d) => predicate(d, gm)), false);
}

/*
 * The isGM guard only carries weight when no GM was designated: with gmId set
 * the message is addressed by id, but with it null the predicate falls back to
 * comparing against activeGMId, and only isGM then stands between a non-GM and
 * a world-setting write.
 */
for (const [name, emit, predicate, payload] of RELAYS) {
  sent.length = 0;
  const wasGM = globalThis.game.users.activeGM;
  globalThis.game.users.activeGM = null;
  emit(payload);
  globalThis.game.users.activeGM = wasGM;

  check(`${name}: with no GM designated, the message says so`, sent[0].gmId, null);
  check(`${name}: a GM still picks it up`,
    predicate(sent[0], { userId: 'gm1', isGM: true, activeGMId: 'gm1' }), true);
  check(`${name}: but a non-GM does not, however the ids line up`,
    predicate(sent[0], { userId: 'gm1', isGM: false, activeGMId: 'gm1' }), false);
}

/*
 * Infiltration is the one relay whose required fields depend on the message:
 * an obstacle lives inside an objective, a complication does not. Requiring
 * objectiveId unconditionally would silently drop every complication roll.
 */
const infil = (over) => {
  sent.length = 0;
  socket.emitApplyInfiltration({
    infiltrationId: 'e', participantId: 'p', ownerId: 'o', checkId: 'c', degree: 2, ...over,
  });
  return socket.shouldApplyInfiltration(sent[0], gm);
};
check('infiltration: an obstacle must name its objective',
  infil({ kind: 'obstacle' }), false);
check('infiltration: and is accepted once it does',
  infil({ kind: 'obstacle', objectiveId: 'j' }), true);
check('infiltration: a complication needs no objective',
  infil({ kind: 'complication' }), true);
check('infiltration: nor does an opportunity',
  infil({ kind: 'opportunity' }), true);
check('infiltration: but every one of them must say which kind it is',
  infil({ objectiveId: 'j' }), false);

// Showing an event to players is a broadcast, not an application.
sent.length = 0;
socket.emitShowEvent({ subsystem: 'victory', eventId: 'v1', userIds: null });
check('show: broadcasts to everyone when no recipients are named',
  socket.shouldHandle(sent[0], 'anyone'), true);
check('show: and is not mistaken for a roll', socket.shouldApplyRoll(sent[0], gm), false);
check('show: carries the subsystem so the right tab opens', sent[0].subsystem, 'victory');

check('every relay action is registered in SOCKET_ACTIONS',
  RELAYS.map(([, emit]) => {
    sent.length = 0;
    emit({});
    return Object.values(socket.SOCKET_ACTIONS).includes(sent[0].action);
  }).filter((ok) => !ok), []);

done('the registry, event addressing and every socket relay');
