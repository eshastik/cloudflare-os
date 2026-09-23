import {exports} from 'cloudflare:workers';
import {runInDurableObject} from 'cloudflare:test';
import {newWebSocketRpcSession} from 'capnweb';
import type {PublicApi} from '@gadgets/workshop-shared/api';
import {it,expect} from 'vitest';

it('сохраняет контекст проекта при повторном открытии беседы',async()=>{
 const response=await exports.default.fetch(new Request('https://workshop.invalid/api',{headers:{Upgrade:'websocket'}}));
 const socket=response.webSocket!;socket.accept();using api=newWebSocketRpcSession<PublicApi>(socket);
 const name='project'+crypto.randomUUID().replaceAll('-','');
 const token=await api.createAccount(name,name,new Uint8Array([1,2,3]));using owner=await api.authenticate(token!);
 const user=exports.UserDurableObject.getByName(name);
 await runInDurableObject(user,async instance=>{instance['storage'].connectedAccounts.put({id:3,vendorId:'mnemos',description:{displayName:'Учебная организация'},account:{} as never});});
 using workspace=await owner.newGadget();const info=await workspace.getMetadata();
 const context={accountId:3,projectId:'project-a',title:'Проект А'};
 const chat=await workspace.newChat('Подготовь документ',null,undefined,undefined,undefined,context);
 using reopened=await owner.openGadget(info.id);
 const saved=(await reopened.listChats()).find(item=>item.id===chat)!;
 // Старое одиночное поле сохраняется и читается как набор из одного проекта, выбранного человеком.
 expect(saved.projectContext).toEqual({...context,projects:[{...context,pinnedBy:'user'}],creatorId:exports.UserDurableObject.idFromName(name).toString(),creatorProfileId:name});
 const both=[{...context,pinnedBy:'user' as const},{accountId:3,projectId:'project-b',title:'Склад',pinnedBy:'user' as const}];
 const second=await workspace.newChat('Сверь остатки',null,undefined,undefined,undefined,{...context,projects:both});
 const savedSecond=(await reopened.listChats()).find(item=>item.id===second)!;
 expect(savedSecond.projectContext?.projects).toEqual(both);
});
