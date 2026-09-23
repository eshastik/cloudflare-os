import type { BlueprintKvRecord } from './blueprint-archive'
import { buildBlueprintArchiveStream, parseBlueprintArchive } from './blueprint-archive'
import { encodeBlueprintTemplate, decodeBlueprintTemplate, MAX_BLUEPRINT_TEMPLATE_BYTES } from '@gadgets/workshop-shared/blueprint-template'
import { nativeFormatForOutput, type NativeDocumentSnapshot } from '@gadgets/workshop-shared/native-document'

export async function captureBlueprintTemplate(id: string, record: BlueprintKvRecord, code: { body: ReadableStream<Uint8Array>; size: number }, nativeDocument?: NativeDocumentSnapshot): Promise<Uint8Array> {
  const format = nativeFormatForOutput(record.metadata.output?.id)
  if (format && (!nativeDocument || nativeDocument.format !== format)) {
    throw new Error('Для шаблона документа нужен снимок его содержимого')
  }
  if (nativeDocument && nativeDocument.format !== format) throw new Error('Формат документа не совпадает с гаджетом')
  if (code.size > 32 * 1024 * 1024) throw new Error('Архив шаблона слишком велик')
  const metadata = { ...record.metadata }; delete metadata.screenshot
  const bytes = new Uint8Array(await new Response(buildBlueprintArchiveStream(metadata, code.body, code.size)).arrayBuffer())
  const archiveSHA256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('')
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
  return encodeBlueprintTemplate({ blueprint: { id, version: metadata.version, title: metadata.title, archiveSHA256, archiveBase64: btoa(binary) }, ...(nativeDocument ? { nativeDocument } : {}) })
}

async function readBounded(stream: ReadableStream<Uint8Array>, maximum: number): Promise<Uint8Array> {
  const reader = stream.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const {done, value} = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > maximum) throw new Error('Снимок шаблона слишком велик');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

/** Дочитывает отклонённый снимок без сохранения, в пределах того же размера. */
export async function discardBlueprintTemplate(stream: ReadableStream<Uint8Array>): Promise<void> {
  await readBounded(stream, MAX_BLUEPRINT_TEMPLATE_BYTES).catch(() => {});
}

export async function readBlueprintTemplate(stream: ReadableStream<Uint8Array>) {
  const snapshot = await decodeBlueprintTemplate(await readBounded(stream, MAX_BLUEPRINT_TEMPLATE_BYTES));
  const archive = Uint8Array.from(atob(snapshot.blueprint.archiveBase64), c => c.charCodeAt(0));
  const {metadata, content} = await parseBlueprintArchive(new Response(archive).body!);
  if (metadata.version !== snapshot.blueprint.version || metadata.title !== snapshot.blueprint.title) throw new Error('Метаданные снимка не совпадают с архивом');
  const format = nativeFormatForOutput(metadata.output?.id);
  if (format && snapshot.nativeDocument?.format !== format || snapshot.nativeDocument && snapshot.nativeDocument.format !== format) throw new Error('Содержимое не совпадает с форматом шаблона');
  const code = await readBounded(content.pipeThrough(new DecompressionStream('gzip')), 64 * 1024 * 1024);
  return {metadata, code, snapshot};
}
