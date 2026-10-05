import type {WorkTemplateKind} from '@gadgets/workshop-shared/work-template'
import { createFileRoute } from '@tanstack/react-router'
import GadgetEditor from '../GadgetEditor'

type GadgetSearch = {
  templateKind?: WorkTemplateKind
  chat?: number
  // Selected workpiece (gadget) ID. Workpiece IDs start at 0, so parsing must not treat 0 as
  // absent.
  w?: number
}

function parseIntParam(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value)) return value
  if (typeof value === 'string' && value !== '') {
    const parsed = Number(value)
    if (Number.isInteger(parsed)) return parsed
  }
  return undefined
}

export const Route = createFileRoute('/workspace/$id')({
  component: GadgetEditor,
  validateSearch: (search: Record<string, unknown>): GadgetSearch => ({
    chat: typeof search.chat === 'number' ? search.chat
      : typeof search.chat === 'string' ? Number(search.chat) || undefined
      : undefined,
    w: parseIntParam(search.w),
    templateKind: ['document','guidance','agent_instructions','skill'].includes(String(search.templateKind))?search.templateKind as WorkTemplateKind:undefined,
  }),
})
