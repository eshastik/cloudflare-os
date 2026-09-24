import source from './DocumentSharePanel.tsx?raw'
import { expect, it } from 'vitest'
import { projectLine, shareCandidates, type SharePerson } from './DocumentSharePanel'

const person = (id: string, name: string, units: { id: string; name: string }[] = [], mode: '' | 'read' | 'write' = ''): SharePerson =>
  ({ id, name, mode, canRead: true, canWrite: true, units })

it('панель документа не умеет менять видимость проекта: вызова setProjectLevel в ней нет', () => {
  expect(source).not.toMatch(/setProjectLevel/)
})

it('строка о проекте называет, кто его видит, и ждущий запрос', () => {
  expect(projectLine('private', 'Mnemos', '', null)).toBe('Проект «Mnemos» видят: только автор.')
  expect(projectLine('department', 'Mnemos', 'Разработка', null)).toBe('Проект «Mnemos» видят: отдел «Разработка».')
  expect(projectLine('department', 'Mnemos', 'Разработка', 'organization')).toBe('Проект «Mnemos» видят: отдел «Разработка». Запрос открыть его всей организации ждёт решения руководителя.')
  expect(projectLine('organization', 'Mnemos', '', null)).toBe('Проект «Mnemos» видят: вся организация.')
})

it('люди по отделам из списка людей: свой отдел первым, без отдела — отдельно, недавний не повторяется', () => {
  const dev = { id: 'dev', name: 'Разработка' }, law = { id: 'law', name: 'Юристы' }
  const people = [
    person('nik', 'Николай Деревцов', [dev]), person('olga', 'Ольга Кузнецова', [law]),
    person('anna', 'Анна Смирнова', [law, dev]), person('ivan', 'Иван Петров'), person('vera', 'Вера Гостева', [law], 'read'),
  ]
  // Сотруднику сервер отдаёт только его отдел; отделы остальных приходят вместе с людьми.
  const units = [{ id: 'dev', name: 'Разработка', members: [{ id: 'me', name: 'Александр Егоров' }, { id: 'nik', name: 'Николай Деревцов' }, { id: 'anna', name: 'Анна Смирнова' }] }]
  const groups = shareCandidates(people, units, 'me', ['nik'])
  expect(groups.map(g => [g.id, g.title, g.mine, g.people.map(c => c.id)])).toEqual([
    ['recent', 'Недавние', false, ['nik']],
    ['unit:dev', 'Разработка', true, ['anna']],
    ['unit:law', 'Юристы', false, ['olga']],
    ['rest', 'Без отдела', false, ['ivan']],
  ])
  const all = groups.flatMap(g => g.people.map(c => c.id))
  expect(new Set(all).size).toBe(all.length)
  expect(groups[0]!.people[0]!.unit).toBe('Разработка')
})

it('без сведений об отделах все — «Коллеги» и группа раскрыта', () => {
  const groups = shareCandidates([person('a', 'А Б'), person('b', 'В Г')], [], 'me', [])
  expect(groups.map(g => [g.id, g.title, g.mine])).toEqual([['rest', 'Коллеги', true]])
})
