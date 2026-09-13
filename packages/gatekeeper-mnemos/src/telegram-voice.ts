/** Cloud Bot API download ceiling; checked against metadata and actual streamed bytes. */
export const TELEGRAM_VOICE_MAX_BYTES=20_000_000;
/** Immutable Telegram metadata kept alongside the original audio, not a download URL.
 * MIME and duration are sender declarations, not verified decoder results. */
export interface TelegramVoiceSource {
 file_id:string;
 file_unique_id:string;
 duration:number;
 mime_type?:string;
 file_size?:number;
}
/** Parse voice metadata only; the caller must authenticate the webhook and private sender. */
export function parseTelegramVoice(value:unknown):TelegramVoiceSource|null {
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const v=value as Record<string,unknown>;
 const id=(x:unknown):x is string=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,1024}$/.test(x);
 if(!id(v.file_id)||!id(v.file_unique_id)||!Number.isSafeInteger(v.duration)||(v.duration as number)<0||
  v.file_size!==undefined&&(!Number.isSafeInteger(v.file_size)||(v.file_size as number)<1||(v.file_size as number)>TELEGRAM_VOICE_MAX_BYTES)||
  v.mime_type!==undefined&&(typeof v.mime_type!=='string'||!/^audio\/[A-Za-z0-9.+-]{1,100}$/.test(v.mime_type)))return null;
 return {file_id:v.file_id,file_unique_id:v.file_unique_id,duration:v.duration as number,
  ...(v.file_size===undefined?{}:{file_size:v.file_size as number}),...(v.mime_type===undefined?{}:{mime_type:v.mime_type as string})};
}
