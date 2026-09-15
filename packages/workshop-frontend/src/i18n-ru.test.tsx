import { describe, expect, it } from 'vitest'

// Сторож ADR 0024 §5: оболочка Workshop по-русски. Проверяются конкретные старые английские
// строки словаря story S8 в файлах её scope; строки чужих гейткиперов сюда не входят.
// Исходники читаются через Vite как текст, чтобы тест не зависел от типов Node.
const SOURCES: Record<string, string> = {
  ...import.meta.glob('./components/AppShell/*.tsx', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('./components/chat/*.tsx', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob([
    './routes/gatekeepers.tsx', './routes/index.tsx', './routes/workspaces.tsx', './routes/outputs.tsx', './routes/explore.tsx',
    './ProtectedRoute.tsx', './ShareModal.tsx', './BlueprintModal.tsx', './components/BlueprintCard.tsx', './components/BlueprintBindingCard.tsx', './GadgetEditor.tsx', './GatekeeperAppPage.tsx', './Connections.tsx', './AgentConsentDialog.tsx',
    './components/GadgetList.tsx', './components/RecentApps.tsx', './components/ConnectConnectorModal.tsx', './components/EmptyState.tsx',
  ], { query: '?raw', import: 'default', eager: true }),
}
const FILES = Object.keys(SOURCES).filter(file => !file.endsWith('.test.tsx')).sort()

// Старые строки словаря S8 в форме, в какой они стояли в коде (JSX-текст, атрибуты, литералы).
const OLD_STRINGS: RegExp[] = [
  /label="Home"/, /label="Workspaces"/, /label="Blueprints"/, /label="Outputs"/, /label="Explore"/,
  /label="Gatekeepers"/, /['"]Gatekeepers['"]/, />\s*Gatekeepers\s*</,
  /['"]Connected['"]/, /label="Connected"/, /label="Available"/,
  /Search gatekeepers…/, /Search workspaces and actions…/, /Search outputs…/,
  /['"]New workspace['"]/, /Create workspace/,
  /Export to PDF/, />\s*Version\s*</,
  />\s*Connections\s*</, /label: 'Connections'/,
  />\s*Draft\s*</, /['"]Draft['"]/,
  /Loading…/, /Loading\.\.\./, /Loading workspace…/, /Loading conversation…/, /Loading gatekeepers/, /Loading connections/, /Loading commands…/,
  /No gatekeepers/, /No outputs/, /No workspaces yet/, /No results\./, /No matches\./, /No connected resources/, /No gadgets yet/, /No commands/,
  /Something went wrong/, /Try again/, /title: ['"]Failed to /, /title: ["']Couldn['’]t /,
  /Credentials expired/, /['">]Reconnect\b/, /Open app again/, /Continue sign-in/,
  /What are we working on\?/, /Get started/,
  /Rename workspace/, /Share workspace/, /Delete workspace/, /Delete hook/, /Delete connection/,
  /Needs review/, /Auto-approval/, /['"]History['"]/, /['"]Activity['"]/, /['"]Code['"]/,
  /Full screen/, /title="Close"/, /aria-label="Close"/, /aria-label="Search"/,
  /Collapse sidebar/, /Expand sidebar/, /Open menu/, /Close menu/,
  /['"]Favorites['"]/, /Recent workspaces/, /Show all/, /Untitled workspace/i, /Untitled blueprint/,
  /['"]Rename['"]/, /['"]Share['"]/, /['"]Delete['"]/, /['"]Remove['"]/, /['"]Cancel['"]/, /['"]Save['"]/, /['"]Close['"]/, /['"]Open['"]/, /['"]Add['"]/,
  /Connect resource/, /Permission requested/, /Allow access/, /['"]Deny['"]/,
  /Resources to enable/, /What this gatekeeper can do/, /Continue to \$\{/, /Yes, disconnect/, /['"]Disconnect['"]/,
  /Theme: /, /Switch to /,
]

describe('оболочка Workshop по-русски (ADR 0024 §5)', () => {
  it('перечень файлов scope не пуст', () => expect(FILES.length).toBeGreaterThan(20))
  for (const file of FILES) it(`${file}: нет английских строк словаря S8`, () => {
    const source = SOURCES[file]
    // Комментарии кода английскими остаются: проверяются только строки, доходящие до человека.
    const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    const hits = OLD_STRINGS.filter(pattern => pattern.test(withoutComments)).map(String)
    expect(hits).toEqual([])
  })
})
