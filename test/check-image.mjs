/*
 * Artwork: what gets requested, and where it lands.
 *
 * This file had no coverage at all, and it is the one that touches the world's
 * data directory and an endpoint with real constraints. Two of those constraints
 * were learned the hard way and are pinned here: the images endpoint rejects SVG
 * while Foundry ships SVG icons, so references are rasterised first; and an SVG
 * can report zero intrinsic size, which would otherwise produce a zero-by-zero
 * canvas and a blank reference.
 */
import { installGlobals, load, makeCheck, notes, reset } from './harness.mjs';

installGlobals();
const { check, done } = makeCheck();

let settings = {};
globalThis.game.settings.get = (_m, k) => settings[k];
globalThis.game.world = { id: 'pf-test' };

const image = await load('ai/image.js');
const { DEFAULT_IMAGE_MODEL, MODULE_ID } = await load('constants.js');

/* ------------------------------------------------------------- which model */

settings = {};
check('with nothing set, the default model is used', image.activeImageModel(), DEFAULT_IMAGE_MODEL);
settings = { openaiImageModel: '  my-image-model  ' };
check('a GM override wins, trimmed', image.activeImageModel(), 'my-image-model');
settings = { openaiImageModel: '   ' };
check('and whitespace is not an override', image.activeImageModel(), DEFAULT_IMAGE_MODEL);

/* ------------------------------------------------------------ where it goes */

check('images live under the world, not the module directory',
  image.imageDirectory(), `worlds/pf-test/${MODULE_ID}`);
globalThis.game.world = { id: 'another-world' };
check('and follow the world they belong to',
  image.imageDirectory(), `worlds/another-world/${MODULE_ID}`);
globalThis.game.world = { id: 'pf-test' };

/* ------------------------------------------------------- reference fetching */

/*
 * A reference is whatever the GM dragged in, which in Foundry is very often an
 * SVG icon. The endpoint will not take one.
 */
const blobOf = (type, size = 8) => ({
  type,
  size,
  // Enough of a Blob for the code under test; rasterise is stubbed below.
  arrayBuffer: async () => new ArrayBuffer(size),
});

globalThis.File = class {
  constructor(parts, name, options) {
    this.parts = parts; this.name = name; this.type = options?.type;
  }
};

const okResponse = (blob) => ({ ok: true, status: 200, blob: async () => blob });

globalThis.fetch = async () => okResponse(blobOf('image/png'));
let ref = await image.fetchReference('https://example.com/art/keep.png');
check('a png is taken as it is', [ref.name, ref.type], ['keep.png', 'image/png']);

globalThis.fetch = async () => okResponse(blobOf('image/jpeg'));
ref = await image.fetchReference('https://example.com/art/keep.jpeg');
check('a jpeg keeps the short extension the endpoint expects',
  [ref.name, ref.type], ['keep.jpg', 'image/jpeg']);

globalThis.fetch = async () => okResponse(blobOf('image/webp'));
ref = await image.fetchReference('https://example.com/art/keep.webp');
check('webp is accepted too', ref.name, 'keep.webp');

check('a query string does not end up in the filename',
  (await image.fetchReference('https://example.com/art/keep.webp?v=3')).name, 'keep.webp');

globalThis.fetch = async () => ({ ok: false, status: 404, blob: async () => blobOf('image/png') });
await (async () => {
  try {
    await image.fetchReference('https://example.com/missing.png');
    check('a missing reference throws', false, true);
  } catch (error) {
    check('a missing reference reports its status', error.message, 'HTTP 404');
  }
})();

globalThis.fetch = async () => okResponse(blobOf('text/html'));
await (async () => {
  try {
    await image.fetchReference('https://example.com/not-an-image');
    check('a non-image is refused', false, true);
  } catch (error) {
    check('a non-image is refused before it reaches the endpoint',
      error.message, 'PFAI.Errors.NotAnImage');
  }
})();

/* ------------------------------------------------------------- rasterising */

/*
 * The endpoint rejects SVG and Foundry ships SVG icons, so anything unsupported
 * is drawn to a canvas and exported as PNG. The stubs record what the canvas was
 * asked to be, because a zero-sized SVG silently producing a 0x0 image is the
 * failure this guards.
 */
let canvasSize = null;
globalThis.URL = { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} };
globalThis.Image = class {
  constructor() {
    // Resolve on the next tick, the way a real load does.
    setTimeout(() => this.onload?.(), 0);
  }
  set src(_v) { /* triggers the load above */ }
  naturalWidth = 0;
  naturalHeight = 0;
};
globalThis.document = {
  createElement: () => ({
    set width(w) { canvasSize = { ...(canvasSize ?? {}), width: w }; },
    set height(h) { canvasSize = { ...(canvasSize ?? {}), height: h }; },
    getContext: () => ({ drawImage: () => {} }),
    toBlob: (cb) => cb(blobOf('image/png', 64)),
  }),
};

globalThis.fetch = async () => okResponse(blobOf('image/svg+xml'));
canvasSize = null;
ref = await image.fetchReference('https://example.com/icons/d20.svg');
check('an SVG is rasterised rather than sent as-is',
  [ref.name, ref.type], ['d20.png', 'image/png']);
check('an SVG reporting no intrinsic size still gets a usable canvas',
  canvasSize, { width: 512, height: 512 });

globalThis.Image = class {
  constructor() { setTimeout(() => this.onload?.(), 0); }
  set src(_v) {}
  naturalWidth = 300;
  naturalHeight = 200;
};
canvasSize = null;
await image.fetchReference('https://example.com/icons/wide.svg');
check('one that reports a size is drawn at that size',
  canvasSize, { width: 300, height: 200 });

globalThis.Image = class {
  constructor() { setTimeout(() => this.onerror?.(), 0); }
  set src(_v) {}
};
await (async () => {
  try {
    await image.fetchReference('https://example.com/icons/broken.svg');
    check('an unrenderable reference throws', false, true);
  } catch (error) {
    check('an unrenderable reference is reported, not silently skipped',
      error.message, 'PFAI.Errors.NotAnImage');
  }
})();

/* ------------------------------------------------------------ what is sent */

globalThis.FormData = class {
  #entries = [];
  append(k, v, name) { this.#entries.push([k, v, name]); }
  get entries() { return this.#entries; }
  names(key) { return this.#entries.filter(([k]) => k === key).map(([, , n]) => n); }
  value(key) { return this.#entries.find(([k]) => k === key)?.[1]; }
};

settings = { openaiApiKey: 'sk-test', openaiImageModel: 'gpt-image-2' };
let sent;
globalThis.fetch = async (url, init) => {
  sent = { url, init };
  return { ok: true, json: async () => ({ data: [{ b64_json: 'AAAA', revised_prompt: 'a keep' }] }) };
};

let result = await image.generateImage({ prompt: 'A burning keep', size: '1024x1024', quality: 'high' });
check('with no references it posts JSON to /generations',
  sent.url.endsWith('/images/generations'), true);
check('and returns the image with the prompt the model actually used',
  [result.b64, result.revisedPrompt], ['AAAA', 'a keep']);
check('the key is sent as a bearer token',
  sent.init.headers.Authorization, 'Bearer sk-test');

const reference = new globalThis.File([], 'keep.png', { type: 'image/png' });
result = await image.generateImage({
  prompt: 'A burning keep', references: [reference, reference], size: '1024x1024', quality: 'high',
});
check('with references it posts to /edits instead',
  sent.url.endsWith('/images/edits'), true);
check('every reference is sent under the repeated image field the API wants',
  sent.init.body.names('image'), ['keep.png', 'keep.png']);
check('and the prompt goes with them', sent.init.body.value('prompt'), 'A burning keep');
check('Content-Type is left to the browser, so the multipart boundary is right',
  'Content-Type' in sent.init.headers, false);

// "auto" means "do not send a preference", not a literal quality value.
await image.generateImage({ prompt: 'x', references: [reference], size: '1024x1024', quality: 'auto' });
check('an auto quality is omitted rather than sent literally',
  sent.init.body.value('quality'), undefined);

settings = {};
await (async () => {
  try {
    await image.generateImage({ prompt: 'x' });
    check('no key throws', false, true);
  } catch (error) {
    check('without a key it fails before any network call',
      error.message.includes('PFAI.Errors.NoApiKey'), true);
  }
})();

/* ------------------------------------------------------------ where it lands */

settings = { openaiApiKey: 'sk-test' };
globalThis.atob = (b64) => Buffer.from(b64, 'base64').toString('binary');
String.prototype.slugify = function slugify() {
  return this.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
};

let uploaded = null;
let created = [];
globalThis.foundry.applications = {
  apps: {
    FilePicker: {
      implementation: {
        createDirectory: async (source, dir) => { created.push([source, dir]); },
        upload: async (source, dir, file) => {
          uploaded = { source, dir, file };
          return { path: `${dir}/${file.name}` };
        },
      },
    },
  },
};

const path = await image.saveImage('AAAA', 'image/png', 'Holding the Kettle Bridge');
check('the file is written under the world directory',
  uploaded.dir, `worlds/pf-test/${MODULE_ID}`);
check('and the directory is created first', created.length, 1);
check('the name is slugified from what the GM called it',
  uploaded.file.name.startsWith('holding-the-kettle-bridge-'), true);
check('with a random suffix, so two images do not collide',
  uploaded.file.name !== 'holding-the-kettle-bridge.png', true);
check('and the extension matches the mime type', uploaded.file.name.endsWith('.png'), true);
check('the stored path is what came back from the upload', path, `${uploaded.dir}/${uploaded.file.name}`);

check('a jpeg is saved with the short extension',
  (await image.saveImage('AAAA', 'image/jpeg', 'x'), uploaded.file.name.endsWith('.jpg')), true);
check('an untitled image still gets a name',
  (await image.saveImage('AAAA', 'image/png', ''), uploaded.file.name.startsWith('image-')), true);
check('and so does one whose title slugifies to nothing',
  (await image.saveImage('AAAA', 'image/png', '???'), uploaded.file.name.startsWith('image-')), true);

// An existing directory is the normal case on the second image.
created = [];
globalThis.foundry.applications.apps.FilePicker.implementation.createDirectory =
  async () => { throw new Error('EEXIST: file already exists'); };
check('a directory that already exists is not an error',
  Boolean(await image.saveImage('AAAA', 'image/png', 'second')), true);

globalThis.foundry.applications.apps.FilePicker.implementation.createDirectory =
  async () => { throw new Error('EACCES: permission denied'); };
await (async () => {
  try {
    await image.saveImage('AAAA', 'image/png', 'third');
    check('a real directory failure throws', false, true);
  } catch (error) {
    check('but a real one is not swallowed', error.message.includes('EACCES'), true);
  }
})();

globalThis.foundry.applications.apps.FilePicker.implementation.createDirectory = async () => {};
globalThis.foundry.applications.apps.FilePicker.implementation.upload = async () => ({});
await (async () => {
  try {
    await image.saveImage('AAAA', 'image/png', 'fourth');
    check('an upload returning no path throws', false, true);
  } catch (error) {
    check('an upload that returns no path is reported rather than stored empty',
      error.message, 'PFAI.Errors.UploadFailed');
  }
})();

done('artwork: the model, the request, rasterising references, and saving');
