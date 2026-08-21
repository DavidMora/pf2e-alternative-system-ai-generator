/**
 * Adversarial parity audit.
 *
 * Asserts that every subsystem offers every capability, rather than trusting
 * that whoever added the newest one remembered all of them. Prints a matrix so
 * a gap is visible at a glance instead of buried in a pass/fail.
 *
 * A capability is declared with a predicate over the rendered GM view. Where a
 * subsystem genuinely cannot have one, it must say so explicitly with a reason —
 * silence is treated as a gap.
 */
import { CONTEXTS, prepareHandlebars } from './fixtures.mjs';

const view = prepareHandlebars();
const SUBSYSTEMS = ['chase', 'influence', 'research', 'infiltration', 'leadership'];

const has = (out, action) => out.includes(`data-action="${action}"`);
const countOf = (out, action) => (out.match(new RegExp(`data-action="${action}"`, 'g')) ?? []).length;

/**
 * @typedef {object} Capability
 * @property {string} name
 * @property {(out: string) => boolean} check  run against the GM view
 * @property {Record<string, string>} [waived] subsystem -> why it cannot apply
 */

/** @type {Capability[]} */
const CAPABILITIES = [
  // --- event-level operations -------------------------------------------
  { name: 'Preview as player', check: (o) => has(o, 'togglePlayerPreview') },
  { name: 'Show to players', check: (o) => has(o, 'showToPlayers') },
  { name: 'Hide / reveal event', check: (o) => has(o, 'toggleHidden') },
  { name: 'Export', check: (o) => has(o, 'exportEvent') },
  { name: 'Rename', check: (o) => has(o, 'editTitle') },
  { name: 'Start / pause', check: (o) => has(o, 'toggleStarted') },
  {
    name: 'Delete event',
    // Derived from the key so adding a subsystem cannot leave this behind.
    check: (o, key) => has(o, `delete${key[0].toUpperCase()}${key.slice(1)}`),
  },

  // --- rounds ------------------------------------------------------------
  {
    name: 'Next round',
    check: (o) => /data-action="(nextRound|influenceNextRound|researchNextRound|infiltrationNextRound)"/.test(o),
    waived: { leadership: 'the published subsystem runs in downtime, not rounds' },
  },
  {
    name: 'Adjust round',
    check: (o) => /data-action="(roundDelta|influenceRoundDelta|researchRoundDelta|infiltrationRoundDelta)"/.test(o),
    waived: { leadership: 'the published subsystem runs in downtime, not rounds' },
  },

  // --- prose ------------------------------------------------------------
  {
    name: 'Edit premise / situation',
    check: (o) => /data-action="editText"[^>]*data-field="premise"/.test(o),
  },
  {
    name: 'Edit GM notes',
    check: (o) => /data-action="editText"[^>]*data-field="gmNotes"/.test(o),
  },
  {
    name: 'Edit goal',
    check: (o) => /data-action="editText"[^>]*data-field="goal"/.test(o),
    waived: { chase: 'a chase has no separate goal; the premise carries it' },
  },

  // --- content authoring -------------------------------------------------
  {
    name: 'Add entry (blank)',
    check: (o) =>
      /data-action="(addObstacle|addApproach|addSource|addCheck|addObjective|addInfiltrationObstacle|addThreshold|addFinding|addComplication|addTrait|addBreakpoint|addLieutenant|addLeadershipEvent)"/.test(o),
  },
  {
    name: 'Add entry (AI)',
    check: (o) =>
      /data-action="(generateOneObstacle|generateApproach|generateSource|generateInfiltrationObstacle|generateLeadershipEvent)"/.test(o),
  },
  {
    name: 'Edit entry',
    check: (o) =>
      /data-action="(editObstacle|editApproach|editSource|editCheck|editObjective|editInfiltrationObstacle|editThreshold|editFinding|editComplication|editTrait|editBreakpoint|editLieutenant|editLeadershipEvent)"/.test(o),
  },
  {
    name: 'Delete entry',
    check: (o) =>
      /data-action="(deleteObstacle|deleteApproach|deleteSource|deleteCheck|deleteObjective|deleteInfiltrationObstacle|deleteThreshold|deleteFinding|deleteComplication|deleteTrait|deleteBreakpoint|deleteLieutenant|deleteLeadershipEvent)"/.test(o),
  },
  {
    name: 'Reveal / conceal entry',
    check: (o) =>
      /data-action="(toggleObstacleLock|toggleReveal|toggleResearchReveal|toggleInfiltrationReveal|toggleLeadershipReveal)"/.test(o),
  },

  // --- play --------------------------------------------------------------
  {
    name: 'Roll from participant row',
    check: (o) => /data-action="(rollCheck|rollInfluence|rollResearch|rollInfiltration|rollLeadership)"/.test(o),
  },
  {
    name: 'Roll picker populated',
    check: (o) => (o.match(/<option value="[^"]+"/g) ?? []).length > 0,
  },
  {
    name: 'Adjust points',
    check: (o) =>
      /data-action="(chasePointDelta|influencePointDelta|researchPointDelta|awarenessDelta|orgLevelDelta)"/.test(o),
  },
  {
    name: 'Award points to a participant',
    check: (o) => /data-action="(awardContribution|awardInfluence|awardResearch)"/.test(o),
    waived: {
      infiltration:
        'edge points are the published way to help a character here, and spendEdge covers it',
      leadership: 'there is no point track to award from; the GM settles an event directly',
    },
  },
  { name: 'Contribution tally shown', check: (o) => o.includes('pfai-tally') },

  // --- participants ------------------------------------------------------
  { name: 'Add participants', check: (o) => has(o, 'addParticipants') },
  {
    name: 'Drag-and-drop target',
    check: (o) => o.includes('pfai-dropzone'),
  },
  {
    // Named for what it actually proves. It used to read "Drop target wired",
    // and passed for every subsystem during the whole period when nothing was
    // listening for a drop at all - the ids were there, the handler was not.
    // check-imports guards the listener; this guards the ids it reads.
    name: 'Drop target carries its ids',
    check: (o) => {
      const start = o.indexOf('pfai-dropzone');
      if (start === -1) return false;
      const open = o.lastIndexOf('<div', start);
      const tag = o.slice(open, o.indexOf('>', start) + 1);
      return /data-subsystem="/.test(tag) && /data-event-id="/.test(tag);
    },
  },
  {
    name: 'Drop hint inside target',
    check: (o) => {
      const start = o.indexOf('pfai-dropzone');
      if (start === -1) return false;
      const open = o.lastIndexOf('<div', start);
      let depth = 0;
      const tag = /<\/?div\b/g;
      tag.lastIndex = open;
      let m;
      while ((m = tag.exec(o))) {
        depth += m[0] === '<div' ? 1 : -1;
        if (depth === 0) return o.slice(open, m.index).includes('pfai-drop-hint');
      }
      return false;
    },
    // The hint only renders on an empty roster; fixtures have participants.
    emptyRoster: true,
  },
  { name: 'Remove participant', check: (o) => has(o, 'removeParticipant') },
  { name: 'Toggle acted', check: (o) => has(o, 'toggleActed') },

  // --- artwork and settings ----------------------------------------------
  // Both of these were missing everywhere but chases until this audit found
  // them, which is exactly what the matrix is for.
  { name: 'Generate artwork', check: (o) => has(o, 'generateImage') },
  { name: 'Edit event settings', check: (o) => has(o, 'editStats') },

  // --- explanation -------------------------------------------------------
  {
    name: 'Every section explained',
    check: (o) => {
      const headings = o.match(/<h3\b[\s\S]*?<\/h3>/g) ?? [];
      return headings.length > 0 && headings.every((h) => h.includes('pfai-info'));
    },
  },
  {
    name: 'Status numbers explained',
    check: (o) => {
      const status = o.match(/<section class="pfai-status"[\s\S]*?<\/section>/);
      return Boolean(status) && status[0].includes('pfai-info');
    },
  },
];

/**
 * Capabilities that live on a subsystem's list view rather than its detail
 * view: generating a new event, and importing one.
 */
const LIST_CAPABILITIES = [
  {
    name: 'Generate a new event (AI)',
    check: (o, key) =>
      // Chases own the bare "generate"; everything else is generate<Key>.
      has(o, key === 'chase' ? 'generate' : `generate${key[0].toUpperCase()}${key.slice(1)}`),
  },
  { name: 'Import an event', check: (o) => has(o, 'importEvent') },
  {
    // Chases had this from the start and nothing noticed the other four did
    // not: a GM whose generation failed could not start an event by hand.
    name: 'Create a blank event',
    check: (o, key) => new RegExp(`data-action="createBlank" data-subsystem="${key}"`).test(o),
  },
];

/** Render a subsystem's list view: same context with nothing selected. */
function listView(key) {
  const ctx = CONTEXTS[key](true);
  return view({
    ...ctx,
    selected: null,
    selectedInfluence: null,
    selectedResearch: null,
    selectedInfiltration: null,
    selectedLeadership: null,
  });
}

/** Render with an emptied roster, for capabilities that only show there. */
function emptyRosterView(key) {
  const ctx = CONTEXTS[key](true);
  const detail =
    ctx.selected ?? ctx.selectedInfluence ?? ctx.selectedResearch ?? ctx.selectedInfiltration ??
    ctx.selectedLeadership;
  const emptied = { ...detail, participants: [] };
  return view({
    ...ctx,
    ...(ctx.selected ? { selected: emptied } : {}),
    ...(ctx.selectedInfluence ? { selectedInfluence: emptied } : {}),
    ...(ctx.selectedResearch ? { selectedResearch: emptied } : {}),
    ...(ctx.selectedInfiltration ? { selectedInfiltration: emptied } : {}),
    ...(ctx.selectedLeadership ? { selectedLeadership: emptied } : {}),
  });
}

const gmViews = Object.fromEntries(SUBSYSTEMS.map((k) => [k, view(CONTEXTS[k](true))]));
const emptyViews = Object.fromEntries(SUBSYSTEMS.map((k) => [k, emptyRosterView(k)]));
const playerViews = Object.fromEntries(SUBSYSTEMS.map((k) => [k, view(CONTEXTS[k](false))]));

let failed = 0;
const rows = [];

for (const capability of CAPABILITIES) {
  const cells = {};
  for (const key of SUBSYSTEMS) {
    if (capability.waived?.[key]) {
      cells[key] = 'n/a';
      continue;
    }
    const out = capability.emptyRoster ? emptyViews[key] : gmViews[key];
    const ok = capability.check(out, key);
    cells[key] = ok ? 'yes' : 'NO';
    if (!ok) {
      failed = 1;
      console.error(`GAP  ${key} is missing: ${capability.name}`);
    }
  }
  rows.push({ name: capability.name, ...cells });
}

const listViews = Object.fromEntries(SUBSYSTEMS.map((k) => [k, listView(k)]));

for (const capability of LIST_CAPABILITIES) {
  const cells = {};
  for (const key of SUBSYSTEMS) {
    const ok = capability.check(listViews[key], key);
    cells[key] = ok ? 'yes' : 'NO';
    if (!ok) {
      failed = 1;
      console.error(`GAP  ${key} list view is missing: ${capability.name}`);
    }
  }
  rows.push({ name: capability.name, ...cells });
}

// An info icon with no tooltip explains nothing.
for (const key of SUBSYSTEMS) {
  const icons = gmViews[key].match(/<i class="fa-solid fa-circle-info pfai-info"[^>]*>/g) ?? [];
  const empty = icons.filter((i) => !/data-tooltip="[^"]{10,}"/.test(i));
  if (empty.length) {
    failed = 1;
    console.error(`EMPTY ${key} has ${empty.length} info icon(s) with no usable tooltip`);
  }
}

/*
 * Nothing a GM authors may reach a player. Listed exhaustively rather than by
 * pattern so a newly added action is not silently exempt.
 */
const GM_ONLY = [
  'showToPlayers', 'toggleHidden', 'exportEvent', 'editTitle', 'toggleStarted', 'editText',
  'editStats', 'addObstacle', 'addApproach', 'addSource', 'addCheck', 'addObjective',
  'addInfiltrationObstacle', 'addThreshold', 'addFinding', 'addComplication', 'addTrait',
  'addBreakpoint', 'generateOneObstacle', 'generateApproach', 'generateSource',
  'generateInfiltrationObstacle', 'editObstacle', 'editApproach', 'editSource', 'editCheck',
  'editObjective', 'editInfiltrationObstacle', 'editThreshold', 'editFinding', 'editComplication',
  'editTrait', 'editBreakpoint', 'deleteObstacle', 'deleteApproach', 'deleteSource', 'deleteCheck',
  'deleteObjective', 'deleteInfiltrationObstacle', 'deleteThreshold', 'deleteFinding',
  'deleteComplication', 'deleteTrait', 'deleteBreakpoint', 'toggleObstacleLock', 'toggleReveal',
  'toggleResearchReveal', 'toggleInfiltrationReveal', 'toggleModifierUsed', 'toggleEventActive',
  'toggleComplicationResolved', 'togglePreparationUsed', 'removeParticipant', 'toggleActed',
  'addParticipants', 'awardContribution', 'awardInfluence', 'awardResearch', 'spendEdge',
  'chasePointDelta', 'influencePointDelta', 'researchPointDelta', 'awarenessDelta', 'edgeDelta',
  'setActiveObstacle', 'addBranch', 'generateBranch', 'regenerateObstacle',
  'generateImage', 'clearImage', 'editStats', 'generate', 'generateInfluence',
  'generateResearch', 'generateInfiltration', 'importEvent',
  'generateLeadership', 'orgLevelDelta', 'toggleLeadershipReveal', 'toggleEventResolved',
  'addLieutenant', 'editLieutenant', 'deleteLieutenant', 'addLeadershipEvent',
  'generateLeadershipEvent', 'editLeadershipEvent', 'deleteLeadershipEvent',
];

for (const key of SUBSYSTEMS) {
  const leaked = GM_ONLY.filter((action) => has(playerViews[key], action));
  if (leaked.length) {
    failed = 1;
    console.error(`LEAK ${key} exposes to players: ${leaked.join(', ')}`);
  }
}

// Shared buttons must name the subsystem they act on, or they default to chases.
for (const key of SUBSYSTEMS) {
  const shared = ['showToPlayers', 'toggleHidden', 'exportEvent', 'editTitle', 'toggleStarted'];
  const pattern = new RegExp(`<[^>]*data-action="(?:${shared.join('|')})"[^>]*>`, 'g');
  for (const tag of gmViews[key].match(pattern) ?? []) {
    if (!new RegExp(`data-subsystem="${key}"`).test(tag) || !/data-event-id="/.test(tag)) {
      failed = 1;
      console.error(`WIRE ${key} shared action not addressed: ${tag.slice(0, 90)}`);
    }
  }
}

// --- report ------------------------------------------------------------
const width = Math.max(...rows.map((r) => r.name.length));
// Waivers must be readable, not just counted.
const waivers = CAPABILITIES.flatMap((c) =>
  Object.entries(c.waived ?? {}).map(([key, why]) => `  ${key}: ${c.name} — ${why}`),
);
console.log('');
console.log(`${'CAPABILITY'.padEnd(width)}  ${SUBSYSTEMS.map((s) => s.padEnd(14)).join('')}`);
console.log('-'.repeat(width + 2 + SUBSYSTEMS.length * 14));
for (const row of rows) {
  const cells = SUBSYSTEMS.map((s) => (row[s] === 'NO' ? 'NO  <<<' : row[s]).padEnd(14)).join('');
  console.log(`${row.name.padEnd(width)}  ${cells}`);
}
if (waivers.length) {
  console.log('Deliberately not applicable:');
  for (const line of waivers) console.log(line);
}
console.log('');
console.log(
  failed
    ? 'PARITY AUDIT FAILED — see the gaps above'
    : `ok  ${CAPABILITIES.length + LIST_CAPABILITIES.length} capabilities present across ${SUBSYSTEMS.length} subsystems, nothing leaked to players`,
);

process.exit(failed);
