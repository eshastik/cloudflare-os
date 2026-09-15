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
 using denied = stranger.openGadget(info.id);
 await expect(denied.getMetadata()).rejects.toThrow("You don't have access");
 expect((await owner.listOwnBlueprints()).some(item => item.id === 'frozen-test')).toBe(false);
});
