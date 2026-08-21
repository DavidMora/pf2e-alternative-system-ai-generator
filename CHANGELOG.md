# Changelog

## 1.0.0

First release.

### Security

- **The OpenAI API key is no longer stored in the world.** It was a world
  setting with `restricted: true`, which only prevents players *editing* it.
  Foundry sends every world setting to every client that joins, so the key was
  being handed to everyone at the table and could be read from any player's
  console. It is now client-scoped, kept in the browser of the GM who entered
  it and never sent anywhere else.

  On first load as GM the module deletes the old world-scoped key and says so.
  **If you used an earlier build, revoke that key at platform.openai.com.**
  Deleting it stops it being sent again; it cannot un-send what already went.

- The key field renders as a password input, so it is not read over a shoulder
  or caught in a screen share. That is all it does — it is not encryption. No
  module can hide a key from the person operating the browser it runs in; the
  README explains how to proxy instead if that matters to you.

### Subsystems

All five published PF2e subsystems, generated from a premise you write:

- **Chases** — obstacles with per-obstacle chase point goals from the published
  formula, forks, passing, and per-participant contribution.
- **Influence** — discovery checks that uncover approaches, thresholds that
  concede something specific, and weaknesses, resistances and penalties.
- **Research** — sources with caps so no single shelf finishes the job,
  findings at point totals, and events that interrupt the work.
- **Infiltration** — objectives and obstacles where failure costs awareness
  rather than progress, awareness breakpoints, complications, opportunities,
  preparations and edge points.
- **Leadership** — an organisation whose level is the track, the published size
  table, lieutenants, and downtime events that surface as it grows.

### Working with your own agent

Every generate dialog can **Save brief**: the prose you wrote, the exact
prompts this module would have sent, and the strict schema an answer must
match. Fill in its `payload` with any agent you like and import it. Import
verifies first and reports what is wrong by path, separating what must be
fixed from what is merely worth checking.

### Throughout

The GM writes the premise and it is stored verbatim; the model never sees a
field it could rewrite it in. The GM owns every DC — the model picks a
difficulty adjustment and the module computes `baseDC + adjustment`, because
models are unreliable at recalling the level-based DC table. Player rolls are
relayed to exactly one designated GM client, so points are never counted twice.
