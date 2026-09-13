// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { openGatekeeperAudioRecording } from './gatekeeperAudioRecording'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.replaceChildren() })
function fixture() {
  HTMLDialogElement.prototype.showModal = () => {}
  const BrowserBlob = window.Blob
  vi.stubGlobal('Blob', class extends BrowserBlob {
    arrayBuffer(): Promise<ArrayBuffer> {
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as ArrayBuffer)
        reader.onerror = reject
        reader.readAsArrayBuffer(this)
      })
    }
  })
  const stopped = vi.fn()
  const stream: {getTracks: () => {stop: () => void}[]} = {getTracks: () => [{stop: stopped}]}
  const acquire = vi.fn(async () => stream)
  vi.stubGlobal('navigator', {mediaDevices: {getUserMedia: acquire}})
  let recorder: FakeRecorder
  class FakeRecorder {
    state = 'inactive'
    mimeType = 'audio/webm;codecs=opus'
    ondataavailable?: (event: {data: Blob}) => void
    onstop?: () => void
    constructor() { recorder = this }
    start() { this.state = 'recording' }
    stop() { this.state = 'inactive'; queueMicrotask(() => this.onstop?.()) }
  }
  vi.stubGlobal('MediaRecorder', FakeRecorder)
  const send = vi.fn()
  const close = openGatekeeperAudioRecording({postMessage: send} as unknown as Window, 'request')
  const click = async (label: string) => {
    const button = [...document.querySelectorAll('button')].find(b => b.textContent === label)!
    button.click(); await Promise.resolve(); await Promise.resolve()
  }
  return {acquire, stopped, send, close, click, recorder: () => recorder!}
}
it('requires a host click, returns bounded audio and releases the microphone', async () => {
  const f = fixture()
  expect(f.acquire).not.toHaveBeenCalled()
  await f.click('Включить микрофон')
  expect(f.acquire).toHaveBeenCalledWith({audio: true, video: false})
  f.recorder().ondataavailable?.({data: new Blob(['audio'])})
  await f.click('Завершить и прикрепить')
  await vi.waitFor(() => expect(f.send).toHaveBeenCalledOnce())
  const result = f.send.mock.calls[0][0]
  expect(result).toMatchObject({requestId: 'request', mediaType: 'audio/webm'})
  expect(new TextDecoder().decode(result.bytes)).toBe('audio')
  expect(f.stopped).toHaveBeenCalledOnce()
  expect(document.querySelector('dialog')).toBeNull()
})
it('disposal while permission is pending stops a late stream without returning bytes', async () => {
  const f = fixture()
  let resolve!: (value: {getTracks: () => {stop: () => void}[]}) => void
  f.acquire.mockImplementation(() => new Promise(r => { resolve = r }))
  await f.click('Включить микрофон'); f.close()
  resolve({getTracks: () => [{stop: f.stopped}]})
  await Promise.resolve()
  expect(f.stopped).toHaveBeenCalledOnce()
  expect(f.send).not.toHaveBeenCalled()
})
it('overflow cancels the whole recording and navigation releases capture', async () => {
  const f = fixture(); await f.click('Включить микрофон')
  f.recorder().ondataavailable?.({data: {size: 20_000_001} as Blob})
  await Promise.resolve()
  expect(f.send).toHaveBeenCalledOnce()
  expect(f.send.mock.calls[0][0]).toMatchObject({error: true})
  expect(f.stopped).toHaveBeenCalledOnce()
  const next = fixture(); await next.click('Включить микрофон')
  window.dispatchEvent(new Event('pagehide'))
  expect(next.stopped).toHaveBeenCalledOnce()
  expect(next.send).not.toHaveBeenCalled()
})
