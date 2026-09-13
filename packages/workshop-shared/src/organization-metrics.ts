import type {RpcTarget} from 'capnweb';

/** Verified organization identity and bounded result counters for a human summary. */
export interface OrganizationMetrics {
  /** Trusted Mnemos API origin; scopes tenant identifiers across installations. */
  origin: string;
  /** Tenant identifier returned by the authenticated API, never an account label. */
  tenantId: string;
  /** Human-readable organization name supplied by that API. */
  name: string;
  /** Server observation time for the rolling windows. */
  observedAt: string;
  /** Separate result windows; projects are the union of published and accepted work. */
  periods: OrganizationMetricsPeriod[];
}
/** A rolling window of confirmed work in one organization. */
export interface OrganizationMetricsPeriod {
  /** Window length in days. */
  days: 1 | 7 | 30;
  /** Distinct projects with a publication or first accepted request. */
  completedProjects: number;
  /** Whether this organization has a confirmed result in the window. */
  hasCompletedWork: boolean;
}
/** Human-host capability; each read checks current organization metrics permission. */
export interface OrganizationMetricsReader extends RpcTarget {
  /** Read current counters without returning document data or credentials. */
  read(): Promise<OrganizationMetrics>;
}
