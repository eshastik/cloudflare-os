// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import type { ConnectedAccountsSubscriber } from '@gadgets/workshop-shared/api'
import { RpcStub, RpcTarget } from 'capnweb'
import NativeDocumentParticipants from './NativeDocumentParticipants'
const { api } = vi.hoisted(() => ({ api: { getGatekeeperApp: vi.fn(), subscribeConnectedAccounts: vi.fn<(s: ConnectedAccountsSubscriber) => Promise<Disposable>>(async s => { s.add(1, { displayName: 'Память', avatar: { url: '' }, providesUi: { title: 'Память' } }, { displayName: 'Память', url: 'https://memory.example' }, [{ urlPattern: 'https://memory.example/drive', description: '', title: '', receives: 'drive' }], true, 'memory'); s.ready(); return { [Symbol.dispose]() {} } }) } }))
vi.mock('./AuthContext', () => ({ useAuthenticatedApi: () => ({ authenticatedApi: api }) }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

it('rereads an uncertain invitation before revoking the actual current mode', async () => {
  const head = 'a'.repeat(64)
  let mode = '', mutations = 0, disposed = 0
  class Writer extends RpcTarget { async head() { return head } }
  class Selector extends RpcTarget {
    async scopes() { return { scopes: [{ id: 'project', name: 'Команда' }] } }
    async documents() { return { documents: [{ id: 'doc', name: 'План' }], nextCursor: '', truncated: false } }
    async select(project: string, node: string, format: string) {
      expect([project, node, format]).toEqual(['project', 'doc', 'cloudflareos.document'])
      return new RpcStub(new Writer())
    }
    async participants(project: string, node: string, expected: string, cursor: string) {
      expect([project, node, expected, cursor]).toEqual(['project', 'doc', head, ''])
      return { head, nextCursor: '', participants: [{ id: 'reviewer', name: 'Мария', mode, canRead: true, canWrite: false }] }
    }
    async setParticipant(project: string, node: string, expectedHead: string, person: string, expected: string, next: string) {
      expect([project, node, expectedHead, person, expected]).toEqual(['project', 'doc', head, 'reviewer', mode])
      mutations++; mode = next
      if (mutations === 1) throw new Error('Response lost after invitation was saved')
    }
    [Symbol.dispose]() { disposed++ }
  }
  class Empty extends RpcTarget {}
  api.getGatekeeperApp.mockImplementation(async () => ({ iframeHtml: '', ui: new RpcStub(new Empty()), nativeWrites: { storageOrigin: 'https://objects.example', selector: new RpcStub(new Selector()) } }))
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  const click = async (text: string) => {
    const button = [...document.querySelectorAll('button')].find(b => b.textContent === text)
    expect(button).toBeDefined(); expect(button!.disabled).toBe(false)
    await act(async () => button!.click())
  }
  const choose = async (label: string, value: string) => {
    const select = document.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement
    expect(select).not.toBeNull()
    await act(async () => { select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })) })
  }
  try {
    await act(async () => root.render(<NativeDocumentParticipants format="cloudflareos.document" />))
    await act(async () => { await vi.waitFor(() => expect(document.querySelector('option[value="project"]')).not.toBeNull()) })
    expect(document.querySelector('select[aria-label="Проект участников"]')).not.toBeNull()
    await choose('Проект участников', 'project'); await choose('Документ участников', 'doc')
    expect((document.querySelector('option[value="write"]') as HTMLOptionElement).disabled).toBe(true)
    await choose('Доступ: Мария', 'read'); await click('Применить')
    expect(mutations).toBe(1); expect(mode).toBe('read')
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Операция не подтверждена')
    expect(document.querySelector('select[aria-label="Доступ: Мария"]')).toBeNull()
    await click('Перечитать участников')
    expect((document.querySelector('select[aria-label="Доступ: Мария"]') as HTMLSelectElement).value).toBe('read')
    await choose('Доступ: Мария', ''); await click('Применить')
    expect(mutations).toBe(2); expect(mode).toBe('')
    expect(document.body.textContent).toContain('Приглашение обновлено')
    await click('Закрыть'); await vi.waitFor(() => expect(disposed).toBe(1))
  } finally { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks() }
})
