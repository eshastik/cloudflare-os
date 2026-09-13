/** Human voice metadata; core manifests and provider credentials are never exposed. */
export interface VoiceSource {request_id:string;project_id:string;media_type:string;size_bytes:number;sha256:string}
/** Immutable text version. This is not an instruction or execution approval. */
export interface VoiceTranscript {source_request_id:string;revision:number;operation_id:string;kind:'human'|'provider';text:string;provider:string;model_id:string;provider_request_id:string;uncertain:boolean}
/** Historical review receipt; current must be checked again before execution. */
export interface VoiceConfirmation {source_request_id:string;operation_id:string;revision:number;text_sha256:string;current:boolean}
export interface VoiceEdit {operation_id:string;expected_revision:number;text:string;uncertain:boolean}
export interface VoiceConfirm {operation_id:string;revision:number;text_sha256:string;confirmed:boolean}
export function voiceRecord(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid voice response.');return value as Record<string,unknown>;}
export function voiceID(value:unknown):value is string{return typeof value==='string'&&value.length>0&&value.length<=255&&!/[\x00-\x1f]/.test(value);}
export function voiceRevision(value:unknown):value is number{return typeof value==='number'&&Number.isSafeInteger(value)&&value>0;}
export function voiceHash(value:unknown):value is string{return typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);}
export function checkedVoiceSource(value:unknown,request:string,project:string,mime:string):VoiceSource{
 const r=voiceRecord(value);if(r.request_id!==request||r.project_id!==project||r.media_type!==mime||!voiceRevision(r.size_bytes)||!voiceHash(r.sha256))throw Error('Invalid voice source.');
 return {request_id:request,project_id:project,media_type:mime,size_bytes:r.size_bytes,sha256:r.sha256};
}
export function checkedVoiceTranscript(value:unknown,source:string,revision:number):VoiceTranscript{
 const r=voiceRecord(value);if(r.source_request_id!==source||r.revision!==revision||!voiceID(r.operation_id)||!['human','provider'].includes(String(r.kind))||typeof r.text!=='string'||!r.text.trim()||r.text.includes('\0')||new TextEncoder().encode(r.text).length>65536||typeof r.uncertain!=='boolean'||
 (r.kind==='human'?(r.provider!==''||r.model_id!==''||r.provider_request_id!==''):(!voiceID(r.provider)||!voiceID(r.model_id)||!voiceID(r.provider_request_id))))throw Error('Invalid voice transcript.');
 return {source_request_id:source,revision,operation_id:r.operation_id,kind:r.kind as VoiceTranscript['kind'],text:r.text,provider:r.provider as string,model_id:r.model_id as string,provider_request_id:r.provider_request_id as string,uncertain:r.uncertain};
}
export function checkedVoiceConfirmation(value:unknown,source:string,operation:string):VoiceConfirmation{
 const r=voiceRecord(value);if(r.source_request_id!==source||r.operation_id!==operation||!voiceRevision(r.revision)||!voiceHash(r.text_sha256)||typeof r.current!=='boolean')throw Error('Invalid voice confirmation.');
 return {source_request_id:source,operation_id:operation,revision:r.revision,text_sha256:r.text_sha256,current:r.current};
}

/** Short-lived original playback ticket, pinned to the imported source. */
export interface VoiceDownload {request_id:string;project_id:string;content_type:string;url:string;method:'GET';size_bytes:number;sha256_hex:string;expires_at:string}
export function checkedVoiceDownload(value:unknown,source:VoiceSource):VoiceDownload{
 const r=voiceRecord(value);if(r.request_id!==source.request_id||r.project_id!==source.project_id||r.content_type!==source.media_type||r.size_bytes!==source.size_bytes||r.sha256_hex!==source.sha256||r.method!=='GET'||typeof r.url!=='string'||typeof r.expires_at!=='string'||!Number.isFinite(Date.parse(r.expires_at))||Date.parse(r.expires_at)<=Date.now())throw Error('Invalid voice download.');
 const url=new URL(r.url);if(url.protocol!=='https:'||url.username||url.password||url.hash)throw Error('Invalid voice download.');
 return {request_id:source.request_id,project_id:source.project_id,content_type:source.media_type,url:r.url,method:'GET',size_bytes:source.size_bytes,sha256_hex:source.sha256,expires_at:r.expires_at};
}
