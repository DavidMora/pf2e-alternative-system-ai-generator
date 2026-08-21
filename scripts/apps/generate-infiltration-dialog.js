import { DEFAULT_BASE_DC, MODULE_ID, SETTINGS } from '../constants.js';
import { generateInfiltration, withListPosition } from '../ai/infiltration.js';
import { activeModel, hasApiKey } from '../ai/openai.js';
import { makeSaveBrief } from '../exchange.js';
import {
  getInfiltrations,
  guessPartyLevel,
  guessPartySize,
  setInfiltrations,
  suggestedBaseDC,
} from '../helpers.js';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Builds an Infiltration from the target and situation the GM supplies.
 *
 * Same contract as the others: the model cannot invent the place being broken
 * into or why, so those are collected here and stored verbatim.
 */
export class GenerateInfiltrationDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor({ onGenerated, ...options } = {}) {
    super(options);
    this.#onGenerated = onGenerated;
  }

  #onGenerated;
  #busy = false;
  #abortController = null;

  static DEFAULT_OPTIONS = {
    id: 'pfai-generate-infiltration',
    tag: 'form',
    classes: ['pfai', 'pfai-generate'],
    window: {
      title: 'PFAI.Infiltration.GenerateTitle',
      icon: 'fa-solid fa-user-secret',
      resizable: true,
    },
    position: { width: 640, height: 'auto' },
    form: { handler: GenerateInfiltrationDialog.#onSubmit, closeOnSubmit: false },
    actions: { cancel: GenerateInfiltrationDialog.#onCancel, saveBrief: makeSaveBrief('infiltration') },
  };

  static PARTS = {
    form: { template: `modules/${MODULE_ID}/templates/generate-infiltration-dialog.hbs` },
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
    const target = String(data.target ?? '').trim();

    const missing = [];
    if (!premise) missing.push(game.i18n.localize('PFAI.Infiltration.Situation'));
    if (!target) missing.push(game.i18n.localize('PFAI.Infiltration.Target'));
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
      const generated = await generateInfiltration(
        {
          premise,
          target,
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

      const infiltrations = getInfiltrations();
      const stored = withListPosition(generated, infiltrations.events);
      infiltrations.events[stored.id] = stored;
      await setInfiltrations(infiltrations);

      ui.notifications.info(game.i18n.format('PFAI.Infiltration.Success', { name: stored.name }));
      this.#onGenerated?.(stored.id);
      await this.close();
    } catch (error) {
      if (error.name === 'AbortError') {
        ui.notifications.info(game.i18n.localize('PFAI.Generate.Cancelled'));
      } else {
        console.error(`${MODULE_ID} | infiltration generation failed`, error);
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
