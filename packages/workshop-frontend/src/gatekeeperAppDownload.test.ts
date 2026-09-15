import { uploadGatekeeperOfficePreview } from './gatekeeperAppUpload'
import { afterEach, expect, it, vi } from 'vitest'
import { downloadGatekeeperTemplateText, downloadGatekeeperFile, downloadGatekeeperOfficePreview, downloadGatekeeperOffice, downloadGatekeeperText, downloadGatekeeperNativeDocument, downloadGatekeeperNativeReview } from './gatekeeperAppDownload'
const origin = 'https://objects.example'
afterEach(() => vi.unstubAllGlobals())

it('checks exact body hash/size and rejects truncation, oversize and malformed UTF-8', async () => {
  for (const [body, size, valid] of [
    [new TextEncoder().encode('Текст'), 10, true],
    [new TextEncoder().encode('Текст'), 11, false],
    [new TextEncoder().encode('Текст'), 2, false],
    [new Uint8Array([255]), 1, false],
  ] as const) {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', body))
    const sha256_hex = Array.from(digest, b => b.toString(16).padStart(2, '0')).join('')
    const request = vi.fn(async () => new Response(body))
    vi.stubGlobal('fetch', request)
    const operation = downloadGatekeeperText(origin, { url: origin + '/object', method: 'GET', size_bytes: size, sha256_hex }, new AbortController().signal)
    if (valid) await expect(operation).resolves.toBe('Текст')
    else await expect(operation).rejects.toThrow('Document download failed.')
  }
})

it('does not fetch a foreign destination and masks a checksum mismatch', async () => {
  const request = vi.fn(async () => new Response('x'))
  vi.stubGlobal('fetch', request)
  const ticket = { url: 'https://evil.example/object', method: 'GET', size_bytes: 1, sha256_hex: '0'.repeat(64) }
  await expect(downloadGatekeeperText(origin, ticket, new AbortController().signal)).rejects.toThrow()
  expect(request).not.toHaveBeenCalled()
  await expect(downloadGatekeeperText(origin, { ...ticket, url: origin + '/object' }, new AbortController().signal)).rejects.toThrow('Document download failed.')
})

async function nativeTicket(snapshot: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(snapshot))
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes)))
  return { url: origin + '/native', method: 'GET', size_bytes: bytes.length,
    sha256_hex: Array.from(digest, b => b.toString(16).padStart(2, '0')).join(''), content_type: 'application/json' }
}

it('native approval previews preserve the snapshot and suppress content or absence after a stale decision', async () => {
  const format = 'cloudflareos.spreadsheet' as const
  const snapshot = { format, formatVersion: 1, document: { cells: { A1: { value: '=SUM(B1:B3)' } } } }
  const ticket = { ...await nativeTicket(snapshot), metadata: { name: "Reviewed.cfdoc", parent_id: "folder" } }
  let absent = false, stale = false
  const download = {
    issue: async () => absent ? null : ticket,
    validate: async () => { if (stale) throw new Error('Review changed') },
  }
  const metadata = vi.fn()
  const read = () => downloadGatekeeperNativeReview(origin, download, format, new AbortController().signal, metadata)
  await expect(read()).resolves.toEqual(snapshot)
  stale = true; await expect(read()).rejects.toThrow()
  absent = true; await expect(read()).rejects.toThrow()
  stale = false; await expect(read()).resolves.toBeNull()
  expect(metadata).toHaveBeenCalledExactlyOnceWith(ticket.metadata)
})

it('preserves native HTML and formulas and rechecks access before returning a snapshot', async () => {
  for (const format of ['cloudflareos.document', 'cloudflareos.spreadsheet'] as const) {
    const snapshot = { format, formatVersion: 1, document: format === 'cloudflareos.document'
      ? { title: 'Документ', blocks: [{ id: 'one', html: '<p><strong>Текст</strong></p>' + ' '.repeat(270000) }] }
      : { title: 'Таблица', cells: { sheet: { A1: { value: '=SUM(B1:B3)', fmt: { b: true } } } } } }
    const ticket = await nativeTicket(snapshot)
    const validate = vi.fn(async () => {})
    await expect(downloadGatekeeperNativeDocument(origin, ticket, format, new AbortController().signal, validate)).resolves.toEqual(snapshot)
    expect(validate).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledWith(ticket.url, expect.objectContaining({ credentials: 'omit', redirect: 'error', cache: 'no-store' }))
  }
})

it('does not release native data after revocation or cancellation and rejects mismatched formats', async () => {
  const snapshot = { format: 'cloudflareos.document', formatVersion: 1, document: { blocks: [] } }
  const ticket = await nativeTicket(snapshot)
  const revoked = async () => { throw new Error('private access detail') }
  await expect(downloadGatekeeperNativeDocument(origin, ticket, 'cloudflareos.document', new AbortController().signal, revoked)).rejects.toThrow('Native document download failed.')
  const cancel = new AbortController()
  await expect(downloadGatekeeperNativeDocument(origin, ticket, 'cloudflareos.document', cancel.signal, async () => { cancel.abort() })).rejects.toThrow()
  const validate = vi.fn(async () => {})
  await expect(downloadGatekeeperNativeDocument(origin, ticket, 'cloudflareos.spreadsheet', new AbortController().signal, validate)).rejects.toThrow()
  expect(validate).not.toHaveBeenCalled()
  const fetcher = vi.mocked(fetch); fetcher.mockClear()
  await expect(downloadGatekeeperNativeDocument(origin, { ...ticket, size_bytes: 4 * 1024 * 1024 + 1 }, 'cloudflareos.document', new AbortController().signal, validate)).rejects.toThrow()
  await expect(downloadGatekeeperNativeDocument(origin, { ...ticket, content_type: 'text/html' }, 'cloudflareos.document', new AbortController().signal, validate)).rejects.toThrow()
  expect(fetcher).not.toHaveBeenCalled()
})

it('office download preserves binary bytes and refuses release after source revocation', async () => {
  const bytes = new Uint8Array([0x50, 0x4b, 3, 4, 0xff, 0, 0x80])
  const sum = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  const ticket = {url: origin + '/office', method: 'GET', size_bytes: bytes.length,
    sha256_hex: Array.from(sum, b => b.toString(16).padStart(2, '0')).join(''),
    content_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}
  vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes)))
  const validate = vi.fn(async () => {})
  await expect(downloadGatekeeperOffice(origin, ticket, 'cloudflareos.spreadsheet', new AbortController().signal, validate)).resolves.toEqual(bytes)
  expect(validate).toHaveBeenCalledOnce()
  await expect(downloadGatekeeperOffice(origin, ticket, 'cloudflareos.spreadsheet', new AbortController().signal, async () => {throw new Error('revoked')})).rejects.toThrow()
  vi.mocked(fetch).mockClear()
  await expect(downloadGatekeeperOffice(origin, ticket, 'cloudflareos.document', new AbortController().signal, validate)).rejects.toThrow()
  expect(fetch).not.toHaveBeenCalled()
})

it('uploads office preview bytes unchanged, including JSON escapes and whitespace', async () => {
  const text = '{ "format": "cloudflareos.document", "formatVersion": 1, "document": {"title":"\\u041fлан"} }\n'
  const bytes = new TextEncoder().encode(text)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))
  const hash = Array.from(digest,b=>b.toString(16).padStart(2,'0')).join('')
  const ticket = {url:origin+'/preview',method:'GET',size_bytes:bytes.length,sha256_hex:hash,content_type:'application/vnd.cloudflareos.document+json'}
  vi.stubGlobal('fetch',vi.fn(async (_url,init) => {
    if (init?.method === 'PUT') { expect(init.body).toEqual(bytes); return new Response(null,{status:200}) }
    return new Response(bytes)
  }))
  const signal = new AbortController().signal
  const actual = await downloadGatekeeperOfficePreview(origin,ticket,'cloudflareos.document',signal,async()=>{})
  expect(actual).toBe(text)
  await expect(uploadGatekeeperOfficePreview(actual,origin,async(size,checksum)=>({url:origin+'/upload',method:'PUT',upload_id:'u',content_length:size,checksum_header:'x-amz-checksum-sha256',checksum_value:checksum}),signal)).resolves.toBe('u')
  await expect(downloadGatekeeperOfficePreview(origin,ticket,'cloudflareos.document',signal,async()=>{throw new Error('revoked')})).rejects.toThrow()
})

it('preserves presentation structure and denies access after revocation or Office format confusion', async () => {
  const format = 'cloudflareos.presentation' as const
  const snapshot = { format, formatVersion: 1, document: { themeVersion: 'workspace.1', revision: 3,
    slides: [{ id: 's1', background: { color: '#ffffff' }, blocks: [{ id: 'b1', type: 'text', x: 10, y: 20, props: { text: 'План команды' } }] }] } }
  const ticket = { ...await nativeTicket(snapshot), content_type: `application/vnd.${format}+json` }
  await expect(downloadGatekeeperNativeDocument(origin, ticket, format, new AbortController().signal, async () => {})).resolves.toEqual(snapshot)
  await expect(downloadGatekeeperNativeDocument(origin, ticket, format, new AbortController().signal, async () => { throw Error('revoked') })).rejects.toThrow()
  vi.mocked(fetch).mockClear()
  await expect(downloadGatekeeperOffice(origin, ticket, format, new AbortController().signal, async () => {})).rejects.toThrow()
  expect(fetch).not.toHaveBeenCalled()
})

it('сохраняет бинарный документ без перекодирования и повторно проверяет доступ', async () => {
 const bytes=new Uint8Array([0,255,128,10]);
 const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
 const ticket={url:origin+'/binary',method:'GET',size_bytes:bytes.length,sha256_hex:Array.from(digest,b=>b.toString(16).padStart(2,'0')).join('')};
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(bytes)));
 const validate=vi.fn(async()=>{});
 await expect(downloadGatekeeperFile(origin,ticket,new AbortController().signal,validate)).resolves.toEqual(bytes);
 expect(validate).toHaveBeenCalledOnce();
 await expect(downloadGatekeeperFile(origin,ticket,new AbortController().signal,async()=>{throw Error('revoked')})).rejects.toThrow('revoked');
});

it('снимок шаблона имеет отдельный предел, обычное чтение остаётся ограниченным', async()=>{
 const text='x'.repeat(300_000),bytes=new TextEncoder().encode(text)
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('')
 const ticket={url:origin+'/template',method:'GET',size_bytes:bytes.length,sha256_hex:hash}
 vi.stubGlobal('fetch',vi.fn<typeof fetch>(async()=>new Response(bytes)))
 const signal=new AbortController().signal
 await expect(downloadGatekeeperTemplateText(origin,ticket,signal)).resolves.toBe(text)
 await expect(downloadGatekeeperText(origin,ticket,signal)).rejects.toThrow('Document download failed.')
 await expect(downloadGatekeeperTemplateText(origin,{...ticket,size_bytes:49*1024*1024},signal)).rejects.toThrow('Document download failed.')
})
