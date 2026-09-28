import { createRouter as createTanStackRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'
import PageLoading from './components/PageLoading'

export function createRouter() {
  return createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
    // Код разделов грузится по требованию: пока он в пути, на месте страницы — признак загрузки.
    defaultPendingComponent: () => <PageLoading />,
    defaultPendingMs: 200,
  })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createRouter>
  }
}
