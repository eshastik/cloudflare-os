import { expect, it } from 'vitest'
import { requestNativeSnapshot } from './nativeSnapshotSource'

it('uses a private reply port and returns only a matching native data envelope', async () => {
  const snapshot = { format: 'cloudflareos.document', formatVersion: 1, document: { blocks: [{ html: '<p>Latest input</p>' }] } }
  const target = { postMessage(message: unknown, origin: string, ports: MessagePort[]) {
    expect(message).toEqual({ type: 'native-snapshot-request', format: snapshot.format })
    expect(origin).toBe('*'); expect(ports).toHaveLength(1)
    ports[0].postMessage({ snapshot })
  } } as Window
  await expect(requestNativeSnapshot(target, 'cloudflareos.document', new AbortController().signal)).resolves.toEqual(snapshot)
  await expect(requestNativeSnapshot({ postMessage(_message: unknown, _origin: string, ports: MessagePort[]) {
    ports[0].postMessage({ snapshot: { ...snapshot, format: 'cloudflareos.spreadsheet' } })
  } } as Window, 'cloudflareos.document', new AbortController().signal)).rejects.toThrow()
})

it('cancels on editor replacement and rejects failed flushes instead of reading old server data', async () => {
  const controller = new AbortController()
  let reply: MessagePort | undefined
  const operation = requestNativeSnapshot({ postMessage(_message: unknown, _origin: string, ports: MessagePort[]) { reply = ports[0] } } as Window,
    'cloudflareos.document', controller.signal)
  controller.abort()
  await expect(operation).rejects.toThrow('Редактор не отдал документ.')
  reply?.close()
  await expect(requestNativeSnapshot({ postMessage(_message: unknown, _origin: string, ports: MessagePort[]) {
    ports[0].postMessage({ error: true })
  } } as Window, 'cloudflareos.document', new AbortController().signal)).rejects.toThrow('Редактор не смог сохранить текущую версию.')
})
