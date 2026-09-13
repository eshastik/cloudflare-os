export type Task={id:string;title:string;description:string;stage_id:string;status:string;assignee_id:string;dependencies:string[];next_step:string;blocker:string;result:string};
export type Tracker={title:string;revision:number;stages:{id:string;name:string;department:string}[];tasks:Task[]};
export const statuses:Record<string,string>={todo:"Запланировано",in_progress:"В работе",blocked:"Заблокировано",done:"Готово",cancelled:"Отменено"};
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=="object"||Array.isArray(value))throw Error("Invalid tracker");return value as Record<string,unknown>;}
function text(value:unknown):string{if(typeof value!=="string"||value.includes("\0"))throw Error("Invalid tracker text");return value;}
function list(value:unknown,max:number):unknown[]{if(value===null)return [];if(!Array.isArray(value)||value.length>max)throw Error("Invalid tracker list");return value;}
export function decodeTrackerPreview(source:string):Tracker{
 const raw=object(JSON.parse(source));if(raw.format!=="mnemos.task-tracker"||raw.format_version!==1||!Number.isSafeInteger(raw.revision)||Number(raw.revision)<1)throw Error("Unsupported tracker");
 const stages=list(raw.stages,64).map(value=>{const s=object(value);return {id:text(s.id),name:text(s.name),department:text(s.department)};});
 if(!stages.length||new Set(stages.map(s=>s.id)).size!==stages.length)throw Error("Invalid stages");
 const tasks=list(raw.tasks,2000).map(value=>{const t=object(value);const task:Task={id:text(t.id),title:text(t.title),description:text(t.description),stage_id:text(t.stage_id),status:text(t.status),assignee_id:text(t.assignee_id),dependencies:list(t.dependencies,2000).map(text),next_step:text(t.next_step),blocker:text(t.blocker),result:text(t.result)};if(!Object.hasOwn(statuses,task.status)||!stages.some(s=>s.id===task.stage_id))throw Error("Invalid task stage/status");return task;});
 if(new Set(tasks.map(t=>t.id)).size!==tasks.length||tasks.some(t=>t.dependencies.some(id=>!tasks.some(other=>other.id===id)||id===t.id)))throw Error("Invalid task references");
 return {title:text(raw.title),revision:Number(raw.revision),stages,tasks};
}
/** Build an edited snapshot without discarding other tasks or workflow fields. */
export function changeTrackerTask(source:string,task:Task,create=false):string{
 const before=decodeTrackerPreview(source),raw=object(JSON.parse(source));
 if(before.revision===Number.MAX_SAFE_INTEGER)throw Error("Revision exhausted");
 const index=before.tasks.findIndex(t=>t.id===task.id);if(create===(index>=0))throw Error("Task creation/update intent mismatch");
 const id=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/;const encoder=new TextEncoder();
 const check=(value:string,max:number,required=false)=>{if(encoder.encode(value).length>max||value.includes("\0")||(required&&!value.trim()))throw Error("Invalid task text");};
 if(!id.test(task.id)||(task.assignee_id&&!id.test(task.assignee_id)))throw Error("Invalid principal or task");
 check(task.title,1024,true);check(task.description,16384);check(task.next_step,4096);check(task.blocker,4096);check(task.result,16384);
 if(index>=0&&before.tasks[index].stage_id!==task.stage_id){const edges=list(raw.transitions,4032).map(object);if(!edges.some(e=>e.from===before.tasks[index].stage_id&&e.to===task.stage_id)||!task.assignee_id||!task.next_step.trim())throw Error("Invalid handoff");}
 const tasks=list(raw.tasks,2000);if(create)tasks.push(structuredClone(task));else tasks[index]={...object(tasks[index]),...structuredClone(task)};raw.tasks=tasks;raw.revision=before.revision+1;
 const content=JSON.stringify(raw),after=decodeTrackerPreview(content);if(encoder.encode(content).length>262144)throw Error("Tracker exceeds editor limit");
 const byID=new Map(after.tasks.map(t=>[t.id,t]));const visited=new Map<string,number>();
 const visit=(id:string):void=>{if(visited.get(id)===1)throw Error("Cyclic dependencies");if(visited.get(id)===2)return;visited.set(id,1);const current=byID.get(id)!;if(new Set(current.dependencies).size!==current.dependencies.length)throw Error("Duplicate dependency");for(const dependency of current.dependencies)visit(dependency);visited.set(id,2);};
 for(const task of after.tasks)visit(task.id);
 for(const t of after.tasks){
  if(t.status==='in_progress'&&(!t.assignee_id||!t.next_step.trim()))throw Error("Missing assignee/next step");
  if(t.status==='blocked'&&(!t.blocker.trim()||!t.next_step.trim()))throw Error("Missing blocker/next step");
  if((t.status==='done'||t.status==='cancelled')&&!t.result.trim())throw Error("Missing result");
  if(t.status!=='blocked'&&t.blocker)throw Error("Stale blocker");
  if((t.status==='in_progress'||t.status==='done')&&t.dependencies.some(id=>after.tasks.find(other=>other.id===id)!.status!=='done'))throw Error("Unfinished dependency");
 }
 return content;
}
