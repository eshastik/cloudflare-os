export type ConfiguratorOption = {
  value: string;
  title: string;
  subtitle?: string;
  meta?: string;
}

export type { CalendarAvailabilityMode, CalendarAccessMode } from "../calendar-types";

export type CalendarConfiguratorValues = {
  accessMode?: import("../calendar-types").CalendarAccessMode | null;
  calendarId?: string | null;
  availabilityMode?: CalendarAvailabilityMode | null;
}

export interface CalendarConfiguratorRpc {
  listCalendars(query: string): Promise<ConfiguratorOption[]>;
}
