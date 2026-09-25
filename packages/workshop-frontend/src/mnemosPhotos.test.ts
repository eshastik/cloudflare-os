import { afterEach, expect, it, vi } from 'vitest'
import { RpcStub, RpcTarget } from 'capnweb'
import type { ConnectedAccountsSubscriber } from '@gadgets/workshop-shared/api'

vi.mock('./avatarUtils', () => ({ compressAvatar: async () => new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]) }))
import { carryPlatformPhoto, clearMyPhoto, forgetCarriedPhotos, forgetMnemosPrincipals, mnemosPrincipal, photoMap, refreshPhotos, removeMyPhoto, saveMyPhoto, shownPhoto, uploadMyPhoto } from './mnemosPhotos'
import { FramePersonPhotos, forgetDownloadedPhotos, framePhotos } from './framePersonPhotos'

afterEach(() => { vi.unstubAllGlobals() })

class Empty extends RpcTarget {}
function setup(options: { connected?: boolean; platform?: Uint8Array | null } = {}) {
  const calls: unknown[][] = []
  let photos = [] as { id: string; sha256: string; url: string; expiresAt: string }[]
  let platform = options.platform ?? null
  class Selector extends RpcTarget {
    async reviewerIdentity() { return 'me' }
    async peoplePhotos() { return { photos } }
    async beginPhotoUpload(size: number, checksum: string) {
      calls.push(['begin', size, checksum])
      return { upload_id: 'up-1', url: 'https://objects.example/staging/acme/up-1', method: 'PUT', checksum_header: 'x-amz-checksum-sha256', checksum_value: checksum, content_length: size }
    }
    async savePhoto(id: string) { calls.push(['save', id]); photos = [{ id: 'me', sha256: 'a'.repeat(64), url: 'https://objects.example/content/me.jpg', expiresAt: '' }]; return photos[0] }
    async removePhoto() { calls.push(['remove']); photos = [] }
  }
  const api = {
    subscribeConnectedAccounts: async (s: ConnectedAccountsSubscriber) => { s.add(1, { displayName: 'Память', avatar: { url: '' }, providesUi: { title: 'Память' } } as never, { displayName: 'Память', url: 'https://memory.example' } as never, [{ urlPattern: 'https://memory.example/drive', description: '', title: '', receives: 'drive' }] as never, true, 'memory'); s.ready(); return new RpcStub(new Empty()) },
    getGatekeeperApp: async () => options.connected === false ? null : ({ iframeHtml: '', ui: new RpcStub(new Empty()), nativeWrites: { storageOrigin: 'https://objects.example', selector: new RpcStub(new Selector()) } }),
    getAvatar: async (id: string) => { calls.push(['platform-get', id]); return platform },
    setAvatar: async (bytes: Uint8Array | null) => { calls.push(['platform-set', bytes ? [...bytes] : null]); platform = bytes },
  }
  return { api: api as never, calls, platform: () => platform, setPhotos(next: typeof photos) { photos = next } }
}

it('своя фотография: билет, PUT тела прямо в хранилище с суммой, сохранение, снятие', async () => {
  const { api, calls } = setup()
  const put = vi.fn(async (_url: string, _init: RequestInit) => new Response(null, { status: 200 }))
  vi.stubGlobal('fetch', put)
  await uploadMyPhoto(api, new File([new Uint8Array([1])], 'me.png', { type: 'image/png' }))
  expect(calls[0]![0]).toBe('begin')
  expect(calls[0]![1]).toBe(6)
  expect(put).toHaveBeenCalledTimes(1)
  const [url, init] = put.mock.calls[0]!
  expect(url).toBe('https://objects.example/staging/acme/up-1')
  expect(init.method).toBe('PUT')
  expect((init.headers as Record<string, string>)['x-amz-checksum-sha256']).toBe(calls[0]![2])
  expect(calls[1]).toEqual(['save', 'up-1'])
  expect((await refreshPhotos(api)).photos.get('me')).toBe('https://objects.example/content/me.jpg')
  await removeMyPhoto(api)
  expect(calls.at(-1)).toEqual(['remove'])
  expect((await refreshPhotos(api)).photos.size).toBe(0)
})

it('ссылка на фотографию годится только https и в своё хранилище', () => {
  const map = photoMap([
    { id: 'a', sha256: '', url: 'https://objects.example/content/a.jpg', expiresAt: '' },
    { id: 'b', sha256: '', url: 'http://objects.example/content/b.jpg', expiresAt: '' },
    { id: 'c', sha256: '', url: 'https://evil.example/c.jpg', expiresAt: '' },
    { id: 'd', sha256: '', url: 'javascript:alert(1)', expiresAt: '' },
  ], 'https://objects.example')
  expect([...map.keys()]).toEqual(['a'])
})

it('склейка пользователей с принципалами: запросы одного прохода — один вызов, ответ кэшируется', async () => {
  forgetMnemosPrincipals()
  const lookup = vi.fn(async (ids: string[]) => Object.fromEntries(ids.filter(id => id !== 'nobody').map(id => [id, `p-${id}`])))
  const api = { mnemosPrincipals: lookup }
  expect(await Promise.all([mnemosPrincipal(api, 'anna'), mnemosPrincipal(api, 'ivan'), mnemosPrincipal(api, 'nobody'), mnemosPrincipal(api, 'anna')])).toEqual(['p-anna', 'p-ivan', null, 'p-anna'])
  expect(lookup).toHaveBeenCalledTimes(1)
  expect(await mnemosPrincipal(api, 'ivan')).toBe('p-ivan')
  expect(lookup).toHaveBeenCalledTimes(1)
  expect(await mnemosPrincipal({}, 'olga')).toBeNull()
})

it('фото из настроек пишется в оба места: Mnemos и профиль платформы; «Убрать» убирает из обоих', async () => {
  const t = setup()
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })))
  await saveMyPhoto(t.api, 'u1', new File([new Uint8Array([1])], 'me.png', { type: 'image/png' }))
  expect(t.calls.map(c => c[0])).toEqual(['begin', 'save', 'platform-set'])
  expect(t.calls.at(-1)).toEqual(['platform-set', [0xff, 0xd8, 0xff, 1, 2, 3]])
  expect((await refreshPhotos(t.api)).photos.has('me')).toBe(true)
  await clearMyPhoto(t.api, 'u1')
  expect(t.calls.slice(-2)).toEqual([['remove'], ['platform-set', null]])
  expect((await refreshPhotos(t.api)).photos.size).toBe(0)
})

it('сбой Mnemos при загрузке не пишет фото в платформу; без подключения Mnemos — только платформа', async () => {
  const t = setup()
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 403 })))
  await expect(saveMyPhoto(t.api, 'u1', new File([new Uint8Array([1])], 'me.png'))).rejects.toThrow()
  expect(t.calls.some(c => c[0] === 'platform-set')).toBe(false)
  const lone = setup({ connected: false })
  await saveMyPhoto(lone.api, 'u1', new File([new Uint8Array([1])], 'me.png'))
  expect(lone.calls.map(c => c[0])).toEqual(['platform-set'])
})

it('перенос: фото платформы без фото в Mnemos загружается в Mnemos тем же путём и один раз', async () => {
  forgetCarriedPhotos()
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 7, 7])
  const t = setup({ platform: jpeg })
  const put = vi.fn(async (_url: string, _init: RequestInit) => new Response(null, { status: 200 }))
  vi.stubGlobal('fetch', put)
  await refreshPhotos(t.api)
  expect(await carryPlatformPhoto(t.api, 'u1')).toBe('carried')
  expect(t.calls.filter(c => c[0] === 'begin')).toEqual([['begin', jpeg.byteLength, expect.any(String)]])
  expect(new Uint8Array(await new Response(put.mock.calls[0]![1].body as BodyInit).arrayBuffer())).toEqual(jpeg)
  expect((await refreshPhotos(t.api)).photos.has('me')).toBe(true)
  // Фото в Mnemos уже есть — повторного переноса нет.
  expect(await carryPlatformPhoto(t.api, 'u1')).toBe('skipped')
  expect(put).toHaveBeenCalledTimes(1)
})

it('перенос пропускает не картинку и отсутствие фото платформы; причина уходит в консоль', async () => {
  forgetCarriedPhotos()
  const debug = vi.spyOn(console, 'debug').mockImplementation(() => {})
  const svg = setup({ platform: new TextEncoder().encode('<svg/>') })
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })))
  await refreshPhotos(svg.api)
  expect(await carryPlatformPhoto(svg.api, 'u2')).toBe('skipped')
  expect(svg.calls.some(c => c[0] === 'begin')).toBe(false)
  expect(debug.mock.calls.flat().join(' ')).toMatch(/не перенесено/)
  const none = setup({ platform: null })
  await refreshPhotos(none.api)
  expect(await carryPlatformPhoto(none.api, 'u3')).toBe('skipped')
  expect(none.calls.some(c => c[0] === 'begin')).toBe(false)
  debug.mockRestore()
})

it('сторож одного источника: оболочка и встроенное приложение показывают одно и то же фото человека', async () => {
  forgetDownloadedPhotos()
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])
  const sha = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', jpeg)), b => b.toString(16).padStart(2, '0')).join('')
  const t = setup()
  const url = 'https://objects.example/content/owner.jpg?sig=1'
  t.setPhotos([{ id: 'mnemos-owner', sha256: sha, url, expiresAt: new Date(Date.now() + 15 * 60_000).toISOString() }])
  // Оболочка: общий снимок фото (MnemosAvatar, MyAvatar, PersonAvatar по склейке).
  const shell = (await refreshPhotos(t.api)).photos.get('mnemos-owner')
  // Встроенное приложение: мост читает тот же список того же подключения и отдаёт байты по той же ссылке.
  const fetched: string[] = []
  const frame = new FramePersonPhotos({ peoplePhotos: async () => ({ photos: [{ id: 'mnemos-owner', sha256: sha, url, expiresAt: new Date(Date.now() + 15 * 60_000).toISOString() }] }) }, 'https://objects.example',
    { fetch: (async (input: string | URL | Request) => { fetched.push(String(input)); return new Response(jpeg as BodyInit, { status: 200 }) }) as typeof fetch })
  const [bytes] = await framePhotos(frame, ['mnemos-owner'])
  expect(shell).toBe(url)
  expect(fetched).toEqual([shell])
  expect(bytes?.sha256).toBe(sha)
  // Фото платформы при связи с Mnemos не показывается: иначе оболочка показала бы фото, а приложение — инициалы.
  expect(shownPhoto({ linked: true, url: null }, 'blob:platform')).toBeNull()
  expect(shownPhoto({ linked: true, url: shell! }, 'blob:platform')).toBe(url)
  expect(shownPhoto({ linked: false, url: null }, 'blob:platform')).toBe('blob:platform')
})
