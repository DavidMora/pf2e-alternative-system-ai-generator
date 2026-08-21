import { MODULE_ID, SETTINGS } from './constants.js';
import { getChases, setChases } from './helpers.js';

/**
 * Recover structured skill options from an obstacle's rendered HTML.
 *
 * Chases generated before skill options were stored separately only have the
 * `overcome` markup. The inline checks in it carry everything needed, so parse
 * them back out rather than making a GM regenerate work they already have.
 */
export function parseSkillOptions(overcome) {
  const record = {};
  if (!overcome) return record;

  // @Check[type:athletics|dc:20]{Athletics} &mdash; description text
  const pattern = /@Check\[[^\]]*?type:([a-z0-9-]+)[^\]]*?\|?[^\]]*?dc:(\d+)[^\]]*\]\{([^}]*)\}(?:\s*(?:&mdash;|&#8212;|—|-)\s*([^<]*))?/gi;
  let match;
  let position = 0;
  while ((match = pattern.exec(overcome)) !== null) {
    const [, slug, dc, label, description] = match;
    const id = foundry.utils.randomID();
    record[id] = {
      id,
      position: position++,
      slug,
      label: (label || slug).trim(),
      dc: Number(dc),
      description: (description ?? '').trim(),
      leadsTo: '',
    };
  }
  return record;
}

/**
 * Bring stored chases up to the current schema. Runs GM-side only, since it
 * writes a world setting, and only saves when something actually changed.
 */
export async function migrateChases() {
  if (!game.user.isGM) return { changed: false };

  const chases = getChases();
  let changed = false;
  let obstaclesFixed = 0;

  for (const chase of Object.values(chases.events)) {
    for (const obstacle of Object.values(chase.obstacles ?? {})) {
      // Backfill roll options from the rendered HTML.
      if (!obstacle.skillOptions || Object.keys(obstacle.skillOptions).length === 0) {
        const parsed = parseSkillOptions(obstacle.overcome);
        if (Object.keys(parsed).length) {
          obstacle.skillOptions = parsed;
          obstaclesFixed += 1;
          changed = true;
        }
      }
      // Give older obstacles a round allowance so the counter has something to show.
      if (!obstacle.rounds) {
        obstacle.rounds = { current: 0, max: null };
        changed = true;
      }
    }
  }

  if (changed) {
    await setChases(chases);
    console.log(`${MODULE_ID} | migrated ${obstaclesFixed} obstacle(s) to structured skill options`);
    if (obstaclesFixed) {
      ui.notifications.info(
        game.i18n.format('PFAI.Migrate.Backfilled', { count: obstaclesFixed }),
      );
    }
  }

  return { changed, obstaclesFixed };
}


/**
 * Get an API key out of the world database.
 *
 * The key used to be a world setting, and Foundry sends every world setting to
 * every client that joins, so on any world where this ran before the change
 * the key has already been handed to whoever was at the table. Deleting it
 * here stops it going out again; it does not un-send it, which is why the GM
 * is told to revoke it rather than just reassured.
 *
 * The Setting document is deleted rather than blanked, so nothing is left for
 * the next `Setting.dump()` to broadcast.
 */
export async function migrateApiKeyOutOfWorld() {
  if (!game.user.isGM) return { moved: false };

  const key = `${MODULE_ID}.${SETTINGS.apiKey}`;
  const stored = game.settings.storage.get('world')?.getSetting?.(key);
  const value = String(stored?.value ?? '').replace(/^"|"$/g, '');
  if (!stored || !value) return { moved: false };

  await stored.delete();
  ui.notifications.error(game.i18n.localize('PFAI.Settings.KeyMoved'), { permanent: true });
  console.warn(`${MODULE_ID} | removed the API key from the world database; revoke the old key`);
  return { moved: true };
}
