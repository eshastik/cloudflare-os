import { afterEach, expect, it, vi } from 'vitest'
import { uploadGatekeeperText, type GatekeeperUploadTicket } from './gatekeeperAppUpload'

const origin = 'https://objects.example.com'
function ticket(size: number, checksum: string): GatekeeperUploadTicket {
  return { upload_id: 'receipt', url: origin + '/bucket/object?signature=secret',
    method: 'PUT', checksum_header: 'x-amz-checksum-sha256',
    checksum_value: checksum, content_length: size }
}
afterEach(() => vi.unstubAllGlobals())

it('sends exact UTF-8 bytes directly to storage with no browser credentials', async () => {
  const request = vi.fn(async () => new Response(null, { status: 200 }))
  vi.stubGlobal('fetch', request)
  const issue = vi.fn(async (size: number, checksum: string) => ticket(size, checksum))
  expect(await uploadGatekeeperText('Привет', origin, issue, new AbortController().signal)).toBe('receipt')
  expect(issue.mock.calls[0][0]).toBe(12)
  const [url, options] = request.mock.calls[0] as unknown as [string, RequestInit]
  expect(url).toBe(origin + '/bucket/object?signature=secret')
  expect(options).toMatchObject({ method: 'PUT', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' })
  expect(new TextDecoder().decode(options.body as Uint8Array)).toBe('Привет')
  expect(options.headers).toEqual({ 'x-amz-checksum-sha256': issue.mock.calls[0][1] })
})

it('rejects redirected authority, altered checksums/lengths and arbitrary headers before network', async () => {
  const request = vi.fn()
  vi.stubGlobal('fetch', request)
  for (const change of [
    { url: 'https://evil.example/object' }, { url: 'https://user@objects.example.com/object' },
    { method: 'POST' }, { checksum_header: 'Authorization' },
    { checksum_value: 'wrong' }, { content_length: 999 },
  ]) {
    await expect(uploadGatekeeperText('edit', origin, async (size, checksum) => ({ ...ticket(size, checksum), ...change }), new AbortController().signal)).rejects.toThrow('Document upload failed.')
  }
  expect(request).not.toHaveBeenCalled()
})

it('bounds multibyte text, stops revoked sessions, and masks storage errors without retry', async () => {
  const request = vi.fn(async () => { throw new Error('https://secret-signed-url') })
  vi.stubGlobal('fetch', request)
  const issue = vi.fn(async (size: number, checksum: string) => ticket(size, checksum))
  await expect(uploadGatekeeperText('я'.repeat(150_000), origin, issue, new AbortController().signal)).rejects.toThrow()
  expect(issue).not.toHaveBeenCalled()
  const controller = new AbortController()
  await expect(uploadGatekeeperText('edit', origin, async (size, checksum) => {
    controller.abort(); return ticket(size, checksum)
  }, controller.signal)).rejects.toThrow()
  expect(request).not.toHaveBeenCalled()
  await expect(uploadGatekeeperText('edit', origin, issue, new AbortController().signal)).rejects.toThrow(/^Document upload failed\.$/)
  expect(request).toHaveBeenCalledTimes(1)
})
