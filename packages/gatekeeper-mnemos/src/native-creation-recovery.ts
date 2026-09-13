import {recoveryKey} from './recovery-key.ts';
import { isNativeDocumentFormat } from "@gadgets/workshop-shared/native-document";
import type { AccountStorage } from './account-session.ts';
import type { NativeDocumentFormat } from '@gadgets/workshop-shared/native-document';

/** Frozen creation coordinates; never credentials or authority to bypass Mnemos checks. */
export type NativeCreationIntent = {
  officePreview?: string; acceptUnsupported?: boolean;
  project: string; name: string; format: NativeDocumentFormat; head: string; request: string; upload: string;
};

/** Account-bound encrypted receipts, usable only through a freshly authorized account session. */
export class NativeCreationRecovery {
  #storage: AccountStorage;
  constructor(storage: AccountStorage) { this.#storage = storage; }
  async #key(create: boolean) {
    const bytes = recoveryKey(this.#storage, 'native-creation-key', create);
    return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
  }
  async seal(intent: NativeCreationIntent): Promise<string> {
    const key = await this.#key(true), iv = crypto.getRandomValues(new Uint8Array(12));
    const body = new TextEncoder().encode(JSON.stringify({ ...intent, version: 1 }));
    const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, body));
    return btoa(String.fromCharCode(...iv, ...encrypted)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  }
  async open(receipt: string, format: NativeDocumentFormat): Promise<NativeCreationIntent> {
    if (typeof receipt !== 'string' || receipt.length > 8192 || !/^[A-Za-z0-9_-]+$/.test(receipt)) throw new Error('Invalid creation receipt');
    const bytes = Uint8Array.from(atob(receipt.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
    const key = await this.#key(false);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, key, bytes.slice(12));
    const value = JSON.parse(new TextDecoder().decode(plain));
    if (value.version !== 1 || value.format !== format ||
        !isNativeDocumentFormat(format) ||
        !['project', 'name', 'head', 'request', 'upload'].every(k => typeof value[k] === 'string' && value[k])) throw new Error('Creation receipt is unavailable');
    if (value.officePreview !== undefined && (typeof value.officePreview !== "string" || !value.officePreview || value.officePreview.length > 255 || typeof value.acceptUnsupported !== "boolean")) throw new Error("Invalid office receipt");
    return { ...(value.officePreview ? { officePreview: value.officePreview, acceptUnsupported: value.acceptUnsupported } : {}), project: value.project, name: value.name, format, head: value.head, request: value.request, upload: value.upload };
  }
}
