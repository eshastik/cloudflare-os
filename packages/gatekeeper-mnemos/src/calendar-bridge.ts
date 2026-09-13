import type {CalendarDraftContent,CalendarDraft} from './calendar-drafts.ts';
/** Private service protocol. The configured bridge token never reaches an account UI. */
export interface CalendarBridgeResolve {
  selection_id: string;
  tenant_id: string;
  owner_id: string;
  project_id: string;
  request_id: string;
}
export interface CalendarBridgeConnection {
  connection_id: string;
  owner_id: string;
  project_id: string;
  provider: string;
  calendar_id: string;
  bridge_handle: string;
  revision: number;
  enabled: boolean;
}

export interface CalendarBridgeRead {
  selection_id: string;
  tenant_id: string;
  owner_id: string;
  project_id: string;
  connection_id: string;
  calendar_id: string;
  time_min: string;
  time_max: string;
  limit: number;
}
export interface CalendarBridgeWindow {
  calendar_id: string;
  time_zone: string;
  events: unknown[];
  truncated: boolean;
}

/** Authenticated agent proposal; connection coordinates come from its current grant. */
export interface CalendarBridgeDraft extends Omit<CalendarBridgeRead,'time_min'|'time_max'|'limit'> {agent_principal_id:string;request_id:string;content:CalendarDraftContent;}
/** Human decision against an immutable proposal; not provider event creation. */
export interface CalendarDraftReceipt {draft_id:string;connection_id:string;sha256:string;state:'pending'|'approved'|'rejected';execution?:CalendarDraft['execution'];}

/** Resolve routing metadata only; possession of this ID does not authorize a call. */
export function splitCalendarSelection(value: string) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) throw Error('Invalid selection.');
  const [account,id] = value.split('.');
  return {account,id};
}

/** Exact origin/path, service authentication and bounded JSON precede account lookup. */
export async function handleCalendarBridge(request: Request, callbackUrl: string, token: string | undefined,
    resolve: (account: string, input: CalendarBridgeResolve) => Promise<CalendarBridgeConnection>,
    read?: (account: string, input: CalendarBridgeRead) => Promise<CalendarBridgeWindow>,
    draft?: (account:string,input:CalendarBridgeDraft)=>Promise<CalendarDraftReceipt>): Promise<Response | null> {
  let base: URL;
  try { base = new URL(callbackUrl); } catch { return null; }
  const url = new URL(request.url);
  const isDraft=url.pathname===base.pathname+'/calendar-bridge/draft';
  const isRead = url.pathname === base.pathname + '/calendar-bridge/read';
  if (!isDraft && !isRead && url.pathname !== base.pathname + '/calendar-bridge/resolve') return null;
  const reply = (status: number, body: unknown) => Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
  if (url.protocol !== 'https:' || url.origin !== base.origin || url.search || request.method !== 'POST') return reply(404,{code:'calendar.unavailable'});
  if (!token || token.length < 32 || token.length > 1024) return reply(503,{code:'calendar.unavailable'});
  const header = request.headers.get('Authorization') ?? '';
  if (header.length > 2048) return reply(403,{code:'calendar.unavailable'});
  const digest = async (text: string) => new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)));
  const [actual,expected] = await Promise.all([digest(header),digest('Bearer '+token)]);
  let mismatch = 0;for (let i=0;i<actual.length;i++) mismatch |= actual[i]^expected[i];
  if (mismatch) return reply(403,{code:'calendar.unavailable'});
  try {
    if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) throw Error();
    const reader = request.body?.getReader();if (!reader) throw Error();
    const chunks: Uint8Array[]=[];let length=0;
    try { for (;;) {const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>(isDraft?256*1024:16384)){await reader.cancel();throw Error();}chunks.push(value);} }
    finally {reader.releaseLock();}
    const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    const input=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(bytes));
    const fields=isDraft?['selection_id','tenant_id','owner_id','project_id','connection_id','calendar_id','agent_principal_id','request_id','content']:isRead ? ['selection_id','tenant_id','owner_id','project_id','connection_id','calendar_id','time_min','time_max','limit'] : ['selection_id','tenant_id','owner_id','project_id','request_id'];
    if (!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).length!==fields.length ||
        Object.keys(input).some(key=>!fields.includes(key)) || fields.filter(key=>key!=='limit'&&key!=='content').some(key=>typeof input[key]!=='string'||!input[key]||input[key].length>255||/[\x00\r\n]/.test(input[key]))) throw Error();
    const {account}=splitCalendarSelection(input.selection_id);
    if(isDraft){if(!draft)throw Error();return reply(200,await draft(account,input));}
    if (isRead) {
      if (!read || !Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) throw Error();
      return reply(200,await read(account,input));
    }
    return reply(200,await resolve(account,input));
  } catch { return reply(403,{code:'calendar.unavailable'}); }
}
