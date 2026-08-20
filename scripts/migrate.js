import { MODULE_ID } from './constants.js';
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
