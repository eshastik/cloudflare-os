/** Authority of a calendar binding, independent of the account's OAuth scope. */
export type CalendarAccessMode = "read" | "manage";

/** Legacy URLs omit access and retain their existing management authority. */
export function calendarAccessMode(value: string | null | undefined): CalendarAccessMode {
  if (value == null) return "manage";
  if (value !== "read" && value !== "manage") throw new Error("Invalid calendar access mode.");
  return value;
}

/** Checked both before queuing writes and before applying/reverting them. */
export function assertCalendarWriteAccess(mode: CalendarAccessMode | undefined): void {
  if (calendarAccessMode(mode) !== "manage") throw new Error("This calendar connection is read-only.");
}
