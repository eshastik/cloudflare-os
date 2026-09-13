import {Temporal} from "temporal-polyfill";
import type {
  CalendarAttendee,
  CalendarEvent,
  CalendarEventDraft,
  CalendarEventPatch,
  CalendarListEventsOptions,
  CalendarReminder,
  CalendarSendUpdates,
  CalendarTime,
  GoogleCalendarInfo,
  PersonAvailability,
} from "./calendar-types";
import { AccessTokenProvider, fetchWithAuthRetry } from "./auth-retry";

const CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3";

const MAX_LIST_EVENTS = 2500;

export type GoogleCalendarListOptions = {
  maxResults?: number;
};

// Rank calendars so the ones the user is most likely to pick appear first
const CALENDAR_ACCESS_ROLE_RANK: Record<string, number> = {
  owner: 0,
  writer: 1,
  reader: 2,
  freeBusyReader: 3,
  none: 4,
};

export function calendarPickerRank(calendar: GoogleCalendarInfo): number {
  if (calendar.primary) return -1;
  return CALENDAR_ACCESS_ROLE_RANK[calendar.accessRole ?? ""] ?? 5;
}

type GoogleCalendarTime = {
  date?: string;
  dateTime?: string;
  timeZone?: string;
};

type GoogleCalendarEvent = {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: GoogleCalendarTime;
  end?: GoogleCalendarTime;
  status?: "confirmed" | "tentative" | "cancelled";
  attendees?: CalendarAttendee[];
  reminders?: { useDefault: boolean; overrides?: CalendarReminder[] };
  htmlLink?: string;
  transparency?: "opaque" | "transparent";
  visibility?: "default" | "public" | "private" | "confidential";
  recurringEventId?: string;
};

export function encodeCalendarId(calendarId: string): string {
  return encodeURIComponent(calendarId);
}

function calendarTimeFromGoogle(value: GoogleCalendarTime | undefined): CalendarTime {
  if (!value || (value.date !== undefined && value.dateTime !== undefined)) {
    throw new Error("Google Calendar returned missing or ambiguous event time.");
  }
  if (typeof value.date === "string") {
    const parsed = new Date(value.date + "T00:00:00Z");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value.date) || !Number.isFinite(parsed.valueOf()) ||
        parsed.toISOString().slice(0, 10) !== value.date) {
      throw new Error("Google Calendar returned an invalid event date.");
    }
    return { kind: "date", date: value.date };
  }
  if (typeof value.dateTime === "string") {
    let milliseconds: number;
    if (/(?:Z|[+-]\d{2}:\d{2})$/i.test(value.dateTime)) {
      milliseconds = Temporal.Instant.from(value.dateTime).epochMilliseconds;
    } else {
      if (!value.timeZone) throw new Error("Google Calendar event time requires a time zone.");
      // Do not choose one occurrence silently when a wall time is ambiguous or
      // nonexistent at a DST transition.
      milliseconds = Temporal.PlainDateTime.from(value.dateTime)
          .toZonedDateTime(value.timeZone, {disambiguation: "reject"}).epochMilliseconds;
    }
    const parsed = new Date(milliseconds);
    return { kind: "dateTime", dateTime: parsed, timeZone: value.timeZone };
  }
  throw new Error("Google Calendar returned missing event time.");
}

function calendarTimeToGoogle(value: CalendarTime): GoogleCalendarTime {
  if (value.kind === "date") return { date: value.date };
  return {
    dateTime: value.dateTime.toISOString(),
    ...(value.timeZone ? { timeZone: value.timeZone } : {}),
  };
}

export function calendarEventFromGoogle(
  event: GoogleCalendarEvent,
  opts?: { includeDescriptions?: boolean; pending?: boolean },
): CalendarEvent {
  // Deleted events can contain only an ID and cannot be edited as live events.
  if (event.status === "cancelled") throw new Error("Google Calendar event is cancelled.");
  return {
    id: event.id,
    title: event.summary ?? "(no title)",
    start: calendarTimeFromGoogle(event.start),
    end: calendarTimeFromGoogle(event.end),
    status: event.status ?? "confirmed",
    ...(event.location ? { location: event.location } : {}),
    ...(opts?.includeDescriptions && event.description ? { description: event.description } : {}),
    ...(event.attendees ? { attendees: event.attendees } : {}),
    ...(event.htmlLink ? { htmlLink: event.htmlLink } : {}),
    ...(event.transparency ? { transparency: event.transparency } : {}),
    ...(event.visibility ? { visibility: event.visibility } : {}),
    ...(event.recurringEventId ? { recurringEventId: event.recurringEventId } : {}),
    ...(opts?.pending ? { pending: true } : {}),
  };
}

export function googleEventFromDraft(event: CalendarEventDraft): Partial<GoogleCalendarEvent> & {
  start: GoogleCalendarTime;
  end: GoogleCalendarTime;
} {
  return {
    summary: event.title,
    start: calendarTimeToGoogle(event.start),
    end: calendarTimeToGoogle(event.end),
    ...(event.description ? { description: event.description } : {}),
    ...(event.location ? { location: event.location } : {}),
    ...(event.attendees ? { attendees: event.attendees } : {}),
    ...(event.transparency ? { transparency: event.transparency } : {}),
    ...(event.visibility ? { visibility: event.visibility } : {}),
    ...(event.reminders ? {
      reminders: { useDefault: false, overrides: event.reminders },
    } : {}),
  };
}

// Build a Google Calendar PATCH body from a partial patch. Only fields present in the patch are
// included, so omitted fields are left unchanged by the API.
export function eventPatchToGoogle(patch: CalendarEventPatch): Partial<GoogleCalendarEvent> {
  let body: Partial<GoogleCalendarEvent> = {};
  if (patch.title !== undefined) body.summary = patch.title;
  if (patch.start !== undefined) body.start = calendarTimeToGoogle(patch.start);
  if (patch.end !== undefined) body.end = calendarTimeToGoogle(patch.end);
  if (patch.description !== undefined) body.description = patch.description;
  if (patch.location !== undefined) body.location = patch.location;
  if (patch.attendees !== undefined) body.attendees = patch.attendees;
  if (patch.transparency !== undefined) body.transparency = patch.transparency;
  if (patch.visibility !== undefined) body.visibility = patch.visibility;
  return body;
}

function eventTimeMillis(value: CalendarTime, timeZone: string, cache: Map<string, number>): number {
  if (value.kind === "dateTime") return value.dateTime.valueOf();
  const key = timeZone + ":" + value.date;
  const existing = cache.get(key);
  if (existing !== undefined) return existing;
  calendarTimeFromGoogle({date: value.date});
  // Omitting plainTime asks Temporal for the start of the day, including days
  // whose first valid instant is after 00:00 because of a timezone transition.
  const low = Temporal.PlainDate.from(value.date).toZonedDateTime(timeZone).epochMilliseconds;
  cache.set(key, low);
  return low;
}

export function calendarEventOverlaps(event: CalendarEvent, timeMin: Date, timeMax: Date,
    timeZone: string, cache = new Map<string, number>()): boolean {
  return eventTimeMillis(event.end, timeZone, cache) > timeMin.valueOf() &&
      eventTimeMillis(event.start, timeZone, cache) < timeMax.valueOf();
}

export function calendarEventSortKey(event: CalendarEvent, timeZone: string,
    cache = new Map<string, number>()): number {
  return eventTimeMillis(event.start, timeZone, cache);
}

export function validateCalendarTimeWindow(timeMin: Date, timeMax: Date, maxDays: number) {
  if (!(timeMin instanceof Date) || Number.isNaN(timeMin.valueOf())) {
    throw new Error("timeMin must be a valid Date.");
  }
  if (!(timeMax instanceof Date) || Number.isNaN(timeMax.valueOf())) {
    throw new Error("timeMax must be a valid Date.");
  }
  if (timeMax.valueOf() <= timeMin.valueOf()) {
    throw new Error("timeMax must be after timeMin.");
  }
  let days = (timeMax.valueOf() - timeMin.valueOf()) / (24 * 60 * 60 * 1000);
  if (days > maxDays) {
    throw new Error(`Time window is too large; maximum is ${maxDays} days.`);
  }
}

export class GoogleCalendarApi {
  constructor(private getAccessToken: AccessTokenProvider) {}

  async #fetch<T>(path: string, init?: RequestInit): Promise<T> {
    // Built from the caller's headers so anything they set wins; these are only defaults. Note a
    // plain `{...init?.headers}` would silently drop everything if a caller passed a Headers.
    let headers = new Headers(init?.headers);
    if (!headers.has("Accept")) headers.set("Accept", "application/json");
    if (init?.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    let response = await fetchWithAuthRetry(`${CALENDAR_API_BASE}${path}`, {
      ...init,
      headers,
    }, this.getAccessToken);

    if (!response.ok) {
      let text = await response.text();
      throw new Error(`Google Calendar API request failed: ${response.status} ${text}`);
    }

    if (response.status === 204) return undefined as T;
    return await response.json<T>();
  }

  async listCalendars(opts: GoogleCalendarListOptions = {}): Promise<GoogleCalendarInfo[]> {
    let cap = opts.maxResults ?? 250;
    let calendars: GoogleCalendarInfo[] = [];
    let pageToken: string | undefined;

    do {
      let params = new URLSearchParams({
        maxResults: "250",
        // Reading a shared calendar must not require permission to edit it.
        minAccessRole: "reader",
        fields: "items(id,summary,description,timeZone,accessRole,primary),nextPageToken",
      });
      if (pageToken) params.set("pageToken", pageToken);

      let body = await this.#fetch<{items?: GoogleCalendarInfo[]; nextPageToken?: string}>(
        `/users/me/calendarList?${params}`);
      calendars.push(...(body.items ?? []));
      pageToken = body.nextPageToken;
    } while (pageToken && calendars.length < cap);

    return calendars
      .toSorted((a, b) =>
        calendarPickerRank(a) - calendarPickerRank(b) ||
        (a.summary ?? a.id).localeCompare(b.summary ?? b.id))
      .slice(0, cap);
  }

  async getCalendar(calendarId: string): Promise<GoogleCalendarInfo> {
    let cal = await this.#fetch<GoogleCalendarInfo>(
      `/users/me/calendarList/${encodeCalendarId(calendarId)}`,
    );
    return {
      id: cal.id,
      summary: cal.summary ?? cal.id,
      ...(cal.description ? { description: cal.description } : {}),
      ...(cal.timeZone ? { timeZone: cal.timeZone } : {}),
      ...(cal.accessRole ? { accessRole: cal.accessRole } : {}),
      ...(cal.primary ? { primary: cal.primary } : {}),
    };
  }

  // Lists all events in the window, paginating fully.
  async listEvents(calendarId: string, opts: CalendarListEventsOptions): Promise<CalendarEvent[]> {
    let events: CalendarEvent[] = [];
    let scanned = 0;
    const seenTokens = new Set<string>();
    let pageToken: string | undefined;

    do {
      let params = new URLSearchParams({
        timeMin: opts.timeMin.toISOString(),
        timeMax: opts.timeMax.toISOString(),
        singleEvents: "true",
        orderBy: "startTime",
        maxResults: "2500",
      });
      if (pageToken) params.set("pageToken", pageToken);

      let body = await this.#fetch<{items?: GoogleCalendarEvent[]; nextPageToken?: string}>(
        `/calendars/${encodeCalendarId(calendarId)}/events?${params}`);
      let items = body.items ?? [];
      scanned += items.length;
      if (scanned > MAX_LIST_EVENTS) {
        throw new Error(
          "Too many events in the requested window. Narrow timeMin/timeMax and try again.");
      }
      for (let event of items) {
        if (event.status === "cancelled") continue;
        events.push(calendarEventFromGoogle(event, {
          includeDescriptions: opts.includeDescriptions,
        }));
      }
      pageToken = body.nextPageToken;
      if (pageToken) {
        if (seenTokens.has(pageToken)) throw new Error("Google Calendar repeated a page token.");
        seenTokens.add(pageToken);
      }
    } while (pageToken);

    return events;
  }

  async freeBusy(opts: {
    people: string[];
    timeMin: Date;
    timeMax: Date;
    timeZone?: string;
  }): Promise<PersonAvailability[]> {
    let body = await this.#fetch<{
      calendars?: Record<string, { busy?: { start: string; end: string }[]; errors?: {reason?: string; domain?: string}[] }>;
    }>("/freeBusy", {
      method: "POST",
      body: JSON.stringify({
        timeMin: opts.timeMin.toISOString(),
        timeMax: opts.timeMax.toISOString(),
        ...(opts.timeZone ? { timeZone: opts.timeZone } : {}),
        items: opts.people.map(id => ({ id })),
      }),
    });

    let calendars = body.calendars ?? {};
    return opts.people.map(email => {
      let entry = calendars[email];
      let error = entry
          ? entry.errors?.map(item => item.reason ?? item.domain ?? "unknown").join(", ")
          : "notFound";
      return {
        email,
        busy: (entry?.busy ?? []).map(block => ({
          start: new Date(block.start),
          end: new Date(block.end),
        })),
        ...(error ? { error } : {}),
      };
    });
  }

  async hasFreeBusyAccess(calendarId: string): Promise<boolean> {
    let timeMin = new Date();
    let [availability] = await this.freeBusy({
      people: [calendarId],
      timeMin,
      timeMax: new Date(timeMin.valueOf() + 60_000),
    });
    if (!availability || availability.error === "notFound") return false;
    if (availability.error) {
      throw new Error(
        `Google Calendar free/busy access check failed for ${calendarId}: ${availability.error}`);
    }
    return true;
  }

  async createEvent(
    calendarId: string,
    event: CalendarEventDraft,
    sendUpdates: CalendarSendUpdates = "all",
  ): Promise<CalendarEvent> {
    let created = await this.#fetch<GoogleCalendarEvent>(
      `/calendars/${encodeCalendarId(calendarId)}/events?sendUpdates=${encodeURIComponent(sendUpdates)}`,
      { method: "POST", body: JSON.stringify(googleEventFromDraft(event)) },
    );
    return calendarEventFromGoogle(created, { includeDescriptions: true });
  }

  async patchEvent(
    calendarId: string,
    eventId: string,
    patch: Partial<GoogleCalendarEvent>,
    sendUpdates: CalendarSendUpdates = "all",
  ): Promise<CalendarEvent> {
    let updated = await this.#fetch<GoogleCalendarEvent>(
      `/calendars/${encodeCalendarId(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=${encodeURIComponent(sendUpdates)}`,
      { method: "PATCH", body: JSON.stringify(patch) },
    );
    return calendarEventFromGoogle(updated, { includeDescriptions: true });
  }

  async getEvent(calendarId: string, eventId: string): Promise<CalendarEvent> {
    let event = await this.#fetch<GoogleCalendarEvent>(
      `/calendars/${encodeCalendarId(calendarId)}/events/${encodeURIComponent(eventId)}`,
    );
    return calendarEventFromGoogle(event, { includeDescriptions: true });
  }

  async deleteEvent(
    calendarId: string,
    eventId: string,
    sendUpdates: CalendarSendUpdates = "all",
  ): Promise<void> {
    await this.#fetch<void>(
      `/calendars/${encodeCalendarId(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=${encodeURIComponent(sendUpdates)}`,
      { method: "DELETE" },
    );
  }
}
