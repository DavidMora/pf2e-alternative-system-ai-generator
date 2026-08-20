/**
 * Influence subsystem data models.
 *
 * Mirrors the chase models: one world setting holds an id-keyed map of events.
 * One event is one NPC to win over — the published subsystem is built around a
 * stat block per NPC, so a gala with three targets is three events.
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

/** A skill approach, shared shape between discoveries and influence skills. */
function skillEntryField(extra = {}) {
  const fields = foundry.data.fields;
  return new fields.TypedObjectField(
    new fields.SchemaField({
      id: new fields.StringField({ required: true }),
      position: new fields.NumberField({ required: true, integer: true, initial: 0 }),
      /** PF2e statistic slug, e.g. "diplomacy" or "sailing-lore". */
      slug: new fields.StringField({ required: true }),
      label: new fields.StringField({ required: true }),
      dc: new fields.NumberField({ required: true, integer: true, initial: 15 }),
      description: new fields.StringField({ required: true, initial: '' }),
      /** Hidden entries are GM-only until a discovery or progress reveals them. */
      hidden: new fields.BooleanField({ required: true, initial: true }),
      /**
       * Influence points at which this surfaces on its own, letting an
       * encounter open up as it advances. Null means it only appears when a
       * discovery check finds it or the GM reveals it by hand.
       */
      revealAt: new fields.NumberField({ integer: true, nullable: true, initial: null }),
      ...extra,
    }),
  );
}

/** Something the party can learn, adjust, or trip over. Revealed by discovery. */
function revealableField(extra = {}) {
  const fields = foundry.data.fields;
  return new fields.TypedObjectField(
    new fields.SchemaField({
      id: new fields.StringField({ required: true }),
      position: new fields.NumberField({ required: true, integer: true, initial: 0 }),
      name: new fields.StringField({ required: true }),
      description: new fields.HTMLField({ required: true, initial: '' }),
      hidden: new fields.BooleanField({ required: true, initial: true }),
      ...extra,
    }),
  );
}

export class Influence extends foundry.abstract.DataModel {
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      id: new fields.StringField({ required: true }),
      name: new fields.StringField({ required: true, initial: 'New Influence' }),
      position: new fields.NumberField({ required: true, integer: true, initial: 0 }),
      img: new fields.StringField({ required: true, initial: '' }),

      /** GM-written setup, stored verbatim and never model-authored. */
      premise: new fields.HTMLField({ required: true, initial: '' }),
      gmNotes: new fields.HTMLField({ required: true, initial: '' }),

      /** The NPC being won over. The subsystem is a stat block per person. */
      npc: new fields.SchemaField({
        name: new fields.StringField({ required: true, initial: '' }),
        /** Who they are, as the GM described them. Kept verbatim. */
        description: new fields.HTMLField({ required: true, initial: '' }),
        /** What the model inferred about how to reach them. */
        wants: new fields.HTMLField({ required: true, initial: '' }),
        disposition: new fields.StringField({ required: true, initial: '' }),
        uuid: new fields.StringField({ required: true, initial: '' }),
      }),

      /** What the party is trying to get out of them. */
      goal: new fields.HTMLField({ required: true, initial: '' }),

      /** GM-owned DC anchor; every entry is this plus an adjustment. */
      baseDC: new fields.NumberField({ required: true, integer: true, initial: 15 }),
      level: new fields.NumberField({ required: true, integer: true, initial: 1 }),
      partySize: new fields.NumberField({ required: true, integer: true, initial: 4 }),

      /** Published stat block also lists these two. */
      perception: new fields.NumberField({ required: true, integer: true, initial: 0 }),
      will: new fields.NumberField({ required: true, integer: true, initial: 0 }),

      hidden: new fields.BooleanField({ required: true, initial: true }),
      started: new fields.BooleanField({ required: true, initial: false }),

      /** Points accumulated so far. Unlike chases this is one running total. */
      influencePoints: new fields.NumberField({ required: true, integer: true, initial: 0 }),

      /** Social rounds, each typically 15 minutes to an hour of table fiction. */
      rounds: new fields.SchemaField({
        current: new fields.NumberField({ required: true, integer: true, initial: 0 }),
        max: new fields.NumberField({ integer: true, nullable: true, initial: null }),
      }),

      /** Checks that reveal information rather than earning points. */
      discoveries: skillEntryField({
        // What a success actually tells the party.
        reveals: new foundry.data.fields.HTMLField({ required: true, initial: '' }),
      }),

      /** Checks that earn influence points. */
      influenceSkills: skillEntryField(),

      /** Point totals that buy a concession, in ascending order. */
      thresholds: new fields.TypedObjectField(
        new fields.SchemaField({
          id: new fields.StringField({ required: true }),
          position: new fields.NumberField({ required: true, integer: true, initial: 0 }),
          points: new fields.NumberField({ required: true, integer: true, initial: 1 }),
          name: new fields.StringField({ required: true }),
          description: new fields.HTMLField({ required: true, initial: '' }),
          hidden: new fields.BooleanField({ required: true, initial: true }),
        }),
      ),

      /** Published modifiers: weaknesses ease DCs, resistances and penalties raise them. */
      weaknesses: revealableField({
        modifier: new foundry.data.fields.NumberField({ required: true, integer: true, initial: -2 }),
        used: new foundry.data.fields.BooleanField({ required: true, initial: false }),
      }),
      resistances: revealableField({
        modifier: new foundry.data.fields.NumberField({ required: true, integer: true, initial: 2 }),
        used: new foundry.data.fields.BooleanField({ required: true, initial: false }),
      }),
      penalties: revealableField({
        modifier: new foundry.data.fields.NumberField({ required: true, integer: true, initial: 2 }),
        used: new foundry.data.fields.BooleanField({ required: true, initial: false }),
      }),

      /** Who is doing the influencing, and what each has contributed. */
      participants: new fields.TypedObjectField(
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
            discoveries: new fields.NumberField({ required: true, integer: true, initial: 0 }),
          }),
        }),
      ),

      ai: aiProvenanceField(),
    };
  }

  /** Active modifier to influence DCs from revealed weaknesses and resistances. */
  get dcModifier() {
    const sum = (record) =>
      Object.values(record).reduce((acc, entry) => acc + (entry.used ? entry.modifier : 0), 0);
    return sum(this.weaknesses) + sum(this.resistances) + sum(this.penalties);
  }

  get sortedThresholds() {
    return Object.values(this.thresholds).sort((a, b) => a.points - b.points);
  }

  /** Thresholds already bought by the points on the table. */
  get reachedThresholds() {
    return this.sortedThresholds.filter((t) => this.influencePoints >= t.points);
  }

  get nextThreshold() {
    return this.sortedThresholds.find((t) => this.influencePoints < t.points) ?? null;
  }

  get isComplete() {
    const all = this.sortedThresholds;
    return all.length > 0 && this.influencePoints >= all[all.length - 1].points;
  }

  get isOutOfTime() {
    return this.rounds.max !== null && this.rounds.current >= this.rounds.max;
  }
}

export class Influences extends foundry.abstract.DataModel {
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      events: new fields.TypedObjectField(new fields.EmbeddedDataField(Influence)),
    };
  }
}
