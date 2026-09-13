/** Provider-independent attachment metadata. Names and media types are untrusted data. */
export interface MailAttachment {
  /** Identifier valid only inside this message and selected mail connection. */
  attachment_id:string;
  /** Decoded original name, or null when absent; never an output path. */
  filename:string|null;
  /** Media type reported by the source. */
  content_type:string;
  /** Decoded size for MIME files; provider-reported size for Graph items/references. */
  size:number;
  /** Embedded file, embedded mail/calendar/contact item, or external reference. */
  kind:'file'|'item'|'reference';
  /** Whether the attachment is embedded in the displayed message body. */
  is_inline:boolean;
  /** Digest of decoded bytes when already available; null is not an integrity assertion. */
  sha256:string|null;
}

/** Request one bounded binary chunk from a message in the unchanged selected page. */
export interface MailAttachmentRequest {
  /** Message ID returned by the selected read. */
  message_id:string;
  /** Attachment ID within that message. */
  attachment_id:string;
  /** Zero-based decoded-byte offset. */
  offset:number;
  /** Maximum decoded bytes returned, 1–8192. */
  max_bytes:number;
  /** Required after the first chunk; pins every chunk to the same decoded file. */
  expected_sha256?:string;
}
/** One immutable binary chunk; names are descriptive and never destination paths. */
export interface MailAttachmentChunk {
  /** Selected message identity. */
  message_id:string;
  /** Attachment identity within the selected message. */
  attachment_id:string;
  /** Original filename, not a filesystem path. */
  filename:string|null;
  /** Reported media type. */
  content_type:string;
  /** Actual size of the decoded content. */
  total_size:number;
  /** Digest of the complete decoded file. */
  sha256:string;
  /** Offset of these decoded bytes. */
  offset:number;
  /** Base64-encoded bytes, never text to execute. */
  content_base64:string;
  /** Whether this chunk reaches the end of the file. */
  complete:boolean;
  /** First byte of the next chunk; omitted on completion. */
  next_offset?:number;
}

/** Validate before contacting a provider; subsequent chunks must carry the digest. */
export function validateMailAttachmentRequest(value:MailAttachmentRequest):void {
  if(!value||Object.keys(value).some(key=>!['message_id','attachment_id','offset','max_bytes','expected_sha256'].includes(key))||
    typeof value.message_id!=='string'||!value.message_id||value.message_id.length>255||/[\x00-\x20\x7f]/.test(value.message_id)||
    typeof value.attachment_id!=='string'||!value.attachment_id||value.attachment_id.length>1024||/[\x00-\x20\x7f]/.test(value.attachment_id)||
    !Number.isSafeInteger(value.offset)||value.offset<0||value.offset>2*1024*1024||
    !Number.isInteger(value.max_bytes)||value.max_bytes<1||value.max_bytes>8192||
    value.expected_sha256!==undefined&&!/^[a-f0-9]{64}$/.test(value.expected_sha256)||value.offset>0&&!value.expected_sha256)throw Error('Invalid attachment request.');
}

/** Pin and slice bounded decoded content; never follow external reference URLs. */
export async function mailAttachmentChunk(file:MailAttachment,content:ArrayBuffer|Uint8Array|string,input:MailAttachmentRequest):Promise<MailAttachmentChunk> {
  validateMailAttachmentRequest(input);
  const bytes=content instanceof ArrayBuffer?new Uint8Array(content.slice(0)):content instanceof Uint8Array?new Uint8Array(content):undefined;
  if(!bytes||bytes.length>2*1024*1024||input.offset>bytes.length||input.attachment_id!==file.attachment_id||file.kind==='reference')throw Error('Attachment content unavailable.');
  const digest=await crypto.subtle.digest('SHA-256',bytes),sha256=Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join('');
  if(input.expected_sha256&&input.expected_sha256!==sha256||file.sha256&&file.sha256!==sha256)throw Error('Attachment changed.');
  const end=Math.min(bytes.length,input.offset+input.max_bytes);
  let binary='';for(const byte of bytes.subarray(input.offset,end))binary+=String.fromCharCode(byte);
  return {message_id:input.message_id,attachment_id:file.attachment_id,filename:file.filename,content_type:file.content_type,total_size:bytes.length,sha256,offset:input.offset,content_base64:btoa(binary),complete:end===bytes.length,...(end<bytes.length?{next_offset:end}:{})};
}

/** Normalize attachments from a bounded, already decoded MIME message. */
export async function mimeMailAttachments(files:Array<{filename:string|null;mimeType:string;disposition?:string|null;content:ArrayBuffer|Uint8Array|string}>):Promise<MailAttachment[]> {
  if(files.length>50)throw Error('Too many mail attachments.');
  return Promise.all(files.map(async(file,index)=>{
    const bytes=file.content instanceof ArrayBuffer?new Uint8Array(file.content.slice(0)):file.content instanceof Uint8Array?new Uint8Array(file.content):undefined;
    if(!bytes||bytes.byteLength>2*1024*1024||
       file.filename!==null&&(typeof file.filename!=='string'||new TextEncoder().encode(file.filename).length>4096)||
       typeof file.mimeType!=='string'||file.mimeType.length>255)throw Error('Invalid mail attachment.');
    const digest=await crypto.subtle.digest('SHA-256',bytes);
    return {attachment_id:'mime:'+index,filename:file.filename,content_type:file.mimeType,size:bytes.byteLength,
      kind:file.mimeType==='message/rfc822'?'item' as const:'file' as const,is_inline:file.disposition==='inline',
      sha256:Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join('')};
  }));
}

/** Exact bytes proposed for sending; names are MIME metadata, never local paths. */
export interface MailOutgoingAttachment {
 /** Display filename, without path separators or control characters. */
 filename:string;
 /** Explicit MIME media type. */
 content_type:string;
 /** Canonical base64 of the complete file. */
 content_base64:string;
 /** SHA-256 of the decoded file, shown during approval. */
 sha256:string;
}
/** Enforce the common outgoing envelope: ten files, at most one MiB decoded in total. */
export async function outgoingMailAttachments(input:MailOutgoingAttachment[]|undefined):Promise<MailOutgoingAttachment[]>{
 if(input===undefined)return [];
 if(!Array.isArray(input)||input.length>10)throw Error('Invalid outgoing attachments.');
 let total=0;const result:MailOutgoingAttachment[]=[];
 for(const f of input){
  if(!f||Object.keys(f).some(k=>!['filename','content_type','content_base64','sha256'].includes(k))||typeof f.filename!=='string'||!f.filename.trim()||new TextDecoder().decode(new TextEncoder().encode(f.filename))!==f.filename||new TextEncoder().encode(f.filename).length>255||/[\x00-\x1f\x7f/\\]/.test(f.filename)||typeof f.content_type!=='string'||f.content_type.length>127||!/^[-a-zA-Z0-9!#$&^_.+]+\/[-a-zA-Z0-9!#$&^_.+]+$/.test(f.content_type)||typeof f.content_base64!=='string'||f.content_base64.length>1398104||typeof f.sha256!=='string'||!/^[a-f0-9]{64}$/.test(f.sha256))throw Error('Invalid outgoing attachment.');
  const binary=atob(f.content_base64);if(btoa(binary)!==f.content_base64)throw Error('Invalid attachment encoding.');
  total+=binary.length;if(total>1024*1024)throw Error('Outgoing attachments exceed one MiB.');
  const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
  if(digest!==f.sha256)throw Error('Attachment checksum mismatch.');
  result.push({filename:f.filename,content_type:f.content_type,content_base64:f.content_base64,sha256:f.sha256});
 }
 return result;
}
/** Wrap existing MIME in multipart/mixed, retaining body and threading headers exactly. */
export function attachMailMime(raw:string,files:MailOutgoingAttachment[]):string{
 if(!files.length)return raw;
 const split=raw.indexOf('\r\n\r\n');if(split<0)throw Error('Invalid MIME message.');
 const headers=raw.slice(0,split).split(/\r\n(?![ \t])/),outer=headers.filter(h=>!/^content-|^mime-version:/i.test(h)),inner=headers.filter(h=>/^content-/i.test(h));
 const boundary='mnemos_'+crypto.randomUUID();
 let body=outer.join('\r\n')+'\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="'+boundary+'"\r\n\r\n--'+boundary+'\r\n'+inner.join('\r\n')+'\r\n\r\n'+raw.slice(split+4)+'\r\n';
 for(const f of files){const name=encodeURIComponent(f.filename).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());body+='--'+boundary+'\r\nContent-Type: '+f.content_type+'\r\nContent-Disposition: attachment; filename*=UTF-8\'\''+name+'\r\nContent-Transfer-Encoding: base64\r\n\r\n'+(f.content_base64.match(/.{1,76}/g)?.join('\r\n')??'')+'\r\n';}
 return body+'--'+boundary+'--\r\n';
}
