export const MODULE_ID = 'matadragones-subsystems-implementation-for-pf2e';

/** World/client setting keys. */
export const SETTINGS = {
  chases: 'chases',
  influences: 'influences',
  researches: 'researches',
  infiltrations: 'infiltrations',
  leaderships: 'leaderships',
  victories: 'victories',
  apiKey: 'openaiApiKey',
  model: 'openaiModel',
  modelOverride: 'openaiModelOverride',
  baseUrl: 'openaiBaseUrl',
  temperature: 'openaiTemperature',
  outputLanguage: 'outputLanguage',
  imageModel: 'openaiImageModel',
  imageSize: 'openaiImageSize',
  imageQuality: 'openaiImageQuality',
  requestTimeout: 'openaiRequestTimeout',
  spend: 'openaiSpend',
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

/**
 * Seconds before a generation is abandoned.
 *
 * The dialogs have always been cancellable, but only by a GM who noticed and
 * clicked; a hung request otherwise waits for ever behind a spinner. Generous,
 * because a large infiltration on a slow model is legitimately slow.
 */
export const DEFAULT_TIMEOUT_SECONDS = 120;

/**
 * One automatic retry, because a Structured Outputs answer that will not parse
 * has already been paid for and is usually transient. Anything worse than
 * transient fails the same way it did before.
 */
export const RETRY_ATTEMPTS = 1;

/**
 * Rough USD per million tokens, for telling a GM what a generation cost.
 *
 * Prices move and a GM may point the base URL somewhere else entirely, so this
 * is labelled an estimate everywhere it surfaces and a model that is not listed
 * reports tokens without a figure rather than inventing one.
 */
export const MODEL_PRICES = {
  'gpt-5.6-sol': { input: 1.25, output: 10 },
  'gpt-5.6-terra': { input: 0.25, output: 2 },
  'gpt-5.6-luna': { input: 0.05, output: 0.4 },
};
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

/**
 * Organization sizes by level (GM Core, Leadership). Index 0 is level 1.
 *
 * Reproduced rather than computed: the published progression is not a formula,
 * and a GM checking the book should find the same numbers.
 */
export const ORGANIZATION_TABLE = [
  { followers: '1-2', maxFollowerLevel: 0, lieutenants: '-', lieutenantLevels: '-' },
  { followers: '3-4', maxFollowerLevel: 0, lieutenants: '-', lieutenantLevels: '-' },
  { followers: '5-6', maxFollowerLevel: 0, lieutenants: '1', lieutenantLevels: '1' },
  { followers: '7-9', maxFollowerLevel: 0, lieutenants: '1', lieutenantLevels: '1' },
  { followers: '10-13', maxFollowerLevel: 0, lieutenants: '1', lieutenantLevels: '1' },
  { followers: '14-18', maxFollowerLevel: 1, lieutenants: '2', lieutenantLevels: '2' },
  { followers: '19-27', maxFollowerLevel: 1, lieutenants: '2', lieutenantLevels: '2' },
  { followers: '28-36', maxFollowerLevel: 1, lieutenants: '3', lieutenantLevels: '2-3' },
  { followers: '37-53', maxFollowerLevel: 1, lieutenants: '4-5', lieutenantLevels: '2-3' },
  { followers: '54-75', maxFollowerLevel: 2, lieutenants: '6-7', lieutenantLevels: '3-4' },
  { followers: '76-99', maxFollowerLevel: 2, lieutenants: '8-10', lieutenantLevels: '3-4' },
  { followers: '100-150', maxFollowerLevel: 2, lieutenants: '11-15', lieutenantLevels: '3-5' },
  { followers: '151-215', maxFollowerLevel: 2, lieutenants: '16-22', lieutenantLevels: '3-5' },
  { followers: '216-300', maxFollowerLevel: 3, lieutenants: '23-30', lieutenantLevels: '4-6' },
  { followers: '301-425', maxFollowerLevel: 3, lieutenants: '31-42', lieutenantLevels: '4-6' },
  { followers: '426-600', maxFollowerLevel: 3, lieutenants: '43-60', lieutenantLevels: '4-7' },
  { followers: '601-850', maxFollowerLevel: 3, lieutenants: '61-85', lieutenantLevels: '4-7' },
  { followers: '851-1,200', maxFollowerLevel: 4, lieutenants: '86-120', lieutenantLevels: '5-8' },
  { followers: '1,201-1,700', maxFollowerLevel: 4, lieutenants: '121-170', lieutenantLevels: '5-8' },
  { followers: '1,701-2,400', maxFollowerLevel: 4, lieutenants: '171-240', lieutenantLevels: '5-9' },
];

/** The three kinds of thing that happen to an organization in downtime. */
export const LEADERSHIP_EVENT_KINDS = {
  opportunity: 'PFAI.Leadership.KindOpportunity',
  trouble: 'PFAI.Leadership.KindTrouble',
  windfall: 'PFAI.Leadership.KindWindfall',
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

/**
 * Table 3-1, Setting Your Scale, reproduced from GM Core.
 *
 * The published endpoints are ranges; the value here is one the GM can move.
 * Thresholds are printed positions, not arithmetic, which is why they are
 * written down rather than derived - a GM checking the book should find the
 * same numbers.
 */
export const VICTORY_SCALES = {
  quick: { label: 'PFAI.Victory.ScaleQuick', goal: 5, thresholds: [] },
  long: { label: 'PFAI.Victory.ScaleLong', goal: 10, thresholds: [4] },
  session: { label: 'PFAI.Victory.ScaleSession', goal: 20, thresholds: [5, 10, 15] },
  sideline: { label: 'PFAI.Victory.ScaleSideline', goal: 18, thresholds: [5, 10, 15] },
  forefront: { label: 'PFAI.Victory.ScaleForefront', goal: 50, thresholds: [10, 20, 30, 40] },
};

/**
 * Two of the three published ways a Victory Point subsystem can run.
 *
 * Multiple Points, the third, is not here: the Infiltration tab already is one,
 * with its own vocabulary, and a second generic implementation would duplicate
 * it rather than add anything.
 *
 * Accumulating starts at zero and climbs to the endpoint. Diminishing starts
 * AT the endpoint and falls: the party is defending something, and running out
 * is the negative event rather than simply not winning.
 */
export const VICTORY_STRUCTURES = {
  accumulating: 'PFAI.Victory.StructureAccumulating',
  diminishing: 'PFAI.Victory.StructureDiminishing',
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
