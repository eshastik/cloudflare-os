// @vitest-environment jsdom
import React from 'react'
import {createRoot} from 'react-dom/client'
import {beforeEach, afterEach, expect, test, vi} from 'vitest'
import BlueprintTemplateSave from './BlueprintTemplateSave'
const mocks=vi.hoisted(()=>({accounts:vi.fn<(...args:unknown[])=>Promise<unknown>>(),api:{captureBlueprintTemplate:vi.fn<(...args: unknown[]) => Promise<unknown>>()}, creator:{reviewAccess:vi.fn<(...args:unknown[])=>Promise<unknown>>(),shareForReview:vi.fn<(...args:unknown[])=>Promise<unknown>>(),state:vi.fn<(...args: unknown[]) => Promise<unknown>>(),issue:vi.fn<(...args: unknown[]) => Promise<unknown>>(),checkpoint:vi.fn<(...args: unknown[]) => Promise<unknown>>(),save:vi.fn<(...args: unknown[]) => Promise<unknown>>(),propose:vi.fn<(...args: unknown[]) => Promise<unknown>>(),[Symbol.dispose]:vi.fn<(...args: unknown[]) => Promise<unknown>>()}, selector:{latest:vi.fn<(...args: unknown[]) => Promise<unknown>>(),projects:vi.fn<(...args: unknown[]) => Promise<unknown>>(),scopes:vi.fn<(...args: unknown[]) => Promise<unknown>>(),prepare:vi.fn<(...args: unknown[]) => Promise<unknown>>(),resume:vi.fn<(...args: unknown[]) => Promise<unknown>>()}, nativeUpload:vi.fn<(...args: unknown[]) => Promise<unknown>>(),upload:vi.fn<(...args: unknown[]) => Promise<unknown>>()}))
vi.mock('./AuthContext',()=>({useAuthenticatedApi:()=>({authenticatedApi:mocks.api})}))
vi.mock('./accountCapabilities',()=>({listAccounts:()=>mocks.accounts(),storesDocuments:()=>true,openBlueprintTemplatesFrame:async()=>({blueprintTemplates:{storageOrigin:'https://objects.example',selector:mocks.selector}})}))
vi.mock('./gatekeeperAppUpload',()=>({uploadGatekeeperNativeDocument:(...args:unknown[])=>mocks.nativeUpload(...args),uploadGatekeeperBlueprintTemplate:(...args:unknown[])=>mocks.upload(...args)}))
vi.mock('./disposeGatekeeperFrame',()=>({disposeGatekeeperFrame:vi.fn<(...args: unknown[]) => Promise<unknown>>()}))
let root:ReturnType<typeof createRoot>, container:HTMLDivElement
beforeEach(()=>{
  vi.clearAllMocks();sessionStorage.clear();(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true
  mocks.accounts.mockResolvedValue([{id:8,vendorId:'memory',description:{displayName:'Компания'}}])
  mocks.selector.latest.mockResolvedValue(null)
  mocks.selector.projects.mockResolvedValue({projects:[{id:'project',name:'Проект'}]})
  mocks.selector.scopes.mockResolvedValueOnce({scopes:[{scope_id:'company',revision:1,level:'organization',name:'Компания',enabled:true},{scope_id:'department',revision:2,level:'department',name:'Финансовый отдел',enabled:true}],next_cursor:'groups'}).mockResolvedValue({scopes:[{scope_id:'finance',revision:4,level:'group',name:'Финансовая группа',enabled:true}]})
  mocks.selector.prepare.mockResolvedValue({id:'capture',creator:mocks.creator})
  mocks.creator.state.mockResolvedValue({upload:'',version:null})
  mocks.creator.save.mockResolvedValue({template_id:'template',revision:1,title:'Отчёт',purpose:'Финансовый отчёт',project_id:'project'})
  mocks.creator.reviewAccess.mockResolvedValue({key:'access-plan',reviewers:[{id:'reviewer',name:'Согласующий',canRead:true}]})
  mocks.creator.shareForReview.mockResolvedValue({key:'access-plan',reviewers:[{id:'reviewer',name:'Согласующий',canRead:true}]})
  mocks.creator.propose.mockResolvedValue({proposal_id:'proposal',target_scope_id:'finance'})
  mocks.api.captureBlueprintTemplate.mockImplementation(async()=>new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('{}'));controller.close()}}))
  mocks.upload.mockResolvedValue('upload');mocks.nativeUpload.mockResolvedValue('native-upload')
  container=document.createElement('div');document.body.append(container);root=createRoot(container)
})
afterEach(async()=>{await React.act(async()=>root.unmount());container.remove()})
const button=(text:string)=>[...container.querySelectorAll('button')].find(item=>item.textContent===text)!
test('Шаблон сохраняется личным, а уровень группы требует отдельного предложения',async()=>{
  await React.act(async()=>root.render(<BlueprintTemplateSave blueprint={{id:'bp',title:'Отчёт',description:'Финансовый отчёт'}} onClose={()=>{}}/>))
  await React.act(async()=>button('Сохранить личный шаблон').click())
  expect(mocks.selector.prepare).toHaveBeenCalledWith('project','Отчёт','Финансовый отчёт',undefined,'bp')
  expect(mocks.creator.checkpoint).toHaveBeenCalledWith('upload')
  expect(mocks.creator.save).toHaveBeenCalledOnce()
  expect(mocks.creator.propose).not.toHaveBeenCalled()
  const scope=container.querySelector('select')!
  expect([...scope.options].map(item=>item.value)).toEqual(['','finance'])
  expect(mocks.selector.scopes).toHaveBeenCalledWith('groups')
  await React.act(async()=>{scope.value='finance';scope.dispatchEvent(new Event('change',{bubbles:true}))})
  await React.act(async()=>button('Предложить для общего применения').click())
  expect(mocks.creator.propose).toHaveBeenCalledWith('finance',4,undefined,'access-plan')
  expect(container.textContent).toContain('Общий шаблон появится после одобрения')
})
test('Повтор после потери ответа сохраняет ту же операцию и не загружает снимок заново',async()=>{
  mocks.creator.save.mockRejectedValueOnce(new Error('connection'))
  await React.act(async()=>root.render(<BlueprintTemplateSave blueprint={{id:'bp',title:'Отчёт',description:'Финансовый отчёт'}} onClose={()=>{}}/>))
  await React.act(async()=>button('Сохранить личный шаблон').click())
  mocks.creator.state.mockResolvedValue({upload:'upload',version:null})
  await React.act(async()=>button('Сохранить личный шаблон').click())
  expect(mocks.selector.prepare).toHaveBeenCalledOnce()
  expect(mocks.upload).toHaveBeenCalledOnce()
  expect(mocks.creator.save).toHaveBeenCalledTimes(2)
})

test('Новая версия сохраняет идентификатор шаблона и не публикуется автоматически',async()=>{
 await React.act(async()=>root.render(<BlueprintTemplateSave blueprint={{id:'bp',title:'Отчёт',description:'Финансовый отчёт'}} onClose={()=>{}}/>))
 await React.act(async()=>button('Сохранить личный шаблон').click())
 await React.act(async()=>button('Сохранить новую версию').click())
 expect(mocks.selector.prepare).toHaveBeenCalledTimes(1)
 mocks.creator.save.mockResolvedValue({template_id:'template',revision:2,title:'Отчёт',purpose:'Финансовый отчёт',project_id:'project'})
 await React.act(async()=>button('Сохранить изменения шаблона').click())
 expect(mocks.selector.prepare).toHaveBeenLastCalledWith('project','Отчёт','Финансовый отчёт',{template_id:'template',revision:1},'bp')
 expect(mocks.api.captureBlueprintTemplate).toHaveBeenCalledTimes(2)
 expect(mocks.creator.propose).not.toHaveBeenCalled()
 expect(container.textContent).toContain('версия 2')
})

test('отказ групп не мешает личному сохранению, повтор не создаёт новый шаблон',async()=>{
 mocks.selector.scopes.mockReset().mockRejectedValueOnce(new Error('groups unavailable')).mockResolvedValue({scopes:[{scope_id:'finance',revision:4,level:'group',name:'Финансовая группа',enabled:true}],next_cursor:''});
 await React.act(async()=>root.render(<BlueprintTemplateSave blueprint={{id:'bp',title:'Отчёт',description:'Финансовый отчёт'}} onClose={()=>{}}/>));
 expect(button('Сохранить личный шаблон').disabled).toBe(false);
 await React.act(async()=>button('Сохранить личный шаблон').click());
 expect(container.textContent).toContain('Личный шаблон сохранён');
 expect(container.querySelector('[role="alert"]')?.textContent).toContain('Не удалось загрузить группы');
 expect(mocks.creator.propose).not.toHaveBeenCalled();
 await React.act(async()=>button('Повторить загрузку групп').click());
 expect(mocks.selector.prepare).toHaveBeenCalledOnce();expect(mocks.creator.save).toHaveBeenCalledOnce();
 expect(container.querySelector('[role="alert"]')).toBeNull();
 expect(button('Предложить для общего применения').disabled).toBe(true);
 await React.act(async()=>{const scope=container.querySelector('select')!;scope.value='finance';scope.dispatchEvent(new Event('change',{bubbles:true}));});
 await React.act(async()=>button('Предложить для общего применения').click());
 expect(mocks.creator.propose).toHaveBeenCalledWith('finance',4,undefined,'access-plan');
});

test('Документ сохраняется в каталог нативным снимком без создания Blueprint',async()=>{
 const snapshot={format:'cloudflareos.document' as const,formatVersion:1 as const,document:{title:'ТЗ',blocks:[{id:'heading',html:'<h1>Требования</h1>'}]}};
 const read=vi.fn<(...args:unknown[])=>Promise<typeof snapshot>>().mockResolvedValue(snapshot);
 await React.act(async()=>root.render(<BlueprintTemplateSave nativeOnly blueprint={{id:'editor',title:'ТЗ',description:'Форма требований'}} format="cloudflareos.document" snapshotSource={{current:read}} onClose={()=>{}}/>));
 await React.act(async()=>button('Сохранить личный шаблон').click());
 expect(mocks.selector.latest).toHaveBeenCalledWith('native-document:editor');
 expect(mocks.selector.prepare).toHaveBeenCalledWith('project','ТЗ','Форма требований',undefined,'native-document:editor','cloudflareos.document','document');
 expect(read).toHaveBeenCalledOnce();expect(mocks.nativeUpload.mock.calls[0].slice(0,3)).toEqual([snapshot,'cloudflareos.document','https://objects.example']);
 expect(mocks.api.captureBlueprintTemplate).not.toHaveBeenCalled();expect(mocks.upload).not.toHaveBeenCalled();
 expect(mocks.creator.checkpoint).toHaveBeenCalledWith('native-upload');expect(mocks.creator.save).toHaveBeenCalledOnce();expect(mocks.creator.propose).not.toHaveBeenCalled();
});

test('Проект документа выбирается по точному подключению, а не первой позиции',async()=>{
 mocks.accounts.mockResolvedValue([{id:7,vendorId:'memory',description:{displayName:'Другая'}},{id:8,vendorId:'memory',description:{displayName:'Компания'}}]);
 mocks.selector.projects.mockResolvedValue({projects:[{id:'other',name:'Другой'},{id:'document-project',name:'Проект документа'}]});
 await React.act(async()=>root.render(<BlueprintTemplateSave blueprint={{id:'bp',title:'Отчёт',description:'Форма'}} preferredProject={{accountId:8,projectId:'document-project'}} onClose={()=>{}}/>));
 const selects=container.querySelectorAll('select');expect(selects[0].value).toBe('8');expect(selects[1].value).toBe('document-project');
 await React.act(async()=>button('Сохранить личный шаблон').click());expect(mocks.selector.prepare.mock.calls[0][0]).toBe('document-project');
});

test('Недоступный проект или подключение не заменяются первым доступным',async()=>{
 await React.act(async()=>root.render(<BlueprintTemplateSave blueprint={{id:'bp',title:'Отчёт',description:'Форма'}} preferredProject={{accountId:8,projectId:'missing'}} onClose={()=>{}}/>));
 expect(container.querySelector('select')?.value).toBe('');expect(button('Сохранить личный шаблон').disabled).toBe(true);expect(container.textContent).toContain('Проект документа недоступен');
 await React.act(async()=>{const project=container.querySelector('select')!;project.value='project';project.dispatchEvent(new Event('change',{bubbles:true}))});expect(button('Сохранить личный шаблон').disabled).toBe(false);
 await React.act(async()=>root.render(<BlueprintTemplateSave key="other" blueprint={{id:'other',title:'Отчёт',description:'Форма'}} preferredProject={{accountId:99,projectId:'missing'}} onClose={()=>{}}/>));
 expect(container.querySelector('select')?.value).toBe('');expect(button('Сохранить личный шаблон').disabled).toBe(true);expect(container.textContent).toContain('Библиотека документа недоступна');
});

test('Повторное открытие продолжает сохранение в прежнем проекте, несмотря на новый контекст',async()=>{
 sessionStorage.setItem('mnemos-blueprint-save:bp',JSON.stringify({account:8,id:'pending'}));
 mocks.selector.resume.mockResolvedValue(mocks.creator);mocks.creator.state.mockResolvedValue({upload:'upload',project:'project',title:'Сохранённое название',purpose:'Сохранённое назначение',version:null});
 await React.act(async()=>root.render(<BlueprintTemplateSave blueprint={{id:'bp',title:'Отчёт',description:'Форма'}} preferredProject={{accountId:99,projectId:'other'}} onClose={()=>{}}/>));
 expect(container.querySelector('select')?.value).toBe('project');expect(container.querySelector('input')?.value).toBe('Сохранённое название');
 await React.act(async()=>button('Сохранить личный шаблон').click());
 expect(mocks.selector.resume).toHaveBeenCalledWith('pending');expect(mocks.selector.prepare).not.toHaveBeenCalled();expect(mocks.upload).not.toHaveBeenCalled();expect(mocks.creator.save).toHaveBeenCalledOnce();
});

test('Недоступная библиотека pending останавливает новую операцию и сохраняет квитанцию',async()=>{
 const pending={account:99,id:'lost-answer'};sessionStorage.setItem('mnemos-blueprint-save:bp',JSON.stringify(pending));
 await React.act(async()=>root.render(<BlueprintTemplateSave blueprint={{id:'bp',title:'Отчёт',description:'Форма'}} preferredProject={{accountId:8,projectId:'project'}} onClose={()=>{}}/>));
 expect(container.textContent).toContain('Библиотека начатого сохранения недоступна');expect(container.querySelector('select')?.disabled).toBe(true);expect(button('Сохранить личный шаблон').disabled).toBe(true);
 expect(mocks.selector.prepare).not.toHaveBeenCalled();expect(sessionStorage.getItem('mnemos-blueprint-save:bp')).toBe(JSON.stringify(pending));
 mocks.accounts.mockResolvedValue([{id:99,vendorId:'memory',description:{displayName:'Восстановленная'}}]);mocks.selector.resume.mockResolvedValue(mocks.creator);mocks.creator.state.mockResolvedValue({upload:'upload',project:'project',title:'Прежний шаблон',purpose:'Прежнее назначение',version:null});
 await React.act(async()=>button('Повторить загрузку библиотек').click());
 expect(mocks.selector.resume).toHaveBeenCalledWith('lost-answer');expect(button('Сохранить личный шаблон').disabled).toBe(false);
 await React.act(async()=>button('Сохранить личный шаблон').click());expect(mocks.selector.prepare).not.toHaveBeenCalled();expect(mocks.upload).not.toHaveBeenCalled();expect(mocks.creator.save).toHaveBeenCalledOnce();
});

test('После сохранения точную версию можно передать в задачу только явным действием',async()=>{
 const use=vi.fn<(...args:unknown[])=>void>();
 await React.act(async()=>root.render(<BlueprintTemplateSave nativeOnly blueprint={{id:'editor',title:'ТЗ',description:'Форма'}} format="cloudflareos.document" snapshotSource={{current:async()=>({format:'cloudflareos.document',formatVersion:1,document:{title:'ТЗ',blocks:[]}})}} onUse={use} onClose={()=>{}}/>));
 expect([...container.querySelectorAll('button')].some(item=>item.textContent==='Использовать в задаче')).toBe(false);
 await React.act(async()=>button('Сохранить личный шаблон').click());expect(use).not.toHaveBeenCalled();
 await React.act(async()=>button('Использовать в задаче').click());
 expect(use).toHaveBeenCalledWith({accountId:8,reference:{template_id:'template',revision:1},title:'Отчёт',purpose:'Финансовый отчёт',kind:'document'});expect(mocks.creator.propose).not.toHaveBeenCalled();
});

test.each(['guidance','agent_instructions','skill'] as const)('Документ сохраняется как %s и возвращается в задачу с этим видом',async kind=>{
 const snapshot={format:'cloudflareos.document' as const,formatVersion:1 as const,document:{title:'Материал',blocks:[{id:'step',html:'<p>Проверь критерии приёмки</p>'}]}};
 const onUse=vi.fn<(...args:unknown[])=>void>();
 mocks.creator.save.mockResolvedValue({template_id:'method',revision:1,title:'Материал',purpose:'Порядок работы',project_id:'project',kind});
 await React.act(async()=>root.render(<BlueprintTemplateSave nativeOnly blueprint={{id:'editor',title:'Материал',description:'Порядок работы'}} format="cloudflareos.document" snapshotSource={{current:async()=>snapshot}} onUse={onUse} onClose={()=>{}}/>));
 await React.act(async()=>{const select=container.querySelector<HTMLSelectElement>('[aria-label="Вид шаблона"]')!;select.value=kind;select.dispatchEvent(new Event('change',{bubbles:true}));});
 await React.act(async()=>button('Сохранить личный шаблон').click());
 expect(mocks.selector.prepare).toHaveBeenCalledWith('project','Материал','Порядок работы',undefined,'native-document:editor:'+kind,'cloudflareos.document',kind);
 expect(mocks.nativeUpload.mock.calls[0][0]).toEqual(snapshot);expect(mocks.api.captureBlueprintTemplate).not.toHaveBeenCalled();expect(mocks.creator.propose).not.toHaveBeenCalled();
 await React.act(async()=>button('Использовать в задаче').click());expect(onUse).toHaveBeenCalledWith(expect.objectContaining({kind,reference:{template_id:'method',revision:1}}));
});

test('Редактирование каталога сохраняет ту же личную ссылку с выбранной исходной ревизией',async()=>{
 const context={accountId:8,projectId:'project',reference:{template_id:'existing',revision:3}}
 const material={reference:context.reference,title:'Методика ТЗ',purpose:'Проверка требований',kind:'guidance' as const}
 await React.act(async()=>root.render(<BlueprintTemplateSave nativeOnly initialKind="guidance" initialTemplate={{context,material}} preferredProject={context} blueprint={{id:'new-editor',title:material.title,description:material.purpose}} format="cloudflareos.document" snapshotSource={{current:async()=>({format:'cloudflareos.document',formatVersion:1,document:{title:material.title,blocks:[]}})}} onClose={()=>{}}/>))
 expect(mocks.selector.latest).not.toHaveBeenCalled();expect(container.querySelector<HTMLSelectElement>('[aria-label="Вид шаблона"]')?.disabled).toBe(true)
 await React.act(async()=>button('Сохранить изменения шаблона').click())
 expect(mocks.selector.prepare).toHaveBeenCalledWith('project',material.title,material.purpose,{template_id:'existing',revision:3},'native-template:existing','cloudflareos.document','guidance')
})

test('Улучшение общей версии сохраняет личную копию и требует объяснения для исходной группы',async()=>{
 const reference={scope_id:'finance',template_key:'method',revision:5};const material={reference,title:'Методика',purpose:'Проверять ТЗ',kind:'guidance' as const};
 const snapshot={format:'cloudflareos.document',formatVersion:1,document:{title:'Методика',blocks:[{html:'<p>Проверка</p>'}]}};
 await React.act(async()=>root.render(<BlueprintTemplateSave nativeOnly initialTemplate={{context:{accountId:8,projectId:'project',reference},material}} initialKind="guidance" preferredProject={{accountId:8,projectId:'project'}} blueprint={{id:'editor',title:material.title,description:material.purpose}} format="cloudflareos.document" snapshotSource={{current:async()=>snapshot as never}} onClose={()=>{}}/>));
 expect(mocks.selector.latest).not.toHaveBeenCalled();
 await React.act(async()=>button('Сохранить личный шаблон').click());
 expect(mocks.selector.prepare).toHaveBeenCalledWith('project','Методика','Проверять ТЗ',undefined,'native-improvement:editor:finance:method:5','cloudflareos.document','guidance',reference);
 const send=button('Отправить улучшение на согласование');expect(send.disabled).toBe(true);const scope=container.querySelector<HTMLSelectElement>('select')!;expect(scope.value).toBe('finance');expect(scope.disabled).toBe(true);
 await React.act(async()=>{const textarea=container.querySelector<HTMLTextAreaElement>('[aria-label="Объяснение улучшения"]')!;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(textarea,'Добавить проверяемые критерии');textarea.dispatchEvent(new Event('input',{bubbles:true}))});
 expect(send.disabled).toBe(false);await React.act(async()=>send.click());expect(mocks.creator.propose).toHaveBeenCalledWith('finance',4,'Добавить проверяемые критерии','access-plan');expect(container.textContent).toContain('прежняя сохранится');
});


test('Отправка недоступна до явного доступа согласующих, проверка сама не выдаёт приглашения',async()=>{
 mocks.creator.reviewAccess.mockResolvedValue({key:'access-plan',reviewers:[{id:'reviewer',name:'Мария',canRead:false}]});
 await React.act(async()=>root.render(<BlueprintTemplateSave blueprint={{id:'bp',title:'Отчёт',description:'Форма'}} onClose={()=>{}}/>));
 await React.act(async()=>button('Сохранить личный шаблон').click());
 await React.act(async()=>{const scope=container.querySelector('select')!;scope.value='finance';scope.dispatchEvent(new Event('change',{bubbles:true}));});
 expect(container.textContent).toContain('Мария');expect(button('Предложить для общего применения').disabled).toBe(true);expect(mocks.creator.shareForReview).not.toHaveBeenCalled();expect(mocks.creator.propose).not.toHaveBeenCalled();
 await React.act(async()=>button('Дать согласующим доступ к шаблону').click());expect(mocks.creator.shareForReview).toHaveBeenCalledWith('finance',4,'access-plan');expect(mocks.creator.propose).not.toHaveBeenCalled();expect(button('Предложить для общего применения').disabled).toBe(false);
 await React.act(async()=>button('Предложить для общего применения').click());expect(mocks.creator.propose).toHaveBeenCalledWith('finance',4,undefined,'access-plan');
});
test('Отказ приглашения требует перечитать доступ, не сообщает успех и не запускает предложение',async()=>{
 mocks.creator.reviewAccess.mockResolvedValue({key:'access-plan',reviewers:[{id:'reviewer',name:'Мария',canRead:false}]});mocks.creator.shareForReview.mockRejectedValueOnce(Error('lost reply'));
 await React.act(async()=>root.render(<BlueprintTemplateSave blueprint={{id:'bp',title:'Отчёт',description:'Форма'}} onClose={()=>{}}/>));
 await React.act(async()=>button('Сохранить личный шаблон').click());
 await React.act(async()=>{const scope=container.querySelector('select')!;scope.value='finance';scope.dispatchEvent(new Event('change',{bubbles:true}));});
 await React.act(async()=>button('Дать согласующим доступ к шаблону').click());expect(container.textContent).toContain('Доступ не подтверждён');expect(button('Предложить для общего применения').disabled).toBe(true);expect(mocks.creator.propose).not.toHaveBeenCalled();
 await React.act(async()=>button('Проверить доступ согласующих').click());expect(button('Дать согласующим доступ к шаблону').disabled).toBe(false);
});
