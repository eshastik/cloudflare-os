import {useState} from 'react'
import SharedTemplateLibrary from '../SharedTemplateLibrary'
import { createFileRoute } from '@tanstack/react-router'
import BlueprintList from '../components/BlueprintList'
import { useDocumentTitle } from '../useDocumentTitle'

// "Blueprints" — the user's own + saved blueprints, laid out like the Workspaces page. Discovering
// new blueprints lives on the separate Explore page, linked from the list's toolbar (alongside
// Upload, so the two actions line up) and from the rail's bottom nav.
export const Route = createFileRoute('/blueprints')({
  component: BlueprintsRoutePage,
})

function BlueprintsRoutePage() {
  useDocumentTitle('Шаблоны')
  const [shared,setShared]=useState(false)
  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col px-6 sm:px-10">
      {/* Title only — Explore and Upload sit together in the list's toolbar so they share a width. */}
      <header className="min-w-0 px-3 pb-3 pt-10">
        <h1 className="text-2xl font-semibold tracking-tight text-kumo-default">Шаблоны</h1>
        <p className="mt-1 text-[13px] leading-[18px] tracking-[-0.25px] text-kumo-subtle">
          Сохранённые приложения, на основе которых можно начать новую работу.
        </p>
      </header>
      <div className="min-h-0 flex-1">
        <div className="mb-3 flex gap-2 px-3" role="tablist" aria-label="Библиотека шаблонов">
          <button role="tab" aria-selected={!shared} onClick={()=>setShared(false)} className={`rounded-lg px-3 py-2 text-sm ${!shared?'bg-kumo-tint font-medium':'text-kumo-subtle'}`}>Мои шаблоны</button>
          <button role="tab" aria-selected={shared} onClick={()=>setShared(true)} className={`rounded-lg px-3 py-2 text-sm ${shared?'bg-kumo-tint font-medium':'text-kumo-subtle'}`}>Общие шаблоны</button>
        </div>
        {shared?<SharedTemplateLibrary/>:<BlueprintList />}
      </div>
    </div>
  )
}
