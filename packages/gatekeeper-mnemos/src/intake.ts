export interface IntakeUploadTicket {upload_id:string;url:string;method:string;checksum_header:string;checksum_value:string;content_length:number}

export interface IntakeStatus {
 total:number; in_queue:number; awaiting_classification:number; awaiting_placement:number;
 placed_in_tree:number; dead_lettered:number;
 dead_letters:Array<{blob_sha256_hex:string;pipeline_version:number;attempts:number;last_failure:string}>;
 dead_letters_truncated:boolean;
}
export interface IntakeAlert {
 id:string; blob_sha256_hex:string; pipeline_version:number; database:string; project:string;
 placement_state?:"personal"|"shared"; personal_head?:string; owner_id?:string; result_project_id?:string; result_node_id?:string;
 suggested_project_name?:string; suggested_domain?:string; proposed_project_slug?:string;
 stage:string; reason:string; detail:string; candidates:string[]; paths:string[];
 status:string; placement:string; decided_by:string; note:string; raised_at:string; decided_at:string;
}
export interface IntakeAlerts {alerts:IntakeAlert[];truncated:boolean}
export interface IntakeDecision {intake_project_id?:string;approve:boolean;place?:string;candidate?:number;note?:string}
export interface IntakeReceipt {outcome:string;blob_sha256_hex:string;enqueued:boolean;repeat:boolean;deduplicated:boolean;decider:string;notes:string[]}
/** stopped — файл не загружался: человек остановил загрузку раньше. refused — не принят по правилу установки; повтор его не примет. */
export interface PickedIntakeFile {path:string;uploadId?:string;error?:string;stopped?:boolean;refused?:{reason:string;detail:string};modifiedAt?:number;receipt?:{outcome:string;enqueued:boolean;placement_state?:string}}

function part(value:string):string {
 if(typeof value!=="string" || !value.trim() || value==="." || value===".." || (/[\\/]/.test(value) || [...value].some(char => char.charCodeAt(0) < 32))) throw Error("Недопустимое имя или область");
 return value;
}
/** Область является отдельным сегментом, а не теряется при создании проекта. */
export function intakePlacement(slug:string,domain:string,fileName:string):string {
 return [part(slug),part(domain),...fileName.split("/").map(part)].join("/");
}
export function checkedIntakeSubmit(uploadId:string,sourcePath:string,modifiedAt?:number) {
 part(uploadId);
 if(typeof sourcePath!=="string" || new TextEncoder().encode(sourcePath).length>1024) throw Error("Слишком длинный путь файла");
 const parts=sourcePath.split("/");parts.forEach(part);
 if(modifiedAt!==undefined && (!Number.isFinite(modifiedAt) || Number.isNaN(new Date(modifiedAt).getTime()))) throw Error("Некорректная дата файла");
 return {upload_id:uploadId,source_path:sourcePath,marks:parts.some(p=>p.startsWith("."))?["hidden"]:[],...(modifiedAt===undefined?{}:{modified_at:new Date(modifiedAt).toISOString()})};
}
/** Исполняется в доверенном браузере: содержимое файла уходит только по подписанному URL. */
export async function uploadIntakeFile(file:File,begin:(size:number,checksum:string)=>Promise<IntakeUploadTicket>,send:typeof fetch=fetch):Promise<string> {
 if(file.size>64*1024*1024) throw Error("Файл больше 64 МБ: текущая приёмная не может обработать его целиком");
 const digest=new Uint8Array(await crypto.subtle.digest("SHA-256",await file.arrayBuffer()));
 const checksum=btoa(String.fromCharCode(...digest));
 const ticket=await begin(file.size,checksum);
 const url=new URL(ticket.url);
 if(url.protocol!=="https:" && !(url.protocol==="http:" && ["127.0.0.1","localhost","[::1]"].includes(url.hostname))) throw Error("Небезопасный адрес хранилища");
 if(ticket.method!=="PUT" || ticket.content_length!==file.size || ticket.checksum_value!==checksum || ticket.checksum_header.toLowerCase()!=="x-amz-checksum-sha256" || !ticket.upload_id) throw Error("Билет загрузки не соответствует файлу");
 const options = {method:"PUT",body:file,headers:{[ticket.checksum_header]:checksum},credentials:"omit" as const,redirect:"error" as const,referrerPolicy:"no-referrer" as const};
 const response=await send(ticket.url,options);
 if(!response.ok) throw Error("Хранилище не приняло файл. Повторите загрузку");
 return ticket.upload_id;
}
