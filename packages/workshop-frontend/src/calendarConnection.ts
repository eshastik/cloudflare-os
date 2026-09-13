import type {AuthenticatedApi} from '@gadgets/workshop-shared/api'

export interface CalendarAttempt {source:number;target:number;calendar:string;project:string;request:string;selection?:string}
type API=Pick<AuthenticatedApi,'prepareCalendarConnection'|'registerCalendarSelection'>
/** Retain the same request and selection when a registration response is lost. */
export async function finishCalendarConnection(api:API,attempt:CalendarAttempt,checkpoint:(attempt:CalendarAttempt)=>void=()=>{}){
 checkpoint(attempt)
 if(!attempt.selection){const prepared=await api.prepareCalendarConnection(attempt.source,attempt.target,attempt.calendar,attempt.project,attempt.request);attempt.selection=prepared.selection_id}
 checkpoint(attempt)
 return api.registerCalendarSelection(attempt.target,attempt.project,attempt.request,attempt.selection)
}


export const calendarAttemptKey=(owner:string)=>'mnemos.calendar.connection:'+encodeURIComponent(owner)
/** Recovery coordinates are scoped to the signed-in user; the server still authorizes every call. */
export function readCalendarAttempt(storage:Pick<Storage,'getItem'>,owner:string):CalendarAttempt|undefined {
 const raw=storage.getItem(calendarAttemptKey(owner));if(raw===null)return
 if(raw.length>16384)throw Error('Invalid calendar recovery')
 const value=JSON.parse(raw)
 if(!value||Object.keys(value).some(key=>!['source','target','calendar','project','request','selection'].includes(key))||
  ![value.source,value.target].every(x=>Number.isSafeInteger(x)&&x>0)||
  ![value.calendar,value.project,value.request].every(x=>typeof x==='string'&&x.length>0&&x.length<=1024&&!/[\x00-\x1f\x7f]/.test(x))||
  (value.selection!==undefined&&(typeof value.selection!=='string'||!value.selection||value.selection.length>8192||/[\x00-\x1f\x7f]/.test(value.selection))))throw Error('Invalid calendar recovery')
 return value
}
