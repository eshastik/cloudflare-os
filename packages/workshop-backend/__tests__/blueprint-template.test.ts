import {FORMAT_BLUEPRINTS} from '../src/generated/format-blueprints'
import { describe, it, expect } from 'vitest'
import { captureBlueprintTemplate, readBlueprintTemplate } from '../src/blueprint-template'
import { decodeBlueprintTemplate } from '@gadgets/workshop-shared/blueprint-template'
import { parseBlueprintArchive } from '../src/blueprint-archive'
import type { BlueprintKvRecord } from '../src/blueprint-archive'
const metadata = { title: 'Договор', description: 'Шаблон договора', version: 2, created: new Date(), lastUpdated: new Date(), bindings: {}, author: {name:'Автор'}, output: { id: 'document', noun: 'Документ', plural: 'Документы', icon: 'document' } } as unknown as BlueprintKvRecord['metadata']
const snapshot = { format: 'cloudflareos.document' as const, formatVersion: 1 as const, document: { blocks: [{ text: 'Действующая редакция' }] } }
function code() { const bytes = new Uint8Array([1,2,3]); return {body: new Response(bytes).body!, size: bytes.length} }
describe('снимок Blueprint для согласования', () => {
 it('сохраняет код и данные документа вместе с точной версией', async () => {
   const bytes = await captureBlueprintTemplate('blueprint-1', {metadata}, code(), snapshot)
   const result = await decodeBlueprintTemplate(bytes)
   expect(result.blueprint.version).toBe(2)
   expect(result.nativeDocument).toEqual(snapshot)
   const archive = Uint8Array.from(atob(result.blueprint.archiveBase64), c=>c.charCodeAt(0))
   const parsed = await parseBlueprintArchive(new Response(archive).body!)
   expect(parsed.metadata.title).toBe('Договор')
   expect(parsed.metadata.version).toBe(2)
 })
 it('не выдаёт архив кода за полный шаблон документа', async () => {
   await expect(captureBlueprintTemplate('blueprint-1', {metadata}, code())).rejects.toThrow('снимок')
 })
 it('отклоняет данные другого редактора', async () => {
   await expect(captureBlueprintTemplate('blueprint-1', {metadata}, code(), {...snapshot,format:'cloudflareos.spreadsheet'})).rejects.toThrow('снимок')
 })
 it('последующая правка оригинала не меняет захваченный снимок', async () => {
   const draft = structuredClone(snapshot)
   const bytes = await captureBlueprintTemplate('blueprint-1', {metadata}, code(), draft)
   draft.document.blocks[0].text = 'Изменено'
   expect((await decodeBlueprintTemplate(bytes)).nativeDocument).toEqual(snapshot)
 })
 it('обнаруживает подмену архива и неизвестную версию конверта', async () => {
   const bytes = await captureBlueprintTemplate('blueprint-1', {metadata}, code(), snapshot)
   const value=JSON.parse(new TextDecoder().decode(bytes)); value.blueprint.archiveSHA256='0'.repeat(64)
   await expect(decodeBlueprintTemplate(new TextEncoder().encode(JSON.stringify(value)))).rejects.toThrow('повреждён')
   value.schemaVersion=2
   await expect(decodeBlueprintTemplate(new TextEncoder().encode(JSON.stringify(value)))).rejects.toThrow('Неподдерживаемый')
 })
})

it('чтение снимка сохраняет код реального Docs и данные документа', async () => {
  const manifest = FORMAT_BLUEPRINTS.find(item => item.output.id === 'document')!;
  const archive = Uint8Array.from(atob(manifest.archive), character => character.charCodeAt(0));
  const parsed = await parseBlueprintArchive(new Response(archive).body!);
  const compressed = new Uint8Array(await new Response(parsed.content).arrayBuffer());
  const record = {metadata: {...parsed.metadata, output: manifest.output}};
  const captured = await captureBlueprintTemplate('format.document', record, {body: new Response(compressed).body!, size: compressed.length}, snapshot);
  const restored = await readBlueprintTemplate(new Response(captured).body!);
  const original = new Uint8Array(await new Response(new Response(compressed).body!.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  expect(restored.code).toEqual(original);
  expect(restored.snapshot.nativeDocument).toEqual(snapshot);
  expect(restored.metadata.output?.id).toBe('document');
});
