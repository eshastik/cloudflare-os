import type { OrganizationWork } from "./mnemos-api.ts";
const record = (v: unknown): v is Record<string,unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const count = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v)>=0;
function duration(value: unknown): value is NonNullable<OrganizationWork["collaboration"]>["first_response"] {
  if (!record(value) || !count(value.samples)) return false;
  const values=[value.p50_seconds,value.p95_seconds,value.p99_seconds];
  if (value.samples===0) return values.every(v=>v===null);
  return values.every(v=>typeof v==="number" && Number.isFinite(v) && v>=0 && v<=86400)
    && Number(values[0])<=Number(values[1]) && Number(values[1])<=Number(values[2]);
}
function collaboration(value: unknown): boolean {
  if (!record(value) || !count(value.requests) || !count(value.results) || !count(value.reviewed_requests) || !count(value.reworked_requests)
    || !duration(value.first_response) || !duration(value.first_review)) return false;
  return value.first_response.samples<=value.requests && value.reviewed_requests<=value.first_response.samples
    && value.reworked_requests<=value.reviewed_requests && value.first_review.samples<=value.results
    && value.reviewed_requests<=value.first_review.samples
    && (value.first_review.samples===0)===(value.reviewed_requests===0)
    && (value.results===0 || value.first_response.samples>0);
}
/** Preserve the distinction between publication transitions, projects and organizations. */
export function validOrganizationWork(value: unknown): value is OrganizationWork {
  if (!record(value) || typeof value.observed_at!=="string" || !Number.isFinite(Date.parse(value.observed_at)) || !Array.isArray(value.periods) || value.periods.length!==3) return false;
  if (value.collaboration!==undefined && !collaboration(value.collaboration)) return false;
  if (value.first_publication_at!==null && (typeof value.first_publication_at!=="string" || !Number.isFinite(Date.parse(value.first_publication_at)) || Date.parse(value.first_publication_at)>Date.parse(value.observed_at))) return false;
  const accepted = value.first_acceptance_at !== undefined;
  if (accepted && value.first_acceptance_at!==null && (typeof value.first_acceptance_at!=="string" || !Number.isFinite(Date.parse(value.first_acceptance_at)) || Date.parse(value.first_acceptance_at)>Date.parse(value.observed_at))) return false;
  let publications=0,projects=0,requests=0,requestProjects=0,completedProjects=0;
  const completed = record(value.periods[0]) && value.periods[0].completed_projects !== undefined;
  for(let i=0;i<3;i++){
    const p=value.periods[i];
    if(!record(p) || p.days!==[1,7,30][i] || !count(p.publications) || !count(p.projects) || p.projects>p.publications || (p.projects===0)!==(p.publications===0) || p.has_completed_publication!==(p.publications>0) || p.publications<publications || p.projects<projects) return false;
    publications=p.publications;projects=p.projects;
    if (accepted) {
      if (!count(p.accepted_requests) || !count(p.accepted_request_projects) || p.accepted_request_projects>p.accepted_requests || (p.accepted_request_projects===0)!==(p.accepted_requests===0) || p.accepted_requests<requests || p.accepted_request_projects<requestProjects) return false;
      requests=p.accepted_requests;requestProjects=p.accepted_request_projects;
    } else if (p.accepted_requests!==undefined || p.accepted_request_projects!==undefined) return false;
    if (completed) {
      if (!accepted || !count(p.completed_projects) || p.completed_projects<Math.max(projects,requestProjects) || p.completed_projects>projects+requestProjects || p.completed_projects<completedProjects || p.has_completed_work!==(p.completed_projects>0)) return false;
      completedProjects=p.completed_projects;
    } else if (p.completed_projects!==undefined || p.has_completed_work!==undefined) return false;
  }
  return (value.first_publication_at!==null || publications===0) && (value.first_acceptance_at!==null || requests===0);
}
