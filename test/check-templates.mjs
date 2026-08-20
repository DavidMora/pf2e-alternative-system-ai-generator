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

process.exit(failed);
