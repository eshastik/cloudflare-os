import { afterEach, expect, it, vi } from 'vitest'
import type { UIReadinessSample } from '@gadgets/workshop-shared/ui-readiness'
import { createShellReadiness } from './shellReadiness'

afterEach(()=>vi.useRealTimers())
function fixture(path='/gatekeepers') {
  vi.useFakeTimers()
  const samples:UIReadinessSample[]=[]
  let now=250
  const paints:Array<()=>void>=[]
  const tracker=createShellReadiness(async sample=>{samples.push(sample)},()=>now,()=>new Promise(resolve=>paints.push(resolve)))
  const owner={}
  tracker.route(path);tracker.bind(owner)
  const stage=(key:Parameters<typeof tracker.stage>[0],state:'loading'|'ready'|'error'='ready',session=owner)=>tracker.stage(key,state,key==='config'?undefined:session)
  const ready=()=>{for(const key of ['config','identity','features','onboarding','layout','apps','workspaces'] as const)stage(key)}
  const paint=async()=>{now=450;paints.shift()?.();await Promise.resolve()}
  return {tracker,owner,samples,paints,stage,ready,paint}
}
it('includes pre-JS time and waits for navigation data and a paint',async()=>{
  const f=fixture()
  for(const key of ['config','identity','features','onboarding','layout','apps'] as const)f.stage(key)
  expect(f.paints).toHaveLength(0);expect(f.samples.map(s=>s.outcome)).toEqual(['pending'])
  f.stage('workspaces');expect(f.samples).toHaveLength(1)
  await f.paint()
  expect(f.samples.map(s=>s.outcome)).toEqual(['pending','ready'])
  expect(f.samples[1].duration_ms).toBe(450)
  f.ready();f.tracker.route('/workspaces');await f.paint()
  expect(f.samples).toHaveLength(2)
})
it('does not call a fallback successful when a bootstrap dependency failed',async()=>{
  const f=fixture();f.stage('features','error');f.ready();await f.paint()
  expect(f.samples.map(s=>s.outcome)).toEqual(['pending','error'])
})
it('rechecks stages after paint and ignores late results from another session',async()=>{
  const f=fixture();f.ready();const next={}
  // Child effects may report before the parent binds the new session.
  for(const key of ['identity','features','onboarding','layout','apps','workspaces'] as const)f.stage(key,'ready',next)
  f.tracker.bind(next);f.stage('identity','loading',next)
  await f.paint();expect(f.samples).toHaveLength(1)
  f.stage('identity','error',f.owner);expect(f.samples).toHaveLength(1)
  f.stage('identity','ready',next);await f.paint()
  expect(f.samples.map(s=>s.outcome)).toEqual(['pending','ready'])
})
it('does not wait for an absent sidebar in a fullscreen workspace',async()=>{
  const f=fixture('/workspace/fixture')
  for(const key of ['config','identity','features','onboarding','layout'] as const)f.stage(key)
  await f.paint();expect(f.samples.map(s=>s.outcome)).toEqual(['pending','ready'])
})
it('records a missing result as timeout, and navigation interruption wins over delayed paint',async()=>{
  const first=fixture();await vi.advanceTimersByTimeAsync(120000)
  expect(first.samples.map(s=>s.outcome)).toEqual(['pending','timeout'])
  const second=fixture();second.ready();second.tracker.route('/workspaces');await second.paint()
  expect(second.samples.map(s=>s.outcome)).toEqual(['pending','abandoned'])
})
