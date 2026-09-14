import type {SourceLoadHealth} from './source-health.ts';
import type {MailMessage} from '@gadgets/workshop-shared/mail-message';
import type {MailReadRequest} from '@gadgets/workshop-shared/mail-search';
/** Common human mailbox query; uses the same selection and authorization as agent reads. */
export type MailMessageQuery = Pick<MailReadRequest,'limit'|'cursor'|'search'|'attachment'>;
/** One authorized page. An empty page can still have a continuation. */
export interface MailMessagePage {provider:string;query_sha256:string;messages:MailMessage[];attachment?:import('@gadgets/workshop-shared/mail-attachment').MailAttachmentChunk;truncated:boolean;next_cursor?:string;}

/** Public connection receipt; no service credential or bridge handle. */
export interface MailConnectionInfo extends SourceLoadHealth {
  connection_id: string;
  project_id: string;
  provider: string;
  query_sha256: string;
  revision: number;
  enabled: boolean;
}
/** Explicit owner decision against the versions currently shown in management. */
export interface MailGrantDecision {
  principal_id: string;
  connection_revision: number;
  expected_revision: number;
  enabled: boolean;
}

/** Saved permission configuration; enabled alone does not prove effective access. */
export interface MailGrantState {
  connection_id: string;
  principal_id: string;
  connection_revision: number;
  connection_enabled: boolean;
  revision: number;
  enabled: boolean;
}

/** Paginated owner catalogue, including disabled connections for recovery. */
export interface MailConnectionPage {connections:MailConnectionInfo[];next_cursor?:string;}
