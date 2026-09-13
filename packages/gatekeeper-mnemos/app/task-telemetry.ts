import type {MnemosAccountSession} from '../src/account-session.ts';
type API=Pick<MnemosAccountSession,'readTeamMemberActivity'>;

/** A complete correlated interval is required before an absent event becomes a zero. */
export async function taskTelemetry(api:API,project:string,proposal:string,binding:string,request:string){
 try{
  let cursor='0',started=false,completed=false,start=NaN,end=NaN;
  let calls=0,responses=0,failures=0,searches=0,searchFailures=0,searchMs=0,searchTimings=0;
  let accessDenied=0,unclassifiedErrors=0;
  let categoriesKnown=true,searchDurationsKnown=true;
  const ids=new Set<string>();
  for(let pageIndex=0;pageIndex<10;pageIndex++){
   const page=await api.readTeamMemberActivity(project,proposal,binding,cursor);
   if(page.project_id!==project||page.proposal_id!==proposal||page.binding_id!==binding||page.request_id!==request||!page.checkpoint_found||page.state!=='completed')return;
   for(const event of page.events){
    if(!/^\d+$/.test(event.sequence)||BigInt(event.sequence)<=BigInt(cursor)||ids.has(event.event_id)||completed)return;
    cursor=event.sequence;ids.add(event.event_id);
    if(event.kind==='task_started'){
     if(started||ids.size!==1)return;started=true;start=Date.parse(event.created_at);continue;
    }
    if(!started)return;
    if(event.kind==='task_completed'){completed=true;end=Date.parse(event.created_at);continue;}
    if(!['search','memory','other'].includes(event.tool_category||''))categoriesKnown=false;
    if(event.kind==='tool_called'){calls++;if(event.tool_category==='search')searches++;}
    else if(event.kind==='tool_responded'||event.kind==='tool_failed'){
     responses++;if(event.kind==='tool_failed'){failures++;if(event.failure_kind==='access_denied')accessDenied++;else unclassifiedErrors++;}
     if(event.tool_category==='search'){
      if(event.kind==='tool_failed')searchFailures++;
      if(typeof event.duration_ms==='number'&&Number.isSafeInteger(event.duration_ms)&&event.duration_ms>=0){searchMs+=event.duration_ms;searchTimings++;}
      else searchDurationsKnown=false;
     }
    }else return;
   }
   if(page.next_sequence===null){
    if(!started||!completed||calls!==responses)return;
    return {calls,failures,accessDenied,unclassifiedErrors,searches:categoriesKnown?searches:undefined,searchFailures:categoriesKnown?searchFailures:undefined,
     searchMs:categoriesKnown&&searchDurationsKnown&&searchTimings===searches&&Number.isSafeInteger(searchMs)?searchMs:undefined,
     elapsedMs:Number.isFinite(end-start)&&end>=start?end-start:undefined};
   }
   if(!page.events.length||page.next_sequence!==cursor||completed)return;
  }
 }catch{}
}
