// @vitest-environment jsdom
import React from 'react'
import {createRoot} from 'react-dom/client'
import {beforeEach,afterEach,expect,it,vi} from 'vitest'
import WorkTemplateSharing from './WorkTemplateSharing'
const mocks=vi.hoisted(()=>({api:{},prepare:vi.fn(),review:vi.fn(),share:vi.fn(),propose:vi.fn(),dispose:vi.fn()}))
vi.mock('./AuthContext',()=>({useAuthenticatedApi:()=>({authenticatedApi:mocks.api})}))
vi.mock('./accountCapabilities',()=>({openBlueprintTemplatesFrame:async()=>({blueprintTemplates:{selector:{prepareSharing:mocks.prepare,scopes:async()=>({scopes:[{scope_id:'team',revision:3,name:'Учебная команда',level:'group',enabled:true}],next_cursor:''})}}})}))
vi.mock('./disposeGatekeeperFrame',()=>({disposeGatekeeperFrame:()=>{}}))
const item={accountId:0,reference:{template_id:'form',revision:2},title:'Форма',purpose:'ТЗ',kind:'document'} as const
let root:ReturnType<typeof createRoot>,host:HTMLDivElement
const settle=async()=>{await React.act(async()=>{await new Promise(resolve=>setTimeout(resolve,0))})}
const button=(name:string)=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent===name)!
async function click(name:string){await React.act(async()=>button(name).click());await settle()}
async function field(label:string,value:string){await React.act(async()=>{const element=document.querySelector('[aria-label="'+label+'"]') as HTMLInputElement;Object.getOwnPropertyDescriptor(element.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLTextAreaElement.prototype,'value')!.set!.call(element,value);element.dispatchEvent(new Event(element.tagName==='SELECT'?'change':'input',{bubbles:true}))});await settle()}
beforeEach(async()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);localStorage.clear();vi.clearAllMocks();mocks.review.mockResolvedValue({key:'plan',reviewers:[{id:'reviewer',name:'Согласующий',canRead:false}]});mocks.share.mockResolvedValue({key:'plan',reviewers:[{id:'reviewer',name:'Согласующий',canRead:true}]});mocks.propose.mockResolvedValue({proposal_id:'q',target_scope_id:'team'});mocks.prepare.mockResolvedValue({reviewAccess:mocks.review,shareForReview:mocks.share,propose:mocks.propose,[Symbol.dispose]:mocks.dispose});host=document.createElement('div');document.body.append(host);root=createRoot(host);await React.act(async()=>root.render(<WorkTemplateSharing item={item}/>))})
afterEach(async()=>{await React.act(async()=>root.unmount());host.remove();vi.unstubAllGlobals()})
it('отправляет точную сохранённую версию только после явного доступа согласующему',async()=>{
 expect(mocks.prepare).not.toHaveBeenCalled();await click('Предложить команде');await field('Команда для шаблона','team');await field('Объяснение общего шаблона','Проверяемые требования команды');expect(button('Отправить на согласование').disabled).toBe(true);expect(mocks.share).not.toHaveBeenCalled();
 await click('Открыть согласующим этот шаблон');expect(mocks.share).toHaveBeenCalledWith('team',3,'plan');expect(button('Отправить на согласование').disabled).toBe(false);await click('Отправить на согласование');expect(mocks.prepare).toHaveBeenCalledWith(item.reference,expect.any(String));expect(mocks.propose).toHaveBeenCalledWith('team',3,'Проверяемые требования команды','plan');expect(document.body.textContent).toContain('Отправлено на согласование');
})
it('потеря ответа сохраняет операцию и объяснение для проверки и повтора',async()=>{
 mocks.review.mockResolvedValue({key:'plan',reviewers:[{id:'r',name:'Согласующий',canRead:true}]});mocks.propose.mockRejectedValueOnce(Error('lost'));
 await click('Предложить команде');await field('Команда для шаблона','team');await field('Объяснение общего шаблона','Для команды');await click('Отправить на согласование');await click('Повторить проверку');expect(mocks.prepare.mock.calls[0][1]).toBe(mocks.prepare.mock.calls[1][1]);expect((document.querySelector('[aria-label="Объяснение общего шаблона"]') as HTMLTextAreaElement).disabled).toBe(true);await click('Продолжить отправку');expect(mocks.propose.mock.calls[0]).toEqual(mocks.propose.mock.calls[1]);expect(document.body.textContent).toContain('Отправлено на согласование');
})
