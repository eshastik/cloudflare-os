// @vitest-environment jsdom
import React from 'react'
import {createRoot} from 'react-dom/client'
import {beforeEach,afterEach,test,expect,vi} from 'vitest'
const {webcrypto}=await vi.importActual<{webcrypto:Crypto}>('node:crypto')
import WorkTemplatePreview from './WorkTemplatePreview'
const mocks=vi.hoisted(()=>({api:{},preview:vi.fn<(...args:unknown[])=>Promise<unknown>>(),validate:vi.fn<(...args:unknown[])=>Promise<void>>(),dispose:vi.fn<()=>void>(),open:vi.fn<(...args:unknown[])=>Promise<unknown>>()}))
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
 mocks.preview.mockResolvedValue({material:{reference:item.reference,title:item.title,purpose:item.purpose,kind:item.kind},sourceHead:'a'.repeat(64),ticket:{url:'https://objects.example/form',method:'GET',size_bytes:bytes.length,sha256_hex:sha,content_type:mime}});
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
