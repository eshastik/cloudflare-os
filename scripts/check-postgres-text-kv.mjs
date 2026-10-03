import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Запускается только с подготовленной временной БД и непривилегированной ролью.
const root = process.argv[4] ? resolve(process.argv[4]) : resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(resolve(root, "package.json"));
const { Miniflare } = require(require.resolve("miniflare", { paths: [require.resolve("wrangler")] }));
const dsnFile = process.argv[2];
if (!dsnFile || (await stat(dsnFile)).mode & 0o077) throw new Error("Нужен закрытый файл подключения тестовой БД");
const dsn = (await readFile(dsnFile, "utf8")).trim();
const parsed = new URL(dsn);
if (!parsed.pathname.startsWith("/mnemos_probe_") || !parsed.username.startsWith("mnemos_probe_")) {
  throw new Error("Проверка разрешена только в отдельной тестовой БД под тестовой ролью");
}

let script;
if (process.argv[3]) {
  script = await readFile(process.argv[3], "utf8");
} else {
  const { build } = require(require.resolve("esbuild", { paths: [resolve(root, "packages/workshop-backend")] }));
  const result = await build({
    stdin: { contents: `
      import { PostgresTextKv } from './packages/backend-utils/src/postgres-text-kv.ts';
      import { PostgresActorKv } from './packages/backend-utils/src/postgres-actor-kv.ts';
      export default {async fetch(req,env){
        try {
          const b=await req.json();
          if(b.actor){
            const kv=new PostgresActorKv(env.DB.connectionString,b.tenant,b.actorType,b.actorId);
            if(b.op==='put'){await kv.put(b.key,b.value);return Response.json({ok:true})}
            if(b.op==='bad-json'){await kv.put(b.key,new Date());return Response.json({ok:true})}
            if(b.op==='delete')return Response.json({deleted:await kv.delete(b.key)});
            if(b.op==='list')return Response.json({entries:await kv.list({prefix:b.prefix})});
            if(b.op==='alarm-get')return Response.json({alarm:await kv.getAlarm()});
            if(b.op==='alarm-set'){await kv.setAlarm(b.at);return Response.json({ok:true})}
            if(b.op==='claim')return Response.json({claimed:await kv.claimOwner(b.owner)});
            if(b.op==='release'){await kv.releaseOwner(b.owner);return Response.json({ok:true})}
            return Response.json({value:await kv.get(b.key)});
          }
          const kv=new PostgresTextKv(env.DB.connectionString,b.tenant,b.namespace);
          if(b.op==='put'){await kv.put(b.key,b.value);return Response.json({ok:true})}
          if(b.op==='delete'){await kv.delete(b.key);return Response.json({ok:true})}
          return Response.json({value:await kv.get(b.key)});
        } catch(error) {return Response.json({error:error.name})}
      }};`, resolveDir: root, sourcefile: "postgres-kv-probe.ts" },
    bundle: true, platform: "node", format: "esm", conditions: ["workerd", "worker", "browser"],
    external: ["pg-native"],
    banner: { js: "import { createRequire } from 'node:module';const require = createRequire('/worker.js');" },
    write: false,
  });
  script = result.outputFiles[0].text;
}

const create = () => new Miniflare({
  modules: true, script, compatibilityDate: "2026-02-02",
  compatibilityFlags: ["nodejs_compat", "global_fetch_strictly_public"],
  hyperdrives: { DB: dsn }, host: "127.0.0.1", port: 0,
});
let worker = create();
let checks = 0;
const call = async body => {
  const response = await worker.dispatchFetch("http://probe", { method: "POST", body: JSON.stringify(body) });
  assert.equal(response.status, 200);
  return response.json();
};
try {
  const a = { tenant: "test-a", namespace: "context-collections", key: "dev\0.public" };
  const b = { ...a, tenant: "test-b" };
  const value = "Русский текст\0🙂";
  assert.deepEqual(await call({ ...a, op: "put", value }), { ok: true });
  assert.equal((await call({ ...a, op: "get" })).value, value);
  checks++;
  assert.equal((await call({ ...b, op: "get" })).value, null);
  await call({ ...b, op: "put", value: "other" });
  assert.equal((await call({ ...a, op: "get" })).value, value);
  checks++;
  const namespace = { ...a, namespace: "blueprints" };
  assert.equal((await call({ ...namespace, op: "get" })).value, null);
  await call({ ...namespace, op: "put", value: "blueprint" });
  assert.equal((await call({ ...a, op: "get" })).value, value);
  checks++;
  await worker.dispose();
  worker = create();
  assert.equal((await call({ ...a, op: "get" })).value, value);
  checks++;
  await call({ ...b, op: "delete" });
  assert.equal((await call({ ...b, op: "get" })).value, null);
  assert.equal((await call({ ...a, op: "get" })).value, value);
  checks++;
  // Подготовленная БД разрывает ТОЛЬКО собственное соединение записи этого ключа.
  assert.deepEqual(await call({ ...a, key: "terminate", op: "put", value: "failure" }), { error: "error" });
  assert.deepEqual(await call({ ...a, key: "after-failure", op: "put", value: "healthy" }), { ok: true });
  assert.equal((await call({ ...a, key: "after-failure", op: "get" })).value, "healthy");
  checks++;
  const actor = {actor:true, tenant:"test-a", actorType:"telegram-bot", actorId:"a".repeat(64), key:"screen:токен\0"};
  const state = {owner:"Иван", screen:{used:false, expiresAt:12345}, token:"sealed", items:[null,1,true,"\0🙂"]};
  assert.deepEqual(await call({...actor, op:"put", value:state}), {ok:true});
  assert.deepEqual((await call({...actor, op:"get"})).value, state);
  checks++;
  for(const other of [{...actor,tenant:"test-b"},{...actor,actorId:"b".repeat(64)},{...actor,actorType:"telegram-claim"}]) {
    assert.deepEqual(await call({...other,op:"get"}), {});
  }
  checks++;
  await worker.dispose();
  worker=create();
  assert.deepEqual((await call({...actor,op:"get"})).value,state);
  checks++;
  await call({...actor,key:"screen:%_",op:"put",value:1});
  assert.deepEqual((await call({...actor,op:"list",prefix:"screen:%"})).entries, [["screen:%_",1]]);
  assert.deepEqual(await call({...actor,key:"screen:%_",op:"delete"}), {deleted:true});
  assert.deepEqual(await call({...actor,key:"screen:%_",op:"delete"}), {deleted:false});
  checks++;
  const claim = {...actor,actorType:"telegram-claim",actorId:"c".repeat(64)};
  const contenders=["alice","bob"];
  const results=await Promise.all(contenders.map(owner=>call({...claim,op:"claim",owner})));
  assert.equal(results.filter(r=>r.claimed).length,1);
  const winner=contenders[results.findIndex(r=>r.claimed)], loser=contenders.find(owner=>owner!==winner);
  assert.deepEqual(await call({...claim,op:"claim",owner:winner}), {claimed:true});
  await call({...claim,op:"release",owner:loser});
  assert.deepEqual(await call({...claim,op:"claim",owner:loser}), {claimed:false});
  await call({...claim,op:"release",owner:winner});
  assert.deepEqual(await call({...claim,op:"claim",owner:loser}), {claimed:true});
  checks++;
  assert.deepEqual(await call({...actor,op:"bad-json"}), {error:"Error"});
  assert.deepEqual((await call({...actor,op:"get"})).value,state);
  checks++;
  assert.deepEqual(await call({...actor,op:"alarm-get"}), {alarm:null});
  assert.deepEqual(await call({...actor,op:"alarm-set",at:1234567890}), {ok:true});
  await worker.dispose();
  worker=create();
  assert.deepEqual(await call({...actor,op:"alarm-get"}), {alarm:1234567890});
  assert.deepEqual(await call({...actor,tenant:"test-b",op:"alarm-get"}), {alarm:null});
  assert.deepEqual(await call({...actor,op:"alarm-set",at:-1}), {error:"Error"});
  assert.deepEqual(await call({...actor,op:"alarm-get"}), {alarm:1234567890});
  assert.deepEqual(await call({...actor,op:"alarm-set",at:null}), {ok:true});
  assert.deepEqual(await call({...actor,op:"alarm-get"}), {alarm:null});
  checks++;
  console.log(JSON.stringify({ checks, pass: true, sqlitePersistence: false }));
} finally {
  await worker.dispose();
}
