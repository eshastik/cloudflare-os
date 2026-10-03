import { afterEach, expect, it } from 'vitest'
import { clearAvatarMemory, invalidateAvatarCache, loadAvatar } from './avatarCache'
afterEach(clearAvatarMemory)

it('позднее старое фото отбрасывается после замены и вытеснения пользователя из кэша', async () => {
  let release!: (bytes: Uint8Array) => void
  let calls = 0
  const api = {
    getAvatarReference: async () => null,
    getAvatar: async (id: string) => {
      if (id === 'owner' && ++calls === 1) return new Promise<Uint8Array>(resolve => { release = resolve })
      return new Uint8Array([255, 216, 255, 2])
    },
  }
  const stale = loadAvatar(api, 'owner')
  await Promise.resolve(); await Promise.resolve()
  invalidateAvatarCache('owner')
  expect(await loadAvatar(api, 'owner')).toMatch(/^blob:/)
  for (let i = 0; i < 100; i++) await loadAvatar(api, `other-${i}`)
  release(new Uint8Array([255, 216, 255, 1]))
  expect(await stale).toBeNull()
})
