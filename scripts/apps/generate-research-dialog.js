import { DEFAULT_BASE_DC, MODULE_ID, SETTINGS } from '../constants.js';
import { generateResearch, withListPosition } from '../ai/research.js';
import { activeModel, hasApiKey } from '../ai/openai.js';
import {
  getResearches,
  guessPartyLevel,
  guessPartySize,
  setResearches,
  suggestedBaseDC,
} from '../helpers.js';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Builds a Research encounter from the topic and situation the GM supplies.
 *
 * As with influence, the model cannot invent what the party is trying to find
 * out or why it matters, so those are collected here and stored verbatim.
 */
export class GenerateResearchDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor({ onGenerated, ...options } = {}) {
    super(options);
    this.#onGenerated = onGenerated;
  }

  #onGenerated;
  #busy = false;
  #abortController = null;

  static DEFAULT_OPTIONS = {
    id: 'pfai-generate-research',
    tag: 'form',
    classes: ['pfai', 'pfai-generate'],
    window: {
      title: 'PFAI.Research.GenerateTitle',
      icon: 'fa-solid fa-book-open-reader',
      resizable: true,
    },
    position: { width: 640, height: 'auto' },
    form: { handler: GenerateResearchDialog.#onSubmit, closeOnSubmit: false },
    actions: { cancel: GenerateResearchDialog.#onCancel },
  };

  static PARTS = {
    form: { template: `modules/${MODULE_ID}/templates/generate-research-dialog.hbs` },
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
    };
  }

  static async #onSubmit(_event, _form, formData) {
    if (this.#busy) return;
    const data = formData.object;

    const premise = String(data.premise ?? '').trim();
    const topic = String(data.topic ?? '').trim();

    const missing = [];
    if (!premise) missing.push(game.i18n.localize('PFAI.Research.Situation'));
    if (!topic) missing.push(game.i18n.localize('PFAI.Research.Topic'));
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
      const generated = await generateResearch(
        {
          premise,
          topic,
          goal: String(data.goal ?? '').trim(),
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

      const researches = getResearches();
      const stored = withListPosition(generated, researches.events);
      researches.events[stored.id] = stored;
      await setResearches(researches);

      ui.notifications.info(game.i18n.format('PFAI.Research.Success', { name: stored.name }));
      this.#onGenerated?.(stored.id);
      await this.close();
    } catch (error) {
      if (error.name === 'AbortError') {
        ui.notifications.info(game.i18n.localize('PFAI.Generate.Cancelled'));
      } else {
        console.error(`${MODULE_ID} | research generation failed`, error);
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
