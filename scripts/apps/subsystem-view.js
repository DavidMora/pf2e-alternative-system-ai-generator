import { MODULE_ID } from '../constants.js';
import {
  deleteChase,
  enrich,
  escapeHTML,
  guessPartyLevel,
  suggestedBaseDC,
  getChase,
  getChases,
  branchesAt,
  nextBranchLabel,
  nextPosition,
  nextStepPosition,
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
import { generateFork, generateOneObstacle, toObstacleEntry } from '../ai/chase.js';
import { GenerateImageDialog } from './generate-image-dialog.js';
import { emitShowChase } from '../socket.js';
import { adjustContribution, passTurn, rollChaseCheck } from '../rolls.js';
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
      exportChase: SubsystemView.#onExportChase,
      importChase: SubsystemView.#onImportChase,
    },
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/subsystem-view.hbs`, scrollable: [''] },
  };

  /** Open the window, optionally jumping straight to one chase. */
  static async open(chaseId = null) {
    const existing = foundry.applications.instances.get('pfai-subsystem-view');
    const app = existing instanceof SubsystemView ? existing : new SubsystemView();
    if (chaseId) {
      app.#selectedId = chaseId;
      // Start on the active obstacle rather than wherever this user last browsed.
      app.#obstacleIndex = null;
    }
    await app.render({ force: true });
    // A window that is already open but minimised or behind others would
    // otherwise look like nothing happened.
    if (app.minimized) await app.maximize();
    app.bringToFront();
    return app;
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

    return {
      isGM,
      isRealGM: game.user.isGM,
      previewAsPlayer: this.#previewAsPlayer,
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

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  static #onGenerate() {
    new GenerateChaseDialog({ onGenerated: (id) => this.select(id) }).render({ force: true });
  }

  static async #onCreateBlank() {
    const chases = getChases();
    const id = foundry.utils.randomID();
    chases.events[id] = {
      id,
      name: game.i18n.localize('PFAI.Chase.NewChase'),
      position: nextPosition(chases.events),
      img: '',
      premise: '',
      gmNotes: '',
      baseDC: suggestedBaseDC(),
      level: guessPartyLevel(),
      hidden: true,
      started: false,
      rounds: { current: 0, max: null },
      obstacles: {},
      participants: {},
      ai: { generated: false, model: '', prompt: '', generatedAt: 0 },
    };
    await setChases(chases);
    this.select(id);
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

  /** Open this chase on every connected player's screen. */
  static async #onShowToPlayers(_event, target) {
    const chaseId = target.dataset.chaseId;
    const chase = getChase(chaseId);
    if (!chase) return;

    const players = game.users.filter((user) => user.active && !user.isGM);
    if (!players.length) {
      ui.notifications.warn(game.i18n.localize('PFAI.View.NoPlayersOnline'));
      return;
    }

    // Pushing a hidden chase would open an empty window on their screens.
    if (chase.hidden) {
      const confirmed = await DialogV2.confirm({
        window: { title: game.i18n.localize('PFAI.View.RevealAndShowTitle') },
        content: `<p>${game.i18n.format('PFAI.View.RevealAndShow', { name: chase.name })}</p>`,
      });
      if (!confirmed) return;
      await updateChase(chaseId, (draft) => {
        draft.hidden = false;
      });
    }

    emitShowChase(chaseId, players.map((user) => user.id));
    ui.notifications.info(
      game.i18n.format('PFAI.View.ShownToPlayers', {
        count: players.length,
        names: players.map((user) => user.name).join(', '),
      }),
    );
  }

  static #onGenerateImage(_event, target) {
    const { chaseId, obstacleId } = target.dataset;
    new GenerateImageDialog({
      chaseId,
      obstacleId: obstacleId || undefined,
      onGenerated: () => this.render(),
    }).render({ force: true });
  }

  static async #onClearImage(_event, target) {
    const { chaseId, obstacleId } = target.dataset;
    await updateChase(chaseId, (chase) => {
      if (obstacleId) {
        const obstacle = chase.obstacles[obstacleId];
        if (obstacle) obstacle.img = '';
      } else {
        chase.img = '';
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
    const chaseId = target.dataset.chaseId;
    const chase = getChase(chaseId);
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
    await updateChase(chaseId, (draft) => {
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
    await updateChase(target.dataset.chaseId, (chase) => {
      chase.hidden = !chase.hidden;
    });
  }

  static async #onToggleStarted(_event, target) {
    await updateChase(target.dataset.chaseId, (chase) => {
      chase.started = !chase.started;
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

  static async #onEditText(_event, target) {
    const { chaseId, field } = target.dataset;
    const chase = getChase(chaseId);
    if (!chase) return;

    const result = await DialogV2.prompt({
      window: { title: game.i18n.localize(`PFAI.Chase.Edit${field === 'gmNotes' ? 'GmNotes' : 'Premise'}`) },
      position: { width: 620 },
      content: `<div class="pfai-form"><textarea name="value" rows="12">${escapeHTML(chase[field])}</textarea></div>`,
      ok: {
        label: game.i18n.localize('PFAI.Save'),
        callback: (_event, button) => formValues(button),
      },
    });
    if (!result) return;

    await updateChase(chaseId, (draft) => {
      draft[field] = String(result.value ?? '');
    });
  }

  /**
   * Add actors to a chase as participants, skipping ones already present.
   * @returns {number} how many were actually added
   */
  async #addActors(chaseId, actors) {
    let added = 0;
    await updateChase(chaseId, (chase) => {
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
          contribution: { total: 0, byObstacle: {}, successes: 0, rolls: 0 },
        };
        added += 1;
      }
    });
    return added;
  }

  /**
   * Wire drag-and-drop by hand: ApplicationV2 ships no drag-drop support of its
   * own, unlike the v1 sheets.
   */
  _onRender(context, options) {
    super._onRender?.(context, options);
    const zone = this.element?.querySelector('.pfai-dropzone');
    if (!zone || !this.isGM) return;

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
      await this.#handleDrop(event, zone.dataset.chaseId);
    });
  }

  /** Resolve a dropped Actor or Actor folder into participants. */
  async #handleDrop(event, chaseId) {
    if (!this.isGM || !chaseId) return;

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

    const added = await this.#addActors(chaseId, actors);
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

    const added = await this.#addActors(chaseId, actors);
    if (!added) ui.notifications.info(game.i18n.localize('PFAI.Chase.ParticipantsAlreadyPresent'));
  }

  static async #onRemoveParticipant(_event, target) {
    const { chaseId, participantId } = target.dataset;
    const chases = getChases();
    const chase = chases.events[chaseId];
    if (!chase) return;
    const { [participantId]: _removed, ...remaining } = chase.participants;
    chase.participants = remaining;
    await setChases(chases);
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

  static #onExportChase(_event, target) {
    const chase = getChase(target.dataset.chaseId);
    if (!chase) return;
    const payload = { module: MODULE_ID, type: 'chase', version: 1, data: chase };
    foundry.utils.saveDataToFile(
      JSON.stringify(payload, null, 2),
      'text/json',
      `${chase.name.slugify({ strict: true }) || 'chase'}.json`,
    );
  }

  static async #onImportChase() {
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

    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      ui.notifications.error(game.i18n.localize('PFAI.Errors.BadImport'));
      return;
    }
    if (payload?.type !== 'chase' || !payload.data) {
      ui.notifications.error(game.i18n.localize('PFAI.Errors.BadImport'));
      return;
    }

    const chases = getChases();
    // Always re-key on import so a re-imported file never overwrites the original.
    const id = foundry.utils.randomID();
    chases.events[id] = { ...payload.data, id, position: nextPosition(chases.events) };
    await setChases(chases);
    this.select(id);
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
