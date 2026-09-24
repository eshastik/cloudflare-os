import { Link } from '@tanstack/react-router'
import { Hexagon } from '@phosphor-icons/react'
import { FormatGlyph } from './components/format/FormatVisuals'
import { RpcStub } from 'capnweb'
import {
  AuthenticatedApi,
  Overseer,
  GadgetClient,
  GadgetMetadata,
  WorkpieceId,
  WorkpieceSummary,
} from '@gadgets/workshop-shared/api'
import GadgetUI from './GadgetUI'
import UserMenu from './components/UserMenu'
import { GadgetPresence } from './components/GadgetPresence'
import TopBarNotice from './TopBarNotice'
import SiteLogo from './components/SiteLogo'
import GadgetExportMenu from './GadgetExportMenu'
import { useRef } from 'react'
import type { NativeSnapshotSource } from './nativeSnapshotSource'

// The minimal, "use"-only experience: a shared top bar plus the gadget's deployed UI, and nothing
// else. Collaborators with the "use" role may only render and interact with the gadget's mainline
// UI (see UseOverseerInterface in the backend), so we deliberately omit the chat sidebar, the
// Gadget/Code/Connections controls, workspace activity, and every editor-only control. The
// overseer and gadget passed in here are the restricted capabilities returned by openGadget() for
// "use" sessions; calling anything outside getMetadata()/subscribeToMetadata()/subscribeToPresence()/
// subscribeToWorkpieces()/getGadget() (and, on the gadget, getUiBundle()/connectToGadget()/exportPdf())
// would throw.
//
// When the workspace has more than one gadget, a simple picker in the top bar switches between
// them (selection is owned by the parent, in the URL's `?w=` search param). Pending gadgets are
// never listed: the restricted overseer's workpiece subscription withholds them.
type Props = {
  overseer: RpcStub<Overseer>
  // The selected gadget's client, or null if the workspace has no gadgets.
  gadget: RpcStub<GadgetClient> | null
  selectedGadgetId: WorkpieceId | null
  gadgets: WorkpieceSummary[]
  onSelectGadget: (id: WorkpieceId) => void
  metadata: GadgetMetadata
  authenticatedApi: RpcStub<AuthenticatedApi>
  currentUserId: string | null
}

// Та же высота шапки, что у беседы в полном редакторе; гаджет — белая карточка с отступом 12.
const TOPBAR_H = 64
const CARD_GAP = 12

export default function GadgetUseView({
  overseer,
  gadget,
  selectedGadgetId,
  gadgets,
  onSelectGadget,
  metadata,
  authenticatedApi,
  currentUserId,
}: Props) {
  const nativeSnapshotSource = useRef<NativeSnapshotSource | null>(null)
  const outputId = gadgets.find(g => g.id === selectedGadgetId)?.output?.id
  return (
    <div className="flex flex-col h-full overflow-hidden bg-kumo-base relative">
      {/* ═══ TOP BAR ════════════════════════════════════════════════════════════ */}
      <div
        className="relative flex items-center justify-between px-5 sm:px-7 flex-shrink-0 gap-3"
        style={{ height: TOPBAR_H }}
      >
        <TopBarNotice />
        {/* Left: logo / title */}
        <div className="flex items-center gap-2 min-w-0">
          <Link to="/" aria-label="На главную" className="flex-shrink-0 hover:opacity-80 transition-opacity">
            <SiteLogo size={22}>
              <Hexagon size={22} className="text-kumo-brand" weight="bold" />
            </SiteLogo>
          </Link>

          <span className="text-kumo-inactive flex-shrink-0">/</span>

          <h1 className="m-0 truncate text-[16px] leading-6 font-semibold text-kumo-default">
            {metadata.title}
          </h1>

          {metadata.owner && (
            <span className="flex-shrink-0 text-[14px] leading-5 text-kumo-subtle">
              автор: {metadata.owner.name}
            </span>
          )}
        </div>

        {/* Center: gadget picker (only when there's a real choice) */}
        {gadgets.length > 1 && (
          <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
            {gadgets.map(g => (
              <button
                key={g.id}
                type="button"
                onClick={() => onSelectGadget(g.id)}
                aria-current={g.id === selectedGadgetId ? 'true' : undefined}
                className={`h-8 flex-shrink-0 cursor-pointer rounded-full px-3 text-[13px] leading-4 transition-colors duration-150 ease-out ${
                  g.id === selectedGadgetId
                    ? 'bg-kumo-overlay font-semibold text-kumo-default shadow-[0_1px_2px_rgba(24,32,28,0.12)]'
                    : 'text-kumo-subtle hover:bg-kumo-tint hover:text-kumo-default'
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <FormatGlyph output={g.output} size="sm" className="flex-shrink-0" weight="regular" />
                  <span className="block max-w-[160px] truncate">{g.title}</span>
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Right: presence and user menu */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <GadgetExportMenu
            canImport={false}
            gadget={gadget}
            gadgetTitle={gadgets.find(g => g.id === selectedGadgetId)?.title ?? 'Гаджет'}
            outputId={gadgets.find(g => g.id === selectedGadgetId)?.output?.id}
            snapshotSource={nativeSnapshotSource}
          />
          <GadgetPresence
            overseer={overseer}
            authenticatedApi={authenticatedApi}
            currentUserId={currentUserId}
          />
          <UserMenu />
        </div>
      </div>

      {/* ═══ GADGET UI ══════════════════════════════════════════════════════════ */}
      <div
        className="mx-3 mb-3 flex-1 min-h-0 overflow-hidden rounded-[20px] bg-kumo-overlay shadow-[0_1px_2px_rgba(24,32,28,0.05),0_16px_40px_rgba(24,32,28,0.08)]"
      >
        {gadget ? (
          <GadgetUI
            key={selectedGadgetId}
            gadget={gadget}
            height={`calc(100vh - ${TOPBAR_H}px - ${CARD_GAP}px)`}
            isVisible={true}
            nativeSnapshotSource={nativeSnapshotSource}
            readinessApi={authenticatedApi}
            readinessSurface={outputId === "document" ? "cloudflareos.document" : outputId === "spreadsheet" ? "cloudflareos.spreadsheet" : outputId === "presentation" ? "cloudflareos.presentation" : undefined}
          />
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center">
            <p className="text-sm text-kumo-subtle">В этой беседе пока нет гаджетов.</p>
          </div>
        )}
      </div>
    </div>
  )
}
