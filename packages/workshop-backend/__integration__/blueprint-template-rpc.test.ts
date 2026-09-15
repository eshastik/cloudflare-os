import * as Y from 'yjs';
import { exports } from 'cloudflare:workers';
import {newWebSocketRpcSession} from 'capnweb';
import type {PublicApi} from '@gadgets/workshop-shared/api';
import {it, expect} from 'vitest';
import {FORMAT_BLUEPRINTS} from '../src/generated/format-blueprints';
import {parseBlueprintArchive} from '../src/blueprint-archive';
import {captureBlueprintTemplate} from '../src/blueprint-template';

it('восстанавливает личный гаджет из снимка через RPC и закрывает его от другого пользователя', async () => {
 const response = await exports.default.fetch(new Request('https://workshop.invalid/api', {headers:{Upgrade:'websocket'}}));
 const socket = response.webSocket!; socket.accept();
 using api = newWebSocketRpcSession<PublicApi>(socket);
 const name = 'template' + crypto.randomUUID().replaceAll('-', '');
 const token = await api.createAccount(name, name, new Uint8Array([1,2,3]));
 using owner = await api.authenticate(token!);
 const other = name + 'other';
 const otherToken = await api.createAccount(other, other, new Uint8Array([1,2,3]));
 using stranger = await api.authenticate(otherToken!);
 const manifest = FORMAT_BLUEPRINTS.find(item => item.output.id === 'document')!;
 const archive = Uint8Array.from(atob(manifest.archive), c => c.charCodeAt(0));
 const parsed = await parseBlueprintArchive(new Response(archive).body!);
 const code = new Uint8Array(await new Response(parsed.content).arrayBuffer());
 const bytes = await captureBlueprintTemplate('frozen-test', {metadata:{...parsed.metadata, output:manifest.output}}, {body:new Response(code).body!,size:code.length}, {
   format:'cloudflareos.document', formatVersion:1,
   document:{title:'Сохранённый договор', blocks:[{id:'one',html:'<p>Точная редакция</p>',version:1}],revision:1}
 });
 using workspace = await owner.newGadgetFromTemplateSnapshot(new Response(bytes).body!, {});
 const info = await workspace.getMetadata();
 using gadget = await workspace.getGadget(info.defaultGadgetId!);
 using editor = await gadget.connectToGadget();
 const document = await editor.getDocument();
 expect(document.title).toBe('Сохранённый договор');
 expect(document.blocks[0].html).toBe('<p>Точная редакция</p>');
 const chatId=await workspace.newChat('Работа с шаблоном',null);
 const operation=crypto.randomUUID();
 const result=await workspace.importTemplateIntoChat(new Response(bytes).body!,chatId,operation);
 expect(result.error).toBeUndefined();
 const imported=result.gadgetId!;
 expect(imported).not.toBe(info.defaultGadgetId);
 const simultaneousId=crypto.randomUUID();
 const simultaneous=await Promise.all([workspace.importTemplateIntoChat(new Response(bytes).body!,chatId,simultaneousId),workspace.importTemplateIntoChat(new Response(bytes).body!,chatId,simultaneousId)]);
 expect(simultaneous.filter(item=>item.gadgetId!==undefined).length).toBeGreaterThan(0);
 const successful=simultaneous.find(item=>item.gadgetId!==undefined)!;
 expect((await workspace.importTemplateIntoChat(new Response(bytes).body!,chatId,simultaneousId)).gadgetId).toBe(successful.gadgetId);

 expect((await workspace.importTemplateIntoChat(new Response(bytes).body!,chatId,operation)).gadgetId).toBe(imported);
 using importedGadget=await workspace.getGadget(imported);
 using importedEditor=await importedGadget.connectToGadget(chatId);
 expect((await importedEditor.getDocument()).blocks[0].html).toBe('<p>Точная редакция</p>');
 expect((await workspace.getMetadata()).defaultGadgetId).toBe(info.defaultGadgetId);
 expect((await editor.getDocument()).revision).toBe(document.revision);
 expect((await workspace.importTemplateIntoChat(new Response(new Uint8Array([1,2])).body!,chatId,crypto.randomUUID())).error).toBeTruthy();
 expect((await workspace.importTemplateIntoChat(new Response(bytes).body!,999999,crypto.randomUUID())).error).toBeTruthy();

 // Достижимый снимок редактора с уже изменённым состоянием нельзя считать пустым.
 const modifiedCode=new Y.Doc();
 Y.applyUpdateV2(modifiedCode,new Uint8Array(await new Response(new Response(code).body!.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()));
 const server=modifiedCode.getMap<Y.Text>().get('server.js')!;
 const changedServer=server.toString().replace('revision: 0,','revision: 5,');
 expect(changedServer).not.toBe(server.toString());server.delete(0,server.length);server.insert(0,changedServer);
 const compressed=new Uint8Array(await new Response(new Response(Y.encodeStateAsUpdateV2(modifiedCode)).body!.pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
 modifiedCode.destroy();
 const changedBytes=await captureBlueprintTemplate('changed-test',{metadata:{...parsed.metadata,output:manifest.output}},{body:new Response(compressed).body!,size:compressed.length},{format:'cloudflareos.document',formatVersion:1,document:{title:'Не перезаписывать',blocks:[],revision:1}});
 const refused=await workspace.importTemplateIntoChat(new Response(changedBytes).body!,chatId,crypto.randomUUID());
 expect(refused.error).toContain('Документ уже изменён');
 using denied = stranger.openGadget(info.id);
 await expect(denied.getMetadata()).rejects.toThrow("You don't have access");
 expect((await owner.listOwnBlueprints()).some(item => item.id === 'frozen-test')).toBe(false);
});
