// @vitest-environment jsdom
import React from 'react'
import {createRoot} from 'react-dom/client'
import {beforeEach,afterEach,test,expect,vi} from 'vitest'
const {webcrypto}=await vi.importActual<{webcrypto:Crypto}>('node:crypto')
import WorkTemplatePreview from './WorkTemplatePreview'
const mocks=vi.hoisted(()=>({api:{listOutputFormats:vi.fn(),newGadgetFromBlueprint:vi.fn()},navigate:vi.fn(),preview:vi.fn<(...args:unknown[])=>Promise<unknown>>(),validate:vi.fn<(...args:unknown[])=>Promise<void>>(),dispose:vi.fn<()=>void>(),open:vi.fn<(...args:unknown[])=>Promise<unknown>>()}))
vi.mock('@tanstack/react-router',()=>({useNavigate:()=>mocks.navigate}))
vi.mock('./AuthContext',()=>({useAuthenticatedApi:()=>({authenticatedApi:mocks.api})}))
vi.mock('./accountCapabilities',()=>({openBlueprintTemplatesFrame:(...args:unknown[])=>mocks.open(...args)}))
vi.mock('./disposeGatekeeperFrame',()=>({disposeGatekeeperFrame:()=>mocks.dispose()}))
const item={accountId:7,reference:{template_id:'form',revision:5},title:'Форма ТЗ',purpose:'Задача',kind:'document' as const};
let container:HTMLDivElement,root:ReturnType<typeof createRoot>;
beforeEach(()=>{
 vi.clearAllMocks();vi.stubGlobal('crypto',webcrypto);(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
 mocks.open.mockResolvedValue({blueprintTemplates:{storageOrigin:'https://objects.example',selector:{preview:mocks.preview,validatePreview:mocks.validate}}});mocks.validate.mockResolvedValue(undefined);
 container=document.createElement('div');document.body.append(container);root=createRoot(container);
})
afterEach(async()=>{await React.act(async()=>root.unmount());container.remove();vi.unstubAllGlobals()})
async function ticket(content:string,mime:string){
 const bytes=new TextEncoder().encode(content),digest=new Uint8Array(await webcrypto.subtle.digest('SHA-256',bytes));
 const sha=[...digest].map(b=>b.toString(16).padStart(2,'0')).join('');
 mocks.preview.mockResolvedValue({material:{reference:item.reference,title:item.title,purpose:item.purpose,kind:item.kind},sourceProjectId:'source-project',sourceHead:'a'.repeat(64),ticket:{url:'https://objects.example/form',method:'GET',size_bytes:bytes.length,sha256_hex:sha,content_type:mime}});
 const fetcher=vi.fn<(...args:unknown[])=>Promise<Response>>().mockImplementation(async()=>new Response(bytes));vi.stubGlobal('fetch',fetcher);return fetcher;
}
const button=(label:string)=>[...document.body.querySelectorAll('button')].find(b=>b.textContent===label)!;
const settle=async()=>vi.waitFor(async()=>{await React.act(async()=>{});expect(document.body.querySelector('[aria-label="Содержимое шаблона"]')?.getAttribute('aria-busy')).toBe('false')},{interval:5,timeout:1000});
test('показывает точный нативный снимок после проверки доступа, не исполняет HTML и выбирает только явно',async()=>{
 const snapshot={format:'cloudflareos.document',formatVersion:1,document:{title:'Шаблон ТЗ',blocks:[{id:'one',html:'<h1>Требования</h1><p onclick="alert(1)">Содержание<img src="https://tracking.example/pixel"/><script>alert(1)</script></p>'}]}};
 const fetcher=await ticket(JSON.stringify(snapshot),'application/vnd.cloudflareos.document+json'),toggle=vi.fn<(...args:unknown[])=>void>();
 await React.act(async()=>root.render(<WorkTemplatePreview item={item} selected={false} atLimit={false} onToggle={toggle} onBack={()=>{}} onClose={()=>{}}/>));await settle();
 expect(document.body.textContent).toContain('Требования');expect(document.body.querySelector('script,img,[onclick]')).toBeNull();
 expect(mocks.validate).toHaveBeenCalledWith(item.reference,'a'.repeat(64));expect(fetcher).toHaveBeenCalledOnce();expect(fetcher.mock.calls[0][1]).toMatchObject({credentials:'omit',redirect:'error'});expect(toggle).not.toHaveBeenCalled();
 await React.act(async()=>button('Выбрать для задачи').click());expect(toggle.mock.calls[0][0]).toMatchObject({accountId:7,reference:item.reference});
});
test('отзыв перед показом скрывает загруженный текст, а повтор читает ту же версию',async()=>{
 await ticket('Секретная методика','text/plain');mocks.validate.mockRejectedValueOnce(new Error('revoked'));
 await React.act(async()=>root.render(<WorkTemplatePreview item={item} selected={false} atLimit={false} onToggle={()=>{}} onBack={()=>{}} onClose={()=>{}}/>));await settle();
 expect(document.body.querySelector('[role="alert"]')).not.toBeNull();expect(document.body.textContent).not.toContain('Секретная методика');expect(button('Выбрать для задачи').disabled).toBe(true);
 await React.act(async()=>button('Повторить просмотр').click());await settle();
 expect(document.body.textContent).toContain('Секретная методика');expect(mocks.preview.mock.calls.map(args=>args[0])).toEqual([item.reference,item.reference]);
});

async function versions(mixed=false){
 const tickets=new Map<number,unknown>(),bytes=new Map<string,Uint8Array>()
 for(const revision of [4,5]){
  const content=JSON.stringify({format:'cloudflareos.document',formatVersion:1,document:{title:'Форма ТЗ',blocks:[{html:mixed?'<div>Сумма '+(revision===4?'100':'500')+'<p>Условия оплаты</p></div>':revision===4?'<p>Уточните цель.</p>':'<p>Уточните цель.</p><p>Добавьте критерии приёмки.</p>'}]}})
  const body=new TextEncoder().encode(content),digest=new Uint8Array(await webcrypto.subtle.digest('SHA-256',body));const url='https://objects.example/version-'+revision;bytes.set(url,body)
  tickets.set(revision,{material:{reference:{...item.reference,revision},title:item.title,purpose:item.purpose,kind:item.kind},sourceHead:String(revision).repeat(64),ticket:{url,method:'GET',size_bytes:body.length,sha256_hex:[...digest].map(b=>b.toString(16).padStart(2,'0')).join(''),content_type:'application/vnd.cloudflareos.document+json'}})
 }
 mocks.preview.mockImplementation(async(ref:unknown)=>tickets.get((ref as {revision:number}).revision));vi.stubGlobal('fetch',vi.fn(async(url:string)=>new Response(new Uint8Array(bytes.get(String(url))!))))
}
test('Прежняя версия выбирается точно; сравнение заново читает обе версии с правами',async()=>{
 await versions();const toggle=vi.fn();await React.act(async()=>root.render(<WorkTemplatePreview item={item} selected={false} isSelected={viewed=>viewed.reference.revision===4} atLimit={true} onToggle={toggle} onBack={()=>{}} onClose={()=>{}}/>));await settle()
 await React.act(async()=>button('Версии').click());await React.act(async()=>button('Предыдущая').click());await settle()
 expect(document.body.textContent).toContain('версия 4');expect(document.body.textContent).not.toContain('Добавьте критерии приёмки.')
 expect(button('Убрать из задачи').disabled).toBe(false);await React.act(async()=>button('Убрать из задачи').click());expect(toggle).toHaveBeenCalledWith(expect.objectContaining({reference:{template_id:'form',revision:4}}))
 await React.act(async()=>button('Следующая').click());await settle();await React.act(async()=>button('Что изменилось').click())
 await vi.waitFor(async()=>{await React.act(async()=>{});expect(document.body.querySelector('ins')?.textContent).toContain('Добавьте критерии приёмки.')},{interval:5,timeout:1000})
 expect(mocks.preview.mock.calls.slice(-2).map(args=>args[0])).toEqual([{template_id:'form',revision:4},{template_id:'form',revision:5}]);expect(mocks.validate).toHaveBeenCalledWith({template_id:'form',revision:4},'4'.repeat(64));expect(mocks.validate).toHaveBeenCalledWith(item.reference,'5'.repeat(64))
})
test('Отказ доступа к одной версии не показывает частичное сравнение',async()=>{
 await versions();await React.act(async()=>root.render(<WorkTemplatePreview item={item} selected={false} atLimit={false} onToggle={()=>{}} onBack={()=>{}} onClose={()=>{}}/>));await settle()
 mocks.validate.mockRejectedValueOnce(Error('revoked'));await React.act(async()=>button('Версии').click());await React.act(async()=>button('Что изменилось').click())
 await vi.waitFor(async()=>{await React.act(async()=>{});expect(document.body.querySelector('[role="alert"]')?.textContent).toContain('Сравнение недоступно')},{interval:5,timeout:1000})
 expect(document.body.querySelector('ins,del')).toBeNull();expect(document.body.textContent).not.toContain('Добавьте критерии приёмки.')
})

test('Сравнение не пропускает текст рядом с вложенным абзацем',async()=>{
 await versions(true);await React.act(async()=>root.render(<WorkTemplatePreview item={item} selected={false} atLimit={false} onToggle={()=>{}} onBack={()=>{}} onClose={()=>{}}/>));await settle();await React.act(async()=>button('Версии').click());await React.act(async()=>button('Что изменилось').click())
 await vi.waitFor(async()=>{await React.act(async()=>{});expect(document.body.querySelector('del')?.textContent).toBe('100');expect(document.body.querySelector('ins')?.textContent).toBe('500')},{interval:5,timeout:1000})
 expect(document.body.textContent).not.toContain('Текст содержимого не изменился.')
})

test('Просмотр общей версии показывает отдельный вход к следующему уровню без проекта личной копии',async()=>{
 const snapshot={format:'cloudflareos.document',formatVersion:1,document:{title:'Методика',blocks:[{html:'<p>Проверять требования</p>'}]}};await ticket(JSON.stringify(snapshot),'application/vnd.cloudflareos.document+json');
 const preview=await mocks.preview();const reference={scope_id:'team',template_key:'method',revision:5};mocks.preview.mockResolvedValue({...preview as object,material:{reference,title:'Методика',purpose:'ТЗ',kind:'guidance'},promotion:{scope_id:'dept',revision:3,name:'Разработка',level:'department'}});
 await React.act(async()=>root.render(<WorkTemplatePreview item={{...item,reference,kind:'guidance'}} selected={false} atLimit={false} onToggle={()=>{}} onBack={()=>{}} onClose={()=>{}}/>));await settle();
 expect([...document.body.querySelectorAll('summary')].map(item=>item.textContent)).toContain('Предложить отделу');expect(document.body.textContent).toContain('Версия 5 станет доступна там после отдельного согласования');
});

test('просмотр из готового документа не предлагает применить шаблон заново',async()=>{
 const snapshot={format:'cloudflareos.document',formatVersion:1,document:{title:'Форма ТЗ',blocks:[{html:'<p>Критерии приёмки</p>'}]}};await ticket(JSON.stringify(snapshot),'application/vnd.cloudflareos.document+json');const toggle=vi.fn();
 await React.act(async()=>root.render(<WorkTemplatePreview readOnly item={item} editingProject={{accountId:7,projectId:'result-project'}} selected={false} atLimit={false} onToggle={toggle} onBack={()=>{}} onClose={()=>{}} backLabel="Назад к документу"/>));await settle();
 expect(document.body.textContent).toContain('Просмотр не меняет созданный документ');expect(document.body.textContent).toContain('Критерии приёмки');expect(button('Выбрать для задачи')).toBeUndefined();expect(button('Редактировать')).toBeDefined();expect(toggle).not.toHaveBeenCalled();expect(mocks.preview).toHaveBeenCalledWith(item.reference);
});

test('редактирование личного шаблона из результата открывает исходный проект и точную версию',async()=>{
 const snapshot={format:'cloudflareos.document',formatVersion:1,document:{title:'Форма ТЗ',blocks:[{html:'<p>Критерии</p>'}]}};await ticket(JSON.stringify(snapshot),'application/vnd.cloudflareos.document+json');
 mocks.api.listOutputFormats.mockResolvedValue([{blueprintId:'native-doc',output:{id:'document'}}]);mocks.api.newGadgetFromBlueprint.mockResolvedValue({getMetadata:async()=>({id:'edit-draft'}),[Symbol.dispose]:vi.fn()});mocks.navigate.mockResolvedValue(undefined);
 await React.act(async()=>root.render(<WorkTemplatePreview readOnly item={item} editingProject={{accountId:7,projectId:'result-project'}} selected={false} atLimit={false} onToggle={()=>{}} onBack={()=>{}} onClose={()=>{}}/>));await settle();
 await React.act(async()=>button('Редактировать').click());await React.act(async()=>button('Открыть редактор').click());
 expect(mocks.navigate).toHaveBeenCalledWith({to:'/workspace/$id',params:{id:'edit-draft'},search:{templateKind:'document',templateEdit:{accountId:7,projectId:'source-project',reference:item.reference,autoOpen:true}}});
});
test('личный шаблон без подтверждённого исходного проекта доступен только для просмотра',async()=>{
 const snapshot={format:'cloudflareos.document',formatVersion:1,document:{title:'Форма',blocks:[]}};await ticket(JSON.stringify(snapshot),'application/vnd.cloudflareos.document+json');const preview=await mocks.preview();mocks.preview.mockResolvedValue({...preview as object,sourceProjectId:undefined});
 await React.act(async()=>root.render(<WorkTemplatePreview readOnly item={item} editingProject={{accountId:7,projectId:'result-project'}} selected={false} atLimit={false} onToggle={()=>{}} onBack={()=>{}} onClose={()=>{}}/>));await settle();expect(button('Редактировать')).toBeUndefined();expect(document.body.textContent).toContain('Форма');
});

 test('неподдерживаемый формат назван явно, не скачивается и не предлагается текстовая подмена',async()=>{
 const fetcher=await ticket('Не должно скачаться','application/vnd.cloudflareos.spreadsheet+json');const unavailable=await mocks.preview();mocks.preview.mockResolvedValue({material:(unavailable as {material:unknown}).material,sourceHead:'a'.repeat(64),unavailable:'format'});
 await React.act(async()=>root.render(<WorkTemplatePreview item={item} selected={false} atLimit={false} onToggle={()=>{}} onBack={()=>{}} onClose={()=>{}}/>));await settle();
 expect(document.body.querySelector('[role="alert"]')?.textContent).toContain('Просмотр этого формата пока не поддерживается');
 expect(document.body.textContent).toContain('Таблицы и презентации не заменяются текстовым предпросмотром');
 expect(fetcher).not.toHaveBeenCalled();expect(mocks.validate).toHaveBeenCalledWith(item.reference,'a'.repeat(64));
 expect([...document.body.querySelectorAll('button')].some(b=>b.textContent==='Повторить просмотр')).toBe(false);expect(button('Выбрать для задачи').disabled).toBe(true);
 });
 test('большой снимок не скачивается; размер отличается от ошибки доступа',async()=>{
 const fetcher=await ticket('Большая форма','text/plain');const preview=await mocks.preview();
 mocks.preview.mockResolvedValue({material:(preview as {material:unknown}).material,sourceHead:'a'.repeat(64),unavailable:'size'});
 await React.act(async()=>root.render(<WorkTemplatePreview item={item} selected={false} atLimit={false} onToggle={()=>{}} onBack={()=>{}} onClose={()=>{}}/>));await settle();
 expect(document.body.querySelector('[role="alert"]')?.textContent).toContain('Шаблон превышает предел просмотра — 1 МиБ');
 expect(fetcher).not.toHaveBeenCalled();expect(mocks.validate).toHaveBeenCalledWith(item.reference,'a'.repeat(64));expect(button('Выбрать для задачи').disabled).toBe(true);
 });
 test('отказ доступа к неподдерживаемому формату не подменяется сообщением об ограничении просмотра',async()=>{
 const fetcher=await ticket('Не должно скачаться','application/vnd.cloudflareos.spreadsheet+json');const unavailable=await mocks.preview();mocks.preview.mockResolvedValue({material:(unavailable as {material:unknown}).material,sourceHead:'a'.repeat(64),unavailable:'format'});mocks.validate.mockRejectedValue(new Error('revoked'));
 await React.act(async()=>root.render(<WorkTemplatePreview item={item} selected={false} atLimit={false} onToggle={()=>{}} onBack={()=>{}} onClose={()=>{}}/>));await settle();
 expect(document.body.querySelector('[role="alert"]')?.textContent).toContain('Проверьте доступ и подключение');
 expect(document.body.textContent).not.toContain('Просмотр этого формата пока не поддерживается');expect(fetcher).not.toHaveBeenCalled();expect(button('Повторить просмотр').disabled).toBe(false);
 });

 test('Текстовая методика предлагает редактор с явным объяснением нового формата',async()=>{
 await ticket('# Правила\nПроверить требования','text/markdown');mocks.api.listOutputFormats.mockResolvedValue([]);
 await React.act(async()=>root.render(<WorkTemplatePreview item={item} selected={false} atLimit={false} editingProject={{accountId:7,projectId:'source-project'}} onToggle={()=>{}} onBack={()=>{}} onClose={()=>{}}/>));await settle();
 expect(button('Редактировать')).toBeDefined();await React.act(async()=>button('Редактировать').click());
 expect(document.body.textContent).toContain('Текст и Markdown откроются как текст');expect(document.body.textContent).toContain('исходная версия останется прежней');expect(mocks.api.newGadgetFromBlueprint).not.toHaveBeenCalled();
 });
