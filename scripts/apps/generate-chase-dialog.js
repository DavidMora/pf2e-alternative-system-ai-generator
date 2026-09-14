import {
  DEFAULT_BASE_DC,
  GENERATION_DIFFICULTY,
  MODULE_ID,
  SETTINGS,
} from '../constants.js';
import {
  applyFork,
  generateChase,
  generateFork,
  generateObstacles,
  premiseToHTML,
  withListPosition,
} from '../ai/chase.js';
import { activeModel, hasApiKey } from '../ai/openai.js';
import { makeSaveBrief } from '../exchange.js';
import {
  branchesAt,
  forkTargets,
  getChase,
  getChases,
  guessPartyLevel,
  setChases,
  stepsOf,
  suggestedBaseDC,
  updateChase,
} from '../helpers.js';

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

/**
 * Turns a GM-written premise into chase content.
 *
 * With no `chaseId` it creates a whole chase. With one it regenerates just that
 * chase's obstacles, leaving the GM's premise, title and notes intact.
 */
export class GenerateChaseDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  /**
   * @param {object} [options]
   * @param {string} [options.chaseId] regenerate obstacles for this chase.
   * @param {(chaseId: string) => void} [options.onGenerated]
   */
  constructor({ chaseId, onGenerated, ...options } = {}) {
    super(options);
    this.#chaseId = chaseId ?? null;
    this.#onGenerated = onGenerated;
    this.#abortController = null;
  }

  #chaseId;
  #onGenerated;
  #abortController;
  #busy = false;

  get obstaclesOnly() {
    return this.#chaseId !== null;
  }

  static DEFAULT_OPTIONS = {
    id: 'pfai-generate-chase',
    tag: 'form',
    classes: ['pfai', 'pfai-generate'],
    window: {
      title: 'PFAI.Generate.Title',
      icon: 'fa-solid fa-wand-magic-sparkles',
      resizable: true,
    },
    position: { width: 580, height: 'auto' },
    form: {
      handler: GenerateChaseDialog.#onSubmit,
      closeOnSubmit: false,
    },
    actions: {
      cancel: GenerateChaseDialog.#onCancel,
      saveBrief: makeSaveBrief('chase'),
    },
  };

  static PARTS = {
    form: { template: `modules/${MODULE_ID}/templates/generate-chase-dialog.hbs` },
  };

  /** Strip stored HTML back to plain text so the textarea round-trips cleanly. */
  static #htmlToText(html) {
    if (!html) return '';
    const div = document.createElement('div');
    div.innerHTML = html.replace(/<\/p>\s*<p>/gi, '\n\n').replace(/<br\s*\/?>/gi, '\n');
    return (div.textContent ?? '').trim();
  }

  async _prepareContext() {
    const chase = this.obstaclesOnly ? getChase(this.#chaseId) : null;
    const configuredLanguage = game.settings.get(MODULE_ID, SETTINGS.outputLanguage)?.trim();

    return {
      busy: this.#busy,
      hasApiKey: hasApiKey(),
      model: activeModel(),
      obstaclesOnly: this.obstaclesOnly,
      existingObstacles: chase ? Object.keys(chase.obstacles).length : 0,
      premise: chase ? GenerateChaseDialog.#htmlToText(chase.premise) : '',
      title: chase?.name ?? '',
      baseDC: chase?.baseDC ?? suggestedBaseDC() ?? DEFAULT_BASE_DC,
      difficulties: Object.entries(GENERATION_DIFFICULTY).map(([value, label]) => ({
        value,
        label: game.i18n.localize(label),
      })),
      language: configuredLanguage || game.i18n.lang,
    };
  }

  static async #onSubmit(_event, _form, formData) {
    if (this.#busy) return;
    const data = formData.object;

    const premise = String(data.premise ?? '').trim();
    if (!premise) {
      ui.notifications.warn(game.i18n.localize('PFAI.Errors.NoPremise'));
      return;
    }
    if (!hasApiKey()) {
      ui.notifications.error(game.i18n.localize('PFAI.Errors.NoApiKey'));
      return;
    }

    // Regenerating discards the obstacles already in the chase.
    if (this.obstaclesOnly) {
      const existing = Object.keys(getChase(this.#chaseId)?.obstacles ?? {}).length;
      if (existing > 0) {
        const confirmed = await DialogV2.confirm({
          window: { title: game.i18n.localize('PFAI.Confirm.ReplaceObstaclesTitle') },
          content: `<p>${game.i18n.format('PFAI.Confirm.ReplaceObstacles', { count: existing })}</p>`,
        });
        if (!confirmed) return;
      }
    }

    const options = {
      premise,
      title: String(data.title ?? '').trim(),
      baseDC: Math.clamp(Number(data.baseDC) || DEFAULT_BASE_DC, 1, 60),
      // Blank or 0 means "let the model decide".
      obstacleCount: Math.clamp(Number(data.obstacleCount) || 0, 0, 10),
      // The GM decides how many times the route splits; the model only
      // invents what is down each side.
      forkCount: Math.clamp(Number(data.forkCount) || 0, 0, 4),
      difficulty: data.difficulty ?? 'auto',
      roundLimit: Math.max(0, Number(data.roundLimit) || 0),
      level: guessPartyLevel(),
      tone: String(data.tone ?? '').trim(),
      language: String(data.language ?? '').trim(),
      model: activeModel(),
    };

    this.#busy = true;
    this.#abortController = new AbortController();
    await this.render();

    try {
      let chaseId;
      if (this.obstaclesOnly) {
        const obstacles = await generateObstacles(options, { signal: this.#abortController.signal });
        await updateChase(this.#chaseId, (chase) => {
          chase.obstacles = obstacles;
          chase.baseDC = options.baseDC;
          // Keep the GM's edits to the premise from this dialog.
          chase.premise = premiseToHTML(premise);
          if (options.title) chase.name = options.title;
          chase.ai = {
            generated: true,
            model: options.model,
            prompt: premise,
            generatedAt: Date.now(),
          };
        });
        chaseId = this.#chaseId;
        ui.notifications.info(
          game.i18n.format('PFAI.Generate.ObstaclesSuccess', {
            count: Object.keys(obstacles).length,
          }),
        );
      } else {
        const chaseData = await generateChase(options, { signal: this.#abortController.signal });
        const chases = getChases();
        const stored = withListPosition(chaseData, chases.events);
        chases.events[stored.id] = stored;
        await setChases(chases);
        chaseId = stored.id;
        ui.notifications.info(game.i18n.format('PFAI.Generate.Success', { name: stored.name }));
      }

      if (options.forkCount > 0) await this.#addForks(chaseId, options);

      this.#onGenerated?.(chaseId);
      await this.close();
    } catch (error) {
      if (error.name === 'AbortError') {
        ui.notifications.info(game.i18n.localize('PFAI.Generate.Cancelled'));
      } else {
        console.error(`${MODULE_ID} | chase generation failed`, error);
        ui.notifications.error(error.message, { permanent: true });
      }
      this.#busy = false;
      this.#abortController = null;
      await this.render();
    }
  }

  /**
   * Split the route where the GM asked for splits.
   *
   * Run after the obstacles exist, because a fork is defined against one: it
   * needs the obstacle it forks from and the approaches at the step before,
   * so that succeeding at one of them commits a character to a side. Each
   * fork is one further request, which is why the field says so.
   *
   * Falls short quietly rather than failing the whole generation: a chase
   * with three obstacles and two forks asked for is still a usable chase.
   */
  async #addForks(chaseId, options) {
    const chase = getChase(chaseId);
    if (!chase) return;

    const targets = forkTargets(stepsOf(chase.obstacles), options.forkCount);
    if (!targets.length) {
      ui.notifications.warn(game.i18n.format('PFAI.Generate.NoRoomToFork', { name: chase.name }));
      return;
    }

    let done = 0;
    for (const position of targets) {
      if (this.#abortController?.signal.aborted) break;
      const current = getChase(chaseId);
      const source = branchesAt(current.obstacles, position)[0];
      if (!source) continue;

      const steps = stepsOf(current.obstacles);
      const previous = branchesAt(current.obstacles, steps[steps.indexOf(position) - 1]);
      const optionLabels = [
        ...new Set(
          previous.flatMap((o) => Object.values(o.skillOptions ?? {}).map((opt) => opt.label)),
        ),
      ];

      try {
        const result = await generateFork(
          {
            premise: GenerateChaseDialog.#htmlToText(current.premise),
            baseDC: current.baseDC,
            level: options.level,
            partySize: current.partySize,
            difficulty: options.difficulty,
            language: options.language,
            forkFrom: {
              name: source.name,
              description: GenerateChaseDialog.#htmlToText(source.overcome).split('\n')[0],
              previousName: previous[0]?.name ?? '',
              optionLabels,
            },
          },
          { signal: this.#abortController?.signal },
        );
        await updateChase(chaseId, (draft) => { applyFork(draft, source.id, result); });
        done += 1;
      } catch (error) {
        if (error.name === 'AbortError') break;
        console.error(`${MODULE_ID} | fork generation failed`, error);
      }
    }

    const name = getChase(chaseId)?.name ?? '';
    ui.notifications.info(
      done === targets.length
        ? game.i18n.format('PFAI.Generate.ForksAdded', { count: done, name })
        : game.i18n.format('PFAI.Generate.ForksPartial', { done, asked: targets.length, name }),
    );
  }

  static #onCancel() {
    if (this.#busy) {
      this.#abortController?.abort();
      return;
    }
    this.close();
  }

  async close(options) {
    this.#abortController?.abort();
    return super.close(options);
  }
}
