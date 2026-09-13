import tls from 'node:tls';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {SelectedImapReader} from '../src/client.ts';

const raw='From: sender@example.test\r\nTo: Team: owner@example.test;\r\nReply-To: Support <help@example.test>\r\nMessage-ID: <source@example.test>\r\nSubject: =?UTF-8?B?0KLQtdC80LA=?=\r\nDate: Fri, 11 Sep 2026 10:00:00 +0000\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nOriginal body.\r\n';
const source=Buffer.from(raw),commands=[],sockets=new Set();
let mode='normal',opens=0,live=true;
const server=tls.createServer({cert:readFileSync(process.argv[2]),key:readFileSync(process.argv[3])},socket=>{
  sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});
  socket.write('* OK IMAP4rev1 fixture\r\n');let buffer='';
  socket.on('data',data=>{
    buffer+=data;
    for (;;) {
      const end=buffer.indexOf('\r\n');if(end<0)break;
      const line=buffer.slice(0,end);buffer=buffer.slice(end+2);
      const [tag,...parts]=line.split(' '),command=parts.join(' ');
      commands.push(parts[0]==='LOGIN'?'LOGIN':command);
      let reply='';
      if(command==='CAPABILITY')reply='* CAPABILITY IMAP4rev1\r\n';
      else if(command.startsWith('LOGIN '))assert.equal(command,'LOGIN "owner" "password"');
      else if(command.startsWith('LIST '))reply='* LIST () "/" "INBOX"\r\n';
      else if(command.startsWith('LSUB '))reply='* LSUB () "/" "INBOX"\r\n';
      else if(command.startsWith('EXAMINE ')){
        opens++;reply='* FLAGS (\\Seen)\r\n* 1 EXISTS\r\n* OK [UIDVALIDITY '+(mode==='changed'&&opens>1?'43':'42')+'] validity\r\n* OK [UIDNEXT 8] next\r\n';
      } else if(command.startsWith('FETCH ')&&!command.includes('BODY')) {
        reply='* 1 FETCH (UID 7 RFC822.SIZE '+source.length+' INTERNALDATE "11-Sep-2026 10:00:00 +0000")\r\n';
      } else if(command.startsWith('UID FETCH ')&&command.includes('BODY.PEEK[]')) {
        if(mode==='revoked')live=false;
        reply='* 1 FETCH (UID 7 BODY[] {'+source.length+'}\r\n'+raw+')\r\n';
      } else {socket.write(tag+' BAD unsupported\r\n');continue;}
      socket.write(reply+tag+' OK '+(command.startsWith('EXAMINE ')?'[READ-ONLY] ':'')+'done\r\n');
    }
  });
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const make=()=>new SelectedImapReader({host:'localhost',port:server.address().port,provider:'imap'},
  {username:'owner',password:'password'},'INBOX',async()=>{if(!live)throw Error('revoked');});
try {
  await make().checkMailbox();assert(!commands.some(command=>command.includes('FETCH')));opens=0;
  const result=await make().readSelection({limit:1});
  assert.equal(result.messages[0].message_id,'42:7');
  assert.equal(result.messages[0].body.trim(),'Original body.');
  assert.equal(result.messages[0].subject,'Тема');
  assert.deepEqual(result.messages[0].to,[{name:'',address:'owner@example.test'}]);
  assert.deepEqual(result.messages[0].reply_to,[{name:'Support',address:'help@example.test'}]);
  assert.equal(result.messages[0].internet_message_id,'<source@example.test>');
  assert.equal(result.messages[0].attachment_metadata_included,true);
  assert.equal(result.truncated,false);
  assert(commands.includes('EXAMINE INBOX'));
  assert(commands.some(c=>c.startsWith('UID FETCH ')&&c.includes('BODY.PEEK[]')));
  assert(!commands.some(c=>/^(SELECT|STORE|APPEND|EXPUNGE|DELETE|CLOSE)\b/.test(c)));
  mode='changed';opens=0;await assert.rejects(make().readSelection({limit:1}),/unavailable or changed/);
  mode='revoked';opens=0;await assert.rejects(make().readSelection({limit:1}),/unavailable or changed/);
  const before=commands.length;await assert.rejects(make().readSelection({limit:1}),/revoked/);assert.equal(commands.length,before);
} finally {for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));}
