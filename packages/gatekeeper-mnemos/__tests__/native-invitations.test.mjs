import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { fileURLToPath } from 'node:url';

test('invited draft is discoverable; explicit save adopts once and requires reread after partial failure', async () => {
  const source = 'a'.repeat(64), initial = 'b'.repeat(64), adopted = 'c'.repeat(64), saved = 'd'.repeat(64);
  let head = initial, adoptions = 0, saves = 0;
  const mime = 'application/vnd.cloudflareos.document+json';
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
      if(url.pathname==='/v1/whoami')return Response.json({subject:{tenant_id:'org',user_id:'peer'}});
      if(url.pathname.endsWith('/draft/documents'))return Response.json({documents:[],head,next_cursor:''});
      if(url.pathname.endsWith('/draft/invitations'))return Response.json({documents:[{node_id:'doc',name:'Invited.cfdoc',content_type:mime,owner_id:'owner',head:source}],next_cursor:''});
      if(url.pathname.endsWith('/draft/open'))return Response.json({head});
      if(url.pathname.endsWith('/draft/state'))return Response.json({personal_head:head,shared_head:initial,personal_exists:true});
      if(url.pathname.endsWith('/access'))return Response.json({node_id:'doc',head:source});
      if(url.pathname.endsWith('/draft/nodes/doc'))return adoptions ? Response.json({node_id:'doc',head,exists:true,conflicted:false,content_type:mime,terms:[]}) : new Response(null,{status:404});
      if(url.pathname.endsWith('/adopt')){
        assert.deepEqual(await request.json(),{expected_head:initial,source_head:source});
        adoptions++;head=adopted;return Response.json({head});
      }
      if(url.pathname.endsWith('/draft/save')){
        const body=await request.json();assert.equal(body.expected_head,adopted);
        saves++;
        if(saves===1)return new Response(null,{status:503});
        head=saved;return Response.json({head});
      }
      throw new Error('Unexpected request '+url.pathname);
    },
  },{
    name:'driver',modules:true,compatibilityDate:'2026-02-02',compatibilityFlags:['allow_irrevocable_stub_storage', 'nodejs_compat'],
    durableObjects:{ACCOUNTS:{className:'UserAccount',scriptName:'mnemos',useSQLite:true}},
    script:`export default {async fetch(request,env){
      const account=env.ACCOUNTS.getByName('fixture');await account.acceptVerifiedCredential('fixture');
      const frame=await account.startAppUi(),selector=frame.nativeWrites.selector;
      const page=await selector.documents('project','');
      const writer=await selector.select('project','doc','cloudflareos.document');
      const before=await writer.head();
      let failed=false,stale=false,revoked=false;
      try{await writer.save(before,'upload');}catch{failed=true;}
      try{await writer.save(before,'upload');}catch{stale=true;}
      const reread=await writer.head();
      const result=await writer.save(reread,'upload');
      await account.revoke();
      try{await writer.head();}catch{revoked=true;}
      writer[Symbol.dispose]();selector[Symbol.dispose]();
      return Response.json({page,before,reread,result,failed,stale,revoked});
    }};`,
  }]});
  try{
    const response=await(await mf.getWorker('driver')).fetch('https://driver.example');
    assert.equal(response.status,200);
    const out=await response.json();
    assert.equal(out.page.documents[0].name,'Invited.cfdoc');
    assert.equal(out.page.nextCursor,'s:');
    assert.equal(out.before,initial);assert.equal(out.reread,adopted);assert.equal(out.result,saved);
    assert.ok(out.failed&&out.stale&&out.revoked);
    assert.equal(adoptions,1);assert.equal(saves,2);
  }finally{await mf.dispose();}
});
