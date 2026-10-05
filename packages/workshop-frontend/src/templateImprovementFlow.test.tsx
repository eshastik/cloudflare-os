// @vitest-environment jsdom
import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {expect,test,vi} from 'vitest'
const reference={scope_id:'team',template_key:'method',revision:5},material={reference,title:'Методика',purpose:'Проверять ТЗ',kind:'guidance' as const}
const mocks=vi.hoisted(()=>({api:{listChatTemplateAccounts:vi.fn(),listChatProjects:vi.fn(),listChatTemplateScopes:vi.fn(),listChatTemplates:vi.fn(),listOutputFormats:vi.fn(),newGadgetFromBlueprint:vi.fn()},navigate:vi.fn(),read:vi.fn()}))
vi.mock('./AuthContext',()=>({useAuthenticatedApi:()=>({authenticatedApi:mocks.api})}))
vi.mock('./readWorkTemplatePreview',()=>({readWorkTemplatePreview:(...args:unknown[])=>mocks.read(...args)}))
vi.mock('@tanstack/react-router',async importOriginal=>({...await importOriginal<object>(),useNavigate:()=>mocks.navigate}))
import ChatTemplatePicker from './ChatTemplatePicker'
test('Каталог группы открывает личную правку через просмотр общего материала',async()=>{
 (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true
 mocks.api.listChatTemplateAccounts.mockResolvedValue([{accountId:7,title:'Mnemos'}]);mocks.api.listChatProjects.mockResolvedValue([{accountId:7,projectId:'source',title:'Проект'}]);mocks.api.listChatTemplateScopes.mockResolvedValue({scopes:[{scopeId:'team',title:'Группа'}],nextCursor:''});mocks.api.listChatTemplates.mockResolvedValue({templates:[material],nextCursor:''});mocks.api.listOutputFormats.mockResolvedValue([{blueprintId:'editor',output:{id:'document'},requiresSetup:false}]);
 mocks.api.newGadgetFromBlueprint.mockResolvedValue({getMetadata:async()=>({id:'workspace'}),[Symbol.dispose]:vi.fn()});
 mocks.read.mockResolvedValue({material,improvement:{scope_id:'team',revision:3,name:'Группа'},content:{format:'cloudflareos.document',formatVersion:1,document:{title:'Методика',blocks:[{html:'<p>Цель</p>'}]}}});
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 try{await act(async()=>root.render(<ChatTemplatePicker embedded preferredProject={{accountId:7,projectId:'source'}} initialSelected={[{...material,accountId:7}]} onClose={()=>{}} onSelect={()=>{}}/>));
 await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="Посмотреть: Методика"]')!.click());
 const button=()=>[...document.body.querySelectorAll('button')].find(item=>item.textContent==='Предложить улучшение')!;expect(button()).toBeDefined();await act(async()=>button().click());expect(document.body.textContent).toContain('Откроется личная копия');expect(document.body.textContent).toContain('Общий шаблон изменится только после согласования');
 expect(mocks.read).toHaveBeenCalledWith(mocks.api,7,reference,expect.any(AbortSignal));
 await act(async()=>[...document.body.querySelectorAll('button')].find(item=>item.textContent==='Открыть редактор')!.click());expect(mocks.navigate).toHaveBeenCalledWith({to:'/workspace/$id',params:{id:'workspace'},search:{templateKind:'guidance',templateEdit:{accountId:7,projectId:'source',reference}}});
 }finally{await act(async()=>root.unmount());host.remove()}
});
