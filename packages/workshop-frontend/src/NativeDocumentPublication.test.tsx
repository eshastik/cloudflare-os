// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import type { ConnectedAccountsSubscriber } from '@gadgets/workshop-shared/api'
import { RpcStub, RpcTarget } from 'capnweb'
import NativeDocumentPublication from './NativeDocumentPublication'
import { countPublicationNodes, type PublicationReview } from '@gadgets/workshop-shared/publication-review'
const { api } = vi.hoisted(() => ({ api: { getGatekeeperApp: vi.fn<() => Promise<unknown>>(), subscribeConnectedAccounts: vi.fn<(s: ConnectedAccountsSubscriber) => Promise<Disposable>>(async s => { s.add(1, { displayName: 'Память', avatar: { url: '' }, providesUi: { title: 'Память' } }, { displayName: 'Память', url: 'https://memory.example' }, [{ urlPattern: 'https://memory.example/drive', description: '', title: '', receives: 'drive' }], true, 'memory'); s.ready(); return { [Symbol.dispose]() {} } }) } }))
vi.mock('./AuthContext', () => ({ useAuthenticatedApi: () => ({ authenticatedApi: api }) }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

it('requires current approvals, recovers a saved proposal and hides uncertain publication actions', async () => {
  sessionStorage.clear()
  let head = 'a'.repeat(64), ready = false, publishes = 0, requests = 0
  const submitted = head, shared = 'b'.repeat(64)
  class Selector extends RpcTarget {
    async scopes() { return { scopes: [{ id: 'project', name: 'Команда' }] } }
    async publicationState() { return { personal_head: head, shared_head: shared, personal_exists: true } }
    async requestReview(project: string, personal: string, main: string) {
      expect([project, personal, main]).toEqual(['project', head, shared]); requests++
      return { candidate_id: 'proposal' }
    }
    async review(id: string) {
      expect(id).toBe('proposal')
      return { candidate_id: id, project_id: 'project', author_id: 'owner', personal_head: submitted,
        shared_head: shared, decision_version: 1, ready, stale: false, application_node_ids: ['app'], domains: [{domain_id: 'Команда', node_ids: ['doc', 'app'], approvers: [], decisions: []}] }
    }
    async publishReview(project: string, id: string) {
      expect([project, id]).toEqual(['project', 'proposal']); publishes++
      throw new Error('Lost response')
    }
  }
  class Empty extends RpcTarget {}
  api.getGatekeeperApp.mockImplementation(async () => ({ iframeHtml: '', ui: new RpcStub(new Empty()), nativeWrites: { storageOrigin: 'https://objects.example', selector: new RpcStub(new Selector()) } }))
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  const button = (text: string) => [...document.querySelectorAll('button')].find(b => b.textContent === text)!
  const click = async (text: string) => { expect(button(text).disabled).toBe(false); await act(async () => button(text).click()) }
  const choose = async () => {
    await act(async () => { await vi.waitFor(() => expect(document.querySelector('option[value="project"]')).not.toBeNull()) })
    const select = document.querySelector('select')!
    await act(async () => { select.value = 'project'; select.dispatchEvent(new Event('change', { bubbles: true })) })
  }
  const publish = 'Опубликовать согласованные изменения проекта'
  try {
    let generation = 0
    const reopen = async () => { await act(async () => root.render(React.createElement(NativeDocumentPublication, {key: generation++}))) }
    await reopen(); await choose()
    expect(button(publish).disabled).toBe(true)
    await click('Отправить изменения проекта на согласование')
    expect(container.textContent).toContain('документов 1')
    expect(container.textContent).toContain('Приложений: 1.')
    expect(requests).toBe(1); expect(button(publish).disabled).toBe(true)
    await click('Закрыть'); expect(document.querySelector('select')).toBeNull(); ready = true
    await reopen(); await choose()
    expect(requests).toBe(1); expect(button(publish).disabled).toBe(false)
    head = 'c'.repeat(64); await click('Перечитать состояние')
    expect(document.body.textContent).toContain('Согласование устарело'); expect(button(publish).disabled).toBe(true)
    head = submitted; await click('Перечитать состояние'); await click(publish)
    expect(publishes).toBe(1); expect(button(publish).disabled).toBe(true)
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Результат не подтверждён')
    await click('Подготовить новое согласование')
    expect(button('Отправить изменения проекта на согласование').disabled).toBe(false)
    expect(button(publish).disabled).toBe(true)
  } finally { await act(async () => root.unmount()); container.remove(); sessionStorage.clear(); vi.restoreAllMocks() }
})

it('counts applications separately and deduplicates nodes reviewed by several domains', () => {
  const review: PublicationReview = { candidate_id: 'proposal', project_id: 'project', author_id: 'owner', personal_head: 'a'.repeat(64), shared_head: 'b'.repeat(64), decision_version: 1, ready: true, stale: false,
    application_node_ids: ['app', 'deleted-app'], domains: [
      { domain_id: 'engineering', node_ids: ['doc', 'app', 'deleted-app'], approvers: [], decisions: [] },
      { domain_id: 'legal', node_ids: ['doc', 'app'], approvers: [], decisions: [] },
    ] }
  expect(countPublicationNodes(review)).toEqual({ documents: 1, applications: 2 })
  expect(countPublicationNodes(review, review.domains[1]!.node_ids)).toEqual({ documents: 1, applications: 1 })
  expect(countPublicationNodes({ ...review, application_node_ids: [] })).toEqual({ documents: 3, applications: 0 })
  expect(countPublicationNodes({ ...review, application_node_ids: null })).toBeNull()
  expect(countPublicationNodes({ ...review, application_node_ids: undefined })).toBeNull()
})
