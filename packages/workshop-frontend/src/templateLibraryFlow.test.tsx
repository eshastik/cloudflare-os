// @vitest-environment jsdom
import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {expect,test,vi} from 'vitest'
const state=vi.hoisted(()=>({
 navigate:vi.fn<(options:unknown)=>void>(),newChat:vi.fn<(...args:unknown[])=>Promise<number>>(async()=>7),
 newGadget:vi.fn<()=>unknown>(),
 api:{listModels:async()=>[],listChatProjects:async()=>[{accountId:3,projectId:'source',title:'Проект'}],codeWorkAllowed:async()=>false,listChatTemplateAccounts:async()=>[{accountId:3,title:'Mnemos'}],listChatTemplateScopes:async()=>({scopes:[],nextCursor:''}),listChatTemplates:async()=>({templates:[{reference:{template_id:'form',revision:5},title:'Форма ТЗ',purpose:'Создать ТЗ',kind:'document'},{reference:{template_id:'method',revision:3},title:'Методика ТЗ',purpose:'Порядок работы',kind:'guidance'}],nextCursor:''})}
}))
const sessionApi={...state.api,newGadget:state.newGadget}
vi.mock('./accountCapabilities',()=>({openBlueprintTemplatesFrame:async()=>({blueprintTemplates:{selector:{agentAccess:async()=>({ready:true,scopes:[],bindingId:'agent'})}},[Symbol.dispose]:()=>{}})}))
vi.mock('./AuthContext',()=>({useAuthenticatedApi:()=>({authenticatedApi:sessionApi})}))
vi.mock('@tanstack/react-router',async original=>({...await original<object>(),useNavigate:()=>state.navigate}))
vi.mock('@cloudflare/kumo',async original=>({...await original<object>(),useKumoToastManager:()=>({add:()=>{}})}))
vi.mock('./SharedTemplateLibrary',()=>({default:()=><p>Общие приложения</p>}))
vi.mock('./components/BlueprintList',()=>({default:()=><p>Мои приложения</p>}))
vi.mock('./useVendorBranding',()=>({useVendorBranding:()=>({})}))
vi.mock('./useDocumentTitle',()=>({useDocumentTitle:()=>{}}))
import BlueprintsRoutePage from './TemplateLibraryPage'
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true

test('Библиотека передаёт форму и методику в новую задачу; возврат сохраняет текст и отправка точные ссылки',async()=>{
 const values=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value),removeItem:(key:string)=>values.delete(key),clear:()=>values.clear()});vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});state.newGadget.mockReturnValue({newChat:state.newChat,getMetadata:async()=>({id:'workspace'}),[Symbol.dispose]:()=>{}});
 const catalogLoad=vi.spyOn(sessionApi,'listChatTemplateAccounts');
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 const click=async(text:string)=>act(async()=>[...host.querySelectorAll('button')].find(button=>button.textContent===text)!.click());
 try{
 await act(async()=>root.render(<BlueprintsRoutePage/>));expect(document.querySelector('[role="dialog"]')).toBeNull();expect(host.querySelector('[aria-label="Рабочие шаблоны"]')).not.toBeNull();
 for(const title of ['Форма ТЗ','Методика ТЗ'])await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('[aria-label="Рабочие шаблоны Mnemos"] button[aria-pressed]')].find(button=>button.textContent?.startsWith(title))!.click());
 expect(catalogLoad).toHaveBeenCalledTimes(1);
 await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="Посмотреть: Форма ТЗ"]')!.click());expect(document.querySelector('[role="dialog"]')).not.toBeNull();await act(async()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));expect(document.querySelector('[role="dialog"]')).toBeNull();
 await click('Мои приложения');await click('Рабочие шаблоны');expect(host.querySelector('[aria-label="Рабочие шаблоны Mnemos"]')?.querySelectorAll('[aria-pressed="true"]')).toHaveLength(2);
 await click('Использовать выбранные (2)');expect(state.newChat).not.toHaveBeenCalled();
 const input=host.querySelector('textarea')!;expect(input).not.toBeNull();await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(input,'Подготовь ТЗ для клиента');input.dispatchEvent(new Event('input',{bubbles:true}))});
 expect(host.textContent).toContain('Форма документа · версия 5');expect(host.textContent).toContain('Методика · версия 3');
 await click('Назад к библиотеке');await click('Вернуться к черновику задачи');expect(host.querySelector('textarea')).toBe(input);expect(input.value).toBe('Подготовь ТЗ для клиента');expect(state.newChat).not.toHaveBeenCalled();
 await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="Отправить сообщение"]')!.click());expect(state.newChat).toHaveBeenCalledOnce();expect(state.newChat.mock.calls[0][0]).toBe('Подготовь ТЗ для клиента');expect(state.newChat.mock.calls[0][6]).toEqual([{accountId:3,reference:{template_id:'form',revision:5}},{accountId:3,reference:{template_id:'method',revision:3}}]);expect(state.navigate).toHaveBeenCalledWith({to:'/workspace/$id',params:{id:'workspace'},search:{chat:7}});
 }finally{await act(async()=>root.unmount());host.remove();catalogLoad.mockRestore();vi.unstubAllGlobals()}
})
