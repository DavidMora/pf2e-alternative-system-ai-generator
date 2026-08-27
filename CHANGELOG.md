# Changelog

## 1.2.0

### Spanish

`lang/es.json`, all 753 strings, with PF2e terminology as Devir translates it —
DJ, CD, asaltos. A test now compares every language against English on keys,
placeholders and empty values, so a translation cannot quietly fall behind the
way one silently would before.

### What a generation costs

The API has always returned its token usage and the module threw it away. Every
generation now reports what it used and roughly what it cost, and keeps a
running total beside the key it is spent with — client scope, because one GM's
spending is not a fact about the world. A model with no published price reports
tokens and no figure rather than inventing one.

### Timeouts and one retry

A hung request used to wait for ever behind the dialog's spinner; the only way
out was a GM noticing and cancelling. There is a timeout now, configurable,
composed with the caller's signal so cancelling still works and the two stay
distinguishable.

A call that fails transiently — a rate limit, a 5xx, an answer that will not
parse — is retried once, because the GM has already paid for it. A refusal, a
bad key or a rejected schema fails at once, since asking again would spend more
money to fail identically.

### Fixed

- Leadership announced revealed events inline in the view rather than through a
  paired announcer like the other five. That shape is what let the influence
  stepper lose its announcements without anyone noticing.

### Internal

`ai/image.js` had no coverage at all — the file that touches the world's data
directory and an endpoint that rejects SVG while Foundry ships SVG icons. It has
36 assertions now, including the zero-sized-SVG case that would otherwise
produce a blank reference.

`check-templates.mjs` asserted its shared contract against four of the six
subsystems, having been written one at a time and never extended. It is driven
by the shared context map now, so a seventh is covered the day it gets a
fixture.

The relay was verified for the first time across two genuine clients — a real
second session emitting over the wire — for victory, influence and research,
including five malformed messages that had to be refused. `test/manual/`
records how, since no automated suite can reach it.

CI moved off the deprecated Node 20.

## 1.1.0

### Victory Points

The generic subsystem the other five are specialisations of, for the contest at
your table the published four do not cover. Both published structures:
accumulating rolls climbing to an endpoint, and diminishing rolls that start at
the endpoint and fall, where running out is the bad ending rather than merely
not winning yet.

The scale comes from the published table — a forefront contest is 50 points with
thresholds at 10, 20, 30 and 40 — so the model writes what each threshold means
and never picks a number. Checks can be marked as ones the party earns by
working something out; those start hidden and pay more, as the rules ask.

The module never declares a winner. When the track fills or empties it says so,
once, and the GM calls it won, lost or undecided. The number says where the
track stands; it does not say how the scene ended.

### Fixed

- The GM's award button credited backwards in a diminishing contest: awarding a
  point docked the character it was meant to reward. The award now lives beside
  its three siblings in `rolls.js` rather than inline in the view, which is how
  it drifted in the first place.
- Stepping the influence total past a concession revealed it without telling
  anyone. The reveal loop had three copies and one had lost its announcements;
  there is one copy now.
- `loreSlug('')` produced a bare `-lore`, and an unset Victory event reported
  its track as already finished.
- Imported Victory files got no playability checks at all — the subsystem was
  added after the verifier and nobody extended it. A file whose checks all
  need groundwork (so the contest opens empty), whose thresholds do not match
  its scale, or whose events fire past the endpoint is now diagnosed with the
  path and a sentence.
- Socket messages carrying `kind`, and `objectiveId` on infiltration obstacles,
  reached their handlers unvalidated.

### Internal

The seven socket predicates were the same five lines with different id names,
and the two that used the shared helper had already drifted from the five that
did not. One shape now.

Test coverage went from 67 to 172 of the module's exported functions, across
eleven suites and 986 assertions. Every new assertion was checked by breaking
the code it covers and watching it fail — which is how the award bug above was
found, along with two older assertions that could never have failed.

## 1.0.1

Generated artwork was invisible. Add art would run, store the image and hide
its own button, and nothing would appear in its place.

The art figure sits directly in a flex column and took the default
`flex-shrink: 1`, so on a long event it was squeezed to zero height and its own
`overflow: hidden` clipped the picture away entirely. Short events had slack,
which is why chases looked fine: it depends on how much content sits above the
art, not on which subsystem you are in.

Art is also capped at 14rem and cropped from the centre now. At full panel
width a square image came out over eight hundred pixels tall and pushed the
whole encounter below the fold.

## 1.0.0

First release.

Tested on Foundry 13.351 with pf2e 7.12.2 and on Foundry 14.367 with pf2e
8.4.1: the module loads on both, and the PF2e roll API it depends on -
`actor.getStatistic(slug).roll({dc})` returning a `CheckRoll` with an integer
`degreeOfSuccess` - is unchanged between them. No deprecation warnings on
either.

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
