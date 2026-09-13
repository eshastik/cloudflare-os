import type {AccountStorage,MnemosAccountSession} from "./account-session.ts";
import {changeTrackerTask,type Task} from "./tracker-artifact.ts";
export interface TrackerEditInput {head:string;source:string;task:Task;create:boolean}
export interface TrackerEditIntent extends TrackerEditInput {id:string;attempted:boolean}
type API=Pick<MnemosAccountSession,"readDraftDocument"|"checkTrackerAssignee">;
/** Account-owned journal. An attempted save is never replayed automatically. */
export class TrackerEdits {
 constructor(private storage:AccountStorage){}
 private key(project:string,node:string){const id=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/;if(!id.test(project)||!id.test(node))throw Error("Invalid tracker coordinates");return `trackerEdit:${project}:${node}`;}
 private async authorize(api:API,project:string,node:string){const doc=await api.readDraftDocument(project,node);if(!doc.exists||doc.conflicted||doc.content_type!=="application/vnd.mnemos.task-tracker+json")throw Error("Tracker unavailable");return doc;}
 async read(api:API,project:string,node:string){const key=this.key(project,node);await this.authorize(api,project,node);return structuredClone(this.storage.get<TrackerEditIntent>(key)??null);}
 async prepare(api:API,project:string,node:string,input:TrackerEditInput){
  const key=this.key(project,node);if(typeof input.source!=="string"||new TextEncoder().encode(input.source).length>262144||typeof input.create!=="boolean"||!/^[a-f0-9]{64}$/.test(input.head))throw Error("Invalid tracker edit");
  changeTrackerTask(input.source,input.task,input.create);
  const doc=await this.authorize(api,project,node);if(doc.head!==input.head)throw Error("Tracker changed");
  if(input.task.assignee_id)await api.checkTrackerAssignee(project,node,input.head,input.task.assignee_id);
  const previous=this.storage.get<TrackerEditIntent>(key);if(previous){if(previous.head===input.head&&previous.source===input.source&&previous.create===input.create&&JSON.stringify(previous.task)===JSON.stringify(input.task))return structuredClone(previous);throw Error("Unresolved tracker edit");}
  const intent:TrackerEditIntent={...structuredClone(input),id:crypto.randomUUID(),attempted:false};this.storage.put(key,intent);return structuredClone(intent);
 }
 async claim(api:API,project:string,node:string,id:string){
  const key=this.key(project,node),doc=await this.authorize(api,project,node),intent=this.storage.get<TrackerEditIntent>(key);
  if(!intent||intent.id!==id||intent.attempted||intent.head!==doc.head)throw Error("Tracker edit cannot be retried");
  if(intent.task.assignee_id)await api.checkTrackerAssignee(project,node,intent.head,intent.task.assignee_id);
  const current=this.storage.get<TrackerEditIntent>(key);if(!current||current.id!==id||current.attempted)throw Error("Tracker edit changed");
  current.attempted=true;this.storage.put(key,current);return structuredClone(current);
 }
 async clear(api:API,project:string,node:string,id:string,head:string){
  const key=this.key(project,node),doc=await this.authorize(api,project,node);if(doc.head!==head)throw Error("Tracker changed since review");
  const intent=this.storage.get<TrackerEditIntent>(key);if(intent&&intent.id!==id)throw Error("Tracker edit changed");this.storage.delete(key);
 }
}
export type TrackerEditManagement={
 readTrackerEdit:(project:string,node:string)=>ReturnType<TrackerEdits["read"]>;
 prepareTrackerEdit:(project:string,node:string,input:TrackerEditInput)=>ReturnType<TrackerEdits["prepare"]>;
 claimTrackerEdit:(project:string,node:string,id:string)=>ReturnType<TrackerEdits["claim"]>;
 clearTrackerEdit:(project:string,node:string,id:string,head:string)=>ReturnType<TrackerEdits["clear"]>;
};
