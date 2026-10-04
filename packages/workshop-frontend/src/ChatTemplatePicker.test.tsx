// @vitest-environment jsdom
import React from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import ChatTemplatePicker, { loadChatTemplates, messageWithTemplate } from './ChatTemplatePicker'
const api = vi.hoisted(() => ({ listChatTemplateAccounts:vi.fn(),listChatProjects:vi.fn(),listChatTemplateScopes:vi.fn(),listChatTemplates:vi.fn(),listOutputFormats: vi.fn<(...args: unknown[]) => Promise<unknown>>(), listOwnBlueprints: vi.fn<(...args: unknown[]) => Promise<unknown>>(), listLibraryBlueprints: vi.fn<(...args: unknown[]) => Promise<unknown>>(), listFeaturedBlueprints: vi.fn<(...args: unknown[]) => Promise<unknown>>() }))
vi.mock('./AuthContext', () => ({ useAuthenticatedApi: () => ({ authenticatedApi: api }) }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
function setup() {
  api.listChatTemplateAccounts.mockResolvedValue([{accountId:7,title:'Mnemos'}])
  api.listChatProjects.mockResolvedValue([{accountId:7,projectId:'source',title:'Проект'}])
  api.listChatTemplateScopes.mockResolvedValue({scopes:[{scopeId:'department',title:'Отдел'}],nextCursor:''})
  api.listChatTemplates.mockImplementation(async (_account,scope)=>({templates:scope===null?[{reference:{template_id:'method',revision:3},title:'Методика ТЗ',purpose:'Подготовить ТЗ',kind:'guidance'},{reference:{template_id:'form',revision:5},title:'Форма ТЗ',purpose:'Создать документ',kind:'document'}]:[],nextCursor:''}))
  api.listOutputFormats.mockResolvedValue([])
  api.listOwnBlueprints.mockResolvedValue([{ id: 'contract', title: 'Договор', description: 'Для клиента' }])
  api.listLibraryBlueprints.mockResolvedValue([{ id: 'contract', metadata: { title: 'Дубликат', description: '' } }, { id: 'report', metadata: { title: 'Отчёт', description: 'За месяц' } }])
  api.listFeaturedBlueprints.mockResolvedValue([])
}
afterEach(() => vi.clearAllMocks())
it('читает существующие Blueprints и объединяет совпадающие ID', async () => {
  setup()
  const result = await loadChatTemplates(api as never)
  expect(result.items.map(item => [item.id, item.title])).toEqual([['contract', 'Договор'], ['report', 'Отчёт']])
  expect(result.failed).toBe(0)
})
it('частичный отказ не скрывает доступные шаблоны', async () => {
  setup(); api.listFeaturedBlueprints.mockRejectedValue(new Error('offline'))
  const result = await loadChatTemplates(api as never)
  expect(result.failed).toBe(1); expect(result.items).toHaveLength(2)
})
it('ссылка сохраняет точный ID и экранирует имя шаблона', () => {
  const message = messageWithTemplate('Подготовь договор', { id: 'a/b', title: '[Договор]', description: '' }, 'https://mnemos.example')
  expect(message).toContain('Подготовь договор\n\nШаблон:')
  expect(message).toContain('https://mnemos.example/blueprint/a%2Fb')
  expect(message).toContain('\\[Договор\\]')
  expect(messageWithTemplate('Мой текст', null, 'https://mnemos.example')).toBe('Мой текст')
})
it('выбор возвращает Blueprint в беседу без создания и перехода', async () => {
  setup()
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host), selected = vi.fn<() => void>(), close = vi.fn<() => void>()
  try {
    await React.act(async () => root.render(<><textarea defaultValue="Неотправленная задача" /><ChatTemplatePicker onSelect={selected} onClose={close} /></>))
    await React.act(async()=>[...document.querySelectorAll('button')].find(button=>button.textContent?.includes('Другие шаблоны'))!.click())
    const choice = [...document.querySelectorAll('button')].find(button => button.textContent?.includes('Договор'))!
    await React.act(async () => choice.click())
    expect(selected).toHaveBeenCalledWith({ id: 'contract', title: 'Договор', description: 'Для клиента' })
    expect(host.querySelector('textarea')?.value).toBe('Неотправленная задача')
    await React.act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Закрыть выбор шаблона"]')!.click())
    expect(close).toHaveBeenCalledOnce()
  } finally { await React.act(async () => root.unmount()); host.remove() }
})

it('выбирает точные версии формы и методики без добавления URL в текст',async()=>{
 setup();const host=document.createElement('div');document.body.append(host);const root=createRoot(host),selected=vi.fn();
 try{
  await React.act(async()=>root.render(<ChatTemplatePicker onSelect={selected} onClose={()=>{}}/>));
  expect(api.listChatTemplates).toHaveBeenCalledWith(7,null,'','source');
  expect(api.listOwnBlueprints).not.toHaveBeenCalled();
  for(const title of ['Методика ТЗ','Форма ТЗ'])await React.act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent?.startsWith(title))!.click());
  expect(selected).not.toHaveBeenCalled();
  await React.act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent?.includes('Использовать выбранные (2)'))!.click());
  const chosen=selected.mock.calls[0][0];
  expect(chosen.mnemos.map((item:{reference:unknown})=>item.reference)).toEqual([{template_id:'method',revision:3},{template_id:'form',revision:5}]);
  expect(chosen.title).toContain('версия 3');expect(chosen.title).toContain('версия 5');
  expect(messageWithTemplate('Подготовь ТЗ',chosen,'https://mnemos.example')).toBe('Подготовь ТЗ');
 }finally{await React.act(async()=>root.unmount());host.remove();}
});
it('отказ выбранной области не заменяется личными или родительскими шаблонами',async()=>{
 setup();const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 try{
  await React.act(async()=>root.render(<ChatTemplatePicker onSelect={()=>{}} onClose={()=>{}}/>));
  api.listChatTemplates.mockRejectedValue(new Error('access denied'));
  await React.act(async()=>{const select=document.querySelector<HTMLSelectElement>('[aria-label="Область шаблонов"]')!;select.value='department';select.dispatchEvent(new Event('change',{bubbles:true}));});
  expect(api.listChatTemplates).toHaveBeenLastCalledWith(7,'department','',undefined);
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('Выбранный каталог недоступен');
  expect(document.body.textContent).not.toContain('Методика ТЗ');expect(api.listOwnBlueprints).not.toHaveBeenCalled();
  api.listChatTemplates.mockResolvedValue({templates:[],nextCursor:''});
  await React.act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Повторить')!.click());
  expect(api.listChatTemplates).toHaveBeenLastCalledWith(7,'department','',undefined);
  expect(document.querySelector<HTMLSelectElement>('[aria-label="Область шаблонов"]')?.value).toBe('department');
 }finally{await React.act(async()=>root.unmount());host.remove();}
});

it('при повторном открытии сохраняет точные версии и позволяет убрать материал через фильтр',async()=>{
 setup();const host=document.createElement('div');document.body.append(host);const root=createRoot(host),selected=vi.fn();
 const initial=[{accountId:7,reference:{template_id:'method',revision:3},title:'Методика ТЗ',purpose:'Подготовить ТЗ',kind:'guidance' as const},{accountId:7,reference:{template_id:'form',revision:5},title:'Форма ТЗ',purpose:'Создать документ',kind:'document' as const}];
 try{
  await React.act(async()=>root.render(<ChatTemplatePicker initialSelected={initial} onSelect={selected} onClose={()=>{}}/>));
  await React.act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Другие шаблоны')!.click());
  await React.act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Назад к рабочим шаблонам')!.click());
  const catalog=document.querySelector('[aria-label="Рабочие шаблоны Mnemos"]')!;
  expect(catalog.querySelectorAll('[aria-pressed="true"]')).toHaveLength(2);
  await React.act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Формы')!.click());
  expect(catalog.textContent).toContain('Форма ТЗ');expect(catalog.textContent).not.toContain('Методика ТЗ');
  expect(document.querySelector('[aria-label="Выбранные шаблоны"]')?.textContent).toContain('Методика ТЗ · версия 3');
  await React.act(async()=>document.querySelector<HTMLButtonElement>('[aria-label="Убрать: Методика ТЗ"]')!.click());
  expect(initial).toHaveLength(2);expect(selected).not.toHaveBeenCalled();
  await React.act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Использовать выбранные (1)')!.click());
  expect(selected.mock.calls[0][0].mnemos).toEqual([initial[1]]);
  const shared=[{...initial[1],reference:{scope_id:'later-page',template_key:'form',revision:5}}];
  api.listChatTemplates.mockResolvedValue({templates:shared,nextCursor:''});
  await React.act(async()=>root.render(<ChatTemplatePicker key="shared" initialSelected={shared} onSelect={selected} onClose={()=>{}}/>));
  const scope=document.querySelector<HTMLSelectElement>('[aria-label="Область шаблонов"]')!;
  expect(scope.value).toBe('later-page');expect(scope.selectedOptions[0].textContent).toBe('Область выбранного шаблона');
  expect(api.listChatTemplates).toHaveBeenLastCalledWith(7,'later-page','',undefined);
 }finally{await React.act(async()=>root.unmount());host.remove();}
});
