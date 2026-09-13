import type {MailSearch} from '@gadgets/workshop-shared/mail-search';
import type {MailDraftContent,MailDraft} from './mail-drafts.ts';
/** Private service protocol. The configured bridge token never reaches an account UI. */
export interface MailBridgeResolve {
  selection_id: string;
  tenant_id: string;
  owner_id: string;
  project_id: string;
  request_id: string;
}
export interface MailBridgeConnection {
  connection_id: string;
  owner_id: string;
  project_id: string;
  provider: string;
  query_sha256: string;
  bridge_handle: string;
  revision: number;
  enabled: boolean;
}

export interface MailBridgeRead {
  selection_id: string;
  tenant_id: string;
  owner_id: string;
  project_id: string;
  connection_id: string;
  query_sha256: string;
  limit: number;
  cursor?:string;
  search?:MailSearch;
  attachment?:import('@gadgets/workshop-shared/mail-attachment').MailAttachmentRequest;
}
export interface MailBridgeSelection {
  query_sha256: string;
  provider: string;
  messages: unknown[];
  attachment?:import('@gadgets/workshop-shared/mail-attachment').MailAttachmentChunk;
  truncated: boolean;
  next_cursor?:string;
}

/** Service-verified agent proposal for an already selected connection. */
export interface MailBridgeDraft extends Omit<MailBridgeRead,'limit'|'cursor'|'search'|'attachment'> {
 agent_principal_id:string;
 request_id:string;
 content:MailDraftContent;
}
/** Proposal and optional provider outcome; neither is proof of recipient delivery. */
export interface MailDraftReceipt {draft_id:string;connection_id:string;sha256:string;state:'pending'|'approved'|'rejected';delivery?:MailDraft['delivery'];}

/** Resolve routing metadata only; possession of this ID does not authorize a call. */
export function splitMailSelection(value: string) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) throw Error('Invalid selection.');
  const [account,id] = value.split('.');
  return {account,id};
}

/** Exact origin/path, service authentication and bounded JSON precede account lookup. */
export async function handleMailBridge(request: Request, callbackUrl: string, token: string | undefined,
    resolve: (account: string, input: MailBridgeResolve) => Promise<MailBridgeConnection>,
    read?: (account: string, input: MailBridgeRead) => Promise<MailBridgeSelection>,
    draft?: (account: string, input: MailBridgeDraft) => Promise<MailDraftReceipt>): Promise<Response | null> {
  let base: URL;
  try { base = new URL(callbackUrl); } catch { return null; }
  const url = new URL(request.url);
  const isDraft = url.pathname === base.pathname + '/mail-bridge/draft';
  const isRead = url.pathname === base.pathname + '/mail-bridge/read';
  if (!isDraft && !isRead && url.pathname !== base.pathname + '/mail-bridge/resolve') return null;
  const reply = (status: number, body: unknown) => Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
  if (url.protocol !== 'https:' || url.origin !== base.origin || url.search || request.method !== 'POST') return reply(404,{code:'mail.unavailable'});
  if (!token || token.length < 32 || token.length > 1024) return reply(503,{code:'mail.unavailable'});
  const header = request.headers.get('Authorization') ?? '';
  if (header.length > 2048) return reply(403,{code:'mail.unavailable'});
  const digest = async (text: string) => new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)));
  const [actual,expected] = await Promise.all([digest(header),digest('Bearer '+token)]);
  let mismatch = 0;for (let i=0;i<actual.length;i++) mismatch |= actual[i]^expected[i];
  if (mismatch) return reply(403,{code:'mail.unavailable'});
  try {
    if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) throw Error();
    const reader = request.body?.getReader();if (!reader) throw Error();
    const chunks: Uint8Array[]=[];let length=0;
    try { for (;;) {const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>(isDraft?2*1024*1024:16384)){await reader.cancel();throw Error();}chunks.push(value);} }
    finally {reader.releaseLock();}
    const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    const input=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(bytes));
    const fields=isDraft ? ['selection_id','tenant_id','owner_id','project_id','connection_id','query_sha256','agent_principal_id','request_id','content'] : isRead ? ['selection_id','tenant_id','owner_id','project_id','connection_id','query_sha256','limit'] : ['selection_id','tenant_id','owner_id','project_id','request_id'];
    const optional=isRead?['cursor','search','attachment']:[];
    if (!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).length<fields.length ||
        Object.keys(input).some(key=>!fields.includes(key)&&!optional.includes(key)) || fields.filter(key=>key!=='limit'&&key!=='content').some(key=>typeof input[key]!=='string'||!input[key]||input[key].length>255||/[\x00\r\n]/.test(input[key]))) throw Error();
    const {account}=splitMailSelection(input.selection_id);
    if (isDraft) {
      if (!draft || !/^[0-9a-f]{64}$/.test(input.query_sha256)) throw Error();
      return reply(200,await draft(account,input));
    }
    if (isRead) {
      if (!read || !/^[0-9a-f]{64}$/.test(input.query_sha256) || !Number.isInteger(input.limit) || input.limit < 1 || input.limit > 10) throw Error();
      return reply(200,await read(account,input));
    }
    return reply(200,await resolve(account,input));
  } catch { return reply(403,{code:'mail.unavailable'}); }
}
