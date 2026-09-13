import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mailReplyAll} from '@gadgets/workshop-shared/mail-reply';
const modules=await build({entryPoints:['src/mail-selection.ts','src/mail-drafts.ts'],bundle:true,platform:'node',format:'esm',outdir:'unused',write:false});
const load=async name=>import('data:text/javascript;base64,'+Buffer.from(modules.outputFiles.find(file=>file.path.endsWith(name+'.js')).text).toString('base64'));
const {MailSelections}=await load('mail-selection');const {MailDrafts}=await load('mail-drafts');
test('reply comes from an authorized message snapshot, survives rereads and is part of exact approval',async()=>{
 const rows=new Map(),storage={get:key=>structuredClone(rows.get(key)),put:(key,value)=>rows.set(key,value)};
 // Source capabilities are not cloneable in this Node harness.
 storage.get=key=>rows.get(key);
 let live=true;const validate=async()=>{if(!live)throw Error('revoked');};
 const original={message_id:'parent',thread_id:'thread',internet_message_id:'<parent@example.test>',subject:'Тема',references:['<root@example.test>'],reply_id:'provider-forged',from:[{address:'author@example.test'}],to:[{address:'self@example.test'},{address:'peer@example.test'}],cc:[{address:'copy@example.test'}],reply_all:{to:['forged@example.test']}};
 const source={validate,metadata:async()=>({provider:'google',query:'in:inbox'}),readSelection:async()=>({provider:'google',query:'in:inbox',self_addresses:['self@example.test'],messages_json:JSON.stringify([original]),truncated:false})};
 const owner={tenant:'tenant',owner:'owner',epoch:'epoch'},selections=new MailSelections(storage);
 const prepared=await selections.prepare(owner,'project','selected','source',source,validate);
 const stored=await selections.resolve(prepared.selection_id,{tenant:'tenant',owner:'owner',project:'project',request:'selected'},()=>owner.epoch);
 const input={tenant_id:'tenant',owner_id:'owner',project_id:'project',connection_id:prepared.selection_id,query_sha256:stored.querySHA256,limit:1};
 const read=await selections.readSelection(prepared.selection_id,input,()=>owner.epoch),message=read.messages[0];
 assert.notEqual(message.reply_id,'provider-forged');assert.equal(message.reply_subject,'Re: Тема');
 assert.equal((await selections.readSelection(prepared.selection_id,input,()=>owner.epoch)).messages[0].reply_id,message.reply_id);
 assert.deepEqual(message.reply_all,{to:['author@example.test','peer@example.test'],cc:['copy@example.test']});
 const proposal={...input,agent_principal_id:'agent',request_id:'proposal',content:{...message.reply_all,subject:message.reply_subject,body:'Ответ',reply_id:message.reply_id}};
 const staged=await selections.stageDraft(prepared.selection_id,proposal,()=>owner.epoch),drafts=new MailDrafts(storage);
 const draft=await drafts.read(staged.draft_id,owner,validate);assert.equal(draft.content.reply.message_id,'parent');assert.deepEqual(draft.content.reply.references,['<root@example.test>','<parent@example.test>']);
 await assert.rejects(selections.stageDraft(prepared.selection_id,{...proposal,content:{...proposal.content,cc:['different@example.test']}},()=>owner.epoch));
 let sends=0;const send=async value=>{sends++;assert.deepEqual(value.reply,draft.content.reply);assert.deepEqual(value.cc,['copy@example.test']);return {accepted:true};};
 await assert.rejects(drafts.dispatch(draft.id,owner,draft.sha256,validate,send));assert.equal(sends,0);
 await drafts.decide(draft.id,owner,draft.sha256,true,validate);await drafts.dispatch(draft.id,owner,draft.sha256,validate,send);
 await new MailDrafts(storage).dispatch(draft.id,owner,draft.sha256,validate,send);assert.equal(sends,1);
 assert.equal((await selections.stageDraft(prepared.selection_id,proposal,()=>owner.epoch)).delivery.state,'accepted');
 for(const content of [{...proposal.content,reply_id:crypto.randomUUID()},{...proposal.content,subject:'Different thread'},{...proposal.content,reply:draft.content.reply}])await assert.rejects(selections.stageDraft(prepared.selection_id,{...proposal,content},()=>owner.epoch));
 const other=await selections.prepare(owner,'project','second','other-source',source,validate),otherStored=await selections.resolve(other.selection_id,{tenant:'tenant',owner:'owner',project:'project',request:'second'},()=>owner.epoch);
 await assert.rejects(selections.stageDraft(other.selection_id,{...proposal,connection_id:other.selection_id,query_sha256:otherStored.querySHA256},()=>owner.epoch));
 live=false;await assert.rejects(selections.stageDraft(prepared.selection_id,proposal,()=>owner.epoch));
});

test('reply-all honors Reply-To, removes known self and duplicates, and never includes hidden recipients',()=>{
 const a=address=>({address});
 assert.deepEqual(mailReplyAll({from:[a('sender@example.test')],reply_to:[a('reply@example.test')],to:[a('SELF@example.test'),a('peer@example.test'),a('REPLY@example.test')],cc:[a('PEER@example.test'),a('copy@example.test')]},['self@example.test']),{to:['reply@example.test','peer@example.test'],cc:['copy@example.test']});
 assert.deepEqual(mailReplyAll({from:[a('self@example.test')],to:[a('peer@example.test')],cc:[]},['self@example.test']),{to:['peer@example.test'],cc:[]});
 assert.equal(mailReplyAll({from:[a('x@example.test\r\nBcc: hidden@example.test')]},['self@example.test']),undefined);
 assert.equal(mailReplyAll({from:[a('self@example.test')],to:[a('self@example.test')]},['self@example.test']),undefined);
 assert.equal(mailReplyAll({from:[a('sender@example.test')]},[]),undefined);
});
