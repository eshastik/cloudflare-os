import type { OrganizationMetrics } from '@gadgets/workshop-shared/organization-metrics'

/** Deduplicate repeated connections by API origin and verified tenant, retaining the newest observation. */
export function summarizeOrganizations(readings: OrganizationMetrics[]) {
  const unique = new Map<string, OrganizationMetrics>()
  for (const reading of readings) {
    const url = new URL(reading.origin)
    if (url.protocol !== 'https:' || url.origin !== reading.origin || !reading.tenantId || !Number.isFinite(Date.parse(reading.observedAt)) || reading.periods.length !== 3) throw Error('Invalid organization summary')
    let previous=0
    for (const [i,p] of reading.periods.entries()) {
      if (p.days!==[1,7,30][i] || !Number.isSafeInteger(p.completedProjects) || p.completedProjects<previous || p.hasCompletedWork!==(p.completedProjects>0)) throw Error('Invalid organization period')
      previous=p.completedProjects
    }
    const key=JSON.stringify([url.origin,reading.tenantId])
    const existing=unique.get(key)
    if (!existing || Date.parse(reading.observedAt)>Date.parse(existing.observedAt)) unique.set(key,reading)
  }
  const organizations=[...unique.values()]
  return {organizations,duplicateConnections:readings.length-organizations.length,
    periods:([1,7,30] as const).map(days=>({days,completedOrganizations:organizations.filter(o=>o.periods.find(p=>p.days===days)!.hasCompletedWork).length}))}
}
