// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import { launchSharedDocument, sharedDocumentFailure } from './sharedDocuments'

const version = { id: 'private:' + 'c'.repeat(64), recordedAt: '', actor: 'user-owner', format: 'cloudflareos.document' }
function setup(publications = [version]) {
  const order: string[] = []
  const api = {
    listGadgets: vi.fn(async () => []),
    listOutputFormats: vi.fn(async () => [{ blueprintId: 'docs', output: { id: 'document' }, requiresSetup: false }]),
    newGadgetFromBlueprint: vi.fn(async () => ({ getMetadata: async () => ({ id: 'workspace-1' }), [Symbol.dispose]() {} })),
  }
  const frame = {
    nativeDownloads: { storageOrigin: '', selector: { publications: vi.fn(async () => ({ resourceUrl: 'https://memory.example/doc', nextCursor: '', publications })) } },
    nativeWrites: { storageOrigin: '', selector: { sharedDocumentSeen: vi.fn(async (...args: string[]) => { order.push('seen ' + args.join('/')) }) } },
  }
  const navigate = vi.fn(async (id: string) => { order.push('navigate ' + id) })
  return { api, frame, navigate, order }
}
const doc = { scope: 'project', owner: 'user-owner', resource: 'HEN4HKQ24UIOKVLJYW7SAQWKTP' }

// Переход в редактор закрывает «Входящие», вызвавшие открытие: всё, что им нужно, делается до перехода.
it('документ по приглашению: отметка «прочитано» с владельцем ставится до перехода в редактор', async () => {
  const { api, frame, navigate, order } = setup()
  expect(await launchSharedDocument(api as never, frame as never, 7, doc, navigate)).toBe(true)
  expect(frame.nativeDownloads.selector.publications).toHaveBeenCalledWith('project', doc.resource, '')
  expect(order).toEqual([`seen project/user-owner/${doc.resource}`, 'navigate workspace-1'])
})

it('нет доступной версии — false без перехода и без отметки; понятная строка называет причину', async () => {
  const { api, frame, navigate, order } = setup([])
  expect(await launchSharedDocument(api as never, frame as never, 7, doc, navigate)).toBe(false)
  expect(order).toEqual([])
  expect(sharedDocumentFailure('План')).toBe('Документ «План» не открылся: у вас сейчас нет доступа к нему или к папке, где он лежит. Попросите владельца документа открыть доступ заново.')
  expect(sharedDocumentFailure('План', new Error('Редактор этого формата пока не настроен'))).toBe('Документ «План» не открылся: Редактор этого формата пока не настроен. Повторите попытку.')
  expect(sharedDocumentFailure('План', new Error('RPC failed'))).toBe('Документ «План» не открылся: не удалось связаться с Mnemos. Повторите попытку.')
})

it('без подключения Mnemos — ошибка со словами, а не тишина', async () => {
  const { api, navigate } = setup()
  await expect(launchSharedDocument(api as never, {} as never, 7, doc, navigate)).rejects.toThrow('Подключение Mnemos недоступно')
})
