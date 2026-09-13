import net from 'node:net';
import tls from 'node:tls';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {SmtpClient} from '../src/smtp-client.ts';

import {smtpFixture} from './smtp-fixture.mjs';
// A demand-driven Node adapter tests the protocol without disabling certificate
// validation. Production uses cloudflare:sockets, not this test adapter.
function wrap(socket,host){
  socket.pause();socket.on('error',()=>{});
  const opened=new Promise((resolve,reject)=>{socket.once(socket instanceof tls.TLSSocket?'secureConnect':'connect',resolve);socket.once('error',reject);});
  const closed=new Promise(resolve=>socket.once('close',resolve));
  let pending=false;
  const readable=new ReadableStream({pull(controller){
    pending=true;
    return new Promise(resolve=>{
      const cleanup=()=>{pending=false;socket.removeListener('data',data);socket.removeListener('error',error);socket.removeListener('end',end);};
      const data=bytes=>{socket.pause();cleanup();controller.enqueue(new Uint8Array(bytes));resolve();};
      const error=()=>{cleanup();controller.error(Error('transport unavailable'));resolve();};
      const end=()=>{cleanup();controller.close();resolve();};
      socket.once('data',data);socket.once('error',error);socket.once('end',end);socket.resume();
    });
  }},{highWaterMark:0});
  const writable=new WritableStream({write(bytes){return new Promise((resolve,reject)=>socket.write(bytes,error=>error?reject(error):resolve()));}});
  return {readable,writable,opened,closed,close:async()=>{socket.destroy();await closed;},startTls(){assert.equal(pending,false);return wrap(tls.connect({socket,servername:host}),host);}};
}
const connect=server=>wrap(server.security==='tls'?tls.connect({host:server.host,port:server.port,servername:server.host}):net.createConnection({host:server.host,port:server.port}),server.host);
const credential={username:'owner',password:'password',from:'owner@example.test'};
const content={to:['recipient@example.test'],subject:'TLS fixture',body:'Exact approved body\n.\r\nКонец'};
for(const security of ['tls','starttls']){
  const fixture=await smtpFixture(readFileSync(process.argv[2]),readFileSync(process.argv[3]),security);
  const {messages,commands}=fixture;
  try{
    const before=messages.length;
    const client=new SmtpClient({host:'localhost',port:fixture.port,security},credential,connect,async()=>{});
    await client.check();assert.equal(messages.length,before);
    assert.deepEqual(await client.send(content),{accepted:true});assert.equal(messages.length,before+1);
    const raw=messages.at(-1),body=raw.slice(raw.indexOf('\r\n\r\n')+4);
    assert.equal(Buffer.from(body.replace(/\s/g,''),'base64').toString(),content.body);
    if(security==='starttls')assert(commands.some(command=>command.name==='STARTTLS'&&!command.secure));
    assert(commands.filter(command=>command.name==='AUTH').every(command=>command.secure));
  }finally{await fixture.close();}
}
