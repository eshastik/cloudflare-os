import type { ChatProjectChoice } from '@gadgets/workshop-shared/api'
import { GENERIC_EXAMPLES, homeExamples, NO_PROJECT_EXAMPLES, type HomeExample } from '../../homeExamples'

// Примеры задач под полем ввода: на компьютере — «пилюли» по центру (макет Main), на телефоне —
// строки во всю ширину поля, чтобы подписи не переносились и не упирались в края экрана.
// Ниже одна строка про папку: только там, где папку можно перетащить (на телефоне её не перетащить).
// choices: null — проекты ещё загружаются (примеров нет, чтобы они не сменились под пальцем),
// "failed" — общий список.
export default function HomeTaskSuggestions({ choices, onPick }: {
  choices: ChatProjectChoice[] | null | 'failed'
  onPick: (example: HomeExample) => void
}) {
  if (choices === null) return null
  const examples = choices === 'failed' ? GENERIC_EXAMPLES : homeExamples(choices)
  const empty = examples === NO_PROJECT_EXAMPLES
  return (
    <div className="flex flex-col items-stretch gap-8 sm:items-center sm:gap-10">
      <div aria-label="Примеры задач" className="flex flex-col overflow-hidden rounded-xl border border-kumo-line bg-kumo-overlay sm:flex-row sm:flex-wrap sm:justify-center sm:gap-2.5 sm:overflow-visible sm:rounded-none sm:border-0 sm:bg-transparent">
        {examples.map(example => (
          <button
            key={example.label}
            type="button"
            onClick={() => onPick(example)}
            className="flex min-h-12 w-full cursor-pointer items-center border-t border-kumo-line px-3 text-left first:border-t-0 text-[15px] leading-5 text-kumo-default transition-colors hover:bg-kumo-tint focus-visible:outline focus-visible:outline-2 focus-visible:outline-kumo-ring sm:h-[38px] sm:min-h-0 sm:w-auto sm:rounded-full sm:border sm:first:border sm:border-kumo-fill-hover sm:bg-kumo-overlay sm:px-4 sm:text-[14px]"
          >
            {example.label}
          </button>
        ))}
      </div>
      <p className={`m-0 px-3 text-[14px] leading-5 text-kumo-subtle sm:text-center ${empty ? '' : 'touch:hidden'}`}>
        {empty
          ? <>Проектов пока нет. <span className="touch:hidden">Перетащите папку с файлами в окно — из неё получится проект.</span><span className="hidden touch:inline">Проект создаётся на компьютере: перетащите папку с файлами в окно Mnemos.</span></>
          : 'Перетащите сюда папку — из неё получится проект.'}
      </p>
    </div>
  )
}
