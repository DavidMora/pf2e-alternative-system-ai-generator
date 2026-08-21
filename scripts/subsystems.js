import { MODULE_ID } from './constants.js';
import {
  deleteChase,
  deleteInfluence,
  getChase,
  getChases,
  deleteInfiltration,
  deleteLeadership,
  deleteResearch,
  getInfluence,
  getInfluences,
  getInfiltration,
  getInfiltrations,
  getLeadership,
  getLeaderships,
  getResearch,
  getResearches,
  nextPosition,
  setChases,
  setInfluences,
  setInfiltrations,
  setLeaderships,
  setResearches,
  updateChase,
  updateInfluence,
  updateInfiltration,
  updateLeadership,
  updateResearch,
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
    blankName: 'PFAI.Chase.NewChase',
    label: 'PFAI.View.Chases',
    icon: 'fa-person-running',
    get: getChase,
    getAll: getChases,
    save: setChases,
    update: updateChase,
    remove: deleteChase,
  },
  leadership: {
    key: 'leadership',
    blankName: 'PFAI.Leadership.NewOrganization',
    label: 'PFAI.Leadership.Tab',
    icon: 'fa-flag',
    get: getLeadership,
    getAll: getLeaderships,
    save: setLeaderships,
    update: updateLeadership,
    remove: deleteLeadership,
  },
  infiltration: {
    key: 'infiltration',
    blankName: 'PFAI.Infiltration.NewInfiltration',
    label: 'PFAI.Infiltration.Tab',
    icon: 'fa-user-secret',
    get: getInfiltration,
    getAll: getInfiltrations,
    save: setInfiltrations,
    update: updateInfiltration,
    remove: deleteInfiltration,
  },
  research: {
    key: 'research',
    blankName: 'PFAI.Research.NewResearch',
    label: 'PFAI.Research.Tab',
    icon: 'fa-book-open-reader',
    get: getResearch,
    getAll: getResearches,
    save: setResearches,
    update: updateResearch,
    remove: deleteResearch,
  },
  influence: {
    key: 'influence',
    blankName: 'PFAI.Influence.NewInfluence',
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
  // `kind` says which of the three exchange shapes this is. Files written
  // before it existed have no kind and are still recognised by their `data`.
  return { module: MODULE_ID, kind: 'event', type: key, version: 2, data: event };
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
