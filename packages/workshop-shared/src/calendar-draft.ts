/** Approved timed meeting content shared by the human screen and provider writer. */
export interface CalendarDraftContent {
    /** Approved meeting title. */
    title:string;
    /** UTC start instant in canonical ISO format. */
    start:string;
    /** UTC end instant in canonical ISO format. */
    end:string;
    /** Approved plain text description. */
    description:string;
    /** Approved meeting location. */
    location:string;
    /** Approved attendee email addresses; empty for a private appointment. */
    attendees:string[];

}

/** Result of attempting one approved meeting creation; invitations may still be in transit. */
export interface CalendarDraftExecution {
  /** Unknown provider outcome or confirmed event creation. */
  state:'attempted'|'created';
  /** Provider event ID, present only after confirmed creation. */
  event_id?:string;
}
