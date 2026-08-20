import { MODULE_ID } from './constants.js';
import { registerSettings } from './settings.js';
import { SubsystemView } from './apps/subsystem-view.js';
import { GenerateChaseDialog } from './apps/generate-chase-dialog.js';
import { GenerateImageDialog } from './apps/generate-image-dialog.js';
import { generateChase } from './ai/chase.js';
import { registerSocket } from './socket.js';
import { applyInfluenceResult, applyPassResult, applyRollResult } from './rolls.js';
import { migrateChases } from './migrate.js';

Hooks.once('init', () => {
  registerSettings();
  registerHandlebarsHelpers();

  game.modules.get(MODULE_ID).api = {
    open: (eventId, subsystemKey) => SubsystemView.open(eventId, subsystemKey),
    generate: (options) => new GenerateChaseDialog(options).render({ force: true }),
    generateChase,
    generateImage: (options) => new GenerateImageDialog(options).render({ force: true }),
    SubsystemView,
    GenerateChaseDialog,
    GenerateImageDialog,
  };
});

/**
 * Namespaced helpers so the templates never depend on which comparison helpers
 * a given Foundry version happens to ship.
 */
/** Partials keep the influence view out of the already-large shell template. */
async function registerPartials() {
  await foundry.applications.handlebars.loadTemplates({
    pfaiInfluenceDetail: `modules/${MODULE_ID}/templates/partials/influence-detail.hbs`,
    pfaiInfluenceChecks: `modules/${MODULE_ID}/templates/partials/influence-checks.hbs`,
    pfaiInfluenceTraits: `modules/${MODULE_ID}/templates/partials/influence-traits.hbs`,
  });
}

function registerHandlebarsHelpers() {
  Handlebars.registerHelper('pfaiEq', (a, b) => a === b);
  Handlebars.registerHelper('pfaiAdd', (a, b) => Number(a) + Number(b));
  Handlebars.registerHelper('pfaiOr', (...args) => args.slice(0, -1).some(Boolean));
  Handlebars.registerHelper('pfaiSubtract', (a, b) => Number(a) - Number(b));
  Handlebars.registerHelper('pfaiLt', (a, b) => Number(a) < Number(b));
}

// The socket is only live once the game is ready.
// Partials must exist before the window first renders, and the window can only
// be opened after setup, so registering here is early enough.
Hooks.once('setup', () => registerPartials());

Hooks.once('ready', async () => {
  await migrateChases();
  registerSocket({
    onShowChase: ({ subsystem, eventId }) => SubsystemView.open(eventId, subsystem),
    onApplyRoll: (data) => applyRollResult(data),
    onApplyPass: (data) => applyPassResult(data),
    onApplyInfluence: (data) => applyInfluenceResult(data),
  });
});

Hooks.on('getSceneControlButtons', (controls) => {
  const tool = {
    name: 'pfai-subsystems',
    title: 'PFAI.View.Title',
    icon: 'fa-solid fa-person-running',
    order: 99,
    button: true,
    visible: true,
    onClick: () => SubsystemView.open(),
    onChange: () => SubsystemView.open(),
  };

  // v13 hands over a record keyed by control name; older versions use arrays.
  if (Array.isArray(controls)) {
    const notes = controls.find((control) => control.name === 'notes');
    if (notes) notes.tools.push(tool);
    return;
  }

  const notes = controls.notes ?? controls.tokens;
  if (!notes) return;
  notes.tools[tool.name] = tool;
});

/**
 * The scene control only appears once the Notes layer is selected, which is too
 * well hidden to be the only entry point. Add a button to the Journal sidebar
 * header as well, where GMs actually look for campaign content.
 */
Hooks.on('renderJournalDirectory', (_app, element) => {
  const root = element instanceof HTMLElement ? element : element?.[0];
  const header = root?.querySelector('.directory-header');
  if (!header || header.querySelector('.pfai-open-button')) return;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'pfai-open-button';
  button.innerHTML = `<i class="fa-solid fa-person-running"></i> ${game.i18n.localize('PFAI.View.Title')}`;
  button.addEventListener('click', () => SubsystemView.open());
  header.prepend(button);
});
