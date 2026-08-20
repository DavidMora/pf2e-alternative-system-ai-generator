/**
 * Research subsystem data models.
 *
 * Same shape as the other subsystems — one world setting holding an id-keyed
 * map of events — with one structural difference: research checks live inside
 * *sources*. A library caps how much can be learned there, which is what stops
 * a party grinding one shelf forever, so the cap belongs to the source rather
 * than to the checks under it.
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

/** A skill approach within a source. Mirrors the influence entry shape. */
function checkField() {
  const fields = foundry.data.fields;
  return new fields.TypedObjectField(
    new fields.SchemaField({
      id: new fields.StringField({ required: true }),
      position: new fields.NumberField({ required: true, integer: true, initial: 0 }),
      /** PF2e statistic slug, e.g. "society" or "academia-lore". */
      slug: new fields.StringField({ required: true }),
      label: new fields.StringField({ required: true }),
      dc: new fields.NumberField({ required: true, integer: true, initial: 15 }),
      description: new fields.StringField({ required: true, initial: '' }),
      hidden: new fields.BooleanField({ required: true, initial: false }),
      /** Research points at which this surfaces on its own; null for never. */
      revealAt: new fields.NumberField({ integer: true, nullable: true, initial: null }),
    }),
  );
}

export class Research extends foundry.abstract.DataModel {
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      id: new fields.StringField({ required: true }),
      name: new fields.StringField({ required: true, initial: 'New Research' }),
      position: new fields.NumberField({ required: true, integer: true, initial: 0 }),
      img: new fields.StringField({ required: true, initial: '' }),

      /** GM-written and stored verbatim, never model-authored. */
      premise: new fields.HTMLField({ required: true, initial: '' }),
      /** What the party is trying to find out. */
      topic: new fields.HTMLField({ required: true, initial: '' }),
      /** What a full success actually buys them. */
      goal: new fields.HTMLField({ required: true, initial: '' }),
      gmNotes: new fields.HTMLField({ required: true, initial: '' }),

      baseDC: new fields.NumberField({ required: true, integer: true, initial: 15 }),
      level: new fields.NumberField({ required: true, integer: true, initial: 1 }),
      partySize: new fields.NumberField({ required: true, integer: true, initial: 4 }),

      hidden: new fields.BooleanField({ required: true, initial: true }),
      started: new fields.BooleanField({ required: true, initial: false }),

      /** Running total across every source. */
      researchPoints: new fields.NumberField({ required: true, integer: true, initial: 0 }),

      /** Research rounds: ten minutes to a full day each, per the rules. */
      rounds: new fields.SchemaField({
        current: new fields.NumberField({ required: true, integer: true, initial: 0 }),
        max: new fields.NumberField({ integer: true, nullable: true, initial: null }),
        /** Free text: "hour", "day", whatever this table is using. */
        unit: new fields.StringField({ required: true, initial: '' }),
      }),

      /** Libraries, archives, informants — each capped in what it can yield. */
      sources: new fields.TypedObjectField(
        new fields.SchemaField({
          id: new fields.StringField({ required: true }),
          position: new fields.NumberField({ required: true, integer: true, initial: 0 }),
          name: new fields.StringField({ required: true, initial: 'New Source' }),
          description: new fields.HTMLField({ required: true, initial: '' }),
          hidden: new fields.BooleanField({ required: true, initial: false }),
          /** Research points at which this source becomes available. */
          revealAt: new fields.NumberField({ integer: true, nullable: true, initial: null }),
          researchPoints: new fields.SchemaField({
            current: new fields.NumberField({ required: true, integer: true, initial: 0 }),
            /** The cap that stops a party grinding one source forever. */
            max: new fields.NumberField({ required: true, integer: true, initial: 3 }),
          }),
          checks: checkField(),
        }),
      ),

      /** Research point totals that yield what the party is after. */
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

      /**
       * Complications that interrupt the work. The rules fire these either on a
       * point total or after so much time, so the trigger carries both.
       */
      events: new fields.TypedObjectField(
        new fields.SchemaField({
          id: new fields.StringField({ required: true }),
          position: new fields.NumberField({ required: true, integer: true, initial: 0 }),
          name: new fields.StringField({ required: true, initial: 'New Event' }),
          description: new fields.HTMLField({ required: true, initial: '' }),
          hidden: new fields.BooleanField({ required: true, initial: true }),
          trigger: new fields.SchemaField({
            /** "points" or "rounds". */
            kind: new fields.StringField({ required: true, initial: 'points' }),
            at: new fields.NumberField({ required: true, integer: true, initial: 1 }),
          }),
          fired: new fields.BooleanField({ required: true, initial: false }),
          /** An ongoing shift to every research DC while active. */
          modifier: new fields.SchemaField({
            value: new fields.NumberField({ required: true, integer: true, initial: 0 }),
            active: new fields.BooleanField({ required: true, initial: false }),
          }),
        }),
      ),

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
          }),
        }),
      ),

      ai: aiProvenanceField(),
    };
  }

  /** Shift applied to every research DC by events currently in play. */
  get dcModifier() {
    return Object.values(this.events).reduce(
      (acc, event) => acc + (event.modifier.active ? event.modifier.value : 0),
      0,
    );
  }

  get sortedThresholds() {
    return Object.values(this.thresholds).sort((a, b) => a.points - b.points);
  }

  get nextThreshold() {
    return this.sortedThresholds.find((t) => this.researchPoints < t.points) ?? null;
  }

  get isComplete() {
    const all = this.sortedThresholds;
    return all.length > 0 && this.researchPoints >= all[all.length - 1].points;
  }

  get isOutOfTime() {
    return this.rounds.max !== null && this.rounds.current >= this.rounds.max;
  }

  /** Total research points still available across every source. */
  get remainingCapacity() {
    return Object.values(this.sources).reduce(
      (acc, source) => acc + Math.max(0, source.researchPoints.max - source.researchPoints.current),
      0,
    );
  }
}

export class Researches extends foundry.abstract.DataModel {
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      events: new fields.TypedObjectField(new fields.EmbeddedDataField(Research)),
    };
  }
}
