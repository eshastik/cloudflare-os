import {normalizeMailSearch,type MailReadRequest} from '@gadgets/workshop-shared/mail-search';
import type {AccountStorage} from './account-session.ts';
interface Scope {selection:string;tenant:string;owner:string;epoch:string;}
interface Saved {key:string;upstream:string;id:string;}
/** Maps opaque provider continuations to one owner, selection and unchanged search. */
export class MailPages {
 private storage:AccountStorage;
 constructor(storage:AccountStorage){this.storage=storage;}
 private key(scope:Scope,input:MailReadRequest){return JSON.stringify([scope.selection,scope.tenant,scope.owner,scope.epoch,input.limit,normalizeMailSearch(input.search)]);}
 resolve(scope:Scope,input:MailReadRequest):string|undefined{
  if(input.cursor===undefined)return;
  if(!/^[a-f0-9-]{36}$/.test(input.cursor))throw Error('Invalid mail cursor.');
  const saved=this.storage.get<Saved>('mailPage:'+input.cursor);
  if(!saved||saved.key!==this.key(scope,input))throw Error('Mail cursor belongs to another search.');
  return saved.upstream;
 }
 async save(scope:Scope,input:MailReadRequest,upstream:string):Promise<string>{
  if(typeof upstream!=='string'||!upstream||upstream.length>8192||/[\x00-\x20\x7f]/.test(upstream))throw Error('Invalid mail continuation.');
  const key=this.key(scope,input);
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([key,upstream])));
  const index='mailPageSource:'+Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');
  let saved=this.storage.get<Saved>(index);
  if(!saved){saved={key,upstream,id:crypto.randomUUID()};this.storage.put(index,saved);}
  const address='mailPage:'+saved.id,existing=this.storage.get<Saved>(address);
  if(existing&&JSON.stringify(existing)!==JSON.stringify(saved))throw Error('Stored mail coordinates changed.');
  if(!existing)this.storage.put(address,saved);
  if(saved.id===input.cursor)throw Error('Mail provider repeated a cursor.');
  return saved.id;
 }
}
