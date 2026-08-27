# The one test that needs a running Foundry

Everything in `npm test` runs without Foundry. One thing cannot: the player→GM
relay only works if a message crosses the server from one client's socket to
another's, and the two halves live in different processes. `check-registry.mjs`
proves the emitter builds what the predicate demands, and `check-rolls.mjs`
drives the real entry points as a player — but both run in one process, with a
stubbed socket. Neither can tell you the wire works.

This is how to check it by hand. It takes about two minutes.

## Setup

Start Foundry, launch a world with the module active, and make sure it has a
non-GM user. Then authenticate as that user from the shell — this is a second
session, entirely separate from the browser you are GMing in:

```sh
curl -s -c /tmp/pl.cookies -X POST http://localhost:30000/join \
  -H 'Content-Type: application/json' \
  -d '{"action":"join","userid":"<THE PLAYER USER ID>","password":""}'

SESSION=$(awk '$6=="session" {print $7}' /tmp/pl.cookies)
```

Get the user id from the GM's browser console with
`game.users.map(u => [u.name, u.id])`.

## Run it

Note the ids of an event, one of its revealed checks, and a participant, then
emit a roll result as the player would:

```sh
node test/manual/relay-client.mjs "$SESSION" applyVictory '{
  "victoryId":"<EVENT>","participantId":"<PARTICIPANT>","checkId":"<CHECK>",
  "degree":2,"gmId":"<THE ACTIVE GM USER ID>"
}'
```

In the GM's browser, the track should move by exactly one point — a success on
an unawarded check — and the participant should be credited one.

## What to check, and what a pass looks like

Run each of these and confirm the track does **not** move:

| Message | Why it must be refused |
|---|---|
| `gmId` set to a GM who is not connected | Only the designated GM applies, or two GMs double-count |
| `checkId` omitted | A caller that forgets a field must fail loudly, not silently |
| `degree` of `99` | A degree outside 0–3 indexes off the end of the published tables |
| an action of `applyNonsense` | Nothing unrecognised should reach a handler |
| `applyInfluence` without `kind` | Required since 1.1.0; the handler reads it to know where to look |

Then repeat the positive case for `applyInfluence` and `applyResearch`, which
build their payloads in separate functions.

## Afterwards

**Put the world back.** These write real data. Note the before values and
restore them, or run it in a world you do not mind disturbing.

## What this does not prove

Foundry gives a module's socket handler no way to know which client sent a
message, so the payload is trusted as it arrives. A player can emit a critical
success they never rolled. Every Foundry module that relays results works this
way and there is no module-level fix; the GM sees a notification for every
applied result, which is the mitigation available.
