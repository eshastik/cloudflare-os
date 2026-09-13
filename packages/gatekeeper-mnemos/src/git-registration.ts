import type {AccountStorage,MnemosAccountSession} from "./account-session.ts";
import {validateGitSetup,type GitSetup,type GitConnection} from "./git-connections.ts";
type API=Pick<MnemosAccountSession,"listGitConnections"|"registerGitConnection"|"readGitConnection">;
export interface GitRegistrationIntent {id:string;setup:GitSetup;attempted:boolean;completed:boolean}
/** Only metadata and IDs persist. Unknown requests remain inspectable by ID. */
export class GitRegistrations {
 constructor(private storage:AccountStorage){}
 private all(){return this.storage.get<GitRegistrationIntent[]>("gitRegistrations")??[];}
 private update(id:string,change:(entry:GitRegistrationIntent)=>void){const all=this.all(),entry=all.find(e=>e.id===id);if(!entry)throw Error("Git request missing");change(entry);this.storage.put("gitRegistrations",all);return structuredClone(entry);}
 async list(api:API){await api.listGitConnections("");return structuredClone(this.all());}
 async save(api:API,setup:GitSetup){
  const clean=validateGitSetup(setup);await api.listGitConnections("");const all=this.all();
  const existing=all.find(e=>!e.completed&&JSON.stringify(e.setup)===JSON.stringify(clean));if(existing)return structuredClone(existing);
  const entry:GitRegistrationIntent={id:crypto.randomUUID(),setup:clean,attempted:false,completed:false};all.push(entry);this.storage.put("gitRegistrations",all);return structuredClone(entry);
 }
 private confirm(id:string,result:GitConnection){return this.update(id,entry=>{if(result.connection_id!==id||result.provider!==entry.setup.provider||result.api_base!==entry.setup.api_base||result.name!==entry.setup.name)throw Error("Git receipt mismatch");entry.completed=true;});}
 async inspect(api:API,id:string){if(!this.all().some(e=>e.id===id))throw Error("Git request missing");const result=await api.readGitConnection(id);this.confirm(id,result);return result;}
 async execute(api:API,id:string,token:string,retry:boolean){
  await api.listGitConnections("");const entry=this.all().find(e=>e.id===id);if(!entry)throw Error("Git request missing");
  if(entry.completed)return this.inspect(api,id);
  if(entry.attempted&&!retry)throw Error("Inspect or explicitly retry saved Git request");
  if(typeof token!=="string"||!token||token.length>16384||/[\s\0]/.test(token))throw Error("Invalid Git credential");
  const claimed=this.update(id,e=>{e.attempted=true;});
  const result=await api.registerGitConnection({...claimed.setup,connection_id:claimed.id,token});this.confirm(id,result);return result;
 }
}
