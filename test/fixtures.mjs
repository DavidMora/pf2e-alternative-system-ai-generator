/**
 * Render contexts for every subsystem, shared by the template checks and the
 * parity audit so both describe the same thing. A fixture that drifts from what
 * the view actually produces makes both suites lie, so there is one copy.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Handlebars from 'handlebars';

export const templatesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'templates',
);

/** Register the helpers and partials Foundry would provide. */
export function prepareHandlebars() {
  Handlebars.registerHelper('localize', (k) => String(k));
  Handlebars.registerHelper('pfaiEq', (a, b) => a === b);
  Handlebars.registerHelper('pfaiAdd', (a, b) => Number(a) + Number(b));
  Handlebars.registerHelper('pfaiOr', (...a) => a.slice(0, -1).some(Boolean));
  Handlebars.registerHelper('pfaiSubtract', (a, b) => Number(a) - Number(b));
  Handlebars.registerHelper('pfaiLt', (a, b) => Number(a) < Number(b));

  const partialsDir = path.join(templatesDir, 'partials');
  for (const file of readdirSync(partialsDir).filter((f) => f.endsWith('.hbs'))) {
    // influence-detail.hbs -> pfaiInfluenceDetail
    const name = `pfai${file
      .replace('.hbs', '')
      .split('-')
      .map((part) => part[0].toUpperCase() + part.slice(1))
      .join('')}`;
    Handlebars.registerPartial(name, readFileSync(path.join(partialsDir, file), 'utf8'));
  }

  return Handlebars.compile(readFileSync(path.join(templatesDir, 'subsystem-view.hbs'), 'utf8'));
}

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

const LEADERSHIP_ROLL_OPTIONS = [
  { value: 'ev1|c1', label: 'The Dock Levy: Diplomacy', dc: 20 },
];

export const leadershipCtx = (isGM) => ({
  isGM, isRealGM: isGM, previewAsPlayer: false, isLeadershipTab: true,
  chases: [], influences: [], researches: [], infiltrations: [], leaderships: [],
  selectedLeadership: {
    id: 'l1', name: 'The Lamplighters', hidden: false, started: false,
    kind: 'mutual-aid society', seat: 'a converted chandlery',
    organizationLevel: 6, baseDC: 20, level: 5, partySize: 4,
    size: { level: 6, followers: '14-18', maxFollowerLevel: 1, lieutenants: '2', lieutenantLevels: '2' },
    atMaxLevel: false, pendingCount: 1,
    ai: { generated: true },
    enrichedOrganization: '<p>A mutual-aid society.</p>',
    enrichedPremise: '<p>Founded after the press gang.</p>',
    enrichedGoal: '<p>A seat on the council.</p>',
    enrichedGmNotes: '<p>LEADERSHIP-SECRET</p>',
    lieutenants: isGM
      ? [{ id: 'lt1', name: 'Vessa Cull', role: 'quartermaster', level: 2, hidden: false,
           enrichedDescription: '<p>Keeps the books.</p>' },
         { id: 'lt2', name: 'The Auditor', role: 'unknown', level: 3, hidden: true,
           enrichedDescription: '<p>Nobody has met them.</p>' }]
      : [{ id: 'lt1', name: 'Vessa Cull', role: 'quartermaster', level: 2, hidden: false,
           enrichedDescription: '<p>Keeps the books.</p>' }],
    events: isGM
      ? [{ id: 'ev1', kind: 'trouble', kindLabel: 'trouble', name: 'The Dock Levy', hidden: false,
           resolved: false, revealAt: 5, lockedUntil: null,
           enrichedDescription: '<p>A new tax.</p>', enrichedOutcome: '<p>Goodwill.</p>',
           checks: [{ id: 'c1', label: 'Diplomacy', dc: 20, effectiveDC: 20, description: 'Petition.' }] },
         { id: 'ev2', kind: 'windfall', kindLabel: 'windfall', name: 'A Bequest', hidden: true,
           resolved: false, revealAt: 9, lockedUntil: 9,
           enrichedDescription: '<p>A will names them.</p>', enrichedOutcome: '<p>Funds.</p>', checks: [] }]
      : [{ id: 'ev1', kind: 'trouble', kindLabel: 'trouble', name: 'The Dock Levy', hidden: false,
           resolved: false, revealAt: 5, lockedUntil: null,
           enrichedDescription: '<p>A new tax.</p>', enrichedOutcome: '<p>Goodwill.</p>',
           checks: [{ id: 'c1', label: 'Diplomacy', dc: 20, effectiveDC: 20, description: 'Petition.' }] }],
    rollOptions: LEADERSHIP_ROLL_OPTIONS,
    participants: [
      { id: 'pl1', name: 'Amiri', img: 'a.png', hasActed: false, canRoll: true, owned: true, noActor: false,
        canAward: isGM, isReroll: false, rollOptions: LEADERSHIP_ROLL_OPTIONS,
        contributedTotal: 1, successCount: 1, rollCount: 2, hasContributed: true },
      { id: 'pl2', name: 'Harsk', img: 'b.png', hasActed: true, canRoll: isGM, owned: true, noActor: false,
        canAward: isGM, isReroll: isGM, rollOptions: LEADERSHIP_ROLL_OPTIONS,
        contributedTotal: 0, successCount: 0, rollCount: 1, hasContributed: true },
    ],
    hiddenCounts: isGM ? { events: 1, lieutenants: 1 } : null,
  },
});

export { selected, participantsFor, influenceCtx, researchCtx, infiltrationCtx };

/** One context per subsystem, keyed the way the registry keys them. */
export const CONTEXTS = {
  chase: (isGM) => ({
    isGM,
    isRealGM: isGM,
    previewAsPlayer: false,
    isChaseTab: true,
    chases: [],
    selected: { ...selected, participants: participantsFor(isGM) },
  }),
  influence: influenceCtx,
  research: researchCtx,
  infiltration: (isGM) => infiltrationCtx(isGM),
  leadership: leadershipCtx,
};
