import { MODULE_ID } from './constants.js';

export const SOCKET_EVENT = `module.${MODULE_ID}`;

export const SOCKET_ACTIONS = {
  showChase: 'showChase',
  applyRoll: 'applyRoll',
  applyPass: 'applyPass',
  applyInfluence: 'applyInfluence',
  applyResearch: 'applyResearch',
  applyInfiltration: 'applyInfiltration',
  applyLeadership: 'applyLeadership',
  applyVictory: 'applyVictory',
};

/**
 * Decide whether this client should act on a socket message.
 *
 * Kept pure and separate from the handler so the targeting rules can be tested
 * without a live Foundry session.
 *
 * @param {object} data the socket payload
 * @param {string} userId the receiving user's id
 */
export function shouldHandle(data, userId) {
  if (!data || typeof data !== 'object') return false;
  if (data.action !== SOCKET_ACTIONS.showChase) return false;
  // `chaseId` is still accepted so a client on an older build is not confused.
  if (!(data.eventId ?? data.chaseId)) return false;
  // No explicit recipients means everyone; otherwise this user must be listed.
  if (data.userIds === undefined || data.userIds === null) return true;
  if (!Array.isArray(data.userIds)) return false;
  return data.userIds.includes(userId);
}

/**
 * Whether this client should apply a relayed roll.
 *
 * World settings are GM-writable only, so a player's roll has to be applied by
 * a GM client. Exactly one GM must act or the points would be counted twice,
 * hence the designated-GM id carried on the message.
 */
function targetsThisGM(data, { userId, isGM, activeGMId }, required = []) {
  if (!isGM) return false;
  // Some relays need a field only in one mode — infiltration carries an
  // objective id for obstacles and nothing for complications — so a relay may
  // name its fields as a function of the message.
  const fields = typeof required === 'function' ? required(data) : required;
  if (fields.some((field) => !data[field])) return false;
  // Only the designated GM applies; if none was named, the active GM does.
  return data.gmId ? data.gmId === userId : activeGMId === userId;
}

/** A degree of success is one of the four published ones, or the roll is junk. */
const validDegree = (degree) => Number.isInteger(degree) && degree >= 0 && degree <= 3;

/**
 * Build the predicate for one relay.
 *
 * Seven of these existed, six of them the same five lines with different id
 * names, and the two that used the shared helper had already drifted from the
 * five that did not. The shape is the contract, so it is written once: the
 * action must match, the named ids must be present, the degree must be real,
 * and the message must be addressed to this GM.
 */
const applies = (action, required, { degree = true } = {}) => (data, context) => {
  if (!data || typeof data !== 'object') return false;
  if (data.action !== action) return false;
  if (degree && !validDegree(data.degree)) return false;
  return targetsThisGM(data, context, required);
};

export const shouldApplyRoll = applies(SOCKET_ACTIONS.applyRoll, ['chaseId', 'obstacleId', 'participantId']);

/** Influence results are relayed exactly like chase rolls, to one GM only. */
export const shouldApplyInfluence = applies(SOCKET_ACTIONS.applyInfluence, ['influenceId', 'participantId', 'entryId', 'kind']);

export function emitApplyInfluence({ influenceId, participantId, entryId, kind, degree }) {
  game.socket.emit(SOCKET_EVENT, {
    action: SOCKET_ACTIONS.applyInfluence,
    influenceId,
    participantId,
    entryId,
    kind,
    degree,
    gmId: game.users.activeGM?.id ?? null,
  });
}

/** Research results are relayed exactly like the others, to one GM only. */
export const shouldApplyResearch = applies(SOCKET_ACTIONS.applyResearch, ['researchId', 'participantId', 'sourceId', 'checkId']);

export function emitApplyResearch({ researchId, participantId, sourceId, checkId, degree }) {
  game.socket.emit(SOCKET_EVENT, {
    action: SOCKET_ACTIONS.applyResearch,
    researchId,
    participantId,
    sourceId,
    checkId,
    degree,
    gmId: game.users.activeGM?.id ?? null,
  });
}

/** Infiltration results are relayed like the rest, to one GM only. */
export const shouldApplyInfiltration = applies(SOCKET_ACTIONS.applyInfiltration, (data) => [
  'infiltrationId', 'participantId', 'kind', 'ownerId', 'checkId',
  // Only an obstacle sits inside an objective.
  ...(data.kind === 'obstacle' ? ['objectiveId'] : []),
]);

export function emitApplyInfiltration(payload) {
  game.socket.emit(SOCKET_EVENT, {
    action: SOCKET_ACTIONS.applyInfiltration,
    ...payload,
    gmId: game.users.activeGM?.id ?? null,
  });
}

/** Leadership results are relayed like the rest, to one GM only. */
export const shouldApplyLeadership = applies(SOCKET_ACTIONS.applyLeadership, ['leadershipId', 'participantId', 'eventId', 'checkId']);

export function emitApplyLeadership(payload) {
  game.socket.emit(SOCKET_EVENT, {
    action: SOCKET_ACTIONS.applyLeadership,
    ...payload,
    gmId: game.users.activeGM?.id ?? null,
  });
}

/** Victory Point results are relayed like the rest, to one GM only. */
export const shouldApplyVictory = applies(SOCKET_ACTIONS.applyVictory, ['victoryId', 'participantId', 'checkId']);

export function emitApplyVictory(payload) {
  game.socket.emit(SOCKET_EVENT, {
    action: SOCKET_ACTIONS.applyVictory,
    ...payload,
    gmId: game.users.activeGM?.id ?? null,
  });
}

/** A passed turn carries no degree; everything else is validated the same. */
export const shouldApplyPass = applies(SOCKET_ACTIONS.applyPass, ['chaseId', 'obstacleId', 'participantId'], { degree: false });

/**
 * Ask other clients to open the subsystem window on a specific chase.
 * Foundry does not echo a socket emit back to its sender, so the GM's own
 * window is left exactly as they had it.
 */
export function emitShowEvent({ subsystem, eventId, userIds }) {
  game.socket.emit(SOCKET_EVENT, {
    action: SOCKET_ACTIONS.showChase,
    subsystem,
    eventId,
    userIds,
  });
}

/** Ask a GM client to apply the outcome of a roll this player just made. */
export function emitApplyRoll({ chaseId, obstacleId, participantId, degree, skillLabel, leadsTo }) {
  game.socket.emit(SOCKET_EVENT, {
    action: SOCKET_ACTIONS.applyRoll,
    chaseId,
    obstacleId,
    participantId,
    degree,
    skillLabel,
    leadsTo,
    gmId: game.users.activeGM?.id ?? null,
  });
}

/** Tell a GM client that this player passed their turn. */
export function emitApplyPass({ chaseId, obstacleId, participantId }) {
  game.socket.emit(SOCKET_EVENT, {
    action: SOCKET_ACTIONS.applyPass,
    chaseId,
    obstacleId,
    participantId,
    gmId: game.users.activeGM?.id ?? null,
  });
}

export function registerSocket({
  onShowChase,
  onApplyRoll,
  onApplyPass,
  onApplyInfluence,
  onApplyResearch,
  onApplyInfiltration,
  onApplyLeadership,
  onApplyVictory,
}) {
  game.socket.on(SOCKET_EVENT, (data) => {
    if (shouldHandle(data, game.user.id)) {
      onShowChase({
        subsystem: data.subsystem ?? 'chase',
        eventId: data.eventId ?? data.chaseId,
      });
      return;
    }
    const context = {
      userId: game.user.id,
      isGM: game.user.isGM,
      activeGMId: game.users.activeGM?.id ?? null,
    };
    if (shouldApplyRoll(data, context)) onApplyRoll(data);
    else if (shouldApplyPass(data, context)) onApplyPass(data);
    else if (shouldApplyInfluence(data, context)) onApplyInfluence(data);
    else if (shouldApplyResearch(data, context)) onApplyResearch(data);
    else if (shouldApplyInfiltration(data, context)) onApplyInfiltration(data);
    else if (shouldApplyLeadership(data, context)) onApplyLeadership(data);
    else if (shouldApplyVictory(data, context)) onApplyVictory(data);
  });
}
