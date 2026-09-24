import type { RpcStub } from 'capnweb'
import type { AuthenticatedApi, ChatProjectChoice } from '@gadgets/workshop-shared/api'
import type { GatekeeperUiFrame } from '@gadgets/workshop-shared/gatekeeper'
import { uploadIntakeFile } from '../../gatekeeper-mnemos/src/intake.ts'
import { collectEntryFiles, type IntakeDroppedFile } from './intakeDrop'
import { listAccounts } from './accountCapabilities'
import { disposeGatekeeperFrame } from './disposeGatekeeperFrame'

// Проект из папки, перетащенной в беседу (решение владельца 23.09: «создать может каждый, одним
// движением»). Папка читается в браузере; человек подтверждает «Создать проект «…» из N файлов?»,
// после чего проект создаётся и файлы загружаются в него существующими методами приложения
// Mnemos: createProject у экрана управления и выдача билетов приёмной (inboxUploads) с проектом.
// Проект с кодом (есть .git или исходники) требует внутреннего репозитория — такого метода у
// приложения нет, поэтому он оформлен одной заглушкой createCodeProjectFromFolder.

export type DroppedFolder = {
  name: string
  // Файлы для загрузки: без служебного содержимого .git и системного мусора.
  files: IntakeDroppedFile[]
  hasCode: boolean
}

export type FolderProjectResult = {
  project: ChatProjectChoice
  uploaded: number
  failed: string[]
}

export class FolderProjectNotConnected extends Error {
  constructor(message: string) { super(message); this.name = 'FolderProjectNotConnected' }
}

// Папку отдаём в проект только если перетащили ровно одну папку; файлы — это обычные вложения.
// Ссылку на запись нужно взять до первого await: DataTransfer закрывается после события.
export function droppedFolderEntry(transfer: DataTransfer): FileSystemDirectoryEntry | null {
  const items = Array.from(transfer.items ?? []).filter(item => item.kind === 'file')
  if (items.length !== 1) return null
  const entry = items[0].webkitGetAsEntry?.()
  return entry?.isDirectory ? entry as FileSystemDirectoryEntry : null
}

const JUNK = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini'])
const CODE_MARKERS = new Set([
  'package.json', 'go.mod', 'Cargo.toml', 'pyproject.toml', 'requirements.txt', 'setup.py',
  'pom.xml', 'build.gradle', 'build.gradle.kts', 'composer.json', 'Gemfile', 'CMakeLists.txt',
  'Makefile', 'tsconfig.json', 'deno.json', 'mix.exs', 'Package.swift',
])
const CODE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'go', 'rs', 'java', 'kt', 'kts', 'c', 'h', 'cc',
  'cpp', 'hpp', 'cs', 'rb', 'php', 'swift', 'scala', 'sql', 'sh', 'vue', 'svelte', 'dart', 'lua',
])

// Путь без имени корневой папки: «Отчёты/2026/итог.docx» → «2026/итог.docx».
function inner(path: string): string {
  const slash = path.indexOf('/')
  return slash === -1 ? path : path.slice(slash + 1)
}

// Папка с кодом: есть .git, файл сборки в корне или заметная доля исходников.
export function looksLikeCodeFolder(paths: string[]): boolean {
  const relative = paths.map(inner)
  if (relative.some(p => p === '.git' || p.startsWith('.git/'))) return true
  if (relative.some(p => !p.includes('/') && CODE_MARKERS.has(p))) return true
  const files = relative.filter(p => !p.startsWith('.git/'))
  if (files.length === 0) return false
  const code = files.filter(p => CODE_EXTENSIONS.has(p.split('.').pop()?.toLowerCase() ?? '')).length
  return code >= 3 && code / files.length >= 0.3
}

// Что загружать: всё, кроме содержимого .git и системного мусора.
export function uploadableFiles(files: IntakeDroppedFile[]): IntakeDroppedFile[] {
  return files.filter(({ path }) => {
    const rel = inner(path)
    if (rel === '.git' || rel.startsWith('.git/')) return false
    return !JUNK.has(path.split('/').pop() ?? '')
  })
}

export async function readDroppedFolder(entry: FileSystemDirectoryEntry): Promise<DroppedFolder> {
  const all = await collectEntryFiles(entry)
  return {
    name: entry.name,
    files: uploadableFiles(all),
    hasCode: looksLikeCodeFolder(all.map(f => f.path)),
  }
}

const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k',
  л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts',
  ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
}

// Краткое имя проекта латиницей (его требует createProject): «Отчёты 2026» → «otchety-2026».
export function projectSlug(name: string): string {
  const latin = [...name.toLowerCase()].map(ch => TRANSLIT[ch] ?? ch).join('')
  const slug = latin.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/, '')
  return slug || 'proekt'
}

type Api = Pick<RpcStub<AuthenticatedApi>, 'subscribeConnectedAccounts' | 'getGatekeeperApp'>
type ProjectCreator = { createProject(name: string, slug: string): Promise<{ project: { id: string; name: string } }> }
type UploadFrame = GatekeeperUiFrame & { inboxUploads: NonNullable<GatekeeperUiFrame['inboxUploads']> }

// Экран управления Mnemos с выдачей билетов приёмной: он и создаёт проект, и принимает файлы.
async function openUploadFrame(api: Api): Promise<{ frame: UploadFrame; accountId: number }> {
  for (const account of (await listAccounts(api)).filter(a => !!a.description.providesUi)) {
    const frame = await api.getGatekeeperApp(account.vendorId, account.id)
    if (frame?.inboxUploads) return { frame: frame as UploadFrame, accountId: account.id }
    disposeGatekeeperFrame(frame)
  }
  throw new Error('Нет подключённой памяти, куда можно загрузить папку. Подключите Mnemos в настройках.')
}

// Если slug уже занят, пробуем с числом: «otchety-2026-2».
async function createWithFreeSlug(ui: ProjectCreator, name: string): Promise<{ id: string; name: string }> {
  const base = projectSlug(name)
  let lastError: unknown
  for (let attempt = 1; attempt <= 5; attempt++) {
    const slug = attempt === 1 ? base : `${base}-${attempt}`
    try {
      return (await ui.createProject(name, slug)).project
    } catch (error) {
      lastError = error
      if (!/409|conflict|exists|занят|существует/i.test(String((error as Error)?.message ?? error))) break
    }
  }
  throw new Error(`Не удалось создать проект «${name}»: ${describeError(lastError)}`)
}

function describeError(error: unknown): string {
  const text = String((error as Error)?.message ?? error ?? '')
  if (/403|forbidden|прав/i.test(text)) return 'нет права создавать проекты.'
  return 'приложение памяти не приняло запрос. Попробуйте ещё раз.'
}

export async function createProjectFromFolder(
    api: Api, folder: DroppedFolder,
    onProgress?: (done: number, total: number) => void,
    signal?: AbortSignal): Promise<FolderProjectResult> {
  const { frame, accountId } = await openUploadFrame(api)
  try {
    const project = await createWithFreeSlug(frame.ui as unknown as ProjectCreator, folder.name)
    const uploads = frame.inboxUploads
    const failed: string[] = []
    let uploaded = 0
    for (const [index, { file, path }] of folder.files.entries()) {
      signal?.throwIfAborted()
      try {
        const uploadId = await uploadIntakeFile(file, async (size, checksum) => {
          const ticket = await uploads.issuer.issue(size, checksum, project.id)
          if (new URL(ticket.url).origin !== new URL(uploads.storageOrigin).origin) {
            throw new Error('Адрес хранилища не совпадает с настройкой установки')
          }
          return ticket
        }, (url, options) => fetch(url, { ...options, signal }))
        await uploads.issuer.submit(uploadId, path, file.lastModified, project.id)
        uploaded++
      } catch {
        signal?.throwIfAborted()
        failed.push(path)
      }
      onProgress?.(index + 1, folder.files.length)
    }
    return {
      project: { accountId, projectId: project.id, title: project.name || folder.name, hasCode: false },
      uploaded, failed,
    }
  } finally {
    disposeGatekeeperFrame(frame)
  }
}

// Заглушка: у приложения Mnemos нет метода, который создаёт внутренний репозиторий проекта и
// кладёт в него папку. Нужны: создание проекта с кодом (проект + репозиторий во внутренней
// Gitea) и загрузка дерева файлов первым коммитом; см. отчёт по задаче.
export async function createCodeProjectFromFolder(_api: Api, _folder: DroppedFolder): Promise<FolderProjectResult> {
  throw new FolderProjectNotConnected(
    'Проект с кодом из папки ещё не подключён: приложение памяти пока не умеет само создавать ' +
    'внутреннее хранилище кода. Можно создать обычный проект — файлы загрузятся как документы.')
}
