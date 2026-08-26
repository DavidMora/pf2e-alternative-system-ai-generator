/*
 * The Foundry globals the pure logic touches, in one place.
 *
 * Every suite was stubbing these itself, which meant they drifted: one had
 * `Math.clamp`, another did not; one recorded notifications, another swallowed
 * them. A test that fails because its own stub is wrong teaches nothing.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const scripts = path.join(root, 'scripts');

/** World settings, in memory. Keyed the way `game.settings` keys them. */
export const store = {};

/** Everything the code pushed at the user, so a test can assert on it. */
export const notes = [];

let idCounter = 0;

/**
 * Actors the roll path can find, keyed by uuid. A roll needs an owned actor
 * with the statistic it names, so a test controls both by putting one here.
 */
export const actors = new Map();

/**
 * An actor that owns the given statistics and always rolls `degree`.
 *
 * `isOwner` and the presence of the slug are both gates in the roll path, so
 * they are parameters rather than assumptions.
 */
export function makeActor({
  uuid, name = 'Someone', degree = 2, slugs = ['athletics'], isOwner = true,
} = {}) {
  const actor = {
    uuid, name, isOwner,
    getStatistic: (slug) => (slugs.includes(slug)
      ? { roll: async () => ({ degreeOfSuccess: degree }) }
      : null),
  };
  actors.set(uuid, actor);
  return actor;
}

export function installGlobals({ isGM = true } = {}) {
  Math.clamp = (v, min, max) => Math.min(Math.max(v, min), max);

  globalThis.foundry = {
    utils: {
      randomID: () => `id${++idCounter}`,
      escapeHTML: (s) => String(s).replace(/[&<>"']/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    },
  };

  globalThis.game = {
    user: { id: 'gm1', isGM },
    users: { activeGM: { id: 'gm1' } },
    actors: [],
    settings: {
      get: (_module, key) => ({ toObject: () => structuredClone(store[key] ?? { events: {} }) }),
      set: (_module, key, value) => {
        store[key] = structuredClone(value);
      },
    },
    i18n: {
      localize: (k) => k,
      // Format keeps its data so a test can read what a message was told.
      format: (k, d) => `${k} ${JSON.stringify(d)}`,
      lang: 'en',
    },
  };

  globalThis.fromUuid = async (uuid) => actors.get(uuid) ?? null;

  const record = (kind) => (message) => notes.push(`${kind}:${message}`);
  globalThis.ui = {
    notifications: { info: record('info'), warn: record('warn'), error: record('error') },
  };
}

/** Reset between cases so one test's leftovers cannot prop up the next. */
export function reset() {
  for (const key of Object.keys(store)) delete store[key];
  notes.length = 0;
  actors.clear();
  if (globalThis.game) globalThis.game.user = { id: 'gm1', isGM: true };
}

/** Run `fn` as a player rather than the GM, then put the GM back. */
export async function asPlayer(fn) {
  const was = globalThis.game.user;
  globalThis.game.user = { id: 'p1', isGM: false };
  try {
    return await fn();
  } finally {
    globalThis.game.user = was;
  }
}

/** A tiny assertion helper with the same shape the other suites use. */
export function makeCheck() {
  const state = { failed: 0, ran: 0 };
  const check = (label, actual, expected) => {
    state.ran += 1;
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (!ok) {
      state.failed = 1;
      console.error(
        `FAIL ${label}\n  got      ${JSON.stringify(actual)}\n  expected ${JSON.stringify(expected)}`,
      );
    } else console.log(`ok  ${label}`);
  };
  const done = (summary) => {
    if (state.failed) console.error('\nFAILED');
    else console.log(`\nok  ${summary} (${state.ran} checks)`);
    process.exit(state.failed);
  };
  return { check, done, state };
}

/** Import a module under `scripts/`, after the globals exist. */
export const load = (relative) => import(`file://${path.join(scripts, relative)}`);
