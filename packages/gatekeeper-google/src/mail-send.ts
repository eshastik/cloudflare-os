import {outgoingMailAttachments,attachMailMime} from '@gadgets/workshop-shared/mail-attachment';
import {GmailApi} from './google-api';
import type {MailSendSource} from '@gadgets/workshop-shared/gatekeeper';
import {validateMailReply,mailReplySubject} from '@gadgets/workshop-shared/mail-reply';

/** Sends an already approved proposal using the account-owned Gmail MIME builder. */
export async function sendApprovedGmail(api:Pick<GmailApi,'buildSendRaw'|'sendRawMessage'>,input:Parameters<MailSendSource['send']>[0],validate:()=>Promise<void>){
 if(!input||Object.keys(input).some(key=>!['to','cc','subject','body','reply','attachments'].includes(key))||!Array.isArray(input.to)||input.to.length<1||input.to.length>100||input.cc!==undefined&&(!Array.isArray(input.cc)||input.to.length+input.cc.length>100)||[...input.to,...(input.cc??[])].some(to=>typeof to!=='string'||to.length>254||/[\r\n\0]/.test(to))||typeof input.subject!=='string'||!input.subject.trim()||/[\r\n\0]/.test(input.subject)||new TextEncoder().encode(input.subject).length>998||typeof input.body!=='string'||input.body.includes('\0')||new TextEncoder().encode(input.body).length>256*1024)throw Error('Invalid outgoing mail.');
 const content=structuredClone(input);const attachments=await outgoingMailAttachments(content.attachments);
 if(content.reply){validateMailReply(content.reply);if(!content.reply.thread_id||!/^[A-Za-z0-9_-]{1,255}$/.test(content.reply.thread_id)||content.subject!==mailReplySubject(content.reply.subject))throw Error('Invalid reply source.');}
 await validate();
 const message=api.buildSendRaw(content.to,content.subject,content.body,content.cc??[]);
 if(JSON.stringify(message.to)!==JSON.stringify(content.to)||JSON.stringify(message.cc??[])!==JSON.stringify(content.cc??[])||message.subject!==content.subject||message.body!==content.body)throw Error('Outgoing mail differs from approval.');
 await validate();
 let raw=message.raw;
 if(attachments.length)raw=btoa(attachMailMime(atob(raw.replace(/-/g,'+').replace(/_/g,'/')),attachments)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
 if(content.reply){
  const headers='In-Reply-To: '+content.reply.internet_message_id+'\r\nReferences: '+content.reply.references.join('\r\n ')+'\r\n';
  raw=btoa(headers+atob(raw.replace(/-/g,'+').replace(/_/g,'/'))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
 }
 let result:Awaited<ReturnType<GmailApi['sendRawMessage']>>;
 try{result=content.reply?await api.sendRawMessage(raw,content.reply.thread_id):await api.sendRawMessage(raw);}catch{throw Error('Mail send outcome is unconfirmed.');}
 if(!result||typeof result.id!=='string'||!/^[A-Za-z0-9_-]{1,255}$/.test(result.id))throw Error('Mail send outcome is unconfirmed.');
 await validate();
 return {accepted:true as const,message_id:result.id};
}
