// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { RpcStub, RpcTarget } from 'capnweb'
import { expect, it, vi } from 'vitest'
import AgentConsentPanel from './AgentConsentPanel'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

for (const host of ['127.0.0.1', 'localhost']) for (const approved of [true, false]) it(`returns to ${host}, requires an explicit ${approved ? 'approval' : 'denial'} and returns only the server callback`, async () => {
  class Consent extends RpcTarget {
    previewCall = vi.fn(async (_request: string) => ({ selection: 'selection', account: 'org / alice', client_id: 'local-client', resource: 'https://memory.example/mcp', scopes: ['memory'], expires_at: '2099-01-01T00:00:00Z' }))
    decideCall = vi.fn(async (_selection: string, _approved: boolean) => ({ redirect_uri: `http://${host}:4321/callback?state=saved&${approved ? 'code=issued' : 'error=access_denied'}` }))
    async preview(request: string) { return this.previewCall(request) }
    async decide(selection: string, approved: boolean) { return this.decideCall(selection, approved) }
  }
  const target = new Consent(), capability = new RpcStub(target)
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => root.render(<AgentConsentPanel request={'a'.repeat(43)} capability={capability} />))
    expect(target.previewCall).toHaveBeenCalledWith('a'.repeat(43))
    expect(target.decideCall).not.toHaveBeenCalled()
    expect(container.textContent).toContain('org / alice')
    expect(container.textContent).toContain('local-client')
    const button = [...container.querySelectorAll('button')].find(b => b.textContent === (approved ? 'Подключить агента' : 'Отклонить'))!
    await act(async () => { button.click(); button.click() })
    expect(target.decideCall).toHaveBeenCalledExactlyOnceWith('selection', approved)
    const link = container.querySelector('a')!
    expect(new URL(link.href).searchParams.get('state')).toBe('saved')
    expect(new URL(link.href).searchParams.has('code')).toBe(approved)
    expect(link.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(container.querySelectorAll('button')).toHaveLength(0)
  } finally {
    await act(async () => root.unmount()); capability[Symbol.dispose](); container.remove()
  }
})

it('does not retry an uncertain issuance or show an unsafe callback', async () => {
  for (const callback of [null, 'javascript:alert(1)', 'http://evil.example/callback']) {
    class Consent extends RpcTarget {
      async preview() { return { selection: 's', account: 'alice', client_id: 'client', resource: 'https://memory.example/mcp', scopes: ['memory'], expires_at: '2099-01-01T00:00:00Z' } }
      decideCall = vi.fn(async (_selection: string, _approved: boolean) => { if (!callback) throw new Error('lost response'); return { redirect_uri: callback } })
      async decide(selection: string, approved: boolean) { return this.decideCall(selection, approved) }
    }
    const target = new Consent(), capability = new RpcStub(target)
    const container = document.createElement('div'); const root = createRoot(container)
    try {
      await act(async () => root.render(<AgentConsentPanel request={'a'.repeat(43)} capability={capability} />))
      await act(async () => container.querySelector('button')!.click())
      expect(target.decideCall).toHaveBeenCalledOnce()
      expect(container.querySelector('a')).toBeNull()
      expect(container.querySelector('button')).toBeNull()
      expect(container.textContent).toContain('Результат не подтверждён')
    } finally { await act(async () => root.unmount()); capability[Symbol.dispose]() }
  }
})
