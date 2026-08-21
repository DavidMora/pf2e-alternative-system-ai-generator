/**
 * Leadership subsystem data models.
 *
 * The odd one out. The published subsystem has no point track and no rounds:
 * an organization grows because the party earned it, not because a meter
 * filled. What advances here is the organization's *level*, and what happens
 * are downtime events the GM drops in.
 *
 * The optional checks attached to an event are a light extension, not published
 * rules — a Trouble usually wants a roll to sort out, and having one keeps the
 * roll experience the same as every other subsystem.
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
      revealAt: new fields.NumberField({ integer: true, nullable: true, initial: null }),
    }),
  );
}

export class Leadership extends foundry.abstract.DataModel {
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      id: new fields.StringField({ required: true }),
      name: new fields.StringField({ required: true, initial: 'New Organization' }),
      position: new fields.NumberField({ required: true, integer: true, initial: 0 }),
      img: new fields.StringField({ required: true, initial: '' }),

      /** GM-written, stored verbatim. */
      premise: new fields.HTMLField({ required: true, initial: '' }),
      /** What the organization is and what it is for. */
      organization: new fields.HTMLField({ required: true, initial: '' }),
      /** What the party wants it to become. */
      goal: new fields.HTMLField({ required: true, initial: '' }),
      gmNotes: new fields.HTMLField({ required: true, initial: '' }),

      /** A few words: guild, cult, mercenary company, crew. */
      kind: new fields.StringField({ required: true, initial: '' }),
      /** Where it operates from. */
      seat: new fields.StringField({ required: true, initial: '' }),

      /**
       * 1-20. This is the track: it rises because the party earned it, so it
       * is nudged by the GM rather than accumulated from rolls.
       */
      organizationLevel: new fields.NumberField({ required: true, integer: true, initial: 1 }),

      baseDC: new fields.NumberField({ required: true, integer: true, initial: 15 }),
      level: new fields.NumberField({ required: true, integer: true, initial: 1 }),
      partySize: new fields.NumberField({ required: true, integer: true, initial: 4 }),

      hidden: new fields.BooleanField({ required: true, initial: true }),
      started: new fields.BooleanField({ required: true, initial: false }),

      /** Named subordinates worth remembering. */
      lieutenants: new fields.TypedObjectField(
        new fields.SchemaField({
          id: new fields.StringField({ required: true }),
          position: new fields.NumberField({ required: true, integer: true, initial: 0 }),
          name: new fields.StringField({ required: true }),
          role: new fields.StringField({ required: true, initial: '' }),
          description: new fields.HTMLField({ required: true, initial: '' }),
          level: new fields.NumberField({ required: true, integer: true, initial: 1 }),
          /** Linked actor, when the GM has one. */
          uuid: new fields.StringField({ required: true, initial: '' }),
          img: new fields.StringField({ required: true, initial: '' }),
          hidden: new fields.BooleanField({ required: true, initial: false }),
        }),
      ),

      /** Opportunities, troubles and windfalls waiting to land. */
      events: new fields.TypedObjectField(
        new fields.SchemaField({
          id: new fields.StringField({ required: true }),
          position: new fields.NumberField({ required: true, integer: true, initial: 0 }),
          /** "opportunity", "trouble" or "windfall". */
          kind: new fields.StringField({ required: true, initial: 'opportunity' }),
          name: new fields.StringField({ required: true, initial: 'New Event' }),
          description: new fields.HTMLField({ required: true, initial: '' }),
          /** What choosing well, or fixing it, actually gets them. */
          outcome: new fields.HTMLField({ required: true, initial: '' }),
          hidden: new fields.BooleanField({ required: true, initial: true }),
          resolved: new fields.BooleanField({ required: true, initial: false }),
          /** Organization level at which this becomes relevant; null for any. */
          revealAt: new fields.NumberField({ integer: true, nullable: true, initial: null }),
          checks: checkField(),
        }),
      ),

      /** The PCs running the thing. */
      participants: new fields.TypedObjectField(
        new fields.SchemaField({
          id: new fields.StringField({ required: true }),
          name: new fields.StringField({ required: true }),
          img: new fields.StringField({ required: true, initial: '' }),
          uuid: new fields.StringField({ required: true, initial: '' }),
          hidden: new fields.BooleanField({ required: true, initial: false }),
          hasActed: new fields.BooleanField({ required: true, initial: false }),
          contribution: new fields.SchemaField({
            /** Events this character sorted out. */
            total: new fields.NumberField({ required: true, integer: true, initial: 0 }),
            successes: new fields.NumberField({ required: true, integer: true, initial: 0 }),
            rolls: new fields.NumberField({ required: true, integer: true, initial: 0 }),
          }),
        }),
      ),

      ai: aiProvenanceField(),
    };
  }

  get pendingEvents() {
    return Object.values(this.events).filter((e) => !e.resolved);
  }

  get isComplete() {
    return this.organizationLevel >= 20;
  }
}

export class Leaderships extends foundry.abstract.DataModel {
  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      events: new fields.TypedObjectField(new fields.EmbeddedDataField(Leadership)),
    };
  }
}
