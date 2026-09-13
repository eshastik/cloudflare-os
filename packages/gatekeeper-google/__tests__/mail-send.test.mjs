import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
import PostalMime from 'postal-mime';
const url=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const compile=name=>ts.transpileModule(readFileSync(new URL('../src/'+name,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const apiUrl=url(compile('google-api.ts').replace('"mimetext/browser"',JSON.stringify(import.meta.resolve('mimetext/browser'))).replace('"postal-mime"',JSON.stringify(import.meta.resolve('postal-mime'))).replace('"./auth-retry"',JSON.stringify(url(compile('auth-retry.ts')))));
const {GmailApi}=await import(apiUrl);
const {sendApprovedGmail}=await import(url(compile('mail-send.ts').replace("'@gadgets/workshop-shared/mail-attachment'",JSON.stringify(import.meta.resolve('@gadgets/workshop-shared/mail-attachment'))).replace("'@gadgets/workshop-shared/mail-reply'",JSON.stringify(import.meta.resolve('@gadgets/workshop-shared/mail-reply')))));
const content={to:['recipient@example.test'],cc:['copy@example.test'],subject:'Проверка',body:'Согласованный текст\nВторая строка'};
test('reply preserves MIME ancestry and targets the captured Gmail thread',async t=>{
 const reply={message_id:'parent',thread_id:'thread',internet_message_id:'<parent@example.test>',references:['<root@example.test>','<parent@example.test>'],subject:'Проверка'};let calls=0;
 t.mock.method(globalThis,'fetch',async(url,init)=>{calls++;const data=JSON.parse(init.body);assert.equal(data.threadId,'thread');const mime=await PostalMime.parse(Buffer.from(data.raw,'base64url'));assert.equal(mime.inReplyTo,reply.internet_message_id);assert.equal(mime.references,reply.references.join(' '));assert.equal(mime.subject,'Re: Проверка');assert.deepEqual(mime.to.map(x=>x.address),content.to);assert.deepEqual(mime.cc.map(x=>x.address),content.cc);return Response.json({id:'sent',threadId:'thread'});});
 const api=new GmailApi('owner@example.test',async()=>'token');
 await sendApprovedGmail(api,{...content,subject:'Re: Проверка',reply},async()=>{});assert.equal(calls,1);
 await assert.rejects(sendApprovedGmail(api,{...content,reply},async()=>{}));
 await assert.rejects(sendApprovedGmail(api,{...content,subject:'Re: Проверка',reply:{...reply,internet_message_id:'<bad@id>\r\nBcc: other'}},async()=>{}));assert.equal(calls,1);
});
test('uses actual Gmail MIME builder with account sender and exact approved plain text',async t=>{
 let calls=0,observed;
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  calls++;assert.equal(url,'https://gmail.googleapis.com/gmail/v1/users/me/messages/send');assert.equal(init.method,'POST');
  observed=await PostalMime.parse(Buffer.from(JSON.parse(init.body).raw,'base64url'));
  return Response.json({id:'sent-id',threadId:'thread'});
 });
 assert.deepEqual(await sendApprovedGmail(new GmailApi('owner@example.test',async()=> 'fixture-token'),content,async()=>{}),{accepted:true,message_id:'sent-id'});assert.equal(calls,1);
 assert.equal(observed.from.address,'owner@example.test');assert.deepEqual(observed.to.map(x=>x.address),content.to);assert.deepEqual(observed.cc.map(x=>x.address),content.cc);assert.equal(observed.subject,content.subject);assert.equal(observed.text.replace(/\r\n/g,'\n').trimEnd(),content.body);assert.equal(observed.html,undefined);
});
test('invalid proposals and revoked consent never send; transient loss sends one POST and hides provider errors',async t=>{
 let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response('private provider details',{status:503})});
 const api=new GmailApi('owner@example.test',async()=> 'fixture-token');
 for(const input of [{...content,from:'spoof@example.test'},{...content,subject:'Injected\nBcc: a@b.test'},{...content,to:[]}])await assert.rejects(sendApprovedGmail(api,input,async()=>{}));
 let validations=0;await assert.rejects(sendApprovedGmail(api,content,async()=>{if(++validations===2)throw Error('revoked')}));assert.equal(calls,0);
 await assert.rejects(sendApprovedGmail(api,content,async()=>{}),error=>error.message==='Mail send outcome is unconfirmed.');assert.equal(calls,1);
});

test('approved attachments preserve duplicate Unicode names and exact binary bytes',async t=>{
 const bytes=Buffer.from([0,255,10,13,128]),sha256=(await import('node:crypto')).createHash('sha256').update(bytes).digest('hex');const file={filename:'Смета.bin',content_type:'application/octet-stream',content_base64:bytes.toString('base64'),sha256};let calls=0;
 t.mock.method(globalThis,'fetch',async(url,init)=>{calls++;const parsed=await PostalMime.parse(Buffer.from(JSON.parse(init.body).raw,'base64url'));assert.equal(parsed.attachments.length,2);for(const a of parsed.attachments){assert.equal(a.filename,file.filename);assert.deepEqual(Buffer.from(a.content),bytes)};assert.deepEqual(parsed.to.map(a=>a.address),content.to);return Response.json({id:'sent',threadId:'thread'})});
 await sendApprovedGmail(new GmailApi('owner@example.test',async()=>'token'),{...content,attachments:[file,file]},async()=>{});assert.equal(calls,1);
 await assert.rejects(sendApprovedGmail(new GmailApi('owner@example.test',async()=>'token'),{...content,attachments:[{...file,sha256:'0'.repeat(64)}]},async()=>{}));assert.equal(calls,1);
});

test('large recipient lists remain valid MIME and preserve every approved recipient',async t=>{
 const to=Array.from({length:60},(_,i)=>'recipient-'+i+'@example.test');
 const cc=Array.from({length:40},(_,i)=>'copy-'+i+'@example.test');let calls=0,raw;
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  calls++;raw=Buffer.from(JSON.parse(init.body).raw,'base64url').toString();
  return Response.json({id:'sent',threadId:'thread'});
 });
 await sendApprovedGmail(new GmailApi('owner@example.test',async()=>'token'),{...content,to,cc},async()=>{});assert.equal(calls,1);
 assert(raw.split('\r\n').every(line=>Buffer.byteLength(line)<=998),'MIME contains an overlong line');
 const parsed=await PostalMime.parse(raw);assert.deepEqual(parsed.to.map(x=>x.address),to);assert.deepEqual(parsed.cc.map(x=>x.address),cc);
});
