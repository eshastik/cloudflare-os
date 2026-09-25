import {test} from 'node:test';import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {KNOWN_SIGNALS,validPlatformSignals} from './platform-signals.ts';
import {validSignalOwners} from './platform-signal-owners.ts';
import {validSignalInbox} from './platform-signal-inbox.ts';
const core=()=>['dependencies','external.readiness','external.login','external.read','external.save'].map(key=>({key,state:'unknown',reason:key==='dependencies'?'check_unavailable':'observations_missing',observed_at:null as string|null} as Record<string,unknown>));
test('signal snapshots cannot report missing or failed evidence as healthy',()=>{
 const rows=core();
 assert.equal(validPlatformSignals(rows),true);
 assert.equal(validPlatformSignals(rows.slice(1)),false);
 for(const patch of [{state:'ok'},{state:'ok',reason:'check_passed'},{key:'dependencies'},{reason:'check_failed'}]){
  const bad=structuredClone(rows);Object.assign(bad[3]!,patch);assert.equal(validPlatformSignals(bad),false);
 }
 rows[3]={key:'external.read',state:'firing',reason:'check_failed',observed_at:'2026-09-12T00:00:00Z'};assert.equal(validPlatformSignals(rows),true);
});
test('шестой сигнал — застрявшая индексация — принимается со своей причиной и числом заданий',()=>{
 const rows=[...core(),{key:'shared_projection',state:'firing',reason:'jobs_stalled',observed_at:'2026-09-25T10:00:00Z',count:3}];
 assert.equal(validPlatformSignals(rows),true);
 const wrong=structuredClone(rows);Object.assign(wrong[5]!,{reason:'check_failed'});
 assert.equal(validPlatformSignals(wrong),false,'сбой проекции называет свою причину');
 const negative=structuredClone(rows);Object.assign(negative[5]!,{count:-1});
 assert.equal(validPlatformSignals(negative),false);
});
test('незнакомый сигнал сервера не роняет страницу, а знакомый не может врать',()=>{
 const rows=[...core(),{key:'future.check',state:'firing',reason:'something_new',observed_at:'2026-09-25T10:00:00Z'}];
 assert.equal(validPlatformSignals(rows),true,'новая проверка — общей строкой');
 const known=[...core()];known[1]={key:'external.readiness',state:'unknown',reason:'brand_new_reason',observed_at:null};
 assert.equal(validPlatformSignals(known),true,'новая причина знакомой проверки — терпится');
 const lying=[...core(),{key:'future.check',state:'ok',reason:'check_passed',observed_at:null}];
 assert.equal(validPlatformSignals(lying),false,'«в порядке» без наблюдения — ложь и у новой проверки');
 const owners=['dependencies','external.readiness','external.login','external.read','external.save','shared_projection','future.check'].map(k=>({signal_key:k,owner_id:'',owner_name:'',owner_active:false,revision:0}));
 assert.equal(validSignalOwners(owners),true);
 assert.equal(validSignalOwners([...owners,owners[6]]),false,'ключ не повторяется');
 const inbox={items:[{id:'2',key:'shared_projection',state:'firing',reason:'jobs_stalled',observed_at:null,created_at:'2026-09-25T10:00:00Z',read_at:null},{id:'1',key:'future.check',state:'unknown',reason:'new',observed_at:null,created_at:'2026-09-25T09:00:00Z',read_at:null}],unread:2,next_before:''};
 assert.equal(validSignalInbox(inbox),true);
});

// Серверный перечень — рядом с форком (../../../mnemos от пакета) или по MNEMOS_REPO. Сверяются множества.
const PACKAGE=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const SERVER_LIST=join(process.env.MNEMOS_REPO?resolve(process.env.MNEMOS_REPO):resolve(PACKAGE,'../../../mnemos'),'services/storage-api/internal/httpapi/testdata/platform_signals.txt');
test('словарь сигналов форка совпадает с серверным перечнем',t=>{
 if(!existsSync(SERVER_LIST)){t.skip(`пропущено: нет серверного перечня (${SERVER_LIST})`);return;}
 const server=readFileSync(SERVER_LIST,'utf8').split('\n').map(l=>l.trim()).filter(l=>l&&!l.startsWith('#')).sort();
 assert.deepEqual([...KNOWN_SIGNALS].sort(),server,'словарь сигналов разошёлся с сервером');
 assert.equal(new Set(KNOWN_SIGNALS).size,KNOWN_SIGNALS.length);
});
