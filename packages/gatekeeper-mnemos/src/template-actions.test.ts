import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MnemosAccount,type AccountStorage} from './account-session.ts';
function storage():AccountStorage{const m=new Map<string,unknown>();return {get:<T>(k:string)=>structuredClone(m.get(k)) as T|undefined,put:(k,v)=>{m.set(k,structuredClone(v));},delete:k=>{m.delete(k);}};}
const version={template_id:'template',revision:1,title:'Form',kind:'document',purpose:'Write specification',project_id:'project',node_id:'source',source_head:'a'.repeat(64),content_type:'text/plain',user_id:'human',agent_id:'',created_at:'2026-09-09T00:00:00Z'};
test('template creation retains exact request across lost reply and account recreation',async()=>{
 const store=storage();let posts=0;const bodies:unknown[]=[];
 const fetcher:typeof fetch=async(url,init)=>{if(String(url).endsWith('/whoami'))return Response.json({subject:{tenant_id:'org',user_id:'human'}});if(init?.method==='GET')return Response.json(version);posts++;bodies.push(JSON.parse(String(init?.body)));if(posts===1)throw new Error('lost reply');return Response.json({node_id:'new',head:'c'.repeat(64),template_id:'template',template_revision:1,source_head:version.source_head});};
 let account=new MnemosAccount(store,'https://memory.example',fetcher);await account.connect('token');let session=account.session();
 const action={kind:'create' as const,template:'template',input:{request_id:'stable',revision:1,project_id:'project',parent_id:'',name:'Copy.txt',expected_head:'b'.repeat(64),message:'Apply'}};
 const saved=await session.saveTemplateAction('project',action,'');
 await assert.rejects(session.saveTemplateAction('project',{...action,input:{...action.input,request_id:'different'}},''));
 await assert.rejects(session.executeSavedTemplateAction('project',saved.id));
 account=new MnemosAccount(store,'https://memory.example',fetcher);session=account.session();assert.deepEqual(await session.readSavedTemplateAction('project'),saved);
 const completed=await session.executeSavedTemplateAction('project',saved.id);assert.equal(completed.receipt?.kind,'create');assert.deepEqual(bodies,[action.input,action.input]);
 assert.deepEqual(await session.executeSavedTemplateAction('project',saved.id),completed);assert.equal(posts,2);
 await assert.rejects(session.saveTemplateAction('project',action,''));account.disconnect();await assert.rejects(session.executeSavedTemplateAction('project',saved.id));
});
test('disconnect during template creation preserves intent and withholds success',async()=>{
 const store=storage();let finish!:(response:Response)=>void;
 const account=new MnemosAccount(store,'https://memory.example',async(url,init)=>{if(String(url).endsWith('/whoami'))return Response.json({subject:{tenant_id:'org',user_id:'human'}});if(init?.method==='GET')return Response.json(version);return new Promise(resolve=>{finish=resolve;});});
 await account.connect('token');const session=account.session();const saved=await session.saveTemplateAction('project',{kind:'create',template:'template',input:{request_id:'stable',revision:1,project_id:'project',parent_id:'',name:'Copy.txt',expected_head:'b'.repeat(64),message:'Apply'}},'');
 const pending=session.executeSavedTemplateAction('project',saved.id);while(!finish)await new Promise(resolve=>setTimeout(resolve,0));account.disconnect();finish(Response.json({node_id:'new',head:'c'.repeat(64),template_id:'template',template_revision:1,source_head:version.source_head}));await assert.rejects(pending);
 await account.connect('new-token');assert.deepEqual(await account.session().readSavedTemplateAction('project'),saved);
});
test('conflicting and unknown operations can be deferred and restored without changing requests',async()=>{
 const store=storage();const bodies:unknown[]=[];let status=409;
 const account=new MnemosAccount(store,'https://memory.example',async(url,init)=>{
  if(String(url).endsWith('/whoami'))return Response.json({subject:{tenant_id:'org',user_id:'human'}});
  if(init?.method==='GET')return Response.json(version);
  bodies.push(JSON.parse(String(init?.body)));return new Response(null,{status});
 });
 await account.connect('token');let session=account.session();
 const action={kind:'create' as const,template:'template',input:{request_id:'conflict',revision:1,project_id:'project',parent_id:'',name:'Copy.txt',expected_head:'b'.repeat(64),message:'Apply'}};
 const first=await session.saveTemplateAction('project',action,'');await assert.rejects(session.executeSavedTemplateAction('project',first.id));
 await assert.rejects(session.deferTemplateAction('project','stale'));await session.deferTemplateAction('project',first.id);
 const second=await session.saveTemplateAction('project',{...action,input:{...action.input,request_id:'second',expected_head:'c'.repeat(64)}},first.id);
 assert.deepEqual(second.history?.[0].action,action);await assert.rejects(session.restoreTemplateAction('project',first.id,second.id));
 status=503;await assert.rejects(session.executeSavedTemplateAction('project',second.id));await session.deferTemplateAction('project',second.id);
 session=new MnemosAccount(store,'https://memory.example').session();
 const restored=await session.restoreTemplateAction('project',first.id,second.id);assert.deepEqual(restored.action,action);assert.equal(restored.history?.[0].id,second.id);assert.equal(restored.receipt,undefined);
 await assert.rejects(account.session().executeSavedTemplateAction('project',first.id));assert.deepEqual(bodies[0],bodies[2]);assert.equal(bodies.length,3);
 account.disconnect();await assert.rejects(session.deferTemplateAction('project',first.id));
});

test('shared copy persists actual inherited scope and recovers exact intent',async()=>{
 const store=storage();let posts=0;const sent:unknown[]=[];
 const shared={scope_id:'department',template_key:'spec',revision:3,proposal_id:'approved',approved_by:'reviewer',approved_at:'2026-09-09T00:00:00Z',source:version};
 const fetcher:typeof fetch=async(url,init)=>{
  if(String(url).endsWith('/whoami'))return Response.json({subject:{tenant_id:'org',user_id:'human'}});
  if(init?.method==='GET'){assert(String(url).includes('/template-scopes/department/templates/spec?revision=3'));return Response.json(shared);}
  assert(String(url).endsWith('/template-scopes/department/templates/spec/documents'));posts++;sent.push(JSON.parse(String(init?.body)));
  if(posts===1)throw new Error('lost reply');
  return Response.json({node_id:'copy',head:'c'.repeat(64),scope_id:'department',template_key:'spec',template_revision:3,source_head:version.source_head});
 };
 let account=new MnemosAccount(store,'https://memory.example',fetcher);await account.connect('token');let session=account.session();
 const action={kind:'create' as const,scope:'department',template:'spec',input:{request_id:'stable-shared',revision:3,project_id:'project',parent_id:'',name:'Shared copy',expected_head:'b'.repeat(64),message:'Apply'}};
 const saved=await session.saveTemplateAction('project',action,'');await assert.rejects(session.executeSavedTemplateAction('project',saved.id));
 account=new MnemosAccount(store,'https://memory.example',fetcher);session=account.session();assert.deepEqual((await session.readSavedTemplateAction('project'))?.action,action);
 const completed=await session.executeSavedTemplateAction('project',saved.id);assert.equal(completed.receipt?.kind,'create');assert.deepEqual(sent[0],sent[1]);assert.equal(posts,2);
 await session.executeSavedTemplateAction('project',saved.id);assert.equal(posts,2);
});

test('proposal stores source and target before sending and validates recovered receipt',async()=>{
 const store=storage();let posts=0;let changed=false;const bodies:unknown[]=[];
 const fetcher:typeof fetch=async(url,init)=>{
  if(String(url).endsWith('/whoami'))return Response.json({subject:{tenant_id:'org',user_id:'human'}});
  if(init?.method==='GET')return Response.json(version);
  assert(String(url).endsWith('/template-promotions/personal'));posts++;const body=JSON.parse(String(init?.body));bodies.push(body);
  if(posts===1)throw new Error('unknown reply');
  return Response.json({...body,proposal_id:'receipt',user_id:'human',agent_id:'',source_owner_id:'human',created_at:'2026-09-09T00:00:00Z',target_scope_id:changed?'other':body.target_scope_id,scope_path:[{scope_id:'team',revision:2}]});
 };
 let account=new MnemosAccount(store,'https://memory.example',fetcher);await account.connect('token');let session=account.session();
 const action={kind:'propose' as const,template:'template',input:{project_id:'project',request_id:'stable-proposal',revision:1,target_scope_id:'team',target_scope_revision:2,template_key:'spec',expected_catalogue_revision:0,message:'Use this specification'}};
 const saved=await session.saveTemplateAction('project',action,'');await assert.rejects(session.executeSavedTemplateAction('project',saved.id));
 account=new MnemosAccount(store,'https://memory.example',fetcher);session=account.session();assert.deepEqual((await session.readSavedTemplateAction('project'))?.action,action);
 changed=true;await assert.rejects(session.executeSavedTemplateAction('project',saved.id));assert.equal((await session.readSavedTemplateAction('project'))?.receipt,undefined);
 changed=false;const result=await session.executeSavedTemplateAction('project',saved.id);assert.equal(result.receipt?.kind,'propose');assert.deepEqual(bodies[0],bodies[1]);assert.deepEqual(bodies[1],bodies[2]);assert.equal('project_id' in (bodies[0] as object),false);
 await session.executeSavedTemplateAction('project',saved.id);assert.equal(posts,3);
});

test('review queue validates target scope and decisions and fences disconnected readers',async()=>{
 const store=storage();let mode='ok';let finish!:(response:Response)=>void;
 const proposal={proposal_id:'proposal',request_id:'request',user_id:'author',agent_id:'',source_owner_id:'author',template_id:'template',template_revision:1,target_scope_id:'team',target_scope_revision:2,template_key:'spec',expected_catalogue_revision:0,message:'Review this',scope_path:[{scope_id:'team',revision:2}],created_at:'2026-09-09T00:00:00Z'};
 const account=new MnemosAccount(store,'https://memory.example',async(url)=>{
  if(String(url).endsWith('/whoami'))return Response.json({subject:{tenant_id:'org',user_id:'reviewer'}});
  if(mode==='pending')return new Promise(resolve=>{finish=resolve;});
  const value={proposal:{...proposal,target_scope_id:mode==='scope'?'other':'team'},...(mode==='decision'?{decision:{proposal_id:'another',request_id:'d',approved:true,scope_revision:2,comment:'Approved',reviewer_id:'reviewer',catalogue_revision:1,created_at:'2026-09-09T00:00:00Z'}}:{})};
  if(String(url).includes('/proposals?'))return Response.json({proposals:[value]});return Response.json(value);
 });
 await account.connect('token');const session=account.session();assert.equal((await session.listTemplateProposals('team')).proposals[0].proposal.proposal_id,'proposal');
 mode='scope';await assert.rejects(session.listTemplateProposals('team'));
 mode='decision';await assert.rejects(session.readTemplateProposal('proposal'));
 mode='pending';const pending=session.readTemplateProposal('proposal');while(!finish)await new Promise(resolve=>setTimeout(resolve,0));account.disconnect();finish(Response.json({proposal}));await assert.rejects(pending);
});


test('review decision survives lost response and rejects changed intent or mismatched receipt',async()=>{
 const store=storage();let mode='lost';const bodies:unknown[]=[];
 const proposal={proposal_id:'proposal',request_id:'request',user_id:'author',agent_id:'',source_owner_id:'author',template_id:'template',template_revision:1,target_scope_id:'team',target_scope_revision:2,template_key:'spec',expected_catalogue_revision:0,message:'Review this',scope_path:[{scope_id:'team',revision:2}],created_at:'2026-09-09T00:00:00Z'};
 const input={request_id:'stable-decision',approved:true,scope_revision:2,comment:'Checked exact source'};
 const fetcher:typeof fetch=async(url,init)=>{
  if(String(url).endsWith('/whoami'))return Response.json({subject:{tenant_id:'org',user_id:'reviewer'}});
  if(init?.method==='GET')return Response.json({proposal});
  assert(String(url).endsWith('/template-promotions/personal/proposal/decision'));
  assert.equal(init?.method,'PUT');bodies.push(JSON.parse(String(init?.body)));
  if(mode==='lost')throw new Error('lost reply');
  return Response.json({...input,proposal_id:'proposal',reviewer_id:'reviewer',catalogue_revision:mode==='wrong'?2:1,created_at:'2026-09-09T00:00:00Z'});
 };
 let account=new MnemosAccount(store,'https://memory.example',fetcher);await account.connect('token');let session=account.session();
 const saved=await session.saveTemplateDecision('proposal',input);assert.equal(bodies.length,0);
 await assert.rejects(session.executeSavedTemplateDecision('proposal'));
 account=new MnemosAccount(store,'https://memory.example',fetcher);session=account.session();assert.deepEqual(await session.readSavedTemplateDecision('proposal'),saved);
 await assert.rejects(session.saveTemplateDecision('proposal',{...input,approved:false}));
 await assert.rejects(session.saveTemplateDecision('proposal',{...input,comment:'Changed'}));
 mode='wrong';await assert.rejects(session.executeSavedTemplateDecision('proposal'));assert.equal((await session.readSavedTemplateDecision('proposal'))?.receipt,undefined);
 mode='ok';const completed=await session.executeSavedTemplateDecision('proposal');assert.equal(completed.receipt?.approved,true);
 assert.deepEqual(bodies,[input,input,input]);assert.deepEqual(await session.executeSavedTemplateDecision('proposal'),completed);assert.equal(bodies.length,3);
 account.disconnect();await assert.rejects(session.readSavedTemplateDecision('proposal'));
});


test('scope management preserves revision, validates receipt and fences disconnected writes',async()=>{
 const store=storage();let mode='ok';const sent:unknown[]=[];let finish!:(response:Response)=>void;
 const scope={scope_id:'team',revision:4,level:'group' as const,parent_id:'department',reader_group_id:'readers',name:'Team',enabled:false,approvers:['reviewer']};
 const account=new MnemosAccount(store,'https://memory.example',async(url,init)=>{
  if(String(url).endsWith('/whoami'))return Response.json({subject:{tenant_id:'org',user_id:'manager'}});
  if(init?.method==='GET'){assert(String(url).includes('mode=manage'));return Response.json({scopes:[scope]});}
  assert.equal(init?.method,'PUT');assert(String(url).endsWith('/template-scopes/team'));const body=JSON.parse(String(init?.body));sent.push(body);
  if(mode==='pending')return new Promise(resolve=>{finish=resolve;});
  return Response.json({...body,scope_id:mode==='wrong'?'another':'team',revision:body.expected_revision+1});
 });
 await account.connect('token');const session=account.session();assert.equal((await session.listManagedTemplateScopes()).scopes[0].enabled,false);
 const config={level:scope.level,parent_id:scope.parent_id,reader_group_id:scope.reader_group_id,name:scope.name,enabled:true,approvers:['reviewer-b','reviewer-a']};
 const out=await session.setTemplateScope('team',4,config);assert.equal(out.revision,5);assert.deepEqual(sent[0],{expected_revision:4,...config,approvers:['reviewer-a','reviewer-b']});
 mode='wrong';await assert.rejects(session.setTemplateScope('team',4,config));
 await assert.rejects(session.setTemplateScope('team',4,{...config,approvers:['reviewer','reviewer']}));assert.equal(sent.length,2);
 mode='pending';const pending=session.setTemplateScope('team',4,config);while(!finish)await new Promise(resolve=>setTimeout(resolve,0));account.disconnect();finish(Response.json({...scope,...config,revision:5}));await assert.rejects(pending);
});


test('resolution validates explicit override instead of accepting shared fallback',async()=>{
 const store=storage();let wrong=false;const account=new MnemosAccount(store,'https://memory.example',async(url,init)=>{
  if(String(url).endsWith('/whoami'))return Response.json({subject:{tenant_id:'org',user_id:'human'}});
  assert(String(url).endsWith('/template-scopes/team/templates/spec/resolve'));assert.equal(init?.method,'POST');assert.deepEqual(JSON.parse(String(init?.body)),{personal:{template_id:'template',revision:1}});
  return Response.json({selected_scope_id:'team',template_key:'spec',personal:{...version,revision:wrong?2:1}});
 });await account.connect('token');const session=account.session();assert.equal((await session.resolveWorkTemplate('team','spec',{template_id:'template',revision:1})).personal?.revision,1);wrong=true;await assert.rejects(session.resolveWorkTemplate('team','spec',{template_id:'template',revision:1}));
});
