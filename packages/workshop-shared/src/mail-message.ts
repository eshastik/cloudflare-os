/** A decoded mailbox address. It is untrusted message content, never an identity grant. */
export interface MailAddress {
  /** Unicode display name, empty when absent. */
  name: string;
  /** Mailbox address as reported by the source. */
  address: string;
}

/** Provider-independent message returned by selected mail readers. */
export interface MailMessage {
  /** Opaque identifier scoped to the selected connection. */
  message_id: string;
  /** Optional provider conversation identifier; not interchangeable across accounts. */
  thread_id?: string;
  /** RFC message identifier, or null when the message has none. */
  internet_message_id: string | null;
  /** RFC References chain as supplied by the source. */
  references: string[];
  /** Mnemos-issued source reference for proposing a reply; absent when threading data is unavailable. */
  reply_id?: string;
  /** Subject to preserve when using reply_id; added by Mnemos, never trusted from provider output. */
  reply_subject?: string;
  /** Suggested visible reply-all recipients, excluding known self addresses and duplicates.
   * Omitted if safe recipient resolution is unavailable. Never includes Bcc. Human review is required. */
  reply_all?: {
    /** Suggested direct recipients. */
    to:string[];
    /** Suggested copied recipients. */
    cc:string[];
  };
  /** Received timestamp normalized to UTC. */
  received_at: string;
  /** Decoded Unicode subject, empty when absent. */
  subject: string;
  /** Decoded senders; address groups are flattened. */
  from: MailAddress[];
  /** Decoded direct recipients; address groups are flattened. */
  to: MailAddress[];
  /** Decoded copied recipients. */
  cc: MailAddress[];
  /** Explicit reply recipients, empty when absent; callers may then use from. */
  reply_to: MailAddress[];
  /** Legacy source headers; use the decoded fields above for provider-independent work. */
  headers: Array<{key: string; value: string}>;
  /** Bounded untrusted message content. HTML must not be executed. */
  body: string;
  /** Content representation, independent of the provider. */
  body_format: 'text' | 'html';
  /** Whether body content was clipped. */
  body_truncated: boolean;
  /** Whether the source reports attachments. */
  has_attachments: boolean;
  /** Available attachment metadata; empty does not imply absence when metadata is unavailable. */
  attachments: import('./mail-attachment.ts').MailAttachment[];
  /** Whether the attachments array describes the message's attachments. */
  attachment_metadata_included: boolean;
  /** Readers do not expose attachment bytes in this selection. */
  attachment_content_included: false;
}
