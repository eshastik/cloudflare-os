import type {MnemosAccountSession} from "../src/account-session.ts";
type API=Pick<MnemosAccountSession,"readTemplateProposalSource">;
export type TemplateTextDownload=(project:string,node:string,version:string,side:number)=>Promise<string>;
/** The opaque iframe delegates storage transfer and integrity checks to the human host. */
export async function readTemplateProposalText(api:API,id:string,download:TemplateTextDownload):Promise<string>{
 const source=await api.readTemplateProposalSource(id);
 const mime=source.source.content_type;if(!mime.startsWith("text/")&&mime!=="application/json"&&!mime.endsWith("+json"))throw new Error("Source is not a text artifact");
 const text=await download(source.source.project_id,source.source.node_id,"template-proposal:"+id,0);
 const current=await api.readTemplateProposalSource(id);
 if(current.proposal_id!==source.proposal_id||current.source.template_id!==source.source.template_id||current.source.revision!==source.source.revision||current.source.source_head!==source.source.source_head||current.source.project_id!==source.source.project_id||current.source.node_id!==source.source.node_id||current.source.content_type!==mime)throw new Error("Source changed");
 return text;
}
