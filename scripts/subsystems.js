import { MODULE_ID } from './constants.js';
import {
  deleteChase,
  deleteInfluence,
  getChase,
  getChases,
  getInfluence,
  getInfluences,
  nextPosition,
  setChases,
  setInfluences,
  updateChase,
  updateInfluence,
} from './helpers.js';

/**
 * One place describing how each subsystem is stored.
 *
 * Everything a GM does to an event as a whole — hide it, start it, push it to
 * the table, export it, rename it, delete it — is identical across subsystems.
 * Registering the storage differences here lets those actions be written once
 * instead of once per subsystem, which is also what keeps the two views
 * behaving the same way.
 */
export const SUBSYSTEMS = {
  chase: {
    key: 'chase',
    label: 'PFAI.View.Chases',
    icon: 'fa-person-running',
    get: getChase,
    getAll: getChases,
    save: setChases,
    update: updateChase,
    remove: deleteChase,
  },
  influence: {
    key: 'influence',
    label: 'PFAI.Influence.Tab',
    icon: 'fa-comments',
    get: getInfluence,
    getAll: getInfluences,
    save: setInfluences,
    update: updateInfluence,
    remove: deleteInfluence,
  },
};

/** Look up a subsystem, defaulting to chases for older markup. */
export function subsystem(key) {
  return SUBSYSTEMS[key] ?? SUBSYSTEMS.chase;
}

export function isSubsystem(key) {
  return Object.hasOwn(SUBSYSTEMS, key);
}

/** Read the subsystem and event a button refers to. */
export function eventTarget(dataset) {
  const key = dataset.subsystem ?? 'chase';
  const id = dataset.eventId ?? dataset.chaseId ?? dataset.influenceId;
  return { key, id, api: subsystem(key) };
}

/** Serialise one event for export, tagged so import can route it. */
export function exportPayload(key, event) {
  return { module: MODULE_ID, type: key, version: 2, data: event };
}

/**
 * Accept an exported payload and place it in the right store.
 * Always re-keys, so re-importing a file never overwrites the original.
 */
export async function importPayload(payload) {
  const key = payload?.type;
  if (!isSubsystem(key) || !payload?.data) return null;

  const api = subsystem(key);
  const store = api.getAll();
  const id = foundry.utils.randomID();
  store.events[id] = { ...payload.data, id, position: nextPosition(store.events) };
  await api.save(store);
  return { key, id };
}
