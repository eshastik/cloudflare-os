import type { BlueprintOutput } from '@gadgets/workshop-shared/api'
import { formatOf } from './components/format/formats'

export type RightTab = 'app' | 'code' | 'connections'

// The first tab is named after what the selected workpiece is ("Document" for a gadget built from
// a document blueprint), falling back to "App" when it declares no format.
// У приложения из проекта Mnemos вкладки «Код» нет: код платформа не показывает никому (ADR 0028, п. 4).
export function rightTabs(output?: BlueprintOutput, appBound = false): { value: RightTab; label: string }[] {
  return [
    { value: 'app', label: formatOf(output).noun },
    ...(appBound ? [] : [{ value: 'code' as const, label: 'Код' }]),
    { value: 'connections', label: 'Подключения' },
  ]
}
