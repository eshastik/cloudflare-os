import type { ServiceOperation } from "../src/mnemos-api.ts";

/** Bound a nearest-rank percentile from cumulative buckets, without interpolating. */
export function histogramPercentileBound(operation: ServiceOperation, percentile: 50 | 95 | 99): string {
  if (!operation.requests) return "нет измерений";
  const rank = Math.ceil(operation.requests * percentile / 100);
  const bucket = operation.buckets.find(candidate => candidate.count >= rank);
  if (!bucket) return "неизвестно";
  if (bucket.upper_seconds !== null) return `не более ${bucket.upper_seconds * 1000} мс`;
  const finite = operation.buckets.filter(candidate => candidate.upper_seconds !== null).at(-1);
  return finite ? `выше ${finite.upper_seconds! * 1000} мс` : "неизвестно";
}
