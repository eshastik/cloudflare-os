import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
const code=ts.transpileModule(readFileSync(new URL('../src/mail-send.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace("'@gadgets/workshop-shared/mail-attachment'",JSON.stringify(import.meta.resolve('@gadgets/workshop-shared/mail-attachment'))).replace("'@gadgets/workshop-shared/mail-reply'",JSON.stringify(import.meta.resolve('@gadgets/workshop-shared/mail-reply')));
const {sendApprovedOutlook}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const content={to:['recipient@example.test'],cc:['copy@example.test'],subject:'Согласовано',body:'Полный текст'};
test('reply uses the captured immutable Outlook message and exact approved recipients/body',async()=>{
 const reply={message_id:'parent/id',internet_message_id:'<parent@example.test>',references:['<parent@example.test>'],subject:'Согласовано'};let calls=0;
 const fetcher=async(url,init)=>{calls++;assert.equal(url,'https://graph.microsoft.com/v1.0/me/messages/parent%2Fid/reply');assert.equal(init.headers.Prefer,'IdType="ImmutableId"');assert.deepEqual(JSON.parse(init.body),{message:{subject:'Re: Согласовано',body:{contentType:'Text',content:content.body},toRecipients:[{emailAddress:{address:content.to[0]}}],ccRecipients:[{emailAddress:{address:content.cc[0]}}],bccRecipients:[]}});return new Response(null,{status:202});};
 await sendApprovedOutlook({...content,subject:'Re: Согласовано',reply},async()=>'token',async()=>{},fetcher);assert.equal(calls,1);
 await assert.rejects(sendApprovedOutlook({...content,reply},async()=>'token',async()=>{},fetcher));assert.equal(calls,1);
});
test('Graph accepts the exact plain text via fixed /me without returning a fabricated message ID',async()=>{
 let calls=0;
 const result=await sendApprovedOutlook(content,async()=> 'fixture-token',async()=>{},async(url,init)=>{
  calls++;assert.equal(url,'https://graph.microsoft.com/v1.0/me/sendMail');assert.equal(init.method,'POST');assert.equal(init.redirect,'manual');assert.equal(init.headers.Authorization,'Bearer fixture-token');
  assert.deepEqual(JSON.parse(init.body),{message:{subject:content.subject,body:{contentType:'Text',content:content.body},toRecipients:[{emailAddress:{address:content.to[0]}}],ccRecipients:[{emailAddress:{address:content.cc[0]}}],bccRecipients:[]}});
  return new Response(null,{status:202});
 });
 assert.deepEqual(result,{accepted:true});assert.equal(calls,1);
});
test('invalid input, revoked permission and token rotation cannot send; redirects/failures never replay POST',async()=>{
 let calls=0;const fetcher=async()=>{calls++;return new Response(null,{status:503})};
 for(const body of [{...content,from:'other@example.test'},{...content,subject:'injected\nBcc: other@example.test'},{...content,to:[]},{...content,to:['a@b.test\r\n']}])await assert.rejects(sendApprovedOutlook(body,async()=> 'fixture-token',async()=>{},fetcher));
 let check=0;await assert.rejects(sendApprovedOutlook(content,async()=> 'fixture-token',async()=>{if(++check===2)throw Error('revoked')},fetcher));assert.equal(calls,0);
 for(const status of [200,301,401,429,503]){calls=0;await assert.rejects(sendApprovedOutlook(content,async()=> 'fixture-token',async()=>{},async()=>{calls++;return new Response('private provider response',{status})}),error=>error.message==='Mail send outcome is unconfirmed.');assert.equal(calls,1);}
});

test('Graph receives exact file attachments and refuses a bad hash before send',async()=>{
 const bytes=Buffer.from([0,255,10]),sha256=(await import('node:crypto')).createHash('sha256').update(bytes).digest('hex');const file={filename:'Смета.bin',content_type:'application/octet-stream',content_base64:bytes.toString('base64'),sha256};let calls=0;
 const fetcher=async(url,init)=>{calls++;const m=JSON.parse(init.body).message;assert.deepEqual(m.attachments,[{'@odata.type':'#microsoft.graph.fileAttachment',name:file.filename,contentType:file.content_type,contentBytes:file.content_base64,isInline:false}]);return new Response(null,{status:202})};
 await sendApprovedOutlook({...content,attachments:[file]},async()=>'token',async()=>{},fetcher);await sendApprovedOutlook({...content,subject:'Re: '+content.subject,reply:{message_id:'parent',internet_message_id:'<parent@example.test>',references:['<parent@example.test>'],subject:content.subject},attachments:[file]},async()=>'token',async()=>{},fetcher);await assert.rejects(sendApprovedOutlook({...content,attachments:[{...file,sha256:'0'.repeat(64)}]},async()=>'token',async()=>{},fetcher));assert.equal(calls,2);
});
