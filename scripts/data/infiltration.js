/**
 * Infiltration subsystem data models.
 *
 * The most nested of the four: objectives hold obstacles, obstacles hold checks.
 * That mirrors the published structure, where an objective is "get inside" and
 * the obstacles beneath it are the individual problems that stand in the way.
 *
 * Two things behave unlike the other subsystems. A failed check costs no
 * progress but raises awareness, and every round raises it again, so the clock
 * here is the party being noticed rather than time running out.
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

/** A skill approach. Same shape wherever checks appear in this subsystem. */
function checkField() {
  const fields = foundry.data.fields;
  return new fields.TypedObjectField(
    new fields.SchemaField({
      id: new fields.StringField({ required: true }),
      position: new fields.NumberField({ required: true, integer: true, initial: 0 }),
      slug: new fields.StringField({ required: true }),
      label: new fields.StringField({ required: true }),
      dc: new fields.NumberField({ required: true, integer: true, initial: 15 }),
      description: new fields.StringField({ required: true, initial: '' }),
      hidden: new fields.BooleanField({ required: true, initial: false }),
      /** Infiltration points at which this surfaces; null for never. */
      revealAt: new fields.NumberField({ integer: true, nullable: true, initial: null }),
    }),
  );
}

export class Infiltration extends foundry.abstract.DataModel {
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      id: new fields.StringField({ required: true }),
      name: new fields.StringField({ required: true, initial: 'New Infiltration' }),
      position: new fields.NumberField({ required: true, integer: true, initial: 0 }),
      img: new fields.StringField({ required: true, initial: '' }),

      /** GM-written and stored verbatim. */
      premise: new fields.HTMLField({ required: true, initial: '' }),
      /** The place or organisation being infiltrated. */
      target: new fields.HTMLField({ required: true, initial: '' }),
      /** What getting away with it buys them. */
      goal: new fields.HTMLField({ required: true, initial: '' }),
      gmNotes: new fields.HTMLField({ required: true, initial: '' }),

      baseDC: new fields.NumberField({ required: true, integer: true, initial: 15 }),
      level: new fields.NumberField({ required: true, integer: true, initial: 1 }),
      partySize: new fields.NumberField({ required: true, integer: true, initial: 4 }),

      hidden: new fields.BooleanField({ required: true, initial: true }),
      started: new fields.BooleanField({ required: true, initial: false }),

      rounds: new fields.SchemaField({
        current: new fields.NumberField({ required: true, integer: true, initial: 0 }),
        max: new fields.NumberField({ integer: true, nullable: true, initial: null }),
      }),

      /** How close the party is to being caught. */
      awareness: new fields.SchemaField({
        current: new fields.NumberField({ required: true, integer: true, initial: 0 }),
        /**
         * Awareness added at the end of every round. The rules give 1; a GM
         * running a sleepy warehouse might want 0.
         */
        perRound: new fields.NumberField({ required: true, integer: true, initial: 1 }),
      }),

      /** What happens as the place wakes up to them. */
      awarenessBreakpoints: new fields.TypedObjectField(
        new fields.SchemaField({
          id: new fields.StringField({ required: true }),
          position: new fields.NumberField({ required: true, integer: true, initial: 0 }),
          at: new fields.NumberField({ required: true, integer: true, initial: 5 }),
          name: new fields.StringField({ required: true }),
          description: new fields.HTMLField({ required: true, initial: '' }),
          /** Ongoing rise in every infiltration DC once this is passed. */
          dcIncrease: new fields.NumberField({ required: true, integer: true, initial: 0 }),
          hidden: new fields.BooleanField({ required: true, initial: true }),
          fired: new fields.BooleanField({ required: true, initial: false }),
        }),
      ),

      /** Spendable advantages bought by planning ahead. */
      edgePoints: new fields.NumberField({ required: true, integer: true, initial: 0 }),

      /** Downtime activities that earn edge points, at some risk. */
      preparations: new fields.TypedObjectField(
        new fields.SchemaField({
          id: new fields.StringField({ required: true }),
          position: new fields.NumberField({ required: true, integer: true, initial: 0 }),
          name: new fields.StringField({ required: true }),
          description: new fields.HTMLField({ required: true, initial: '' }),
          slug: new fields.StringField({ required: true, initial: 'society' }),
          label: new fields.StringField({ required: true, initial: 'Society' }),
          dc: new fields.NumberField({ required: true, integer: true, initial: 15 }),
          hidden: new fields.BooleanField({ required: true, initial: false }),
          /** Already attempted; the rules allow each once. */
          used: new fields.BooleanField({ required: true, initial: false }),
        }),
      ),

      /** Broad goals, each cleared by getting through its obstacles. */
      objectives: new fields.TypedObjectField(
        new fields.SchemaField({
          id: new fields.StringField({ required: true }),
          position: new fields.NumberField({ required: true, integer: true, initial: 0 }),
          name: new fields.StringField({ required: true, initial: 'New Objective' }),
          description: new fields.HTMLField({ required: true, initial: '' }),
          hidden: new fields.BooleanField({ required: true, initial: false }),
          obstacles: new fields.TypedObjectField(
            new fields.SchemaField({
              id: new fields.StringField({ required: true }),
              position: new fields.NumberField({ required: true, integer: true, initial: 0 }),
              name: new fields.StringField({ required: true, initial: 'New Obstacle' }),
              description: new fields.HTMLField({ required: true, initial: '' }),
              hidden: new fields.BooleanField({ required: true, initial: false }),
              revealAt: new fields.NumberField({ integer: true, nullable: true, initial: null }),
              /** Everyone must clear it themselves, rather than as a group. */
              individual: new fields.BooleanField({ required: true, initial: false }),
              infiltrationPoints: new fields.SchemaField({
                current: new fields.NumberField({ required: true, integer: true, initial: 0 }),
                goal: new fields.NumberField({ required: true, integer: true, initial: 2 }),
              }),
              /** Per-participant progress, for obstacles each must clear alone. */
              individualPoints: new fields.TypedObjectField(
                new fields.NumberField({ required: true, integer: true, initial: 0 }),
              ),
              checks: checkField(),
            }),
          ),
        }),
      ),

      /** Problems that must be dealt with before the party can press on. */
      complications: new fields.TypedObjectField(
        new fields.SchemaField({
          id: new fields.StringField({ required: true }),
          position: new fields.NumberField({ required: true, integer: true, initial: 0 }),
          name: new fields.StringField({ required: true, initial: 'New Complication' }),
          description: new fields.HTMLField({ required: true, initial: '' }),
          hidden: new fields.BooleanField({ required: true, initial: true }),
          trigger: new fields.SchemaField({
            /** "awareness", "rounds", or "manual" for a GM call. */
            kind: new fields.StringField({ required: true, initial: 'awareness' }),
            at: new fields.NumberField({ required: true, integer: true, initial: 5 }),
          }),
          fired: new fields.BooleanField({ required: true, initial: false }),
          resolved: new fields.BooleanField({ required: true, initial: false }),
          checks: checkField(),
        }),
      ),

      /** Optional risks that pay off in something other than progress. */
      opportunities: new fields.TypedObjectField(
        new fields.SchemaField({
          id: new fields.StringField({ required: true }),
          position: new fields.NumberField({ required: true, integer: true, initial: 0 }),
          name: new fields.StringField({ required: true, initial: 'New Opportunity' }),
          description: new fields.HTMLField({ required: true, initial: '' }),
          /** What taking it earns, in the GM's words. */
          benefit: new fields.HTMLField({ required: true, initial: '' }),
          hidden: new fields.BooleanField({ required: true, initial: true }),
          used: new fields.BooleanField({ required: true, initial: false }),
          checks: checkField(),
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
            /** Awareness this character drew, which is worth seeing. */
            awarenessCaused: new fields.NumberField({ required: true, integer: true, initial: 0 }),
          }),
        }),
      ),

      ai: aiProvenanceField(),
    };
  }

  /** Rise in every infiltration DC from breakpoints already passed. */
  get dcModifier() {
    return Object.values(this.awarenessBreakpoints).reduce(
      (acc, breakpoint) => (breakpoint.fired ? Math.max(acc, breakpoint.dcIncrease) : acc),
      0,
    );
  }

  get sortedBreakpoints() {
    return Object.values(this.awarenessBreakpoints).sort((a, b) => a.at - b.at);
  }

  get nextBreakpoint() {
    return this.sortedBreakpoints.find((b) => this.awareness.current < b.at) ?? null;
  }

  /** Complications blocking further progress until dealt with. */
  get blockingComplications() {
    return Object.values(this.complications).filter((c) => c.fired && !c.resolved);
  }

  get isComplete() {
    const obstacles = Object.values(this.objectives).flatMap((o) => Object.values(o.obstacles));
    return (
      obstacles.length > 0 &&
      obstacles.every((o) => o.infiltrationPoints.current >= o.infiltrationPoints.goal)
    );
  }
}

export class Infiltrations extends foundry.abstract.DataModel {
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      events: new fields.TypedObjectField(new fields.EmbeddedDataField(Infiltration)),
    };
  }
}
