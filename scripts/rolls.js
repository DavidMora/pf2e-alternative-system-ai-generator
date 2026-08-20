import { MODULE_ID } from './constants.js';
import {
  chasePointsForDegree,
  getChase,
  getInfluence,
  updateChase,
  updateInfluence,
} from './helpers.js';
import { emitApplyInfluence, emitApplyPass, emitApplyRoll } from './socket.js';

/**
 * Roll a chase skill check and record the outcome.
 *
 * Players cannot write world settings, so a player's result is relayed to a GM
 * client which applies it. A GM applies their own roll directly.
 */
export async function rollChaseCheck({ chaseId, obstacleId, participantId, optionId, force = false }) {
  const chase = getChase(chaseId);
  const obstacle = chase?.obstacles?.[obstacleId];
  const participant = chase?.participants?.[participantId];
  const option = obstacle?.skillOptions?.[optionId];
  if (!chase || !obstacle || !participant || !option) return null;

  // A GM may deliberately roll again for someone; a player may not.
  const override = force && game.user.isGM;
  if (participant.hasActed && !override) {
    ui.notifications.warn(game.i18n.format('PFAI.Roll.AlreadyActed', { name: participant.name }));
    return null;
  }

  const actor = participant.uuid ? await fromUuid(participant.uuid) : null;
  if (!actor) {
    ui.notifications.error(game.i18n.format('PFAI.Roll.NoActor', { name: participant.name }));
    return null;
  }
  // GMs own every actor, so this only ever stops a player rolling someone else's.
  if (!actor.isOwner) {
    ui.notifications.error(game.i18n.format('PFAI.Roll.NotOwner', { name: participant.name }));
    return null;
  }

  const statistic = actor.getStatistic?.(option.slug);
  if (!statistic) {
    ui.notifications.error(
      game.i18n.format('PFAI.Roll.NoStatistic', { skill: option.label, name: actor.name }),
    );
    return null;
  }

  const roll = await statistic.roll({
    dc: { value: option.dc },
    label: `${chase.name} — ${obstacle.name}`,
    extraRollOptions: [`${MODULE_ID}:chase`],
  });
  // A cancelled roll dialog returns nothing; treat it as no action taken.
  if (!roll) return null;

  const degree = roll.degreeOfSuccess ?? roll.options?.degreeOfSuccess;
  if (!Number.isInteger(degree)) {
    ui.notifications.error(game.i18n.localize('PFAI.Roll.NoDegree'));
    return null;
  }

  const payload = {
    chaseId,
    obstacleId,
    participantId,
    degree,
    skillLabel: option.label,
    leadsTo: option.leadsTo ?? '',
  };

  if (game.user.isGM) {
    await applyRollResult(payload);
  } else {
    if (!game.users.activeGM) {
      ui.notifications.error(game.i18n.localize('PFAI.Roll.NoGM'));
      return null;
    }
    emitApplyRoll(payload);
  }

  return { degree, points: chasePointsForDegree(degree) };
}

/**
 * Pass a participant's turn.
 *
 * Published rule: "A character who passes their turn or is unable to act
 * automatically causes the group to lose 1 Chase Point."
 */
export async function passTurn({ chaseId, obstacleId, participantId, force = false }) {
  const chase = getChase(chaseId);
  const participant = chase?.participants?.[participantId];
  const obstacle = chase?.obstacles?.[obstacleId];
  if (!chase || !participant || !obstacle) return null;

  const override = force && game.user.isGM;
  if (participant.hasActed && !override) {
    ui.notifications.warn(game.i18n.format('PFAI.Roll.AlreadyActed', { name: participant.name }));
    return null;
  }

  if (!game.user.isGM) {
    // A player may only pass for a participant they own.
    const actor = participant.uuid ? await fromUuid(participant.uuid) : null;
    if (!actor?.isOwner) {
      ui.notifications.error(game.i18n.format('PFAI.Roll.NotOwner', { name: participant.name }));
      return null;
    }
    if (!game.users.activeGM) {
      ui.notifications.error(game.i18n.localize('PFAI.Roll.NoGM'));
      return null;
    }
    emitApplyPass({ chaseId, obstacleId, participantId });
    return { passed: true };
  }

  await applyPassResult({ chaseId, obstacleId, participantId });
  return { passed: true };
}

/** GM-side application of a passed turn. */
export async function applyPassResult({ chaseId, obstacleId, participantId }) {
  if (!game.user.isGM) return;

  let summary = null;
  await updateChase(chaseId, (chase) => {
    const obstacle = chase.obstacles[obstacleId];
    const participant = chase.participants[participantId];
    if (!obstacle || !participant) return;

    const before = obstacle.chasePoints.current;
    obstacle.chasePoints.current = Math.max(0, before - 1);
    const applied = obstacle.chasePoints.current - before;
    participant.hasActed = true;

    participant.contribution ??= { total: 0, byObstacle: {}, successes: 0, rolls: 0 };
    participant.contribution.byObstacle ??= {};
    participant.contribution.total += applied;
    participant.contribution.byObstacle[obstacleId] =
      (participant.contribution.byObstacle[obstacleId] ?? 0) + applied;
    // A pass is a turn spent, not a roll made, so the hit rate is untouched.

    summary = {
      participant: participant.name,
      applied,
      current: obstacle.chasePoints.current,
      goal: obstacle.chasePoints.goal,
    };
  });

  if (!summary) return;
  ui.notifications.info(
    game.i18n.format('PFAI.Roll.Passed', {
      name: summary.participant,
      points: summary.applied === 0 ? '0' : String(summary.applied),
      current: summary.current,
      goal: summary.goal,
    }),
  );
}

/**
 * Award or remove chase points on a participant's behalf.
 *
 * The GM stays in charge of the fiction: a spell, a hero point, or a clever
 * plan can hand someone a success that no skill check produced. Adjustments are
 * attributed like rolls, so the contribution tally stays honest, but they do not
 * count as a roll and do not consume the participant's action.
 */
export async function adjustContribution({ chaseId, obstacleId, participantId, delta }) {
  if (!game.user.isGM) return null;
  const step = Math.trunc(Number(delta) || 0);
  if (!step) return null;

  let summary = null;
  await updateChase(chaseId, (chase) => {
    const obstacle = chase.obstacles[obstacleId];
    const participant = chase.participants[participantId];
    if (!obstacle || !participant) return;

    const before = obstacle.chasePoints.current;
    obstacle.chasePoints.current = Math.max(0, before + step);
    const applied = obstacle.chasePoints.current - before;
    if (!applied) return;

    participant.contribution ??= { total: 0, byObstacle: {}, successes: 0, rolls: 0 };
    participant.contribution.byObstacle ??= {};
    participant.contribution.total += applied;
    participant.contribution.byObstacle[obstacleId] =
      (participant.contribution.byObstacle[obstacleId] ?? 0) + applied;

    summary = {
      participant: participant.name,
      obstacle: obstacle.name,
      applied,
      current: obstacle.chasePoints.current,
      goal: obstacle.chasePoints.goal,
      cleared: obstacle.chasePoints.current >= obstacle.chasePoints.goal,
    };
  });

  if (!summary) return null;

  ui.notifications.info(
    game.i18n.format('PFAI.Roll.Adjusted', {
      name: summary.participant,
      points: summary.applied > 0 ? `+${summary.applied}` : String(summary.applied),
      current: summary.current,
      goal: summary.goal,
    }),
  );
  if (summary.cleared) {
    ui.notifications.info(game.i18n.format('PFAI.Roll.Cleared', { name: summary.obstacle }));
  }
  return summary;
}

/**
 * Apply a roll outcome to the stored chase. GM-only: this writes a world
 * setting. Called directly for a GM's own roll, or via socket for a player's.
 */
export async function applyRollResult({ chaseId, obstacleId, participantId, degree, skillLabel, leadsTo }) {
  if (!game.user.isGM) return;
  const points = chasePointsForDegree(degree);

  let summary = null;
  let routed = null;
  await updateChase(chaseId, (chase) => {
    const obstacle = chase.obstacles[obstacleId];
    const participant = chase.participants[participantId];
    if (!obstacle || !participant) return;

    // Chase points never go below zero, so a critical failure at 0 costs nothing.
    const before = obstacle.chasePoints.current;
    obstacle.chasePoints.current = Math.max(0, before + points);
    participant.hasActed = true;

    // Credit what the obstacle actually moved, not the nominal points, so a
    // critical failure absorbed by the zero floor is not recorded as -1.
    const applied = obstacle.chasePoints.current - before;
    participant.contribution ??= { total: 0, byObstacle: {}, successes: 0, rolls: 0 };
    participant.contribution.byObstacle ??= {};
    participant.contribution.total += applied;
    participant.contribution.byObstacle[obstacleId] =
      (participant.contribution.byObstacle[obstacleId] ?? 0) + applied;
    participant.contribution.rolls += 1;
    if (degree >= 2) participant.contribution.successes += 1;

    // Only a success commits you to the route; botching the climb does not
    // put you on the rooftops.
    if (leadsTo && degree >= 2 && participant.branch !== leadsTo) {
      participant.branch = leadsTo;
      routed = leadsTo;
    }

    summary = {
      participant: participant.name,
      contributed: participant.contribution.total,
      obstacle: obstacle.name,
      current: obstacle.chasePoints.current,
      goal: obstacle.chasePoints.goal,
      cleared: obstacle.chasePoints.current >= obstacle.chasePoints.goal,
    };
  });

  if (!summary) return;

  const degreeKey = ['CriticalFailure', 'Failure', 'Success', 'CriticalSuccess'][degree];
  ui.notifications.info(
    game.i18n.format('PFAI.Roll.Applied', {
      name: summary.participant,
      skill: skillLabel ?? '',
      degree: game.i18n.localize(`PFAI.Degree.${degreeKey}`),
      points: points >= 0 ? `+${points}` : String(points),
      current: summary.current,
      goal: summary.goal,
    }),
  );

  if (routed) {
    ui.notifications.info(
      game.i18n.format('PFAI.Roll.Routed', { name: summary.participant, branch: routed }),
    );
  }
  if (summary.cleared) {
    ui.notifications.info(game.i18n.format('PFAI.Roll.Cleared', { name: summary.obstacle }));
  }
}


/**
 * Roll an influence or discovery check.
 *
 * The degree-to-points mapping is the same as chases (critical success 2,
 * success 1, critical failure -1), so it is reused rather than restated.
 * Discovery checks earn no points; they reveal what they are attached to.
 */
export async function rollInfluenceCheck({ influenceId, participantId, entryId, kind, force = false }) {
  const event = getInfluence(influenceId);
  const participant = event?.participants?.[participantId];
  const collection = kind === 'discovery' ? 'discoveries' : 'influenceSkills';
  const entry = event?.[collection]?.[entryId];
  if (!event || !participant || !entry) return null;

  const override = force && game.user.isGM;
  if (participant.hasActed && !override) {
    ui.notifications.warn(game.i18n.format('PFAI.Roll.AlreadyActed', { name: participant.name }));
    return null;
  }

  const actor = participant.uuid ? await fromUuid(participant.uuid) : null;
  if (!actor) {
    ui.notifications.error(game.i18n.format('PFAI.Roll.NoActor', { name: participant.name }));
    return null;
  }
  if (!actor.isOwner) {
    ui.notifications.error(game.i18n.format('PFAI.Roll.NotOwner', { name: participant.name }));
    return null;
  }

  const statistic = actor.getStatistic?.(entry.slug);
  if (!statistic) {
    ui.notifications.error(
      game.i18n.format('PFAI.Roll.NoStatistic', { skill: entry.label, name: actor.name }),
    );
    return null;
  }

  // Weaknesses and resistances the party has put into play move the DC.
  const modifier = ['weaknesses', 'resistances', 'penalties'].reduce(
    (acc, key) =>
      acc + Object.values(event[key] ?? {}).reduce((sum, e) => sum + (e.used ? e.modifier : 0), 0),
    0,
  );

  const roll = await statistic.roll({
    dc: { value: entry.dc + modifier },
    label: `${event.name} — ${entry.label}`,
    extraRollOptions: [`${MODULE_ID}:influence`],
  });
  if (!roll) return null;

  const degree = roll.degreeOfSuccess ?? roll.options?.degreeOfSuccess;
  if (!Number.isInteger(degree)) {
    ui.notifications.error(game.i18n.localize('PFAI.Roll.NoDegree'));
    return null;
  }

  const payload = { influenceId, participantId, entryId, kind, degree };
  if (game.user.isGM) await applyInfluenceResult(payload);
  else {
    if (!game.users.activeGM) {
      ui.notifications.error(game.i18n.localize('PFAI.Roll.NoGM'));
      return null;
    }
    emitApplyInfluence(payload);
  }
  return { degree };
}

/** GM-side application of an influence or discovery result. */
export async function applyInfluenceResult({ influenceId, participantId, entryId, kind, degree }) {
  if (!game.user.isGM) return;
  const isDiscovery = kind === 'discovery';
  const points = isDiscovery ? 0 : chasePointsForDegree(degree);

  let summary = null;
  await updateInfluence(influenceId, (event) => {
    const participant = event.participants[participantId];
    if (!participant) return;

    participant.contribution ??= { total: 0, successes: 0, rolls: 0, discoveries: 0 };
    participant.contribution.rolls += 1;
    if (degree >= 2) participant.contribution.successes += 1;
    participant.hasActed = true;

    let revealed = null;
    if (isDiscovery) {
      if (degree >= 2) {
        participant.contribution.discoveries += 1;
        // A success uncovers the cheapest thing still hidden; a critical
        // success uncovers two, as published.
        revealed = revealHidden(event, degree === 3 ? 2 : 1);
      }
    } else {
      const before = event.influencePoints;
      event.influencePoints = Math.max(0, before + points);
      const applied = event.influencePoints - before;
      participant.contribution.total += applied;
    }

    summary = {
      participant: participant.name,
      points,
      revealed,
      current: event.influencePoints,
      next: Object.values(event.thresholds)
        .sort((a, b) => a.points - b.points)
        .find((t) => event.influencePoints < t.points) ?? null,
      justReached: Object.values(event.thresholds)
        .sort((a, b) => a.points - b.points)
        .filter((t) => event.influencePoints >= t.points && t.hidden),
    };

    // Reaching a threshold is something the party sees happen.
    for (const threshold of summary.justReached) threshold.hidden = false;
  });

  if (!summary) return;

  const degreeKey = ['CriticalFailure', 'Failure', 'Success', 'CriticalSuccess'][degree];
  const degreeLabel = game.i18n.localize(`PFAI.Degree.${degreeKey}`);

  if (isDiscovery) {
    ui.notifications.info(
      summary.revealed?.length
        ? game.i18n.format('PFAI.Influence.Discovered', {
            name: summary.participant,
            what: summary.revealed.join(', '),
          })
        : game.i18n.format('PFAI.Influence.DiscoveredNothing', {
            name: summary.participant,
            degree: degreeLabel,
          }),
    );
  } else {
    ui.notifications.info(
      game.i18n.format('PFAI.Influence.Applied', {
        name: summary.participant,
        degree: degreeLabel,
        points: summary.points >= 0 ? `+${summary.points}` : String(summary.points),
        current: summary.current,
        next: summary.next ? summary.next.points : '\u2014',
      }),
    );
  }

  for (const threshold of summary.justReached ?? []) {
    ui.notifications.info(game.i18n.format('PFAI.Influence.ThresholdReached', { name: threshold.name }));
  }
}

/**
 * Uncover hidden information, cheapest first: the easiest influence skill, then
 * a weakness, then a resistance. Mirrors what a discovery check is worth.
 * @returns {string[]} labels of what was revealed
 */
function revealHidden(event, count) {
  const candidates = [
    ...Object.values(event.influenceSkills ?? {})
      .filter((e) => e.hidden)
      .sort((a, b) => a.dc - b.dc)
      .map((e) => ({ entry: e, label: e.label })),
    ...Object.values(event.weaknesses ?? {})
      .filter((e) => e.hidden)
      .map((e) => ({ entry: e, label: e.name })),
    ...Object.values(event.resistances ?? {})
      .filter((e) => e.hidden)
      .map((e) => ({ entry: e, label: e.name })),
  ];

  const revealed = [];
  for (const candidate of candidates.slice(0, count)) {
    candidate.entry.hidden = false;
    revealed.push(candidate.label);
  }
  return revealed;
}
