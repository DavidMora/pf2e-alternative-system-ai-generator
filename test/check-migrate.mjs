/*
 * Migration, and the GM-facing helpers around the exchange.
 *
 * Migration runs once, silently, on somebody's real campaign. If it is wrong
 * the damage is to stored data a GM cannot get back, so the interesting cases
 * are the ones where it must do nothing: not a GM, nothing to fix, already
 * migrated.
 *
 * The API-key migration is here too. It deletes a Setting document rather than
 * blanking it, because a blanked world setting is still a world setting and
 * Foundry hands every one of those to every client that joins.
 */
import { installGlobals, load, makeCheck, notes, reset, store } from './harness.mjs';

installGlobals();
const { check, done } = makeCheck();

const migrate = await load('migrate.js');
const h = await load('helpers.js');
const { DEFAULT_BASE_DC } = await load('constants.js');
const { givenFromForm, validateGiven, checkSemantics, EXCHANGE_KINDS, EXCHANGE_VERSION } =
  await load('exchange.js');

/* ------------------------------------------- recovering skills from markup */

/*
 * Chases generated before skill options were stored separately have only the
 * rendered HTML. The inline checks in it carry everything needed.
 */
const overcome = '<p>@Check[type:athletics|dc:20]{Athletics} &mdash; Haul yourself over.</p>'
  + '<p>@Check[type:acrobatics|dc:18]{Acrobatics} &mdash; Tumble the gap.</p>';
const parsed = Object.values(migrate.parseSkillOptions(overcome));

check('two inline checks come back as two options', parsed.length, 2);
check('with their slugs', parsed.map((o) => o.slug), ['athletics', 'acrobatics']);
check('their DCs', parsed.map((o) => o.dc), [20, 18]);
check('their labels', parsed.map((o) => o.label), ['Athletics', 'Acrobatics']);
check('and the prose after the dash', parsed[0].description, 'Haul yourself over.');
check('in the order they were written', parsed.map((o) => o.position), [0, 1]);

check('an em dash character works as well as the entity',
  Object.values(migrate.parseSkillOptions('@Check[type:stealth|dc:15]{Stealth} — Keep low.'))[0].description,
  'Keep low.');
check('a check with no description still parses',
  Object.values(migrate.parseSkillOptions('@Check[type:stealth|dc:15]{Stealth}'))[0].label, 'Stealth');
check('prose with no checks in it yields nothing',
  migrate.parseSkillOptions('<p>Just some text.</p>'), {});
check('and empty markup does not throw', migrate.parseSkillOptions(''), {});
check('nor does missing markup', migrate.parseSkillOptions(undefined), {});

/* ------------------------------------------------------ migrating a world */

const oldChase = (over = {}) => ({
  id: 'c1', name: 'An Old Chase',
  obstacles: { o1: { id: 'o1', name: 'The Gap', overcome, ...over } },
});

reset();
await h.setChases({ events: { c1: oldChase() } });
const first = await migrate.migrateChases();
check('an obstacle with no skill options is backfilled', first.obstaclesFixed, 1);
check('and the world is reported as changed', first.changed, true);
check('the options are now stored',
  Object.values(h.getChase('c1').obstacles.o1.skillOptions).map((o) => o.slug),
  ['athletics', 'acrobatics']);
check('older obstacles also get a round allowance',
  h.getChase('c1').obstacles.o1.rounds, { current: 0, max: null });
check('the GM is told what was recovered', notes.some((n) => n.includes('Backfilled')), true);

// Running twice must be a no-op, or every reload rewrites the world.
notes.length = 0;
const second = await migrate.migrateChases();
check('running it again changes nothing', second, { changed: false, obstaclesFixed: 0 });
check('and says nothing', notes.length, 0);

// An obstacle that already has options must not be re-parsed from stale HTML.
reset();
await h.setChases({ events: { c1: oldChase({
  skillOptions: { keep: { id: 'keep', slug: 'thievery', label: 'Thievery', dc: 30, position: 0 } },
  rounds: { current: 2, max: 4 },
}) } });
await migrate.migrateChases();
check('an obstacle the GM has already edited is left alone',
  Object.values(h.getChase('c1').obstacles.o1.skillOptions).map((o) => o.slug), ['thievery']);
check('and its round count is not reset',
  h.getChase('c1').obstacles.o1.rounds, { current: 2, max: 4 });

// Migration writes a world setting, so a player must never run it.
reset();
await h.setChases({ events: { c1: oldChase() } });
globalThis.game.user = { id: 'p1', isGM: false };
check('a player does not migrate the world', await migrate.migrateChases(), { changed: false });
check('and nothing was written',
  h.getChase('c1').obstacles.o1.skillOptions, undefined);
globalThis.game.user = { id: 'gm1', isGM: true };

check('an empty world migrates to nothing', (reset(), await migrate.migrateChases()),
  { changed: false, obstaclesFixed: 0 });

/* -------------------------------------------- the key that should not be there */

/*
 * `restricted: true` stops a player editing a setting, not reading one. The
 * key was world-scoped once, so on any world where that ran it has already
 * gone out to everyone who joined — hence a permanent error telling the GM to
 * revoke it, not a reassurance.
 */
function withWorldKey(value) {
  const deleted = [];
  globalThis.game.settings.storage = {
    get: (scope) => (scope === 'world'
      ? { getSetting: () => (value === null ? null : { value, delete: async () => deleted.push(true) }) }
      : null),
  };
  return deleted;
}

reset();
let deleted = withWorldKey('"sk-secret"');
const moved = await migrate.migrateApiKeyOutOfWorld();
check('a key left in the world database is found', moved.moved, true);
check('the Setting document is deleted, not blanked', deleted.length, 1);
check('and the GM is told to revoke it, not that it is fine',
  notes.some((n) => n.startsWith('error:') && n.includes('KeyMoved')), true);

reset();
withWorldKey(null);
check('a world with no such setting needs no migration',
  await migrate.migrateApiKeyOutOfWorld(), { moved: false });
reset();
withWorldKey('""');
check('and neither does an empty one',
  await migrate.migrateApiKeyOutOfWorld(), { moved: false });

reset();
deleted = withWorldKey('"sk-secret"');
globalThis.game.user = { id: 'p1', isGM: false };
check('a player cannot run it', await migrate.migrateApiKeyOutOfWorld(), { moved: false });
check('and deletes nothing', deleted.length, 0);
globalThis.game.user = { id: 'gm1', isGM: true };

/* ------------------------------------------ the dialog contents, written out */

check('the exchange kinds are the three the format defines',
  Object.keys(EXCHANGE_KINDS).sort(), ['brief', 'event', 'payload']);
check('and the format is versioned', Number.isInteger(EXCHANGE_VERSION), true);

const form = givenFromForm('chase', {
  premise: '  A running fight.  ', title: '', obstacleCount: '4', baseDC: '22', roundLimit: '',
});
check('text is trimmed', form.premise, 'A running fight.');
check('an empty field is dropped rather than stored blank', 'title' in form, false);
check('numbers are parsed out of the form strings', form.obstacleCount, 4);
check('a blank number is dropped, not stored as NaN', 'roundLimit' in form, false);
check('what the GM typed wins', form.baseDC, 22);
check('and a base DC they left out gets the default',
  givenFromForm('chase', { premise: 'x' }).baseDC, DEFAULT_BASE_DC);
check('party size and level are filled in from the world',
  [Number.isInteger(givenFromForm('chase', {}).partySize),
   Number.isInteger(givenFromForm('chase', {}).level)], [true, true]);

/* ------------------------------------------- what the GM has to supply */

const problems = (key, given) => validateGiven(key, given).map((p) => `${p.path}:${p.severity}`);

check('a chase with no premise is rejected',
  problems('chase', { baseDC: 20 }).includes('given.premise:error'), true);
check('whitespace does not count as a premise',
  problems('chase', { premise: '   ', baseDC: 20 }).includes('given.premise:error'), true);
check('influence needs the NPC as well as the premise',
  problems('influence', { premise: 'x', baseDC: 20 }).sort(),
  ['given.npcDescription:error', 'given.npcName:error']);
check('a missing base DC is a warning, since there is a default',
  problems('chase', { premise: 'x' }), ['given.baseDC:warning']);
check('a base DC outside the table is an error',
  problems('chase', { premise: 'x', baseDC: 900 }).includes('given.baseDC:error'), true);
check('so is a party size nobody has',
  problems('chase', { premise: 'x', baseDC: 20, partySize: 40 }).includes('given.partySize:error'), true);
check('and a base DC that is not a number at all',
  problems('chase', { premise: 'x', baseDC: 'twenty' }).includes('given.baseDC:error'), true);
check('no given at all is one clear problem, not a list of them',
  validateGiven('chase', undefined).length, 1);
check('a complete given passes clean',
  problems('chase', { premise: 'x', baseDC: 20, level: 5, partySize: 4 }), []);

/* ------------------------- semantics are only checked, never invented */

check('a payload that is not an object yields no semantic problems to report',
  [checkSemantics('chase', null, {}), checkSemantics('chase', 'x', {})], [[], []]);
check('a subsystem with nothing extra to check is silent',
  checkSemantics('victory', { checks: [], thresholds: [], events: [] }, {}).length > 0, true);

done('migration, the exchange form, and what the GM must supply');
