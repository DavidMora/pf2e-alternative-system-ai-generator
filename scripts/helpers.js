import { DC_ADJUSTMENTS, LEVEL_DCS, MODULE_ID, SETTINGS } from './constants.js';

/** Current chases as a plain, safely-mutable object. */
export function getChases() {
  return game.settings.get(MODULE_ID, SETTINGS.chases).toObject();
}

/**
 * Persist a mutated chases object. World-scoped, so this requires a GM; player
 * clients receive the update through Foundry's setting broadcast.
 */
export async function setChases(chases) {
  return game.settings.set(MODULE_ID, SETTINGS.chases, chases);
}

/** Current influence events as a plain, safely-mutable object. */
export function getInfluences() {
  return game.settings.get(MODULE_ID, SETTINGS.influences).toObject();
}

export async function setInfluences(influences) {
  return game.settings.set(MODULE_ID, SETTINGS.influences, influences);
}

export function getInfluence(id) {
  return getInfluences().events[id] ?? null;
}

/** Apply a mutation to one influence event and save. */
export async function updateInfluence(id, mutate) {
  const influences = getInfluences();
  const event = influences.events[id];
  if (!event) return null;
  mutate(event);
  await setInfluences(influences);
  return event;
}

export async function deleteInfluence(id) {
  const influences = getInfluences();
  delete influences.events[id];
  await setInfluences({ events: { ...influences.events } });
}

/** Read a single chase as a plain object, or null. */
export function getChase(id) {
  return getChases().events[id] ?? null;
}

/**
 * Apply a mutation to one chase and save. The callback receives the plain
 * object and mutates it in place.
 */
export async function updateChase(id, mutate) {
  const chases = getChases();
  const chase = chases.events[id];
  if (!chase) return null;
  mutate(chase);
  await setChases(chases);
  return chase;
}

export async function deleteChase(id) {
  const chases = getChases();
  delete chases.events[id];
  // Rebuilding the map avoids needing Foundry's `-=key` deletion syntax.
  await setChases({ events: { ...chases.events } });
}

/**
 * Sort obstacles into play order: by step, then by branch label within a step.
 */
export function sortObstacles(obstacles) {
  return Object.values(obstacles ?? {}).sort(
    (a, b) => a.position - b.position || (a.branch ?? '').localeCompare(b.branch ?? ''),
  );
}

/**
 * Display labels for obstacles, e.g. "1", "2A", "2B", "3".
 *
 * The step number is the rank of the distinct position, so a fork does not
 * consume two numbers.
 */
export function obstacleLabels(obstacles) {
  const sorted = sortObstacles(obstacles);
  const steps = [...new Set(sorted.map((o) => o.position))].sort((a, b) => a - b);
  const labels = new Map();
  for (const obstacle of sorted) {
    labels.set(obstacle.id, `${steps.indexOf(obstacle.position) + 1}${obstacle.branch ?? ''}`);
  }
  return labels;
}

/** The next unused branch letter for a step, starting at "A". */
export function nextBranchLabel(obstacles, position) {
  const used = new Set(
    Object.values(obstacles ?? {})
      .filter((o) => o.position === position)
      .map((o) => (o.branch ?? '').toUpperCase()),
  );
  // An unbranched obstacle becomes "A" when the step first forks.
  for (let i = 0; i < 26; i += 1) {
    const letter = String.fromCharCode(65 + i);
    if (!used.has(letter)) return letter;
  }
  return '';
}

/** Distinct step positions in play order. */
export function stepsOf(obstacles) {
  return [...new Set(Object.values(obstacles ?? {}).map((o) => o.position))].sort((a, b) => a - b);
}

/** The obstacles that make up one step: one, or several alternatives. */
export function branchesAt(obstacles, position) {
  return Object.values(obstacles ?? {})
    .filter((o) => o.position === position)
    .sort((a, b) => (a.branch ?? '').localeCompare(b.branch ?? ''));
}

/** The position of the step after this one, or null if this is the last. */
export function nextStepPosition(obstacles, position) {
  const steps = stepsOf(obstacles);
  const index = steps.indexOf(position);
  return index === -1 || index === steps.length - 1 ? null : steps[index + 1];
}

/**
 * Where an obstacle's approaches can lead.
 *
 * Routing always points at the *next* step, never the current one: you cannot
 * be routed into the step you are already standing on. On the last step every
 * approach ends the chase, so there is nothing to choose.
 */
export function routeTargetsFor(obstacles, position) {
  const next = nextStepPosition(obstacles, position);
  if (next === null) return { endsChase: true, targets: [] };
  const siblings = branchesAt(obstacles, next);
  const steps = stepsOf(obstacles);
  const stepNumber = steps.indexOf(next) + 1;
  return {
    endsChase: false,
    // A single unbranched next step needs no choice; everything leads there.
    forked: siblings.length > 1,
    targets: siblings.map((o) => ({
      value: o.branch ?? '',
      label: `${stepNumber}${o.branch ?? ''}`,
      name: o.name,
    })),
  };
}

/**
 * Approaches that lead nowhere: the next step forks, but this option does not
 * say which way it goes.
 */
export function unroutedOptions(obstacle, obstacles) {
  const route = routeTargetsFor(obstacles, obstacle.position);
  if (route.endsChase || !route.forked) return [];
  const valid = new Set(route.targets.map((t) => t.value));
  return Object.values(obstacle.skillOptions ?? {}).filter(
    (option) => !valid.has(option.leadsTo ?? ''),
  );
}

/** The obstacle at a step that a given participant actually faces. */
export function obstacleForParticipant(obstacles, position, branch) {
  const atStep = Object.values(obstacles ?? {}).filter((o) => o.position === position);
  if (atStep.length <= 1) return atStep[0] ?? null;
  const wanted = (branch ?? '').toUpperCase();
  return (
    atStep.find((o) => (o.branch ?? '').toUpperCase() === wanted) ??
    atStep.sort((a, b) => (a.branch ?? '').localeCompare(b.branch ?? ''))[0] ??
    null
  );
}

/** Wrap plain-typed premise text in paragraphs, leaving existing HTML alone. */
export function premiseToHTML(premise) {
  const text = String(premise ?? '').trim();
  if (!text) return '';
  if (/<[a-z][\s\S]*>/i.test(text)) return text;
  return text
    .split(/\n{2,}/)
    .map((para) => `<p>${para.replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/** Next free sort position in an id-keyed map. */
export function nextPosition(record) {
  const values = Object.values(record ?? {});
  return values.length ? Math.max(...values.map((v) => v.position ?? 0)) + 1 : 0;
}

/** PF2e level-based DC, clamped to the published table. */
export function levelDC(level) {
  const index = Math.clamp(Math.round(level ?? 1), 0, LEVEL_DCS.length - 1);
  return LEVEL_DCS[index];
}

/**
 * The DC for one skill option: the GM's base DC shifted by the adjustment the
 * model chose. The GM owns the anchor; the model only moves relative to it.
 */
export function dcFromBase(baseDC, adjustment) {
  return Math.round(baseDC ?? 0) + (DC_ADJUSTMENTS[adjustment] ?? 0);
}

/**
 * Build the `overcome` HTML for an obstacle from the generator's structured
 * skill options. Composing the PF2e inline-check syntax here rather than asking
 * the model to emit it keeps the links from breaking on a bad token.
 */
export function buildSkillOptions(obstacle, baseDC) {
  const record = {};
  (obstacle.skillOptions ?? []).forEach((option, index) => {
    const id = foundry.utils.randomID();
    const isLore = option.skill === 'lore' && option.loreName;
    record[id] = {
      id,
      position: index,
      slug: isLore ? loreSlug(option.loreName) : option.skill,
      label: isLore ? `${option.loreName} Lore` : capitalize(option.skill),
      dc: dcFromBase(baseDC, option.dcAdjustment),
      description: String(option.description ?? ''),
      leadsTo: String(option.leadsTo ?? '').toUpperCase(),
    };
  });
  return record;
}

export function buildOvercomeHTML(obstacle, baseDC) {
  const parts = [];
  if (obstacle.description) parts.push(`<p>${escapeHTML(obstacle.description)}</p>`);

  const options = obstacle.skillOptions ?? [];
  if (options.length) {
    const items = options.map((option) => {
      const dc = dcFromBase(baseDC, option.dcAdjustment);
      const isLore = option.skill === 'lore' && option.loreName;
      // PF2e registers lore statistics under a "-lore" suffixed slug.
      const slug = isLore ? loreSlug(option.loreName) : option.skill;
      const label = isLore ? `${option.loreName} Lore` : capitalize(option.skill);
      const check = `@Check[type:${slug}|dc:${dc}]{${label}}`;
      // Make the consequence of the choice legible in the prose too, not just
      // in the roll picker, since the overcome text is what gets read aloud.
      const route = option.leadsTo
        ? ` <em>${game.i18n.format('PFAI.Chase.LeadsToRoute', { branch: String(option.leadsTo).toUpperCase() })}</em>`
        : '';
      return `<li>${check} &mdash; ${escapeHTML(option.description ?? '')}${route}</li>`;
    });
    parts.push(`<ul>${items.join('')}</ul>`);
  }

  if (obstacle.criticalSuccess) {
    parts.push(
      `<p><strong>${game.i18n.localize('PFAI.Chase.CriticalSuccess')}</strong> ${escapeHTML(obstacle.criticalSuccess)}</p>`,
    );
  }
  if (obstacle.failure) {
    parts.push(
      `<p><strong>${game.i18n.localize('PFAI.Chase.Failure')}</strong> ${escapeHTML(obstacle.failure)}</p>`,
    );
  }
  return parts.join('');
}

/** Enrich stored HTML for display (inline checks, UUID links, rolls). */
export async function enrich(html, { secrets = false } = {}) {
  if (!html) return '';
  const editor = foundry.applications.ux.TextEditor.implementation;
  return editor.enrichHTML(html, { secrets, async: true });
}

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

/** PF2e lore statistic slug, e.g. "Sailing" -> "sailing-lore". */
export function loreSlug(name) {
  const slug = slugify(name);
  return slug.endsWith('-lore') ? slug : `${slug}-lore`;
}

export function slugify(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function capitalize(value) {
  const str = String(value ?? '');
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Chase point goal for one obstacle, as published (GM Core, Chases).
 *
 * "Half the obstacles require 1 point fewer than the number of party members,
 * and half require 2 points fewer (with a minimum of 1 Chase Point per
 * obstacle)." Alternating by position is what makes it half and half.
 *
 * @param {number} partySize
 * @param {number} index 0-based position of the obstacle in the chase
 */
export function chasePointGoal(partySize, index) {
  const size = Math.max(1, Math.round(partySize || 1));
  const reduction = Math.abs(Math.trunc(index ?? 0)) % 2 === 0 ? 1 : 2;
  return Math.max(1, size - reduction);
}

/** Number of player characters in the active party, for sizing goals. */
export function guessPartySize() {
  const party = game.actors.find((a) => a.type === 'party' && a.active);
  const members = party?.members?.filter((m) => m?.type === 'character') ?? [];
  if (members.length) return members.length;
  const owned = game.actors.filter((a) => a.type === 'character' && a.hasPlayerOwner);
  return Math.max(1, owned.length || 4);
}

/** Chase points earned by a PF2e degree of success (0 crit fail - 3 crit success). */
export function chasePointsForDegree(degree) {
  switch (degree) {
    case 3:
      return 2;
    case 2:
      return 1;
    case 0:
      return -1;
    default:
      return 0;
  }
}

/** Suggested base DC for the active party, used to pre-fill the dialog. */
export function suggestedBaseDC() {
  return levelDC(guessPartyLevel());
}

/**
 * Flatten stored HTML to plain prose suitable for a prompt, unwrapping PF2e
 * inline syntax so `@Check[type:athletics|dc:20]{Athletics}` reads as
 * "Athletics" rather than leaking raw markup into the model's context.
 */
export function htmlToPromptText(html) {
  if (!html) return '';
  const unwrapped = String(html)
    // @Check[...]{Label} / @UUID[...]{Label} -> Label
    .replace(/@\w+\[[^\]]*\]\{([^}]*)\}/g, '$1')
    // Bare @Check[...] with no label -> drop it entirely.
    .replace(/@\w+\[[^\]]*\]/g, '')
    .replace(/<\/(p|li|h\d)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n');

  const div = document.createElement('div');
  div.innerHTML = unwrapped;
  return (div.textContent ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

/** Best guess at the party's level, used as context for the model. */
export function guessPartyLevel() {
  const party = game.actors.find((a) => a.type === 'party' && a.active);
  const members = party?.members?.filter((m) => m?.type === 'character') ?? [];
  if (!members.length) return 1;
  const total = members.reduce((acc, m) => acc + (m.system?.details?.level?.value ?? 1), 0);
  return Math.max(1, Math.round(total / members.length));
}
