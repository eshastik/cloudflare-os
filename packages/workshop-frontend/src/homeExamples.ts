import type { ChatProjectChoice } from '@gadgets/workshop-shared/api'
import { displayName, looksLikeId } from '@gadgets/workshop-shared/code-work'

// Примеры задач на стартовом экране «Над чем работаем?». Вместо общих «Подготовить документ»
// человек видит задачи по своим проектам — с названием проекта в тексте; щелчок кладёт текст в
// поле ввода и подключает проект к беседе. Проектов нет — подсказка начать с папки.

export type HomeExample = {
  label: string
  prompt: string
  // Проект, который подключается к беседе вместе с текстом примера.
  project?: ChatProjectChoice
}

export const MAX_HOME_EXAMPLES = 4

type Template = { label: (title: string) => string; prompt: (title: string) => string }

const TEMPLATES: Template[] = [
  {
    label: t => `Сводка по «${t}»`,
    prompt: t => `Собери короткую сводку по проекту «${t}»: что в нём есть, что менялось недавно и что требует внимания.`,
  },
  {
    label: t => `Найти ответ в «${t}»`,
    prompt: t => `Найди ответ в материалах проекта «${t}» и укажи документы, на которых он основан. Вопрос: `,
  },
  {
    label: t => `Документ по «${t}»`,
    prompt: t => `Подготовь черновик документа по материалам проекта «${t}». Что нужно: `,
  },
  {
    label: t => `Что нового в «${t}»`,
    prompt: t => `Что изменилось в проекте «${t}» за последнюю неделю? Перечисли главное по пунктам.`,
  },
]

const CODE_TEMPLATE: Template = {
  label: t => `Код «${t}»`,
  prompt: t => `Объясни, как устроен код проекта «${t}»: из чего он состоит и где что лежит.`,
}

// Пустое состояние: проектов ещё нет.
export const NO_PROJECT_EXAMPLES: HomeExample[] = [
  {
    label: 'Загрузите папку, чтобы начать',
    prompt: 'Я перетащу сюда папку с рабочими файлами. Создай из неё проект и кратко опиши, что в нём.',
  },
  {
    label: 'Что можно сделать здесь',
    prompt: 'Расскажи коротко, с чем ты можешь помочь в работе с документами и проектами.',
  },
]

// Общие примеры, если список проектов не загрузился.
export const GENERIC_EXAMPLES: HomeExample[] = [
  { label: 'Подготовить документ', prompt: 'Помоги подготовить рабочий документ. Уточни, какой результат мне нужен, и используй доступные материалы.' },
  { label: 'Найти ответ', prompt: 'Найди ответ по рабочим материалам. Уточни мой вопрос и укажи документы, на которых основан ответ.' },
]

export function homeExamples(choices: ChatProjectChoice[]): HomeExample[] {
  // Проекты без человеческого названия в примеры не берём: «Сводка по «3fa85f64…»» не читается.
  const projects = choices.filter(c => c.title.trim() && !looksLikeId(c.title.trim()))
  if (projects.length === 0) return NO_PROJECT_EXAMPLES

  const count = Math.min(MAX_HOME_EXAMPLES, Math.max(3, projects.length))
  const examples: HomeExample[] = []
  for (let i = 0; i < count; i++) {
    const project = projects[i % projects.length]
    const template = TEMPLATES[i % TEMPLATES.length]
    const title = displayName(project.title, 'Проект')
    examples.push({ label: template.label(title), prompt: template.prompt(title), project })
  }
  // Есть проект с кодом — последний пример про его код: так видно, что код тоже в работе.
  const code = projects.find(p => p.hasCode)
  if (code) {
    const title = displayName(code.title, 'Проект')
    examples[examples.length - 1] = { label: CODE_TEMPLATE.label(title), prompt: CODE_TEMPLATE.prompt(title), project: code }
  }
  return examples
}
