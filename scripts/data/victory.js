/**
 * Victory Points data models.
 *
 * The generic subsystem the other five are specialisations of. Chases, Influence,
 * Research and Infiltration are all Victory Point structures with their own
 * vocabulary bolted on; this tab is the toolkit underneath, for the table where
 * the GM wants a points race the published structures do not cover — holding a
 * bridge, arguing a case before a magistrate, keeping a ritual stable.
 *
 * Two things make it different from the others and both come from the rules.
 *
 * `structure` picks which published degree table applies. Accumulating rolls
 * climb from zero to the endpoint. Diminishing rolls start AT the endpoint and
 * fall, because the party is defending something rather than earning it, and
 * reaching zero is a negative event rather than merely not winning yet.
 *
 * `award` on a check exists because the rules say to give more points for
 * exploiting a weakness the party worked out. Zero means "use the structure's
 * table"; anything else overrides it on a success.
 */

function aiProvenanceField() {
  const fields = foundry.data.fields;
  return new fields.SchemaField({
    generated: new fields.BooleanField({ required: true, initial: false }),
    model: new fields.StringField({ required: true, initial: '' }),
    prompt: new fields.StringField({ required: true, initial: '' }),
    generatedAt: new fields.NumberField({ required: true, initial: 0 }),
  });
}

/** A way to earn points. Same shape as every other subsystem's check. */
function checkField() {
  const fields = foundry.data.fields;
  return new fields.TypedObjectField(
    new fields.SchemaField({
      id: new fields.StringField({ required: true }),
      position: new fields.NumberField({ required: true, integer: true, initial: 0 }),
      /** PF2e statistic slug: a skill, "perception", a lore, or a save. */
      slug: new fields.StringField({ required: true }),
      label: new fields.StringField({ required: true }),
      dc: new fields.NumberField({ required: true, integer: true, initial: 15 }),
      description: new fields.StringField({ required: true, initial: '' }),
      /**
       * Points on a success, overriding the structure's table. Zero means use
       * the table; the rules call for paying more where the party has found a
       * weakness worth exploiting.
       */
      award: new fields.NumberField({ required: true, integer: true, initial: 0 }),
      hidden: new fields.BooleanField({ required: true, initial: false }),
      /** Point total at which this surfaces on its own; null for never. */
      revealAt: new fields.NumberField({ integer: true, nullable: true, initial: null }),
    }),
  );
}

/** Something the party gets partway, so a long race keeps paying out. */
function thresholdField() {
  const fields = foundry.data.fields;
  return new fields.TypedObjectField(
    new fields.SchemaField({
      id: new fields.StringField({ required: true }),
      position: new fields.NumberField({ required: true, integer: true, initial: 0 }),
      points: new fields.NumberField({ required: true, integer: true, initial: 1 }),
      name: new fields.StringField({ required: true, initial: '' }),
      description: new fields.HTMLField({ required: true, initial: '' }),
      hidden: new fields.BooleanField({ required: true, initial: true }),
    }),
  );
}

/** A twist that fires at a point total or after so many rounds. */
function eventField() {
  const fields = foundry.data.fields;
  return new fields.TypedObjectField(
    new fields.SchemaField({
      id: new fields.StringField({ required: true }),
      position: new fields.NumberField({ required: true, integer: true, initial: 0 }),
      name: new fields.StringField({ required: true, initial: '' }),
      description: new fields.HTMLField({ required: true, initial: '' }),
      trigger: new fields.SchemaField({
        kind: new fields.StringField({ required: true, initial: 'points' }),
        at: new fields.NumberField({ required: true, integer: true, initial: 0 }),
      }),
      fired: new fields.BooleanField({ required: true, initial: false }),
      hidden: new fields.BooleanField({ required: true, initial: true }),
    }),
  );
}

function participantField() {
  const fields = foundry.data.fields;
  return new fields.TypedObjectField(
    new fields.SchemaField({
      id: new fields.StringField({ required: true }),
      name: new fields.StringField({ required: true }),
      img: new fields.StringField({ required: true, initial: '' }),
      uuid: new fields.StringField({ required: true, initial: '' }),
      hidden: new fields.BooleanField({ required: true, initial: false }),
      hasActed: new fields.BooleanField({ required: true, initial: false }),
      contribution: new fields.SchemaField({
        total: new fields.NumberField({ required: true, integer: true, initial: 0 }),
        successes: new fields.NumberField({ required: true, integer: true, initial: 0 }),
        rolls: new fields.NumberField({ required: true, integer: true, initial: 0 }),
      }),
    }),
  );
}

export class Victory extends foundry.abstract.DataModel {
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      id: new fields.StringField({ required: true }),
      name: new fields.StringField({ required: true, initial: 'New Victory Points' }),
      position: new fields.NumberField({ required: true, integer: true, initial: 0 }),
      img: new fields.StringField({ required: true, initial: '' }),

      /** GM-written and stored verbatim, never model-authored. */
      premise: new fields.HTMLField({ required: true, initial: '' }),
      /** What the party is actually trying to do. */
      objective: new fields.HTMLField({ required: true, initial: '' }),
      /** What reaching the endpoint buys them. */
      goal: new fields.HTMLField({ required: true, initial: '' }),
      /** What happens if they run out — the diminishing case needs this. */
      failure: new fields.HTMLField({ required: true, initial: '' }),
      gmNotes: new fields.HTMLField({ required: true, initial: '' }),

      baseDC: new fields.NumberField({ required: true, integer: true, initial: 15 }),
      level: new fields.NumberField({ required: true, integer: true, initial: 1 }),
      partySize: new fields.NumberField({ required: true, integer: true, initial: 4 }),

      /**
       * Whether ground once lost can be regained. The rules make a diminishing
       * critical success worth a point "if regaining ground is possible", and
       * otherwise treat it as a success — which for cracked eggs or a burning
       * building is the usual case.
       */
      recoveryPossible: new fields.BooleanField({ required: true, initial: true }),

      /** 'accumulating' climbs to the endpoint; 'diminishing' falls to zero. */
      structure: new fields.StringField({ required: true, initial: 'accumulating' }),
      /** Which row of the published scale table this was built from. */
      scale: new fields.StringField({ required: true, initial: 'session' }),

      hidden: new fields.BooleanField({ required: true, initial: true }),
      started: new fields.BooleanField({ required: true, initial: false }),

      /**
       * The GM's verdict: '' until they call it, then 'won' or 'lost'.
       *
       * The point total says where the track stands; it does not say how the
       * scene ended. A party can hit the endpoint and still have lost the
       * thing that mattered, or run the clock out defending a bridge and have
       * held it long enough. The module reports the number and offers the
       * call — the GM makes it.
       */
      outcome: new fields.StringField({ required: true, initial: '' }),

      points: new fields.SchemaField({
        current: new fields.NumberField({ required: true, integer: true, initial: 0 }),
        goal: new fields.NumberField({ required: true, integer: true, initial: 20 }),
      }),

      rounds: new fields.SchemaField({
        current: new fields.NumberField({ required: true, integer: true, initial: 0 }),
        max: new fields.NumberField({ integer: true, nullable: true, initial: null }),
        unit: new fields.StringField({ required: true, initial: '' }),
      }),

      checks: checkField(),
      thresholds: thresholdField(),
      events: eventField(),
      participants: participantField(),
      ai: aiProvenanceField(),
    };
  }
}

export class Victories extends foundry.abstract.DataModel {
  static defineSchema() {
    return {
      events: new foundry.data.fields.TypedObjectField(
        new foundry.data.fields.EmbeddedDataField(Victory),
      ),
    };
  }
}
