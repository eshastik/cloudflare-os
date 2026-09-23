import {useCallback} from "react"
import { createFileRoute } from '@tanstack/react-router'
import { parseGatekeeperAppSection } from '../gatekeeperAppNavigation'
import GatekeeperAppPage from '../GatekeeperAppPage'
import { useDocumentTitle } from '../useDocumentTitle'
import { useGatekeeperApps } from '../useGatekeeperApps'

// Generic host for any gatekeeper-served management app (VendorDescription.providesUi). The set of
// apps and their nav entries come from the backend (useGatekeeperApps); nothing about a specific
// gatekeeper is hardcoded here. GatekeeperAppPage renders "not available" if the id isn't bound.
//
// The file is `gatekeepers_.$appId` (trailing underscore) so the URL is /gatekeepers/$appId without
// nesting inside the /gatekeepers connectors page's component.
export const Route = createFileRoute('/gatekeepers_/$appId')({
  validateSearch: (search: Record<string, unknown>): {section?:string; project?:string; view?:string; account?:number; tool?:'connections'|'summary'} => ({
    section: parseGatekeeperAppSection(search.section) || undefined,
    project: typeof search.project === "string" && search.project.length <= 255 ? search.project : undefined,
    // Вкладка внутри раздела: не входит в ключ фрейма, поэтому переключение не перезагружает приложение.
    view: typeof search.view === "string" && /^[a-z]{1,20}$/.test(search.view) ? search.view : undefined,
    account: typeof search.account === "number" && Number.isSafeInteger(search.account) && search.account >= 0 ? search.account : undefined,
    tool: search.tool === 'connections' || search.tool === 'summary' ? search.tool : undefined,
  }),
  component: GatekeeperApp,
})

function GatekeeperApp() {
  const { appId } = Route.useParams()
  const { section, project, account, tool } = Route.useSearch()
  const navigate=Route.useNavigate()
  const selectAccount=useCallback((account:number|null)=>{void navigate({search:previous=>({...previous,account:account??undefined,project:undefined})})},[navigate])
  const app = useGatekeeperApps().find((a) => a.id === appId && (account===undefined||a.accountId===account))
  useDocumentTitle(app?.sections?.find(s => s.id === section)?.title ?? app?.title ?? 'Приложение')
  return <GatekeeperAppPage appId={appId} section={section} project={project} accountId={account} tool={tool} onAccountChange={selectAccount} />
}
