import type { ChatProjectChoice } from '@gadgets/workshop-shared/api'
import { GENERIC_EXAMPLES, homeExamples, NO_PROJECT_EXAMPLES, type HomeExample } from '../../homeExamples'

// Примеры задач под полем ввода. choices: null — проекты ещё загружаются (примеров нет, чтобы
// они не сменились под курсором), "failed" — общий список.
export default function HomeTaskSuggestions({ choices, onPick }: {
  choices: ChatProjectChoice[] | null | 'failed'
  onPick: (example: HomeExample) => void
}) {
  if (choices === null) return null
  const examples = choices === 'failed' ? GENERIC_EXAMPLES : homeExamples(choices)
  const empty = examples === NO_PROJECT_EXAMPLES
  return (
    <div className="flex flex-col items-center gap-2">
      {empty && (
        <p className="m-0 text-center text-[13px] leading-5 text-kumo-subtle">
          Проектов пока нет. Перетащите папку с файлами в окно — из неё получится проект.
        </p>
      )}
      <div aria-label="Примеры задач" className="flex flex-wrap justify-center gap-x-5 gap-y-2">
        {examples.map(example => (
          <button
            key={example.label}
            type="button"
            onClick={() => onPick(example)}
            className="cursor-pointer text-[13px] text-kumo-subtle transition-colors hover:text-kumo-default focus-visible:outline focus-visible:outline-2 focus-visible:outline-kumo-ring"
          >
            {example.label}
          </button>
        ))}
      </div>
    </div>
  )
}
