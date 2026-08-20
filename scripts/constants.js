export const MODULE_ID = 'pf2e-alternative-system-ai-generator';

/** World/client setting keys. */
export const SETTINGS = {
  chases: 'chases',
  influences: 'influences',
  apiKey: 'openaiApiKey',
  model: 'openaiModel',
  modelOverride: 'openaiModelOverride',
  baseUrl: 'openaiBaseUrl',
  temperature: 'openaiTemperature',
  outputLanguage: 'outputLanguage',
  imageModel: 'openaiImageModel',
  imageSize: 'openaiImageSize',
  imageQuality: 'openaiImageQuality',
};

/**
 * Models offered in the settings dropdown. The override setting lets a GM type
 * any model id, so this list only needs to cover the common picks.
 */
export const OPENAI_MODELS = {
  'gpt-5.6-sol': 'PFAI.Models.Sol',
  'gpt-5.6-terra': 'PFAI.Models.Terra',
  'gpt-5.6-luna': 'PFAI.Models.Luna',
};

export const DEFAULT_MODEL = 'gpt-5.6-terra';
export const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

export const DEFAULT_IMAGE_MODEL = 'gpt-image-2';

/**
 * gpt-image-2 accepts any size whose edges are multiples of 16 within its pixel
 * budget; these are the useful presets for a chase window.
 */
export const IMAGE_SIZES = {
  '1024x1024': 'PFAI.Image.SizeSquare',
  '1536x1024': 'PFAI.Image.SizeLandscape',
  '1024x1536': 'PFAI.Image.SizePortrait',
};

export const IMAGE_QUALITIES = {
  auto: 'PFAI.Image.QualityAuto',
  low: 'PFAI.Image.QualityLow',
  medium: 'PFAI.Image.QualityMedium',
  high: 'PFAI.Image.QualityHigh',
};

/** PF2e Level-based DCs (GM Core). Index is creature/hazard/task level. */
export const LEVEL_DCS = [
  14, 15, 16, 18, 19, 20, 22, 23, 24, 26, 27, 28, 30, 31, 32, 34, 35, 36, 38,
  39, 40, 42, 44, 46, 48, 50,
];

/** DC adjustments (GM Core). Keys double as the AI schema enum. */
export const DC_ADJUSTMENTS = {
  'incredibly-easy': -10,
  'very-easy': -5,
  easy: -2,
  standard: 0,
  hard: 2,
  'very-hard': 5,
  'incredibly-hard': 10,
};

/** Skills the generator is allowed to call for. Doubles as the AI schema enum. */
export const PF2E_SKILLS = [
  'acrobatics',
  'arcana',
  'athletics',
  'crafting',
  'deception',
  'diplomacy',
  'intimidation',
  'medicine',
  'nature',
  'occultism',
  'performance',
  'religion',
  'society',
  'stealth',
  'survival',
  'thievery',
  'perception',
  'lore',
];

/** Fallback base DC when there is no party to infer one from. */
export const DEFAULT_BASE_DC = 15;

/** Difficulty presets offered in the generate dialog. */
export const GENERATION_DIFFICULTY = {
  auto: 'PFAI.Difficulty.Auto',
  low: 'PFAI.Difficulty.Low',
  moderate: 'PFAI.Difficulty.Moderate',
  high: 'PFAI.Difficulty.High',
};
