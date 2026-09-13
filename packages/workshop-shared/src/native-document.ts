/** Native structured document formats understood by the bundled output applications. */
export type NativeDocumentFormat = "cloudflareos.document" | "cloudflareos.spreadsheet" | "cloudflareos.presentation";

/** Data snapshot; this envelope never carries application code or resource authority. */
export interface NativeDocumentSnapshot {
  /** Output application that can interpret the document data. */
  format: NativeDocumentFormat;
  /** Version of the data envelope, independent of the local editing revision. */
  formatVersion: 1;
  /** Structured data validated by the destination application's restore operation. */
  document: Record<string, unknown>;
}

/** Data restoration contract implemented by the bundled native editors. */
export interface NativeDocumentEditor {
  /** Replace validated document data only if the editing revision still matches. */
  restoreDocumentSnapshot(snapshot: NativeDocumentSnapshot, expectedRevision: number): Promise<unknown>;
}

/** Check a native data format at an RPC or browser boundary. */
export function isNativeDocumentFormat(value: unknown): value is NativeDocumentFormat {
  return value === "cloudflareos.document" || value === "cloudflareos.spreadsheet" || value === "cloudflareos.presentation";
}
