import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { fileURLToPath } from 'node:url';

// Документ коллеги по приглашению с правом правки: открывается и сохраняется в ветку владельца,
// а своя ветка и опубликованная история приглашённого не читаются — их чтение заведомо отказывает (403).
test('invited document: select, access, shared save and history never probe the invitee branch or published history', async () => {
  const mime = 'application/vnd.cloudflareos.document+json';
  let head = 'a'.repeat(64);
  const saved = 'd'.repeat(64);
  const probes = [], saves = [];
  const mf = new Miniflare({ workers: [{
    name: 'mnemos', modules: true, modulesRules: [{type:'Text',include:['**/*.txt']}],
    scriptPath: fileURLToPath(new URL('../dist/mnemos.js',import.meta.url)),
    compatibilityDate:'2026-02-02',compatibilityFlags:['allow_irrevocable_stub_storage', 'nodejs_compat'],
    bindings:{MNEMOS_API_ORIGIN:'https://memory.example',MNEMOS_STORAGE_ORIGIN:'https://objects.example'},
    durableObjects:{ACCOUNTS:{className:'UserAccount',useSQLite:true}},
    outboundService: async request => {
      const url=new URL(request.url);
      assert.equal(url.origin,'https://memory.example');
      assert.equal(request.headers.get('Authorization'),'Bearer fixture');
      const path=url.pathname;
      if(path==='/v1/whoami')return Response.json({subject:{tenant_id:'org',user_id:'admin'}});
      if(path==='/v1/me/shared-documents')return Response.json({documents:[{project_id:'project',node_id:'doc',owner_id:'owner',name:'Дорожная карта',project_name:'Перевод',owner_name:'Николай Деревцов',granted_by_name:'Николай Деревцов',content_type:mime,head,mode:'write',granted_at:'2026-09-24T10:00:00Z',seen:false}]});
      if(path==='/v1/me/shared-documents/seen')return Response.json({seen:true});
      if(path.endsWith('/draft/documents'))return Response.json({documents:[],head:'b'.repeat(64),next_cursor:''});
      if(path.endsWith('/draft/invitations'))return Response.json({documents:[{node_id:'doc',name:'Дорожная карта',content_type:mime,owner_id:'owner',head}],next_cursor:''});
      if(path.endsWith('/private-versions/'+head+'/access'))return Response.json({node_id:'doc',head});
      if(path.endsWith('/nodes/doc/private-versions'))return Response.json({versions:[{head,content_type:mime,recorded_at:'2026-09-24T10:00:00Z',author_name:'Николай Деревцов'}],next_cursor:''});
      if(path.endsWith('/draft/nodes/doc/shared-save')){
        const body=await request.json();saves.push(body);
        if(body.base_head!==head)return Response.json({code:'document.changed'},{status:409});
        head=saved;return Response.json({head});
      }
      // Своя ветка приглашённого, открытие своего черновика и опубликованная история.
      if(path.endsWith('/draft/nodes/doc')||path.endsWith('/draft/open')||path.includes('/nodes/doc/history')){probes.push(request.method+' '+path);return Response.json({code:'authz.access_denied'},{status:403});}
      throw new Error('Unexpected request '+request.method+' '+path);
    },
  },{
    name:'driver',modules:true,compatibilityDate:'2026-02-02',compatibilityFlags:['allow_irrevocable_stub_storage', 'nodejs_compat'],
    durableObjects:{ACCOUNTS:{className:'UserAccount',scriptName:'mnemos',useSQLite:true}},
    script:`export default {async fetch(request,env){
      const account=env.ACCOUNTS.getByName('fixture');await account.acceptVerifiedCredential('fixture');
      const frame=await account.startAppUi(),selector=frame.nativeWrites.selector,downloads=frame.nativeDownloads.selector;
      const page=await selector.documents('project','');
      const writer=await selector.select('project','doc','cloudflareos.document');
      const before=await writer.head(),access=await writer.access();
      let stale=false,revoked=false;
      try{await writer.save('c'.repeat(64),'upload');}catch(error){stale=String(error.message).includes('DOCUMENT_CHANGED');}
      const result=await writer.save(before,'upload');
      const history=await downloads.publications('project','doc','');
      await account.revoke();
      try{await writer.head();}catch{revoked=true;}
      writer[Symbol.dispose]();selector[Symbol.dispose]();downloads[Symbol.dispose]();
      return Response.json({page,before,access,result,stale,revoked,history});
    }};`,
  }]});
  try{
    const response=await(await mf.getWorker('driver')).fetch('https://driver.example');
    const out=await response.json();
    assert.equal(response.status,200,JSON.stringify(out));
    assert.deepEqual(out.page.documents,[{id:'doc',name:'Дорожная карта'}]);
    assert.equal(out.before,'a'.repeat(64));
    assert.equal(out.access,'write');
    assert.ok(out.stale,'save from a stale version is refused explicitly');
    assert.equal(out.result,saved);
    assert.deepEqual(saves.map(s=>[s.owner_id,s.base_head,s.upload_id]),[['owner','c'.repeat(64),'upload'],['owner','a'.repeat(64),'upload']]);
    // История — версии ветки владельца; опубликованной истории приглашённому не спрашивают.
    assert.deepEqual(out.history.publications.map(p=>[p.id,p.author??'']),[['private:'+saved,'Николай Деревцов']]);
    assert.equal(out.history.nextCursor,'');
    assert.ok(out.revoked);
    assert.deepEqual(probes,[]);
  }finally{await mf.dispose();}
});
