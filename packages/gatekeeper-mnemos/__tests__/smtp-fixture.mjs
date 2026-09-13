import net from 'node:net';
import tls from 'node:tls';
import assert from 'node:assert/strict';
export async function smtpFixture(cert,key,security){
const state={dropAck:false};
const secureContext=tls.createSecureContext({cert:cert,key:key});
const sockets=new Set(),messages=[],commands=[];
function serve(socket,secure,greet){
  sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});
  if(greet)socket.write('220 local fixture\r\n');
  let buffer='',auth=false,data=false;
  function receive(bytes){
    buffer+=bytes.toString();
    for(;;){
      if(data){const end=buffer.indexOf('\r\n.\r\n');if(end<0)return;messages.push(buffer.slice(0,end+2));buffer=buffer.slice(end+5);data=false;if(state.dropAck)socket.destroy();else socket.write('250 accepted\r\n');continue;}
      const end=buffer.indexOf('\r\n');if(end<0)return;
      const line=buffer.slice(0,end);buffer=buffer.slice(end+2);
      if(auth){assert(secure);assert.equal(Buffer.from(line,'base64').toString(),'\0owner\0password');auth=false;socket.write('235 authenticated\r\n');continue;}
      commands.push({name:line.split(' ')[0],secure});
      if(line.startsWith('EHLO '))socket.write('250-fixture\r\n'+(secure?'':'250-STARTTLS\r\n')+'250 AUTH PLAIN\r\n');
      else if(line==='STARTTLS'){
        assert(!secure);assert.equal(buffer,'');socket.removeListener('data',receive);
        socket.write('220 upgrade\r\n',()=>serve(new tls.TLSSocket(socket,{isServer:true,secureContext}),true,false));return;
      }else if(line==='AUTH PLAIN'){assert(secure);auth=true;socket.write('334 \r\n');}
      else if(line.startsWith('MAIL FROM:')||line.startsWith('RCPT TO:'))socket.write('250 ok\r\n');
      else if(line==='DATA'){data=true;socket.write('354 body\r\n');}
      else socket.write('500 unexpected\r\n');
    }
  }
  socket.on('data',receive);
}

const server=security==='tls'?tls.createServer({cert,key},socket=>serve(socket,true,true)):net.createServer(socket=>serve(socket,false,true));
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
return {state,messages,commands,port:server.address().port,close:async()=>{for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));}};
}
