import { isNativeDocumentFormat, type NativeDocumentSnapshot } from './native-document'

/** Снимок шаблона для хранения и согласования в Mnemos. Идентификаторы не дают прав. */
export interface BlueprintTemplateSnapshot {
  schema: 'mnemos.blueprint-template'
  schemaVersion: 1
  blueprint: { id: string; version: number; title: string; archiveSHA256: string; archiveBase64: string }
  nativeDocument?: NativeDocumentSnapshot
}
export const BLUEPRINT_TEMPLATE_MIME = 'application/vnd.mnemos.blueprint-template+json'
export const MAX_BLUEPRINT_TEMPLATE_BYTES = 48 * 1024 * 1024

/** Проверка конверта не исполняет код. Архив отдельно проверяет штатный импорт Blueprints. */
export async function decodeBlueprintTemplate(bytes: Uint8Array): Promise<BlueprintTemplateSnapshot> {
  if (!bytes.byteLength || bytes.byteLength > MAX_BLUEPRINT_TEMPLATE_BYTES) throw new Error('Размер снимка шаблона недопустим')
  const value = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)) as BlueprintTemplateSnapshot
  const b = value?.blueprint
  if (value?.schema !== 'mnemos.blueprint-template' || value.schemaVersion !== 1 || !b ||
      typeof b.id !== 'string' || !b.id || b.id.length > 255 || !Number.isSafeInteger(b.version) || b.version < 1 ||
      typeof b.title !== 'string' || !b.title.trim() || b.title.length > 4096 ||
      typeof b.archiveSHA256 !== 'string' || !/^[a-f0-9]{64}$/.test(b.archiveSHA256) ||
      typeof b.archiveBase64 !== 'string' || !b.archiveBase64 || b.archiveBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b.archiveBase64)) {
    throw new Error('Неподдерживаемый снимок шаблона')
  }
  const archive = Uint8Array.from(atob(b.archiveBase64), c => c.charCodeAt(0))
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', archive)), byte => byte.toString(16).padStart(2, '0')).join('')
  if (hash !== b.archiveSHA256) throw new Error('Архив шаблона повреждён')
  if (value.nativeDocument !== undefined) {
    const n = value.nativeDocument
    if (!n || !isNativeDocumentFormat(n.format) || n.formatVersion !== 1 || !n.document || typeof n.document !== 'object' || Array.isArray(n.document)) {
      throw new Error('Неподдерживаемые данные документа в шаблоне')
    }
  }
  return value
}

export async function encodeBlueprintTemplate(input: Omit<BlueprintTemplateSnapshot, 'schema' | 'schemaVersion'>): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(JSON.stringify({ schema: 'mnemos.blueprint-template', schemaVersion: 1, ...input }))
  await decodeBlueprintTemplate(bytes)
  return bytes
}
