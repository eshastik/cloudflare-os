import type { RpcStub } from 'capnweb'
import type { AuthenticatedApi, ChatProjectChoice } from '@gadgets/workshop-shared/api'
import type { GatekeeperUiFrame } from '@gadgets/workshop-shared/gatekeeper'
import { uploadIntakeFile } from '../../gatekeeper-mnemos/src/intake.ts'
import { planDirectoryEntry, type IntakeDroppedFile } from './intakeDrop'
import { isPermanentUploadError, uploadInBatches } from '../../gatekeeper-mnemos/src/upload-batches.ts'
import type { SkippedGroup } from '../../gatekeeper-mnemos/src/upload-filter.ts'
import { listAccounts } from './accountCapabilities'
import { disposeGatekeeperFrame } from './disposeGatekeeperFrame'

// Проект из папки, перетащенной в беседу (решение владельца 23.09: «создать может каждый, одним
// движением»). Папка читается в браузере; человек подтверждает «Создать проект «…» из N файлов?»,
// после чего проект создаётся и файлы загружаются в него существующими методами приложения
// Mnemos: createProject у экрана управления и выдача билетов приёмной (inboxUploads) с проектом.
// Проект с кодом (есть .git или исходники) создаётся вместе с внутренним хранилищем кода:
// createCodeProjectFromFolder.

export type DroppedFolder = {
  name: string
  // Файлы для загрузки: без служебных каталогов и файлов (upload-filter.ts) и без правил .gitignore.
  files: IntakeDroppedFile[]
  hasCode: boolean
  // Что отобрано как служебное; all() отдаёт все файлы папки для «загрузить всё».
  skipped?: { files: number; more: boolean; groups: SkippedGroup[]; all(): Promise<IntakeDroppedFile[]> }
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
  const plan = await planDirectoryEntry(entry)
  const files = uploadableFiles(plan.files)
  return {
    name: entry.name,
    files,
    // Пропущенный .git тоже говорит о коде: его содержимое не читалось, но сам каталог был.
    hasCode: looksLikeCodeFolder([...plan.files.map(f => f.path), ...plan.skippedDirs]),
    ...(plan.skippedFiles ? { skipped: { files: plan.skippedFiles, more: plan.skippedMore, groups: plan.groups, all: async () => uploadableFiles(await plan.allFiles()) } } : {}),
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
    const { uploaded, failed } = await uploadIntoProject(frame, project.id, folder.files, onProgress, signal)
    return {
      project: { accountId, projectId: project.id, title: project.name || folder.name, hasCode: false },
      uploaded, failed,
    }
  } finally {
    disposeGatekeeperFrame(frame)
  }
}

// Файлы в проект пакетами, по несколько параллельно, с повтором временных ошибок (upload-batches.ts).
async function uploadIntoProject(
    frame: UploadFrame, projectId: string, files: IntakeDroppedFile[],
    onProgress?: (done: number, total: number) => void, signal?: AbortSignal): Promise<{ uploaded: number; failed: string[] }> {
  const uploads = frame.inboxUploads
  const result = await uploadInBatches({
    items: files, signal, onProgress, permanent: isPermanentUploadError,
    upload: async ({ file, path }) => {
      const uploadId = await uploadIntakeFile(file, async (size, checksum) => {
        const ticket = await uploads.issuer.issue(size, checksum, projectId)
        if (new URL(ticket.url).origin !== new URL(uploads.storageOrigin).origin) {
          throw new Error('Адрес хранилища не совпадает с настройкой установки')
        }
        return ticket
      }, (url, options) => fetch(url, { ...options, signal }))
      await uploads.issuer.submit(uploadId, path, file.lastModified, projectId)
    },
  })
  const failed = new Set(result.failed.map(({ item }) => item.path))
  return { uploaded: result.done.length, failed: files.filter(({ path }) => failed.has(path)).map(({ path }) => path) }
}

/** Повтор незагрузившихся файлов в уже созданный проект. */
export async function retryProjectUpload(
    api: Api, project: ChatProjectChoice, files: IntakeDroppedFile[],
    onProgress?: (done: number, total: number) => void, signal?: AbortSignal): Promise<{ uploaded: number; failed: string[] }> {
  const { frame } = await openUploadFrame(api)
  try {
    return await uploadIntoProject(frame, project.projectId, files, onProgress, signal)
  } finally {
    disposeGatekeeperFrame(frame)
  }
}

// Проект с кодом: проект, внутреннее хранилище кода и первая версия из файлов папки — одним
// запросом к приложению Mnemos (createCodeProject). Содержимое .git и зависимости node_modules не
// отправляются: хранилище кода само ведёт историю, зависимости ставятся заново. Пределы — те же,
// что у сервера (gitprovider.MaxSeed*): больше — предлагаем обычный проект.
export async function createCodeProjectFromFolder(
    api: Api, folder: DroppedFolder,
    onProgress?: (done: number, total: number) => void,
    signal?: AbortSignal): Promise<FolderProjectResult> {
  const MAX_FILES = 2000, MAX_FILE_BYTES = 4 * 1024 * 1024, MAX_TOTAL_BYTES = 16 * 1024 * 1024
  // node_modules обычно уже отобран при чтении папки; здесь — на случай «загрузить всё».
  const chosen = folder.files.filter(({ path }) => !inner(path).split('/').includes('node_modules'))
  const total = chosen.reduce((sum, { file }) => sum + file.size, 0)
  if (chosen.length === 0 || chosen.length > MAX_FILES || total > MAX_TOTAL_BYTES || chosen.some(({ file }) => file.size > MAX_FILE_BYTES)) {
    throw new FolderProjectNotConnected(
      `Папка «${folder.name}» слишком большая для проекта с кодом: можно до ${MAX_FILES} файлов и до 16 МБ ` +
      'вместе, каждый файл до 4 МБ. Можно создать обычный проект — файлы загрузятся как документы.')
  }
  const files: { path: string; content: Uint8Array }[] = []
  for (const [index, { file, path }] of chosen.entries()) {
    signal?.throwIfAborted()
    files.push({ path: inner(path), content: new Uint8Array(await file.arrayBuffer()) })
    onProgress?.(index + 1, chosen.length)
  }
  const { frame, accountId } = await openUploadFrame(api)
  try {
    signal?.throwIfAborted()
    type CodeCreator = { createCodeProject(name: string, slug: string, files: { path: string; content: Uint8Array }[]): Promise<{
      project: { id: string; name: string }; repository: unknown | null; repository_error?: string }> }
    // Случайный хвост вместо повторов: при занятом имени пришлось бы заново отправлять всю папку.
    const slug = `${projectSlug(folder.name)}-${crypto.randomUUID().slice(0, 4)}`
    let created: Awaited<ReturnType<CodeCreator['createCodeProject']>>
    try {
      created = await (frame.ui as unknown as CodeCreator).createCodeProject(folder.name, slug, files)
    } catch (error) {
      throw new Error(`Не удалось создать проект «${folder.name}»: ${describeError(error)}`)
    }
    const project = { accountId, projectId: created.project.id, title: created.project.name || folder.name }
    if (!created.repository) {
      // Проект уже есть: второй такой же проект повтором не создаём, причину показываем человеку.
      return { project: { ...project, hasCode: false }, uploaded: 0, failed: [created.repository_error || 'Код не сохранён в хранилище.'] }
    }
    return { project: { ...project, hasCode: true }, uploaded: files.length, failed: [] }
  } finally {
    disposeGatekeeperFrame(frame)
  }
}
