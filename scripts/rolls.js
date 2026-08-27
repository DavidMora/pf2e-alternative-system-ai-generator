import { MODULE_ID } from './constants.js';
import {
  awarenessForDegree,
  chasePointsForDegree,
  victoryPointsForDegree,
  victoryReached,
  infiltrationPointsForDegree,
  getChase,
  getInfluence,
  getInfiltration,
  getLeadership,
  getVictory,
  getResearch,
  updateChase,
  updateInfiltration,
  updateInfluence,
  updateLeadership,
  updateVictory,
  updateResearch,
} from './helpers.js';
import {
  emitApplyLeadership,
  emitApplyVictory,
  emitApplyInfiltration,
  emitApplyInfluence,
  emitApplyPass,
  emitApplyResearch,
  emitApplyRoll,
} from './socket.js';

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
      // The roll that gets them through says so. Reading the state instead of
      // the change had every later roll on the same obstacle announce it again,
      // critical failures included.
      cleared:
        before < obstacle.chasePoints.goal &&
        obstacle.chasePoints.current >= obstacle.chasePoints.goal,
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

    // Chase points never go below zero, so a critical failure at 0 costs
    // nothing, and never above the goal, so a success on an obstacle the party
    // is already through earns nobody a point it did not actually move. Both
    // ends matter for the credit below.
    const before = obstacle.chasePoints.current;
    obstacle.chasePoints.current = Math.clamp(before + points, 0, obstacle.chasePoints.goal);
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
      // What the obstacle moved, which is what the message should say. The
      // nominal value read "+1 ... now 2/2" for a point that went nowhere.
      applied,
      // The roll that gets them through says so. Reading the state instead of
      // the change had every later roll on the same obstacle announce it again,
      // critical failures included.
      cleared:
        before < obstacle.chasePoints.goal &&
        obstacle.chasePoints.current >= obstacle.chasePoints.goal,
    };
  });

  if (!summary) return;

  const degreeKey = ['CriticalFailure', 'Failure', 'Success', 'CriticalSuccess'][degree];
  ui.notifications.info(
    game.i18n.format('PFAI.Roll.Applied', {
      name: summary.participant,
      skill: skillLabel ?? '',
      degree: game.i18n.localize(`PFAI.Degree.${degreeKey}`),
      points: summary.applied >= 0 ? `+${summary.applied}` : String(summary.applied),
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

  // Nothing hidden is rollable, by anyone. Reveal it first.
  if (entry.hidden) {
    ui.notifications.warn(game.i18n.format('PFAI.Influence.NotRevealed', { name: entry.label }));
    return null;
  }

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
      ...advanceInfluence(event),
    };
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

  announceInfluenceProgress(summary);
}

/**
 * Surface what the influence total has earned: concessions crossed and
 * approaches unlocked.
 *
 * Three copies of this existed — the roll path, the GM's award, and the point
 * stepper in the view — and the stepper's had quietly lost its announcements,
 * so a GM nudging the total past a concession was told nothing. One copy now.
 */
export function advanceInfluence(event) {
  const justReached = Object.values(event.thresholds ?? {})
    .sort((a, b) => a.points - b.points)
    .filter((t) => t.hidden && event.influencePoints >= t.points);
  // Reaching a threshold is something the party sees happen.
  for (const threshold of justReached) threshold.hidden = false;

  return { justReached, unlocked: revealByProgress(event) };
}

/** Shared notifications for whatever advanceInfluence surfaced. */
export function announceInfluenceProgress(summary) {
  for (const threshold of summary.justReached ?? []) {
    ui.notifications.info(
      game.i18n.format('PFAI.Influence.ThresholdReached', { name: threshold.name }),
    );
  }
  if (summary.unlocked?.length) {
    ui.notifications.info(
      game.i18n.format('PFAI.Influence.Unlocked', { what: summary.unlocked.join(', ') }),
    );
  }
}

/**
 * Surface anything the party has now earned the right to see.
 *
 * An approach with a revealAt appears once the influence total reaches it, so a
 * conversation can open up as it goes rather than showing everything at once.
 *
 * @returns {string[]} labels of what became visible
 */
export function revealByProgress(event) {
  const revealed = [];
  for (const key of ['discoveries', 'influenceSkills']) {
    for (const entry of Object.values(event[key] ?? {})) {
      if (!entry.hidden || entry.revealAt === null || entry.revealAt === undefined) continue;
      if (event.influencePoints < entry.revealAt) continue;
      entry.hidden = false;
      revealed.push(entry.label);
    }
  }
  return revealed;
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


/**
 * Award or remove influence points on a participant's behalf.
 *
 * The chase equivalent scopes credit to an obstacle; influence points are a
 * single running total, so this is the same idea without that dimension.
 */
export async function adjustInfluenceContribution({ influenceId, participantId, delta }) {
  if (!game.user.isGM) return null;
  const step = Math.trunc(Number(delta) || 0);
  if (!step) return null;

  let summary = null;
  await updateInfluence(influenceId, (event) => {
    const participant = event.participants[participantId];
    if (!participant) return;

    const before = event.influencePoints;
    event.influencePoints = Math.max(0, before + step);
    const applied = event.influencePoints - before;
    if (!applied) return;

    participant.contribution ??= { total: 0, successes: 0, rolls: 0, discoveries: 0 };
    // Credit what the total actually moved, so an award absorbed by the zero
    // floor is not recorded against anyone.
    participant.contribution.total += applied;

    summary = {
      participant: participant.name,
      applied,
      current: event.influencePoints,
      ...advanceInfluence(event),
    };
  });

  if (!summary) return null;
  ui.notifications.info(
    game.i18n.format('PFAI.Influence.Adjusted', {
      name: summary.participant,
      points: summary.applied > 0 ? `+${summary.applied}` : String(summary.applied),
      current: summary.current,
    }),
  );
  announceInfluenceProgress(summary);
  return summary;
}


/**
 * Roll a research check.
 *
 * Reuses the shared degree-to-points mapping; the published values are the same
 * as chases and influence. What is specific here is that points come from a
 * source with a cap, so a source that is exhausted yields nothing further.
 */
export async function rollResearchCheck({ researchId, participantId, sourceId, checkId, force = false }) {
  const event = getResearch(researchId);
  const participant = event?.participants?.[participantId];
  const source = event?.sources?.[sourceId];
  const check = source?.checks?.[checkId];
  if (!event || !participant || !source || !check) return null;

  if (source.hidden || check.hidden) {
    ui.notifications.warn(game.i18n.format('PFAI.Research.NotRevealed', { name: check.label }));
    return null;
  }

  const override = force && game.user.isGM;
  if (participant.hasActed && !override) {
    ui.notifications.warn(game.i18n.format('PFAI.Roll.AlreadyActed', { name: participant.name }));
    return null;
  }
  if (source.researchPoints.current >= source.researchPoints.max) {
    ui.notifications.warn(game.i18n.format('PFAI.Research.SourceExhausted', { name: source.name }));
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

  const statistic = actor.getStatistic?.(check.slug);
  if (!statistic) {
    ui.notifications.error(
      game.i18n.format('PFAI.Roll.NoStatistic', { skill: check.label, name: actor.name }),
    );
    return null;
  }

  // Events in play shift every DC while they last.
  const modifier = Object.values(event.events ?? {}).reduce(
    (acc, e) => acc + (e.modifier.active ? e.modifier.value : 0),
    0,
  );

  const roll = await statistic.roll({
    dc: { value: check.dc + modifier },
    label: `${event.name} — ${source.name}`,
    extraRollOptions: [`${MODULE_ID}:research`],
  });
  if (!roll) return null;

  const degree = roll.degreeOfSuccess ?? roll.options?.degreeOfSuccess;
  if (!Number.isInteger(degree)) {
    ui.notifications.error(game.i18n.localize('PFAI.Roll.NoDegree'));
    return null;
  }

  const payload = { researchId, participantId, sourceId, checkId, degree };
  if (game.user.isGM) await applyResearchResult(payload);
  else {
    if (!game.users.activeGM) {
      ui.notifications.error(game.i18n.localize('PFAI.Roll.NoGM'));
      return null;
    }
    emitApplyResearch(payload);
  }
  return { degree };
}

/** GM-side application of a research result. */
export async function applyResearchResult({ researchId, participantId, sourceId, checkId, degree }) {
  if (!game.user.isGM) return;
  const points = chasePointsForDegree(degree);

  let summary = null;
  await updateResearch(researchId, (event) => {
    const participant = event.participants[participantId];
    const source = event.sources[sourceId];
    if (!participant || !source) return;

    const before = event.researchPoints;
    // A source only ever yields up to its cap, so clamp the gain there first.
    const headroom = Math.max(0, source.researchPoints.max - source.researchPoints.current);
    const gain = points > 0 ? Math.min(points, headroom) : points;

    event.researchPoints = Math.max(0, before + gain);
    const applied = event.researchPoints - before;
    source.researchPoints.current = Math.max(0, source.researchPoints.current + applied);

    participant.contribution ??= { total: 0, successes: 0, rolls: 0 };
    participant.contribution.rolls += 1;
    if (degree >= 2) participant.contribution.successes += 1;
    participant.contribution.total += applied;
    participant.hasActed = true;

    summary = {
      participant: participant.name,
      source: source.name,
      applied,
      capped: points > 0 && applied < points,
      current: event.researchPoints,
      ...advanceResearch(event),
    };
  });

  if (!summary) return;

  const degreeKey = ['CriticalFailure', 'Failure', 'Success', 'CriticalSuccess'][degree];
  ui.notifications.info(
    game.i18n.format('PFAI.Research.Applied', {
      name: summary.participant,
      degree: game.i18n.localize(`PFAI.Degree.${degreeKey}`),
      points: summary.applied >= 0 ? `+${summary.applied}` : String(summary.applied),
      current: summary.current,
    }),
  );
  if (summary.capped) {
    ui.notifications.warn(game.i18n.format('PFAI.Research.SourceCapped', { name: summary.source }));
  }
  announceResearchProgress(summary);
}

/**
 * Surface anything the party has now earned: thresholds reached, sources and
 * checks that unlock at a point total, and events whose trigger has come up.
 */
export function advanceResearch(event) {
  const reached = Object.values(event.thresholds)
    .sort((a, b) => a.points - b.points)
    .filter((t) => event.researchPoints >= t.points && t.hidden);
  for (const threshold of reached) threshold.hidden = false;

  const unlocked = [];
  for (const source of Object.values(event.sources)) {
    if (source.hidden && source.revealAt !== null && event.researchPoints >= source.revealAt) {
      source.hidden = false;
      unlocked.push(source.name);
    }
    for (const check of Object.values(source.checks ?? {})) {
      if (check.hidden && check.revealAt !== null && event.researchPoints >= check.revealAt) {
        check.hidden = false;
        unlocked.push(check.label);
      }
    }
  }

  // Point-triggered and time-triggered events both fire from here, so a GM
  // adjusting either number by hand still gets the interruption.
  const fired = [];
  for (const complication of Object.values(event.events)) {
    if (complication.fired) continue;
    const at = complication.trigger.at;
    const reachedTrigger =
      complication.trigger.kind === 'rounds'
        ? event.rounds.current >= at
        : event.researchPoints >= at;
    if (!reachedTrigger) continue;
    complication.fired = true;
    complication.hidden = false;
    if (complication.modifier.value) complication.modifier.active = true;
    fired.push(complication.name);
  }

  return { reached, unlocked, fired };
}

/** Shared notifications for whatever advanceResearch surfaced. */
export function announceResearchProgress(summary) {
  for (const threshold of summary.reached ?? []) {
    ui.notifications.info(game.i18n.format('PFAI.Research.ThresholdReached', { name: threshold.name }));
  }
  if (summary.unlocked?.length) {
    ui.notifications.info(game.i18n.format('PFAI.Research.Unlocked', { what: summary.unlocked.join(', ') }));
  }
  for (const name of summary.fired ?? []) {
    ui.notifications.warn(game.i18n.format('PFAI.Research.EventFired', { name }), { permanent: true });
  }
}

/** Award or remove research points on a participant's behalf. */
export async function adjustResearchContribution({ researchId, participantId, sourceId, delta }) {
  if (!game.user.isGM) return null;
  const step = Math.trunc(Number(delta) || 0);
  if (!step) return null;

  let summary = null;
  await updateResearch(researchId, (event) => {
    const participant = event.participants[participantId];
    if (!participant) return;

    const before = event.researchPoints;
    event.researchPoints = Math.max(0, before + step);
    const applied = event.researchPoints - before;
    if (!applied) return;

    // Keep a source's tally in step when the award is attributed to one.
    const source = sourceId ? event.sources[sourceId] : null;
    if (source) {
      source.researchPoints.current = Math.clamp(
        source.researchPoints.current + applied,
        0,
        source.researchPoints.max,
      );
    }

    participant.contribution ??= { total: 0, successes: 0, rolls: 0 };
    participant.contribution.total += applied;

    summary = {
      participant: participant.name,
      applied,
      current: event.researchPoints,
      ...advanceResearch(event),
    };
  });

  if (!summary) return null;
  ui.notifications.info(
    game.i18n.format('PFAI.Research.Adjusted', {
      name: summary.participant,
      points: summary.applied > 0 ? `+${summary.applied}` : String(summary.applied),
      current: summary.current,
    }),
  );
  announceResearchProgress(summary);
  return summary;
}


/** Locate a check anywhere in an infiltration, and the thing that owns it. */
export function findInfiltrationCheck(event, { kind, ownerId, objectiveId, checkId }) {
  if (kind === 'obstacle') {
    const objective = event.objectives?.[objectiveId];
    const obstacle = objective?.obstacles?.[ownerId];
    return obstacle ? { owner: obstacle, objective, check: obstacle.checks?.[checkId] } : null;
  }
  const collection = kind === 'complication' ? 'complications' : 'opportunities';
  const owner = event[collection]?.[ownerId];
  return owner ? { owner, check: owner.checks?.[checkId] } : null;
}

/**
 * Roll an infiltration check.
 *
 * Unlike the other subsystems a failure costs no progress; it costs secrecy.
 * Awareness is the clock here, so every fumble feeds it.
 */
export async function rollInfiltrationCheck({
  infiltrationId,
  participantId,
  kind,
  ownerId,
  objectiveId,
  checkId,
  force = false,
}) {
  const event = getInfiltration(infiltrationId);
  const participant = event?.participants?.[participantId];
  const found = event ? findInfiltrationCheck(event, { kind, ownerId, objectiveId, checkId }) : null;
  if (!event || !participant || !found?.check) return null;

  const { owner, check } = found;
  if (owner.hidden || check.hidden) {
    ui.notifications.warn(game.i18n.format('PFAI.Infiltration.NotRevealed', { name: check.label }));
    return null;
  }

  // A fired complication stops everything until it is dealt with.
  const blocking = Object.values(event.complications ?? {}).filter((c) => c.fired && !c.resolved);
  if (kind !== 'complication' && blocking.length) {
    ui.notifications.warn(
      game.i18n.format('PFAI.Infiltration.Blocked', { name: blocking[0].name }),
    );
    return null;
  }

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

  const statistic = actor.getStatistic?.(check.slug);
  if (!statistic) {
    ui.notifications.error(
      game.i18n.format('PFAI.Roll.NoStatistic', { skill: check.label, name: actor.name }),
    );
    return null;
  }

  // Breakpoints already passed make everything harder.
  const modifier = Object.values(event.awarenessBreakpoints ?? {}).reduce(
    (acc, b) => (b.fired ? Math.max(acc, b.dcIncrease) : acc),
    0,
  );

  const roll = await statistic.roll({
    dc: { value: check.dc + modifier },
    label: `${event.name} — ${owner.name}`,
    extraRollOptions: [`${MODULE_ID}:infiltration`],
  });
  if (!roll) return null;

  const degree = roll.degreeOfSuccess ?? roll.options?.degreeOfSuccess;
  if (!Number.isInteger(degree)) {
    ui.notifications.error(game.i18n.localize('PFAI.Roll.NoDegree'));
    return null;
  }

  const payload = { infiltrationId, participantId, kind, ownerId, objectiveId, checkId, degree };
  if (game.user.isGM) await applyInfiltrationResult(payload);
  else {
    if (!game.users.activeGM) {
      ui.notifications.error(game.i18n.localize('PFAI.Roll.NoGM'));
      return null;
    }
    emitApplyInfiltration(payload);
  }
  return { degree };
}

/** GM-side application of an infiltration result. */
export async function applyInfiltrationResult({
  infiltrationId,
  participantId,
  kind,
  ownerId,
  objectiveId,
  checkId,
  degree,
}) {
  if (!game.user.isGM) return;

  let summary = null;
  await updateInfiltration(infiltrationId, (event) => {
    const participant = event.participants[participantId];
    const found = findInfiltrationCheck(event, { kind, ownerId, objectiveId, checkId });
    if (!participant || !found?.owner) return;

    const points = infiltrationPointsForDegree(degree);
    const awareness = awarenessForDegree(degree);

    participant.contribution ??= { total: 0, successes: 0, rolls: 0, awarenessCaused: 0 };
    participant.contribution.rolls += 1;
    if (degree >= 2) participant.contribution.successes += 1;
    participant.contribution.awarenessCaused += awareness;
    participant.hasActed = true;

    event.awareness.current = Math.max(0, event.awareness.current + awareness);

    let cleared = false;
    if (kind === 'obstacle') {
      const obstacle = found.owner;
      if (obstacle.individual) {
        // Each character clears this one for themselves.
        const before = obstacle.individualPoints[participantId] ?? 0;
        obstacle.individualPoints[participantId] = Math.min(
          obstacle.infiltrationPoints.goal,
          before + points,
        );
        participant.contribution.total += obstacle.individualPoints[participantId] - before;
        // The shared tally shows how many are through.
        obstacle.infiltrationPoints.current = Object.values(obstacle.individualPoints).filter(
          (v) => v >= obstacle.infiltrationPoints.goal,
        ).length;
        // Only the roll that gets them through announces it. Reporting the
        // state instead of the change had a critical failure say "past it"
        // for someone who had been past it for three rounds already.
        cleared =
          before < obstacle.infiltrationPoints.goal &&
          obstacle.individualPoints[participantId] >= obstacle.infiltrationPoints.goal;
      } else {
        const before = obstacle.infiltrationPoints.current;
        obstacle.infiltrationPoints.current = Math.min(
          obstacle.infiltrationPoints.goal,
          before + points,
        );
        participant.contribution.total += obstacle.infiltrationPoints.current - before;
        cleared =
          before < obstacle.infiltrationPoints.goal &&
          obstacle.infiltrationPoints.current >= obstacle.infiltrationPoints.goal;
      }
    } else if (kind === 'complication') {
      // Any success clears a complication and unblocks the job.
      if (degree >= 2) found.owner.resolved = true;
    } else if (kind === 'opportunity') {
      if (degree >= 2) found.owner.used = true;
    }

    summary = {
      participant: participant.name,
      owner: found.owner.name,
      kind,
      points,
      awareness,
      cleared,
      resolved: kind === 'complication' && found.owner.resolved,
      seized: kind === 'opportunity' && found.owner.used,
      awarenessTotal: event.awareness.current,
      ...advanceInfiltration(event),
    };
  });

  if (!summary) return;

  const degreeKey = ['CriticalFailure', 'Failure', 'Success', 'CriticalSuccess'][degree];
  ui.notifications.info(
    game.i18n.format('PFAI.Infiltration.Applied', {
      name: summary.participant,
      degree: game.i18n.localize(`PFAI.Degree.${degreeKey}`),
      points: summary.points,
      awareness: summary.awareness ? `+${summary.awareness}` : '0',
      total: summary.awarenessTotal,
    }),
  );
  if (summary.cleared) {
    ui.notifications.info(game.i18n.format('PFAI.Infiltration.ObstacleCleared', { name: summary.owner }));
  }
  if (summary.resolved) {
    ui.notifications.info(game.i18n.format('PFAI.Infiltration.ComplicationResolved', { name: summary.owner }));
  }
  if (summary.seized) {
    ui.notifications.info(game.i18n.format('PFAI.Infiltration.OpportunitySeized', { name: summary.owner }));
  }
  announceInfiltrationProgress(summary);
}

/**
 * Fire whatever the party's awareness and elapsed rounds have earned them:
 * breakpoints passed, complications triggered, obstacles unlocked.
 */
export function advanceInfiltration(event) {
  const passed = [];
  for (const breakpoint of Object.values(event.awarenessBreakpoints ?? {})) {
    if (breakpoint.fired || event.awareness.current < breakpoint.at) continue;
    breakpoint.fired = true;
    breakpoint.hidden = false;
    passed.push(breakpoint.name);
  }

  const triggered = [];
  for (const complication of Object.values(event.complications ?? {})) {
    if (complication.fired || complication.trigger.kind === 'manual') continue;
    const reached =
      complication.trigger.kind === 'rounds'
        ? event.rounds.current >= complication.trigger.at
        : event.awareness.current >= complication.trigger.at;
    if (!reached) continue;
    complication.fired = true;
    complication.hidden = false;
    triggered.push(complication.name);
  }

  const unlocked = [];
  for (const objective of Object.values(event.objectives ?? {})) {
    for (const obstacle of Object.values(objective.obstacles ?? {})) {
      if (obstacle.hidden && obstacle.revealAt !== null && event.awareness.current >= obstacle.revealAt) {
        obstacle.hidden = false;
        unlocked.push(obstacle.name);
      }
    }
  }

  return { passed, triggered, unlocked };
}

export function announceInfiltrationProgress(summary) {
  for (const name of summary.passed ?? []) {
    ui.notifications.warn(game.i18n.format('PFAI.Infiltration.BreakpointPassed', { name }), {
      permanent: true,
    });
  }
  for (const name of summary.triggered ?? []) {
    ui.notifications.warn(game.i18n.format('PFAI.Infiltration.ComplicationFired', { name }), {
      permanent: true,
    });
  }
  if (summary.unlocked?.length) {
    ui.notifications.info(
      game.i18n.format('PFAI.Infiltration.Unlocked', { what: summary.unlocked.join(', ') }),
    );
  }
}

/**
 * Spend an edge point to turn a failure into a success.
 *
 * Applies the point the failed roll should have earned and takes back the
 * awareness it caused, which is what "as if they had succeeded" means here.
 */
export async function spendEdgePoint({ infiltrationId, participantId, kind, ownerId, objectiveId }) {
  if (!game.user.isGM) return null;

  let summary = null;
  await updateInfiltration(infiltrationId, (event) => {
    if (event.edgePoints <= 0) return;
    const participant = event.participants[participantId];
    const found = findInfiltrationCheck(event, { kind, ownerId, objectiveId, checkId: null });
    if (!participant || !found?.owner) return;

    event.edgePoints -= 1;
    // Undo the awareness a failure drew, then credit the success.
    event.awareness.current = Math.max(0, event.awareness.current - 1);
    participant.contribution.awarenessCaused = Math.max(
      0,
      participant.contribution.awarenessCaused - 1,
    );

    if (kind === 'obstacle') {
      const obstacle = found.owner;
      if (obstacle.individual) {
        const before = obstacle.individualPoints[participantId] ?? 0;
        obstacle.individualPoints[participantId] = Math.min(obstacle.infiltrationPoints.goal, before + 1);
        obstacle.infiltrationPoints.current = Object.values(obstacle.individualPoints).filter(
          (v) => v >= obstacle.infiltrationPoints.goal,
        ).length;
      } else {
        obstacle.infiltrationPoints.current = Math.min(
          obstacle.infiltrationPoints.goal,
          obstacle.infiltrationPoints.current + 1,
        );
      }
      participant.contribution.total += 1;
    } else if (kind === 'complication') {
      found.owner.resolved = true;
    } else if (kind === 'opportunity') {
      found.owner.used = true;
    }

    summary = {
      participant: participant.name,
      owner: found.owner.name,
      remaining: event.edgePoints,
      awarenessTotal: event.awareness.current,
    };
  });

  if (!summary) {
    ui.notifications.warn(game.i18n.localize('PFAI.Infiltration.NoEdgePoints'));
    return null;
  }
  ui.notifications.info(
    game.i18n.format('PFAI.Infiltration.EdgeSpent', {
      name: summary.participant,
      owner: summary.owner,
      remaining: summary.remaining,
    }),
  );
  return summary;
}


/**
 * Roll a check against a leadership event.
 *
 * There is no point track here, so a success resolves the event outright rather
 * than moving a meter. What is tallied is how many the character sorted out.
 */
export async function rollLeadershipCheck({ leadershipId, participantId, eventId, checkId, force = false }) {
  const org = getLeadership(leadershipId);
  const participant = org?.participants?.[participantId];
  const event = org?.events?.[eventId];
  const check = event?.checks?.[checkId];
  if (!org || !participant || !event || !check) return null;

  if (event.hidden || check.hidden) {
    ui.notifications.warn(game.i18n.format('PFAI.Leadership.NotRevealed', { name: event.name }));
    return null;
  }
  if (event.resolved) {
    ui.notifications.warn(game.i18n.format('PFAI.Leadership.AlreadyResolved', { name: event.name }));
    return null;
  }

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

  const statistic = actor.getStatistic?.(check.slug);
  if (!statistic) {
    ui.notifications.error(
      game.i18n.format('PFAI.Roll.NoStatistic', { skill: check.label, name: actor.name }),
    );
    return null;
  }

  const roll = await statistic.roll({
    dc: { value: check.dc },
    label: `${org.name} — ${event.name}`,
    extraRollOptions: [`${MODULE_ID}:leadership`],
  });
  if (!roll) return null;

  const degree = roll.degreeOfSuccess ?? roll.options?.degreeOfSuccess;
  if (!Number.isInteger(degree)) {
    ui.notifications.error(game.i18n.localize('PFAI.Roll.NoDegree'));
    return null;
  }

  const payload = { leadershipId, participantId, eventId, checkId, degree };
  if (game.user.isGM) await applyLeadershipResult(payload);
  else {
    if (!game.users.activeGM) {
      ui.notifications.error(game.i18n.localize('PFAI.Roll.NoGM'));
      return null;
    }
    emitApplyLeadership(payload);
  }
  return { degree };
}

/** GM-side application of a leadership result. */
export async function applyLeadershipResult({ leadershipId, participantId, eventId, degree }) {
  if (!game.user.isGM) return;

  let summary = null;
  await updateLeadership(leadershipId, (org) => {
    const participant = org.participants[participantId];
    const event = org.events[eventId];
    if (!participant || !event) return;

    participant.contribution ??= { total: 0, successes: 0, rolls: 0 };
    participant.contribution.rolls += 1;
    participant.hasActed = true;
    if (degree >= 2) {
      participant.contribution.successes += 1;
      participant.contribution.total += 1;
      event.resolved = true;
    }

    summary = { participant: participant.name, event: event.name, resolved: event.resolved };
  });

  if (!summary) return;
  const degreeKey = ['CriticalFailure', 'Failure', 'Success', 'CriticalSuccess'][degree];
  ui.notifications.info(
    game.i18n.format('PFAI.Leadership.Applied', {
      name: summary.participant,
      event: summary.event,
      degree: game.i18n.localize(`PFAI.Degree.${degreeKey}`),
    }),
  );
  if (summary.resolved) {
    ui.notifications.info(game.i18n.format('PFAI.Leadership.Resolved', { name: summary.event }));
  }
}

/**
 * Reveal events the organisation has now grown into.
 *
 * The equivalent of the other subsystems' progress reveals, keyed on
 * organisation level rather than a point total.
 */
export function advanceLeadership(org) {
  const revealed = [];
  for (const event of Object.values(org.events ?? {})) {
    if (!event.hidden || event.revealAt === null || event.revealAt === undefined) continue;
    if (org.organizationLevel < event.revealAt) continue;
    event.hidden = false;
    revealed.push(event.name);
  }
  return revealed;
}

/**
 * Shared notification for whatever advanceLeadership surfaced.
 *
 * The other five subsystems pair advance with announce; leadership announced
 * inline in the view instead, which is the shape that let the influence
 * stepper lose its announcements without anyone noticing.
 */
export function announceLeadershipProgress(revealed) {
  if (!revealed?.length) return;
  ui.notifications.info(
    game.i18n.format('PFAI.Leadership.Unlocked', { what: revealed.join(', ') }),
  );
}


/**
 * Roll one Victory Point check.
 *
 * The same relay as everywhere else: a player's result is applied by exactly
 * one GM client, or the points get counted twice.
 */
export async function rollVictoryCheck({ victoryId, participantId, checkId, force = false }) {
  const event = getVictory(victoryId);
  const participant = event?.participants?.[participantId];
  const check = event?.checks?.[checkId];
  if (!event || !participant || !check) return null;
  // Nothing hidden is rollable, by anyone. Otherwise a player could score off a
  // check the GM has not revealed by naming its id.
  if (check.hidden) return null;

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

  const statistic = actor.getStatistic?.(check.slug);
  if (!statistic) {
    ui.notifications.error(
      game.i18n.format('PFAI.Roll.NoStatistic', { skill: check.label, name: actor.name }),
    );
    return null;
  }

  const roll = await statistic.roll({
    dc: { value: check.dc },
    label: `${event.name} — ${check.label}`,
    extraRollOptions: [`${MODULE_ID}:victory`],
  });
  if (!roll) return null;

  const degree = roll.degreeOfSuccess ?? roll.options?.degreeOfSuccess;
  if (!Number.isInteger(degree)) {
    ui.notifications.error(game.i18n.localize('PFAI.Roll.NoDegree'));
    return null;
  }

  const payload = { victoryId, participantId, checkId, degree };
  if (game.user.isGM) await applyVictoryResult(payload);
  else {
    if (!game.users.activeGM) {
      ui.notifications.error(game.i18n.localize('PFAI.Roll.NoGM'));
      return null;
    }
    emitApplyVictory(payload);
  }
  return { degree };
}

/** GM-side application of a Victory Point result. */
export async function applyVictoryResult({ victoryId, participantId, checkId, degree }) {
  if (!game.user.isGM) return;

  let summary = null;
  await updateVictory(victoryId, (event) => {
    const participant = event.participants[participantId];
    const check = event.checks[checkId];
    if (!participant || !check) return;

    const diminishing = event.structure === 'diminishing';
    const base = victoryPointsForDegree(degree, event.structure, event.recoveryPossible !== false);
    /*
     * A check the party unlocked by working something out pays more, as the
     * rules advise. Two things this has to get right:
     *
     * An award is a reward, so it always moves the total the way the party
     * wants — up in an accumulating contest, and up in a diminishing one too,
     * where "up" means recovering ground. Multiplying by the direction made a
     * success on the best check in the game cost two points.
     *
     * And it must not flatten the degree ladder: if a success is worth the
     * award, a critical success has to beat it, or the check the GM wanted to
     * feel special is the one where rolling well stops mattering.
     */
    const points = degree >= 2 && check.award
      ? check.award + (degree === 3 ? 1 : 0)
      : base;

    const before = event.points.current;
    // Both ends are real: a diminishing contest cannot fall below zero, and an
    // accumulating one gains nothing past its endpoint.
    event.points.current = Math.clamp(before + points, 0, Math.max(event.points.goal, before));
    const applied = event.points.current - before;

    participant.contribution ??= { total: 0, successes: 0, rolls: 0 };
    participant.contribution.rolls += 1;
    if (degree >= 2) participant.contribution.successes += 1;
    // Credit what actually moved, so a point absorbed by either end costs nobody.
    participant.contribution.total += applied;
    participant.hasActed = true;

    summary = {
      participant: participant.name,
      check: check.label,
      applied,
      current: event.points.current,
      goal: event.points.goal,
      // The end of the contest, whichever direction it runs in.
      // The transition, not the state, so it announces once.
      finished: victoryReached(event) && !victoryReached({ ...event, points: { ...event.points, current: before } }),
      lost: diminishing,
      ...advanceVictory(event),
    };
  });

  if (!summary) return;

  const degreeKey = ['CriticalFailure', 'Failure', 'Success', 'CriticalSuccess'][degree];
  ui.notifications.info(
    game.i18n.format('PFAI.Victory.Applied', {
      name: summary.participant,
      degree: game.i18n.localize(`PFAI.Degree.${degreeKey}`),
      points: summary.applied >= 0 ? `+${summary.applied}` : String(summary.applied),
      current: summary.current,
      goal: summary.goal,
    }),
  );
  announceVictoryProgress(summary);
}

/**
 * Surface what the current total has earned: thresholds crossed, checks that
 * unlock at a total, and events whose trigger has come up.
 *
 * Thresholds are compared by direction, because a diminishing contest passes
 * them on the way down.
 */
export function advanceVictory(event) {
  const diminishing = event.structure === 'diminishing';
  const at = event.points.current;

  const reached = Object.values(event.thresholds)
    .sort((a, b) => (diminishing ? b.points - a.points : a.points - b.points))
    .filter((t) => t.hidden && (diminishing ? at <= t.points : at >= t.points));
  for (const threshold of reached) threshold.hidden = false;

  const unlocked = [];
  for (const check of Object.values(event.checks)) {
    if (!check.hidden || check.revealAt === null) continue;
    if (diminishing ? at <= check.revealAt : at >= check.revealAt) {
      check.hidden = false;
      unlocked.push(check.label);
    }
  }

  const fired = [];
  for (const twist of Object.values(event.events)) {
    if (twist.fired) continue;
    const reachedTrigger =
      twist.trigger.kind === 'rounds'
        ? event.rounds.current >= twist.trigger.at
        : diminishing
          ? at <= twist.trigger.at
          : at >= twist.trigger.at;
    if (!reachedTrigger) continue;
    twist.fired = true;
    twist.hidden = false;
    fired.push(twist.name);
  }

  return { reached, unlocked, fired };
}

/**
 * The GM awarding or removing Victory Points by hand.
 *
 * This lived inline in the view, which is how it drifted: it negated the credit
 * in a diminishing contest, so a GM awarding a point docked the character they
 * meant to reward. Up is helping in both structures — a diminishing critical
 * success is worth +1 and reaching zero is the party losing the thing — so the
 * credit is what the total moved, exactly as `applyVictoryResult` records it.
 *
 * It sits beside the chase, influence and research versions so the four stay
 * one shape.
 */
export async function adjustVictoryContribution({ victoryId, participantId, delta }) {
  if (!game.user.isGM) return null;
  const step = Math.trunc(Number(delta) || 0);
  if (!step) return null;

  let summary = null;
  await updateVictory(victoryId, (event) => {
    const participant = event.participants[participantId];
    if (!participant) return;

    const before = event.points.current;
    event.points.current = Math.clamp(before + step, 0, Math.max(event.points.goal, before));
    const applied = event.points.current - before;
    if (!applied) return;

    participant.contribution ??= { total: 0, successes: 0, rolls: 0 };
    // Credit what the total actually moved, so an award absorbed by either end
    // is not recorded against anyone.
    participant.contribution.total += applied;

    summary = {
      participant: participant.name,
      applied,
      current: event.points.current,
      goal: event.points.goal,
      lost: event.structure === 'diminishing',
      ...advanceVictory(event),
    };
  });

  if (summary) announceVictoryProgress(summary);
  return summary;
}

/** Shared notifications for whatever advanceVictory surfaced. */
export function announceVictoryProgress(summary) {
  for (const threshold of summary.reached ?? []) {
    ui.notifications.info(game.i18n.format('PFAI.Victory.ThresholdReached', { name: threshold.name }));
  }
  if (summary.unlocked?.length) {
    ui.notifications.info(game.i18n.format('PFAI.Victory.Unlocked', { what: summary.unlocked.join(', ') }));
  }
  for (const name of summary.fired ?? []) {
    ui.notifications.warn(game.i18n.format('PFAI.Victory.EventFired', { name }), { permanent: true });
  }
  if (summary.finished) {
    // The track has run out, which is a fact. Whether that is a win is not, so
    // this tells the GM the number has arrived and leaves the call to them.
    ui.notifications.info(
      game.i18n.localize(
        summary.lost ? 'PFAI.Victory.TrackEmpty' : 'PFAI.Victory.TrackFull',
      ),
      { permanent: true },
    );
  }
}
