# Publishing this module

A maintainer's document. It is not shipped in the release zip.

Two things live here: how to submit the package to Foundry the first time, and
how to cut every release after that.

---

## Where things stand

Everything the submission form asks for already exists and resolves.

| | |
|---|---|
| Package id | `matadragones-subsystems-implementation-for-pf2e` — permanent once approved |
| Repository | https://github.com/DavidMora/pf2e-alternative-system-ai-generator — public |
| Latest release | `v1.0.0` |
| Manifest URL | https://github.com/DavidMora/pf2e-alternative-system-ai-generator/releases/latest/download/module.json |
| Download URL | https://github.com/DavidMora/pf2e-alternative-system-ai-generator/releases/latest/download/module.zip |
| Verified on | Foundry 13.351 (pf2e 7.12.2) and 14.367 (pf2e 8.4.1) |

Both URLs were checked returning 200, and v1.0.0 was installed into a clean
Foundry 14 from the manifest URL — the same path a reviewer and every user
takes.

---

## First-time submission

### 1. Open the form

Log in at **foundryvtt.com** with the account that holds your Foundry licence.
Your profile → **Packages** → **Submit New Package**.

You need a licensed account to submit. The listing is attached to that account.

### 2. Paste these

| Field | Value |
|---|---|
| Package Type | Module |
| Package Name | `matadragones-subsystems-implementation-for-pf2e` |
| Package Title | Matadragones Subsystems (AI driven) |
| Manifest URL | `https://github.com/DavidMora/pf2e-alternative-system-ai-generator/releases/latest/download/module.json` |
| Project URL | `https://github.com/DavidMora/pf2e-alternative-system-ai-generator` |

Field labels may read slightly differently; match them by meaning. The
**Manifest URL** is the one that matters — Foundry fetches it during review and
on every update check afterwards, and everything else can be edited later.

**Package Name is the id and is permanent.** On approval,
`matadragones-subsystems-implementation-for-pf2e` is yours and cannot be changed, renamed or
transferred to a different id. It is also the folder name in every user's
`Data/modules/`.

### 3. Description

The manifest already carries one; the listing wants its own. This works:

> Run the PF2e Chase, Influence, Research, Infiltration and Leadership
> subsystems with the encounters generated for you. Write the premise; the
> module builds the obstacles, approaches, sources, objectives and downtime
> events around it, computes every DC from a base you choose, and assembles the
> inline check links. Bring your own OpenAI key, or export a brief and hand it
> to an agent of your own — imports are verified and tell you exactly what is
> wrong with a file rather than refusing it.

### 4. Tags

**AI Tools** is the one people looking for this will browse. Add one or two
more that genuinely fit — *Automation Enhancers* is reasonable. Do not tag
*Actor and Item Sheets*; it touches no sheets.

### 5. The disclosure questions

Answer these carefully. They are the questions that get a listing pulled later
if answered loosely.

**Does the package make external network requests? Yes.**

> The module calls the OpenAI API (`api.openai.com`) when a GM asks it to
> generate an encounter or artwork. It sends the prose the GM wrote, the base
> DC, party level and size, and — for artwork only — any reference images the
> GM explicitly chose. No player data, actor sheets or chat is sent. Requests
> go straight from the GM's browser; nothing is proxied through the author. See
> the README section "Your API key, and what leaves your machine".

**Does the package cost money? Not from you — but say this anyway:**

> The module is free. It requires the user's own OpenAI API key, and OpenAI
> bills the user for their own usage. The module can also be used entirely
> without an API key by exporting a brief and importing an answer produced
> elsewhere.

Volunteering that second half matters. A user who discovers the API-key
requirement after installing is the kind of surprise that generates complaints.

**Licence.** MIT, at
`https://github.com/DavidMora/pf2e-alternative-system-ai-generator/blob/main/LICENSE`.

Add, wherever the form allows free text about content:

> Pathfinder Second Edition mechanical content is used under the ORC License.
> The Pathfinder trademark is used under Paizo's Community Use Policy, which
> also means this module is free and may never be sold. Full attributions in
> NOTICE.md. No Paizo adventure text, artwork or stat blocks are distributed.

### 6. Submit and wait

A human reviews it: the manifest fetches, the id is free and well-formed, the
licence is declared, the description matches the code. Typically a few days.

If it comes back with changes, fix them, cut a new release (below), and reply —
the manifest URL does not change, so they will fetch the corrected version from
the same place.

---

## Cutting a release

Three steps. Do them in this order.

```bash
# 1. Bump the version in module.json (and package.json, to keep them in step)
#    Semantic: patch for fixes, minor for features, major for breaks.

# 2. Commit it
git add module.json package.json CHANGELOG.md
git commit -m "Release 1.0.1"
git push

# 3. Tag it. The tag must match module.json exactly, prefixed with v.
git tag -a v1.0.1 -m "Matadragones Subsystems 1.0.1"
git push origin v1.0.1
```

Pushing the tag runs `.github/workflows/release.yml`, which:

1. installs the test dependencies with `npm ci`,
2. runs the whole suite, and fails the release if anything fails,
3. **refuses to publish if the tag and `module.json` version disagree**, so a
   forgotten bump fails loudly instead of shipping an update Foundry will
   silently decline to offer,
4. zips only what Foundry loads — no tests, no working notes, no local Foundry
   install,
5. publishes `module.json` and `module.zip` to the release.

Nothing else is needed. Foundry notices new versions by re-fetching the
manifest URL, which always points at `releases/latest`.

### Watch it

```bash
gh run list --limit 3
gh run view --log-failed          # if it failed
gh release view v1.0.1
```

### Check the URLs still resolve

```bash
curl -sL -o /dev/null -w "%{http_code}\n" \
  https://github.com/DavidMora/pf2e-alternative-system-ai-generator/releases/latest/download/module.json
curl -sL -o /dev/null -w "%{http_code}\n" \
  https://github.com/DavidMora/pf2e-alternative-system-ai-generator/releases/latest/download/module.zip
```

Both must be `200`.

---

## Compatibility, honestly

`compatibility.verified` in `module.json` is a claim that the module was run on
that build. Only raise it after actually running there.

The two local installs are gitignored:

```bash
node .local/app/main.js   --dataPath=.local/data   --port=30000 --noupnp  # v13
node .local/app14/main.js --dataPath=.local/data14 --port=30001 --noupnp  # v14
```

A worthwhile check on a new Foundry build, in order of what has historically
broken: the module activates at all; every subsystem's detail view renders; a
blank event can be created; drag-and-drop puts an actor on a roster; and
`actor.getStatistic(slug).roll({dc})` still returns a `CheckRoll` carrying an
integer `degreeOfSuccess`. Watch the console for deprecation warnings — those
are what break in the *next* major, not this one.

---

## Things that will bite

**The id cannot change.** Not after approval, not ever. If you ever want a
different name, that is a new package and a new listing, and users migrate by
hand.

**The version must increase.** Foundry compares versions to decide whether to
offer an update. Republishing the same version does nothing for anyone who
already installed it.

**`latest` must always be the newest.** Do not mark a release as a pre-release
or draft unless you mean it — `releases/latest` skips both, and the manifest
URL would go on serving the older version.

**Community Use Policy means this stays free.** No paid tiers, no paywalled
features, no donations tied to access. Donation links unconnected to access are
fine.

**The API key is client-scoped and must stay that way.** `restricted: true`
only stops players *editing* a setting; Foundry's server sends every world
setting to every client that joins. `check-logic.mjs` fails if the scope is
moved back to `world`, which is deliberate — do not "fix" that test.
