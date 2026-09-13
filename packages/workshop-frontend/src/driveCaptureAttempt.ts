export interface DriveCaptureAttempt {source:number;target:number;file:string;project:string;request:string}
export const driveAttemptKey=(owner:string)=>'mnemos.drive.capture:'+encodeURIComponent(owner)
/** Recovery coordinates only. Authority and source receipts remain on the server. */
export function readDriveAttempt(storage:Pick<Storage,'getItem'>,owner:string):DriveCaptureAttempt|null {
 const raw=storage.getItem(driveAttemptKey(owner));if(raw===null)return null
 if(raw.length>4096)throw Error('Invalid import recovery')
 const value=JSON.parse(raw)
 if(!value||Object.keys(value).sort().join(',')!=='file,project,request,source,target'||
    ![value.source,value.target].every(x=>Number.isSafeInteger(x)&&x>0)||(value.source===value.target&&!(typeof value.file==='string'&&/^[-a-f0-9]{36}:.+/.test(value.file)))||
    ![value.file,value.project,value.request].every(x=>typeof x==='string'&&x.length>0&&x.length<=255&&!/[\x00-\x1f\x7f]/.test(x)))throw Error('Invalid import recovery')
 return value
}
