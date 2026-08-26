import {
  DEFAULT_BASE_DC,
  MODULE_ID,
  SETTINGS,
  VICTORY_SCALES,
  VICTORY_STRUCTURES,
} from '../constants.js';
import { generateVictory, withListPosition } from '../ai/victory.js';
import { activeModel, hasApiKey } from '../ai/openai.js';
import { makeSaveBrief } from '../exchange.js';
import {
  getVictories,
  guessPartyLevel,
  guessPartySize,
  setVictories,
  suggestedBaseDC,
} from '../helpers.js';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Builds a Victory Point contest from the situation and objective the GM supplies.
 *
 * As with influence, the model cannot invent what the party is trying to find
 * out or why it matters, so those are collected here and stored verbatim.
 */
export class GenerateVictoryDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor({ onGenerated, ...options } = {}) {
    super(options);
    this.#onGenerated = onGenerated;
  }

  #onGenerated;
  #busy = false;
  #abortController = null;

  static DEFAULT_OPTIONS = {
    id: 'pfai-generate-victory',
    tag: 'form',
    classes: ['pfai', 'pfai-generate'],
    window: {
      title: 'PFAI.Victory.GenerateTitle',
      icon: 'fa-solid fa-trophy',
      resizable: true,
    },
    position: { width: 640, height: 'auto' },
    form: { handler: GenerateVictoryDialog.#onSubmit, closeOnSubmit: false },
    actions: { cancel: GenerateVictoryDialog.#onCancel, saveBrief: makeSaveBrief('victory') },
  };

  static PARTS = {
    form: { template: `modules/${MODULE_ID}/templates/generate-victory-dialog.hbs` },
  };

  async _prepareContext() {
    const configuredLanguage = game.settings.get(MODULE_ID, SETTINGS.outputLanguage)?.trim();
    return {
      busy: this.#busy,
      hasApiKey: hasApiKey(),
      model: activeModel(),
      baseDC: suggestedBaseDC() ?? DEFAULT_BASE_DC,
      level: guessPartyLevel(),
      partySize: guessPartySize(),
      language: configuredLanguage || game.i18n.lang,
      structures: Object.entries(VICTORY_STRUCTURES).map(([value, label]) => ({
        value,
        label: game.i18n.localize(label),
        selected: value === 'accumulating',
      })),
      scales: Object.entries(VICTORY_SCALES).map(([value, entry]) => ({
        value,
        label: game.i18n.localize(entry.label),
        goal: entry.goal,
        selected: value === 'session',
      })),
    };
  }

  static async #onSubmit(_event, _form, formData) {
    if (this.#busy) return;
    const data = formData.object;

    const premise = String(data.premise ?? '').trim();
    const objective = String(data.objective ?? '').trim();

    const missing = [];
    if (!premise) missing.push(game.i18n.localize('PFAI.Victory.Situation'));
    if (!objective) missing.push(game.i18n.localize('PFAI.Victory.Objective'));
    if (missing.length) {
      ui.notifications.warn(
        game.i18n.format('PFAI.Influence.MissingFields', { fields: missing.join(', ') }),
      );
      return;
    }
    if (!hasApiKey()) {
      ui.notifications.error(game.i18n.localize('PFAI.Errors.NoApiKey'));
      return;
    }

    this.#busy = true;
    this.#abortController = new AbortController();
    await this.render();

    try {
      const generated = await generateVictory(
        {
          premise,
          objective,
          goal: String(data.goal ?? '').trim(),
          failure: String(data.failure ?? '').trim(),
          structure: data.structure === 'diminishing' ? 'diminishing' : 'accumulating',
          scale: String(data.scale ?? 'session'),
          title: String(data.title ?? '').trim(),
          baseDC: Math.clamp(Number(data.baseDC) || DEFAULT_BASE_DC, 1, 60),
          level: Math.clamp(Number(data.level) || 1, 0, 25),
          partySize: Math.clamp(Number(data.partySize) || 4, 1, 10),
          roundLimit: Math.max(0, Number(data.roundLimit) || 0),
          tone: String(data.tone ?? '').trim(),
          language: String(data.language ?? '').trim(),
          model: activeModel(),
        },
        { signal: this.#abortController.signal },
      );

      const victories = getVictories();
      const stored = withListPosition(generated, victories.events);
      victories.events[stored.id] = stored;
      await setVictories(victories);

      ui.notifications.info(game.i18n.format('PFAI.Victory.Success', { name: stored.name }));
      this.#onGenerated?.(stored.id);
      await this.close();
    } catch (error) {
      if (error.name === 'AbortError') {
        ui.notifications.info(game.i18n.localize('PFAI.Generate.Cancelled'));
      } else {
        console.error(`${MODULE_ID} | victory points generation failed`, error);
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
