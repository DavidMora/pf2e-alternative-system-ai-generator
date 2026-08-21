import {
  DEFAULT_BASE_DC,
  GENERATION_DIFFICULTY,
  MODULE_ID,
  SETTINGS,
} from '../constants.js';
import {
  generateChase,
  generateObstacles,
  premiseToHTML,
  withListPosition,
} from '../ai/chase.js';
import { activeModel, hasApiKey } from '../ai/openai.js';
import { makeSaveBrief } from '../exchange.js';
import {
  getChase,
  getChases,
  guessPartyLevel,
  setChases,
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
