import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
const compile=name=>ts.transpileModule(readFileSync(new URL('../src/'+name,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace("'@gadgets/workshop-shared/mail-attachment'",JSON.stringify(import.meta.resolve("@gadgets/workshop-shared/mail-attachment")));
const url=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const source=compile('mail-source.ts').replace("'@gadgets/workshop-shared/mail-search'",JSON.stringify(import.meta.resolve('@gadgets/workshop-shared/mail-search'))).replace('"postal-mime"',JSON.stringify(import.meta.resolve('postal-mime'))).replace('"./auth-retry"',JSON.stringify(url(compile('auth-retry.ts'))));
const {SelectedGmailReader}=await import(url(source));
const query='label:corporate after:2026/09/01';
test('common search continues past an empty page and matches complete MIME text beyond the preview',async t=>{
 t.mock.method(globalThis,'fetch',async input=>{
  const url=new URL(input);
  if(url.pathname.endsWith('/messages')){assert.equal(url.searchParams.get('q'),query);const next=url.searchParams.get('pageToken')==='older';return Response.json({messages:[{id:next?'old':'new',threadId:'thread'}],...(next?{}:{nextPageToken:'older'})});}
  const old=url.pathname.endsWith('/old');const mime='From: Sender <sender@example.test>\r\nSubject: Topic\r\n\r\n'+(old?'x'.repeat(16010)+' УНИКАЛЬНЫЙ ТЕКСТ':'No match');
  return Response.json({id:old?'old':'new',threadId:'thread',raw:Buffer.from(mime).toString('base64url'),internalDate:'1789056000000'});
 });
 const reader=new SelectedGmailReader(async()=>'token',query,async()=>{}),search={text:'уникальный текст',from:'SENDER@example.test',subject:'topic'};
 const first=await reader.readSelection({limit:1,search});assert.deepEqual(first.messages,[]);assert.equal(first.next_cursor,'older');
 const second=await reader.readSelection({limit:1,search,cursor:first.next_cursor});assert.equal(second.messages[0].message_id,'old');assert.equal(second.messages[0].body_truncated,true);assert(!second.messages[0].body.includes('УНИКАЛЬНЫЙ'));assert.equal(second.truncated,false);
});
test('folder selection uses immutable label IDs, preserves renamed scope and rejects removed or foreign labels',async t=>{
 let live=true,mode='normal',name='Clients',gets=0;
 const mime='From: sender@example.test\r\nSubject: Label message\r\n\r\nBody';
 t.mock.method(globalThis,'fetch',async(input,init)=>{
  const u=new URL(input);assert.equal(u.origin,'https://gmail.googleapis.com');assert.equal(init.method,'GET');
  if(u.pathname.endsWith('/labels'))return Response.json({labels:[{id:'INBOX',name:'INBOX'},{id:'Label_7',name}]});
  if(u.pathname.endsWith('/labels/Label_7')){if(mode==='removed')return new Response(null,{status:404});return Response.json({id:'Label_7',name});}
  if(u.pathname.endsWith('/messages')){assert.equal(u.searchParams.get('labelIds'),'Label_7');assert.equal(u.searchParams.get('q'),null);assert.equal(u.searchParams.get('includeSpamTrash'),'true');return Response.json({messages:[{id:'message',threadId:'thread'}]});}
  assert.equal(u.pathname,'/gmail/v1/users/me/messages/message');gets++;
  if(mode==='revoked')live=false;
  return Response.json({id:'message',threadId:'thread',labelIds:[mode==='foreign'?'Label_other':'Label_7'],raw:Buffer.from(mime).toString('base64url'),internalDate:'1789056000000'});
 });
 const reader=new SelectedGmailReader(async()=>'token','folder:Label_7',async()=>{if(!live)throw Error('revoked');});
 assert.deepEqual((await reader.listFolders()).folders,[{id:'INBOX',name:'INBOX',hasChildren:false},{id:'Label_7',name:'Clients',hasChildren:false}]);
 assert.equal((await reader.readSelection({limit:1})).messages.length,1);
 name='Renamed clients';assert.equal((await reader.metadata()).query,'folder:Label_7');assert.equal((await reader.readSelection({limit:1})).messages.length,1);
 for(mode of ['foreign','removed','revoked']){live=true;await assert.rejects(reader.readSelection({limit:1}));}
 const before=gets;await assert.rejects(reader.listFolders('Label_7'));assert.equal(gets,before);
 assert.throws(()=>new SelectedGmailReader(async()=>'token','folder:Label_7 label:other',async()=>{}));
});
function fixture(t){
 const state={live:true,calls:[],lists:0,changed:false,wrong:false,afterMessage(){},body:'Approved message body',oversize:false};
 t.mock.method(globalThis,'fetch',async(input,init)=>{
  const u=new URL(input);state.calls.push(u.pathname);assert.equal(u.origin,'https://gmail.googleapis.com');assert.equal(init.method,'GET');assert.equal(init.redirect,'error');assert.equal(new Headers(init.headers).get('Authorization'),'Bearer fixture-token');
  if(u.pathname.endsWith('/messages')){
   assert.equal(u.searchParams.get('q'),query);assert.equal(u.searchParams.get('includeSpamTrash'),'false');state.lists++;
   return Response.json({messages:[{id:state.changed&&state.lists>1?'outside':'selected',threadId:'thread'}],nextPageToken:'more'});
  }
  assert.equal(u.pathname,'/gmail/v1/users/me/messages/selected');assert.equal(u.searchParams.get('format'),'raw');
  state.afterMessage();
  if(state.oversize)return new Response('x'.repeat(3*1024*1024+1));
  const mime='From: author@example.invalid\r\nTo: Team: owner@example.invalid;\r\nReply-To: Support <help@example.invalid>\r\nMessage-ID: <source@example.invalid>\r\nSubject: =?UTF-8?B?0KLQtdC80LA=?=\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n'+state.body;
  return Response.json({id:state.wrong?'outside':'selected',threadId:'thread',raw:Buffer.from(mime).toString('base64url'),internalDate:'1789056000000'});
 });
 const reader=new SelectedGmailReader(async()=> 'fixture-token',query,async()=>{if(!state.live)throw Error('private account data');});
 return {reader,state};
}

test('Gmail query reads matching messages, not whole threads, without writes',async t=>{
 const {reader,state}=fixture(t);const result=await reader.readSelection({limit:2});
 assert.equal(result.messages[0].subject,'Тема');assert.deepEqual(result.messages[0].to,[{name:'',address:'owner@example.invalid'}]);assert.deepEqual(result.messages[0].reply_to,[{name:'Support',address:'help@example.invalid'}]);assert.equal(result.messages[0].internet_message_id,'<source@example.invalid>');assert.equal(result.messages[0].attachment_metadata_included,true);assert.equal(result.query,query);assert.equal(result.truncated,true);assert.equal(result.messages.length,1);assert.equal(result.messages[0].body,'Approved message body\n');assert.equal(result.messages[0].body_format,'text');assert.equal(result.messages[0].body_truncated,false);assert.equal(result.messages[0].attachment_content_included,false);assert.equal(reader.send,undefined);assert.equal(reader.modifyLabels,undefined);assert.equal(state.lists,2);
});
test('Gmail scope changes and revocation withhold already fetched content',async t=>{
 const {reader,state}=fixture(t);
 for(const mode of ['changed','wrong','revoked','oversize']){
  state.changed=mode==='changed';state.wrong=mode==='wrong';state.oversize=mode==='oversize';state.live=true;state.lists=0;state.afterMessage=()=>{if(mode==='revoked')state.live=false;};
  await assert.rejects(reader.readSelection({limit:2}),error=>error.message==='Selected Gmail messages are unavailable or changed.');
 }
});
test('Gmail caller cannot replace query or enlarge selection; truncation is explicit',async t=>{
 const {reader,state}=fixture(t);
 for(const input of [{limit:0},{limit:11},{limit:2,query:'in:anywhere'}])await assert.rejects(reader.readSelection(input));
 assert.equal(state.calls.length,0);
 state.body='я'.repeat(16001);const result=await reader.readSelection({limit:1});assert.equal(result.messages[0].body.length,16000);assert.equal(result.messages[0].body_truncated,true);
 state.live=false;state.calls=[];await assert.rejects(reader.readSelection({limit:1}));assert.equal(state.calls.length,0);
});


test('MIME attachments retain distinct part IDs, decoded size and digest for duplicate names and inline files',async t=>{
 const first=Buffer.from([0,1,255,13,10]),second=Buffer.from('inline');
 const parts=[first,second].map((bytes,i)=>'--parts\r\nContent-Type: application/octet-stream\r\nContent-Disposition: '+(i?'inline':'attachment')+'; filename="same.bin"\r\nContent-Transfer-Encoding: base64\r\n\r\n'+bytes.toString('base64')+'\r\n').join('');
 const raw=Buffer.from('From: sender@example.test\r\nSubject: Files\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="parts"\r\n\r\n--parts\r\nContent-Type: text/plain\r\n\r\nBody\r\n'+parts+'--parts--\r\n').toString('base64url');
 t.mock.method(globalThis,'fetch',async input=>new URL(input).pathname.endsWith('/messages')?Response.json({messages:[{id:'message',threadId:'thread'}]}):Response.json({id:'message',threadId:'thread',raw,internalDate:'1789056000000'}));
 const result=await new SelectedGmailReader(async()=>'token',query,async()=>{}).readSelection({limit:1});
 const files=result.messages[0].attachments;assert.equal(files.length,2);assert.deepEqual(files.map(file=>file.attachment_id),['mime:0','mime:1']);assert(files.every(file=>file.filename==='same.bin'));assert.deepEqual(files.map(file=>file.size),[first.length,second.length]);assert.deepEqual(files.map(file=>file.is_inline),[false,true]);
 const {createHash}=await import('node:crypto');assert.equal(files[0].sha256,createHash('sha256').update(first).digest('hex'));assert.equal(result.messages[0].attachment_content_included,false);
 const reader=new SelectedGmailReader(async()=>'token',query,async()=>{}),request={message_id:'message',attachment_id:'mime:0',offset:0,max_bytes:2,expected_sha256:files[0].sha256};
 const one=await reader.readSelection({limit:1,attachment:request});assert.deepEqual(one.messages,[]);assert.deepEqual(Buffer.from(one.attachment.content_base64,'base64'),first.subarray(0,2));assert.equal(one.attachment.next_offset,2);
 const two=await reader.readSelection({limit:1,attachment:{...request,offset:2,max_bytes:8}});assert(two.attachment.complete);assert.deepEqual(Buffer.from(two.attachment.content_base64,'base64'),first.subarray(2));
 for(const patch of [{message_id:'foreign'},{attachment_id:'mime:9'},{expected_sha256:'a'.repeat(64)}])await assert.rejects(reader.readSelection({limit:1,attachment:{...request,...patch}}));

});
