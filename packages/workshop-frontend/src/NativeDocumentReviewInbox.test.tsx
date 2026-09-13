// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { RpcStub, RpcTarget } from 'capnweb'
import NativeDocumentReviewInbox from './NativeDocumentReviewInbox'
const { api, download } = vi.hoisted(() => ({ api: { getGatekeeperApp: vi.fn() }, download: vi.fn() }))
vi.mock('./AuthContext', () => ({ useAuthenticatedApi: () => ({ authenticatedApi: api }) }))
vi.mock('./gatekeeperAppDownload', () => ({ downloadGatekeeperNativeReview: download }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
it('clears preview on uncertain decisions and rereads the actual decision version', async () => {
  let version = 1, approved: boolean | undefined, calls = 0, disposals = 0, revoked = false
  class Selector extends RpcTarget {
    async reviewerIdentity() { return 'reviewer' }
    async review(id: string) {
      expect(id).toBe('proposal')
      if (revoked) throw new Error('Access revoked')
      return { candidate_id: id, project_id: 'project', author_id: 'author', personal_head: 'a', shared_head: 'b', decision_version: version, stale: false, ready: approved === true,
        domains: [{ domain_id: 'Разработка', node_ids: ['doc'], approvers: ['reviewer'], decisions: approved === undefined ? [] : [{ approver_id: 'reviewer', approved }] }] }
    }
    async reviewInbox() { return { reviews: [await this.review('proposal')], next_cursor: '' } }
    async decideReview(id: string, domain: string, expected: number, next: boolean) {
      expect([id, domain, expected]).toEqual(['proposal', 'Разработка', version]); approved = next; version++; calls++
      if (calls === 1) throw new Error('Response lost after decision saved')
    }
  }
  class Side extends RpcTarget {
    async issue() { return null }
    async validate() { if (revoked) throw new Error('Access revoked') }
    [Symbol.dispose]() { disposals++ }
  }
  class Downloads extends RpcTarget {
    async selectReview(id: string, node: string, expected: number, side: string, format: string) {
      expect([id, node, expected, format]).toEqual(['proposal', 'doc', version, 'cloudflareos.document'])
      expect(['before', 'after']).toContain(side); return new RpcStub(new Side())
    }
  }
  let sideCount = 0
  download.mockImplementation(async (_origin, selection, _format, _signal, onMetadata) => {
    await selection.validate()
    const absent = sideCount++ % 2 === 0
    if (!absent) onMetadata({ name: "Новое имя.cfdoc", parent_id: "" })
    return absent ? null : { format: 'cloudflareos.document', formatVersion: 1, document: { title: 'Предложенный план', blocks: [{ html: '<p>Изменение</p>' }] } }
  })
  class Empty extends RpcTarget {}
  api.getGatekeeperApp.mockImplementation(async () => ({ iframeHtml: '', ui: new RpcStub(new Empty()), nativeWrites: { storageOrigin: 'https://objects.example', selector: new RpcStub(new Selector()) }, nativeDownloads: { storageOrigin: 'https://objects.example', selector: new RpcStub(new Downloads()) } }))
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container)
  const click = async (text: string) => {
    const b = [...document.querySelectorAll('button')].find(b => b.textContent === text)!
    expect(b).toBeDefined(); expect(b.disabled).toBe(false); await act(async () => b.click())
  }
  try {
    await act(async () => root.render(<NativeDocumentReviewInbox context={{}} format="cloudflareos.document" />))
    await click('На согласование мне')
    await act(async () => { await vi.waitFor(() => expect(document.body.textContent).toContain('Разработка')) })
    await click('Открыть согласование'); await click('Проверить документ 1')
    expect(document.body.textContent).toContain('Документа не было.')
    expect(document.body.textContent).toContain('Имя: Новое имя.cfdoc · Папка: Корень проекта')
    expect(document.querySelector('iframe[title="Содержимое: Предложенный план"]')).not.toBeNull()
    await vi.waitFor(() => expect(disposals).toBe(2))
    await click('Одобрить')
    expect(calls).toBe(1); expect(document.querySelector('iframe')).toBeNull()
    expect(document.body.textContent).not.toContain('Новое имя.cfdoc')
    expect(document.querySelector('[role="alert"]')).not.toBeNull()
    await click('Перечитать согласования'); await click('Открыть согласование')
    expect(document.body.textContent).toContain('вы одобрили')
    await click('Отклонить'); expect(calls).toBe(2); expect(document.body.textContent).toContain('вы отклонили')
    revoked = true; await click('Проверить документ 1')
    expect(document.querySelector('iframe')).toBeNull()
    expect([...document.querySelectorAll('button')].some(b => b.textContent === 'Одобрить')).toBe(false)
  } finally { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks() }
})
