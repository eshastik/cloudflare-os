import test from 'node:test';
import assert from 'node:assert/strict';
import {SmtpClient,smtpMessage} from '../src/smtp-client.ts';
import {MailDrafts} from '../src/mail-drafts.ts';

const server={host:'smtp.example.test',port:587,security:'starttls'};
const credential={username:'owner',password:'private-password',from:'owner@example.test'};
const content={to:['first@example.test','second@example.test'],subject:'Проверка — '+ 'длинная тема '.repeat(12),body:'Первая строка\n.\r\n..\nПоследняя строка'};
test('SMTP reply carries the captured parent and complete References without changing approved body',()=>{
 const reply={message_id:'1:7',internet_message_id:'<parent@example.test>',references:['<root@example.test>','<parent@example.test>'],subject:'Исходное письмо'};
 const raw=new TextDecoder().decode(smtpMessage(credential.from,{...content,subject:'Re: Исходное письмо',reply}));
 assert(raw.includes('In-Reply-To: <parent@example.test>\r\n'));assert(raw.includes('References: <root@example.test>\r\n <parent@example.test>\r\n'));
 assert.equal(Buffer.from(raw.split('\r\n\r\n')[1].replace(/\s/g,''),'base64').toString(),content.body);
 assert.throws(()=>smtpMessage(credential.from,{...content,reply}));
});
function fixture({upgrade=true,rejectRecipient=false,loseAck=false,onData=()=>{}}={}){
  const state={commands:[],messages:[],connections:0,upgrades:0,auth:0};let recipient=0,expectAuth=false,expectData=false;
  const open=(secure,greet)=>{
    let controller,closed=false,finish;
    const closedPromise=new Promise(resolve=>{finish=resolve});
    const say=text=>controller.enqueue(new TextEncoder().encode(text));
    const close=async()=>{if(!closed){closed=true;controller.close();finish();}};
    const socket={opened:Promise.resolve(),closed:closedPromise,close,
      readable:new ReadableStream({start(value){controller=value;if(greet)say('220 fixture ready\r\n');}}),
      writable:new WritableStream({write(bytes){
        const line=new TextDecoder().decode(bytes);
        if(expectData){expectData=false;state.messages.push(line);onData();if(loseAck)return close();say('250 accepted\r\n');return;}
        if(expectAuth){expectAuth=false;assert(secure);assert.equal(Buffer.from(line.trim(),'base64').toString(),'\0owner\0private-password');state.auth++;say('235 authenticated\r\n');return;}
        const command=line.trim();state.commands.push(command);
        if(command.startsWith('EHLO ')){say('250-fixture\r\n'+(!secure&&upgrade?'250-STARTTLS\r\n':'')+'250 AUTH PLAIN\r\n');return;}
        if(command==='STARTTLS'){assert(!secure);say('220 upgrade\r\n');return;}
        if(command==='AUTH PLAIN'){assert(secure);expectAuth=true;say('334 \r\n');return;}
        if(command.startsWith('MAIL FROM:')){say('250 sender\r\n');return;}
        if(command.startsWith('RCPT TO:')){recipient++;say(rejectRecipient&&recipient===2?'550 rejected\r\n':'250 recipient\r\n');return;}
        if(command==='DATA'){expectData=true;say('354 send data\r\n');return;}
        throw Error('Unexpected SMTP command');
      }}),
      startTls(){assert(!secure);state.upgrades++;void close();return open(true,false);},
    };
    return socket;
  };
  return {state,connect:selected=>{state.connections++;assert.deepEqual(selected,server);return open(selected.security==='tls',true);}};
}
test('STARTTLS precedes authentication, credentials check sends no mail, and MIME preserves approval',async()=>{
  const f=fixture();await new SmtpClient(server,credential,f.connect,async()=>{}).check();
  assert.equal(f.state.upgrades,1);assert.equal(f.state.auth,1);assert.equal(f.state.messages.length,0);
  assert(!f.state.commands.some(command=>command.startsWith('MAIL ')));
  const delivery=fixture();assert.deepEqual(await new SmtpClient(server,credential,delivery.connect,async()=>{}).send(content),{accepted:true});
  assert.equal(delivery.state.upgrades,1);assert.equal(delivery.state.commands.filter(command=>command.startsWith('EHLO ')).length,2);
  const wire=delivery.state.messages[0];assert(wire.endsWith('\r\n.\r\n'));
  const message=wire.slice(0,-3),split=message.indexOf('\r\n\r\n');
  assert.equal(Buffer.from(message.slice(split+4).replace(/\s/g,''),'base64').toString(),content.body);
  const header=message.slice(0,split).replace(/\r\n /g,' ');
  const subject=header.match(/Subject: ([^\r\n]*)/)[1];
  assert.equal([...subject.matchAll(/=\?UTF-8\?B\?([^?]*)\?=/g)].map(match=>Buffer.from(match[1],'base64').toString()).join(''),content.subject);
  assert(header.includes('To: '+content.to.join(', ')));
  assert(message.split('\r\n').every(line=>line.length<=998));
  assert.throws(()=>smtpMessage(credential.from,{...content,subject:'Hello\r\nBcc: other@example.test'}));
});
test('no downgrade, no DATA after recipient rejection, and no data after revocation',async()=>{
  const unavailable=fixture({upgrade:false});await assert.rejects(new SmtpClient(server,credential,unavailable.connect,async()=>{}).send(content));assert.equal(unavailable.state.auth,0);
  const refused=fixture({rejectRecipient:true});await assert.rejects(new SmtpClient(server,credential,refused.connect,async()=>{}).send(content));assert.equal(refused.state.messages.length,0);
  let live=true;const revoked=fixture();const validate=async()=>{if(revoked.state.commands.includes('DATA'))live=false;if(!live)throw Error('revoked');};
  await assert.rejects(new SmtpClient(server,credential,revoked.connect,validate).send(content));assert.equal(revoked.state.messages.length,0);
});
test('lost SMTP acknowledgement keeps a durable attempt and never resubmits on retry',async()=>{
  const rows=new Map(),drafts=new MailDrafts({get:key=>structuredClone(rows.get(key)),put:(key,value)=>rows.set(key,structuredClone(value))});
  const context={tenant:'tenant',owner:'owner',epoch:'epoch',connection:'connection',agent:'agent'},validate=async()=>{};
  const draft=await drafts.stage(context,'request',content,validate);await drafts.decide(draft.id,context,draft.sha256,true,validate);
  const transport=fixture({loseAck:true}),send=value=>new SmtpClient(server,credential,transport.connect,validate).send(value);
  await assert.rejects(drafts.dispatch(draft.id,context,draft.sha256,validate,send));
  assert.equal((await drafts.read(draft.id,context,validate)).delivery.state,'attempted');
  await assert.rejects(drafts.dispatch(draft.id,context,draft.sha256,validate,send));
  assert.equal(transport.state.connections,1);assert.equal(transport.state.messages.length,1);
});


test('copied recipients appear in both approved MIME and SMTP envelope; rejection prevents DATA',async()=>{
 const message={...content,to:['first@example.test'],cc:['copied@example.test']};
 const f=fixture();await new SmtpClient(server,credential,f.connect,async()=>{}).send(message);
 assert.deepEqual(f.state.commands.filter(value=>value.startsWith('RCPT TO:')),['RCPT TO:<first@example.test>','RCPT TO:<copied@example.test>']);
 assert(f.state.messages[0].includes('Cc: copied@example.test\r\n'));
 const denied=fixture({rejectRecipient:true});await assert.rejects(new SmtpClient(server,credential,denied.connect,async()=>{}).send(message));assert.equal(denied.state.messages.length,0);
 assert.throws(()=>smtpMessage(credential.from,{...message,cc:['FIRST@example.test']}));
});

test('SMTP MIME carries approved binary attachments with Unicode names',async()=>{
 const {default:PostalMime}=await import((await import('node:module')).createRequire(new URL('../../imap-client/package.json',import.meta.url)).resolve('postal-mime'));const bytes=Buffer.from([0,255,10,13]);const sha256=(await import('node:crypto')).createHash('sha256').update(bytes).digest('hex');const file={filename:'Смета.bin',content_type:'application/octet-stream',content_base64:bytes.toString('base64'),sha256};const parsed=await PostalMime.parse(smtpMessage(credential.from,{...content,attachments:[file,file]}));assert.equal(parsed.attachments.length,2);for(const a of parsed.attachments){assert.equal(a.filename,file.filename);assert.deepEqual(Buffer.from(a.content),bytes)};
});
