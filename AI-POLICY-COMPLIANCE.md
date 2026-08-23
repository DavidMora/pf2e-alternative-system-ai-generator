# Foundry's AI Content Policy, applied to this package

Policy: https://foundryvtt.com/article/ai-policy/

A maintainer's working note, not shipped in the release zip. It records what
the policy asks, what this package does about it, and — the part that matters —
what is not settled by the code and has to be settled by you.

The policy's own framing: the ecosystem "is at its best when it is built by
human creators". It does not ban AI. It draws a line between content that ships
in the package and content generated at runtime, and holds those to opposite
standards.

---

## The line the policy draws

**Prepared content** — anything that ships inside the package — must be
human-made. Written rules and lore, images, audio, marketing copy. AI may
proofread and format, not author.

**Improvised content** — generated at runtime in response to an unpredictable
user prompt — may be AI-generated, for text, images and audio alike. The policy
names NPC generators and randomised content as permitted examples.

This module is an improvised-content package. That is the whole design: it
ships no encounters, and every encounter it produces comes from a premise the
GM typed a moment earlier.

---

## Where this package stands

### Settled by how it is built

**No generated content ships.** The release zip is `module.json`, `LICENSE`,
`NOTICE.md`, `README.md`, `CHANGELOG.md`, `scripts`, `styles`, `templates`,
`lang`. No images, no audio, no prewritten encounters — verified against the
zip. Artwork a GM generates is written into their own world at runtime, which
is improvised content.

**Generation is always user-initiated.** Nothing is produced on load, on a
timer, or in the background. A GM fills in a dialog and presses a button.

**No context is collected on the user's behalf.** The policy forbids packages
that "automatically collect/inject context from sources lacking proper rights".
This one sends only what the GM typed, plus reference images they picked by
hand. It never reads the world, compendia, actor sheets, chat, or anything
else. The README now says plainly that references a GM supplies must be theirs
to send.

**No runtime code generation.** The policy requires readable display and
explicit confirmation for that; the schemas cannot express code, so the case
does not arise.

**The AI Tools category applies** and must be set at submission — required for
packages "incorporating AI models/interfaces for runtime improvised content".

**"Zero AI" must not be claimed.** It is for packages that used no AI at any
stage. Claiming it wrongly means removal and a possible submission ban.

### Not settled by the code — yours to settle

**1. The code attestation.**

> *Authors must personally understand, explain, and maintain all code; "vibe
> coding" prohibited; authors attest to full comprehension at submission.*

I wrote essentially all of this code. You are the one who signs the attestation,
and the policy puts the burden of proof on the author — it lists commit history
examination and author interviews among the things an investigation may
involve. Every commit here carries a `Co-Authored-By: Claude` trailer, so the
AI involvement is on the record and will be visible.

That trailer is not itself disqualifying: the policy bars *not understanding
your code*, not using a tool to help write it. But the standard is real. Before
you attest, you should be able to sit with someone and explain, without
reference to me:

- why the model never emits a DC, and what `dcFromBase` does instead;
- why the API key is client-scoped, and what `Setting.dump()` has to do with it;
- why a player's roll is relayed to one designated GM rather than applied
  locally;
- what `_onRender` wires up, and why its absence was invisible for weeks;
- what the import verifier checks beyond the JSON schema, and why.

If any of those is a blank, read that part before submitting rather than after.
The architecture section of the README and the `CLAUDE.md` notes are written to
make that possible, and I can walk you through any of it.

**2. Marketing text must be human-written.**

> *Marketing materials: Must feature human-written descriptions and human-made
> media; AI generation of marketing text prohibited.*

This is the one clear-cut gap. Two pieces of text are mine and need to become
yours:

- the `description` field in `module.json`;
- the listing description you paste into the submission form (the draft in
  `PUBLISHING.md` is mine — do not paste it).

Write both in your own words. They do not need to be polished; they need to be
written by you. Nothing else about the submission is blocked on this, but this
is.

**3. The ⓘ tooltips deserve a read.**

Thirty-three strings in `lang/en.json` under `PFAI.Info.*`. Most are interface
copy — what a button does, what a column means — which is not what the policy
means by rules and lore. A few edge closer to explaining PF2e's rules, which
prepared-content text is supposed to be human-authored.

My reading is that interface help is not "rules, lore, adventure content, and
item descriptions", and that this is fine. But it is my reading of someone
else's policy, so read them yourself and rewrite any that feel like they are
teaching the game rather than the interface. `PFAI.Info.*` in `lang/en.json`.

---

## What I would tell a reviewer

If asked to characterise this package in one sentence: it is a runtime
generator, of the kind the policy explicitly permits, that ships no generated
content and gathers no context on the user's behalf; its author used an AI
assistant to write the code, disclosed in every commit, and attests to
understanding and maintaining it.

That last clause is the only part I cannot vouch for on your behalf.

---

## Deadline

The policy gives non-compliant packages until **14 September 2026** before
archival or deletion. That applies to packages already listed. A new submission
is judged at submission, so this is a matter of getting it right first time
rather than a countdown.
