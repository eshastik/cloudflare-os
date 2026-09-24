import {storedAccountOwner} from './account-identity.ts';
import type {AccountStorage} from './account-session.ts';
import {LoginFlow,type LoginConfig} from './login-flow.ts';
const KEY='mnemosLoginProfile';
interface Profile {id:string;name:string;config:LoginConfig;apiOrigin?:string;storageOrigin?:string}
/** Operator-defined IAM profiles sharing this connector's API and callback. */
export class LoginProfiles {
  #storage:AccountStorage;
  #profiles:Profile[];
  constructor(storage:AccountStorage,defaultConfig:string,additional?:string){
    this.#storage=storage;
    try{
      const config:LoginConfig=JSON.parse(defaultConfig);
      const extras:Profile[]=additional?JSON.parse(additional):[];
      if(!Array.isArray(extras)||extras.length>20)throw Error();
      this.#profiles=[{id:'default',name:'Основная организация',config},...extras];
      const ids=new Set<string>();
      for(const p of this.#profiles){
        if(!p||typeof p.id!=='string'||! /^[a-z][a-z0-9_-]{0,63}$/.test(p.id)||ids.has(p.id)||typeof p.name!=='string'||!p.name.trim()||p.name.length>160||p.config?.callbackUrl!==config.callbackUrl)throw Error();
        for(const origin of [p.apiOrigin,p.storageOrigin])if(origin!==undefined){const url=new URL(origin);if(url.protocol!=='https:'||url.origin!==origin)throw Error()}
        ids.add(p.id);new LoginFlow(storage,p.config);
      }
    }catch{throw Error('Mnemos login profiles are not configured')}
  }
  #pinned(){return this.#storage.get<string>(KEY) ?? (storedAccountOwner(this.#storage)?'default':undefined)}
  choices(){const pinned=this.#pinned();return this.#profiles.filter(p=>!pinned||p.id===pinned).map(({id,name})=>({id,name}))}
  select(id?:string){
    const pinned=this.#pinned();const selected=id??pinned??(this.#profiles.length===1?'default':undefined);
    if(!selected||(pinned&&pinned!==selected)||!this.#profiles.some(p=>p.id===selected))throw Error('Organization selection rejected');
    this.#storage.put(KEY,selected);
  }
  origins(apiOrigin:string,storageOrigin?:string){const id=this.#pinned()??'default';const p=this.#profiles.find(p=>p.id===id);if(!p)throw Error('Organization unavailable');return {apiOrigin:p.apiOrigin??apiOrigin,storageOrigin:p.storageOrigin??storageOrigin}}
  /** Организация этого аккаунта: закреплённая или основная. */
  current(){return this.#pinned()??'default'}
  config(){const id=this.#pinned()??'default';const profile=this.#profiles.find(p=>p.id===id);if(!profile)throw Error('Organization unavailable');return profile.config}
}

/** Preserve existing primary account identities while separating other API installations. */
export function organizationAccountName(primaryOrigin:string,origin:string,tenant:string,user:string):string {
  return JSON.stringify(origin===primaryOrigin ? [tenant,user] : [origin,tenant,user]);
}
