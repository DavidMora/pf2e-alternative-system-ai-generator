import { MODULE_ID } from './constants.js';

export const SOCKET_EVENT = `module.${MODULE_ID}`;

export const SOCKET_ACTIONS = {
  showChase: 'showChase',
  applyRoll: 'applyRoll',
  applyPass: 'applyPass',
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
  if (!data.chaseId) return false;
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
function targetsThisGM(data, { userId, isGM, activeGMId }) {
  if (!isGM) return false;
  if (!data.chaseId || !data.obstacleId || !data.participantId) return false;
  // Only the designated GM applies; if none was named, the active GM does.
  return data.gmId ? data.gmId === userId : activeGMId === userId;
}

export function shouldApplyRoll(data, context) {
  if (!data || typeof data !== 'object') return false;
  if (data.action !== SOCKET_ACTIONS.applyRoll) return false;
  if (!Number.isInteger(data.degree) || data.degree < 0 || data.degree > 3) return false;
  return targetsThisGM(data, context);
}

/** A passed turn carries no degree; everything else is validated the same. */
export function shouldApplyPass(data, context) {
  if (!data || typeof data !== 'object') return false;
  if (data.action !== SOCKET_ACTIONS.applyPass) return false;
  return targetsThisGM(data, context);
}

/**
 * Ask other clients to open the subsystem window on a specific chase.
 * Foundry does not echo a socket emit back to its sender, so the GM's own
 * window is left exactly as they had it.
 */
export function emitShowChase(chaseId, userIds) {
  game.socket.emit(SOCKET_EVENT, {
    action: SOCKET_ACTIONS.showChase,
    chaseId,
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

export function registerSocket({ onShowChase, onApplyRoll, onApplyPass }) {
  game.socket.on(SOCKET_EVENT, (data) => {
    if (shouldHandle(data, game.user.id)) {
      onShowChase(data.chaseId);
      return;
    }
    const context = {
      userId: game.user.id,
      isGM: game.user.isGM,
      activeGMId: game.users.activeGM?.id ?? null,
    };
    if (shouldApplyRoll(data, context)) onApplyRoll(data);
    else if (shouldApplyPass(data, context)) onApplyPass(data);
  });
}
