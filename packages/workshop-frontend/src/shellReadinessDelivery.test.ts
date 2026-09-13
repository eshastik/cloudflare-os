// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import type { AuthenticatedApi } from '@gadgets/workshop-shared/api'
let stop:(()=>void)|undefined
afterEach(()=>{stop?.();vi.useRealTimers()})
async function setup() {
  vi.resetModules();vi.useFakeTimers()
  const module=await import('./shellReadiness')
  module.initializeShellReadiness();stop=module.skipShellReadiness
  return module
}
function deferred<T>() { let resolve!:(value:T)=>void;const promise=new Promise<T>(yes=>resolve=yes);return {promise,resolve} }
function api(config:Promise<Awaited<ReturnType<AuthenticatedApi['getWorkspaceActivityReporting']>>>) {
  return {getWorkspaceActivityReporting:vi.fn(()=>config),recordOwnUIReadiness:vi.fn<AuthenticatedApi['recordOwnUIReadiness']>(async()=>{})}
}
const selected=(id:number|null)=>({selectedAccountId:id,accounts:[],delivery:'pending' as const})
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve()}
it('buffers only bounded samples and discards a superseded recipient lookup',async()=>{
  const m=await setup(),old=deferred<ReturnType<typeof selected>>(),next=deferred<ReturnType<typeof selected>>()
  const first=api(old.promise),second=api(next.promise)
  m.bindShellReadiness(first);m.bindShellReadiness(second);m.failShellReadiness()
  old.resolve(selected(1));await flush();expect(first.recordOwnUIReadiness).not.toHaveBeenCalled()
  next.resolve(selected(2));await flush()
  expect(second.recordOwnUIReadiness.mock.calls).toHaveLength(2)
  const calls=second.recordOwnUIReadiness.mock.calls
  expect(calls.map(call=>call[1])).toEqual([2,2])
  expect(calls.map(call=>call[0].outcome)).toEqual(['pending','error'])
  const third=api(Promise.resolve(selected(3)));m.bindShellReadiness(third);await flush()
  expect(third.recordOwnUIReadiness).not.toHaveBeenCalled()
})
it('pins the first selected account and interrupts a load on session change',async()=>{
  const m=await setup(),first=api(Promise.resolve(selected(2))),second=api(Promise.resolve(selected(3)))
  m.bindShellReadiness(first);await flush()
  m.bindShellReadiness(second);await flush()
  const calls=first.recordOwnUIReadiness.mock.calls
  expect(calls.map(call=>call[0].outcome)).toEqual(['pending','abandoned'])
  expect(second.getWorkspaceActivityReporting).not.toHaveBeenCalled()
  expect(second.recordOwnUIReadiness).not.toHaveBeenCalled()
})
it('does not send interactive-login timings or deliver when reporting is disabled',async()=>{
  const m=await setup(),config=deferred<ReturnType<typeof selected>>(),first=api(config.promise)
  m.bindShellReadiness(first);m.skipShellReadiness();config.resolve(selected(2));await flush()
  expect(first.recordOwnUIReadiness).not.toHaveBeenCalled()
  const n=await setup(),disabled=api(Promise.resolve(selected(null)))
  n.bindShellReadiness(disabled);await flush();n.failShellReadiness();await flush()
  expect(disabled.recordOwnUIReadiness).not.toHaveBeenCalled()
})
