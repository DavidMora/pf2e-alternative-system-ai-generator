import { LEADERSHIP_EVENT_KINDS, MODULE_ID, PF2E_SKILLS } from '../constants.js';
import {
  capitalize,
  deleteChase,
  deleteInfluence,
  deleteInfiltration,
  deleteLeadership,
  deleteResearch,
  enrich,
  getInfluence,
  getInfluences,
  getInfiltration,
  getInfiltrations,
  getLeadership,
  getLeaderships,
  getResearch,
  getResearches,
  setInfluences,
  setInfiltrations,
  setLeaderships,
  setResearches,
  updateInfiltration,
  updateLeadership,
  updateResearch,
  updateInfluence,
  escapeHTML,
  guessPartyLevel,
  guessPartySize,
  suggestedBaseDC,
  getChase,
  getChases,
  branchesAt,
  nextBranchLabel,
  nextPosition,
  nextStepPosition,
  organizationSize,
  routeTargetsFor,
  stepsOf,
  unroutedOptions,
  obstacleForParticipant,
  obstacleLabels,
  setChases,
  sortObstacles,
  updateChase,
} from '../helpers.js';
import { GenerateChaseDialog } from './generate-chase-dialog.js';
import { GenerateInfluenceDialog } from './generate-influence-dialog.js';
import { GenerateResearchDialog } from './generate-research-dialog.js';
import { GenerateInfiltrationDialog } from './generate-infiltration-dialog.js';
import { GenerateLeadershipDialog } from './generate-leadership-dialog.js';
import { generateFork, generateOneObstacle, toObstacleEntry } from '../ai/chase.js';
import { generateApproach, toApproachEntry } from '../ai/influence.js';
import { generateSource, toCheckEntry, toSourceEntry } from '../ai/research.js';
import { generateObstacle as generateInfiltrationObstacle, toObstacleEntry as toInfiltrationObstacle } from '../ai/infiltration.js';
import { generateLeadershipEvent, toEventEntry as toLeadershipEvent } from '../ai/leadership.js';
import { GenerateImageDialog } from './generate-image-dialog.js';
import { emitShowEvent } from '../socket.js';
import { eventTarget, exportPayload, subsystem } from '../subsystems.js';
import { applyExchange, parseExchange } from '../exchange.js';
import {
  adjustContribution,
  adjustInfluenceContribution,
  adjustResearchContribution,
  advanceInfiltration,
  advanceLeadership,
  advanceResearch,
  announceInfiltrationProgress,
  announceResearchProgress,
  passTurn,
  revealByProgress,
  rollChaseCheck,
  rollInfluenceCheck,
  rollInfiltrationCheck,
  rollLeadershipCheck,
  rollResearchCheck,
  spendEdgePoint,
} from '../rolls.js';
import { activeModel, hasApiKey } from '../ai/openai.js';

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

/** Read a dialog form into a plain object. */
function formValues(button) {
  return new foundry.applications.ux.FormDataExtended(button.form).object;
}

/**
 * The single window GMs and players use to browse and run subsystems.
 *
 * Only GMs can mutate anything: the underlying store is a world setting, which
 * Foundry refuses to write from a player client. Players get a read-only view
 * that hides unrevealed content.
 */
export class SubsystemView extends HandlebarsApplicationMixin(ApplicationV2) {
  /** Currently opened chase id, or null while showing the list. */
  #selectedId = null;

  /**
   * Carousel position. null means "follow the live obstacle", which is what
   * players always get; a number is a GM who has browsed away from it.
   */
  #obstacleIndex = null;

  /** Guards the on-demand generate button against double submits. */
  #generatingObstacle = false;

  /** GM-only: render the whole view as a player would see it. */
  #previewAsPlayer = false;

  /** Which subsystem tab is open. */
  #subsystem = 'chase';

  /** Selected influence encounter, independent of the chase selection. */
  #selectedInfluenceId = null;

  /** Selected research event. */
  #selectedResearchId = null;

  /** Selected infiltration. */
  #selectedInfiltrationId = null;

  /** Selected organisation. */
  #selectedLeadershipId = null;

  static DEFAULT_OPTIONS = {
    id: 'pfai-subsystem-view',
    classes: ['pfai', 'pfai-view'],
    window: {
      title: 'PFAI.View.Title',
      icon: 'fa-solid fa-person-running',
      resizable: true,
    },
    position: { width: 860, height: 720 },
    actions: {
      generate: SubsystemView.#onGenerate,
      switchSubsystem: SubsystemView.#onSwitchSubsystem,
      generateInfluence: SubsystemView.#onGenerateInfluence,
      generateResearch: SubsystemView.#onGenerateResearch,
      generateInfiltration: SubsystemView.#onGenerateInfiltration,
      generateLeadership: SubsystemView.#onGenerateLeadership,
      openLeadership: SubsystemView.#onOpenLeadership,
      backLeadership: SubsystemView.#onBackLeadership,
      deleteLeadership: SubsystemView.#onDeleteLeadership,
      orgLevelDelta: SubsystemView.#onOrgLevelDelta,
      rollLeadership: SubsystemView.#onRollLeadership,
      toggleLeadershipReveal: SubsystemView.#onToggleLeadershipReveal,
      toggleEventResolved: SubsystemView.#onToggleEventResolved,
      addLieutenant: SubsystemView.#onAddLieutenant,
      editLieutenant: SubsystemView.#onEditLieutenant,
      deleteLieutenant: SubsystemView.#onDeleteLieutenant,
      addLeadershipEvent: SubsystemView.#onAddLeadershipEvent,
      generateLeadershipEvent: SubsystemView.#onGenerateLeadershipEvent,
      editLeadershipEvent: SubsystemView.#onEditLeadershipEvent,
      deleteLeadershipEvent: SubsystemView.#onDeleteLeadershipEvent,
      openInfiltration: SubsystemView.#onOpenInfiltration,
      backInfiltration: SubsystemView.#onBackInfiltration,
      deleteInfiltration: SubsystemView.#onDeleteInfiltration,
      awarenessDelta: SubsystemView.#onAwarenessDelta,
      edgeDelta: SubsystemView.#onEdgeDelta,
      infiltrationRoundDelta: SubsystemView.#onInfiltrationRoundDelta,
      infiltrationNextRound: SubsystemView.#onInfiltrationNextRound,
      rollInfiltration: SubsystemView.#onRollInfiltration,
      spendEdge: SubsystemView.#onSpendEdge,
      toggleInfiltrationReveal: SubsystemView.#onToggleInfiltrationReveal,
      toggleComplicationResolved: SubsystemView.#onToggleComplicationResolved,
      togglePreparationUsed: SubsystemView.#onTogglePreparationUsed,
      addObjective: SubsystemView.#onAddObjective,
      editObjective: SubsystemView.#onEditObjective,
      deleteObjective: SubsystemView.#onDeleteObjective,
      addInfiltrationObstacle: SubsystemView.#onAddInfiltrationObstacle,
      generateInfiltrationObstacle: SubsystemView.#onGenerateInfiltrationObstacle,
      editInfiltrationObstacle: SubsystemView.#onEditInfiltrationObstacle,
      deleteInfiltrationObstacle: SubsystemView.#onDeleteInfiltrationObstacle,
      addBreakpoint: SubsystemView.#onAddBreakpoint,
      editBreakpoint: SubsystemView.#onEditBreakpoint,
      deleteBreakpoint: SubsystemView.#onDeleteBreakpoint,
      openResearch: SubsystemView.#onOpenResearch,
      backResearch: SubsystemView.#onBackResearch,
      deleteResearch: SubsystemView.#onDeleteResearch,
      researchPointDelta: SubsystemView.#onResearchPointDelta,
      researchRoundDelta: SubsystemView.#onResearchRoundDelta,
      researchNextRound: SubsystemView.#onResearchNextRound,
      rollResearch: SubsystemView.#onRollResearch,
      awardResearch: SubsystemView.#onAwardResearch,
      toggleResearchReveal: SubsystemView.#onToggleResearchReveal,
      toggleEventActive: SubsystemView.#onToggleEventActive,
      addSource: SubsystemView.#onAddSource,
      generateSource: SubsystemView.#onGenerateSource,
      editSource: SubsystemView.#onEditSource,
      deleteSource: SubsystemView.#onDeleteSource,
      addCheck: SubsystemView.#onAddCheck,
      editCheck: SubsystemView.#onEditCheck,
      deleteCheck: SubsystemView.#onDeleteCheck,
      addFinding: SubsystemView.#onAddFinding,
      editFinding: SubsystemView.#onEditFinding,
      deleteFinding: SubsystemView.#onDeleteFinding,
      addComplication: SubsystemView.#onAddComplication,
      editComplication: SubsystemView.#onEditComplication,
      deleteComplication: SubsystemView.#onDeleteComplication,
      openInfluence: SubsystemView.#onOpenInfluence,
      backInfluence: SubsystemView.#onBackInfluence,
      deleteInfluence: SubsystemView.#onDeleteInfluence,
      influencePointDelta: SubsystemView.#onInfluencePointDelta,
      influenceRoundDelta: SubsystemView.#onInfluenceRoundDelta,
      influenceNextRound: SubsystemView.#onInfluenceNextRound,
      toggleReveal: SubsystemView.#onToggleReveal,
      toggleModifierUsed: SubsystemView.#onToggleModifierUsed,
      rollInfluence: SubsystemView.#onRollInfluence,
      awardInfluence: SubsystemView.#onAwardInfluence,
      addApproach: SubsystemView.#onAddApproach,
      generateApproach: SubsystemView.#onGenerateApproach,
      editApproach: SubsystemView.#onEditApproach,
      deleteApproach: SubsystemView.#onDeleteApproach,
      generateObstacles: SubsystemView.#onGenerateObstacles,
      generateOneObstacle: SubsystemView.#onGenerateOneObstacle,
      obstaclePrev: SubsystemView.#onObstaclePrev,
      obstacleNext: SubsystemView.#onObstacleNext,
      obstacleJump: SubsystemView.#onObstacleJump,
      setActiveObstacle: SubsystemView.#onSetActiveObstacle,
      togglePlayerPreview: SubsystemView.#onTogglePlayerPreview,
      showToPlayers: SubsystemView.#onShowToPlayers,
      generateImage: SubsystemView.#onGenerateImage,
      clearImage: SubsystemView.#onClearImage,
      editTitle: SubsystemView.#onEditTitle,
      createBlank: SubsystemView.#onCreateBlank,
      openChase: SubsystemView.#onOpenChase,
      back: SubsystemView.#onBack,
      deleteChase: SubsystemView.#onDeleteChase,
      toggleHidden: SubsystemView.#onToggleHidden,
      toggleStarted: SubsystemView.#onToggleStarted,
      roundDelta: SubsystemView.#onRoundDelta,
      addObstacle: SubsystemView.#onAddObstacle,
      deleteObstacle: SubsystemView.#onDeleteObstacle,
      toggleObstacleLock: SubsystemView.#onToggleObstacleLock,
      chasePointDelta: SubsystemView.#onChasePointDelta,
      editObstacle: SubsystemView.#onEditObstacle,
      editText: SubsystemView.#onEditText,
      editStats: SubsystemView.#onEditStats,
      addThreshold: SubsystemView.#onAddThreshold,
      editThreshold: SubsystemView.#onEditThreshold,
      deleteThreshold: SubsystemView.#onDeleteThreshold,
      addTrait: SubsystemView.#onAddTrait,
      editTrait: SubsystemView.#onEditTrait,
      deleteTrait: SubsystemView.#onDeleteTrait,
      addParticipants: SubsystemView.#onAddParticipants,
      removeParticipant: SubsystemView.#onRemoveParticipant,
      participantDelta: SubsystemView.#onParticipantDelta,
      toggleActed: SubsystemView.#onToggleActed,
      rollCheck: SubsystemView.#onRollCheck,
      awardContribution: SubsystemView.#onAwardContribution,
      passTurn: SubsystemView.#onPassTurn,
      addBranch: SubsystemView.#onAddBranch,
      generateBranch: SubsystemView.#onGenerateBranch,
      regenerateObstacle: SubsystemView.#onRegenerateObstacle,
      setParticipantBranch: SubsystemView.#onSetParticipantBranch,
      obstacleRoundDelta: SubsystemView.#onObstacleRoundDelta,
      nextRound: SubsystemView.#onNextRound,
      exportEvent: SubsystemView.#onExportEvent,
      importEvent: SubsystemView.#onImportEvent,
    },
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/subsystem-view.hbs`, scrollable: [''] },
  };

  /** Open the window, optionally jumping straight to one chase. */
  static async open(eventId = null, subsystemKey = null) {
    const existing = foundry.applications.instances.get('pfai-subsystem-view');
    const app = existing instanceof SubsystemView ? existing : new SubsystemView();
    // Naming a subsystem is enough to switch to its tab. It used to take an
    // event id as well, so there was no way to open the window on, say, the
    // leadership list; omitting the key leaves the window where it was.
    if (subsystemKey) app.#subsystem = subsystem(subsystemKey).key;
    if (eventId) {
      app.#subsystem = subsystem(subsystemKey ?? 'chase').key;
      app.#select(app.#subsystem, eventId);
    }
    await app.render({ force: true });
    // A window that is already open but minimised or behind others would
    // otherwise look like nothing happened.
    if (app.minimized) await app.maximize();
    app.bringToFront();
    return app;
  }

  /** Record the open event for a subsystem. */
  #select(subsystemKey, eventId) {
    switch (subsystemKey) {
      case 'influence':
        this.#selectedInfluenceId = eventId;
        break;
      case 'research':
        this.#selectedResearchId = eventId;
        break;
      case 'infiltration':
        this.#selectedInfiltrationId = eventId;
        break;
      case 'leadership':
        this.#selectedLeadershipId = eventId;
        break;
      case 'chase':
        this.#selectedId = eventId;
        // Start on the active obstacle, not wherever this user last browsed.
        this.#obstacleIndex = null;
        break;
      default:
        console.warn(`${MODULE_ID} | no selection field for subsystem "${subsystemKey}"`);
    }
  }

  select(chaseId) {
    this.#selectedId = chaseId;
    // Opening a different chase should not inherit the previous carousel spot.
    this.#obstacleIndex = null;
    return this.render();
  }

  /** True when this user may edit; the preview toggle deliberately revokes it. */
  get isGM() {
    return game.user.isGM && !this.#previewAsPlayer;
  }

  async _prepareContext() {
    const isGM = this.isGM;
    const chases = getChases().events;

    const visible = Object.values(chases)
      .filter((chase) => isGM || !chase.hidden)
      .sort((a, b) => a.position - b.position);

    // A chase can be deleted or hidden while open, so fall back to the list.
    // Player preview is the exception: bouncing out would hide the very thing
    // the GM is trying to inspect, so hold the selection and say why it is dark.
    const selectedRaw = this.#selectedId ? chases[this.#selectedId] : null;
    const hiddenFromPlayers = Boolean(selectedRaw?.hidden) && !isGM;
    const selected = selectedRaw && !hiddenFromPlayers ? selectedRaw : null;
    if (!selectedRaw) this.#selectedId = null;

    // Real GMs previewing keep their place; actual players do not.
    if (hiddenFromPlayers && !this.#previewAsPlayer) this.#selectedId = null;

    const influences = getInfluences().events;
    const visibleInfluences = Object.values(influences)
      .filter((event) => isGM || !event.hidden)
      .sort((a, b) => a.position - b.position);

    const selectedInfluenceRaw = this.#selectedInfluenceId
      ? influences[this.#selectedInfluenceId]
      : null;
    if (!selectedInfluenceRaw) this.#selectedInfluenceId = null;
    const selectedInfluence =
      selectedInfluenceRaw && (isGM || !selectedInfluenceRaw.hidden) ? selectedInfluenceRaw : null;

    const leaderships = getLeaderships().events;
    const visibleLeaderships = Object.values(leaderships)
      .filter((event) => isGM || !event.hidden)
      .sort((a, b) => a.position - b.position);
    const selectedLeadershipRaw = this.#selectedLeadershipId
      ? leaderships[this.#selectedLeadershipId]
      : null;
    if (!selectedLeadershipRaw) this.#selectedLeadershipId = null;
    const selectedLeadership =
      selectedLeadershipRaw && (isGM || !selectedLeadershipRaw.hidden) ? selectedLeadershipRaw : null;

    const infiltrations = getInfiltrations().events;
    const visibleInfiltrations = Object.values(infiltrations)
      .filter((event) => isGM || !event.hidden)
      .sort((a, b) => a.position - b.position);
    const selectedInfiltrationRaw = this.#selectedInfiltrationId
      ? infiltrations[this.#selectedInfiltrationId]
      : null;
    if (!selectedInfiltrationRaw) this.#selectedInfiltrationId = null;
    const selectedInfiltration =
      selectedInfiltrationRaw && (isGM || !selectedInfiltrationRaw.hidden)
        ? selectedInfiltrationRaw
        : null;

    const researches = getResearches().events;
    const visibleResearches = Object.values(researches)
      .filter((event) => isGM || !event.hidden)
      .sort((a, b) => a.position - b.position);
    const selectedResearchRaw = this.#selectedResearchId ? researches[this.#selectedResearchId] : null;
    if (!selectedResearchRaw) this.#selectedResearchId = null;
    const selectedResearch =
      selectedResearchRaw && (isGM || !selectedResearchRaw.hidden) ? selectedResearchRaw : null;

    return {
      isGM,
      isRealGM: game.user.isGM,
      subsystem: this.#subsystem,
      isChaseTab: this.#subsystem === 'chase',
      isInfluenceTab: this.#subsystem === 'influence',
      isResearchTab: this.#subsystem === 'research',
      isInfiltrationTab: this.#subsystem === 'infiltration',
      isLeadershipTab: this.#subsystem === 'leadership',
      leaderships: visibleLeaderships.map((event) => ({
        ...event,
        eventCount: Object.values(event.events).filter((e) => !e.resolved).length,
      })),
      selectedLeadership: selectedLeadership
        ? await this.#prepareLeadership(selectedLeadership, isGM)
        : null,
      infiltrations: visibleInfiltrations.map((event) => ({
        ...event,
        objectiveCount: Object.keys(event.objectives).length,
      })),
      selectedInfiltration: selectedInfiltration
        ? await this.#prepareInfiltration(selectedInfiltration, isGM)
        : null,
      researches: visibleResearches.map((event) => ({
        ...event,
        sourceCount: Object.keys(event.sources).length,
      })),
      selectedResearch: selectedResearch
        ? await this.#prepareResearch(selectedResearch, isGM)
        : null,
      influences: visibleInfluences.map((event) => ({
        ...event,
        thresholdCount: Object.keys(event.thresholds).length,
        npcName: event.npc?.name ?? '',
      })),
      selectedInfluence: selectedInfluence
        ? await this.#prepareInfluence(selectedInfluence, isGM)
        : null,
      previewAsPlayer: this.#previewAsPlayer,
      // The same courtesy the chase branch has always had, for the other four:
      // say the event is dark rather than bouncing to the list without a word.
      previewHiddenEvent:
        this.#previewAsPlayer &&
        Boolean(
          {
            influence: selectedInfluenceRaw,
            research: selectedResearchRaw,
            infiltration: selectedInfiltrationRaw,
            leadership: selectedLeadershipRaw,
          }[this.#subsystem]?.hidden,
        ),
      // Preview of a chase players cannot see yet.
      previewHiddenChase: hiddenFromPlayers && this.#previewAsPlayer,
      previewChaseName: selectedRaw?.name ?? '',
      chases: visible.map((chase) => ({
        ...chase,
        obstacleCount: Object.keys(chase.obstacles).length,
      })),
      selected: selected ? await this.#prepareChase(selected, isGM) : null,
    };
  }

  async #prepareChase(chase, isGM) {
    const labels = obstacleLabels(chase.obstacles);
    const obstacles = sortObstacles(chase.obstacles)
      // Players never see obstacles the GM has not unlocked.
      .filter((obstacle) => isGM || !obstacle.locked);

    const preparedObstacles = await Promise.all(
      obstacles.map(async (obstacle, index) => ({
        ...obstacle,
        number: labels.get(obstacle.id) ?? String(index + 1),
        // Siblings at the same step are the alternatives at a fork.
        isBranch: Boolean(obstacle.branch),
        branchSiblings: Object.values(chase.obstacles)
          .filter((o) => o.position === obstacle.position && o.id !== obstacle.id)
          .map((o) => ({ id: o.id, label: labels.get(o.id) ?? '', name: o.name })),
        // The first step has no predecessor, so nothing could route into it.
        canFork: obstacle.position !== stepsOf(chase.obstacles)[0],
        route: routeTargetsFor(chase.obstacles, obstacle.position),
        unrouted: unroutedOptions(obstacle, chase.obstacles).map((o) => o.label),
        cleared: obstacle.chasePoints.current >= obstacle.chasePoints.goal,
        outOfRounds:
          obstacle.rounds?.max != null && (obstacle.rounds?.current ?? 0) >= obstacle.rounds.max,
        percent: obstacle.chasePoints.goal
          ? Math.min(100, Math.round((obstacle.chasePoints.current / obstacle.chasePoints.goal) * 100))
          : 0,
        enrichedOvercome: await enrich(obstacle.overcome),
      })),
    );

    // A GM-pinned obstacle wins; otherwise fall back to the first unfinished
    // one, settling on the last once everything is cleared.
    const pinned = chase.activeObstacle
      ? preparedObstacles.findIndex((obstacle) => obstacle.id === chase.activeObstacle)
      : -1;
    const firstUncleared = preparedObstacles.findIndex((obstacle) => !obstacle.cleared);
    const liveIndex = Math.max(
      0,
      pinned !== -1
        ? pinned
        : firstUncleared === -1
          ? preparedObstacles.length - 1
          : firstUncleared,
    );

    // Players are pinned to the live obstacle; only a GM may browse the rest.
    const index = isGM
      ? Math.clamp(this.#obstacleIndex ?? liveIndex, 0, Math.max(0, preparedObstacles.length - 1))
      : liveIndex;

    const current = preparedObstacles[index] ?? null;

    // The rules track chase points per obstacle - "Chase Points represent the
    // ability of the whole group to bypass the obstacle" - so there is no
    // chase-wide pool to total up. The status bar mirrors the live obstacle
    // instead, which is the number that actually matters at the table.
    const live = preparedObstacles[liveIndex] ?? null;

    const rollOptions = current
      ? Object.values(current.skillOptions ?? {}).sort((a, b) => a.position - b.position)
      : [];

    // Forks available at the step on screen, for reassigning participants.
    const branchOptions = current
      ? sortObstacles(chase.obstacles)
          .filter((o) => o.position === current.position)
          .map((o) => ({ value: o.branch ?? '', label: labels.get(o.id) ?? '', name: o.name }))
      : [];

    const participants = Object.values(chase.participants)
      .filter((participant) => isGM || !participant.hidden)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((participant) => {
        // Only the owner of the actor may roll for it; a GM owns everything.
        const actor = participant.uuid ? fromUuidSync(participant.uuid) : null;
        const owned = Boolean(actor?.isOwner);
        const contribution = participant.contribution ?? {};
        // A participant on branch B faces 2B even while the GM views 2A.
        const target = current
          ? obstacleForParticipant(chase.obstacles, current.position, participant.branch)
          : null;
        const targetId = target?.id ?? current?.id ?? '';
        const targetCleared = target
          ? target.chasePoints.current >= target.chasePoints.goal
          : Boolean(current?.cleared);
        const targetOptions = (target
          ? Object.values(target.skillOptions ?? {}).sort((a, b) => a.position - b.position)
          : rollOptions
        ).map((option) => ({ ...option, routeSuffix: option.leadsTo ? ` → ${option.leadsTo}` : '' }));
        const here = targetId ? (contribution.byObstacle?.[targetId] ?? 0) : 0;
        return {
          ...participant,
          owned,
          missingActor: Boolean(participant.uuid) && !actor,
          // No actor was ever linked, so "not yours" would be misleading -
          // especially for a GM, who owns everything that exists.
          noActor: !participant.uuid,
          // A GM may roll for anyone with an actor, even one who has acted.
          rollObstacleId: targetId,
          rollOptions: targetOptions,
          branchLabel: target?.branch ?? '',
          branchChoices: branchOptions.map((option) => ({
            ...option,
            active: (option.value ?? '') === (target?.branch ?? ''),
          })),
          onOtherBranch: Boolean(target && current && target.id !== current.id),
          canRoll: isGM
            ? Boolean(actor) && targetOptions.length > 0
            : owned && !participant.hasActed && targetOptions.length > 0 && !targetCleared,
          canPass: isGM ? Boolean(targetId) : owned && !participant.hasActed && Boolean(targetId),
          // Distinguishes a GM re-roll from a player's first roll in the UI.
          isReroll: isGM && participant.hasActed,
          // Points can be awarded even to a participant with no linked actor.
          canAward: isGM && Boolean(targetId),
          contributedHere: here,
          contributedTotal: contribution.total ?? 0,
          rollCount: contribution.rolls ?? 0,
          successCount: contribution.successes ?? 0,
          // Only worth showing once someone has actually rolled.
          hasContributed: (contribution.rolls ?? 0) > 0,
        };
      });

    return {
      ...chase,
      obstacles: preparedObstacles,
      currentObstacle: current
        ? {
            ...current,
            isLive: index === liveIndex,
            isPinned: chase.activeObstacle === current.id,
            canPrev: index > 0,
            canNext: index < preparedObstacles.length - 1,
          }
        : null,
      obstacleDots: preparedObstacles.map((obstacle, i) => ({
        index: i,
        number: obstacle.number,
        active: i === index,
        live: i === liveIndex,
        cleared: obstacle.cleared,
        locked: obstacle.locked,
      })),
      obstacleTotal: preparedObstacles.length,
      liveObstacle: live
        ? {
            id: live.id,
            number: live.number,
            name: live.name,
            current: live.chasePoints.current,
            goal: live.chasePoints.goal,
            percent: live.percent,
            cleared: live.cleared,
            // True when the GM has browsed away from the obstacle in play.
            offscreen: liveIndex !== index,
          }
        : null,
      rollOptions,
      hasRollOptions: rollOptions.length > 0,
      branchOptions,
      // A single option is not a fork, so no selector is worth showing.
      hasBranches: branchOptions.length > 1,
      contributionTotal: participants.reduce((sum, p) => sum + p.contributedTotal, 0),
      obstaclePosition: preparedObstacles.length ? index + 1 : 0,
      canGenerate: isGM && hasApiKey(),
      generatingObstacle: this.#generatingObstacle,
      participants,
      enrichedPremise: await enrich(chase.premise),
      enrichedGmNotes: isGM ? await enrich(chase.gmNotes, { secrets: true }) : '',
      complete:
        preparedObstacles.length > 0 && preparedObstacles.every((obstacle) => obstacle.cleared),
      outOfTime: chase.rounds.max !== null && chase.rounds.current >= chase.rounds.max,
      generatedAt: chase.ai?.generatedAt
        ? new Date(chase.ai.generatedAt).toLocaleString()
        : '',
    };
  }

  /** Shape one influence encounter for display. */
  async #prepareInfluence(event, isGM) {
    // Hidden entries are ones the party has not discovered yet.
    const visible = (record) =>
      Object.values(record ?? {})
        .filter((entry) => isGM || !entry.hidden)
        .sort((a, b) => a.position - b.position);

    const modifier = ['weaknesses', 'resistances', 'penalties'].reduce(
      (acc, key) =>
        acc +
        Object.values(event[key] ?? {}).reduce((sum, e) => sum + (e.used ? e.modifier : 0), 0),
      0,
    );

    const withEnriched = async (entries, extraKey) =>
      Promise.all(
        entries.map(async (entry) => ({
          ...entry,
          // The live DC includes whatever the party has uncovered and applied.
          effectiveDC: entry.dc + modifier,
          lockedUntil:
            entry.hidden && entry.revealAt !== null && entry.revealAt !== undefined
              ? entry.revealAt
              : null,
          enrichedDescription: await enrich(entry.description),
          ...(extraKey ? { [`enriched${extraKey}`]: await enrich(entry[extraKey.toLowerCase()]) } : {}),
        })),
      );

    const thresholds = visible(event.thresholds)
      .sort((a, b) => a.points - b.points);
    const enrichedThresholds = await Promise.all(
      thresholds.map(async (threshold) => ({
        ...threshold,
        reached: event.influencePoints >= threshold.points,
        enrichedDescription: await enrich(threshold.description),
      })),
    );
    const next = enrichedThresholds.find((t) => !t.reached) ?? null;

    // One list for the row picker: discoveries first, then ways to win them over.
    /*
     * The picker offers only what the GM has actually put in play, for everyone
     * including the GM. A GM still *sees* hidden entries in the lists below and
     * can reveal one with the eye icon, at which point it becomes rollable -
     * but nothing hidden is ever rollable, so a roll cannot get ahead of what
     * the party has been shown.
     */
    const rollable = (record, kind, prefix = '') =>
      Object.values(record ?? {})
        .filter((entry) => !entry.hidden)
        .sort((a, b) => a.position - b.position)
        .map((entry) => ({
          id: entry.id,
          kind,
          label: `${prefix}${entry.label}`,
          dc: entry.dc + modifier,
        }));

    const rollOptions = [
      ...rollable(event.discoveries, 'discovery', `${game.i18n.localize('PFAI.Influence.DiscoveryPrefix')} `),
      ...rollable(event.influenceSkills, 'influence'),
    ];

    const participants = Object.values(event.participants)
      .filter((p) => isGM || !p.hidden)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((participant) => {
        const actor = participant.uuid ? fromUuidSync(participant.uuid) : null;
        const owned = Boolean(actor?.isOwner);
        const contribution = participant.contribution ?? {};
        return {
          ...participant,
          owned,
          noActor: !participant.uuid,
          missingActor: Boolean(participant.uuid) && !actor,
          canRoll: rollOptions.length > 0 && (isGM ? Boolean(actor) : owned && !participant.hasActed),
          isReroll: isGM && participant.hasActed,
          canAward: isGM,
          rollOptions,
          contributedTotal: contribution.total ?? 0,
          rollCount: contribution.rolls ?? 0,
          successCount: contribution.successes ?? 0,
          discoveryCount: contribution.discoveries ?? 0,
          hasContributed: (contribution.rolls ?? 0) > 0,
        };
      });

    return {
      ...event,
      dcModifier: modifier,
      // An untitled encounter falls back to the NPC's name, so don't print it twice.
      showNpcSubtitle: Boolean(event.npc?.name) && event.npc.name !== event.name,
      discoveries: await withEnriched(visible(event.discoveries), 'Reveals'),
      influenceSkills: await withEnriched(visible(event.influenceSkills)),
      thresholds: enrichedThresholds,
      nextThreshold: next,
      allThresholdsReached: enrichedThresholds.length > 0 && !next,
      weaknesses: await withEnriched(visible(event.weaknesses)),
      resistances: await withEnriched(visible(event.resistances)),
      penalties: await withEnriched(visible(event.penalties)),
      participants,
      rollOptions,
      generatingObstacle: this.#generatingObstacle,
      enrichedPremise: await enrich(event.premise),
      enrichedGoal: await enrich(event.goal),
      enrichedNpcDescription: await enrich(event.npc?.description),
      enrichedNpcWants: isGM ? await enrich(event.npc?.wants) : '',
      enrichedGmNotes: isGM ? await enrich(event.gmNotes, { secrets: true }) : '',
      outOfTime: event.rounds.max !== null && event.rounds.current >= event.rounds.max,
      // Hidden counts tell the GM how much is still undiscovered.
      hiddenCounts: isGM
        ? {
            influenceSkills: Object.values(event.influenceSkills).filter((e) => e.hidden).length,
            weaknesses: Object.values(event.weaknesses).filter((e) => e.hidden).length,
            resistances: Object.values(event.resistances).filter((e) => e.hidden).length,
            thresholds: Object.values(event.thresholds).filter((e) => e.hidden).length,
          }
        : null,
    };
  }

  /** Shape one research event for display. */
  async #prepareResearch(event, isGM) {
    const visible = (record) =>
      Object.values(record ?? {})
        .filter((entry) => isGM || !entry.hidden)
        .sort((a, b) => a.position - b.position);

    const modifier = Object.values(event.events ?? {}).reduce(
      (acc, e) => acc + (e.modifier.active ? e.modifier.value : 0),
      0,
    );

    const sources = await Promise.all(
      visible(event.sources).map(async (source) => {
        const exhausted = source.researchPoints.current >= source.researchPoints.max;
        return {
          ...source,
          exhausted,
          percent: source.researchPoints.max
            ? Math.min(100, Math.round((source.researchPoints.current / source.researchPoints.max) * 100))
            : 0,
          enrichedDescription: await enrich(source.description),
          checks: visible(source.checks).map((check) => ({
            ...check,
            effectiveDC: check.dc + modifier,
            lockedUntil:
              check.hidden && check.revealAt !== null && check.revealAt !== undefined
                ? check.revealAt
                : null,
          })),
          hiddenChecks: isGM ? Object.values(source.checks).filter((c) => c.hidden).length : 0,
        };
      }),
    );

    const thresholds = await Promise.all(
      visible(event.thresholds)
        .sort((a, b) => a.points - b.points)
        .map(async (threshold) => ({
          ...threshold,
          reached: event.researchPoints >= threshold.points,
          enrichedDescription: await enrich(threshold.description),
        })),
    );

    const complications = await Promise.all(
      visible(event.events).map(async (complication) => ({
        ...complication,
        enrichedDescription: await enrich(complication.description),
        triggerLabel: game.i18n.format(
          complication.trigger.kind === 'rounds'
            ? 'PFAI.Research.TriggerRounds'
            : 'PFAI.Research.TriggerPoints',
          { at: complication.trigger.at },
        ),
      })),
    );

    // The picker spans sources, so each option carries both ids. Only revealed,
    // unexhausted sources are rollable - a cap reached is a door closed.
    const rollOptions = sources
      .filter((source) => !source.hidden && !source.exhausted)
      .flatMap((source) =>
        source.checks
          .filter((check) => !check.hidden)
          .map((check) => ({
            value: `${source.id}|${check.id}`,
            label: `${source.name}: ${check.label}`,
            dc: check.effectiveDC,
          })),
      );

    const participants = Object.values(event.participants)
      .filter((p) => isGM || !p.hidden)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((participant) => {
        const actor = participant.uuid ? fromUuidSync(participant.uuid) : null;
        const owned = Boolean(actor?.isOwner);
        const contribution = participant.contribution ?? {};
        return {
          ...participant,
          owned,
          noActor: !participant.uuid,
          missingActor: Boolean(participant.uuid) && !actor,
          canRoll: rollOptions.length > 0 && (isGM ? Boolean(actor) : owned && !participant.hasActed),
          isReroll: isGM && participant.hasActed,
          canAward: isGM,
          rollOptions,
          contributedTotal: contribution.total ?? 0,
          rollCount: contribution.rolls ?? 0,
          successCount: contribution.successes ?? 0,
          hasContributed: (contribution.rolls ?? 0) > 0,
        };
      });

    const next = thresholds.find((t) => !t.reached) ?? null;

    return {
      ...event,
      dcModifier: modifier,
      sources,
      thresholds,
      complications,
      nextThreshold: next,
      allThresholdsReached: thresholds.length > 0 && !next,
      rollOptions,
      participants,
      // How much is still obtainable, so a GM can see if it has become unwinnable.
      remainingCapacity: Object.values(event.sources).reduce(
        (acc, source) => acc + Math.max(0, source.researchPoints.max - source.researchPoints.current),
        0,
      ),
      enrichedPremise: await enrich(event.premise),
      enrichedTopic: await enrich(event.topic),
      enrichedGoal: await enrich(event.goal),
      enrichedGmNotes: isGM ? await enrich(event.gmNotes, { secrets: true }) : '',
      outOfTime: event.rounds.max !== null && event.rounds.current >= event.rounds.max,
      hiddenCounts: isGM
        ? {
            sources: Object.values(event.sources).filter((e) => e.hidden).length,
            thresholds: Object.values(event.thresholds).filter((e) => e.hidden).length,
            events: Object.values(event.events).filter((e) => e.hidden).length,
          }
        : null,
    };
  }

  /** Shape one infiltration for display. */
  async #prepareInfiltration(event, isGM) {
    const visible = (record) =>
      Object.values(record ?? {})
        .filter((entry) => isGM || !entry.hidden)
        .sort((a, b) => a.position - b.position);

    // Only the highest breakpoint passed applies, not the sum of them.
    const modifier = Object.values(event.awarenessBreakpoints ?? {}).reduce(
      (acc, b) => (b.fired ? Math.max(acc, b.dcIncrease) : acc),
      0,
    );

    const prepChecks = (checks) =>
      visible(checks).map((check) => ({ ...check, effectiveDC: check.dc + modifier }));

    const objectives = await Promise.all(
      visible(event.objectives).map(async (objective) => {
        const obstacles = await Promise.all(
          visible(objective.obstacles).map(async (obstacle) => {
            const goal = obstacle.infiltrationPoints.goal;
            const cleared = obstacle.individual
              ? obstacle.infiltrationPoints.current >= Object.keys(event.participants).length &&
                Object.keys(event.participants).length > 0
              : obstacle.infiltrationPoints.current >= goal;
            return {
              ...obstacle,
              cleared,
              // An individual obstacle counts people through, not points.
              progressLabel: obstacle.individual
                ? game.i18n.format('PFAI.Infiltration.ThroughCount', {
                    done: obstacle.infiltrationPoints.current,
                    total: Object.keys(event.participants).length || '?',
                  })
                : `${obstacle.infiltrationPoints.current} / ${goal}`,
              percent: goal
                ? Math.min(100, Math.round((obstacle.infiltrationPoints.current / goal) * 100))
                : 0,
              enrichedDescription: await enrich(obstacle.description),
              checks: prepChecks(obstacle.checks),
            };
          }),
        );
        return {
          ...objective,
          obstacles,
          enrichedDescription: await enrich(objective.description),
          complete: obstacles.length > 0 && obstacles.every((o) => o.cleared),
        };
      }),
    );

    const complications = await Promise.all(
      visible(event.complications).map(async (complication) => ({
        ...complication,
        enrichedDescription: await enrich(complication.description),
        checks: prepChecks(complication.checks),
        triggerLabel: game.i18n.format(
          complication.trigger.kind === 'rounds'
            ? 'PFAI.Infiltration.TriggerRounds'
            : complication.trigger.kind === 'manual'
              ? 'PFAI.Infiltration.TriggerManual'
              : 'PFAI.Infiltration.TriggerAwareness',
          { at: complication.trigger.at },
        ),
      })),
    );

    const opportunities = await Promise.all(
      visible(event.opportunities).map(async (opportunity) => ({
        ...opportunity,
        enrichedDescription: await enrich(opportunity.description),
        enrichedBenefit: await enrich(opportunity.benefit),
        checks: prepChecks(opportunity.checks),
      })),
    );

    const preparations = await Promise.all(
      visible(event.preparations).map(async (preparation) => ({
        ...preparation,
        enrichedDescription: await enrich(preparation.description),
      })),
    );

    const breakpoints = await Promise.all(
      visible(event.awarenessBreakpoints)
        .sort((a, b) => a.at - b.at)
        .map(async (breakpoint) => ({
          ...breakpoint,
          passed: event.awareness.current >= breakpoint.at,
          enrichedDescription: await enrich(breakpoint.description),
        })),
    );

    // A fired complication blocks everything else, so it owns the picker.
    const blocking = complications.filter((c) => c.fired && !c.resolved);
    const rollOptions = blocking.length
      ? blocking.flatMap((complication) =>
          complication.checks.map((check) => ({
            value: `complication|${complication.id}||${check.id}`,
            label: `${complication.name}: ${check.label}`,
            dc: check.effectiveDC,
          })),
        )
      : [
          ...objectives.flatMap((objective) =>
            objective.obstacles
              .filter((obstacle) => !obstacle.hidden && !obstacle.cleared)
              .flatMap((obstacle) =>
                obstacle.checks.map((check) => ({
                  value: `obstacle|${obstacle.id}|${objective.id}|${check.id}`,
                  label: `${obstacle.name}: ${check.label}`,
                  dc: check.effectiveDC,
                })),
              ),
          ),
          ...opportunities
            .filter((opportunity) => !opportunity.hidden && !opportunity.used)
            .flatMap((opportunity) =>
              opportunity.checks.map((check) => ({
                value: `opportunity|${opportunity.id}||${check.id}`,
                label: `${game.i18n.localize('PFAI.Infiltration.OpportunityPrefix')} ${opportunity.name}: ${check.label}`,
                dc: check.effectiveDC,
              })),
            ),
        ];

    const participants = Object.values(event.participants)
      .filter((p) => isGM || !p.hidden)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((participant) => {
        const actor = participant.uuid ? fromUuidSync(participant.uuid) : null;
        const owned = Boolean(actor?.isOwner);
        const contribution = participant.contribution ?? {};
        return {
          ...participant,
          owned,
          noActor: !participant.uuid,
          missingActor: Boolean(participant.uuid) && !actor,
          canRoll: rollOptions.length > 0 && (isGM ? Boolean(actor) : owned && !participant.hasActed),
          isReroll: isGM && participant.hasActed,
          canAward: isGM,
          canSpendEdge: isGM && event.edgePoints > 0 && rollOptions.length > 0,
          rollOptions,
          contributedTotal: contribution.total ?? 0,
          rollCount: contribution.rolls ?? 0,
          successCount: contribution.successes ?? 0,
          awarenessCaused: contribution.awarenessCaused ?? 0,
          hasContributed: (contribution.rolls ?? 0) > 0,
        };
      });

    const next = breakpoints.find((b) => !b.passed) ?? null;

    return {
      ...event,
      dcModifier: modifier,
      objectives,
      complications,
      opportunities,
      preparations,
      breakpoints,
      nextBreakpoint: next,
      blocking,
      isBlocked: blocking.length > 0,
      rollOptions,
      participants,
      enrichedPremise: await enrich(event.premise),
      enrichedTarget: await enrich(event.target),
      enrichedGoal: await enrich(event.goal),
      enrichedGmNotes: isGM ? await enrich(event.gmNotes, { secrets: true }) : '',
      outOfTime: event.rounds.max !== null && event.rounds.current >= event.rounds.max,
      complete:
        objectives.length > 0 && objectives.every((objective) => objective.complete),
      hiddenCounts: isGM
        ? {
            objectives: Object.values(event.objectives).filter((e) => e.hidden).length,
            complications: Object.values(event.complications).filter((e) => e.hidden).length,
            opportunities: Object.values(event.opportunities).filter((e) => e.hidden).length,
            breakpoints: Object.values(event.awarenessBreakpoints).filter((e) => e.hidden).length,
          }
        : null,
    };
  }

  /** Shape one organisation for display. */
  async #prepareLeadership(org, isGM) {
    const visible = (record) =>
      Object.values(record ?? {})
        .filter((entry) => isGM || !entry.hidden)
        .sort((a, b) => a.position - b.position);

    const size = organizationSize(org.organizationLevel);

    const lieutenants = await Promise.all(
      visible(org.lieutenants).map(async (lieutenant) => ({
        ...lieutenant,
        // Prefer the linked actor's portrait when the GM has one.
        img: lieutenant.img || fromUuidSync(lieutenant.uuid)?.img || '',
        enrichedDescription: await enrich(lieutenant.description),
      })),
    );

    const events = await Promise.all(
      visible(org.events)
        .sort((a, b) => (a.revealAt ?? 0) - (b.revealAt ?? 0))
        .map(async (event) => ({
          ...event,
          kindLabel: game.i18n.localize(
            LEADERSHIP_EVENT_KINDS[event.kind] ?? LEADERSHIP_EVENT_KINDS.opportunity,
          ),
          lockedUntil:
            event.hidden && event.revealAt !== null && org.organizationLevel < event.revealAt
              ? event.revealAt
              : null,
          enrichedDescription: await enrich(event.description),
          enrichedOutcome: await enrich(event.outcome),
          checks: visible(event.checks).map((check) => ({ ...check, effectiveDC: check.dc })),
        })),
    );

    // Only unresolved, revealed events are worth rolling against.
    const rollOptions = events
      .filter((event) => !event.hidden && !event.resolved)
      .flatMap((event) =>
        event.checks.map((check) => ({
          value: `${event.id}|${check.id}`,
          label: `${event.name}: ${check.label}`,
          dc: check.effectiveDC,
        })),
      );

    const participants = Object.values(org.participants)
      .filter((p) => isGM || !p.hidden)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((participant) => {
        const actor = participant.uuid ? fromUuidSync(participant.uuid) : null;
        const owned = Boolean(actor?.isOwner);
        const contribution = participant.contribution ?? {};
        return {
          ...participant,
          owned,
          noActor: !participant.uuid,
          missingActor: Boolean(participant.uuid) && !actor,
          canRoll: rollOptions.length > 0 && (isGM ? Boolean(actor) : owned && !participant.hasActed),
          isReroll: isGM && participant.hasActed,
          canAward: isGM,
          rollOptions,
          contributedTotal: contribution.total ?? 0,
          rollCount: contribution.rolls ?? 0,
          successCount: contribution.successes ?? 0,
          hasContributed: (contribution.rolls ?? 0) > 0,
        };
      });

    return {
      ...org,
      size,
      lieutenants,
      events,
      pendingCount: events.filter((e) => !e.resolved).length,
      rollOptions,
      participants,
      enrichedOrganization: await enrich(org.organization),
      enrichedPremise: await enrich(org.premise),
      enrichedGoal: await enrich(org.goal),
      enrichedGmNotes: isGM ? await enrich(org.gmNotes, { secrets: true }) : '',
      atMaxLevel: org.organizationLevel >= 20,
      hiddenCounts: isGM
        ? {
            events: Object.values(org.events).filter((e) => e.hidden).length,
            lieutenants: Object.values(org.lieutenants).filter((e) => e.hidden).length,
          }
        : null,
    };
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  static async #onRollInfluence(_event, target) {
    const { influenceId, participantId } = target.dataset;
    const row = target.closest('.pfai-participant');
    const select = row?.querySelector('.pfai-roll-option');
    // The option carries which list it came from, since the two score differently.
    const entryId = select?.value ?? target.dataset.entryId;
    const kind = select?.selectedOptions?.[0]?.dataset.kind ?? target.dataset.kind;
    if (!entryId) return;
    await rollInfluenceCheck({ influenceId, participantId, entryId, kind, force: game.user.isGM });
  }

  /** Add an empty approach for the GM to write. */
  static async #onAddThreshold(_event, target) {
    const { influenceId } = target.dataset;
    await updateInfluence(influenceId, (event) => {
      const id = foundry.utils.randomID();
      const highest = Object.values(event.thresholds).reduce((max, t) => Math.max(max, t.points), 0);
      event.thresholds[id] = {
        id,
        position: nextPosition(event.thresholds),
        // Cost more than the last one, since thresholds ascend.
        points: highest + 2,
        name: game.i18n.localize('PFAI.Influence.NewThreshold'),
        description: '',
        hidden: true,
      };
    });
  }

  static async #onEditThreshold(_event, target) {
    const { influenceId, entryId } = target.dataset;
    const event = getInfluence(influenceId);
    const threshold = event?.thresholds?.[entryId];
    if (!threshold) return;

    const result = await DialogV2.prompt({
      window: { title: game.i18n.localize('PFAI.Influence.EditThreshold') },
      position: { width: 560 },
      content: `<div class="pfai-form">
        <div class="pfai-field-row">
          <label class="pfai-field pfai-field-wide"><span>${game.i18n.localize('PFAI.Influence.ConcessionName')}</span>
            <input type="text" name="name" value="${escapeHTML(threshold.name)}"></label>
          <label class="pfai-field"><span>${game.i18n.localize('PFAI.Influence.Points')}</span>
            <input type="number" name="points" min="1" step="1" value="${threshold.points}"></label>
        </div>
        <label class="pfai-field"><span>${game.i18n.localize('PFAI.Influence.WhatTheyDo')}</span>
          <textarea name="description" rows="4">${escapeHTML(threshold.description)}</textarea></label>
      </div>`,
      ok: { label: game.i18n.localize('PFAI.Save'), callback: (_e, button) => formValues(button) },
    });
    if (!result) return;

    await updateInfluence(influenceId, (draft) => {
      const edited = draft.thresholds[entryId];
      if (!edited) return;
      edited.name = String(result.name ?? edited.name);
      edited.points = Math.max(1, Number(result.points) || edited.points);
      edited.description = String(result.description ?? '');
      // Lowering it below the current total means it has already been earned.
      if (draft.influencePoints >= edited.points) edited.hidden = false;
    });
  }

  static async #onDeleteThreshold(_event, target) {
    const { influenceId, entryId } = target.dataset;
    const store = getInfluences();
    const event = store.events[influenceId];
    if (!event) return;
    const { [entryId]: _removed, ...remaining } = event.thresholds;
    event.thresholds = remaining;
    await setInfluences(store);
  }

  /** Add a soft spot, resistance or blunder. */
  static async #onAddTrait(_event, target) {
    const { influenceId, collection } = target.dataset;
    await updateInfluence(influenceId, (event) => {
      const id = foundry.utils.randomID();
      event[collection][id] = {
        id,
        position: nextPosition(event[collection]),
        name: game.i18n.localize('PFAI.Influence.NewTrait'),
        description: '',
        // Weaknesses ease the DC; the other two raise it.
        modifier: collection === 'weaknesses' ? -2 : 2,
        used: false,
        hidden: true,
      };
    });
  }

  static async #onEditTrait(_event, target) {
    const { influenceId, collection, entryId } = target.dataset;
    const event = getInfluence(influenceId);
    const trait = event?.[collection]?.[entryId];
    if (!trait) return;

    const eases = collection === 'weaknesses';
    const magnitude = Math.abs(trait.modifier) >= 5 ? 5 : 2;
    const option = (value, key) =>
      `<option value="${value}" ${value === magnitude ? 'selected' : ''}>${game.i18n.localize(key)}</option>`;

    const result = await DialogV2.prompt({
      window: { title: game.i18n.localize('PFAI.Influence.EditTrait') },
      position: { width: 560 },
      content: `<div class="pfai-form">
        <div class="pfai-field-row">
          <label class="pfai-field pfai-field-wide"><span>${game.i18n.localize('PFAI.Influence.TraitName')}</span>
            <input type="text" name="name" value="${escapeHTML(trait.name)}"></label>
          <label class="pfai-field"><span>${game.i18n.localize('PFAI.Influence.Strength')}</span>
            <select name="magnitude">
              ${option(2, eases ? 'PFAI.Influence.MinorEase' : 'PFAI.Influence.MinorRaise')}
              ${option(5, eases ? 'PFAI.Influence.MajorEase' : 'PFAI.Influence.MajorRaise')}
            </select></label>
        </div>
        <label class="pfai-field"><span>${game.i18n.localize('PFAI.Influence.TraitDescription')}</span>
          <textarea name="description" rows="3">${escapeHTML(trait.description)}</textarea>
          <small>${game.i18n.localize('PFAI.Influence.TraitDescriptionHint')}</small></label>
      </div>`,
      ok: { label: game.i18n.localize('PFAI.Save'), callback: (_e, button) => formValues(button) },
    });
    if (!result) return;

    await updateInfluence(influenceId, (draft) => {
      const edited = draft[collection][entryId];
      if (!edited) return;
      edited.name = String(result.name ?? edited.name);
      edited.description = String(result.description ?? '');
      edited.modifier = (eases ? -1 : 1) * (Number(result.magnitude) === 5 ? 5 : 2);
    });
  }

  static async #onDeleteTrait(_event, target) {
    const { influenceId, collection, entryId } = target.dataset;
    const store = getInfluences();
    const event = store.events[influenceId];
    if (!event) return;
    const { [entryId]: _removed, ...remaining } = event[collection];
    event[collection] = remaining;
    await setInfluences(store);
  }

  static async #onAddApproach(_event, target) {
    const { influenceId, collection } = target.dataset;
    await updateInfluence(influenceId, (event) => {
      const id = foundry.utils.randomID();
      event[collection][id] = {
        id,
        position: nextPosition(event[collection]),
        slug: 'diplomacy',
        label: game.i18n.localize('PFAI.Influence.NewApproach'),
        dc: event.baseDC,
        description: '',
        hidden: true,
        revealAt: null,
        ...(collection === 'discoveries' ? { reveals: '' } : {}),
      };
    });
  }

  /** Generate one further approach, aware of the ones already present. */
  static async #onGenerateApproach(_event, target) {
    if (this.#generatingObstacle) return;
    const { influenceId, collection } = target.dataset;
    const event = getInfluence(influenceId);
    if (!event) return;

    if (!hasApiKey()) {
      ui.notifications.error(game.i18n.localize('PFAI.Errors.NoApiKey'));
      return;
    }

    this.#generatingObstacle = true;
    await this.render();
    try {
      const kind = collection === 'discoveries' ? 'discovery' : 'influence';
      const existingLabels = [
        ...Object.values(event.discoveries ?? {}),
        ...Object.values(event.influenceSkills ?? {}),
      ].map((e) => e.label);

      const approach = await generateApproach({
        premise: htmlToText(event.premise),
        npcName: event.npc?.name ?? '',
        npcDescription: htmlToText(event.npc?.description),
        goal: htmlToText(event.goal),
        baseDC: event.baseDC,
        level: event.level,
        partySize: event.partySize,
        roundLimit: event.rounds?.max ?? 0,
        language: game.settings.get(MODULE_ID, 'outputLanguage')?.trim() || game.i18n.lang,
        kind,
        existingLabels,
        // Later approaches should read as a conversation that has moved on.
        becauseOf: event.influencePoints > 0
          ? game.i18n.format('PFAI.Influence.BecauseProgress', { points: event.influencePoints })
          : '',
      });

      await updateInfluence(influenceId, (draft) => {
        const entry = toApproachEntry(approach, draft.baseDC, {
          position: nextPosition(draft[collection]),
          hidden: true,
          // Default it to unlock at the next concession, which is the usual intent.
          revealAt:
            Object.values(draft.thresholds)
              .map((t) => t.points)
              .sort((a, b) => a - b)
              .find((p) => p > draft.influencePoints) ?? null,
        });
        draft[collection][entry.id] = entry;
      });
      ui.notifications.info(game.i18n.format('PFAI.Influence.ApproachAdded', { name: approach.description || '' }));
    } catch (error) {
      console.error(`${MODULE_ID} | approach generation failed`, error);
      ui.notifications.error(error.message, { permanent: true });
    } finally {
      this.#generatingObstacle = false;
      await this.render();
    }
  }

  /** Edit an approach, including when it should surface on its own. */
  static async #onEditApproach(_event, target) {
    const { influenceId, collection, entryId } = target.dataset;
    const event = getInfluence(influenceId);
    const entry = event?.[collection]?.[entryId];
    if (!entry) return;

    const skillOptions = PF2E_SKILLS.filter((skill) => skill !== 'lore')
      .map((skill) => `<option value="${skill}" ${skill === entry.slug ? 'selected' : ''}>${capitalize(skill)}</option>`)
      .join('');
    const isDiscovery = collection === 'discoveries';

    const result = await DialogV2.prompt({
      window: { title: game.i18n.localize('PFAI.Influence.EditApproach') },
      position: { width: 560 },
      content: `<div class="pfai-form">
        <label class="pfai-field"><span>${game.i18n.localize('PFAI.Influence.ApproachLabel')}</span>
          <input type="text" name="label" value="${escapeHTML(entry.label)}"></label>
        <div class="pfai-field-row">
          <label class="pfai-field"><span>${game.i18n.localize('PFAI.Influence.Statistic')}</span>
            <select name="slug">${skillOptions}
              <option value="${escapeHTML(entry.slug)}" selected>${escapeHTML(entry.slug)}</option>
            </select>
            <small>${game.i18n.localize('PFAI.Influence.StatisticHint')}</small></label>
          <label class="pfai-field"><span>${game.i18n.localize('PFAI.Chase.DC')}</span>
            <input type="number" name="dc" min="1" step="1" value="${entry.dc}"></label>
          <label class="pfai-field"><span>${game.i18n.localize('PFAI.Influence.RevealAt')}</span>
            <input type="number" name="revealAt" min="0" step="1" value="${entry.revealAt ?? ''}">
            <small>${game.i18n.localize('PFAI.Influence.RevealAtHint')}</small></label>
        </div>
        <label class="pfai-field"><span>${game.i18n.localize('PFAI.Chase.ApproachDescription')}</span>
          <input type="text" name="description" value="${escapeHTML(entry.description)}"></label>
        ${isDiscovery ? `<label class="pfai-field"><span>${game.i18n.localize('PFAI.Influence.Reveals')}</span>
          <textarea name="reveals" rows="3">${escapeHTML(entry.reveals ?? '')}</textarea></label>` : ''}
      </div>`,
      ok: { label: game.i18n.localize('PFAI.Save'), callback: (_e, button) => formValues(button) },
    });
    if (!result) return;

    await updateInfluence(influenceId, (draft) => {
      const edited = draft[collection][entryId];
      if (!edited) return;
      edited.label = String(result.label ?? edited.label);
      edited.slug = String(result.slug ?? edited.slug);
      edited.dc = Math.max(1, Number(result.dc) || edited.dc);
      edited.description = String(result.description ?? '');
      if (isDiscovery) edited.reveals = String(result.reveals ?? '');
      const at = String(result.revealAt ?? '').trim();
      edited.revealAt = at === '' ? null : Math.max(0, Number(at) || 0);
      // Setting a threshold already passed should surface it immediately.
      if (edited.revealAt !== null && draft.influencePoints >= edited.revealAt) edited.hidden = false;
    });
  }

  static async #onDeleteApproach(_event, target) {
    const { influenceId, collection, entryId } = target.dataset;
    const store = getInfluences();
    const event = store.events[influenceId];
    if (!event) return;
    const { [entryId]: _removed, ...remaining } = event[collection];
    event[collection] = remaining;
    await setInfluences(store);
  }

  static async #onAwardInfluence(_event, target) {
    const { influenceId, participantId } = target.dataset;
    await adjustInfluenceContribution({
      influenceId,
      participantId,
      delta: Number(target.dataset.delta),
    });
  }

  static #onSwitchSubsystem(_event, target) {
    this.#subsystem = target.dataset.subsystem ?? 'chase';
    this.render();
  }

  static async #onAddSource(_event, target) {
    await updateResearch(target.dataset.researchId, (event) => {
      const id = foundry.utils.randomID();
      event.sources[id] = {
        id,
        position: nextPosition(event.sources),
        name: game.i18n.localize('PFAI.Research.NewSource'),
        description: '',
        hidden: true,
        revealAt: null,
        researchPoints: { current: 0, max: 3 },
        checks: {},
      };
    });
  }

  static async #onGenerateSource(_event, target) {
    if (this.#generatingObstacle) return;
    const researchId = target.dataset.researchId;
    const event = getResearch(researchId);
    if (!event) return;
    if (!hasApiKey()) {
      ui.notifications.error(game.i18n.localize('PFAI.Errors.NoApiKey'));
      return;
    }

    this.#generatingObstacle = true;
    await this.render();
    try {
      const source = await generateSource({
        premise: htmlToText(event.premise),
        topic: htmlToText(event.topic),
        goal: htmlToText(event.goal),
        baseDC: event.baseDC,
        level: event.level,
        partySize: event.partySize,
        roundLimit: event.rounds?.max ?? 0,
        language: game.settings.get(MODULE_ID, 'outputLanguage')?.trim() || game.i18n.lang,
        existingNames: Object.values(event.sources).map((s) => s.name),
        becauseOf: event.researchPoints > 0
          ? game.i18n.format('PFAI.Research.BecauseProgress', { points: event.researchPoints })
          : '',
      });

      await updateResearch(researchId, (draft) => {
        const entry = toSourceEntry(source, draft.baseDC, {
          position: nextPosition(draft.sources),
          hidden: true,
        });
        draft.sources[entry.id] = entry;
      });
      ui.notifications.info(game.i18n.format('PFAI.Research.SourceAdded', { name: source.name }));
    } catch (error) {
      console.error(`${MODULE_ID} | source generation failed`, error);
      ui.notifications.error(error.message, { permanent: true });
    } finally {
      this.#generatingObstacle = false;
      await this.render();
    }
  }

  static async #onEditSource(_event, target) {
    const { researchId, entryId } = target.dataset;
    const event = getResearch(researchId);
    const source = event?.sources?.[entryId];
    if (!source) return;

    const result = await DialogV2.prompt({
      window: { title: game.i18n.localize('PFAI.Research.EditSource') },
      position: { width: 580 },
      content: `<div class="pfai-form">
        <label class="pfai-field"><span>${game.i18n.localize('PFAI.Research.SourceName')}</span>
          <input type="text" name="name" value="${escapeHTML(source.name)}"></label>
        <div class="pfai-field-row">
          <label class="pfai-field"><span>${game.i18n.localize('PFAI.Research.MaxPoints')}</span>
            <input type="number" name="max" min="1" step="1" value="${source.researchPoints.max}">
            <small>${game.i18n.localize('PFAI.Research.MaxPointsHint')}</small></label>
          <label class="pfai-field"><span>${game.i18n.localize('PFAI.Research.TakenSoFar')}</span>
            <input type="number" name="current" min="0" step="1" value="${source.researchPoints.current}"></label>
          <label class="pfai-field"><span>${game.i18n.localize('PFAI.Influence.RevealAt')}</span>
            <input type="number" name="revealAt" min="0" step="1" value="${source.revealAt ?? ''}">
            <small>${game.i18n.localize('PFAI.Research.RevealAtHint')}</small></label>
        </div>
        <label class="pfai-field"><span>${game.i18n.localize('PFAI.Research.SourceDescription')}</span>
          <textarea name="description" rows="4">${escapeHTML(source.description)}</textarea></label>
      </div>`,
      ok: { label: game.i18n.localize('PFAI.Save'), callback: (_e, button) => formValues(button) },
    });
    if (!result) return;

    await updateResearch(researchId, (draft) => {
      const edited = draft.sources[entryId];
      if (!edited) return;
      edited.name = String(result.name ?? edited.name);
      edited.description = String(result.description ?? '');
      edited.researchPoints.max = Math.max(1, Number(result.max) || edited.researchPoints.max);
      edited.researchPoints.current = Math.clamp(
        Number(result.current) || 0,
        0,
        edited.researchPoints.max,
      );
      const at = String(result.revealAt ?? '').trim();
      edited.revealAt = at === '' ? null : Math.max(0, Number(at) || 0);
      if (edited.revealAt !== null && draft.researchPoints >= edited.revealAt) edited.hidden = false;
    });
  }

  static async #onDeleteSource(_event, target) {
    const { researchId, entryId } = target.dataset;
    const store = getResearches();
    const event = store.events[researchId];
    if (!event) return;
    const { [entryId]: _removed, ...remaining } = event.sources;
    event.sources = remaining;
    await setResearches(store);
  }

  static async #onAddCheck(_event, target) {
    const { researchId, sourceId } = target.dataset;
    await updateResearch(researchId, (event) => {
      const source = event.sources[sourceId];
      if (!source) return;
      const id = foundry.utils.randomID();
      source.checks[id] = {
        id,
        position: nextPosition(source.checks),
        slug: 'society',
        label: game.i18n.localize('PFAI.Research.NewCheck'),
        dc: event.baseDC,
        description: '',
        hidden: false,
        revealAt: null,
      };
    });
  }

  static async #onEditCheck(_event, target) {
    const { researchId, sourceId, entryId } = target.dataset;
    const event = getResearch(researchId);
    const check = event?.sources?.[sourceId]?.checks?.[entryId];
    if (!check) return;

    const skillOptions = PF2E_SKILLS.filter((skill) => skill !== 'lore')
      .map((skill) => `<option value="${skill}" ${skill === check.slug ? 'selected' : ''}>${capitalize(skill)}</option>`)
      .join('');

    const result = await DialogV2.prompt({
      window: { title: game.i18n.localize('PFAI.Research.EditCheck') },
      position: { width: 580 },
      content: `<div class="pfai-form">
        <label class="pfai-field"><span>${game.i18n.localize('PFAI.Influence.ApproachLabel')}</span>
          <input type="text" name="label" value="${escapeHTML(check.label)}"></label>
        <div class="pfai-field-row">
          <label class="pfai-field"><span>${game.i18n.localize('PFAI.Influence.Statistic')}</span>
            <select name="slug">${skillOptions}
              <option value="${escapeHTML(check.slug)}" selected>${escapeHTML(check.slug)}</option>
            </select>
            <small>${game.i18n.localize('PFAI.Influence.StatisticHint')}</small></label>
          <label class="pfai-field"><span>${game.i18n.localize('PFAI.Chase.DC')}</span>
            <input type="number" name="dc" min="1" step="1" value="${check.dc}"></label>
          <label class="pfai-field"><span>${game.i18n.localize('PFAI.Influence.RevealAt')}</span>
            <input type="number" name="revealAt" min="0" step="1" value="${check.revealAt ?? ''}">
            <small>${game.i18n.localize('PFAI.Research.RevealAtHint')}</small></label>
        </div>
        <label class="pfai-field"><span>${game.i18n.localize('PFAI.Chase.ApproachDescription')}</span>
          <input type="text" name="description" value="${escapeHTML(check.description)}"></label>
      </div>`,
      ok: { label: game.i18n.localize('PFAI.Save'), callback: (_e, button) => formValues(button) },
    });
    if (!result) return;

    await updateResearch(researchId, (draft) => {
      const edited = draft.sources[sourceId]?.checks?.[entryId];
      if (!edited) return;
      edited.label = String(result.label ?? edited.label);
      edited.slug = String(result.slug ?? edited.slug);
      edited.dc = Math.max(1, Number(result.dc) || edited.dc);
      edited.description = String(result.description ?? '');
      const at = String(result.revealAt ?? '').trim();
      edited.revealAt = at === '' ? null : Math.max(0, Number(at) || 0);
      if (edited.revealAt !== null && draft.researchPoints >= edited.revealAt) edited.hidden = false;
    });
  }

  static async #onDeleteCheck(_event, target) {
    const { researchId, sourceId, entryId } = target.dataset;
    const store = getResearches();
    const source = store.events[researchId]?.sources?.[sourceId];
    if (!source) return;
    const { [entryId]: _removed, ...remaining } = source.checks;
    source.checks = remaining;
    await setResearches(store);
  }

  static async #onAddFinding(_event, target) {
    await updateResearch(target.dataset.researchId, (event) => {
      const id = foundry.utils.randomID();
      const highest = Object.values(event.thresholds).reduce((max, t) => Math.max(max, t.points), 0);
      event.thresholds[id] = {
        id,
        position: nextPosition(event.thresholds),
        points: highest + 2,
        name: game.i18n.localize('PFAI.Research.NewFinding'),
        description: '',
        hidden: true,
      };
    });
  }

  static async #onEditFinding(_event, target) {
    const { researchId, entryId } = target.dataset;
    const event = getResearch(researchId);
    const threshold = event?.thresholds?.[entryId];
    if (!threshold) return;

    const result = await DialogV2.prompt({
      window: { title: game.i18n.localize('PFAI.Research.EditFinding') },
      position: { width: 560 },
      content: `<div class="pfai-form">
        <div class="pfai-field-row">
          <label class="pfai-field pfai-field-wide"><span>${game.i18n.localize('PFAI.Research.FindingName')}</span>
            <input type="text" name="name" value="${escapeHTML(threshold.name)}"></label>
          <label class="pfai-field"><span>${game.i18n.localize('PFAI.Research.Points')}</span>
            <input type="number" name="points" min="1" step="1" value="${threshold.points}"></label>
        </div>
        <label class="pfai-field"><span>${game.i18n.localize('PFAI.Research.WhatTheyLearn')}</span>
          <textarea name="description" rows="4">${escapeHTML(threshold.description)}</textarea></label>
      </div>`,
      ok: { label: game.i18n.localize('PFAI.Save'), callback: (_e, button) => formValues(button) },
    });
    if (!result) return;

    await updateResearch(researchId, (draft) => {
      const edited = draft.thresholds[entryId];
      if (!edited) return;
      edited.name = String(result.name ?? edited.name);
      edited.points = Math.max(1, Number(result.points) || edited.points);
      edited.description = String(result.description ?? '');
      if (draft.researchPoints >= edited.points) edited.hidden = false;
    });
  }

  static async #onDeleteFinding(_event, target) {
    const { researchId, entryId } = target.dataset;
    const store = getResearches();
    const event = store.events[researchId];
    if (!event) return;
    const { [entryId]: _removed, ...remaining } = event.thresholds;
    event.thresholds = remaining;
    await setResearches(store);
  }

  static async #onAddComplication(_event, target) {
    await updateResearch(target.dataset.researchId, (event) => {
      const id = foundry.utils.randomID();
      event.events[id] = {
        id,
        position: nextPosition(event.events),
        name: game.i18n.localize('PFAI.Research.NewComplication'),
        description: '',
        hidden: true,
        trigger: { kind: 'points', at: Math.max(1, event.researchPoints + 2) },
        fired: false,
        modifier: { value: 0, active: false },
      };
    });
  }

  static async #onEditComplication(_event, target) {
    const { researchId, entryId } = target.dataset;
    const event = getResearch(researchId);
    const complication = event?.events?.[entryId];
    if (!complication) return;

    const kindOption = (value, key) =>
      `<option value="${value}" ${value === complication.trigger.kind ? 'selected' : ''}>${game.i18n.localize(key)}</option>`;

    const result = await DialogV2.prompt({
      window: { title: game.i18n.localize('PFAI.Research.EditComplication') },
      position: { width: 600 },
      content: `<div class="pfai-form">
        <label class="pfai-field"><span>${game.i18n.localize('PFAI.Research.ComplicationName')}</span>
          <input type="text" name="name" value="${escapeHTML(complication.name)}"></label>
        <div class="pfai-field-row">
          <label class="pfai-field"><span>${game.i18n.localize('PFAI.Research.TriggerKind')}</span>
            <select name="kind">
              ${kindOption('points', 'PFAI.Research.TriggerKindPoints')}
              ${kindOption('rounds', 'PFAI.Research.TriggerKindRounds')}
            </select></label>
          <label class="pfai-field"><span>${game.i18n.localize('PFAI.Research.TriggerAt')}</span>
            <input type="number" name="at" min="1" step="1" value="${complication.trigger.at}"></label>
          <label class="pfai-field"><span>${game.i18n.localize('PFAI.Research.DCShift')}</span>
            <input type="number" name="dcShift" min="-10" max="10" step="1" value="${complication.modifier.value}">
            <small>${game.i18n.localize('PFAI.Research.DCShiftHint')}</small></label>
        </div>
        <label class="pfai-field"><span>${game.i18n.localize('PFAI.Research.WhatHappens')}</span>
          <textarea name="description" rows="4">${escapeHTML(complication.description)}</textarea></label>
      </div>`,
      ok: { label: game.i18n.localize('PFAI.Save'), callback: (_e, button) => formValues(button) },
    });
    if (!result) return;

    await updateResearch(researchId, (draft) => {
      const edited = draft.events[entryId];
      if (!edited) return;
      edited.name = String(result.name ?? edited.name);
      edited.description = String(result.description ?? '');
      edited.trigger.kind = result.kind === 'rounds' ? 'rounds' : 'points';
      edited.trigger.at = Math.max(1, Number(result.at) || edited.trigger.at);
      edited.modifier.value = Math.clamp(Number(result.dcShift) || 0, -10, 10);
    });
  }

  static async #onDeleteComplication(_event, target) {
    const { researchId, entryId } = target.dataset;
    const store = getResearches();
    const event = store.events[researchId];
    if (!event) return;
    const { [entryId]: _removed, ...remaining } = event.events;
    event.events = remaining;
    await setResearches(store);
  }

  static async #onAddObjective(_event, target) {
    await updateInfiltration(target.dataset.infiltrationId, (event) => {
      const id = foundry.utils.randomID();
      event.objectives[id] = {
        id,
        position: nextPosition(event.objectives),
        name: game.i18n.localize('PFAI.Infiltration.NewObjective'),
        description: '',
        hidden: true,
        obstacles: {},
      };
    });
  }

  static async #onEditObjective(_event, target) {
    const { infiltrationId, entryId } = target.dataset;
    const event = getInfiltration(infiltrationId);
    const objective = event?.objectives?.[entryId];
    if (!objective) return;
    const result = await DialogV2.prompt({
      window: { title: game.i18n.localize('PFAI.Infiltration.EditObjective') },
      position: { width: 560 },
      content: `<div class="pfai-form">
        <label class="pfai-field"><span>${game.i18n.localize('PFAI.Infiltration.ObjectiveName')}</span>
          <input type="text" name="name" value="${escapeHTML(objective.name)}"></label>
        <label class="pfai-field"><span>${game.i18n.localize('PFAI.Infiltration.WhatStageIsThis')}</span>
          <textarea name="description" rows="3">${escapeHTML(objective.description)}</textarea></label>
      </div>`,
      ok: { label: game.i18n.localize('PFAI.Save'), callback: (_e, b) => formValues(b) },
    });
    if (!result) return;
    await updateInfiltration(infiltrationId, (draft) => {
      const edited = draft.objectives[entryId];
      if (!edited) return;
      edited.name = String(result.name ?? edited.name);
      edited.description = String(result.description ?? '');
    });
  }

  static async #onDeleteObjective(_event, target) {
    const { infiltrationId, entryId } = target.dataset;
    const store = getInfiltrations();
    const event = store.events[infiltrationId];
    if (!event) return;
    const { [entryId]: _removed, ...remaining } = event.objectives;
    event.objectives = remaining;
    await setInfiltrations(store);
  }

  static async #onAddInfiltrationObstacle(_event, target) {
    const { infiltrationId, objectiveId } = target.dataset;
    await updateInfiltration(infiltrationId, (event) => {
      const objective = event.objectives[objectiveId];
      if (!objective) return;
      const id = foundry.utils.randomID();
      objective.obstacles[id] = {
        id,
        position: nextPosition(objective.obstacles),
        name: game.i18n.localize('PFAI.Chase.NewObstacle'),
        description: '',
        hidden: false,
        revealAt: null,
        individual: false,
        infiltrationPoints: { current: 0, goal: 2 },
        individualPoints: {},
        checks: {},
      };
    });
  }

  static async #onGenerateInfiltrationObstacle(_event, target) {
    if (this.#generatingObstacle) return;
    const { infiltrationId, objectiveId } = target.dataset;
    const event = getInfiltration(infiltrationId);
    const objective = event?.objectives?.[objectiveId];
    if (!objective) return;
    if (!hasApiKey()) {
      ui.notifications.error(game.i18n.localize('PFAI.Errors.NoApiKey'));
      return;
    }

    this.#generatingObstacle = true;
    await this.render();
    try {
      const obstacle = await generateInfiltrationObstacle({
        premise: htmlToText(event.premise),
        target: htmlToText(event.target),
        goal: htmlToText(event.goal),
        baseDC: event.baseDC,
        level: event.level,
        partySize: event.partySize,
        roundLimit: event.rounds?.max ?? 0,
        language: game.settings.get(MODULE_ID, 'outputLanguage')?.trim() || game.i18n.lang,
        objectiveName: objective.name,
        existingNames: Object.values(objective.obstacles).map((o) => o.name),
        becauseOf: event.awareness.current > 0
          ? game.i18n.format('PFAI.Infiltration.BecauseAwareness', { awareness: event.awareness.current })
          : '',
      });

      await updateInfiltration(infiltrationId, (draft) => {
        const target = draft.objectives[objectiveId];
        if (!target) return;
        const entry = toInfiltrationObstacle(obstacle, draft.baseDC, {
          position: nextPosition(target.obstacles),
        });
        target.obstacles[entry.id] = entry;
      });
      ui.notifications.info(game.i18n.format('PFAI.Infiltration.ObstacleAdded', { name: obstacle.name }));
    } catch (error) {
      console.error(`${MODULE_ID} | infiltration obstacle generation failed`, error);
      ui.notifications.error(error.message, { permanent: true });
    } finally {
      this.#generatingObstacle = false;
      await this.render();
    }
  }

  static async #onEditInfiltrationObstacle(_event, target) {
    const { infiltrationId, objectiveId, entryId } = target.dataset;
    const event = getInfiltration(infiltrationId);
    const obstacle = event?.objectives?.[objectiveId]?.obstacles?.[entryId];
    if (!obstacle) return;

    const result = await DialogV2.prompt({
      window: { title: game.i18n.localize('PFAI.Chase.EditObstacle') },
      position: { width: 580 },
      content: `<div class="pfai-form">
        <label class="pfai-field"><span>${game.i18n.localize('PFAI.Chase.ObstacleName')}</span>
          <input type="text" name="name" value="${escapeHTML(obstacle.name)}"></label>
        <div class="pfai-field-row">
          <label class="pfai-field"><span>${game.i18n.localize('PFAI.Infiltration.PointsNeeded')}</span>
            <input type="number" name="goal" min="1" step="1" value="${obstacle.infiltrationPoints.goal}"></label>
          <label class="pfai-field"><span>${game.i18n.localize('PFAI.Infiltration.Progress')}</span>
            <input type="number" name="current" min="0" step="1" value="${obstacle.infiltrationPoints.current}"></label>
          <label class="pfai-field"><span>${game.i18n.localize('PFAI.Infiltration.Individual')}</span>
            <select name="individual">
              <option value="false" ${obstacle.individual ? '' : 'selected'}>${game.i18n.localize('PFAI.Infiltration.AsAParty')}</option>
              <option value="true" ${obstacle.individual ? 'selected' : ''}>${game.i18n.localize('PFAI.Infiltration.EachAlone')}</option>
            </select>
            <small>${game.i18n.localize('PFAI.Info.IndividualObstacle')}</small></label>
        </div>
        <label class="pfai-field"><span>${game.i18n.localize('PFAI.Chase.Overcome')}</span>
          <textarea name="description" rows="4">${escapeHTML(obstacle.description)}</textarea></label>
      </div>`,
      ok: { label: game.i18n.localize('PFAI.Save'), callback: (_e, b) => formValues(b) },
    });
    if (!result) return;

    await updateInfiltration(infiltrationId, (draft) => {
      const edited = draft.objectives[objectiveId]?.obstacles?.[entryId];
      if (!edited) return;
      edited.name = String(result.name ?? edited.name);
      edited.description = String(result.description ?? '');
      edited.infiltrationPoints.goal = Math.max(1, Number(result.goal) || edited.infiltrationPoints.goal);
      edited.infiltrationPoints.current = Math.max(0, Number(result.current) || 0);
      edited.individual = result.individual === 'true' || result.individual === true;
    });
  }

  static async #onDeleteInfiltrationObstacle(_event, target) {
    const { infiltrationId, objectiveId, entryId } = target.dataset;
    const store = getInfiltrations();
    const objective = store.events[infiltrationId]?.objectives?.[objectiveId];
    if (!objective) return;
    const { [entryId]: _removed, ...remaining } = objective.obstacles;
    objective.obstacles = remaining;
    await setInfiltrations(store);
  }

  static async #onAddBreakpoint(_event, target) {
    await updateInfiltration(target.dataset.infiltrationId, (event) => {
      const id = foundry.utils.randomID();
      const highest = Object.values(event.awarenessBreakpoints).reduce((max, b) => Math.max(max, b.at), 0);
      event.awarenessBreakpoints[id] = {
        id,
        position: nextPosition(event.awarenessBreakpoints),
        at: highest + 5,
        name: game.i18n.localize('PFAI.Infiltration.NewBreakpoint'),
        description: '',
        dcIncrease: 1,
        hidden: true,
        fired: false,
      };
    });
  }

  static async #onEditBreakpoint(_event, target) {
    const { infiltrationId, entryId } = target.dataset;
    const event = getInfiltration(infiltrationId);
    const breakpoint = event?.awarenessBreakpoints?.[entryId];
    if (!breakpoint) return;

    const result = await DialogV2.prompt({
      window: { title: game.i18n.localize('PFAI.Infiltration.EditBreakpoint') },
      position: { width: 560 },
      content: `<div class="pfai-form">
        <div class="pfai-field-row">
          <label class="pfai-field pfai-field-wide"><span>${game.i18n.localize('PFAI.Infiltration.BreakpointName')}</span>
            <input type="text" name="name" value="${escapeHTML(breakpoint.name)}"></label>
          <label class="pfai-field"><span>${game.i18n.localize('PFAI.Infiltration.AtAwareness')}</span>
            <input type="number" name="at" min="1" step="1" value="${breakpoint.at}"></label>
          <label class="pfai-field"><span>${game.i18n.localize('PFAI.Influence.DCShift')}</span>
            <input type="number" name="dcIncrease" min="0" max="10" step="1" value="${breakpoint.dcIncrease}"></label>
        </div>
        <label class="pfai-field"><span>${game.i18n.localize('PFAI.Infiltration.WhatChanges')}</span>
          <textarea name="description" rows="4">${escapeHTML(breakpoint.description)}</textarea></label>
      </div>`,
      ok: { label: game.i18n.localize('PFAI.Save'), callback: (_e, b) => formValues(b) },
    });
    if (!result) return;

    await updateInfiltration(infiltrationId, (draft) => {
      const edited = draft.awarenessBreakpoints[entryId];
      if (!edited) return;
      edited.name = String(result.name ?? edited.name);
      edited.description = String(result.description ?? '');
      edited.at = Math.max(1, Number(result.at) || edited.at);
      edited.dcIncrease = Math.clamp(Number(result.dcIncrease) || 0, 0, 10);
      // Lowering it under the current awareness means it has already bitten.
      if (draft.awareness.current >= edited.at) {
        edited.fired = true;
        edited.hidden = false;
      }
    });
  }

  static async #onDeleteBreakpoint(_event, target) {
    const { infiltrationId, entryId } = target.dataset;
    const store = getInfiltrations();
    const event = store.events[infiltrationId];
    if (!event) return;
    const { [entryId]: _removed, ...remaining } = event.awarenessBreakpoints;
    event.awarenessBreakpoints = remaining;
    await setInfiltrations(store);
  }

  static #onGenerateLeadership() {
    new GenerateLeadershipDialog({
      onGenerated: (id) => {
        this.#subsystem = 'leadership';
        this.#selectedLeadershipId = id;
        this.render();
      },
    }).render({ force: true });
  }

  static #onOpenLeadership(_event, target) {
    this.#selectedLeadershipId = target.dataset.leadershipId;
    this.render();
  }

  static #onBackLeadership() {
    this.#selectedLeadershipId = null;
    this.render();
  }

  static async #onDeleteLeadership(_event, target) {
    const org = getLeadership(target.dataset.leadershipId);
    if (!org) return;
    const confirmed = await DialogV2.confirm({
      window: { title: game.i18n.localize('PFAI.Leadership.DeleteTitle') },
      content: `<p>${game.i18n.format('PFAI.Leadership.DeleteConfirm', { name: org.name })}</p>`,
    });
    if (!confirmed) return;
    if (this.#selectedLeadershipId === org.id) this.#selectedLeadershipId = null;
    await deleteLeadership(org.id);
  }

  /** The organisation's level is its track; growing it opens up new events. */
  static async #onOrgLevelDelta(_event, target) {
    const delta = Number(target.dataset.delta);
    let revealed = [];
    await updateLeadership(target.dataset.leadershipId, (org) => {
      org.organizationLevel = Math.clamp(org.organizationLevel + delta, 1, 20);
      revealed = advanceLeadership(org);
    });
    if (revealed.length) {
      ui.notifications.info(game.i18n.format('PFAI.Leadership.Unlocked', { what: revealed.join(', ') }));
    }
  }

  static async #onRollLeadership(_event, target) {
    const { leadershipId, participantId } = target.dataset;
    const row = target.closest('.pfai-participant');
    const select = row?.querySelector('.pfai-roll-option');
    if (!select?.value) return;
    const [eventId, checkId] = select.value.split('|');
    await rollLeadershipCheck({
      leadershipId,
      participantId,
      eventId,
      checkId,
      force: game.user.isGM,
    });
  }

  static async #onToggleLeadershipReveal(_event, target) {
    const { leadershipId, collection, entryId } = target.dataset;
    await updateLeadership(leadershipId, (org) => {
      const entry = org[collection]?.[entryId];
      if (entry) entry.hidden = !entry.hidden;
    });
  }

  static async #onToggleEventResolved(_event, target) {
    const { leadershipId, entryId } = target.dataset;
    await updateLeadership(leadershipId, (org) => {
      const event = org.events?.[entryId];
      if (!event) return;
      event.resolved = !event.resolved;
      // Something settled is necessarily something the party saw.
      if (event.resolved) event.hidden = false;
    });
  }

  static async #onAddLieutenant(_event, target) {
    await updateLeadership(target.dataset.leadershipId, (org) => {
      const id = foundry.utils.randomID();
      org.lieutenants[id] = {
        id,
        position: nextPosition(org.lieutenants),
        name: game.i18n.localize('PFAI.Leadership.NewLieutenant'),
        role: '',
        description: '',
        level: 1,
        uuid: '',
        img: '',
        hidden: false,
      };
    });
  }

  static async #onEditLieutenant(_event, target) {
    const { leadershipId, entryId } = target.dataset;
    const org = getLeadership(leadershipId);
    const lieutenant = org?.lieutenants?.[entryId];
    if (!lieutenant) return;

    const result = await DialogV2.prompt({
      window: { title: game.i18n.localize('PFAI.Leadership.EditLieutenant') },
      position: { width: 560 },
      content: `<div class="pfai-form">
        <div class="pfai-field-row">
          <label class="pfai-field pfai-field-wide"><span>${game.i18n.localize('PFAI.Leadership.LieutenantName')}</span>
            <input type="text" name="name" value="${escapeHTML(lieutenant.name)}"></label>
          <label class="pfai-field"><span>${game.i18n.localize('PFAI.Leadership.Role')}</span>
            <input type="text" name="role" value="${escapeHTML(lieutenant.role)}"></label>
          <label class="pfai-field"><span>${game.i18n.localize('PFAI.Leadership.CreatureLevel')}</span>
            <input type="number" name="level" min="0" max="20" step="1" value="${lieutenant.level}"></label>
        </div>
        <label class="pfai-field"><span>${game.i18n.localize('PFAI.Leadership.WhoTheyAre')}</span>
          <textarea name="description" rows="4">${escapeHTML(lieutenant.description)}</textarea></label>
      </div>`,
      ok: { label: game.i18n.localize('PFAI.Save'), callback: (_e, b) => formValues(b) },
    });
    if (!result) return;

    await updateLeadership(leadershipId, (draft) => {
      const edited = draft.lieutenants[entryId];
      if (!edited) return;
      edited.name = String(result.name ?? edited.name);
      edited.role = String(result.role ?? '');
      edited.level = Math.clamp(Number(result.level) || 0, 0, 20);
      edited.description = String(result.description ?? '');
    });
  }

  static async #onDeleteLieutenant(_event, target) {
    const { leadershipId, entryId } = target.dataset;
    const store = getLeaderships();
    const org = store.events[leadershipId];
    if (!org) return;
    const { [entryId]: _removed, ...remaining } = org.lieutenants;
    org.lieutenants = remaining;
    await setLeaderships(store);
  }

  static async #onAddLeadershipEvent(_event, target) {
    const { leadershipId, kind } = target.dataset;
    await updateLeadership(leadershipId, (org) => {
      const id = foundry.utils.randomID();
      org.events[id] = {
        id,
        position: nextPosition(org.events),
        kind: kind || 'opportunity',
        name: game.i18n.localize('PFAI.Leadership.NewEvent'),
        description: '',
        outcome: '',
        // Added at the current level, so it is live immediately.
        hidden: false,
        resolved: false,
        revealAt: org.organizationLevel,
        checks: {},
      };
    });
  }

  static async #onGenerateLeadershipEvent(_event, target) {
    if (this.#generatingObstacle) return;
    const { leadershipId, kind } = target.dataset;
    const org = getLeadership(leadershipId);
    if (!org) return;
    if (!hasApiKey()) {
      ui.notifications.error(game.i18n.localize('PFAI.Errors.NoApiKey'));
      return;
    }

    this.#generatingObstacle = true;
    await this.render();
    try {
      const generated = await generateLeadershipEvent({
        organization: htmlToText(org.organization),
        premise: htmlToText(org.premise),
        goal: htmlToText(org.goal),
        organizationLevel: org.organizationLevel,
        baseDC: org.baseDC,
        level: org.level,
        partySize: org.partySize,
        language: game.settings.get(MODULE_ID, 'outputLanguage')?.trim() || game.i18n.lang,
        existingNames: Object.values(org.events).map((e) => e.name),
        kind: kind || undefined,
      });

      await updateLeadership(leadershipId, (draft) => {
        const entry = toLeadershipEvent(generated, draft.baseDC, {
          position: nextPosition(draft.events),
          hidden: (generated.atLevel ?? 1) > draft.organizationLevel,
        });
        draft.events[entry.id] = entry;
      });
      ui.notifications.info(game.i18n.format('PFAI.Leadership.EventAdded', { name: generated.name }));
    } catch (error) {
      console.error(`${MODULE_ID} | leadership event generation failed`, error);
      ui.notifications.error(error.message, { permanent: true });
    } finally {
      this.#generatingObstacle = false;
      await this.render();
    }
  }

  static async #onEditLeadershipEvent(_event, target) {
    const { leadershipId, entryId } = target.dataset;
    const org = getLeadership(leadershipId);
    const event = org?.events?.[entryId];
    if (!event) return;

    const kindOptions = Object.entries(LEADERSHIP_EVENT_KINDS)
      .map(([value, key]) =>
        `<option value="${value}" ${value === event.kind ? 'selected' : ''}>${game.i18n.localize(key)}</option>`)
      .join('');

    const result = await DialogV2.prompt({
      window: { title: game.i18n.localize('PFAI.Leadership.EditEvent') },
      position: { width: 600 },
      content: `<div class="pfai-form">
        <div class="pfai-field-row">
          <label class="pfai-field pfai-field-wide"><span>${game.i18n.localize('PFAI.Leadership.EventName')}</span>
            <input type="text" name="name" value="${escapeHTML(event.name)}"></label>
          <label class="pfai-field"><span>${game.i18n.localize('PFAI.Leadership.Kind')}</span>
            <select name="kind">${kindOptions}</select></label>
          <label class="pfai-field"><span>${game.i18n.localize('PFAI.Leadership.AtLevel')}</span>
            <input type="number" name="revealAt" min="1" max="20" step="1" value="${event.revealAt ?? ''}">
            <small>${game.i18n.localize('PFAI.Leadership.AtLevelHint')}</small></label>
        </div>
        <label class="pfai-field"><span>${game.i18n.localize('PFAI.Leadership.WhatHappens')}</span>
          <textarea name="description" rows="4">${escapeHTML(event.description)}</textarea></label>
        <label class="pfai-field"><span>${game.i18n.localize('PFAI.Leadership.Outcome')}</span>
          <textarea name="outcome" rows="3">${escapeHTML(event.outcome)}</textarea></label>
      </div>`,
      ok: { label: game.i18n.localize('PFAI.Save'), callback: (_e, b) => formValues(b) },
    });
    if (!result) return;

    await updateLeadership(leadershipId, (draft) => {
      const edited = draft.events[entryId];
      if (!edited) return;
      edited.name = String(result.name ?? edited.name);
      edited.kind = Object.hasOwn(LEADERSHIP_EVENT_KINDS, result.kind) ? result.kind : edited.kind;
      edited.description = String(result.description ?? '');
      edited.outcome = String(result.outcome ?? '');
      const at = String(result.revealAt ?? '').trim();
      edited.revealAt = at === '' ? null : Math.clamp(Number(at) || 1, 1, 20);
      if (edited.revealAt !== null && draft.organizationLevel >= edited.revealAt) edited.hidden = false;
    });
  }

  static async #onDeleteLeadershipEvent(_event, target) {
    const { leadershipId, entryId } = target.dataset;
    const store = getLeaderships();
    const org = store.events[leadershipId];
    if (!org) return;
    const { [entryId]: _removed, ...remaining } = org.events;
    org.events = remaining;
    await setLeaderships(store);
  }

  static #onGenerateInfiltration() {
    new GenerateInfiltrationDialog({
      onGenerated: (id) => {
        this.#subsystem = 'infiltration';
        this.#selectedInfiltrationId = id;
        this.render();
      },
    }).render({ force: true });
  }

  static #onOpenInfiltration(_event, target) {
    this.#selectedInfiltrationId = target.dataset.infiltrationId;
    this.render();
  }

  static #onBackInfiltration() {
    this.#selectedInfiltrationId = null;
    this.render();
  }

  static async #onDeleteInfiltration(_event, target) {
    const event = getInfiltration(target.dataset.infiltrationId);
    if (!event) return;
    const confirmed = await DialogV2.confirm({
      window: { title: game.i18n.localize('PFAI.Infiltration.DeleteTitle') },
      content: `<p>${game.i18n.format('PFAI.Infiltration.DeleteConfirm', { name: event.name })}</p>`,
    });
    if (!confirmed) return;
    if (this.#selectedInfiltrationId === event.id) this.#selectedInfiltrationId = null;
    await deleteInfiltration(event.id);
  }

  static async #onAwarenessDelta(_event, target) {
    const delta = Number(target.dataset.delta);
    let summary = null;
    await updateInfiltration(target.dataset.infiltrationId, (event) => {
      event.awareness.current = Math.max(0, event.awareness.current + delta);
      summary = advanceInfiltration(event);
    });
    if (summary) announceInfiltrationProgress(summary);
  }

  static async #onEdgeDelta(_event, target) {
    const delta = Number(target.dataset.delta);
    await updateInfiltration(target.dataset.infiltrationId, (event) => {
      event.edgePoints = Math.max(0, event.edgePoints + delta);
    });
  }

  static async #onInfiltrationRoundDelta(_event, target) {
    const delta = Number(target.dataset.delta);
    let summary = null;
    await updateInfiltration(target.dataset.infiltrationId, (event) => {
      event.rounds.current = Math.max(0, event.rounds.current + delta);
      summary = advanceInfiltration(event);
    });
    if (summary) announceInfiltrationProgress(summary);
  }

  /** Advancing a round is what makes awareness climb on its own. */
  static async #onInfiltrationNextRound(_event, target) {
    let gained = 0;
    let summary = null;
    await updateInfiltration(target.dataset.infiltrationId, (event) => {
      event.rounds.current += 1;
      gained = event.awareness.perRound ?? 0;
      event.awareness.current = Math.max(0, event.awareness.current + gained);
      for (const participant of Object.values(event.participants)) participant.hasActed = false;
      summary = advanceInfiltration(event);
    });
    if (gained) {
      ui.notifications.info(game.i18n.format('PFAI.Infiltration.RoundAwareness', { gained }));
    }
    if (summary) announceInfiltrationProgress(summary);
  }

  static async #onRollInfiltration(_event, target) {
    const { infiltrationId, participantId } = target.dataset;
    const row = target.closest('.pfai-participant');
    const select = row?.querySelector('.pfai-roll-option');
    if (!select?.value) return;
    // The option encodes where the check lives: kind, owner, objective, check.
    const [kind, ownerId, objectiveId, checkId] = select.value.split('|');
    await rollInfiltrationCheck({
      infiltrationId,
      participantId,
      kind,
      ownerId,
      objectiveId: objectiveId || undefined,
      checkId,
      force: game.user.isGM,
    });
  }

  static async #onSpendEdge(_event, target) {
    const { infiltrationId, participantId } = target.dataset;
    const row = target.closest('.pfai-participant');
    const select = row?.querySelector('.pfai-roll-option');
    if (!select?.value) return;
    const [kind, ownerId, objectiveId] = select.value.split('|');
    await spendEdgePoint({
      infiltrationId,
      participantId,
      kind,
      ownerId,
      objectiveId: objectiveId || undefined,
    });
  }

  /** Reveal or re-hide an objective, obstacle, check, complication or the rest. */
  static async #onToggleInfiltrationReveal(_event, target) {
    const { infiltrationId, collection, entryId, objectiveId, ownerId, kind } = target.dataset;
    await updateInfiltration(infiltrationId, (event) => {
      let entry = null;
      if (kind === 'check') {
        const owner = objectiveId
          ? event.objectives?.[objectiveId]?.obstacles?.[ownerId]
          : event[collection]?.[ownerId];
        entry = owner?.checks?.[entryId];
      } else if (kind === 'obstacle') {
        entry = event.objectives?.[objectiveId]?.obstacles?.[entryId];
      } else {
        entry = event[collection]?.[entryId];
      }
      if (entry) entry.hidden = !entry.hidden;
    });
  }

  static async #onToggleComplicationResolved(_event, target) {
    const { infiltrationId, entryId } = target.dataset;
    await updateInfiltration(infiltrationId, (event) => {
      const complication = event.complications?.[entryId];
      if (!complication) return;
      complication.resolved = !complication.resolved;
      // Resolving something the party never saw fire makes no sense.
      if (complication.resolved) {
        complication.fired = true;
        complication.hidden = false;
      }
    });
  }

  /** Mark a preparation attempted, and award the edge point it earns. */
  static async #onTogglePreparationUsed(_event, target) {
    const { infiltrationId, entryId, award } = target.dataset;
    await updateInfiltration(infiltrationId, (event) => {
      const preparation = event.preparations?.[entryId];
      if (!preparation) return;
      const wasUsed = preparation.used;
      preparation.used = !wasUsed;
      if (award === 'true') {
        // Earning it on the way in, giving it back on the way out.
        event.edgePoints = Math.max(0, event.edgePoints + (wasUsed ? -1 : 1));
      }
    });
  }

  static #onGenerateResearch() {
    new GenerateResearchDialog({
      onGenerated: (id) => {
        this.#subsystem = 'research';
        this.#selectedResearchId = id;
        this.render();
      },
    }).render({ force: true });
  }

  static #onOpenResearch(_event, target) {
    this.#selectedResearchId = target.dataset.researchId;
    this.render();
  }

  static #onBackResearch() {
    this.#selectedResearchId = null;
    this.render();
  }

  static async #onDeleteResearch(_event, target) {
    const event = getResearch(target.dataset.researchId);
    if (!event) return;
    const confirmed = await DialogV2.confirm({
      window: { title: game.i18n.localize('PFAI.Research.DeleteTitle') },
      content: `<p>${game.i18n.format('PFAI.Research.DeleteConfirm', { name: event.name })}</p>`,
    });
    if (!confirmed) return;
    if (this.#selectedResearchId === event.id) this.#selectedResearchId = null;
    await deleteResearch(event.id);
  }

  static async #onResearchPointDelta(_event, target) {
    const delta = Number(target.dataset.delta);
    let summary = null;
    await updateResearch(target.dataset.researchId, (event) => {
      event.researchPoints = Math.max(0, event.researchPoints + delta);
      summary = advanceResearch(event);
    });
    if (summary) announceResearchProgress(summary);
  }

  static async #onResearchRoundDelta(_event, target) {
    const delta = Number(target.dataset.delta);
    let summary = null;
    await updateResearch(target.dataset.researchId, (event) => {
      event.rounds.current = Math.max(0, event.rounds.current + delta);
      // Time-triggered events fire from the round counter, however it moved.
      summary = advanceResearch(event);
    });
    if (summary) announceResearchProgress(summary);
  }

  static async #onResearchNextRound(_event, target) {
    let summary = null;
    await updateResearch(target.dataset.researchId, (event) => {
      event.rounds.current += 1;
      for (const participant of Object.values(event.participants)) participant.hasActed = false;
      summary = advanceResearch(event);
    });
    if (summary) announceResearchProgress(summary);
  }

  static async #onRollResearch(_event, target) {
    const { researchId, participantId } = target.dataset;
    const row = target.closest('.pfai-participant');
    const select = row?.querySelector('.pfai-roll-option');
    if (!select?.value) return;
    // The option carries which source it belongs to, since caps are per source.
    const [sourceId, checkId] = select.value.split('|');
    await rollResearchCheck({
      researchId,
      participantId,
      sourceId,
      checkId,
      force: game.user.isGM,
    });
  }

  static async #onAwardResearch(_event, target) {
    const { researchId, participantId } = target.dataset;
    await adjustResearchContribution({
      researchId,
      participantId,
      delta: Number(target.dataset.delta),
    });
  }

  /** Reveal or re-hide a source, a check inside one, a threshold or an event. */
  static async #onToggleResearchReveal(_event, target) {
    const { researchId, collection, entryId, sourceId } = target.dataset;
    await updateResearch(researchId, (event) => {
      const entry = sourceId
        ? event.sources?.[sourceId]?.checks?.[entryId]
        : event[collection]?.[entryId];
      if (entry) entry.hidden = !entry.hidden;
    });
  }

  /** Put an event's ongoing DC shift into play, or lift it. */
  static async #onToggleEventActive(_event, target) {
    const { researchId, entryId } = target.dataset;
    await updateResearch(researchId, (event) => {
      const complication = event.events?.[entryId];
      if (!complication) return;
      complication.modifier.active = !complication.modifier.active;
      if (complication.modifier.active) {
        complication.hidden = false;
        complication.fired = true;
      }
    });
  }

  static #onGenerateInfluence() {
    new GenerateInfluenceDialog({
      onGenerated: (id) => {
        this.#subsystem = 'influence';
        this.#selectedInfluenceId = id;
        this.render();
      },
    }).render({ force: true });
  }

  static #onOpenInfluence(_event, target) {
    this.#selectedInfluenceId = target.dataset.influenceId;
    this.render();
  }

  static #onBackInfluence() {
    this.#selectedInfluenceId = null;
    this.render();
  }

  static async #onDeleteInfluence(_event, target) {
    const event = getInfluence(target.dataset.influenceId);
    if (!event) return;
    const confirmed = await DialogV2.confirm({
      window: { title: game.i18n.localize('PFAI.Influence.DeleteTitle') },
      content: `<p>${game.i18n.format('PFAI.Influence.DeleteConfirm', { name: event.name })}</p>`,
    });
    if (!confirmed) return;
    if (this.#selectedInfluenceId === event.id) this.#selectedInfluenceId = null;
    await deleteInfluence(event.id);
  }

  static async #onInfluencePointDelta(_event, target) {
    const delta = Number(target.dataset.delta);
    let unlocked = [];
    await updateInfluence(target.dataset.influenceId, (event) => {
      // Points can fall on a critical failure, but never below zero.
      event.influencePoints = Math.max(0, event.influencePoints + delta);
      for (const threshold of Object.values(event.thresholds)) {
        if (event.influencePoints >= threshold.points) threshold.hidden = false;
      }
      unlocked = revealByProgress(event);
    });
    if (unlocked.length) {
      ui.notifications.info(game.i18n.format('PFAI.Influence.Unlocked', { what: unlocked.join(', ') }));
    }
  }

  static async #onInfluenceRoundDelta(_event, target) {
    const delta = Number(target.dataset.delta);
    await updateInfluence(target.dataset.influenceId, (event) => {
      event.rounds.current = Math.max(0, event.rounds.current + delta);
    });
  }

  static async #onInfluenceNextRound(_event, target) {
    await updateInfluence(target.dataset.influenceId, (event) => {
      event.rounds.current += 1;
      for (const participant of Object.values(event.participants)) participant.hasActed = false;
    });
  }

  /** Reveal or re-hide any discovered element: a skill, threshold or trait. */
  static async #onToggleReveal(_event, target) {
    const { influenceId, collection, entryId } = target.dataset;
    await updateInfluence(influenceId, (event) => {
      const entry = event[collection]?.[entryId];
      if (entry) entry.hidden = !entry.hidden;
    });
  }

  /** Apply or lift a weakness, resistance or penalty's effect on the DC. */
  static async #onToggleModifierUsed(_event, target) {
    const { influenceId, collection, entryId } = target.dataset;
    await updateInfluence(influenceId, (event) => {
      const entry = event[collection]?.[entryId];
      if (!entry) return;
      entry.used = !entry.used;
      // Something in play is necessarily something the party knows about.
      if (entry.used) entry.hidden = false;
    });
  }

  static #onGenerate() {
    new GenerateChaseDialog({ onGenerated: (id) => this.select(id) }).render({ force: true });
  }

  /**
   * Start an event by hand.
   *
   * Only chases had this, so on the other four tabs a GM whose generation
   * failed, or who simply wanted to write one themselves, had no way to make an
   * event at all short of importing a file. Everything past the shared fields
   * is left to the DataModel's own defaults, which is why one factory serves
   * all five.
   */
  static async #onCreateBlank(_event, target) {
    const key = target?.dataset?.subsystem ?? 'chase';
    const api = subsystem(key);
    const all = api.getAll();
    const id = foundry.utils.randomID();
    all.events[id] = {
      id,
      name: game.i18n.localize(api.blankName),
      position: nextPosition(all.events),
      img: '',
      gmNotes: '',
      baseDC: suggestedBaseDC(),
      level: guessPartyLevel(),
      partySize: guessPartySize(),
      hidden: true,
      started: false,
      participants: {},
      ai: { generated: false, model: '', prompt: '', generatedAt: 0 },
    };
    await api.save(all);
    this.#select(key, id);
    this.#subsystem = key;
    await this.render();
  }

  static #onGenerateObstacles(_event, target) {
    new GenerateChaseDialog({
      chaseId: target.dataset.chaseId,
      onGenerated: (id) => this.select(id),
    }).render({ force: true });
  }

  /** Pin the shown obstacle as the party's current one, or unpin it. */
  static async #onSetActiveObstacle(_event, target) {
    const { chaseId, obstacleId } = target.dataset;
    await updateChase(chaseId, (chase) => {
      const obstacle = chase.obstacles[obstacleId];
      if (!obstacle) return;
      // Clicking the pinned obstacle again releases the pin.
      chase.activeObstacle = chase.activeObstacle === obstacleId ? '' : obstacleId;
      // Players follow the active obstacle, so it has to be visible to them.
      if (chase.activeObstacle) obstacle.locked = false;
    });
    // Snap back to following the live obstacle.
    this.#obstacleIndex = null;
    this.render();
  }

  static #onTogglePlayerPreview() {
    this.#previewAsPlayer = !this.#previewAsPlayer;
    this.#obstacleIndex = null;
    this.render();
  }

  /** Open this event on every connected player's screen, in either subsystem. */
  static async #onShowToPlayers(_event, target) {
    const { key, id, api } = eventTarget(target.dataset);
    const event = api.get(id);
    if (!event) return;

    const players = game.users.filter((user) => user.active && !user.isGM);
    if (!players.length) {
      ui.notifications.warn(game.i18n.localize('PFAI.View.NoPlayersOnline'));
      return;
    }

    // Pushing something hidden would open an empty window on their screens.
    if (event.hidden) {
      const confirmed = await DialogV2.confirm({
        window: { title: game.i18n.localize('PFAI.View.RevealAndShowTitle') },
        content: `<p>${game.i18n.format('PFAI.View.RevealAndShow', { name: event.name })}</p>`,
      });
      if (!confirmed) return;
      await api.update(id, (draft) => {
        draft.hidden = false;
      });
    }

    emitShowEvent({ subsystem: key, eventId: id, userIds: players.map((u) => u.id) });
    ui.notifications.info(
      game.i18n.format('PFAI.View.ShownToPlayers', {
        count: players.length,
        names: players.map((u) => u.name).join(', '),
      }),
    );
  }

  static #onGenerateImage(_event, target) {
    const { obstacleId } = target.dataset;
    const { key, id } = eventTarget(target.dataset);
    new GenerateImageDialog({
      subsystemKey: key,
      eventId: id,
      obstacleId: obstacleId || undefined,
      onGenerated: () => this.render(),
    }).render({ force: true });
  }

  static async #onClearImage(_event, target) {
    const { obstacleId } = target.dataset;
    const { id, api } = eventTarget(target.dataset);
    await api.update(id, (event) => {
      if (obstacleId) {
        const obstacle = event.obstacles?.[obstacleId];
        if (obstacle) obstacle.img = '';
      } else {
        event.img = '';
      }
    });
  }

  static #onObstaclePrev() {
    const total = this.#visibleObstacleCount();
    if (!total) return;
    this.#obstacleIndex = Math.max(0, this.#currentIndex() - 1);
    this.render();
  }

  static #onObstacleNext() {
    const total = this.#visibleObstacleCount();
    if (!total) return;
    this.#obstacleIndex = Math.min(total - 1, this.#currentIndex() + 1);
    this.render();
  }

  static #onObstacleJump(_event, target) {
    this.#obstacleIndex = Number(target.dataset.index) || 0;
    this.render();
  }

  /** Obstacles this user can see for the open chase. */
  #visibleObstacleCount() {
    const chase = getChase(this.#selectedId);
    if (!chase) return 0;
    return Object.values(chase.obstacles).filter((o) => this.isGM || !o.locked).length;
  }

  /** The index the carousel is currently showing. */
  #currentIndex() {
    const chase = getChase(this.#selectedId);
    if (!chase) return 0;
    const obstacles = Object.values(chase.obstacles)
      .filter((o) => this.isGM || !o.locked)
      .sort((a, b) => a.position - b.position);
    const pinned = chase.activeObstacle
      ? obstacles.findIndex((o) => o.id === chase.activeObstacle)
      : -1;
    const live = obstacles.findIndex((o) => o.chasePoints.current < o.chasePoints.goal);
    const liveIndex = pinned !== -1 ? pinned : live === -1 ? Math.max(0, obstacles.length - 1) : live;
    return Math.clamp(this.#obstacleIndex ?? liveIndex, 0, Math.max(0, obstacles.length - 1));
  }

  /** Generate one extra obstacle and append it to the open chase. */
  static async #onGenerateOneObstacle(_event, target) {
    if (this.#generatingObstacle) return;
    const chaseId = target.dataset.chaseId;
    const chase = getChase(chaseId);
    if (!chase) return;

    if (!hasApiKey()) {
      ui.notifications.error(game.i18n.localize('PFAI.Errors.NoApiKey'));
      return;
    }
    const premise = htmlToText(chase.premise);
    if (!premise) {
      ui.notifications.warn(game.i18n.localize('PFAI.Errors.NoPremiseOnChase'));
      return;
    }

    this.#generatingObstacle = true;
    await this.render();

    try {
      const existingObstacles = Object.values(chase.obstacles)
        .sort((a, b) => a.position - b.position)
        .map((obstacle) => obstacle.name);

      const generated = await generateOneObstacle({
        premise,
        baseDC: chase.baseDC,
        level: chase.level,
        difficulty: 'auto',
        existingObstacles,
        language: game.settings.get(MODULE_ID, 'outputLanguage')?.trim() || game.i18n.lang,
        model: activeModel(),
      });

      let newIndex = 0;
      await updateChase(chaseId, (draft) => {
        const entry = toObstacleEntry(generated, draft.baseDC, {
          position: nextPosition(draft.obstacles),
          locked: true,
        });
        draft.obstacles[entry.id] = entry;
        newIndex = Object.keys(draft.obstacles).length - 1;
      });

      // Jump the GM to what they just made.
      this.#obstacleIndex = newIndex;
      ui.notifications.info(game.i18n.format('PFAI.Chase.ObstacleAdded', { name: generated.name }));
    } catch (error) {
      console.error(`${MODULE_ID} | obstacle generation failed`, error);
      ui.notifications.error(error.message, { permanent: true });
    } finally {
      this.#generatingObstacle = false;
      await this.render();
    }
  }

  static async #onEditTitle(_event, target) {
    const { id: chaseId, api } = eventTarget(target.dataset);
    const chase = api.get(chaseId);
    if (!chase) return;

    const result = await DialogV2.prompt({
      window: { title: game.i18n.localize('PFAI.Chase.EditTitle') },
      position: { width: 460 },
      content: `<div class="pfai-form"><label class="pfai-field">
        <span>${game.i18n.localize('PFAI.Chase.Title')}</span>
        <input type="text" name="name" value="${escapeHTML(chase.name)}" autofocus>
      </label></div>`,
      ok: {
        label: game.i18n.localize('PFAI.Save'),
        callback: (_event, button) => formValues(button),
      },
    });
    if (!result) return;

    const name = String(result.name ?? '').trim();
    if (!name) return;
    await api.update(chaseId, (draft) => {
      draft.name = name;
    });
  }

  static #onOpenChase(_event, target) {
    this.select(target.dataset.chaseId);
  }

  static #onBack() {
    this.select(null);
  }

  static async #onDeleteChase(_event, target) {
    const chase = getChase(target.dataset.chaseId);
    if (!chase) return;
    const confirmed = await DialogV2.confirm({
      window: { title: game.i18n.localize('PFAI.Confirm.DeleteChaseTitle') },
      content: `<p>${game.i18n.format('PFAI.Confirm.DeleteChase', { name: chase.name })}</p>`,
    });
    if (!confirmed) return;
    if (this.#selectedId === chase.id) this.#selectedId = null;
    await deleteChase(chase.id);
  }

  static async #onToggleHidden(_event, target) {
    const { id, api } = eventTarget(target.dataset);
    await api.update(id, (event) => {
      event.hidden = !event.hidden;
    });
  }

  static async #onToggleStarted(_event, target) {
    const { id, api } = eventTarget(target.dataset);
    await api.update(id, (event) => {
      event.started = !event.started;
    });
  }

  static async #onRoundDelta(_event, target) {
    const delta = Number(target.dataset.delta);
    await updateChase(target.dataset.chaseId, (chase) => {
      chase.rounds.current = Math.max(0, chase.rounds.current + delta);
    });
  }

  static async #onAddObstacle(_event, target) {
    await updateChase(target.dataset.chaseId, (chase) => {
      const id = foundry.utils.randomID();
      chase.obstacles[id] = {
        id,
        position: nextPosition(chase.obstacles),
        name: game.i18n.localize('PFAI.Chase.NewObstacle'),
        img: '',
        locked: true,
        chasePoints: { goal: 2, current: 0 },
        overcome: '',
      };
    });
  }

  static async #onDeleteObstacle(_event, target) {
    const { chaseId, obstacleId } = target.dataset;
    const chases = getChases();
    const chase = chases.events[chaseId];
    if (!chase) return;
    const { [obstacleId]: _removed, ...remaining } = chase.obstacles;
    chase.obstacles = remaining;
    await setChases(chases);
    this.#obstacleIndex = null;
  }

  static async #onToggleObstacleLock(_event, target) {
    const { chaseId, obstacleId } = target.dataset;
    await updateChase(chaseId, (chase) => {
      const obstacle = chase.obstacles[obstacleId];
      if (obstacle) obstacle.locked = !obstacle.locked;
    });
  }

  static async #onChasePointDelta(_event, target) {
    const { chaseId, obstacleId } = target.dataset;
    const delta = Number(target.dataset.delta);
    await updateChase(chaseId, (chase) => {
      const obstacle = chase.obstacles[obstacleId];
      if (!obstacle) return;
      obstacle.chasePoints.current = Math.max(0, obstacle.chasePoints.current + delta);
    });
  }

  /**
   * Edit an obstacle, including where each approach leads.
   *
   * Routing always targets the *next* step. When that step forks, every
   * approach has to say which way it goes or players reach a dead end.
   */
  static async #onEditObstacle(_event, target) {
    const { chaseId, obstacleId } = target.dataset;
    const chase = getChase(chaseId);
    const obstacle = chase?.obstacles?.[obstacleId];
    if (!obstacle) return;

    const route = routeTargetsFor(chase.obstacles, obstacle.position);
    const options = Object.values(obstacle.skillOptions ?? {}).sort(
      (a, b) => a.position - b.position,
    );

    const routeCell = (option) => {
      if (route.endsChase) {
        return `<td class="pfai-route-cell"><em>${game.i18n.localize('PFAI.Chase.EndsChase')}</em></td>`;
      }
      if (!route.forked) {
        return `<td class="pfai-route-cell"><em>${game.i18n.localize('PFAI.Chase.NextStep')}</em></td>`;
      }
      const choices = route.targets
        .map(
          (t) =>
            `<option value="${escapeHTML(t.value)}" ${t.value === (option.leadsTo ?? '') ? 'selected' : ''}>${escapeHTML(t.label)} — ${escapeHTML(t.name)}</option>`,
        )
        .join('');
      const unset = `<option value="" ${route.targets.every((t) => t.value !== (option.leadsTo ?? '')) ? 'selected' : ''}>${game.i18n.localize('PFAI.Chase.RouteUnset')}</option>`;
      return `<td class="pfai-route-cell"><select name="route.${option.id}">${unset}${choices}</select></td>`;
    };

    const rows = options
      .map(
        (option) => `<tr>
          <td>${escapeHTML(option.label)}</td>
          <td><input type="number" name="dc.${option.id}" value="${option.dc}" min="1" step="1"></td>
          <td><input type="text" name="desc.${option.id}" value="${escapeHTML(option.description)}"></td>
          ${routeCell(option)}
        </tr>`,
      )
      .join('');

    const table = options.length
      ? `<table class="pfai-route-table">
          <thead><tr>
            <th>${game.i18n.localize('PFAI.Chase.Approach')}</th>
            <th>${game.i18n.localize('PFAI.Chase.DC')}</th>
            <th>${game.i18n.localize('PFAI.Chase.ApproachDescription')}</th>
            <th>${game.i18n.localize('PFAI.Chase.LeadsTo')}</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>`
      : `<p class="pfai-empty">${game.i18n.localize('PFAI.Chase.NoApproaches')}</p>`;

    const content = `
      <div class="pfai-form">
        <label class="pfai-field"><span>${game.i18n.localize('PFAI.Chase.ObstacleName')}</span>
          <input type="text" name="name" value="${escapeHTML(obstacle.name)}">
        </label>
        <label class="pfai-field"><span>${game.i18n.localize('PFAI.Chase.Goal')}</span>
          <input type="number" name="goal" min="1" step="1" value="${obstacle.chasePoints.goal}">
        </label>
        <label class="pfai-field"><span>${game.i18n.localize('PFAI.Chase.ObstacleRoundMax')}</span>
          <input type="number" name="roundMax" min="0" step="1" value="${obstacle.rounds?.max ?? ''}">
        </label>
        <div class="pfai-field"><span>${game.i18n.localize('PFAI.Chase.Approaches')}</span>${table}</div>
        <label class="pfai-field"><span>${game.i18n.localize('PFAI.Chase.Overcome')}</span>
          <textarea name="overcome" rows="8">${escapeHTML(obstacle.overcome)}</textarea>
        </label>
      </div>`;

    const result = await DialogV2.prompt({
      window: { title: game.i18n.localize('PFAI.Chase.EditObstacle') },
      position: { width: 780 },
      content,
      ok: { label: game.i18n.localize('PFAI.Save'), callback: (_event, button) => formValues(button) },
    });
    if (!result) return;

    await updateChase(chaseId, (draft) => {
      const edited = draft.obstacles[obstacleId];
      if (!edited) return;
      edited.name = String(result.name ?? edited.name);
      edited.chasePoints.goal = Math.max(1, Number(result.goal) || 1);
      const max = String(result.roundMax ?? '').trim();
      edited.rounds.max = max === '' ? null : Math.max(0, Number(max) || 0);
      edited.overcome = String(result.overcome ?? '');

      for (const option of Object.values(edited.skillOptions ?? {})) {
        const dc = result[`dc.${option.id}`];
        if (dc !== undefined) option.dc = Math.max(1, Number(dc) || option.dc);
        const desc = result[`desc.${option.id}`];
        if (desc !== undefined) option.description = String(desc);
        const to = result[`route.${option.id}`];
        if (to !== undefined) option.leadsTo = String(to);
      }
      edited.overcome = rebuildOvercomeRoutes(edited);
    });
  }

  /**
   * Edit any prose field on any event, including nested ones such as
   * `npc.wants`, so every section a GM writes is editable from where it shows.
   */
  static async #onEditText(_event, target) {
    const { field, label } = target.dataset;
    const { id, api } = eventTarget(target.dataset);
    const event = api.get(id);
    if (!event || !field) return;

    const current = foundry.utils.getProperty(event, field) ?? '';
    const result = await DialogV2.prompt({
      window: { title: label ? game.i18n.localize(label) : game.i18n.localize('PFAI.Edit') },
      position: { width: 640 },
      content: `<div class="pfai-form"><textarea name="value" rows="12">${escapeHTML(current)}</textarea></div>`,
      ok: {
        label: game.i18n.localize('PFAI.Save'),
        callback: (_e, button) => formValues(button),
      },
    });
    if (!result) return;

    await api.update(id, (draft) => {
      foundry.utils.setProperty(draft, field, String(result.value ?? ''));
    });
  }

  /**
   * Edit the numbers a GM tunes: the DC anchor, the clock, the party it was
   * sized for, and - for influence - the NPC's stat block.
   *
   * Written once for every subsystem. Only the rows a subsystem actually has
   * are rendered, so a new one inherits this without further work.
   */
  static async #onEditStats(_event, target) {
    const { key, id, api } = eventTarget(target.dataset);
    const event = api.get(id);
    if (!event) return;

    const isInfluence = key === 'influence';
    const roundMax = event.rounds?.max ?? '';
    const npcRows = isInfluence
      ? `<label class="pfai-field"><span>${game.i18n.localize('PFAI.Influence.NpcName')}</span>
           <input type="text" name="npcName" value="${escapeHTML(event.npc?.name ?? '')}"></label>
         <label class="pfai-field"><span>${game.i18n.localize('PFAI.Influence.Disposition')}</span>
           <input type="text" name="disposition" value="${escapeHTML(event.npc?.disposition ?? '')}"></label>
         <div class="pfai-field-row">
           <label class="pfai-field"><span>${game.i18n.localize('PFAI.Influence.Perception')}</span>
             <input type="number" name="perception" step="1" value="${event.perception ?? 0}"></label>
           <label class="pfai-field"><span>${game.i18n.localize('PFAI.Influence.Will')}</span>
             <input type="number" name="will" step="1" value="${event.will ?? 0}"></label>
         </div>`
      : '';
    // Research measures a round in hours or days; the others do not.
    const unitRow =
      event.rounds?.unit !== undefined
        ? `<label class="pfai-field"><span>${game.i18n.localize('PFAI.Research.RoundUnit')}</span>
             <input type="text" name="roundUnit" value="${escapeHTML(event.rounds.unit)}"></label>`
        : '';
    // Infiltration is the only one where simply taking time raises the stakes.
    const perRoundRow =
      event.awareness !== undefined
        ? `<label class="pfai-field"><span>${game.i18n.localize('PFAI.Infiltration.AwarenessPerRound')}</span>
             <input type="number" name="perRound" min="0" step="1" value="${event.awareness.perRound}">
             <small>${game.i18n.localize('PFAI.Infiltration.AwarenessPerRoundHint')}</small></label>`
        : '';

    const result = await DialogV2.prompt({
      window: { title: game.i18n.localize('PFAI.Settings.EventSettings') },
      position: { width: 560 },
      content: `<div class="pfai-form">
        ${npcRows}
        <div class="pfai-field-row">
          <label class="pfai-field"><span>${game.i18n.localize('PFAI.Chase.BaseDC')}</span>
            <input type="number" name="baseDC" min="1" step="1" value="${event.baseDC}">
            <small>${game.i18n.localize('PFAI.Influence.BaseDCNote')}</small></label>
          <label class="pfai-field"><span>${game.i18n.localize('PFAI.Influence.PartyLevel')}</span>
            <input type="number" name="level" min="0" step="1" value="${event.level}"></label>
          <label class="pfai-field"><span>${game.i18n.localize('PFAI.Influence.PartySize')}</span>
            <input type="number" name="partySize" min="1" step="1" value="${event.partySize}"></label>
        </div>
        <div class="pfai-field-row">
          <label class="pfai-field"><span>${game.i18n.localize('PFAI.Generate.RoundLimit')}</span>
            <input type="number" name="roundMax" min="0" step="1" value="${roundMax}">
            <small>${game.i18n.localize('PFAI.Influence.BlankForNone')}</small></label>
          ${unitRow}
          ${perRoundRow}
        </div>
      </div>`,
      ok: { label: game.i18n.localize('PFAI.Save'), callback: (_e, button) => formValues(button) },
    });
    if (!result) return;

    await api.update(id, (draft) => {
      // Changing the anchor does not retune DCs that already exist.
      draft.baseDC = Math.max(1, Number(result.baseDC) || draft.baseDC);
      draft.level = Math.max(0, Number(result.level) || 0);
      draft.partySize = Math.max(1, Number(result.partySize) || draft.partySize);
      const max = String(result.roundMax ?? '').trim();
      draft.rounds.max = max === '' ? null : Math.max(0, Number(max) || 0);
      if (result.roundUnit !== undefined) draft.rounds.unit = String(result.roundUnit);
      if (result.perRound !== undefined && draft.awareness) {
        draft.awareness.perRound = Math.max(0, Number(result.perRound) || 0);
      }
      if (isInfluence) {
        draft.npc.name = String(result.npcName ?? draft.npc.name);
        draft.npc.disposition = String(result.disposition ?? '');
        draft.perception = Number(result.perception) || 0;
        draft.will = Number(result.will) || 0;
      }
    });
  }


  /**
   * Add actors to a chase as participants, skipping ones already present.
   * @returns {number} how many were actually added
   */
  async #addActors(chaseId, actors, api = subsystem('chase')) {
    let added = 0;
    await api.update(chaseId, (chase) => {
      for (const actor of actors) {
        if (!actor) continue;
        // Match on uuid so the same actor cannot join twice.
        if (Object.values(chase.participants).some((p) => p.uuid === actor.uuid)) continue;
        const id = foundry.utils.randomID();
        chase.participants[id] = {
          id,
          name: actor.name,
          img: actor.img ?? '',
          uuid: actor.uuid,
          player: actor.hasPlayerOwner ?? false,
          hidden: false,
          hasActed: false,
          obstacle: 1,
          branch: '',
          // Unknown fields are dropped by whichever DataModel receives this,
          // so one shape serves both subsystems.
          contribution: { total: 0, byObstacle: {}, successes: 0, rolls: 0, discoveries: 0 },
        };
        added += 1;
      }
    });
    return added;
  }

  /**
   * Wire drag-and-drop by hand: ApplicationV2 ships no drag-drop support of its
   * own, unlike the v1 sheets.
   *
   * This was lost once already, and nothing noticed: #wireDropZone survived but
   * its only caller did not, so every roster still *looked* like a drop target
   * and silently accepted nothing. check-templates asserts a handler is
   * attached now, not merely that the zone renders.
   */
  _onRender(context, options) {
    super._onRender?.(context, options);
    if (!this.isGM) return;
    // Every subsystem's roster is a zone; take them all rather than the first.
    for (const zone of this.element?.querySelectorAll('.pfai-dropzone') ?? []) {
      this.#wireDropZone(zone);
    }
  }

  /** Attach drop handling to one roster. */
  #wireDropZone(zone) {
    let depth = 0;
    zone.addEventListener('dragenter', (event) => {
      event.preventDefault();
      depth += 1;
      zone.classList.add('is-dragover');
    });
    zone.addEventListener('dragover', (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    });
    // dragleave fires for child elements too, so count nesting depth.
    zone.addEventListener('dragleave', () => {
      depth = Math.max(0, depth - 1);
      if (!depth) zone.classList.remove('is-dragover');
    });
    zone.addEventListener('drop', async (event) => {
      event.preventDefault();
      depth = 0;
      zone.classList.remove('is-dragover');
      await this.#handleDrop(event, zone.dataset);
    });
  }

  /** Resolve a dropped Actor or Actor folder into participants. */
  async #handleDrop(event, dataset) {
    const { id, api } = eventTarget(dataset);
    if (!this.isGM || !id) return;

    let data;
    try {
      data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    } catch {
      return;
    }

    let actors = [];
    if (data?.type === 'Actor') {
      const actor = await Actor.implementation.fromDropData(data);
      if (actor) actors = [actor];
    } else if (data?.type === 'Folder') {
      const folder = await fromUuid(data.uuid);
      // Dragging a party folder should bring everyone in it, nesting included.
      if (folder?.type === 'Actor') actors = folder.contents ?? [];
    }

    if (!actors.length) {
      ui.notifications.warn(game.i18n.localize('PFAI.Chase.DropNotAnActor'));
      return;
    }

    const added = await this.#addActors(id, actors, api);
    if (added) {
      ui.notifications.info(game.i18n.format('PFAI.Chase.ParticipantsAdded', { count: added }));
    } else {
      ui.notifications.info(game.i18n.localize('PFAI.Chase.ParticipantsAlreadyPresent'));
    }
  }

  static async #onAddParticipants(_event, target) {
    const chaseId = target.dataset.chaseId;
    const actors = collectCandidateActors();
    if (!actors.length) {
      ui.notifications.warn(game.i18n.localize('PFAI.Errors.NoParticipants'));
      return;
    }

    const added = await this.#addActors(id, actors, api);
    if (!added) ui.notifications.info(game.i18n.localize('PFAI.Chase.ParticipantsAlreadyPresent'));
  }

  static async #onRemoveParticipant(_event, target) {
    const { participantId } = target.dataset;
    const { id, api } = eventTarget(target.dataset);
    const event = api.get(id);
    const participant = event?.participants?.[participantId];
    if (!participant) return;

    // Removing someone discards what they contributed, so confirm once they
    // have actually done something.
    const contributed = participant.contribution?.rolls || participant.contribution?.total;
    if (contributed) {
      const confirmed = await DialogV2.confirm({
        window: { title: game.i18n.localize('PFAI.Chase.RemoveParticipantTitle') },
        content: `<p>${game.i18n.format('PFAI.Chase.RemoveParticipantConfirm', { name: participant.name })}</p>`,
      });
      if (!confirmed) return;
    }

    const store = api.getAll();
    const stored = store.events[id];
    if (!stored) return;
    const { [participantId]: _removed, ...remaining } = stored.participants;
    // Rebuild rather than delete so the TypedObjectField drops the key cleanly.
    stored.participants = remaining;
    await api.save(store);
  }

  static async #onParticipantDelta(_event, target) {
    const { chaseId, participantId } = target.dataset;
    const delta = Number(target.dataset.delta);
    await updateChase(chaseId, (chase) => {
      const participant = chase.participants[participantId];
      if (!participant) return;
      const max = Math.max(1, Object.keys(chase.obstacles).length);
      participant.obstacle = Math.clamp(participant.obstacle + delta, 1, max);
    });
  }

  /** Roll one of the active obstacle's skill options for a participant. */
  static async #onRollCheck(_event, target) {
    const { chaseId, obstacleId, participantId } = target.dataset;
    // The option comes from the select next to this participant's roll button.
    const row = target.closest('.pfai-participant');
    const optionId = row?.querySelector('.pfai-roll-option')?.value;
    if (!optionId) return;
    // A GM clicking Roll on someone who already acted means they intend to.
    await rollChaseCheck({ chaseId, obstacleId, participantId, optionId, force: game.user.isGM });
  }

  /** GM-only: hand a participant a success, or take one back. */
  /** Published rule: passing a turn costs the group a chase point. */
  static async #onPassTurn(_event, target) {
    const { chaseId, obstacleId, participantId } = target.dataset;
    await passTurn({ chaseId, obstacleId, participantId, force: game.user.isGM });
  }

  /**
   * Fill or replace this obstacle's content with AI, keeping its place in the
   * chase. This is how a blank obstacle or a blank fork gets populated.
   */
  static async #onRegenerateObstacle(_event, target) {
    if (this.#generatingObstacle) return;
    const { chaseId, obstacleId } = target.dataset;
    const chase = getChase(chaseId);
    const existing = chase?.obstacles?.[obstacleId];
    if (!chase || !existing) return;

    if (!hasApiKey()) {
      ui.notifications.error(game.i18n.localize('PFAI.Errors.NoApiKey'));
      return;
    }
    const premise = htmlToText(chase.premise);
    if (!premise) {
      ui.notifications.warn(game.i18n.localize('PFAI.Errors.NoPremiseOnChase'));
      return;
    }

    // Replacing written content is worth confirming; filling a blank is not.
    if (Object.keys(existing.skillOptions ?? {}).length > 0) {
      const confirmed = await DialogV2.confirm({
        window: { title: game.i18n.localize('PFAI.Chase.RegenerateObstacleTitle') },
        content: `<p>${game.i18n.format('PFAI.Chase.RegenerateObstacleConfirm', { name: existing.name })}</p>`,
      });
      if (!confirmed) return;
    }

    this.#generatingObstacle = true;
    await this.render();

    try {
      // Alternatives at the same step are meant to differ from each other, so
      // exclude siblings from the "do not repeat these" list.
      const others = Object.values(chase.obstacles)
        .filter((o) => o.position !== existing.position)
        .sort((a, b) => a.position - b.position)
        .map((o) => o.name);

      const generated = await generateOneObstacle({
        premise,
        baseDC: chase.baseDC,
        level: chase.level,
        partySize: chase.partySize,
        difficulty: 'auto',
        existingObstacles: others,
        language: game.settings.get(MODULE_ID, 'outputLanguage')?.trim() || game.i18n.lang,
        model: activeModel(),
      });

      await updateChase(chaseId, (draft) => {
        const slot = draft.obstacles[obstacleId];
        if (!slot) return;
        const fresh = toObstacleEntry(generated, draft.baseDC, {
          position: slot.position,
          locked: slot.locked,
          partySize: draft.partySize,
        });
        // Keep its identity and place; replace only the authored content.
        slot.name = fresh.name;
        slot.overcome = fresh.overcome;
        slot.skillOptions = fresh.skillOptions;
        slot.rounds = { current: slot.rounds?.current ?? 0, max: fresh.rounds.max };
        slot.chasePoints = { current: 0, goal: fresh.chasePoints.goal };
      });

      ui.notifications.info(game.i18n.format('PFAI.Chase.ObstacleFilled', { name: generated.name }));
    } catch (error) {
      console.error(`${MODULE_ID} | obstacle regeneration failed`, error);
      ui.notifications.error(error.message, { permanent: true });
    } finally {
      this.#generatingObstacle = false;
      await this.render();
    }
  }

  /**
   * Fork this step, creating a sibling obstacle the party can take instead.
   *
   * Only steps after the first can fork: a fork is chosen by the rolls at the
   * preceding step, and step one has no predecessor.
   */
  static async #onAddBranch(_event, target) {
    const { chaseId, obstacleId } = target.dataset;
    const chase = getChase(chaseId);
    const source = chase?.obstacles?.[obstacleId];
    if (!source) return;

    if (source.position === stepsOf(chase.obstacles)[0]) {
      ui.notifications.warn(game.i18n.localize('PFAI.Chase.CannotForkFirstStep'));
      return;
    }

    let newId = null;
    await updateChase(chaseId, (draft) => {
      const original = draft.obstacles[obstacleId];
      if (!original) return;

      // The first fork also labels the existing obstacle, so "2" becomes "2A".
      if (!original.branch) original.branch = nextBranchLabel(draft.obstacles, original.position);

      newId = foundry.utils.randomID();
      draft.obstacles[newId] = {
        id: newId,
        position: original.position,
        branch: nextBranchLabel(draft.obstacles, original.position),
        name: game.i18n.localize('PFAI.Chase.NewBranch'),
        img: '',
        locked: true,
        chasePoints: { goal: original.chasePoints.goal, current: 0 },
        rounds: { current: 0, max: original.rounds?.max ?? null },
        skillOptions: {},
        overcome: '',
      };
    });

    if (newId) {
      ui.notifications.info(game.i18n.localize('PFAI.Chase.BranchAdded'));
      // The preceding step's approaches now lead somewhere ambiguous.
      SubsystemView.#warnUnrouted(chaseId, getChase(chaseId).obstacles[newId].position);
    }
    this.render();
  }

  /** Tell the GM which approaches now need pointing at a route. */
  static #warnUnrouted(chaseId, forkedPosition) {
    const chase = getChase(chaseId);
    if (!chase) return;
    const steps = stepsOf(chase.obstacles);
    const previous = steps[steps.indexOf(forkedPosition) - 1];
    if (previous === undefined) return;
    const count = branchesAt(chase.obstacles, previous).reduce(
      (sum, o) => sum + unroutedOptions(o, chase.obstacles).length,
      0,
    );
    if (count) {
      ui.notifications.warn(game.i18n.format('PFAI.Chase.UnroutedWarning', { count }));
    }
  }

  /**
   * Fork this step with AI, then point the *preceding* step's approaches at the
   * resulting routes. The fork is chosen by how you tackle the step before it,
   * so that is where the routing has to live.
   */
  static async #onGenerateBranch(_event, target) {
    if (this.#generatingObstacle) return;
    const { chaseId, obstacleId } = target.dataset;
    const chase = getChase(chaseId);
    const source = chase?.obstacles?.[obstacleId];
    if (!chase || !source) return;

    const steps = stepsOf(chase.obstacles);
    if (source.position === steps[0]) {
      ui.notifications.warn(game.i18n.localize('PFAI.Chase.CannotForkFirstStep'));
      return;
    }
    if (!hasApiKey()) {
      ui.notifications.error(game.i18n.localize('PFAI.Errors.NoApiKey'));
      return;
    }
    const premise = htmlToText(chase.premise);
    if (!premise) {
      ui.notifications.warn(game.i18n.localize('PFAI.Errors.NoPremiseOnChase'));
      return;
    }

    this.#generatingObstacle = true;
    await this.render();

    try {
      // Every obstacle on the preceding step needs its approaches routed.
      const previousPosition = steps[steps.indexOf(source.position) - 1];
      const previous = branchesAt(chase.obstacles, previousPosition);
      const optionLabels = [
        ...new Set(
          previous.flatMap((o) =>
            Object.values(o.skillOptions ?? {}).map((option) => option.label),
          ),
        ),
      ];

      const result = await generateFork({
        premise,
        baseDC: chase.baseDC,
        level: chase.level,
        partySize: chase.partySize,
        difficulty: 'auto',
        language: game.settings.get(MODULE_ID, 'outputLanguage')?.trim() || game.i18n.lang,
        forkFrom: {
          name: source.name,
          description: htmlToText(source.overcome).split('\n')[0],
          previousName: previous[0]?.name ?? '',
          optionLabels,
        },
      });

      await updateChase(chaseId, (draft) => {
        const original = draft.obstacles[obstacleId];
        if (!original) return;

        if (!original.branch) original.branch = nextBranchLabel(draft.obstacles, original.position);
        const entry = toObstacleEntry(result.alternative, draft.baseDC, {
          position: original.position,
          locked: true,
          partySize: draft.partySize,
        });
        entry.branch = nextBranchLabel(draft.obstacles, original.position);
        // A fork's own approaches route onward, not into its sibling.
        for (const option of Object.values(entry.skillOptions)) option.leadsTo = '';
        draft.obstacles[entry.id] = entry;

        const byLabel = new Map(
          (result.routing ?? []).map((r) => [String(r.optionLabel).toLowerCase(), r.leadsTo]),
        );
        for (const step of branchesAt(draft.obstacles, previousPosition)) {
          for (const option of Object.values(step.skillOptions ?? {})) {
            const side = byLabel.get(option.label.toLowerCase());
            if (side) option.leadsTo = side === 'B' ? entry.branch : original.branch;
          }
          step.overcome = rebuildOvercomeRoutes(step);
        }
      });

      ui.notifications.info(
        game.i18n.format('PFAI.Chase.ForkGenerated', { name: result.alternative.name }),
      );
      SubsystemView.#warnUnrouted(chaseId, source.position);
    } catch (error) {
      console.error(`${MODULE_ID} | fork generation failed`, error);
      ui.notifications.error(error.message, { permanent: true });
    } finally {
      this.#generatingObstacle = false;
      await this.render();
    }
  }

  /** Move a participant onto one of the forks at their current step. */
  static async #onSetParticipantBranch(_event, target) {
    const { chaseId, participantId, branch } = target.dataset;
    await updateChase(chaseId, (chase) => {
      const participant = chase.participants[participantId];
      if (participant) participant.branch = branch ?? '';
    });
  }

  static async #onAwardContribution(_event, target) {
    const { chaseId, obstacleId, participantId } = target.dataset;
    await adjustContribution({
      chaseId,
      obstacleId,
      participantId,
      delta: Number(target.dataset.delta),
    });
  }

  static async #onObstacleRoundDelta(_event, target) {
    const { chaseId, obstacleId } = target.dataset;
    const delta = Number(target.dataset.delta);
    await updateChase(chaseId, (chase) => {
      const obstacle = chase.obstacles[obstacleId];
      if (!obstacle) return;
      obstacle.rounds.current = Math.max(0, (obstacle.rounds.current ?? 0) + delta);
    });
  }

  static async #onToggleActed(_event, target) {
    const { chaseId, participantId } = target.dataset;
    await updateChase(chaseId, (chase) => {
      const participant = chase.participants[participantId];
      if (participant) participant.hasActed = !participant.hasActed;
    });
  }

  /** Advance the round counter and clear everyone's acted flag. */
  static async #onNextRound(_event, target) {
    await updateChase(target.dataset.chaseId, (chase) => {
      chase.rounds.current += 1;
      for (const participant of Object.values(chase.participants)) participant.hasActed = false;

      // The round the party just spent belongs to the obstacle they are facing.
      const obstacles = Object.values(chase.obstacles).sort((a, b) => a.position - b.position);
      const pinned = chase.activeObstacle ? chase.obstacles[chase.activeObstacle] : null;
      const live =
        pinned ?? obstacles.find((o) => o.chasePoints.current < o.chasePoints.goal) ?? null;
      if (live) live.rounds.current = (live.rounds.current ?? 0) + 1;
    });
  }

  static #onExportEvent(_event, target) {
    const { key, id, api } = eventTarget(target.dataset);
    const event = api.get(id);
    if (!event) return;
    foundry.utils.saveDataToFile(
      JSON.stringify(exportPayload(key, event), null, 2),
      'text/json',
      `${event.name.slugify({ strict: true }) || key}.json`,
    );
  }

  /**
   * Read a file an agent produced, and say what is wrong with it.
   *
   * The old behaviour was a single "that is not an encounter" for everything
   * from broken JSON to one mistyped skill, which tells a GM holding a
   * thousand-line file nothing at all. Every problem is now listed with the
   * path that carries it.
   */
  static async #onImportEvent() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';

    const text = await new Promise((resolve) => {
      input.addEventListener('change', () => {
        const file = input.files?.[0];
        if (!file) return resolve(null);
        file.text().then(resolve, () => resolve(null));
      });
      input.click();
    });
    if (!text) return;

    const parsed = parseExchange(text);
    if (parsed.problems.length && !(await SubsystemView.#confirmImport(parsed))) return;
    if (!parsed.ok) return;

    const imported = await applyExchange(parsed);
    if (!imported) {
      ui.notifications.error(game.i18n.localize('PFAI.Errors.BadImport'));
      return;
    }

    // Land the user on whatever they imported, whichever subsystem it belongs to.
    this.#subsystem = imported.key;
    this.#select(imported.key, imported.id);
    this.render();
  }

  /**
   * Show what the verifier found.
   *
   * Errors end the import; warnings are things a GM may well have meant, so
   * those offer to carry on.
   */
  static async #confirmImport(parsed) {
    const errors = parsed.problems.filter((p) => p.severity === 'error');
    const warnings = parsed.problems.filter((p) => p.severity !== 'error');

    const rows = (list) =>
      list
        .map(
          (p) =>
            `<li><code>${escapeHTML(p.path)}</code><span>${escapeHTML(p.message)}</span></li>`,
        )
        .join('');

    const sections = [];
    if (errors.length) {
      sections.push(
        `<section class="pfai-import-errors"><h4>${game.i18n.format('PFAI.Import.Errors', {
          count: errors.length,
        })}</h4><ul class="pfai-import-problems">${rows(errors)}</ul></section>`,
      );
    }
    if (warnings.length) {
      sections.push(
        `<section class="pfai-import-warnings"><h4>${game.i18n.format('PFAI.Import.Warnings', {
          count: warnings.length,
        })}</h4><ul class="pfai-import-problems">${rows(warnings)}</ul></section>`,
      );
    }

    const content = `<div class="pfai pfai-import-report">
      <p>${escapeHTML(
        errors.length
          ? game.i18n.localize('PFAI.Import.Refused')
          : game.i18n.localize('PFAI.Import.WarnOnly'),
      )}</p>
      ${sections.join('')}
    </div>`;

    if (errors.length) {
      await DialogV2.prompt({
        window: { title: game.i18n.localize('PFAI.Import.ReportTitle'), icon: 'fa-solid fa-triangle-exclamation' },
        position: { width: 620 },
        content,
        ok: { label: game.i18n.localize('PFAI.Close') },
      });
      return false;
    }

    return DialogV2.confirm({
      window: { title: game.i18n.localize('PFAI.Import.ReportTitle'), icon: 'fa-solid fa-triangle-exclamation' },
      position: { width: 620 },
      content,
      yes: { label: game.i18n.localize('PFAI.Import.ImportAnyway') },
      no: { label: game.i18n.localize('PFAI.Cancel') },
    });
  }
}

/**
 * Re-annotate an obstacle's stored HTML with the routes its approaches lead to.
 *
 * Idempotent: existing annotations are stripped first, so re-routing an
 * approach corrects the read-aloud prose instead of leaving a stale note or
 * stacking a second one beside it.
 */
function rebuildOvercomeRoutes(obstacle) {
  // Strip any previous route note, whatever branch it named.
  const noteFor = (branch) => game.i18n.format('PFAI.Chase.LeadsToRoute', { branch });
  const anyNote = new RegExp(
    `\\s*<em>${escapeRegExp(noteFor('\u0000')).replace('\u0000', '[^<]*')}</em>`,
    'g',
  );
  let html = (obstacle.overcome ?? '').replace(anyNote, '');

  for (const option of Object.values(obstacle.skillOptions ?? {})) {
    if (!option.leadsTo) continue;
    const note = ` <em>${noteFor(option.leadsTo)}</em>`;
    const pattern = new RegExp(`(\\{${escapeRegExp(option.label)}\\}[^<]*)(</li>)`);
    if (pattern.test(html)) html = html.replace(pattern, `$1${note}$2`);
  }
  return html;
}

function escapeRegExp(value) {
  return String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Flatten stored HTML back to plain text for use as a prompt. */
function htmlToText(html) {
  if (!html) return '';
  const div = document.createElement('div');
  div.innerHTML = html.replace(/<\/p>\s*<p>/gi, '\n\n').replace(/<br\s*\/?>/gi, '\n');
  return (div.textContent ?? '').trim();
}

/** Selected tokens if any, otherwise the active party's members. */
function collectCandidateActors() {
  const selected = canvas.tokens?.controlled?.map((token) => token.actor).filter(Boolean) ?? [];
  if (selected.length) return selected;
  const party = game.actors.find((actor) => actor.type === 'party' && actor.active);
  return party?.members?.filter(Boolean) ?? [];
}
