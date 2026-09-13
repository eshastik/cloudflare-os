import type {MailMessage} from './mail-message.ts';
import {validateMailAttachmentRequest,type MailAttachmentRequest} from '@gadgets/workshop-shared/mail-attachment';

/** AND-combined filters evaluated identically on decoded messages from every provider. */
export interface MailSearch {
  /** Case-insensitive literal substring of subject or complete decoded body. */
  text?: string;
  /** Case-insensitive literal substring of the decoded subject. */
  subject?: string;
  /** Exact sender mailbox address, ignoring case. */
  from?: string;
  /** Inclusive received timestamp, RFC3339 with an explicit offset. */
  after?: string;
  /** Exclusive received timestamp, RFC3339 with an explicit offset. */
  before?: string;
}
/** One bounded scan page; unmatched pages may be empty while still having a next cursor. */
export interface MailReadRequest {
  /** Maximum source messages scanned and maximum matches returned, from 1 to 10. */
  limit: number;
  /** Continuation for this selection and these exact filters. */
  cursor?: string;
  /** Common filters; cannot replace the owner's selected folder or query. */
  search?: MailSearch;
  /** Read a binary chunk from a message in this same page, returning no message bodies. */
  attachment?:MailAttachmentRequest;
}
const fold=(value:string)=>value.normalize('NFC').toLowerCase();
/** Validate and canonicalize filters before provider IO. */
export function normalizeMailSearch(input:MailSearch={}):MailSearch{
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['text','subject','from','after','before'].includes(key)))throw Error('Invalid mail search.');
 const result:MailSearch={};
 for(const key of ['text','subject','from'] as const){const value=input[key];if(value===undefined)continue;if(typeof value!=='string'||!value.trim()||/[\x00-\x1f\x7f]/.test(value)||new TextEncoder().encode(value).length>512)throw Error('Invalid mail search.');result[key]=fold(value.trim());}
 if(result.from&&!/^[^\s<>@]+@[^\s<>@]+$/.test(result.from))throw Error('Invalid sender search.');
 for(const key of ['after','before'] as const){const value=input[key];if(value===undefined)continue;if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(value)||!Number.isFinite(Date.parse(value)))throw Error('Invalid mail search date.');const day=new Date(value.slice(0,10)+'T00:00:00Z');if(day.toISOString().slice(0,10)!==value.slice(0,10))throw Error('Invalid mail search date.');result[key]=new Date(value).toISOString();}
 if(result.after&&result.before&&result.after>=result.before)throw Error('Invalid mail search interval.');
 return result;
}
/** Common literal matching; use the complete decoded body, before display clipping. */
export function matchesMailSearch(message:Pick<MailMessage,'subject'|'from'|'received_at'>,body:string,search:MailSearch):boolean{
 if(search.from&&!message.from.some(from=>fold(from.address)===search.from))return false;
 if(search.subject&&!fold(message.subject).includes(search.subject))return false;
 if(search.text&&!fold(message.subject).includes(search.text)&&!fold(body).includes(search.text))return false;
 if(search.after&&message.received_at<search.after||search.before&&message.received_at>=search.before)return false;
 return true;
}
/** Reject unsupported input fields and malformed provider continuation data before IO. */
export function validateMailReadRequest(input:MailReadRequest):MailSearch{
 if(!input||Object.keys(input).some(key=>!['limit','cursor','search','attachment'].includes(key))||!Number.isInteger(input.limit)||input.limit<1||input.limit>10||input.cursor!==undefined&&(typeof input.cursor!=='string'||!input.cursor||input.cursor.length>8192||/[\x00-\x20\x7f]/.test(input.cursor)))throw Error('Invalid mail page.');
 if(input.attachment!==undefined)validateMailAttachmentRequest(input.attachment);
 return normalizeMailSearch(input.search);
}
