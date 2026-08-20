import {
  DEFAULT_BASE_URL,
  DEFAULT_IMAGE_MODEL,
  MODULE_ID,
  SETTINGS,
} from '../constants.js';

export function activeImageModel() {
  return game.settings.get(MODULE_ID, SETTINGS.imageModel)?.trim() || DEFAULT_IMAGE_MODEL;
}

function apiKey() {
  const key = game.settings.get(MODULE_ID, SETTINGS.apiKey)?.trim();
  if (!key) throw new Error(game.i18n.localize('PFAI.Errors.NoApiKey'));
  return key;
}

function baseUrl() {
  return (game.settings.get(MODULE_ID, SETTINGS.baseUrl) || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

/**
 * Load a reference image into a File for upload.
 *
 * Foundry-local paths are same-origin and always work. Remote URLs depend on the
 * host sending permissive CORS headers, which many image hosts do not, so the
 * caller is expected to surface per-reference failures rather than aborting.
 */
const SUPPORTED_REFERENCE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export async function fetchReference(src) {
  const response = await fetch(src);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const blob = await response.blob();
  if (!blob.type.startsWith('image/')) {
    throw new Error(game.i18n.localize('PFAI.Errors.NotAnImage'));
  }

  const stem = ((src.split('/').pop() || 'reference').split('?')[0]).replace(/\.[^.]+$/, '');

  // The images endpoint only accepts png/jpeg/webp, but Foundry ships plenty of
  // SVG icons and systems use other formats, so rasterise anything else.
  if (!SUPPORTED_REFERENCE_TYPES.has(blob.type)) {
    const png = await rasterise(blob);
    return new File([png], `${stem}.png`, { type: 'image/png' });
  }

  const extension = blob.type === 'image/jpeg' ? 'jpg' : blob.type.split('/')[1];
  return new File([blob], `${stem}.${extension}`, { type: blob.type });
}

/** Draw an arbitrary browser-renderable image onto a canvas and export PNG. */
async function rasterise(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error(game.i18n.localize('PFAI.Errors.NotAnImage')));
      element.src = url;
    });

    // SVGs can report zero intrinsic size; fall back to a usable square.
    const width = image.naturalWidth || 512;
    const height = image.naturalHeight || 512;
    const canvasEl = document.createElement('canvas');
    canvasEl.width = width;
    canvasEl.height = height;
    canvasEl.getContext('2d').drawImage(image, 0, 0, width, height);

    const png = await new Promise((resolve, reject) => {
      canvasEl.toBlob((result) => (result ? resolve(result) : reject(new Error('toBlob failed'))), 'image/png');
    });
    return png;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Generate an image, optionally conditioned on reference images.
 *
 * With references this uses /images/edits, which takes multipart form data and a
 * repeated `image` field. Without them it uses /images/generations with JSON.
 * gpt-image models always return base64, so there is no response_format to set.
 *
 * @returns {Promise<{b64: string, mimeType: string, revisedPrompt: string}>}
 */
export async function generateImage({ prompt, references = [], size, quality, signal }) {
  const key = apiKey();
  const model = activeImageModel();
  const useEdits = references.length > 0;
  const url = `${baseUrl()}/images/${useEdits ? 'edits' : 'generations'}`;

  let body;
  const headers = { Authorization: `Bearer ${key}` };

  if (useEdits) {
    body = new FormData();
    body.append('model', model);
    body.append('prompt', prompt);
    if (size) body.append('size', size);
    if (quality && quality !== 'auto') body.append('quality', quality);
    // Repeated `image` fields are how the edits endpoint takes multiple refs.
    for (const file of references) body.append('image', file, file.name);
  } else {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify({
      model,
      prompt,
      n: 1,
      ...(size ? { size } : {}),
      ...(quality && quality !== 'auto' ? { quality } : {}),
    });
  }

  let response;
  try {
    response = await fetch(url, { method: 'POST', headers, body, signal });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new Error(game.i18n.format('PFAI.Errors.Network', { message: error.message }));
  }

  if (!response.ok) {
    let detail;
    try {
      const payload = await response.json();
      detail = payload?.error?.message ?? JSON.stringify(payload);
    } catch {
      detail = response.statusText;
    }
    throw new Error(
      game.i18n.format('PFAI.Errors.Api', { status: response.status, message: detail }),
    );
  }

  const data = await response.json();
  const first = data.data?.[0];
  if (!first?.b64_json) throw new Error(game.i18n.localize('PFAI.Errors.NoImageReturned'));

  return {
    b64: first.b64_json,
    mimeType: `image/${data.output_format ?? 'png'}`,
    revisedPrompt: first.revised_prompt ?? '',
  };
}

/** Where generated art is stored, kept per-world so exports stay self-contained. */
export function imageDirectory() {
  return `worlds/${game.world.id}/${MODULE_ID}`;
}

/**
 * Persist a generated image into the world's data directory and return its path.
 * Storing base64 in the world setting instead would bloat the database badly.
 */
export async function saveImage(b64, mimeType, filenameStem) {
  const picker = foundry.applications.apps.FilePicker.implementation;
  const dir = imageDirectory();

  try {
    await picker.createDirectory('data', dir);
  } catch (error) {
    // Already existing is the expected case; anything else is a real failure.
    if (!/EEXIST|already exists/i.test(error.message)) throw error;
  }

  const extension = (mimeType.split('/')[1] ?? 'png').replace('jpeg', 'jpg');
  const stem = (filenameStem || 'image').slugify({ strict: true }) || 'image';
  const name = `${stem}-${foundry.utils.randomID(8)}.${extension}`;

  const binary = Uint8Array.from(atob(b64), (char) => char.charCodeAt(0));
  const file = new File([binary], name, { type: mimeType });

  const result = await picker.upload('data', dir, file, {}, { notify: false });
  if (!result?.path) throw new Error(game.i18n.localize('PFAI.Errors.UploadFailed'));
  return result.path;
}
