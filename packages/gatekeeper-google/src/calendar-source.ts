import {Temporal} from "temporal-polyfill";
import {GoogleCalendarApi, validateCalendarTimeWindow} from "./calendar-api";

/** A read-only source for a single calendar and a single account generation.
 * The generation oracle is account-owned; no OAuth credential leaves this object. */
export class SelectedCalendarReader {
  constructor(private api: GoogleCalendarApi, private calendarId: string,
      private generation: string, private currentGeneration: () => Promise<string>) {
    if (!calendarId || calendarId === "primary" || calendarId.length > 255 ||
        /[\x00\r\n]/.test(calendarId) || !generation) throw new Error("Invalid calendar selection.");
  }
  async validate(): Promise<void> {
    if (await this.currentGeneration() !== this.generation) throw new Error("Calendar connection changed.");
  }
  async metadata() {
    await this.validate();
    const calendar = await this.api.getCalendar(this.calendarId);
    await this.validate();
    if (calendar.id !== this.calendarId || !calendar.timeZone) throw new Error("Selected calendar unavailable.");
    return {provider: "google" as const, calendar_id: calendar.id, title: calendar.summary, time_zone: calendar.timeZone};
  }
  async readWindow(input: {time_min: string; time_max: string; limit: number}) {
    if (!input || Object.keys(input).some(key => !["time_min", "time_max", "limit"].includes(key)) ||
        typeof input.time_min !== "string" || typeof input.time_max !== "string" ||
        !/(?:Z|[+-]\d{2}:\d{2})$/.test(input.time_min) || !/(?:Z|[+-]\d{2}:\d{2})$/.test(input.time_max) ||
        !Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) throw new Error("Invalid calendar window.");
    const timeMin = new Date(Temporal.Instant.from(input.time_min).epochMilliseconds);
    const timeMax = new Date(Temporal.Instant.from(input.time_max).epochMilliseconds);
    validateCalendarTimeWindow(timeMin, timeMax, 366);
    const metadata = await this.metadata();
    const events = await this.api.listEvents(this.calendarId, {timeMin, timeMax, includeDescriptions: true});
    await this.validate();
    const result = {calendar_id: this.calendarId, time_zone: metadata.time_zone,
      events_json: JSON.stringify(events.slice(0, input.limit)), truncated: events.length > input.limit};
    if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 2 * 1024 * 1024) {
      throw new Error("Calendar result is too large; narrow the window.");
    }
    return result;
  }
}
