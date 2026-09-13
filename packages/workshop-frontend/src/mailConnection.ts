import type {AuthenticatedApi} from '@gadgets/workshop-shared/api'

export interface MailAttempt {source:number;target:number;query:string;project:string;request:string;selection?:string}
type API=Pick<AuthenticatedApi,'prepareMailConnection'|'registerMailSelection'>
/** Retain the same request and selection when a registration response is lost. */
export async function finishMailConnection(api:API,attempt:MailAttempt,checkpoint:(attempt:MailAttempt)=>void=()=>{}){
 checkpoint(attempt)
 if(!attempt.selection){const prepared=await api.prepareMailConnection(attempt.source,attempt.target,attempt.query,attempt.project,attempt.request);attempt.selection=prepared.selection_id}
 checkpoint(attempt)
 return api.registerMailSelection(attempt.target,attempt.project,attempt.request,attempt.selection)
}


export const mailAttemptKey=(owner:string)=>'mnemos.mail.connection:'+encodeURIComponent(owner)
/** Recovery coordinates are scoped to the signed-in user; the server still authorizes every call. */
export function readMailAttempt(storage:Pick<Storage,'getItem'>,owner:string):MailAttempt|undefined {
 const raw=storage.getItem(mailAttemptKey(owner));if(raw===null)return
 if(raw.length>16384)throw Error('Invalid mail recovery')
 const value=JSON.parse(raw)
 if(!value||Object.keys(value).some(key=>!['source','target','query','project','request','selection'].includes(key))||
  ![value.source,value.target].every(x=>Number.isSafeInteger(x)&&x>0)||
  ![value.query,value.project,value.request].every(x=>typeof x==='string'&&x.length>0&&x.length<=1024&&!/[\x00-\x1f\x7f]/.test(x))||
  (value.selection!==undefined&&(typeof value.selection!=='string'||!value.selection||value.selection.length>8192||/[\x00-\x1f\x7f]/.test(value.selection))))throw Error('Invalid mail recovery')
 return value
}
