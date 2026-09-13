import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
const code=ts.transpileModule(readFileSync(new URL('../src/mail-source.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace("'@gadgets/workshop-shared/mail-attachment'",JSON.stringify(import.meta.resolve("@gadgets/workshop-shared/mail-attachment"))).replace("'@gadgets/workshop-shared/mail-search'",JSON.stringify(import.meta.resolve("@gadgets/workshop-shared/mail-search")));
const {SelectedOutlookReader}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
test('common search pages only inside the selected Outlook folder and inspects complete body',async t=>{
 t.mock.method(globalThis,'fetch',async input=>{
  const u=new URL(input);assert.equal(u.origin,'https://graph.microsoft.com');
  if(u.pathname.endsWith('/attachments'))return Response.json({value:[]});
  if(u.pathname==='/v1.0/me')return Response.json({id:'account'});
  if(u.pathname==='/v1.0/me/mailFolders/folder')return Response.json({id:'folder',displayName:'Inbox'});
  if(u.pathname.endsWith('/messages')){const older=u.searchParams.get('$skiptoken')==='older';return Response.json({value:[{id:older?'old':'new',parentFolderId:'folder',changeKey:'v1'}],...(older?{}:{'@odata.nextLink':'https://graph.microsoft.com/v1.0/me/mailFolders/folder/messages?$skiptoken=older'})});}
  const older=u.pathname.endsWith('/old');return Response.json({id:older?'old':'new',parentFolderId:'folder',changeKey:'v1',conversationId:'thread',receivedDateTime:'2026-09-11T00:00:00Z',subject:'Topic',from:{emailAddress:{address:'sender@example.test'}},toRecipients:[],ccRecipients:[],body:{contentType:'text',content:older?'x'.repeat(16010)+' УНИКАЛЬНЫЙ ТЕКСТ':'no match'},hasAttachments:false});
 });
 const reader=new SelectedOutlookReader('folder','account',async()=>'token',async()=>{}),search={text:'уникальный текст',from:'SENDER@example.test',subject:'topic'};
 const first=await reader.readSelection({limit:1,search});assert.deepEqual(first.messages,[]);assert(first.next_cursor);
 const second=await reader.readSelection({limit:1,search,cursor:first.next_cursor});assert.equal(second.messages[0].message_id,'old');assert.equal(second.messages[0].body_truncated,true);assert.equal(second.truncated,false);
 for(const cursor of ['https://other.test/messages','https://graph.microsoft.com/v1.0/me/mailFolders/other/messages'])await assert.rejects(reader.readSelection({limit:1,search,cursor}));
});
function fixture(t){
 const state={live:true,calls:[],lists:0,mode:'ok',body:'selected message',identityCalls:0};
 t.mock.method(globalThis,'fetch',async(input,init)=>{
  const url=new URL(input);state.calls.push(url.pathname);assert.equal(url.origin,'https://graph.microsoft.com');assert.equal(init.method,'GET');assert.equal(init.redirect,'manual');assert.equal(init.headers.Authorization,'Bearer fixture-token');assert.match(init.headers.Prefer,/ImmutableId/);
  if(url.pathname.endsWith('/attachments'))return Response.json({value:[]});
  if(url.pathname==='/v1.0/me'){
   state.identityCalls++;return Response.json({id:state.mode==='foreign-account'||state.mode==='changed-account'&&state.identityCalls>1?'other':'account'});
  }
  if(url.pathname==='/v1.0/me/mailFolders/folder')return Response.json({id:state.mode==='foreign-folder'?'other':'folder',displayName:'Selected folder'});
  if(url.pathname==='/v1.0/me/mailFolders/folder/messages'){
   state.lists++;assert.equal(url.searchParams.get('$top'),'2');assert.equal(url.searchParams.get('$select'),'id,parentFolderId,changeKey');
   const item={id:'message',parentFolderId:'folder',changeKey:state.mode==='changed-membership'&&state.lists>1?'v2':'v1'};
   return Response.json({value:state.mode==='duplicate'?[item,item]:[item],'@odata.nextLink':'https://graph.microsoft.com/v1.0/me/mailFolders/folder/messages?$skiptoken=next'});
  }
  assert.equal(url.pathname,'/v1.0/me/messages/message');assert(!url.searchParams.get('$select').includes('attachments'));
  if(state.mode==='revoked')state.live=false;
  if(state.mode==='oversized')return new Response('x'.repeat(3*1024*1024+1));
  if(state.mode==='provider-refusal')return new Response('secret diagnostics',{status:401});
  return Response.json({id:state.mode==='wrong-message'?'other':'message',parentFolderId:state.mode==='moved'?'other':'folder',changeKey:state.mode==='changed-message'?'v2':'v1',conversationId:'thread',receivedDateTime:state.mode==='invalid-date'?'2026-02-30T00:00:00Z':'2026-09-11T00:00:00Z',subject:'Тема',internetMessageId:'<source@example.invalid>',replyTo:[{emailAddress:{name:'Support',address:'help@example.invalid'}}],from:{emailAddress:{name:'Sender',address:'sender@example.invalid'}},toRecipients:[],ccRecipients:[],body:{contentType:'text',content:state.body},hasAttachments:true});
 });
 return {state,reader:new SelectedOutlookReader('folder','account',async()=>'fixture-token',async()=>{if(!state.live)throw Error('private revoke details');})};
}
test('Outlook reads only the chosen folder with immutable IDs and explicit truncation',async t=>{
 const {reader,state}=fixture(t);const result=await reader.readSelection({limit:2});
 assert.equal(result.messages[0].subject,'Тема');assert.deepEqual(result.messages[0].from,[{name:'Sender',address:'sender@example.invalid'}]);assert.deepEqual(result.messages[0].to,[]);assert.deepEqual(result.messages[0].reply_to,[{name:'Support',address:'help@example.invalid'}]);assert.equal(result.messages[0].internet_message_id,'<source@example.invalid>');assert.deepEqual(result.messages[0].attachments,[]);assert.equal(result.provider,'microsoft');assert.equal(result.query,'folder:folder');assert.equal(result.messages.length,1);assert.equal(result.messages[0].body,'selected message');assert.equal(result.messages[0].attachment_content_included,false);assert.equal(result.messages[0].attachment_metadata_included,true);assert.equal(result.truncated,true);assert.equal(state.lists,2);assert.equal(reader.send,undefined);
});
test('Outlook withholds content on changed account, folder membership, version or revoked access',async t=>{
 const {reader,state}=fixture(t);
 for(const mode of ['foreign-account','changed-account','foreign-folder','changed-membership','duplicate','wrong-message','moved','changed-message','revoked','oversized','provider-refusal','invalid-date']){
  state.mode=mode;state.live=true;state.calls=[];state.lists=0;state.identityCalls=0;
  await assert.rejects(reader.readSelection({limit:2}),error=>error.message==='Selected Outlook messages are unavailable or changed.');
  if(mode==='foreign-account')assert.deepEqual(state.calls,['/v1.0/me']);
  if(mode==='foreign-folder')assert(!state.calls.some(path=>path.includes('/messages')));
 }
});
test('Outlook rejects agent query/folder overrides before IO and bounds body by code points',async t=>{
 const {reader,state}=fixture(t);
 for(const input of [{limit:0},{limit:11},{limit:2,query:'all'},{limit:2,folder_id:'other'}])await assert.rejects(reader.readSelection(input));
 assert.equal(state.calls.length,0);
 state.body='😀'.repeat(16001);const result=await reader.readSelection({limit:2});assert.equal(Array.from(result.messages[0].body).length,16000);assert.equal(result.messages[0].body_truncated,true);
 state.live=false;state.calls=[];await assert.rejects(reader.readSelection({limit:2}));assert.equal(state.calls.length,0);
});

test('owner folder navigation follows only same-collection pages and fences revoked listings',async t=>{
 let mode='ok',live=true,calls=0;
 t.mock.method(globalThis,'fetch',async input=>{
  const url=new URL(input);assert.equal(url.origin,'https://graph.microsoft.com');
  if(url.pathname==='/v1.0/me')return Response.json({id:'account'});
  calls++;assert.equal(url.pathname,'/v1.0/me/mailFolders/parent/childFolders');
  if(mode==='revoked')live=false;
  if(url.searchParams.has('$skiptoken'))return Response.json({value:[{id:'second',displayName:'Second',childFolderCount:0}]});
  return Response.json({value:[{id:'first',displayName:'First',childFolderCount:1}],
   '@odata.nextLink':mode==='foreign'?'https://foreign.invalid/steal':mode==='other-path'?'https://graph.microsoft.com/v1.0/me/messages':'https://graph.microsoft.com/v1.0/me/mailFolders/parent/childFolders?$skiptoken=next'});
 });
 const reader=new SelectedOutlookReader('root','account',async()=>'token',async()=>{if(!live)throw Error('revoked')});
 assert.deepEqual(await reader.listFolders('parent'),{folders:[{id:'first',name:'First',hasChildren:true},{id:'second',name:'Second',hasChildren:false}],truncated:false});
 for(mode of ['foreign','other-path','revoked']){live=true;calls=0;await assert.rejects(reader.listFolders('parent'));assert.equal(calls,1)}
});


test('attachment metadata includes inline files despite hasAttachments=false and rejects foreign pages or changed membership',async t=>{
 let mode='inline',lists=0;
 t.mock.method(globalThis,'fetch',async input=>{
  const u=new URL(input);
  if(u.pathname==='/v1.0/me')return Response.json({id:'account'});
  if(u.pathname==='/v1.0/me/mailFolders/folder')return Response.json({id:'folder',displayName:'Inbox'});
  if(u.pathname==='/v1.0/me/mailFolders/folder/messages'){lists++;return Response.json({value:[{id:'message',parentFolderId:'folder',changeKey:mode==='changed'&&lists>1?'v2':'v1'}]});}
  if(u.pathname.endsWith('/$value'))return new Response(Uint8Array.from([0,1,2,3,255]),{status:mode==='partial'?206:200});
  if(u.pathname.endsWith('/attachments')){
   assert(!u.searchParams.get('$select')?.includes('contentBytes'));
   return Response.json({value:[{'@odata.type':'#microsoft.graph.fileAttachment',id:'file',name:'inline.png',contentType:'image/png',size:5,isInline:true}],...(mode==='foreign'?{'@odata.nextLink':'https://graph.microsoft.com/v1.0/me/messages/other/attachments?$skip=1'}:{})});
  }
  return Response.json({id:'message',parentFolderId:'folder',changeKey:'v1',conversationId:'thread',receivedDateTime:'2026-09-11T00:00:00Z',subject:'Inline',from:{emailAddress:{address:'sender@example.test'}},toRecipients:[],ccRecipients:[],body:{contentType:'text',content:'body'},hasAttachments:false});
 });
 const reader=new SelectedOutlookReader('folder','account',async()=>'token',async()=>{});
 const result=await reader.readSelection({limit:1});assert.equal(result.messages[0].has_attachments,true);assert.equal(result.messages[0].attachment_metadata_included,true);assert.deepEqual(result.messages[0].attachments,[{attachment_id:'file',filename:'inline.png',content_type:'image/png',size:5,is_inline:true,kind:'file',sha256:null}]);

 const one=await reader.readSelection({limit:1,attachment:{message_id:'message',attachment_id:'file',offset:0,max_bytes:2}});assert.deepEqual(one.messages,[]);assert.deepEqual(Buffer.from(one.attachment.content_base64,'base64'),Buffer.from([0,1]));
 const two=await reader.readSelection({limit:1,attachment:{message_id:'message',attachment_id:'file',offset:2,max_bytes:8,expected_sha256:one.attachment.sha256}});assert(two.attachment.complete);assert.deepEqual(Buffer.from(two.attachment.content_base64,'base64'),Buffer.from([2,3,255]));
 await assert.rejects(reader.readSelection({limit:1,attachment:{message_id:'message',attachment_id:'file',offset:2,max_bytes:8,expected_sha256:'a'.repeat(64)}}));
 mode='partial';await assert.rejects(reader.readSelection({limit:1,attachment:{message_id:'message',attachment_id:'file',offset:0,max_bytes:8}}));
 for(mode of ['foreign','changed']){lists=0;await assert.rejects(reader.readSelection({limit:1}));}
});
