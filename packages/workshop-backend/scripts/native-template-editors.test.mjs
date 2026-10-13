import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import * as Y from 'yjs';

// Исполняется поставляемый редактор; заменяется только платформа хранения.
async function editor(kind){
 const bytes=await readFile(new URL('../format-blueprints/workspace-'+kind+'.gadget',import.meta.url));
 const metadata=bytes.readUInt32BE(12),size=Number(bytes.readBigUInt64BE(16));assert.equal(bytes.length-24-metadata,size);
 const archive=new Y.Doc();Y.applyUpdateV2(archive,gunzipSync(bytes.subarray(24+metadata)));
 const source=archive.getMap().get('server.js')?.toString();assert.match(source,/restoreDocumentSnapshot/);archive.destroy();
 const code=source.replace('import { DurableObject } from "cloudflare:workers";','class DurableObject {}');
 const {Gadget}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
 const values=new Map();
 const storage={get:async key=>structuredClone(values.get(key)),put:async(key,value)=>{values.set(key,structuredClone(value));},delete:async key=>values.delete(key),transaction:async fn=>fn(storage)};
 return new Gadget({storage},{});
}

test('Настоящий редактор таблицы сохраняет формулы, стили, размеры и систему дат при восстановлении шаблона',async()=>{
 const app=await editor('sheets'),initial=await app.getDocument(),snapshot=await app.exportDocumentSnapshot(initial.revision),id=snapshot.document.sheetOrder[0];
 snapshot.document.title='Расчёт';snapshot.document.dateSystem='1904';snapshot.document.sheets[id].colWidths={'0':160};snapshot.document.sheets[id].rowHeights={'0':32};snapshot.document.sheets[id].frozenRows=1;
 snapshot.document.cells[id]={A1:{value:'Количество',fmt:{b:true,bg:'#ffffff'},version:1},B1:{value:'=SUM(B2:B4)',fmt:{nf:'number',d:2},version:1}};
 const expected=structuredClone(snapshot.document),restored=await app.restoreDocumentSnapshot(snapshot,initial.revision),result=await app.exportDocumentSnapshot(restored.revision);
 assert.equal(result.format,'cloudflareos.spreadsheet');assert.deepEqual(result.document.sheetOrder,expected.sheetOrder);assert.deepEqual(result.document.sheets,expected.sheets);assert.equal(result.document.dateSystem,'1904');
 for(const ref of ['A1','B1']){assert.equal(result.document.cells[id][ref].value,expected.cells[id][ref].value);assert.deepEqual(result.document.cells[id][ref].fmt,expected.cells[id][ref].fmt);}
 await assert.rejects(app.restoreDocumentSnapshot(snapshot,initial.revision),/Document changed/);assert.equal((await app.getDocument()).revision,restored.revision);
});

test('Настоящий редактор презентации сохраняет слайды и оформление, отказ не заменяет принятую версию',async()=>{
 const app=await editor('slides'),initial=await app.getDocument(),snapshot=await app.exportDocumentSnapshot(initial.revision);
 snapshot.document.title='План';snapshot.document.slides[0].background={color:'#ffffff',inset:true};snapshot.document.slides[0].blocks[0].props.text='Квартальный план';
 const expected=structuredClone(snapshot.document),restored=await app.restoreDocumentSnapshot(snapshot,initial.revision),result=await app.exportDocumentSnapshot(restored.revision);
 assert.equal(result.format,'cloudflareos.presentation');assert.equal(result.document.themeVersion,expected.themeVersion);assert.equal(result.document.title,'План');assert.deepEqual(result.document.slides,expected.slides);
 const broken=structuredClone(snapshot);broken.document.themeVersion='future';assert.throws(()=>app.restoreDocumentSnapshot(broken,restored.revision),/Unsupported/);assert.deepEqual((await app.getDocument()).slides,expected.slides);
});
