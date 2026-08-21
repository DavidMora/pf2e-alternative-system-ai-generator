import { DEFAULT_BASE_DC, MODULE_ID, SETTINGS } from '../constants.js';
import { generateInfluence, withListPosition } from '../ai/influence.js';
import { activeModel, hasApiKey } from '../ai/openai.js';
import { makeSaveBrief } from '../exchange.js';
import {
  getInfluences,
  guessPartyLevel,
  guessPartySize,
  setInfluences,
  suggestedBaseDC,
} from '../helpers.js';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Builds an Influence encounter from what the GM knows about the people in it.
 *
 * The model cannot invent a person worth persuading, so the situation, the NPC
 * and the party's goal are all collected here and stored verbatim; the model
 * only works out how to reach them.
 */
export class GenerateInfluenceDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor({ onGenerated, ...options } = {}) {
    super(options);
    this.#onGenerated = onGenerated;
  }

  #onGenerated;
  #busy = false;
  #abortController = null;

  static DEFAULT_OPTIONS = {
    id: 'pfai-generate-influence',
    tag: 'form',
    classes: ['pfai', 'pfai-generate'],
    window: {
      title: 'PFAI.Influence.GenerateTitle',
      icon: 'fa-solid fa-comments',
      resizable: true,
    },
    position: { width: 640, height: 'auto' },
    form: { handler: GenerateInfluenceDialog.#onSubmit, closeOnSubmit: false },
    actions: {
      cancel: GenerateInfluenceDialog.#onCancel,
      saveBrief: makeSaveBrief('influence'),
      useSelectedToken: GenerateInfluenceDialog.#onUseSelectedToken,
    },
  };

  static PARTS = {
    form: { template: `modules/${MODULE_ID}/templates/generate-influence-dialog.hbs` },
  };

  /** Prefilled from a selected token, so an existing NPC needs no retyping. */
  #prefill = null;

  async _prepareContext() {
    const configuredLanguage = game.settings.get(MODULE_ID, SETTINGS.outputLanguage)?.trim();
    return {
      busy: this.#busy,
      hasApiKey: hasApiKey(),
      model: activeModel(),
      baseDC: suggestedBaseDC() ?? DEFAULT_BASE_DC,
      level: guessPartyLevel(),
      partySize: guessPartySize(),
      npcName: this.#prefill?.name ?? '',
      npcDescription: this.#prefill?.description ?? '',
      language: configuredLanguage || game.i18n.lang,
    };
  }

  /** Pull the selected token's name and biography in as a starting point. */
  static async #onUseSelectedToken() {
    const token = canvas.tokens?.controlled?.[0];
    const actor = token?.actor;
    if (!actor) {
      ui.notifications.warn(game.i18n.localize('PFAI.Influence.NoTokenSelected'));
      return;
    }
    const bio =
      actor.system?.details?.publicNotes ??
      actor.system?.details?.biography?.public ??
      actor.system?.details?.biography?.value ??
      '';
    const div = document.createElement('div');
    div.innerHTML = String(bio);
    this.#prefill = { name: actor.name, description: (div.textContent ?? '').trim() };
    this.#npcUuid = actor.uuid;
    ui.notifications.info(game.i18n.format('PFAI.Influence.PrefilledFrom', { name: actor.name }));
    await this.render();
  }

  #npcUuid = '';

  static async #onSubmit(_event, _form, formData) {
    if (this.#busy) return;
    const data = formData.object;

    const premise = String(data.premise ?? '').trim();
    const npcName = String(data.npcName ?? '').trim();
    const npcDescription = String(data.npcDescription ?? '').trim();
    const goal = String(data.goal ?? '').trim();

    // These three are what the model genuinely cannot invent for you.
    const missing = [];
    if (!premise) missing.push(game.i18n.localize('PFAI.Influence.Situation'));
    if (!npcName) missing.push(game.i18n.localize('PFAI.Influence.NpcName'));
    if (!goal) missing.push(game.i18n.localize('PFAI.Influence.Goal'));
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
      const generated = await generateInfluence(
        {
          premise,
          npcName,
          npcDescription,
          npcUuid: this.#npcUuid,
          goal,
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

      const influences = getInfluences();
      const stored = withListPosition(generated, influences.events);
      influences.events[stored.id] = stored;
      await setInfluences(influences);

      ui.notifications.info(game.i18n.format('PFAI.Influence.Success', { name: stored.name }));
      this.#onGenerated?.(stored.id);
      await this.close();
    } catch (error) {
      if (error.name === 'AbortError') {
        ui.notifications.info(game.i18n.localize('PFAI.Generate.Cancelled'));
      } else {
        console.error(`${MODULE_ID} | influence generation failed`, error);
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
