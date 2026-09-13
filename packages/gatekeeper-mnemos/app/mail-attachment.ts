import type {MailAttachment} from '@gadgets/workshop-shared/mail-attachment';
import type {MailMessagePage,MailMessageQuery} from '../src/mail-connections.ts';
/** Assemble one selected file; never expose a partial or unverified download. */
export async function readMailAttachment(read:(query:MailMessageQuery)=>Promise<MailMessagePage>,query:MailMessageQuery,
 message:string,file:MailAttachment,expected:{provider:string;query_sha256:string},active:()=>boolean):Promise<Uint8Array>{
 if(file.kind==='reference')throw Error('External attachment unavailable.');
 let bytes:Uint8Array|undefined,hash=file.sha256??undefined,offset=0;
 for(let part=0;part<=256;part++){
  if(!active())throw Error('Mail view closed.');
  const result=await read({...query,attachment:{message_id:message,attachment_id:file.attachment_id,offset,max_bytes:8192,...(hash?{expected_sha256:hash}:{})}});
  if(!active())throw Error('Mail view closed.');
  const chunk=result.attachment;
  if(result.provider!==expected.provider||result.query_sha256!==expected.query_sha256||result.messages.length||!chunk||
    chunk.message_id!==message||chunk.attachment_id!==file.attachment_id||chunk.offset!==offset||
    !Number.isSafeInteger(chunk.total_size)||chunk.total_size<0||chunk.total_size>2*1024*1024||
    !/^[a-f0-9]{64}$/.test(chunk.sha256)||hash&&hash!==chunk.sha256||bytes&&bytes.length!==chunk.total_size||
    typeof chunk.content_base64!=='string'||chunk.content_base64.length>10924)throw Error('Attachment changed.');
  hash=chunk.sha256;bytes??=new Uint8Array(chunk.total_size);
  const binary=atob(chunk.content_base64),data=Uint8Array.from(binary,c=>c.charCodeAt(0));
  if(btoa(binary)!==chunk.content_base64||data.length>8192||offset+data.length>bytes.length)throw Error('Invalid attachment bytes.');
  bytes.set(data,offset);offset+=data.length;
  if(chunk.complete===true){
   if(offset!==bytes.length||chunk.next_offset!==undefined)throw Error('Incomplete attachment.');
   const actual=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as Uint8Array<ArrayBuffer>)),n=>n.toString(16).padStart(2,'0')).join('');
   if(!active()||actual!==hash)throw Error('Attachment checksum mismatch.');
   return bytes;
  }
  if(chunk.complete!==false||!data.length||offset>=bytes.length||chunk.next_offset!==offset)throw Error('Invalid attachment continuation.');
 }
 throw Error('Attachment exceeds chunk limit.');
}
