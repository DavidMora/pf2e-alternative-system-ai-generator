import { DEFAULT_BASE_DC, MODULE_ID, SETTINGS } from '../constants.js';
import { generateLeadership, withListPosition } from '../ai/leadership.js';
import { activeModel, hasApiKey } from '../ai/openai.js';
import { makeSaveBrief } from '../exchange.js';
import {
  getLeaderships,
  guessPartyLevel,
  guessPartySize,
  setLeaderships,
  suggestedBaseDC,
} from '../helpers.js';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Builds an organisation from what the GM supplies about it.
 *
 * The organisation itself is the one thing the model cannot invent, so it is
 * required and stored verbatim; the model fills in the people and the events.
 */
export class GenerateLeadershipDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor({ onGenerated, ...options } = {}) {
    super(options);
    this.#onGenerated = onGenerated;
  }

  #onGenerated;
  #busy = false;
  #abortController = null;

  static DEFAULT_OPTIONS = {
    id: 'pfai-generate-leadership',
    tag: 'form',
    classes: ['pfai', 'pfai-generate'],
    window: {
      title: 'PFAI.Leadership.GenerateTitle',
      icon: 'fa-solid fa-flag',
      resizable: true,
    },
    position: { width: 640, height: 'auto' },
    form: { handler: GenerateLeadershipDialog.#onSubmit, closeOnSubmit: false },
    actions: { cancel: GenerateLeadershipDialog.#onCancel, saveBrief: makeSaveBrief('leadership') },
  };

  static PARTS = {
    form: { template: `modules/${MODULE_ID}/templates/generate-leadership-dialog.hbs` },
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
      // An organisation usually starts small unless the GM says otherwise.
      organizationLevel: 1,
      language: configuredLanguage || game.i18n.lang,
    };
  }

  static async #onSubmit(_event, _form, formData) {
    if (this.#busy) return;
    const data = formData.object;

    const organization = String(data.organization ?? '').trim();

    const missing = [];
    if (!organization) missing.push(game.i18n.localize('PFAI.Leadership.Organization'));
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
      const generated = await generateLeadership(
        {
          organization,
          premise: String(data.premise ?? '').trim(),
          goal: String(data.goal ?? '').trim(),
          organizationLevel: Math.clamp(Number(data.organizationLevel) || 1, 1, 20),
          title: String(data.title ?? '').trim(),
          baseDC: Math.clamp(Number(data.baseDC) || DEFAULT_BASE_DC, 1, 60),
          level: Math.clamp(Number(data.level) || 1, 0, 25),
          partySize: Math.clamp(Number(data.partySize) || 4, 1, 10),
          tone: String(data.tone ?? '').trim(),
          language: String(data.language ?? '').trim(),
          model: activeModel(),
        },
        { signal: this.#abortController.signal },
      );

      const leaderships = getLeaderships();
      const stored = withListPosition(generated, leaderships.events);
      leaderships.events[stored.id] = stored;
      await setLeaderships(leaderships);

      ui.notifications.info(game.i18n.format('PFAI.Leadership.Success', { name: stored.name }));
      this.#onGenerated?.(stored.id);
      await this.close();
    } catch (error) {
      if (error.name === 'AbortError') {
        ui.notifications.info(game.i18n.localize('PFAI.Generate.Cancelled'));
      } else {
        console.error(`${MODULE_ID} | leadership generation failed`, error);
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
