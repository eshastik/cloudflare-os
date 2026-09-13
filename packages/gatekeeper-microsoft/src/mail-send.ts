import {outgoingMailAttachments} from '@gadgets/workshop-shared/mail-attachment';
import type {MailSendSource} from '@gadgets/workshop-shared/gatekeeper';
import {validateMailReply,mailReplySubject} from '@gadgets/workshop-shared/mail-reply';
/** Fixed Microsoft Graph write, using only the account's delegated token. */
export async function sendApprovedOutlook(input:Parameters<MailSendSource['send']>[0],token:()=>Promise<string>,validate:()=>Promise<void>,fetcher:typeof fetch=fetch):ReturnType<MailSendSource['send']>{
 const content=structuredClone(input);
 if(!content||Object.keys(content).some(key=>!['to','cc','subject','body','reply','attachments'].includes(key))||!Array.isArray(content.to)||content.to.length<1||content.to.length>100||content.cc!==undefined&&(!Array.isArray(content.cc)||content.to.length+content.cc.length>100)||[...content.to,...(content.cc??[])].some(to=>typeof to!=='string'||to.length>254||!/^[^\s<>@]+@[^\s<>@]+$/.test(to)||/[\x00-\x1f\x7f]/.test(to))||typeof content.subject!=='string'||!content.subject.trim()||/[\r\n\0]/.test(content.subject)||new TextEncoder().encode(content.subject).length>998||typeof content.body!=='string'||content.body.includes('\0')||new TextEncoder().encode(content.body).length>256*1024)throw Error('Invalid outgoing mail.');
 const attachments=await outgoingMailAttachments(content.attachments);
 const recipients=[...content.to,...(content.cc??[])];
 if(new Set(recipients.map(value=>value.toLowerCase())).size!==recipients.length)throw Error('Duplicate outgoing recipient.');
 if(content.reply){validateMailReply(content.reply);if(content.subject!==mailReplySubject(content.reply.subject))throw Error('Invalid reply subject.');}
 const body=JSON.stringify({message:{subject:content.subject,body:{contentType:'Text',content:content.body},toRecipients:content.to.map(address=>({emailAddress:{address}})),ccRecipients:(content.cc??[]).map(address=>({emailAddress:{address}})),bccRecipients:[],...(attachments.length?{attachments:attachments.map(f=>({'@odata.type':'#microsoft.graph.fileAttachment',name:f.filename,contentType:f.content_type,contentBytes:f.content_base64,isInline:false}))}:{})}});
 await validate();const accessToken=await token();await validate();
 if(typeof accessToken!=='string'||!accessToken||/[\s\x00-\x1f\x7f]/.test(accessToken))throw Error('Microsoft credentials unavailable.');
 let response:Response;
 const endpoint=content.reply?'/me/messages/'+encodeURIComponent(content.reply.message_id)+'/reply':'/me/sendMail';
 try{response=await fetcher('https://graph.microsoft.com/v1.0'+endpoint,{method:'POST',headers:{Authorization:'Bearer '+accessToken,'Content-Type':'application/json',Prefer:'IdType="ImmutableId"'},body,redirect:'manual',signal:AbortSignal.timeout(15000)});}catch{throw Error('Mail send outcome is unconfirmed.');}
 // Microsoft returns no message ID or response body. Never fabricate an ID.
 await response.body?.cancel();
 if(response.status!==202)throw Error('Mail send outcome is unconfirmed.');
 await validate();return {accepted:true};
}
