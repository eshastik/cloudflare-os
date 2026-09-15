// @vitest-environment jsdom
import {beforeEach, expect, test, vi} from 'vitest'
import {launchNativeDocument, readNativeDocumentLaunch} from './nativeDocumentLaunch'

beforeEach(() => { sessionStorage.clear(); localStorage.clear(); history.replaceState(null, '', '/') })
const mock = <T extends (...args: any[]) => any>(implementation: T) => vi.fn<T>(implementation)
const version = {id: 'private:head-one', format: 'cloudflareos.document'}
function setup() {
  const dispose = vi.fn<() => void>()
  const api = {listGadgets: mock(async () => [{id: "workspace-one"}]), listOutputFormats: mock(async () => [{blueprintId: 'docs-editor', output: {id: 'document'}, requiresSetup: false}]), newGadgetFromBlueprint: mock(async () => ({getMetadata: async () => ({id: 'workspace-one'}), [Symbol.dispose]: dispose}))}
  const selector = {publications: mock(async () => ({publications: [version], resourceUrl: 'https://memory.example/doc'}))}
  return {api, selector, dispose}
}
test('Открытие выбирает редактор по проверенной версии и сохраняет точный адрес документа', async () => {
  const {api, selector, dispose} = setup()
  const navigate = mock(async (id: string) => { history.replaceState(null, '', `/workspace/${id}`) })
  expect(await launchNativeDocument(api as never, selector as never, 8, 'project-two', 'document-one', navigate)).toBe(true)
  expect(selector.publications).toHaveBeenCalledWith('project-two', 'document-one', '')
  expect(api.newGadgetFromBlueprint).toHaveBeenCalledWith('docs-editor', {})
  expect(readNativeDocumentLaunch('cloudflareos.document')).toMatchObject({accountId: 8, scope: 'project-two', resource: 'document-one', publication: 'private:head-one'})
  expect(readNativeDocumentLaunch('cloudflareos.spreadsheet')).toBeNull()
  expect(dispose).toHaveBeenCalledOnce()
})
test('Отказ чтения не создаёт пустую беседу и не обходит сервер', async () => {
  const {api, selector} = setup()
  selector.publications.mockRejectedValue(new Error('forbidden'))
  await expect(launchNativeDocument(api as never, selector as never, 8, 'project', 'doc', vi.fn<() => void>())).rejects.toThrow('forbidden')
  expect(api.newGadgetFromBlueprint).not.toHaveBeenCalled()
})
test('Обычный файл без нативных версий остаётся в своём просмотрщике', async () => {
  const {api, selector} = setup()
  selector.publications.mockResolvedValue({publications: [], resourceUrl: 'https://memory.example/doc'})
  expect(await launchNativeDocument(api as never, selector as never, 8, 'project', 'doc', vi.fn<() => void>())).toBe(false)
  expect(api.newGadgetFromBlueprint).not.toHaveBeenCalled()
})

test('Повторное открытие не создаёт второе рабочее окно того же документа', async () => {
  const {api, selector} = setup()
  const navigate = vi.fn<() => void>()
  await launchNativeDocument(api as never, selector as never, 8, 'project', 'doc', navigate)
  await launchNativeDocument(api as never, selector as never, 8, 'project', 'doc', navigate)
  expect(api.newGadgetFromBlueprint).toHaveBeenCalledOnce()
  expect(api.listGadgets).toHaveBeenCalledOnce()
  expect(navigate).toHaveBeenCalledTimes(2)
  expect(selector.publications).toHaveBeenCalledTimes(2)
})
