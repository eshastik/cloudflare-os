import { afterEach, expect, it, vi } from 'vitest'
import { RpcStub, RpcTarget } from 'capnweb'
import type { ConnectedAccountsSubscriber } from '@gadgets/workshop-shared/api'

vi.mock('./avatarUtils', () => ({ compressAvatar: async () => new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]) }))
import { forgetMnemosPrincipals, mnemosPrincipal, photoMap, refreshPhotos, removeMyPhoto, uploadMyPhoto } from './mnemosPhotos'

afterEach(() => { vi.unstubAllGlobals() })

class Empty extends RpcTarget {}
function setup() {
  const calls: unknown[][] = []
  let photos = [] as { id: string; sha256: string; url: string; expiresAt: string }[]
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
    getGatekeeperApp: async () => ({ iframeHtml: '', ui: new RpcStub(new Empty()), nativeWrites: { storageOrigin: 'https://objects.example', selector: new RpcStub(new Selector()) } }),
  }
  return { api: api as never, calls }
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
