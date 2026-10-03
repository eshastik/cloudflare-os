import { useState, useEffect, useSyncExternalStore } from 'react'
import type { RpcStub } from 'capnweb'
import type { AuthenticatedApi } from '@gadgets/workshop-shared/api'
import { avatarRevision, loadAvatar, subscribeAvatarRevision } from './avatarCache'
export { invalidateAvatarCache } from './avatarCache'

/** Кэш профиля принадлежит текущей сессии; изображения читаются из S3 по версии. */
export function useAvatar(authenticatedApi: RpcStub<AuthenticatedApi>, userId: string | null | undefined): string | null {
  const version = useSyncExternalStore(subscribeAvatarRevision, () => userId ? avatarRevision(userId) : 0, () => 0)
  const [photo, setPhoto] = useState<{ api: RpcStub<AuthenticatedApi>; id: string; url: string | null } | null>(null)
  useEffect(() => {
    let current = true
    if (userId) void loadAvatar(authenticatedApi, userId).then(url => {
      if (current) setPhoto({ api: authenticatedApi, id: userId, url })
    }).catch(() => { if (current) setPhoto(null) })
    return () => { current = false }
  }, [authenticatedApi, userId, version])
  return photo?.api === authenticatedApi && photo.id === userId ? photo.url : null
}
