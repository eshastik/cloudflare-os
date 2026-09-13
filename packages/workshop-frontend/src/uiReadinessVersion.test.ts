import { collectorClientVersion } from "./uiReadinessVersion";
// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { startUIReadinessAttempt, isUIReadinessSample, type UIReadinessSample } from '@gadgets/workshop-shared/ui-readiness';
afterEach(()=>{document.head.innerHTML=''});
it('pins the collector build for both start and completion',()=>{
 document.head.innerHTML='<script type="module" src="/assets/index-first.js"></script>';
 const samples:UIReadinessSample[]=[];
 const attempt=startUIReadinessAttempt('cloudflareos.shell',async sample=>{samples.push(sample)},async()=>{},()=>5,undefined,collectorClientVersion());
 document.head.innerHTML='<script type="module" src="/assets/index-second.js"></script>';
 attempt.finish('ready');
 expect(samples.map(s=>s.client_version)).toEqual(['asset:index-first.js','asset:index-first.js']);
 expect(samples.every(isUIReadinessSample)).toBe(true);
 expect(isUIReadinessSample({...samples[0],client_version:'https://private.test/a'})).toBe(false);
});
it('uses the management CSP digest and leaves development builds unknown',()=>{
 const meta=document.createElement('meta');meta.httpEquiv='Content-Security-Policy';meta.content=`script-src 'sha256-${btoa('x'.repeat(32))}'`;document.head.append(meta);
 expect(collectorClientVersion()).toBe('sha256:'+'78'.repeat(32));
 document.head.innerHTML='<script type="module" src="/src/main.tsx"></script>';
 expect(collectorClientVersion()).toBeUndefined();
});
