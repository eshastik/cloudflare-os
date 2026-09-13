import {outgoingMailAttachments,attachMailMime} from '@gadgets/workshop-shared/mail-attachment';
import type {MailDraftContent} from './mail-drafts.ts';
import {validateMailReply,mailReplySubject} from '@gadgets/workshop-shared/mail-reply';

/** Operator-selected submission endpoint. Plaintext authentication is never allowed. */
export interface SmtpServer {host:string;port:number;security:'tls'|'starttls';}
/** Private credential and fixed sender chosen by the human account owner. */
export interface SmtpCredential {username:string;password:string;from:string;}
/** Transport seam; the production adapter uses cloudflare:sockets. */
export interface SmtpSocket {
  readable:ReadableStream<Uint8Array>;
  writable:WritableStream<Uint8Array>;
  opened:Promise<unknown>;
  closed:Promise<unknown>;
  close():Promise<unknown>;
  startTls():SmtpSocket;
}
export type SmtpConnect=(server:SmtpServer)=>SmtpSocket;
const denied=()=>Error('SMTP operation failed or its outcome is unconfirmed.');
const encoder=new TextEncoder();
function address(value:unknown):asserts value is string {
  if(typeof value!=='string'||value.length>254||!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(value))throw denied();
  const [local,domain]=value.split('@');
  if(local.length>64||local.startsWith('.')||local.endsWith('.')||local.includes('..')||domain.split('.').some(label=>!label||label.length>63||label.startsWith('-')||label.endsWith('-')))throw denied();
}
function base64(bytes:Uint8Array){let result='';for(const byte of bytes)result+=String.fromCharCode(byte);return btoa(result);}
function encodedSubject(subject:string){
  const words:string[]=[];let chunk='';
  for(const char of subject){if(encoder.encode(chunk+char).length>42){words.push('=?UTF-8?B?'+base64(encoder.encode(chunk))+'?=');chunk='';}chunk+=char;}
  if(chunk)words.push('=?UTF-8?B?'+base64(encoder.encode(chunk))+'?=');
  return words.join('\r\n ');
}
/** A base64 MIME body preserves the exact approved text, including its newlines. */
export function smtpMessage(from:string,input:MailDraftContent):Uint8Array {
  address(from);
  if(!input||Object.keys(input).some(key=>!['to','cc','subject','body','reply','attachments'].includes(key))||!Array.isArray(input.to)||input.to.length<1||input.to.length>100||input.cc!==undefined&&(!Array.isArray(input.cc)||input.to.length+input.cc.length>100))throw denied();
  if(input.reply){validateMailReply(input.reply);if(input.subject!==mailReplySubject(input.reply.subject))throw denied();}
  const recipients=[...input.to,...(input.cc??[])];recipients.forEach(address);
  if(new Set(recipients.map(value=>value.toLowerCase())).size!==recipients.length||typeof input.subject!=='string'||!input.subject.trim()||!input.subject.isWellFormed()||/[\r\n\0]/.test(input.subject)||encoder.encode(input.subject).length>998||
      typeof input.body!=='string'||!input.body.isWellFormed()||input.body.includes('\0')||encoder.encode(input.body).length>256*1024)throw denied();
  const body=base64(encoder.encode(input.body)).match(/.{1,76}/g)?.join('\r\n')??'';
  return encoder.encode(attachMailMime(['From: '+from,'To: '+input.to.join(',\r\n '),...(input.cc?.length?['Cc: '+input.cc.join(',\r\n ')]:[]),'Subject: '+encodedSubject(input.subject),
    'Date: '+new Date().toUTCString(),'Message-ID: <'+crypto.randomUUID()+'@'+from.split('@')[1]+'>',
    ...(input.reply?['In-Reply-To: '+input.reply.internet_message_id,'References: '+input.reply.references.join('\r\n ')]:[]),
    'MIME-Version: 1.0','Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',body,''].join('\r\n'),input.attachments??[]));
}

/** One connection and one submission at most. Callers must persist the attempt
 * before send(); no transport error or partial rejection authorizes a retry. */
export class SmtpClient {
  #server:SmtpServer;#credential:SmtpCredential;#connect:SmtpConnect;#validate:()=>Promise<void>;
  constructor(server:SmtpServer,credential:SmtpCredential,connect:SmtpConnect,validate:()=>Promise<void>){
    if(!server||typeof server.host!=='string'||!/^(?=.{1,253}$)[a-zA-Z0-9]+(?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(server.host)||!Number.isInteger(server.port)||server.port<1||server.port>65535||!['tls','starttls'].includes(server.security)||
        !credential||typeof credential.username!=='string'||!credential.username||credential.username.length>255||typeof credential.password!=='string'||!credential.password||credential.password.length>4096||/[\x00\r\n]/.test(credential.username+credential.password))throw denied();
    address(credential.from);
    this.#server={...server};this.#credential={...credential};this.#connect=connect;this.#validate=validate;
  }
  async check(){await this.#run();}
  async send(input:MailDraftContent){
    const content=structuredClone(input);await outgoingMailAttachments(content.attachments);const message=smtpMessage(this.#credential.from,content);
    await this.#run({content,message});return {accepted:true as const};
  }
  async #run(send?:{content:MailDraftContent;message:Uint8Array}){
    await this.#validate();
    let socket:SmtpSocket|undefined,reader:ReadableStreamDefaultReader<Uint8Array>|undefined,writer:WritableStreamDefaultWriter<Uint8Array>|undefined;
    let pending='',received=0,expired=false;
    const timer=setTimeout(()=>{expired=true;void socket?.close().catch(()=>{});},30000);
    const validate=async()=>{await this.#validate();if(expired)throw denied();};
    const attach=(value:SmtpSocket)=>{socket=value;void socket.closed.catch(()=>{});reader=socket.readable.getReader();writer=socket.writable.getWriter();};
    const line=async()=>{
      for(;;){
        const end=pending.indexOf('\r\n');
        if(end>=0){if(end>2048)throw denied();const value=pending.slice(0,end);pending=pending.slice(end+2);return value;}
        if(pending.length>2048)throw denied();
        const value=await reader!.read();if(value.done)throw denied();received+=value.value.length;if(received>64*1024)throw denied();
        // SMTP replies are protocol text. Reject control bytes and embedded bare LF.
        for(const byte of value.value){if(byte!==9&&byte!==10&&byte!==13&&(byte<32||byte>126))throw denied();pending+=String.fromCharCode(byte);}
      }
    };
    const reply=async(expected:number[])=>{
      const lines:string[]=[];let code='';
      for(let i=0;i<64;i++){
        const value=await line(),match=/^([2-5][0-9]{2})(?:([ -])(.*))?$/.exec(value);
        if(!match||code&&code!==match[1])throw denied();code=match[1];lines.push(match[3]??'');
        if(match[2]!=='-'){if(!expected.includes(Number(code)))throw denied();return lines;}
      }
      throw denied();
    };
    const command=async(value:string,codes:number[])=>{await validate();await writer!.write(encoder.encode(value+'\r\n'));return reply(codes);};
    try{
      attach(this.#connect(this.#server));await socket!.opened;
      await reply([220]);
      const ehlo='EHLO '+this.#credential.from.split('@')[1];
      let capabilities=await command(ehlo,[250]);
      if(this.#server.security==='starttls'){
        if(!capabilities.some(line=>/^STARTTLS(?:\s|$)/i.test(line)))throw denied();
        await command('STARTTLS',[220]);
        if(pending)throw denied();
        reader!.releaseLock();writer!.releaseLock();
        attach(socket!.startTls());await socket!.opened;
        // Pre-TLS capabilities are discarded; authenticate only after fresh EHLO.
        capabilities=await command(ehlo,[250]);
      }
      const auth=capabilities.filter(line=>/^AUTH[ =]/i.test(line)).flatMap(line=>line.replace(/^AUTH[ =]/i,'').toUpperCase().split(/\s+/));
      if(auth.includes('PLAIN')){
        await command('AUTH PLAIN',[334]);
        await command(base64(encoder.encode('\0'+this.#credential.username+'\0'+this.#credential.password)),[235]);
      }else if(auth.includes('LOGIN')){
        await command('AUTH LOGIN',[334]);
        await command(base64(encoder.encode(this.#credential.username)),[334]);
        await command(base64(encoder.encode(this.#credential.password)),[235]);
      }else throw denied();
      if(send){
        await command('MAIL FROM:<'+this.#credential.from+'>',[250]);
        for(const to of [...send.content.to,...(send.content.cc??[])])await command('RCPT TO:<'+to+'>',[250,251,252]);
        await command('DATA',[354]);await validate();
        // MIME is entirely ASCII with a base64 body: no line can be a DATA terminator.
        const ending=encoder.encode('.\r\n'),wire=new Uint8Array(send.message.length+ending.length);
        wire.set(send.message);wire.set(ending,send.message.length);await writer!.write(wire);
        await reply([250]);
      }
      await validate();
    }catch{throw denied();}
    finally{clearTimeout(timer);reader?.releaseLock();writer?.releaseLock();await socket?.close().catch(()=>{});}
  }
}
