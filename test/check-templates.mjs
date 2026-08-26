import Handlebars from 'handlebars';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = process.argv[2] ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates');
let failed = 0;

// Foundry-provided helpers the templates rely on.
Handlebars.registerHelper('localize', (k) => String(k));
Handlebars.registerHelper('pfaiEq', (a, b) => a === b);
Handlebars.registerHelper('pfaiAdd', (a, b) => Number(a) + Number(b));
Handlebars.registerHelper('pfaiOr', (...a) => a.slice(0, -1).some(Boolean));
Handlebars.registerHelper('pfaiSubtract', (a, b) => Number(a) - Number(b));

/*
 * Partials must be registered before the templates that use them compile.
 *
 * Read from the directory rather than listed by hand: the hand-written list
 * silently fell two behind when leadership and victory were added, which is the
 * kind of gap that looks like coverage until someone checks.
 */
const partialsDir = path.join(dir, 'partials');
for (const file of readdirSync(partialsDir).filter((f) => f.endsWith('.hbs'))) {
  // influence-detail.hbs -> pfaiInfluenceDetail
  const name = `pfai${file
    .replace('.hbs', '')
    .split('-')
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join('')}`;
  Handlebars.registerPartial(name, readFileSync(path.join(partialsDir, file), 'utf8'));
}
Handlebars.registerHelper('pfaiLt', (a, b) => Number(a) < Number(b));

for (const file of readdirSync(dir).filter((f) => f.endsWith('.hbs'))) {
  const src = readFileSync(path.join(dir, file), 'utf8');
  try {
    const tpl = Handlebars.compile(src, { strict: false });
    // Render against both an empty context and a fully populated one.
    tpl({});
    console.log(`compiled + rendered empty: ${file}`);
  } catch (error) {
    failed = 1;
    console.error(`FAILED ${file}: ${error.message}`);
  }
}

// Render the view with realistic data in both branches and both roles.
const viewSrc = readFileSync(path.join(dir, 'subsystem-view.hbs'), 'utf8');
const view = Handlebars.compile(viewSrc);
const selected = {
  id: 'abc', name: 'Rooftop Run', baseDC: 20, level: 5, hidden: true, started: false,
  rounds: { current: 2, max: 6 }, complete: false, outOfTime: false,
  ai: { generated: true, model: 'gpt-5.6-terra' }, generatedAt: '2026-08-19',
  enrichedPremise: '<p>Go</p>', enrichedGmNotes: '<p>Secret</p>',
  obstacles: [{ id: 'o1', number: 1, name: 'Gap', locked: false, cleared: false, percent: 50,
                chasePoints: { current: 1, goal: 2 }, enrichedOvercome: '<ul><li>x</li></ul>' }],
  currentObstacle: { id: 'o1', number: 1, name: 'Gap', locked: false, cleared: false, percent: 50, isLive: true,
                     canPrev: false, canNext: true, chasePoints: { current: 1, goal: 2 },
                     rounds: { current: 1, max: 3 }, outOfRounds: false,
                     enrichedOvercome: '<ul><li>x</li></ul>' },
  rollOptions: [{ id: 'so1', label: 'Athletics', dc: 18 }, { id: 'so2', label: 'Stealth', dc: 20 }],
  hasRollOptions: true,
  obstacleDots: [{ index: 0, number: 1, active: true, cleared: false, locked: false },
                 { index: 1, number: 2, active: false, cleared: false, locked: true }],
  obstacleTotal: 2, obstaclePosition: 1, canGenerate: true, generatingObstacle: false,
  branchOptions: [{ value: 'A', label: '2A', name: 'Rooftops' }, { value: 'B', label: '2B', name: 'Sewers' }],
  hasBranches: true,
  liveObstacle: { id: 'o1', number: 1, name: 'Gap', current: 1, goal: 2, percent: 50, cleared: false, offscreen: false },
  img: 'worlds/w/art.png', activeObstacle: 'o1',
  participants: [],
  contributionTotal: 6,
};
// A GM may roll for anyone (including someone who has acted) and award points;
// a player may only roll their own un-acted participant.
const SKILLS = [{ id: 'so1', label: 'Athletics', dc: 18 }, { id: 'so2', label: 'Stealth', dc: 20 }];
// Two forks at this step, so branch pickers and per-fork roll targets are exercised.
const BRANCHES = [{ value: 'A', label: '2A', name: 'Rooftops' }, { value: 'B', label: '2B', name: 'Sewers' }];
const branchChoices = (active) => BRANCHES.map((b) => ({ ...b, active: b.value === active }));

const participantsFor = (isGM) => [
  { id: 'p1', name: 'Kyra', img: 'a.png', obstacle: 1, hasActed: false, owned: true, canRoll: true,
    isReroll: false, canAward: isGM, canPass: true, rollObstacleId: 'o1', rollOptions: SKILLS,
    branchLabel: 'A', branchChoices: branchChoices('A'),
    contributedHere: 2, contributedTotal: 5, rollCount: 4, successCount: 3, hasContributed: true },
  { id: 'p2', name: 'Merisiel', img: 'b.png', obstacle: 1, hasActed: false, owned: isGM, canRoll: isGM,
    isReroll: false, canAward: isGM, canPass: isGM, rollObstacleId: 'o2', rollOptions: SKILLS,
    branchLabel: 'B', branchChoices: branchChoices('B'),
    contributedHere: 1, contributedTotal: 1, rollCount: 2, successCount: 1, hasContributed: true },
  { id: 'p3', name: 'Ezren', img: 'c.png', obstacle: 1, hasActed: true, owned: true, canRoll: isGM,
    isReroll: isGM, canAward: isGM, canPass: isGM, rollObstacleId: 'o1', rollOptions: SKILLS,
    branchLabel: 'A', branchChoices: branchChoices('A'),
    contributedHere: 0, contributedTotal: 0, rollCount: 0, successCount: 0, hasContributed: false },
];

for (const isGM of [true, false]) {
  selected.participants = participantsFor(isGM);
  const listOut = view({ isGM, isRealGM: isGM, previewAsPlayer: false, chases: [{ id: 'abc', name: 'Rooftop Run', baseDC: 20, hidden: true, started: true, obstacleCount: 4, ai: { generated: true } }], selected: null });
  const detailOut = view({ isGM, isRealGM: isGM, previewAsPlayer: false, chases: [], selected });
  // Spot-check that GM-gating actually removed GM controls for players.
  const hasDelete = detailOut.includes('data-action="deleteChase"');
  const hasGmNotes = detailOut.includes('Secret');
  const hasTitleEdit = detailOut.includes('data-action="editTitle"');
  const hasGenObstacles = detailOut.includes('data-action="generateObstacles"');
  if (isGM !== hasTitleEdit || isGM !== hasGenObstacles) { failed = 1; console.error('  GM-only generation/rename controls leaked to players'); }

  // Carousel: exactly one obstacle rendered, and navigation is GM-only.
  const obstacleCards = (detailOut.match(/class="pfai-obstacle /g) ?? []).length;
  const hasCarouselNav = detailOut.includes('data-action="obstacleJump"');
  const hasAddOne = detailOut.includes('data-action="generateOneObstacle"');
  if (obstacleCards !== 1) { failed = 1; console.error(`  expected exactly 1 obstacle card, got ${obstacleCards}`); }
  if (isGM !== hasCarouselNav) { failed = 1; console.error('  carousel navigation visibility wrong'); }
  if (isGM !== hasAddOne) { failed = 1; console.error('  add-obstacle button visibility wrong'); }
  // Image and active-obstacle controls are GM-only too.
  const hasImgBtn = detailOut.includes('data-action="generateImage"');
  const hasSetActive = detailOut.includes('data-action="setActiveObstacle"');
  if (isGM !== hasImgBtn) { failed = 1; console.error('  image button visibility wrong'); }
  if (isGM !== hasSetActive) { failed = 1; console.error('  set-active button visibility wrong'); }
  // Roll controls appear only for participants the viewer owns and who have not acted.
  const rollButtons = (detailOut.match(/data-action="rollCheck"/g) ?? []).length;
  const notYours = detailOut.includes('PFAI.Roll.NotYours');
  const acted = detailOut.includes('pfai-acted-mark');
  // GM: all three rollable. Player: only their own un-acted one.
  const expectedRollButtons = isGM ? 3 : 1;
  if (rollButtons !== expectedRollButtons) { failed = 1; console.error(`  expected ${expectedRollButtons} roll buttons, got ${rollButtons}`); }

  // Award controls are GM-only: two per participant (minus and plus).
  const awardButtons = (detailOut.match(/data-action="awardContribution"/g) ?? []).length;
  const expectedAward = isGM ? 6 : 0;
  if (awardButtons !== expectedAward) { failed = 1; console.error(`  expected ${expectedAward} award buttons, got ${awardButtons}`); }

  // The acted participant must still be labelled acted even when a GM can re-roll.
  const rerollLabelled = detailOut.includes('pfai-reroll') && detailOut.includes('PFAI.Roll.RerollHint');
  if (isGM !== rerollLabelled) { failed = 1; console.error('  re-roll labelling wrong'); }
  // The status bar must mirror the live obstacle, and must not invent a chase-wide total.
  const liveReadout = detailOut.includes('pfai-live-obstacle');
  if (!liveReadout) { failed = 1; console.error('  live obstacle readout missing from status bar'); }
  console.log(`  status: liveObstacle=${liveReadout}`);

  // Pass is available to whoever may act; branch switching is GM-only.
  const passButtons = (detailOut.match(/data-action="passTurn"/g) ?? []).length;
  const branchButtons = (detailOut.match(/data-action="setParticipantBranch"/g) ?? []).length;
  const branchTags = (detailOut.match(/class="pfai-branch is-active"/g) ?? []).length;
  const expectedPass = isGM ? 3 : 1;
  const expectedBranchButtons = isGM ? 6 : 0;
  if (passButtons !== expectedPass) { failed = 1; console.error(`  expected ${expectedPass} pass buttons, got ${passButtons}`); }
  if (branchButtons !== expectedBranchButtons) { failed = 1; console.error(`  expected ${expectedBranchButtons} branch buttons, got ${branchButtons}`); }
  // Every action button must carry the ids its handler reads, or it silently no-ops.
  for (const [action, attrs] of [
    ['setParticipantBranch', ['chase-id', 'participant-id', 'branch']],
    ['passTurn', ['chase-id', 'obstacle-id', 'participant-id']],
    ['rollCheck', ['chase-id', 'obstacle-id', 'participant-id']],
    ['awardContribution', ['chase-id', 'obstacle-id', 'participant-id', 'delta']],
  ]) {
    const tags = detailOut.match(new RegExp(`<[^>]*data-action="${action}"[^>]*>`, 'g')) ?? [];
    for (const tag of tags) {
      const missing = attrs.filter((a) => !new RegExp(`data-${a}="[^"]+"`).test(tag));
      if (missing.length) { failed = 1; console.error(`  ${action} button missing ${missing.join(', ')}`); }
    }
  }
  // A player still needs to see which fork they are on, just not change it.
  if (!isGM && branchTags !== 3) { failed = 1; console.error(`  player should see 3 branch tags, got ${branchTags}`); }
  // Each participant rolls against their own fork, not the obstacle on screen.
  const targetsOwnFork = detailOut.includes('data-obstacle-id="o2"');
  if (isGM && !targetsOwnFork) { failed = 1; console.error('  roll target does not follow the participant fork'); }
  console.log(`  branching: pass=${passButtons} branchBtns=${branchButtons} tags=${branchTags} perForkTarget=${targetsOwnFork}`);
  console.log(`  gm-control: rolls=${rollButtons} award=${awardButtons} reroll=${rerollLabelled}`);
  if (!isGM && !notYours) { failed = 1; console.error('  unowned participant not marked for player'); }
  if (isGM && notYours) { failed = 1; console.error('  "not yours" must never show to a GM'); }
  if (!acted) { failed = 1; console.error('  acted participant not marked'); }
  // The select must actually be populated, or Roll silently does nothing.
  const optionTags = (detailOut.match(/<option value="so\d"/g) ?? []).length;
  if (optionTags !== rollButtons * 2) { failed = 1; console.error(`  roll select empty or wrong: ${optionTags} options for ${rollButtons} button(s)`); }
  // Contribution must be visible to players, not gated behind isGM.
  const contribChips = (detailOut.match(/class="pfai-tally[ "]/g) ?? []).length;
  if (contribChips !== 3) { failed = 1; console.error(`  expected a contribution chip per participant, got ${contribChips}`); }
  if (!detailOut.includes('is-empty')) { failed = 1; console.error('  un-rolled participant not dimmed'); }
  // Rows are a subgrid: every participant must emit all five cells or the
  // columns go ragged, which is exactly what the old flex row did.
  for (const cell of ['pfai-p-who', 'pfai-p-points', 'pfai-p-at', 'pfai-p-turn', 'pfai-p-end']) {
    const count = (detailOut.match(new RegExp(`class="${cell}`, 'g')) ?? []).length;
    if (count !== 3) { failed = 1; console.error(`  expected 3 ${cell} cells, got ${count}`); }
  }
  console.log(`  contribution: chips=${contribChips} visibleToPlayers=${!isGM ? contribChips === 3 : 'n/a'}`);
  console.log(`  rolls: selectOptions=${optionTags} buttons=${rollButtons} notYours=${notYours} acted=${acted} obstacleRounds=${detailOut.includes('obstacleRoundDelta')}`);
  console.log(`  carousel: cards=${obstacleCards} nav=${hasCarouselNav} addOne=${hasAddOne} img=${hasImgBtn} setActive=${hasSetActive}`);
  console.log(`isGM=${isGM} list=${listOut.length}b detail=${detailOut.length}b deleteBtn=${hasDelete} gmNotes=${hasGmNotes} titleEdit=${hasTitleEdit} genObstacles=${hasGenObstacles}`);
  if (isGM !== hasDelete || isGM !== hasGmNotes) { failed = 1; console.error('  GM gating WRONG'); }
}
// The generate dialog must render in both modes.
const dlgSrc = readFileSync(path.join(dir, 'generate-chase-dialog.hbs'), 'utf8');
const dlg = Handlebars.compile(dlgSrc);
for (const obstaclesOnly of [false, true]) {
  const out = dlg({ hasApiKey: true, model: 'gpt-5.6-terra', obstaclesOnly, existingObstacles: obstaclesOnly ? 3 : 0,
                    premise: 'Chase the thief', title: 'Rooftop Run', baseDC: 20, language: 'en',
                    difficulties: [{ value: 'auto', label: 'Auto' }, { value: 'low', label: 'Low' }] });
  const hasRoundLimit = out.includes('name="roundLimit"');
  // Round limit is meaningless when only regenerating obstacles.
  if (obstaclesOnly === hasRoundLimit) { failed = 1; console.error(`  roundLimit visibility wrong for obstaclesOnly=${obstaclesOnly}`); }
  console.log(`dialog obstaclesOnly=${obstaclesOnly} premiseFilled=${out.includes('Chase the thief')} baseDC=${out.includes('value="20"')} roundLimit=${hasRoundLimit}`);
}

// Player preview must strip GM affordances even though the user IS a GM.
const previewOut = view({ isGM: false, isRealGM: true, previewAsPlayer: true, chases: [], selected });
const previewLeaks = ['deleteChase', 'setActiveObstacle', 'generateImage', 'obstacleJump']
  .filter((a) => previewOut.includes(`data-action="${a}"`));
if (previewLeaks.length) { failed = 1; console.error(`  preview leaked GM controls: ${previewLeaks}`); }
if (!previewOut.includes('data-action="togglePlayerPreview"')) { failed = 1; console.error('  no way to exit preview'); }
console.log(`preview-as-player: leaks=${previewLeaks.length} exitAvailable=true`);

// The image dialog renders for both targets.
const imgSrc = readFileSync(path.join(dir, 'generate-image-dialog.hbs'), 'utf8');
const imgTpl = Handlebars.compile(imgSrc);
for (const targetKind of ['chase', 'obstacle']) {
  const out = imgTpl({ hasApiKey: true, model: 'gpt-image-2', targetKind, targetName: 'The Gap',
    currentImage: '', referenceCount: 2,
    references: [{ src: 'a.png', label: 'Kyra' }, { src: 'b.png', label: 'Merisiel' }],
    sizes: [{ value: '1536x1024', label: 'Landscape', selected: true }],
    qualities: [{ value: 'auto', label: 'Auto', selected: true }] });
  const refs = (out.match(/class="pfai-reference"/g) ?? []).length;
  if (refs !== 2) { failed = 1; console.error(`  expected 2 reference chips, got ${refs}`); }
  console.log(`image dialog ${targetKind}: refs=${refs} context=${out.includes('name="context"')} size=${out.includes('name="size"')}`);
}

// The influence view must render in both roles without leaking GM content.
const INFLUENCE_ROLL_OPTIONS = [
  { id: 'd1', kind: 'discovery', label: 'Society', dc: 16, hidden: false },
  { id: 's1', kind: 'influence', label: 'Diplomacy', dc: 18, hidden: false },
];

const influenceCtx = (isGM) => ({
  isGM, isRealGM: isGM, previewAsPlayer: false, isInfluenceTab: true, isChaseTab: false,
  influences: [], chases: [],
  selectedInfluence: {
    id: 'i1', name: 'The Consul', hidden: false, influencePoints: 3, baseDC: 20,
    perception: 12, will: 14, rounds: { current: 1, max: 4 }, outOfTime: false,
    npc: { name: 'Consul Venn', disposition: 'guarded' },
    ai: { generated: true }, dcModifier: -2,
    enrichedPremise: '<p>A ball.</p>', enrichedGoal: '<p>Her vote.</p>',
    enrichedNpcDescription: '<p>A diplomat.</p>',
    enrichedNpcWants: '<p>SECRET-WANTS</p>',
    enrichedGmNotes: '<p>SECRET-NOTES</p>',
    discoveries: [{ id: 'd1', label: 'Society', dc: 18, effectiveDC: 16, description: 'Ask around.',
                    hidden: false, enrichedReveals: '<p>Her bias.</p>' }],
    influenceSkills: isGM
      ? [{ id: 's1', label: 'Diplomacy', dc: 20, effectiveDC: 18, description: 'Flatter.', hidden: false },
         { id: 's2', label: 'Deception', dc: 22, effectiveDC: 20, description: 'Lie.', hidden: true },
         // Locked until the encounter advances, which reads differently from
         // merely undiscovered.
         { id: 's3', label: 'Intimidation', dc: 24, effectiveDC: 22, description: 'Threaten.',
           hidden: true, revealAt: 6, lockedUntil: 6 }]
      : [{ id: 's1', label: 'Diplomacy', dc: 20, effectiveDC: 18, description: 'Flatter.', hidden: false }],
    thresholds: isGM
      ? [{ id: 't1', points: 2, name: 'Listens', reached: true, hidden: false, enrichedDescription: '<p>x</p>' },
         { id: 't2', points: 6, name: 'Votes', reached: false, hidden: true, enrichedDescription: '<p>y</p>' }]
      : [{ id: 't1', points: 2, name: 'Listens', reached: true, hidden: false, enrichedDescription: '<p>x</p>' }],
    nextThreshold: { id: 't2', points: 6, name: 'Votes' }, allThresholdsReached: false,
    weaknesses: [{ id: 'w1', name: 'Vanity', modifier: -5, used: true, hidden: false, enrichedDescription: '<p>z</p>' }],
    resistances: isGM
      ? [{ id: 'r1', name: 'Duty', modifier: 2, used: false, hidden: true, enrichedDescription: '<p>z</p>' }]
      : [],
    penalties: [],
    rollOptions: INFLUENCE_ROLL_OPTIONS,
    participants: [
      { id: 'p1', name: 'Kyra', img: 'a.png', hasActed: false, canRoll: true, owned: true, noActor: false,
        canAward: isGM, isReroll: false, rollOptions: INFLUENCE_ROLL_OPTIONS,
        contributedTotal: 2, successCount: 2, rollCount: 3, discoveryCount: 1, hasContributed: true },
      { id: 'p2', name: 'Seelah', img: 'b.png', hasActed: true, canRoll: isGM, owned: true, noActor: false,
        canAward: isGM, isReroll: isGM, rollOptions: INFLUENCE_ROLL_OPTIONS,
        contributedTotal: 0, successCount: 0, rollCount: 0, discoveryCount: 0, hasContributed: false },
    ],
    hiddenCounts: isGM ? { influenceSkills: 1, weaknesses: 0, resistances: 1, thresholds: 1 } : null,
  },
});

for (const isGM of [true, false]) {
  const out = view(influenceCtx(isGM));
  const leaks = ['SECRET-WANTS', 'SECRET-NOTES'].filter((t) => out.includes(t));
  if (isGM !== (leaks.length === 2)) { failed = 1; console.error(`  influence GM content leak: ${leaks}`); }

  const revealBtns = (out.match(/data-action="toggleReveal"/g) ?? []).length;
  const applyBtns = (out.match(/data-action="toggleModifierUsed"/g) ?? []).length;
  if (!isGM && (revealBtns || applyBtns)) { failed = 1; console.error('  influence GM controls leaked to player'); }
  if (isGM && !revealBtns) { failed = 1; console.error('  GM cannot reveal anything'); }

  // Rolling works exactly as in chases: one picker + Roll per able participant.
  // A GM may roll for anyone including someone who has acted; a player may not.
  const rollBtns = (out.match(/data-action="rollInfluence"/g) ?? []).length;
  const expectedRolls = isGM ? 2 : 1;
  if (rollBtns !== expectedRolls) { failed = 1; console.error(`  expected ${expectedRolls} influence roll buttons, got ${rollBtns}`); }

  // Each picker must be populated, and carry which list each option came from.
  const optionTags = (out.match(/<option value="[^"]*" data-kind="/g) ?? []).length;
  if (optionTags !== rollBtns * INFLUENCE_ROLL_OPTIONS.length) {
    failed = 1;
    console.error(`  influence picker wrong: ${optionTags} options for ${rollBtns} button(s)`);
  }

  // Award steppers are GM-only: two per participant.
  const awardBtns = (out.match(/data-action="awardInfluence"/g) ?? []).length;
  const expectedAward = isGM ? 4 : 0;
  if (awardBtns !== expectedAward) { failed = 1; console.error(`  expected ${expectedAward} influence award buttons, got ${awardBtns}`); }

  // The roster must emit the same cells as the chase one or the columns go ragged.
  for (const cell of ['pfai-p-who', 'pfai-p-points', 'pfai-p-turn', 'pfai-p-end']) {
    const count = (out.match(new RegExp(`class="${cell}`, 'g')) ?? []).length;
    if (count !== 2) { failed = 1; console.error(`  expected 2 ${cell} cells, got ${count}`); }
  }
  console.log(`  influence roster: rolls=${rollBtns} options=${optionTags} award=${awardBtns}`);

  console.log(`influence isGM=${isGM}: bytes=${out.length} reveal=${revealBtns} apply=${applyBtns} rolls=${rollBtns} gmProse=${leaks.length}`);
}

// The two subsystems must offer the same operations on an event, or the UI
// teaches one set of habits on one tab and another on the other.
{
  const chaseHeader = view({ isGM: true, isRealGM: true, previewAsPlayer: false, isChaseTab: true,
                             chases: [], selected });
  const influenceHeader = view(influenceCtx(true));
  const SHARED = ['togglePlayerPreview', 'showToPlayers', 'toggleHidden', 'exportEvent',
                  'editTitle', 'toggleStarted'];
  for (const action of SHARED) {
    const inChase = chaseHeader.includes(`data-action="${action}"`);
    const inInfluence = influenceHeader.includes(`data-action="${action}"`);
    if (!inChase || !inInfluence) {
      failed = 1;
      console.error(`  "${action}" present in chase=${inChase} influence=${inInfluence} - must be both`);
    }
  }
  // Shared actions must say which subsystem they act on, or they default to chases.
  for (const out of [chaseHeader, influenceHeader]) {
    for (const tag of out.match(/<[^>]*data-action="(?:showToPlayers|toggleHidden|exportEvent|editTitle|toggleStarted)"[^>]*>/g) ?? []) {
      if (!/data-subsystem="/.test(tag) || !/data-event-id="/.test(tag)) {
        failed = 1;
        console.error(`  shared action missing subsystem/event-id: ${tag.slice(0, 90)}`);
      }
    }
  }
  console.log(`shared-header: ${SHARED.length} operations present on both subsystems`);
}

// The text inviting a drop must be inside the element that accepts it, and an
// empty roster must still be a target - that exact mismatch made drag-and-drop
// silently impossible.
{
  /* Slice out the drop zone by balancing <div> tags; a plain regex stops at the
     first </div>, which closes the header row rather than the zone. */
  const emptyRoster = (ctx) => {
    const out = view(ctx);
    const start = out.indexOf('pfai-dropzone');
    if (start === -1) return { out, zone: '' };
    const open = out.lastIndexOf('<div', start);
    let depth = 0;
    const tag = /<\/?div\b/g;
    tag.lastIndex = open;
    let match;
    while ((match = tag.exec(out))) {
      depth += match[0] === '<div' ? 1 : -1;
      if (depth === 0) return { out, zone: out.slice(open, match.index) };
    }
    return { out, zone: out.slice(open) };
  };

  const chaseEmpty = { ...selected, participants: [] };
  for (const [label, ctx] of [
    ['chase', { isGM: true, isRealGM: true, previewAsPlayer: false, isChaseTab: true, chases: [], selected: chaseEmpty }],
    ['influence', { ...influenceCtx(true), selectedInfluence: { ...influenceCtx(true).selectedInfluence, participants: [] } }],
  ]) {
    const { out, zone } = emptyRoster(ctx);
    const hasZone = out.includes('pfai-dropzone');
    const hintInside = zone.includes('pfai-drop-hint');
    // "hasIds", not "wired": this only proves the markup carries what the drop
    // handler reads. Whether anything listens is check-imports' job.
    const hasIds = /data-subsystem="[^"]+"[^>]*data-event-id="/.test(zone) ||
                   /data-event-id="[^"]+"[^>]*data-subsystem="/.test(zone);
    if (!hasZone) { failed = 1; console.error(`  ${label}: no drop zone`); }
    if (!hintInside) { failed = 1; console.error(`  ${label}: drop hint is outside the drop zone`); }
    if (!hasIds) { failed = 1; console.error(`  ${label}: drop zone missing subsystem/event id`); }
    console.log(`dropzone ${label}: present=${hasZone} hintInside=${hintInside} hasIds=${hasIds}`);
  }
}

// Managing a participant must be possible, and discoverable, on both
// subsystems. Hiding these until hover made removal impossible to find.
{
  const rosters = [
    ['chase', { isGM: true, isRealGM: true, previewAsPlayer: false, isChaseTab: true,
                chases: [], selected: { ...selected, participants: participantsFor(true) } }],
    ['influence', influenceCtx(true)],
  ];
  for (const [label, ctx] of rosters) {
    const out = view(ctx);
    const removes = out.match(/<[^>]*data-action="removeParticipant"[^>]*>/g) ?? [];
    if (!removes.length) { failed = 1; console.error(`  ${label}: no way to remove a participant`); }
    for (const tag of removes) {
      if (/pfai-hover-only/.test(tag)) {
        failed = 1;
        console.error(`  ${label}: remove button is hover-only, so nobody can find it`);
      }
      if (!/data-subsystem="/.test(tag) || !/data-event-id="/.test(tag)) {
        failed = 1;
        console.error(`  ${label}: remove button missing subsystem/event id`);
      }
    }
    // Players must not be able to remove anyone.
    const playerCtx = label === 'chase'
      ? { ...ctx, isGM: false, selected: { ...ctx.selected, participants: participantsFor(false) } }
      : influenceCtx(false);
    const playerOut = view(playerCtx);
    if (playerOut.includes('data-action="removeParticipant"')) {
      failed = 1;
      console.error(`  ${label}: remove button leaked to players`);
    }
    console.log(`remove-participant ${label}: buttons=${removes.length} gmOnly=true`);
  }
}

// A GM must be able to grow an encounter: add approaches by hand or with AI,
// edit them, delete them, and set one to surface as the party makes progress.
{
  const out = view(influenceCtx(true));
  const controls = {
    addBlank: (out.match(/data-action="addApproach"/g) ?? []).length,
    addAI: (out.match(/data-action="generateApproach"/g) ?? []).length,
    edit: (out.match(/data-action="editApproach"/g) ?? []).length,
    remove: (out.match(/data-action="deleteApproach"/g) ?? []).length,
    unlockBadge: out.includes('pfai-unlock-badge'),
  };
  // One add pair per list: discoveries and influence skills.
  if (controls.addBlank !== 2 || controls.addAI !== 2) {
    failed = 1;
    console.error(`  expected add controls on both lists, got blank=${controls.addBlank} ai=${controls.addAI}`);
  }
  if (!controls.edit || !controls.remove) { failed = 1; console.error('  approaches cannot be edited or removed'); }
  if (!controls.unlockBadge) { failed = 1; console.error('  a progress-gated approach is not marked as such'); }

  // None of this reaches players.
  const playerOut = view(influenceCtx(false));
  const leaked = ['addApproach', 'generateApproach', 'editApproach', 'deleteApproach']
    .filter((a) => playerOut.includes(`data-action="${a}"`));
  if (leaked.length) { failed = 1; console.error(`  approach authoring leaked to players: ${leaked}`); }

  // A hidden approach must never reach the picker, for anyone. The GM sees it
  // in the list below and can reveal it; until then it is not rollable.
  const pickerOptions = out.match(/<option value="[^"]*" data-kind="[^"]*">([^<]*)</g) ?? [];
  if (pickerOptions.some((o) => /Intimidation/.test(o))) {
    failed = 1;
    console.error('  a hidden approach reached the GM roll picker');
  }
  console.log(`approach-authoring: ${JSON.stringify(controls)} playerLeaks=${leaked.length}`);
}

// Every authored section must be editable, and the subsystem's vocabulary
// explained where it is used rather than left for the GM to infer.
{
  const out = view(influenceCtx(true));

  const fields = (out.match(/data-action="editText"[^>]*data-field="([^"]+)"/g) ?? [])
    .map((m) => m.match(/data-field="([^"]+)"/)[1]);
  for (const required of ['premise', 'goal', 'gmNotes', 'npc.description', 'npc.wants']) {
    if (!fields.includes(required)) {
      failed = 1;
      console.error(`  "${required}" has no edit control`);
    }
  }

  const authoring = {
    stats: out.includes('data-action="editStats"'),
    thresholdAdd: out.includes('data-action="addThreshold"'),
    thresholdEdit: out.includes('data-action="editThreshold"'),
    thresholdDelete: out.includes('data-action="deleteThreshold"'),
    traitAdd: (out.match(/data-action="addTrait"/g) ?? []).length,
    traitEdit: (out.match(/data-action="editTrait"/g) ?? []).length,
    traitDelete: (out.match(/data-action="deleteTrait"/g) ?? []).length,
    infoTips: (out.match(/class="fa-solid fa-circle-info pfai-info"/g) ?? []).length,
  };
  for (const [key, value] of Object.entries(authoring)) {
    if (!value) { failed = 1; console.error(`  missing authoring control: ${key}`); }
  }
  if (authoring.traitAdd !== 3) {
    failed = 1;
    console.error(`  expected 3 trait add buttons, got ${authoring.traitAdd}`);
  }

  const playerOut = view(influenceCtx(false));
  const leaked = ['editText', 'editStats', 'addThreshold', 'editThreshold', 'deleteThreshold',
                  'addTrait', 'editTrait', 'deleteTrait'].filter((a) => playerOut.includes(`data-action="${a}"`));
  if (leaked.length) { failed = 1; console.error(`  authoring leaked to players: ${leaked}`); }

  console.log(`authoring: fields=[${fields.join(',')}] ${JSON.stringify(authoring)} leaks=${leaked.length}`);
}

// ---- Research: same guarantees as the other two ----
const RESEARCH_ROLL_OPTIONS = [
  { value: 'src1|c1', label: 'Grand Archive: Society', dc: 16 },
  { value: 'src1|c2', label: 'Grand Archive: Academia Lore', dc: 18 },
];

const researchCtx = (isGM) => ({
  isGM, isRealGM: isGM, previewAsPlayer: false, isResearchTab: true,
  chases: [], influences: [], researches: [],
  selectedResearch: {
    id: 'r1', name: 'The Ashen Ledger', hidden: false, started: false,
    researchPoints: 4, baseDC: 20, dcModifier: 2, remainingCapacity: 7,
    rounds: { current: 1, max: 3, unit: 'day' }, outOfTime: false,
    ai: { generated: true },
    enrichedTopic: '<p>Who last held it.</p>',
    enrichedPremise: '<p>Three days in the Grand Archive.</p>',
    enrichedGoal: '<p>A name and a grave.</p>',
    enrichedGmNotes: '<p>RESEARCH-SECRET</p>',
    sources: [{
      id: 'src1', name: 'Grand Archive', hidden: false, exhausted: false, percent: 50,
      researchPoints: { current: 2, max: 4 }, enrichedDescription: '<p>Vast.</p>', hiddenChecks: isGM ? 1 : 0,
      checks: isGM
        ? [{ id: 'c1', label: 'Society', dc: 18, effectiveDC: 20, description: 'Ask.', hidden: false },
           { id: 'c3', label: 'Occultism', dc: 22, effectiveDC: 24, description: 'Pry.', hidden: true, revealAt: 6, lockedUntil: 6 }]
        : [{ id: 'c1', label: 'Society', dc: 18, effectiveDC: 20, description: 'Ask.', hidden: false }],
    }],
    thresholds: isGM
      ? [{ id: 't1', points: 3, name: 'A name', reached: true, hidden: false, enrichedDescription: '<p>x</p>' },
         { id: 't2', points: 8, name: 'A grave', reached: false, hidden: true, enrichedDescription: '<p>y</p>' }]
      : [{ id: 't1', points: 3, name: 'A name', reached: true, hidden: false, enrichedDescription: '<p>x</p>' }],
    nextThreshold: { id: 't2', points: 8, name: 'A grave' }, allThresholdsReached: false,
    complications: isGM
      ? [{ id: 'e1', name: 'The rival delegation', hidden: false, fired: true,
           trigger: { kind: 'points', at: 3 }, triggerLabel: 'at 3 points',
           modifier: { value: 2, active: true }, enrichedDescription: '<p>They arrive.</p>' }]
      : [],
    rollOptions: RESEARCH_ROLL_OPTIONS,
    participants: [
      { id: 'p1', name: 'Ezren', img: 'a.png', hasActed: false, canRoll: true, owned: true, noActor: false,
        canAward: isGM, isReroll: false, rollOptions: RESEARCH_ROLL_OPTIONS,
        contributedTotal: 3, successCount: 3, rollCount: 4, hasContributed: true },
      { id: 'p2', name: 'Kyra', img: 'b.png', hasActed: true, canRoll: isGM, owned: true, noActor: false,
        canAward: isGM, isReroll: isGM, rollOptions: RESEARCH_ROLL_OPTIONS,
        contributedTotal: 1, successCount: 1, rollCount: 2, hasContributed: true },
    ],
    hiddenCounts: isGM ? { sources: 1, thresholds: 1, events: 0 } : null,
  },
});

for (const isGM of [true, false]) {
  const out = view(researchCtx(isGM));
  const has = (a) => out.includes(`data-action="${a}"`);
  const count = (a) => (out.match(new RegExp(`data-action="${a}"`, 'g')) ?? []).length;

  // GM prose must not reach players.
  if (out.includes('RESEARCH-SECRET') !== isGM) { failed = 1; console.error('  research GM notes leak'); }

  // Rolling matches the other subsystems: picker + button per able participant.
  const rolls = count('rollResearch');
  if (rolls !== (isGM ? 2 : 1)) { failed = 1; console.error(`  research rolls: expected ${isGM ? 2 : 1}, got ${rolls}`); }
  const options = (out.match(/<option value="src1\|/g) ?? []).length;
  if (options !== rolls * RESEARCH_ROLL_OPTIONS.length) {
    failed = 1; console.error(`  research picker wrong: ${options} options for ${rolls} buttons`);
  }

  // Everything a GM authors is GM-only.
  const authoring = ['addSource', 'generateSource', 'editSource', 'deleteSource', 'addCheck', 'editCheck',
                     'deleteCheck', 'addFinding', 'editFinding', 'deleteFinding', 'addComplication',
                     'editComplication', 'deleteComplication', 'toggleResearchReveal', 'awardResearch',
                     'removeParticipant', 'editText'];
  const leaked = authoring.filter((a) => has(a));
  if (isGM && leaked.length !== authoring.length) {
    failed = 1;
    console.error(`  research missing authoring: ${authoring.filter((a) => !has(a))}`);
  }
  if (!isGM && leaked.length) { failed = 1; console.error(`  research authoring leaked: ${leaked}`); }

  // Source caps, locks and complication triggers must be legible.
  if (isGM) {
    for (const [what, present] of [
      ['source cap', out.includes('2 / 4')],
      ['locked check badge', out.includes('pfai-unlock-badge')],
      ['trigger badge', out.includes('pfai-trigger-badge')],
      ['remaining capacity', out.includes('Left to find') || out.includes('PFAI.Research.Remaining')],
      ['info tooltips', (out.match(/pfai-info/g) ?? []).length >= 3],
    ]) {
      if (!present) { failed = 1; console.error(`  research: ${what} not shown`); }
    }
  }
  console.log(`research isGM=${isGM}: bytes=${out.length} rolls=${rolls} options=${options} authoring=${leaked.length}`);
}

// Research must offer the same event-level operations as the other two.
{
  const out = view(researchCtx(true));
  const SHARED = ['togglePlayerPreview', 'showToPlayers', 'toggleHidden', 'exportEvent', 'editTitle', 'toggleStarted'];
  const missing = SHARED.filter((a) => !out.includes(`data-action="${a}"`));
  if (missing.length) { failed = 1; console.error(`  research missing shared operations: ${missing}`); }
  for (const tag of out.match(/<[^>]*data-action="(?:showToPlayers|toggleHidden|exportEvent|editTitle|toggleStarted)"[^>]*>/g) ?? []) {
    if (!/data-subsystem="research"/.test(tag) || !/data-event-id="/.test(tag)) {
      failed = 1; console.error(`  research shared action not wired: ${tag.slice(0, 80)}`);
    }
  }
  // And the same participant roster contract.
  const zone = out.includes('pfai-dropzone') && /data-subsystem="research"/.test(out);
  if (!zone) { failed = 1; console.error('  research roster is not a drop target'); }
  console.log(`research parity: shared=${SHARED.length - missing.length}/${SHARED.length} dropzone=${zone}`);
}

/*
 * Every section must explain itself. A GM meeting "soft spot" or "source cap"
 * for the first time should not have to go and read the rulebook, so each
 * panel heading carries an info tooltip.
 */
{
  const headingsOf = (out) => out.match(/<h3\b[\s\S]*?<\/h3>/g) ?? [];
  const views = [
    ['chase', { isGM: true, isRealGM: true, previewAsPlayer: false, isChaseTab: true,
                chases: [], selected: { ...selected, participants: participantsFor(true) } }],
    ['influence', influenceCtx(true)],
    ['research', researchCtx(true)],
  ];

  for (const [label, ctx] of views) {
    const headings = headingsOf(view(ctx));
    const bare = headings
      .filter((h) => !h.includes('pfai-info'))
      .map((h) => h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40));
    if (bare.length) {
      failed = 1;
      console.error(`  ${label}: ${bare.length} section(s) with no explanation: ${bare.join(' | ')}`);
    }
    console.log(`explained ${label}: ${headings.length - bare.length}/${headings.length} sections`);
  }
}

// ---- Infiltration: the fourth subsystem, same guarantees ----
const INF_ROLL_OPTIONS = [
  { value: 'obstacle|ob1|obj1|c1', label: 'The Postern Gate: Stealth', dc: 18 },
  { value: 'opportunity|op1||c2', label: '\u2605 The Rota: Thievery', dc: 20 },
];

const infiltrationCtx = (isGM, { blocked = false } = {}) => ({
  isGM, isRealGM: isGM, previewAsPlayer: false, isInfiltrationTab: true,
  chases: [], influences: [], researches: [], infiltrations: [],
  selectedInfiltration: {
    id: 'i1', name: 'The Signal House', hidden: false, started: false,
    baseDC: 20, dcModifier: 2, edgePoints: 2,
    rounds: { current: 2, max: 6 }, outOfTime: false, complete: false,
    awareness: { current: 6, perRound: 1 },
    ai: { generated: true },
    enrichedTarget: '<p>A signal house.</p>',
    enrichedPremise: '<p>Festival night.</p>',
    enrichedGoal: '<p>The codes.</p>',
    enrichedGmNotes: '<p>INFILTRATION-SECRET</p>',
    objectives: [{
      id: 'obj1', name: 'Get inside', hidden: false, complete: false,
      enrichedDescription: '<p>Past the wall.</p>',
      obstacles: [{
        id: 'ob1', name: 'The Postern Gate', hidden: false, cleared: false, individual: false,
        progressLabel: '1 / 2', percent: 50, enrichedDescription: '<p>Locked.</p>',
        infiltrationPoints: { current: 1, goal: 2 },
        checks: [{ id: 'c1', label: 'Stealth', dc: 16, effectiveDC: 18, description: 'Slip past.', hidden: false }],
      }],
    }],
    breakpoints: isGM
      ? [{ id: 'b1', at: 5, name: 'The watch doubles', passed: true, hidden: false, dcIncrease: 2, enrichedDescription: '<p>x</p>' },
         { id: 'b2', at: 10, name: 'Alarm', passed: false, hidden: true, dcIncrease: 4, enrichedDescription: '<p>y</p>' }]
      : [{ id: 'b1', at: 5, name: 'The watch doubles', passed: true, hidden: false, dcIncrease: 2, enrichedDescription: '<p>x</p>' }],
    nextBreakpoint: { id: 'b2', at: 10, name: 'Alarm' },
    complications: blocked
      ? [{ id: 'cm1', name: 'A patrol doubles back', hidden: false, fired: true, resolved: false,
           trigger: { kind: 'awareness', at: 5 }, triggerLabel: 'at 5 awareness',
           enrichedDescription: '<p>They turn.</p>',
           checks: [{ id: 'c3', label: 'Deception', dc: 18, effectiveDC: 20, description: 'Bluff.' }] }]
      : [],
    blocking: blocked
      ? [{ id: 'cm1', name: 'A patrol doubles back' }]
      : [],
    isBlocked: blocked,
    opportunities: isGM
      ? [{ id: 'op1', name: 'The Rota', hidden: false, used: false,
           enrichedDescription: '<p>A duty roster.</p>', enrichedBenefit: '<p>-2 awareness.</p>',
           checks: [{ id: 'c2', label: 'Thievery', dc: 18, effectiveDC: 20, description: 'Palm it.' }] }]
      : [],
    preparations: isGM
      ? [{ id: 'p1', name: 'Bribe a lamplighter', slug: 'diplomacy', label: 'Diplomacy', dc: 18,
           used: false, enrichedDescription: '<p>Coin talks.</p>' }]
      : [],
    rollOptions: INF_ROLL_OPTIONS,
    participants: [
      { id: 'pa1', name: 'Merisiel', img: 'a.png', hasActed: false, canRoll: true, owned: true, noActor: false,
        canAward: isGM, canSpendEdge: isGM, isReroll: false, rollOptions: INF_ROLL_OPTIONS,
        contributedTotal: 2, successCount: 2, rollCount: 4, awarenessCaused: 3, hasContributed: true },
      { id: 'pa2', name: 'Kyra', img: 'b.png', hasActed: true, canRoll: isGM, owned: true, noActor: false,
        canAward: isGM, canSpendEdge: isGM, isReroll: isGM, rollOptions: INF_ROLL_OPTIONS,
        contributedTotal: 0, successCount: 0, rollCount: 1, awarenessCaused: 1, hasContributed: true },
    ],
    hiddenCounts: isGM ? { objectives: 1, complications: 0, opportunities: 1, breakpoints: 1 } : null,
  },
});

for (const isGM of [true, false]) {
  const out = view(infiltrationCtx(isGM));
  if (out.includes('INFILTRATION-SECRET') !== isGM) { failed = 1; console.error('  infiltration GM notes leak'); }

  const rolls = (out.match(/data-action="rollInfiltration"/g) ?? []).length;
  if (rolls !== (isGM ? 2 : 1)) { failed = 1; console.error(`  infiltration rolls: expected ${isGM ? 2 : 1}, got ${rolls}`); }

  const authoring = ['addObjective', 'editObjective', 'deleteObjective', 'addInfiltrationObstacle',
                     'generateInfiltrationObstacle', 'editInfiltrationObstacle', 'deleteInfiltrationObstacle',
                     'addBreakpoint', 'editBreakpoint', 'deleteBreakpoint', 'toggleInfiltrationReveal',
                     'togglePreparationUsed', 'removeParticipant', 'editText', 'spendEdge', 'awarenessDelta',
                     'edgeDelta'];
  const present = authoring.filter((a) => out.includes(`data-action="${a}"`));
  if (isGM && present.length !== authoring.length) {
    failed = 1;
    console.error(`  infiltration missing authoring: ${authoring.filter((a) => !present.includes(a))}`);
  }
  if (!isGM && present.length) { failed = 1; console.error(`  infiltration authoring leaked: ${present}`); }

  if (isGM) {
    for (const [what, ok] of [
      ['awareness readout', out.includes('pfai-awareness')],
      ['edge points', out.includes('PFAI.Infiltration.EdgePoints')],
      ['awareness drawn per participant', out.includes('fa-eye')],
      ['individual obstacle handling', out.includes('PFAI.Infiltration.Individual') || out.includes('1 / 2')],
    ]) {
      if (!ok) { failed = 1; console.error(`  infiltration: ${what} not shown`); }
    }
  }
  console.log(`infiltration isGM=${isGM}: bytes=${out.length} rolls=${rolls} authoring=${present.length}`);
}

// A live complication must take over the view and the picker.
{
  const out = view(infiltrationCtx(true, { blocked: true }));
  if (!out.includes('pfai-blocked-banner')) { failed = 1; console.error('  a blocking complication is not announced'); }
  if (!out.includes('pfai-panel-urgent')) { failed = 1; console.error('  the complication panel is not marked urgent'); }
  console.log('infiltration blocked: banner and urgent panel shown');
}

// Parity with the other three.
{
  const out = view(infiltrationCtx(true));
  const SHARED = ['togglePlayerPreview', 'showToPlayers', 'toggleHidden', 'exportEvent', 'editTitle', 'toggleStarted'];
  const missing = SHARED.filter((a) => !out.includes(`data-action="${a}"`));
  if (missing.length) { failed = 1; console.error(`  infiltration missing shared operations: ${missing}`); }
  for (const tag of out.match(/<[^>]*data-action="(?:showToPlayers|toggleHidden|exportEvent|editTitle|toggleStarted)"[^>]*>/g) ?? []) {
    if (!/data-subsystem="infiltration"/.test(tag) || !/data-event-id="/.test(tag)) {
      failed = 1; console.error(`  infiltration shared action not wired: ${tag.slice(0, 80)}`);
    }
  }
  const zone = out.includes('pfai-dropzone') && /data-subsystem="infiltration"/.test(out);
  if (!zone) { failed = 1; console.error('  infiltration roster is not a drop target'); }

  // And every section explains itself, like the rest.
  const headings = out.match(/<h3\b[\s\S]*?<\/h3>/g) ?? [];
  const bare = headings.filter((h) => !h.includes('pfai-info'))
    .map((h) => h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40));
  if (bare.length) { failed = 1; console.error(`  infiltration unexplained sections: ${bare.join(' | ')}`); }
  console.log(`infiltration parity: shared=${SHARED.length - missing.length}/${SHARED.length} dropzone=${zone} explained=${headings.length - bare.length}/${headings.length}`);
}

process.exit(failed);
