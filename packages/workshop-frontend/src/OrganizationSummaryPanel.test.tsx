// @vitest-environment jsdom
import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {expect,it,vi} from 'vitest'
import type {ConnectedAccountsSubscriber} from '@gadgets/workshop-shared/api'
import type {OrganizationMetrics} from '@gadgets/workshop-shared/organization-metrics'
import OrganizationSummaryPanel from './OrganizationSummaryPanel'
import {summarizeOrganizations} from './organizationSummary'
const api=vi.hoisted(()=>({getGatekeeperApp:vi.fn(),subscribeConnectedAccounts:vi.fn()}))
vi.mock('./AuthContext',()=>({useAuthenticatedApi:()=>({authenticatedApi:api})}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true
function metric(tenantId:string,completedProjects:number,origin='https://memory.example'):OrganizationMetrics{return {origin,tenantId,name:tenantId,observedAt:'2026-09-12T12:00:00Z',periods:([1,7,30] as const).map(days=>({days,completedProjects,hasCompletedWork:completedProjects>0}))}}
it('deduplicates within installation, preserves same tenant ID in another installation and chooses newest observation',()=>{
 const current=metric('one',3),old={...metric('one',0),observedAt:'2026-09-11T12:00:00Z'}
 const summary=summarizeOrganizations([current,old,metric('one',1,'https://second.example'),metric('two',0)])
 expect(summary.organizations).toHaveLength(3);expect(summary.duplicateConnections).toBe(1)
 expect(summary.periods.map(p=>p.completedOrganizations)).toEqual([2,2,2])
 expect(summary.organizations[0].periods[0].completedProjects).toBe(3)
 expect(()=>summarizeOrganizations([{...current,periods:[...current.periods].reverse()}])).toThrow()
})
it('reads own accounts separately, reports partial data, clears revoked results and disposes every capability',async()=>{
 let revoked=false
 const dispose=vi.fn(),subscriptionDisposed=vi.fn()
 api.subscribeConnectedAccounts.mockImplementation(async(s:ConnectedAccountsSubscriber)=>{
  for(let id=1;id<=4;id++)s.add(id,{displayName:`Account ${id}`,avatar:{url:''},providesUi:{title:'Память'}},{displayName:'Память',url:'https://memory.example'},[],true,'memory')
  s.ready();return {[Symbol.dispose]:subscriptionDisposed}
 })
 api.getGatekeeperApp.mockImplementation(async(vendor:string,id:number)=>{
  expect(vendor).toBe('memory');expect([1,2,3,4]).toContain(id)
  return {iframeHtml:'',ui:{[Symbol.dispose]:dispose},organizationMetrics:{[Symbol.dispose]:dispose,async read(){if(revoked||id===4)throw Error('403');return metric(id<=2?'one':'two',id<=2?3:0)}}}
 })
 const container=document.createElement('div'),root=createRoot(container)
 const refresh=async()=>{await act(async()=>{container.querySelector('button')!.click()})}
 try{
  await act(async()=>root.render(<OrganizationSummaryPanel appId="memory"/>));await refresh()
  expect(container.textContent).toContain('Прочитано организаций: 2; повторных подключений: 1.')
  expect(container.textContent).toContain('организаций с завершённой работой — 1')
  expect(container.textContent).toContain('Свод неполный. Недоступны подключения: Account 4')
  expect(dispose).toHaveBeenCalledTimes(8)
  revoked=true;await refresh()
  expect(container.textContent).not.toContain('организаций с завершённой работой — 1')
  expect(container.textContent).toContain('число завершивших работу неизвестно')
  expect(dispose).toHaveBeenCalledTimes(16)
 }finally{await act(async()=>root.unmount())}
 expect(subscriptionDisposed).toHaveBeenCalledOnce()
})
