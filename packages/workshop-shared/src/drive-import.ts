import type {WorkerEntrypoint} from "cloudflare:workers";
/** A source snapshot for an import; its bytes are untrusted and are not yet Mnemos content. */
export interface DriveImportSnapshot {
  /** Provider namespace for the source identity. */
  provider: 'google-drive' | 'yandex-disk' | 'webdav';
  /** Selected provider file ID or canonical Disk path, never a download URL. */
  fileId: string;
  /** Provider revision or modification/checksum tuple checked around capture; not a historical revision pin. */
  sourceVersion: string;
  /** Original display name; must not be treated as a filesystem path. */
  sourceName: string;
  /** Provider's original MIME type, including Google Workspace native types. */
  sourceMimeType: string;
  /** MIME type of the captured bytes. */
  contentType: string;
  /** True when the provider exported a native document into another format. */
  exported: boolean;
  /** Original binary content or explicitly identified export; bounded by the provider adapter. */
  bytes: Uint8Array;
  /** Lowercase SHA-256 of exactly these bytes. */
  sha256: string;
}

/** Host-selected source; only the trusted host may pass it to an import receiver. */
export interface DriveImportSource extends WorkerEntrypoint {
  /** Recheck account authorization without disclosing a provider credential. */
  validate(): Promise<void>;
  /** Capture the fixed selected file, with original provenance and bounded bytes. */
  read(): Promise<DriveImportSnapshot>;
}

/** Provenance of the bytes captured at the recorded Mnemos head. */
export type DriveImportOrigin = Omit<DriveImportSnapshot, "bytes"> & {
  /** Size of the captured bytes, including an explicitly identified export. */
  sizeBytes: number;
};

/** Source-copy receipt; does not imply that native parsing or publication has completed. */
export interface DriveImportReceipt {
  /** Node containing the captured source in the owner's personal branch. */
  node_id: string;
  /** Immutable head at creation; later edits must not silently replace the parser's source. */
  head: string;
  /** Original source identity and checksum, without a token or download URL. */
  source: DriveImportOrigin;
}
