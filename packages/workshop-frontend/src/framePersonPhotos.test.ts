import { afterEach, expect, it, vi } from 'vitest'
import { FramePersonPhotos, forgetDownloadedPhotos, PHOTO_LIST_FRESH_MS } from './framePersonPhotos'

const ORIGIN = 'https://objects.example'
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70])
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0])

async function hex(bytes: Uint8Array) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource)), b => b.toString(16).padStart(2, '0')).join('')
}

afterEach(() => forgetDownloadedPhotos())

async function setup(files: Record<string, Uint8Array>, sums?: Record<string, string>) {
  let now = Date.parse('2026-09-25T10:00:00Z')
  const listings: number[] = []
  const photos = await Promise.all(Object.entries(files).map(async ([id, bytes]) => ({ id, sha256: sums?.[id] ?? await hex(bytes), url: `${ORIGIN}/content/${id}.jpg?sig=1`, expiresAt: new Date(now + 15 * 60_000).toISOString() })))
  const lister = { peoplePhotos: vi.fn(async () => { listings.push(now); return { photos } }) }
  const fetch = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
    const id = String(url).match(/content\/(.+)\.jpg/)?.[1] ?? ''
    return files[id] ? new Response(files[id] as BodyInit, { status: 200 }) : new Response(null, { status: 404 })
  })
  const source = new FramePersonPhotos(lister, ORIGIN, { fetch: fetch as typeof globalThis.fetch, now: () => now })
  return { source, lister, fetch, photos, listings, advance(ms: number) { now += ms } }
}

it('одно чтение списка и одна загрузка на человека; повтор берётся из кэша', async () => {
  const { source, lister, fetch } = await setup({ anna: JPEG, ivan: PNG })
  const [anna, ivan, none] = await Promise.all([source.photo('anna'), source.photo('ivan'), source.photo('nobody')])
  expect(anna?.type).toBe('image/jpeg')
  expect(ivan?.type).toBe('image/png')
  expect(none).toBeNull()
  expect(lister.peoplePhotos).toHaveBeenCalledTimes(1)
  expect(fetch).toHaveBeenCalledTimes(2)
  const [, init] = fetch.mock.calls[0]!
  expect(init).toMatchObject({ credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' })
  await source.photo('anna')
  expect(fetch).toHaveBeenCalledTimes(2)
})

it('по истечении срока список перечитывается; неизменное фото заново не скачивается', async () => {
  const t = await setup({ anna: JPEG })
  await t.source.photo('anna')
  t.advance(PHOTO_LIST_FRESH_MS + 1)
  await t.source.photo('anna')
  expect(t.lister.peoplePhotos).toHaveBeenCalledTimes(2)
  expect(t.fetch).toHaveBeenCalledTimes(1)
})

it('сменённое фото (другая сумма) скачивается заново', async () => {
  const t = await setup({ anna: JPEG })
  await t.source.photo('anna')
  t.photos[0]!.sha256 = await hex(PNG)
  t.advance(PHOTO_LIST_FRESH_MS + 1)
  expect(await t.source.photo('anna')).toBeNull() // байты в хранилище не совпали с новой суммой
  expect(t.fetch).toHaveBeenCalledTimes(2)
})

it('чужое происхождение ссылки, неверная сумма и не картинка не отдаются фрейму', async () => {
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')
  const t = await setup({ anna: JPEG, bad: JPEG, svg }, { bad: 'f'.repeat(64) })
  t.photos[0]!.url = 'https://evil.example/content/anna.jpg'
  expect(await t.source.photo('anna')).toBeNull()
  expect(await t.source.photo('bad')).toBeNull()
  expect(await t.source.photo('svg')).toBeNull()
  expect(t.fetch.mock.calls.map(([url]) => new URL(String(url)).origin)).not.toContain('https://evil.example')
})

it('неудачная загрузка не запоминается: следующий запрос пробует снова', async () => {
  const t = await setup({ anna: JPEG })
  t.fetch.mockImplementationOnce(async () => new Response(null, { status: 503 }))
  expect(await t.source.photo('anna')).toBeNull()
  expect((await t.source.photo('anna'))?.type).toBe('image/jpeg')
  expect(t.fetch).toHaveBeenCalledTimes(2)
})
