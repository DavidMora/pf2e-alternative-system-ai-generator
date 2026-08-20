import {
  DEFAULT_BASE_URL,
  DEFAULT_IMAGE_MODEL,
  DEFAULT_MODEL,
  IMAGE_QUALITIES,
  IMAGE_SIZES,
  MODULE_ID,
  OPENAI_MODELS,
  SETTINGS,
} from './constants.js';
import { Chases } from './data/chase.js';
import { Influences } from './data/influence.js';
import { Researches } from './data/research.js';
import { SubsystemView } from './apps/subsystem-view.js';

/** Re-render any open subsystem window when world data changes. */
function refreshOpenViews() {
  for (const app of foundry.applications.instances.values()) {
    if (app instanceof SubsystemView) app.render();
  }
}

export function registerSettings() {
  game.settings.register(MODULE_ID, SETTINGS.chases, {
    scope: 'world',
    config: false,
    type: Chases,
    default: { events: {} },
    onChange: refreshOpenViews,
  });

  // World scope keeps the key available to every GM on the world without
  // re-entry. It lives in the world database, so treat it as GM-visible.
  game.settings.register(MODULE_ID, SETTINGS.influences, {
    scope: 'world',
    config: false,
    type: Influences,
    default: { events: {} },
    onChange: refreshOpenViews,
  });

  game.settings.register(MODULE_ID, SETTINGS.researches, {
    scope: 'world',
    config: false,
    type: Researches,
    default: { events: {} },
    onChange: refreshOpenViews,
  });

  game.settings.register(MODULE_ID, SETTINGS.apiKey, {
    name: 'PFAI.Settings.ApiKey.Name',
    hint: 'PFAI.Settings.ApiKey.Hint',
    scope: 'world',
    config: true,
    restricted: true,
    type: String,
    default: '',
  });

  game.settings.register(MODULE_ID, SETTINGS.model, {
    name: 'PFAI.Settings.Model.Name',
    hint: 'PFAI.Settings.Model.Hint',
    scope: 'world',
    config: true,
    restricted: true,
    type: String,
    default: DEFAULT_MODEL,
    choices: OPENAI_MODELS,
  });

  game.settings.register(MODULE_ID, SETTINGS.modelOverride, {
    name: 'PFAI.Settings.ModelOverride.Name',
    hint: 'PFAI.Settings.ModelOverride.Hint',
    scope: 'world',
    config: true,
    restricted: true,
    type: String,
    default: '',
  });

  game.settings.register(MODULE_ID, SETTINGS.baseUrl, {
    name: 'PFAI.Settings.BaseUrl.Name',
    hint: 'PFAI.Settings.BaseUrl.Hint',
    scope: 'world',
    config: true,
    restricted: true,
    type: String,
    default: DEFAULT_BASE_URL,
  });

  // Deliberately a String, not a NumberField. Foundry's settings form submits an
  // empty number input as NaN, which no nullable NumberField can validate, so a
  // GM who never touched this field could not save the settings sheet at all.
  // Blank means "omit temperature"; parsing happens at request time.
  game.settings.register(MODULE_ID, SETTINGS.temperature, {
    name: 'PFAI.Settings.Temperature.Name',
    hint: 'PFAI.Settings.Temperature.Hint',
    scope: 'world',
    config: true,
    restricted: true,
    type: String,
    default: '',
  });

  game.settings.register(MODULE_ID, SETTINGS.imageModel, {
    name: 'PFAI.Settings.ImageModel.Name',
    hint: 'PFAI.Settings.ImageModel.Hint',
    scope: 'world',
    config: true,
    restricted: true,
    type: String,
    default: DEFAULT_IMAGE_MODEL,
  });

  game.settings.register(MODULE_ID, SETTINGS.imageSize, {
    name: 'PFAI.Settings.ImageSize.Name',
    hint: 'PFAI.Settings.ImageSize.Hint',
    scope: 'world',
    config: true,
    restricted: true,
    type: String,
    default: '1536x1024',
    choices: IMAGE_SIZES,
  });

  game.settings.register(MODULE_ID, SETTINGS.imageQuality, {
    name: 'PFAI.Settings.ImageQuality.Name',
    hint: 'PFAI.Settings.ImageQuality.Hint',
    scope: 'world',
    config: true,
    restricted: true,
    type: String,
    default: 'auto',
    choices: IMAGE_QUALITIES,
  });

  game.settings.register(MODULE_ID, SETTINGS.outputLanguage, {
    name: 'PFAI.Settings.OutputLanguage.Name',
    hint: 'PFAI.Settings.OutputLanguage.Hint',
    scope: 'world',
    config: true,
    restricted: true,
    type: String,
    default: '',
  });
}
