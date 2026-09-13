/** Immutable source coordinates captured by Mnemos when a selected message is read. */
export interface MailReplyTarget {
  /** Provider message identity, scoped to the sending account. */
  message_id: string;
  /** Gmail conversation identity when supplied by that source. */
  thread_id?: string;
  /** Original RFC Message-ID. */
  internet_message_id: string;
  /** RFC ancestor identifiers, including the immediate parent. */
  references: string[];
  /** Original decoded subject shown during approval. */
  subject: string;
}

/** Reject injected headers or oversized chains before any submission. */
export function validateMailReply(value: MailReplyTarget): void {
  const id = (s: unknown) => typeof s === 'string' && s.length <= 255 && /^[^\x00-\x20\x7f]+$/.test(s);
  const rfcId = (s: unknown) => typeof s === 'string' && s.length <= 900 && /^<[^<>\s\x00-\x1f\x7f]+@[^<>\s\x00-\x1f\x7f]+>$/.test(s);
  if (!value || Object.keys(value).some(key => !['message_id','thread_id','internet_message_id','references','subject'].includes(key)) ||
      !id(value.message_id) || value.thread_id !== undefined && !id(value.thread_id) || !rfcId(value.internet_message_id) ||
      !Array.isArray(value.references) || value.references.length < 1 || value.references.length > 100 ||
      value.references.some(ref => !rfcId(ref)) || value.references.at(-1) !== value.internet_message_id ||
      typeof value.subject !== 'string' || /[\r\n\0]/.test(value.subject) || new TextEncoder().encode(value.subject).length > 998) {
    throw Error('Reply source is unavailable.');
  }
}

/** Preserve the source subject while marking a reply once. */
export function mailReplySubject(subject: string): string {
  return /^re:/i.test(subject) ? subject : 'Re: ' + subject;
}

/** Resolve visible reply-all recipients from decoded message fields. Unknown aliases
 * cannot be excluded automatically; the caller must show exact recipients for review. */
export function mailReplyAll(message:{from?:unknown;to?:unknown;cc?:unknown;reply_to?:unknown},self:unknown):{to:string[];cc:string[]}|undefined {
  const valid=(value:unknown):value is string=>typeof value==='string'&&value.length<=254&&/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(value);
  if(!Array.isArray(self)||self.length===0||self.length>100||!self.every(valid))return;
  const seen=new Set<string>(self.map(value=>value.toLowerCase()));
  const values=(input:unknown):string[]=>{
    if(!Array.isArray(input)||input.length>100||input.some(value=>!value||!valid(value.address)))throw Error('Invalid reply recipients.');
    return input.map(value=>value.address);
  };
  const unique=(input:string[])=>input.filter(value=>{const key=value.toLowerCase();if(seen.has(key))return false;seen.add(key);return true;});
  try {
    const reply=values(message.reply_to??[]),from=values(message.from??[]);
    const to=unique([...(reply.length?reply:from),...values(message.to??[])]);
    const cc=unique(values(message.cc??[]));
    // A sent message can have only copied recipients after removing self.
    if(!to.length&&cc.length)to.push(cc.shift()!);
    if(!to.length||to.length+cc.length>100)return;
    return {to,cc};
  } catch {return;}
}
