import type {SourceLoadHealth} from './source-health.ts';
/** Public connection receipt; no service credential or bridge handle. */
export interface CalendarConnectionInfo extends SourceLoadHealth {
  connection_id: string;
  project_id: string;
  provider: string;
  calendar_id: string;
  revision: number;
  enabled: boolean;
}
/** Explicit owner decision against the versions currently shown in management. */
export interface CalendarGrantDecision {
  principal_id: string;
  connection_revision: number;
  expected_revision: number;
  enabled: boolean;
}

/** Saved permission configuration; enabled alone does not prove effective access. */
export interface CalendarGrantState {
  connection_id: string;
  principal_id: string;
  connection_revision: number;
  connection_enabled: boolean;
  revision: number;
  enabled: boolean;
}

/** Authorized UTC window; the same limits apply to human and agent reads. */
export interface CalendarEventQuery {time_min:string;time_max:string;limit:number;}
/** Provider event data from the existing Mnemos REST calendar reader. */
export interface CalendarEventWindow {calendar_id:string;time_zone:string;events:Record<string,unknown>[];truncated:boolean;}

/** Owner-only calendar receipts, including disabled connections. */
export interface CalendarConnectionPage {connections:CalendarConnectionInfo[];next_cursor?:string;}
