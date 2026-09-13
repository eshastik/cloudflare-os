export const resourceMapMime = "application/vnd.mnemos.resource-map+json";
export const resourceKinds: Record<string,string> = {repository:"Репозиторий",database:"База данных",server:"Сервер",environment:"Окружение",domain:"Домен",deployment:"Развёртывание",grafana:"Grafana",portainer:"Portainer",service:"Сервис"};
export const resourceRelations: Record<string,string> = {depends_on:"Зависит от",deployed_to:"Развёрнуто в",observed_by:"Наблюдается через",stored_in:"Хранится в",built_from:"Собрано из",exposed_by:"Доступно через",managed_by:"Управляется через",part_of:"Часть"};
export type EngineeringResource = {id:string;kind:string;name:string;description:string;url:string;owner_ids:string[];environment:string};
export type ResourceMap = {format:"mnemos.resource-map";format_version:1;revision:number;title:string;resources:EngineeringResource[];links:{from:string;to:string;relation:string}[]};
const id = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/;
function object(v:unknown):Record<string,unknown>{if(!v||typeof v!=="object"||Array.isArray(v))throw Error("Invalid resource map");return v as Record<string,unknown>;}
function text(v:unknown,max:number,required=false):string{if(typeof v!=="string"||v.includes("\0")||new TextEncoder().encode(v).length>max||(required&&!v.trim()))throw Error("Invalid resource text");return v;}
function list(v:unknown,max:number):unknown[]{if(v===null)return [];if(!Array.isArray(v)||v.length>max)throw Error("Invalid resource list");return v;}
function identifier(v:unknown):string{const s=text(v,255,true);if(!id.test(s))throw Error("Invalid identifier");return s;}
function location(v:unknown):string{const s=text(v,4096);if(s){const u=new URL(s);if(u.protocol!=="https:"||!u.hostname||u.username||u.password||s.includes("?")||s.includes("#")||/[\s\\]/.test(s))throw Error("Invalid resource URL");}return s;}
/** Parse inventory metadata. Links never authorize or initiate a connection. */
export function decodeResourceMap(source:string):ResourceMap{
 if(new TextEncoder().encode(source).length>2097152)throw Error("Resource map too large");
 const raw=object(JSON.parse(source));
 if(raw.format!=="mnemos.resource-map"||raw.format_version!==1||!Number.isSafeInteger(raw.revision)||Number(raw.revision)<1)throw Error("Unsupported resource map");
 const resources=list(raw.resources,1000).map(v=>{const r=object(v),kind=text(r.kind,64);if(!Object.hasOwn(resourceKinds,kind))throw Error("Unknown resource kind");const owners=list(r.owner_ids,64).map(identifier);if(new Set(owners).size!==owners.length)throw Error("Duplicate owner");return {id:identifier(r.id),kind,name:text(r.name,1024,true),description:text(r.description,16384),url:location(r.url),owner_ids:owners,environment:text(r.environment,255)};});
 const ids=new Set(resources.map(r=>r.id));if(ids.size!==resources.length)throw Error("Duplicate resource");
 const seen=new Set<string>();const links=list(raw.links,5000).map(v=>{const l=object(v),from=identifier(l.from),to=identifier(l.to),relation=text(l.relation,64),key=JSON.stringify([from,to,relation]);if(!ids.has(from)||!ids.has(to)||from===to||!Object.hasOwn(resourceRelations,relation)||seen.has(key))throw Error("Invalid resource link");seen.add(key);return {from,to,relation};});
 return {format:"mnemos.resource-map",format_version:1,revision:Number(raw.revision),title:text(raw.title,1024,true),resources,links};
}

/** Encode a complete edit of the observed map; no revision is guessed on retry. */
export function changeResourceMap(source:string,edited:ResourceMap):string{
 const before=decodeResourceMap(source);
 if(before.revision===Number.MAX_SAFE_INTEGER||edited.revision!==before.revision)throw Error("Resource map revision changed");
 const check=(raw:Record<string,unknown>,keys:string[])=>{if(Object.keys(raw).some(k=>!keys.includes(k)))throw Error("Unsupported resource map fields");};
 const raw=object(JSON.parse(source));check(raw,["format","format_version","revision","title","resources","links"]);
 for(const r of list(raw.resources,1000))check(object(r),["id","kind","name","description","url","owner_ids","environment"]);
 for(const l of list(raw.links,5000))check(object(l),["from","to","relation"]);
 const next=decodeResourceMap(JSON.stringify({...edited,revision:before.revision+1}));
 const content=JSON.stringify(next);if(new TextEncoder().encode(content).length>262144)throw Error("Resource map exceeds editor limit");return content;
}

/** Readable preview of the exact selected snapshot, without executing links. */
export function resourceMapText(source:string):string{
 const map=decodeResourceMap(source);const lines=[`${map.title} · версия ${map.revision}`];
 for(const r of map.resources)lines.push("",`${resourceKinds[r.kind]}: ${r.name}`,r.description,`Окружение: ${r.environment||"не указано"}`,`Ответственные: ${r.owner_ids.join(", ")||"не указаны"}`,`Адрес: ${r.url||"не указан"}`);
 for(const l of map.links)lines.push(`${map.resources.find(r=>r.id===l.from)!.name} — ${resourceRelations[l.relation]}: ${map.resources.find(r=>r.id===l.to)!.name}`);
 return lines.join("\n");
}

/** Format a recognized map for review; malformed claimed maps must not count as viewed. */
export function resourceReviewText(source:string|null):string|null{
 if(source===null)return null;
 let parsed:unknown;try{parsed=JSON.parse(source);}catch{return source;}
 if(parsed&&typeof parsed==="object"&&!Array.isArray(parsed)&&(parsed as Record<string,unknown>).format==="mnemos.resource-map")return resourceMapText(source);
 return source;
}
