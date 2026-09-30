import { describe, expect, it, vi } from 'vitest'
import type { ChatDocumentUploadRequest } from '@gadgets/workshop-shared/api'
import { uploadChatDocument, uploadPreparedAttachment } from './chatDocumentUpload'

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const STORAGE = 'https://s3.mnemos.example'

async function base64Sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return btoa(String.fromCharCode(...digest))
}

function fakeOverseer(uploadUrl = `${STORAGE}/bucket/obj?sig=1`, mnemos = true) {
  const calls: { method: string; args: unknown[] }[] = []
  const overseer = {
    chatDocumentsAvailable: vi.fn(async () => mnemos),
    beginChatDocumentUpload: vi.fn(async (file: ChatDocumentUploadRequest, chatId?: number, project?: unknown) => {
      calls.push({ method: 'beginChatDocumentUpload', args: [file, chatId, project] })
      return {
        token: 'tok-1', place: { projectTitle: 'Продажи', personal: false }, storageOrigin: STORAGE,
        upload: { url: uploadUrl, method: 'PUT', checksum_header: 'x-amz-checksum-sha256', checksum_value: file.checksum, content_length: file.size },
      }
    }),
    finishChatDocumentUpload: vi.fn(async (token: string) => {
      calls.push({ method: 'finishChatDocumentUpload', args: [token] })
      return { id: 'att-1', document: { accountId: 7, projectId: 'p1', projectTitle: 'Продажи', personal: false, resource: 'n1', name: 'Отчёт.docx', contentType: DOCX, size: 5 } }
    }),
    uploadChatAttachment: vi.fn(async (...args: unknown[]) => {
      calls.push({ method: 'uploadChatAttachment', args })
      return { id: 'img-1' }
    }),
  }
  return { overseer, calls }
}

// Байты не должны уходить ни в один метод беседы: ищем их в аргументах на любой глубине.
function containsBytes(value: unknown): boolean {
  if (value instanceof Uint8Array || value instanceof ArrayBuffer || value instanceof Blob) return true
  if (value && typeof value === 'object') return Object.values(value).some(containsBytes)
  return false
}

describe('выгрузка документа беседы', () => {
  it('идёт begin → PUT в хранилище → finish, байты мимо беседы', async () => {
    const { overseer, calls } = fakeOverseer()
    const bytes = new TextEncoder().encode('hello')
    const file = new File([bytes], 'Отчёт.docx', { type: '' })
    const send = vi.fn(async () => new Response(null, { status: 200 }))

    const ref = await uploadPreparedAttachment(overseer, { blob: file, mimeType: DOCX, name: file.name },
      { modelId: 'm', chatId: 42, send: send as unknown as typeof fetch })

    expect(ref).toEqual(expect.objectContaining({ id: 'att-1' }))
    expect(calls.map(c => c.method)).toEqual(['beginChatDocumentUpload', 'finishChatDocumentUpload'])
    expect(overseer.uploadChatAttachment).not.toHaveBeenCalled()
    expect(calls.some(c => containsBytes(c.args))).toBe(false)

    const checksum = await base64Sha256(bytes)
    expect(overseer.beginChatDocumentUpload).toHaveBeenCalledWith(
      { name: 'Отчёт.docx', mimeType: DOCX, size: 5, checksum }, 42, undefined)
    expect(overseer.finishChatDocumentUpload).toHaveBeenCalledWith('tok-1')

    expect(send).toHaveBeenCalledTimes(1)
    const [url, init] = send.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`${STORAGE}/bucket/obj?sig=1`)
    expect(init).toEqual(expect.objectContaining({
      method: 'PUT', body: file, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
      headers: { 'x-amz-checksum-sha256': checksum },
    }))
  })

  it('для новой беседы передаёт выбранный проект, в существующей — нет', async () => {
    const project = { accountId: 7, projectId: 'p1' }
    const send = (async () => new Response(null, { status: 200 })) as unknown as typeof fetch
    const file = () => new File(['a'], 'a.pdf', { type: 'application/pdf' })

    const fresh = fakeOverseer()
    await uploadChatDocument(fresh.overseer, file(), { project, send })
    expect(fresh.overseer.beginChatDocumentUpload.mock.calls[0][1]).toBeUndefined()
    expect(fresh.overseer.beginChatDocumentUpload.mock.calls[0][2]).toEqual(project)

    const existing = fakeOverseer()
    await uploadChatDocument(existing.overseer, file(), { chatId: 3, project, send })
    expect(existing.overseer.beginChatDocumentUpload.mock.calls[0][2]).toBeUndefined()
  })

  it('чужой адрес хранилища — отказ без PUT и без finish', async () => {
    const { overseer } = fakeOverseer('https://evil.example/put')
    const send = vi.fn(async () => new Response(null, { status: 200 }))
    await expect(uploadChatDocument(overseer, new File(['x'], 'a.txt', { type: 'text/plain' }), { send: send as unknown as typeof fetch }))
      .rejects.toThrow('Адрес хранилища не совпадает')
    expect(send).not.toHaveBeenCalled()
    expect(overseer.finishChatDocumentUpload).not.toHaveBeenCalled()
  })

  it('хранилище не приняло файл — finish не зовётся', async () => {
    const { overseer } = fakeOverseer()
    const send = (async () => new Response(null, { status: 403 })) as unknown as typeof fetch
    await expect(uploadChatDocument(overseer, new File(['x'], 'a.md', { type: '' }), { send })).rejects.toThrow()
    expect(overseer.finishChatDocumentUpload).not.toHaveBeenCalled()
  })

  it('пустой документ и не-документ отвергаются до билета', async () => {
    const { overseer } = fakeOverseer()
    await expect(uploadChatDocument(overseer, new File([], 'a.pdf', { type: 'application/pdf' }))).rejects.toThrow('пустой')
    await expect(uploadChatDocument(overseer, new File(['x'], 'a.png', { type: 'image/png' }))).rejects.toThrow('нельзя')
    expect(overseer.beginChatDocumentUpload).not.toHaveBeenCalled()
  })

  it('картинка идёт прежним путём uploadChatAttachment', async () => {
    const { overseer } = fakeOverseer()
    const image = new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' })
    const ref = await uploadPreparedAttachment(overseer, { blob: image, mimeType: 'image/png', name: 'a.png' }, { modelId: 'm', chatId: 5 })
    expect(ref).toEqual({ id: 'img-1' })
    expect(overseer.beginChatDocumentUpload).not.toHaveBeenCalled()
    expect(overseer.uploadChatAttachment).toHaveBeenCalledWith(
      { mimeType: 'image/png', content: new Uint8Array([1, 2, 3]), name: 'a.png' }, 'm', 5)
  })
})

describe('без подключённого Mnemos', () => {
  it('текст и PDF идут прежним путём до 1 МБ, Office — отказ без выгрузки', async () => {
    const { overseer, calls } = fakeOverseer(undefined, false)
    const md = new File([new TextEncoder().encode('# Итоги')], 'заметки.md', { type: '' })
    await uploadPreparedAttachment(overseer, { blob: md, mimeType: 'application/octet-stream', name: md.name }, { modelId: 'm', chatId: 5 })
    const sent = calls.find(c => c.method === 'uploadChatAttachment')!
    expect((sent.args[0] as { mimeType: string }).mimeType).toBe('text/markdown')
    expect(calls.some(c => c.method === 'beginChatDocumentUpload')).toBe(false)

    const big = new File([new Uint8Array(1024 * 1024 + 1)], 'big.txt', { type: 'text/plain' })
    await expect(uploadPreparedAttachment(overseer, { blob: big, mimeType: 'text/plain', name: big.name }, { modelId: 'm' })).rejects.toThrow(/1 МБ/)
    const docx = new File([new Uint8Array([0x50, 0x4b, 3, 4])], 'Отчёт.docx', { type: DOCX })
    await expect(uploadPreparedAttachment(overseer, { blob: docx, mimeType: DOCX, name: docx.name }, { modelId: 'm' })).rejects.toThrow(/подключите Mnemos/)
    expect(calls.filter(c => c.method === 'uploadChatAttachment').length).toBe(1)
  })
})


describe('PDF больше 100 МиБ', () => {
  it('вычисляет сумму потоком и передаёт File напрямую в PUT', async () => {
    const chunk = new Uint8Array(1024 * 1024)
    const file = new File(Array.from({ length: 101 }, () => chunk), 'large.pdf', { type: 'application/pdf' })
    vi.spyOn(file, 'arrayBuffer').mockRejectedValue(new Error('чтение целиком запрещено'))
    const { overseer } = fakeOverseer()
    const send = vi.fn<typeof fetch>(async () => new Response(null, { status: 200 }))
    await uploadChatDocument(overseer, file, { send: send as unknown as typeof fetch })
    expect(overseer.beginChatDocumentUpload.mock.calls[0][0].size).toBe(101 * 1024 * 1024)
    expect(overseer.beginChatDocumentUpload.mock.calls[0][0].checksum).toBe('8XU6A0u9JulFiSGxIcMtR1C59+Xvitu7M33Mlig+9Ao=')
    expect(file.arrayBuffer).not.toHaveBeenCalled()
    expect((send.mock.calls[0] as unknown as [string, RequestInit])[1].body).toBe(file)
    expect(overseer.finishChatDocumentUpload).toHaveBeenCalledTimes(1)
  })
})
