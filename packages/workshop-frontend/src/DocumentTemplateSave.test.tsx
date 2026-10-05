// @vitest-environment jsdom
import React from 'react'
import {createRoot} from 'react-dom/client'
import {test,expect,vi} from 'vitest'
import type {RpcStub} from 'capnweb'
import type {NativeSnapshotSourceRef} from './nativeSnapshotSource'
import type {GadgetClient} from '@gadgets/workshop-shared/api'
import DocumentTemplateSave from './DocumentTemplateSave'
vi.mock('./BlueprintTemplateSave',()=>({default:(props:{preferredProject?:{accountId:number|null;projectId:string};blueprint:{title:string}})=><div data-project={JSON.stringify(props.preferredProject??null)} data-title={props.blueprint.title}>Форма сохранения</div>}))
test('Проект привязки важнее проекта беседы; сбой требует повтора или ручного выбора',async()=>{
 (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
 const container=document.createElement('div');document.body.append(container);const root=createRoot(container);
 const getMnemosDocument=vi.fn<(...args:unknown[])=>Promise<unknown>>().mockResolvedValue({binding:{accountId:8,scope:'bound'},project:{accountId:9,projectId:'chat'}});
 const snapshotSource:NativeSnapshotSourceRef={current:vi.fn<NonNullable<NativeSnapshotSourceRef["current"]>>().mockResolvedValue({format:'cloudflareos.document',formatVersion:1,document:{title:'Дорожная карта',blocks:[]}})};
 const render=(key:string)=>root.render(<DocumentTemplateSave key={key} gadget={{getMnemosDocument} as unknown as RpcStub<GadgetClient>} sourceId="editor" title="ТЗ" projectChatId={4} snapshotSource={snapshotSource} onClose={()=>{}}/>);
 try{
  await React.act(async()=>render('binding'));expect(getMnemosDocument).toHaveBeenCalledWith(4);expect(container.firstElementChild?.getAttribute('data-title')).toBe('Дорожная карта');expect(container.firstElementChild?.getAttribute('data-project')).toBe(JSON.stringify({accountId:8,projectId:'bound'}));
  getMnemosDocument.mockResolvedValue({binding:null,project:{accountId:9,projectId:'chat'}});await React.act(async()=>render('chat'));expect(container.firstElementChild?.getAttribute('data-project')).toBe(JSON.stringify({accountId:9,projectId:'chat'}));
  getMnemosDocument.mockRejectedValue(new Error('offline'));await React.act(async()=>render('error'));expect(container.querySelector('[role="alert"]')).not.toBeNull();expect(container.textContent).not.toContain('Форма сохранения');
  const manual=[...container.querySelectorAll('button')].find(button=>button.textContent==='Выбрать проект вручную')!;await React.act(async()=>manual.click());expect(container.firstElementChild?.getAttribute('data-project')).toBe('null');expect(container.firstElementChild?.getAttribute('data-title')).toBe('Дорожная карта');
  getMnemosDocument.mockResolvedValue({binding:null,project:null});snapshotSource.current=vi.fn<NonNullable<NativeSnapshotSourceRef["current"]>>().mockRejectedValue(new Error('editor not ready'));await React.act(async()=>render('fallback'));expect(container.firstElementChild?.getAttribute('data-title')).toBe('ТЗ');
  snapshotSource.current=vi.fn().mockResolvedValue({format:'cloudflareos.document',formatVersion:1,document:{title:'Новый документ',blocks:[{html:'<h1>Форма ТЗ</h1>'}]}});await React.act(async()=>render('heading'));expect(container.firstElementChild?.getAttribute('data-title')).toBe('Форма ТЗ');
 }finally{await React.act(async()=>root.unmount());container.remove()}
});

test('при редактировании личной или общей версии название берётся из текущего документа',async()=>{
 (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
 const container=document.createElement('div');document.body.append(container);const root=createRoot(container);
 const gadget={getMnemosDocument:async()=>({binding:{accountId:8,scope:'project'}})} as unknown as RpcStub<GadgetClient>;
 const snapshotSource:NativeSnapshotSourceRef={current:async()=>({format:'cloudflareos.document',formatVersion:1,document:{title:'Уточнённая форма ТЗ',blocks:[]}})};
 try{for(const reference of [{template_id:'personal',revision:3},{scope_id:'team',template_key:'form',revision:5}]){
  const editing={context:{accountId:8,projectId:'project',reference},material:{reference,title:'Прежняя форма ТЗ',purpose:'Подготовка ТЗ',kind:'document' as const}};
  await React.act(async()=>root.render(<DocumentTemplateSave key={JSON.stringify(reference)} gadget={gadget} sourceId="editor" title="Документ" snapshotSource={snapshotSource} editing={editing} onClose={()=>{}}/>));
  expect(container.firstElementChild?.getAttribute('data-title')).toBe('Уточнённая форма ТЗ');
 }}finally{await React.act(async()=>root.unmount());container.remove()}
});
