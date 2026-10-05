import {test} from 'node:test';
import assert from 'node:assert/strict';
import {templateReviewAccess,shareTemplateForReview} from './template-review-access.ts';
function fixture(){
 const version={template_id:'template',revision:2,user_id:'author',project_id:'project',node_id:'snapshot',source_head:'old-head',content_type:'application/vnd.cloudflareos.document+json'} as any;
 const scopes=[{scope_id:'group',revision:1,level:'group',enabled:true,parent_id:'dept',approvers:['publisher','author']},{scope_id:'dept',revision:3,level:'department',enabled:true,parent_id:'org',approvers:['unneeded-parent-publisher']},{scope_id:'org',revision:4,level:'organization',enabled:true,parent_id:'',approvers:['org-publisher'],review_requirements:[{domain_id:'Разработка',approvers:['expert']}]}];
 const people=[{principal_id:'publisher',display_name:'Согласующий публикации',mode:'',can_read:false},{principal_id:'expert',display_name:'Эксперт',mode:'write',can_read:true}];
 const writes:any[]=[];let checksum='hash',fail='',denied=false;
 const session={
  async whoAmI(){if(denied)throw Error('denied');return {subject:{user_id:'author'}}},
  async listTemplateScopes(cursor:string){return cursor?{scopes:scopes.slice(1),next_cursor:''}:{scopes:scopes.slice(0,1),next_cursor:'parents'}},
  async openDraft(){return {head:'current-head'}},
  async downloadPrivateVersion(_project:string,_node:string,head:string){return {sha256_hex:head==='old-head'?'hash':checksum,size_bytes:100,content_type:version.content_type}},
  async listPrivateDraftParticipants(_project:string,_node:string,_head:string,cursor:string){return cursor?{participants:people.slice(1),next_cursor:''}:{participants:people.slice(0,1),next_cursor:'others'}},
  async setPrivateDraftParticipant(project:string,node:string,head:string,id:string,expected:string,mode:string){if(fail===id){fail='';throw Error('lost reply')};writes.push([project,node,head,id,expected,mode]);const person=people.find(p=>p.principal_id===id)!;person.mode=mode;person.can_read=true},
 };
 return {session:session as any,version,scopes,people,writes,checksum:(value:string)=>checksum=value,fail:(value:string)=>fail=value,deny:()=>denied=true};
}
test('согласующие определяются по всем страницам; явное приглашение открывает только снимок и сохраняет WRITE',async()=>{
 const f=fixture(),plan=await templateReviewAccess(f.session,f.version,'group',1);
 assert.deepEqual(plan.reviewers.map(p=>p.id),['expert','publisher']);assert.equal(f.writes.length,0);
 const result=await shareTemplateForReview(f.session,f.version,'group',1,plan.key);assert.ok(result.reviewers.every(p=>p.canRead));
 assert.deepEqual(f.writes,[['project','snapshot','current-head','publisher','','read']]);assert.equal(f.people[1].mode,'write');
 await shareTemplateForReview(f.session,f.version,'group',1,plan.key);assert.equal(f.writes.length,1);
 f.deny();await assert.rejects(shareTemplateForReview(f.session,f.version,'group',1,plan.key),/denied/);
});
test('изменение правил родителя, состава согласующих или содержимого останавливает старое согласие до записи',async()=>{
 const f=fixture(),plan=await templateReviewAccess(f.session,f.version,'group',1);
 f.scopes[2].revision++;await assert.rejects(shareTemplateForReview(f.session,f.version,'group',1,plan.key));f.scopes[2].revision--;
 f.scopes[2].review_requirements![0].approvers=['publisher'];await assert.rejects(shareTemplateForReview(f.session,f.version,'group',1,plan.key));
 f.scopes[2].review_requirements![0].approvers=['expert'];f.checksum('changed');await assert.rejects(shareTemplateForReview(f.session,f.version,'group',1,plan.key),/изменился/);assert.equal(f.writes.length,0);
});
test('частичный отказ повторяет только недостающие приглашения; непрочитанный WRITE не понижается',async()=>{
 const f=fixture();f.people[1].mode='';f.people[1].can_read=false;
 const plan=await templateReviewAccess(f.session,f.version,'group',1);f.fail('publisher');
 await assert.rejects(shareTemplateForReview(f.session,f.version,'group',1,plan.key));assert.deepEqual(f.writes.map(w=>w[3]),['expert']);
 await shareTemplateForReview(f.session,f.version,'group',1,plan.key);assert.deepEqual(f.writes.map(w=>w[3]),['expert','publisher']);
 const g=fixture();g.people[1].can_read=false;const deniedPlan=await templateReviewAccess(g.session,g.version,'group',1);
 await assert.rejects(shareTemplateForReview(g.session,g.version,'group',1,deniedPlan.key),/записи/);assert.equal(g.writes.length,0);assert.equal(g.people[1].mode,'write');
});

for(const [scope,revision,expected] of [['dept',3,['expert','unneeded-parent-publisher']],['org',4,['expert','org-publisher']]] as const)test('согласование правки в исходной области '+scope,async()=>{
 const f=fixture();f.people.push({principal_id:'unneeded-parent-publisher',display_name:'Отдел',mode:'read',can_read:true},{principal_id:'org-publisher',display_name:'Организация',mode:'read',can_read:true});
 const plan=await templateReviewAccess(f.session,f.version,scope,revision);assert.deepEqual(plan.reviewers.map(p=>p.id),expected);assert.equal(plan.path[0][0],scope);assert.equal(plan.path.length,scope==='dept'?2:1);assert.equal(f.writes.length,0);
 f.scopes[2].revision++;await assert.rejects(shareTemplateForReview(f.session,f.version,scope,revision,plan.key));assert.equal(f.writes.length,0);
});

test('право чтения папки не заменяет приглашение в личный документ',async()=>{
 const f=fixture();f.people[0].can_read=true;
 const plan=await templateReviewAccess(f.session,f.version,'group',1);
 assert.equal(plan.reviewers.find(p=>p.id==='publisher')!.canRead,false);
 const result=await shareTemplateForReview(f.session,f.version,'group',1,plan.key);
 assert.deepEqual(f.writes,[['project','snapshot','current-head','publisher','','read']]);
 assert.ok(result.reviewers.every(p=>p.canRead));
 await shareTemplateForReview(f.session,f.version,'group',1,plan.key);assert.equal(f.writes.length,1);
 f.people[0].mode='';
 assert.equal((await templateReviewAccess(f.session,f.version,'group',1)).reviewers.find(p=>p.id==='publisher')!.canRead,false);
});
