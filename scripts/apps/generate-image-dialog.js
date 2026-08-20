import { IMAGE_QUALITIES, IMAGE_SIZES, MODULE_ID, SETTINGS } from '../constants.js';
import { activeImageModel, fetchReference, generateImage, saveImage } from '../ai/image.js';
import { hasApiKey } from '../ai/openai.js';
import { getChase, htmlToPromptText, updateChase } from '../helpers.js';

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

/**
 * Requests artwork for a chase or one of its obstacles.
 *
 * References are conditioning images: actor portraits and tokens so generated
 * art matches the party, plus any file or URL the GM wants to steer with.
 */
export class GenerateImageDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  /**
   * @param {object} options
   * @param {string} options.chaseId
   * @param {string} [options.obstacleId] target the obstacle instead of the chase.
   * @param {() => void} [options.onGenerated]
   */
  constructor({ chaseId, obstacleId, onGenerated, ...options } = {}) {
    super(options);
    this.#chaseId = chaseId;
    this.#obstacleId = obstacleId ?? null;
    this.#onGenerated = onGenerated;
  }

  #chaseId;
  #obstacleId;
  #onGenerated;
  /** @type {{src: string, label: string}[]} */
  #references = [];
  #busy = false;
  #abortController = null;

  static DEFAULT_OPTIONS = {
    id: 'pfai-generate-image',
    tag: 'form',
    classes: ['pfai', 'pfai-generate'],
    window: {
      title: 'PFAI.Image.Title',
      icon: 'fa-solid fa-image',
      resizable: true,
    },
    position: { width: 620, height: 'auto' },
    form: { handler: GenerateImageDialog.#onSubmit, closeOnSubmit: false },
    actions: {
      cancel: GenerateImageDialog.#onCancel,
      addSelectedTokens: GenerateImageDialog.#onAddSelectedTokens,
      addActor: GenerateImageDialog.#onAddActor,
      addFile: GenerateImageDialog.#onAddFile,
      addUrl: GenerateImageDialog.#onAddUrl,
      removeReference: GenerateImageDialog.#onRemoveReference,
      useOwnImage: GenerateImageDialog.#onUseOwnImage,
    },
  };

  static PARTS = {
    form: { template: `modules/${MODULE_ID}/templates/generate-image-dialog.hbs` },
  };

  get #target() {
    const chase = getChase(this.#chaseId);
    if (!chase) return null;
    if (!this.#obstacleId) return { kind: 'chase', name: chase.name, img: chase.img, chase };
    const obstacle = chase.obstacles[this.#obstacleId];
    return obstacle
      ? { kind: 'obstacle', name: obstacle.name, img: obstacle.img, chase, obstacle }
      : null;
  }

  async _prepareContext() {
    const target = this.#target;
    return {
      busy: this.#busy,
      hasApiKey: hasApiKey(),
      model: activeImageModel(),
      targetKind: target?.kind,
      targetName: target?.name ?? '',
      currentImage: target?.img ?? '',
      promptPreview: target ? this.#buildPrompt(target, '', this.#references.length > 0) : '',
      references: this.#references,
      referenceCount: this.#references.length,
      sizes: Object.entries(IMAGE_SIZES).map(([value, label]) => ({
        value,
        label: game.i18n.localize(label),
        selected: value === game.settings.get(MODULE_ID, SETTINGS.imageSize),
      })),
      qualities: Object.entries(IMAGE_QUALITIES).map(([value, label]) => ({
        value,
        label: game.i18n.localize(label),
        selected: value === game.settings.get(MODULE_ID, SETTINGS.imageQuality),
      })),
    };
  }

  #addReference(src, label) {
    if (!src) return;
    if (this.#references.some((ref) => ref.src === src)) return;
    this.#references.push({ src, label: label || src.split('/').pop() });
    this.render();
  }

  static #onAddSelectedTokens() {
    const tokens = canvas.tokens?.controlled ?? [];
    if (!tokens.length) {
      ui.notifications.warn(game.i18n.localize('PFAI.Image.NoTokensSelected'));
      return;
    }
    for (const token of tokens) {
      this.#addReference(token.document.texture.src, token.name);
    }
  }

  static async #onAddActor() {
    const actors = game.actors.filter((actor) => actor.img || actor.prototypeToken?.texture?.src);
    if (!actors.length) {
      ui.notifications.warn(game.i18n.localize('PFAI.Image.NoActors'));
      return;
    }

    const options = actors
      .map((actor) => `<option value="${actor.id}">${foundry.utils.escapeHTML?.(actor.name) ?? actor.name}</option>`)
      .join('');

    const result = await DialogV2.prompt({
      window: { title: game.i18n.localize('PFAI.Image.PickActor') },
      position: { width: 420 },
      content: `<div class="pfai-form">
        <label class="pfai-field"><span>${game.i18n.localize('PFAI.Image.Actor')}</span>
          <select name="actorId">${options}</select></label>
        <label class="pfai-field"><span>${game.i18n.localize('PFAI.Image.WhichArt')}</span>
          <select name="kind">
            <option value="portrait">${game.i18n.localize('PFAI.Image.Portrait')}</option>
            <option value="token">${game.i18n.localize('PFAI.Image.Token')}</option>
          </select></label>
      </div>`,
      ok: {
        label: game.i18n.localize('PFAI.Image.AddReference'),
        callback: (_event, button) => new foundry.applications.ux.FormDataExtended(button.form).object,
      },
    });
    if (!result) return;

    const actor = game.actors.get(result.actorId);
    if (!actor) return;
    const src = result.kind === 'token' ? actor.prototypeToken?.texture?.src : actor.img;
    if (!src) {
      ui.notifications.warn(game.i18n.localize('PFAI.Image.NoArtOnActor'));
      return;
    }
    this.#addReference(src, `${actor.name} (${result.kind})`);
  }

  static async #onAddFile() {
    const picker = new foundry.applications.apps.FilePicker.implementation({
      type: 'image',
      callback: (path) => this.#addReference(path),
    });
    picker.render(true);
  }

  static async #onAddUrl() {
    const result = await DialogV2.prompt({
      window: { title: game.i18n.localize('PFAI.Image.AddUrl') },
      position: { width: 520 },
      content: `<div class="pfai-form"><label class="pfai-field">
        <span>${game.i18n.localize('PFAI.Image.Url')}</span>
        <input type="url" name="url" placeholder="https://example.com/reference.png" autofocus>
        <small>${game.i18n.localize('PFAI.Image.UrlHint')}</small>
      </label></div>`,
      ok: {
        label: game.i18n.localize('PFAI.Image.AddReference'),
        callback: (_event, button) => new foundry.applications.ux.FormDataExtended(button.form).object,
      },
    });
    const url = String(result?.url ?? '').trim();
    if (url) this.#addReference(url, url.split('/').pop());
  }

  static #onRemoveReference(_event, target) {
    this.#references.splice(Number(target.dataset.index), 1);
    this.render();
  }

  /**
   * Attach an existing image instead of generating one, for GMs who prepared
   * artwork before the session. FilePicker also handles uploading a new file.
   */
  static async #onUseOwnImage() {
    const target = this.#target;
    if (!target) return;

    const picker = new foundry.applications.apps.FilePicker.implementation({
      type: 'image',
      current: target.img || undefined,
      callback: async (path) => {
        await updateChase(this.#chaseId, (chase) => {
          if (this.#obstacleId) {
            const obstacle = chase.obstacles[this.#obstacleId];
            if (obstacle) obstacle.img = path;
          } else {
            chase.img = path;
          }
        });
        ui.notifications.info(game.i18n.format('PFAI.Image.Attached', { path }));
        this.#onGenerated?.();
        this.close();
      },
    });
    picker.render(true);
  }

  static async #onSubmit(_event, _form, formData) {
    if (this.#busy) return;
    const data = formData.object;
    const target = this.#target;
    if (!target) return;

    const context = String(data.context ?? '').trim();
    if (!hasApiKey()) {
      ui.notifications.error(game.i18n.localize('PFAI.Errors.NoApiKey'));
      return;
    }

    this.#busy = true;
    this.#abortController = new AbortController();
    await this.render();

    try {
      // Load references first so a broken one fails before we spend on generation.
      const files = [];
      const failed = [];
      for (const ref of this.#references) {
        try {
          files.push(await fetchReference(ref.src));
        } catch (error) {
          failed.push(`${ref.label}: ${error.message}`);
        }
      }
      if (failed.length) {
        ui.notifications.warn(
          game.i18n.format('PFAI.Image.ReferencesFailed', { list: failed.join(', ') }),
          { permanent: true },
        );
      }

      const { b64, mimeType } = await generateImage({
        prompt: this.#buildPrompt(target, context, files.length > 0),
        references: files,
        size: data.size,
        quality: data.quality,
        signal: this.#abortController.signal,
      });

      const path = await saveImage(b64, mimeType, `${target.chase.name}-${target.name}`);

      await updateChase(this.#chaseId, (chase) => {
        if (this.#obstacleId) {
          const obstacle = chase.obstacles[this.#obstacleId];
          if (obstacle) obstacle.img = path;
        } else {
          chase.img = path;
        }
      });

      ui.notifications.info(game.i18n.format('PFAI.Image.Success', { path }));
      this.#onGenerated?.();
      await this.close();
    } catch (error) {
      if (error.name === 'AbortError') {
        ui.notifications.info(game.i18n.localize('PFAI.Generate.Cancelled'));
      } else {
        console.error(`${MODULE_ID} | image generation failed`, error);
        ui.notifications.error(error.message, { permanent: true });
      }
      this.#busy = false;
      this.#abortController = null;
      await this.render();
    }
  }

  /**
   * Compose the image prompt.
   *
   * The chase premise and the full obstacle text carry the scene, so art
   * direction is optional — a GM can generate straight from the fiction.
   */
  #buildPrompt(target, context, hasReferences) {
    const parts = [];
    if (target.kind === 'obstacle') {
      parts.push(`Fantasy RPG illustration of a chase obstacle titled "${target.name}".`);
    } else {
      parts.push(`Fantasy RPG key art for a chase scene titled "${target.name}".`);
    }

    const premise = htmlToPromptText(target.chase.premise);
    if (premise) parts.push(`Scene context: ${premise}`);

    if (target.kind === 'obstacle') {
      // The whole obstacle, with PF2e inline syntax unwrapped so the model sees
      // prose rather than "@Check[type:athletics|dc:20]".
      const detail = htmlToPromptText(target.obstacle.overcome);
      if (detail) parts.push(`What happens at this obstacle:\n${detail}`);
    }

    if (context) parts.push(`Art direction: ${context}`);
    if (hasReferences) {
      parts.push(
        'Use the supplied reference images for the appearance of the characters and setting. Match their designs; do not copy their composition.',
      );
    }
    parts.push('No text, no watermarks, no UI elements, no borders.');
    return parts.join('\n');
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
