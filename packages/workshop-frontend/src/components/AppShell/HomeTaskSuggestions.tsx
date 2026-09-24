import type { ChatProjectChoice } from '@gadgets/workshop-shared/api'
import { GENERIC_EXAMPLES, homeExamples, NO_PROJECT_EXAMPLES, type HomeExample } from '../../homeExamples'

// Примеры задач под полем ввода — белые «пилюли» (макет Main), ниже одна строка про папку.
// choices: null — проекты ещё загружаются (примеров нет, чтобы они не сменились под курсором),
// "failed" — общий список.
export default function HomeTaskSuggestions({ choices, onPick }: {
  choices: ChatProjectChoice[] | null | 'failed'
  onPick: (example: HomeExample) => void
}) {
  if (choices === null) return null
  const examples = choices === 'failed' ? GENERIC_EXAMPLES : homeExamples(choices)
  const empty = examples === NO_PROJECT_EXAMPLES
  return (
    <div className="flex flex-col items-center gap-10">
      <div aria-label="Примеры задач" className="flex flex-wrap justify-center gap-2.5">
        {examples.map(example => (
          <button
            key={example.label}
            type="button"
            onClick={() => onPick(example)}
            className="flex h-[38px] cursor-pointer items-center rounded-full border border-kumo-fill-hover bg-kumo-overlay px-4 text-[14px] text-kumo-default transition-colors hover:bg-kumo-tint focus-visible:outline focus-visible:outline-2 focus-visible:outline-kumo-ring"
          >
            {example.label}
          </button>
        ))}
      </div>
      <p className="m-0 text-center text-[14px] leading-5 text-kumo-subtle">
        {empty
          ? 'Проектов пока нет. Перетащите папку с файлами в окно — из неё получится проект.'
          : 'Перетащите сюда папку — из неё получится проект.'}
      </p>
    </div>
  )
}
