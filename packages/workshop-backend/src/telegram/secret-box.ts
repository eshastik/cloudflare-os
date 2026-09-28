// Шифрование секретов оболочки (сейчас — токенов личных ботов Telegram) ключом развёртывания.
// Ключ лежит в переменной SHELL_SECRETS_KEY, а не рядом с данными: копия хранилища объектов без
// него токена не раскрывает. AES-256-GCM, ключ выводится через HKDF с назначением, поэтому один
// ключ установки можно использовать и для других секретов без смешения.

export const SECRETS_KEY_MISSING = "На сервере не задан ключ шифрования секретов (SHELL_SECRETS_KEY). Подключение невозможно — обратитесь к администратору установки.";

const MIN_KEY_LENGTH = 32;
const encoder = new TextEncoder();

export type SealedSecret = { v: 1; iv: string; data: string };

export class SecretsKeyMissingError extends Error {
  constructor() { super(SECRETS_KEY_MISSING); this.name = "SecretsKeyMissingError"; }
}

/** Ключ годен, только если он достаточно длинный: короткая строка — скорее ошибка настройки. */
export function secretsKeyConfigured(raw: string | undefined): raw is string {
  return typeof raw === "string" && raw.trim().length >= MIN_KEY_LENGTH;
}

async function deriveKey(raw: string | undefined, purpose: string): Promise<CryptoKey> {
  if (!secretsKeyConfigured(raw)) throw new SecretsKeyMissingError();
  let material = await crypto.subtle.importKey("raw", encoder.encode(raw.trim()), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: encoder.encode("mnemos-shell-secrets/v1"), info: encoder.encode(purpose) },
    material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

function toBase64(bytes: Uint8Array): string {
  let text = "";
  for (let byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}

function fromBase64(text: string): Uint8Array {
  let raw = atob(text);
  let bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** `context` привязывает шифртекст к записи: перенесённый в чужую запись он не расшифруется. */
export async function sealSecret(raw: string | undefined, purpose: string, context: string, plaintext: string): Promise<SealedSecret> {
  let key = await deriveKey(raw, purpose);
  let iv = crypto.getRandomValues(new Uint8Array(12));
  let data = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(context) }, key, encoder.encode(plaintext)));
  return { v: 1, iv: toBase64(iv), data: toBase64(data) };
}

export async function openSecret(raw: string | undefined, purpose: string, context: string, sealed: SealedSecret): Promise<string> {
  let key = await deriveKey(raw, purpose);
  if (!sealed || sealed.v !== 1 || typeof sealed.iv !== "string" || typeof sealed.data !== "string") {
    throw new Error("Сохранённый секрет повреждён.");
  }
  try {
    let plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(sealed.iv), additionalData: encoder.encode(context) }, key, fromBase64(sealed.data));
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(plain);
  } catch {
    // Ключ сменили или запись испорчена: без исходного ключа секрет не восстановить.
    throw new Error("Сохранённый секрет не расшифровывается ключом установки.");
  }
}

/** Сравнение за постоянное время: сравниваются хэши, поэтому длина строки не утекает по времени. */
export async function sameSecret(a: string, b: string): Promise<boolean> {
  let [x, y] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);
  let left = new Uint8Array(x), right = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0;
}
