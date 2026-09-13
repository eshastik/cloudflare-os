import type { ActivityWindows } from "./mnemos-api.ts";
const record = (v: unknown): v is Record<string,unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const count = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v)>=0;

/** Reject inconsistent period coverage rather than presenting a misleading trend. */
export function validActivityWindows(value: unknown): value is ActivityWindows {
  if (!record(value) || typeof value.first_observed_at!=="string" || typeof value.observed_at!=="string" || !Number.isFinite(Date.parse(value.first_observed_at)) || !Number.isFinite(Date.parse(value.observed_at)) || Date.parse(value.first_observed_at)>Date.parse(value.observed_at) || !Array.isArray(value.windows) || value.windows.length!==3) return false;
  let reporting=0,active=0;
  for (let i=0;i<3;i++) {
    const period=value.windows[i];
    if (!record(period) || period.days!==[1,7,30][i] || !count(period.reporting_users) || !count(period.active_users) || period.active_users>period.reporting_users || period.reporting_users<reporting || period.active_users<active) return false;
    reporting=period.reporting_users;active=period.active_users;
  }
  return true;
}
