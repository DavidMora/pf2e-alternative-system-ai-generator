/**
 * Chase subsystem data models.
 *
 * Everything a GM runs lives in a single world setting (`chases`), which is a
 * `Chases` model wrapping an id-keyed map of `Chase` entries. Adding another
 * subsystem later means another model + another setting in the same shape.
 */

/** Provenance for anything the generator produced, so a GM can see its origin. */
function aiProvenanceField() {
  const fields = foundry.data.fields;
  return new fields.SchemaField({
    generated: new fields.BooleanField({ required: true, initial: false }),
    model: new fields.StringField({ required: true, initial: '' }),
    prompt: new fields.StringField({ required: true, initial: '' }),
    generatedAt: new fields.NumberField({ required: true, initial: 0 }),
  });
}

export class Chase extends foundry.abstract.DataModel {
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      id: new fields.StringField({ required: true }),
      name: new fields.StringField({ required: true, initial: 'New Chase' }),
      position: new fields.NumberField({ required: true, integer: true, initial: 0 }),
      img: new fields.StringField({ required: true, initial: '' }),

      /** Player-facing setup text, enriched before display. */
      premise: new fields.HTMLField({ required: true, initial: '' }),
      /** GM-only text; never sent to non-GM clients' rendered output. */
      gmNotes: new fields.HTMLField({ required: true, initial: '' }),

      /**
       * The GM-owned DC anchor. Every generated skill option is this value plus
       * the adjustment the model picked, so regenerating obstacles later keeps
       * the same difficulty footing.
       */
      baseDC: new fields.NumberField({ required: true, integer: true, initial: 15 }),

      /** Party level when the chase was made; context for the model, not maths. */
      level: new fields.NumberField({ required: true, integer: true, initial: 1 }),

      /** Party size the chase point goals were sized against. */
      partySize: new fields.NumberField({ required: true, integer: true, initial: 4 }),

      /** Hidden chases are invisible to players entirely. */
      hidden: new fields.BooleanField({ required: true, initial: true }),
      started: new fields.BooleanField({ required: true, initial: false }),

      /**
       * Obstacle the party is currently facing. Empty means "derive it" (the
       * first uncleared obstacle), which is the sensible default until a GM
       * deliberately pins one.
       */
      activeObstacle: new fields.StringField({ required: true, initial: '' }),

      rounds: new fields.SchemaField({
        current: new fields.NumberField({ required: true, integer: true, initial: 0 }),
        /** null = untimed chase. */
        max: new fields.NumberField({ integer: true, nullable: true, initial: null }),
      }),

      obstacles: new fields.TypedObjectField(
        new fields.SchemaField({
          id: new fields.StringField({ required: true }),
          position: new fields.NumberField({ required: true, integer: true, initial: 0 }),
          name: new fields.StringField({ required: true, initial: 'New Obstacle' }),
          img: new fields.StringField({ required: true, initial: '' }),
          /**
           * Branch label for a fork in the route. Obstacles sharing a position
           * with different labels are alternatives - 2A and 2B - and a
           * participant faces the one matching their own branch. Empty means
           * the step has no fork.
           */
          branch: new fields.StringField({ required: true, initial: '' }),
          /** Locked obstacles are not yet revealed to players. */
          locked: new fields.BooleanField({ required: true, initial: true }),
          chasePoints: new fields.SchemaField({
            goal: new fields.NumberField({ required: true, integer: true, initial: 2 }),
            current: new fields.NumberField({ required: true, integer: true, initial: 0 }),
          }),
          /** Rounds the party may spend here before the GM calls it. */
          rounds: new fields.SchemaField({
            current: new fields.NumberField({ required: true, integer: true, initial: 0 }),
            max: new fields.NumberField({ integer: true, nullable: true, initial: null }),
          }),
          /**
           * Structured skill options, kept alongside the rendered `overcome`
           * HTML so the module can offer real roll buttons rather than relying
           * on players clicking enriched inline checks it cannot observe.
           */
          skillOptions: new fields.TypedObjectField(
            new fields.SchemaField({
              id: new fields.StringField({ required: true }),
              position: new fields.NumberField({ required: true, integer: true, initial: 0 }),
              /** PF2e statistic slug, e.g. "athletics" or "sailing-lore". */
              slug: new fields.StringField({ required: true }),
              label: new fields.StringField({ required: true }),
              dc: new fields.NumberField({ required: true, integer: true, initial: 15 }),
              description: new fields.StringField({ required: true, initial: '' }),
              /**
               * Branch this approach commits you to. Succeeding with it moves
               * the participant onto that route for the following step, which
               * is how a fork is chosen by how you tackle the obstacle rather
               * than by GM fiat.
               */
              leadsTo: new fields.StringField({ required: true, initial: '' }),
            }),
          ),
          /** HTML built from the generated skill options; GM-editable after. */
          overcome: new fields.HTMLField({ required: true, initial: '' }),
        }),
      ),

      participants: new fields.TypedObjectField(
        new fields.SchemaField({
          id: new fields.StringField({ required: true }),
          name: new fields.StringField({ required: true }),
          img: new fields.StringField({ required: true, initial: '' }),
          uuid: new fields.StringField({ required: true, initial: '' }),
          player: new fields.BooleanField({ required: true, initial: false }),
          hidden: new fields.BooleanField({ required: true, initial: false }),
          hasActed: new fields.BooleanField({ required: true, initial: false }),
          /** 1-based index of the obstacle this participant is currently facing. */
          obstacle: new fields.NumberField({ required: true, integer: true, initial: 1 }),

          /** Which fork this participant took; empty follows the unbranched route. */
          branch: new fields.StringField({ required: true, initial: '' }),

          /**
           * Running tally of what this participant has put into the chase.
           * Visible to everyone, so the table can see who is carrying it.
           */
          contribution: new fields.SchemaField({
            /** Chase points contributed across the whole chase. */
            total: new fields.NumberField({ required: true, integer: true, initial: 0 }),
            /** Chase points contributed, keyed by obstacle id. */
            byObstacle: new fields.TypedObjectField(
              new fields.NumberField({ required: true, integer: true, initial: 0 }),
            ),
            /** Rolls that came up success or critical success. */
            successes: new fields.NumberField({ required: true, integer: true, initial: 0 }),
            /** Every roll made, so a hit rate can be shown. */
            rolls: new fields.NumberField({ required: true, integer: true, initial: 0 }),
          }),
        }),
      ),

      ai: aiProvenanceField(),
    };
  }

  /** Obstacles in play order. */
  get sortedObstacles() {
    return Object.values(this.obstacles).sort((a, b) => a.position - b.position);
  }

  get sortedParticipants() {
    return Object.values(this.participants).sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Highest obstacle number the party has unlocked, 0 when none are revealed. */
  get maxUnlockedObstacle() {
    return this.sortedObstacles.reduce(
      (acc, obstacle) => (!obstacle.locked && obstacle.position > acc ? obstacle.position : acc),
      0,
    );
  }

  get isComplete() {
    const obstacles = this.sortedObstacles;
    return (
      obstacles.length > 0 &&
      obstacles.every((o) => o.chasePoints.current >= o.chasePoints.goal)
    );
  }

  /** True once a round-limited chase has run out of rounds. */
  get isOutOfTime() {
    return this.rounds.max !== null && this.rounds.current >= this.rounds.max;
  }
}

export class Chases extends foundry.abstract.DataModel {
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      events: new fields.TypedObjectField(new fields.EmbeddedDataField(Chase)),
    };
  }
}
