/** Human-visible state of one immutable proposal to publish project changes. */
export interface PublicationReview {
  /** Immutable proposal identity. */
  candidate_id: string;
  /** Project containing the proposed changes. */
  project_id: string;
  /** Human whose personal branch was submitted. */
  author_id: string;
  /** Exact submitted personal branch head. */
  personal_head: string;
  /** Exact shared branch against which the proposal was prepared. */
  shared_head: string;
  /** Compare-and-set version for decisions. */
  decision_version: number;
  /** Whether rights, policy or branch changes have invalidated this proposal. */
  /** The author cancelled this review; its decisions cannot authorize publication. */
  withdrawn?: boolean;
  stale: boolean;
  /** Whether every required current approval has been recorded. */
  ready: boolean;
  /** Authorized domains and their required participants. */
  domains: {
    /** Subject area requiring approval. */
    domain_id: string;
    /** Changed document identities in this area. */
    node_ids: string[];
    /** Required human identities. */
    approvers: string[];
    /** Current decisions visible to this participant. */
    decisions: {
      /** Human who recorded this decision. */
      approver_id: string;
      /** Acceptance or rejection of the displayed proposal. */
      approved: boolean;
    }[];
  }[];
}
