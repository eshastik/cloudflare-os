import type {MnemosAccountSession} from '../src/account-session.ts';
type API=Pick<MnemosAccountSession,'listProjects'|'listTeamBudgets'|'readTeamBudget'|'readTeamBudgetUsage'>;
export type RequesterExpenses={user:string;known:string;reserved:string;proposals:number;unavailable:number};
export type ProjectAgent={binding:string;roles:string[];proposals:number};
export type ProjectExpenses={project:string;name:string;known:string;reserved:string;proposals:number;unavailable:number;complete:boolean;requesters:RequesterExpenses[];agents:ProjectAgent[];agentsUnavailable:number};
/** Aggregate only authorized ledger readings, retaining gaps and pagination limits. */
export async function projectExpenses(api:API,project:string,name:string):Promise<ProjectExpenses>{
 const out:ProjectExpenses={project,name,known:'0',reserved:'0',proposals:0,unavailable:0,complete:false,requesters:[],agents:[],agentsUnavailable:0};
 const agents=new Map<string,ProjectAgent>();
 const owners=new Map<string,RequesterExpenses>();
 const seen=new Set<string>(),cursors=new Set<string>();let cursor='';
 try{
  for(let pageNumber=0;pageNumber<10;pageNumber++){
   const page=await api.listTeamBudgets(project,cursor);
   for(const proposal of page.proposals){
    if(seen.has(proposal.id)){out.complete=false;return out;}seen.add(proposal.id);out.proposals++;
    const user=typeof proposal.user_id==='string'&&proposal.user_id.trim()?proposal.user_id:'';
    let owner=owners.get(user);if(!owner){owner={user,known:'0',reserved:'0',proposals:0,unavailable:0};owners.set(user,owner);out.requesters.push(owner);}owner.proposals++;
    try{
     const details=await api.readTeamBudget(project,proposal.id);
     if(details.id!==proposal.id||details.project_id!==project)throw Error('Wrong proposal');
     const inProposal=new Set<string>();
     for(const member of details.proposal.members){
      if(inProposal.has(member.binding_id))continue;inProposal.add(member.binding_id);
      let agent=agents.get(member.binding_id);
      if(!agent){agent={binding:member.binding_id,roles:[],proposals:0};agents.set(member.binding_id,agent);out.agents.push(agent);}
      agent.proposals++;if(!agent.roles.includes(member.role))agent.roles.push(member.role);
     }
    }catch{out.agentsUnavailable++;}
    try{
     const usage=await api.readTeamBudgetUsage(project,proposal.id);
     if(usage.project_id!==project||usage.proposal_id!==proposal.id||usage.accounting_basis!=='rated_tokens'||!/^\d+$/.test(usage.actual_usd_micros)||!/^\d+$/.test(usage.reserved_usd_micros))throw Error('Invalid expense source');
     out.known=(BigInt(out.known)+BigInt(usage.actual_usd_micros)).toString();out.reserved=(BigInt(out.reserved)+BigInt(usage.reserved_usd_micros)).toString();
     owner.known=(BigInt(owner.known)+BigInt(usage.actual_usd_micros)).toString();owner.reserved=(BigInt(owner.reserved)+BigInt(usage.reserved_usd_micros)).toString();
    }catch{out.unavailable++;owner.unavailable++;}
   }
   if(!page.next_cursor){out.complete=out.unavailable===0;return out;}
   if(cursors.has(page.next_cursor))return out;cursors.add(page.next_cursor);cursor=page.next_cursor;
  }
 }catch{out.complete=false;}
 return out;
}
