import type {AccountStorage,MnemosAccountSession} from "./account-session.ts";
import {changeResourceMap,type ResourceMap} from "./resource-map-artifact.ts";
export interface ResourceMapEditInput {head:string;source:string;map:ResourceMap}
export interface ResourceMapEditIntent extends ResourceMapEditInput {id:string;attempted:boolean}
type API=Pick<MnemosAccountSession,"readDraftDocument">;
/** Account-owned journal. An attempted save is never replayed automatically. */
export class ResourceMapEdits {
 constructor(private storage:AccountStorage){}
 private key(project:string,node:string){const id=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/;if(!id.test(project)||!id.test(node))throw Error("Invalid resourceMap coordinates");return `resourceMapEdit:${project}:${node}`;}
 private async authorize(api:API,project:string,node:string){const doc=await api.readDraftDocument(project,node);if(!doc.exists||doc.conflicted||doc.content_type!=="application/vnd.mnemos.resource-map+json")throw Error("ResourceMap unavailable");return doc;}
 async read(api:API,project:string,node:string){const key=this.key(project,node);await this.authorize(api,project,node);return structuredClone(this.storage.get<ResourceMapEditIntent>(key)??null);}
 async prepare(api:API,project:string,node:string,input:ResourceMapEditInput){
  const key=this.key(project,node);if(typeof input.source!=="string"||new TextEncoder().encode(input.source).length>262144||!/^[a-f0-9]{64}$/.test(input.head))throw Error("Invalid resourceMap edit");
  changeResourceMap(input.source,input.map);
  const doc=await this.authorize(api,project,node);if(doc.head!==input.head)throw Error("ResourceMap changed");
  const previous=this.storage.get<ResourceMapEditIntent>(key);if(previous){if(previous.head===input.head&&previous.source===input.source&&JSON.stringify(previous.map)===JSON.stringify(input.map))return structuredClone(previous);throw Error("Unresolved resourceMap edit");}
  const intent:ResourceMapEditIntent={...structuredClone(input),id:crypto.randomUUID(),attempted:false};this.storage.put(key,intent);return structuredClone(intent);
 }
 async claim(api:API,project:string,node:string,id:string){
  const key=this.key(project,node),doc=await this.authorize(api,project,node),intent=this.storage.get<ResourceMapEditIntent>(key);
  if(!intent||intent.id!==id||intent.attempted||intent.head!==doc.head)throw Error("ResourceMap edit cannot be retried");
  const current=this.storage.get<ResourceMapEditIntent>(key);if(!current||current.id!==id||current.attempted)throw Error("ResourceMap edit changed");
  current.attempted=true;this.storage.put(key,current);return structuredClone(current);
 }
 async clear(api:API,project:string,node:string,id:string,head:string){
  const key=this.key(project,node),doc=await this.authorize(api,project,node);if(doc.head!==head)throw Error("ResourceMap changed since review");
  const intent=this.storage.get<ResourceMapEditIntent>(key);if(intent&&intent.id!==id)throw Error("ResourceMap edit changed");this.storage.delete(key);
 }
}
export type ResourceMapEditManagement={
 readResourceMapEdit:(project:string,node:string)=>ReturnType<ResourceMapEdits["read"]>;
 prepareResourceMapEdit:(project:string,node:string,input:ResourceMapEditInput)=>ReturnType<ResourceMapEdits["prepare"]>;
 claimResourceMapEdit:(project:string,node:string,id:string)=>ReturnType<ResourceMapEdits["claim"]>;
 clearResourceMapEdit:(project:string,node:string,id:string,head:string)=>ReturnType<ResourceMapEdits["clear"]>;
};
