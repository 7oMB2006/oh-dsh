import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react'
import { defineStore } from '@deepseek-ai/dsh-client-runtime/client'
import { createRoot, type Root } from 'react-dom/client'
import type { DesktopBridge } from '../../../../src/contracts.ts'
import type { DesktopPanels } from '../../../panel-controls/src/client.ts'
import type { PinnedSummary } from '../../../pinned-summary/src/client.ts'
import type {
  WorkspaceFacts,
  WorkspaceHostMutationResponse,
  WorkspaceMutation,
  WorkspaceSnapshot,
} from '../protocol.ts'
import { WORKSPACE_API_PATH } from '../protocol.ts'
import {
  DEFAULT_SIDEBAR_PREFERENCES,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
} from '../sidebar-preferences.ts'
import {
  BrowserView,
  FilesView,
  FileView,
  SideToolsPanel,
  ToolIcon,
} from './SideToolsPanel.tsx'
import sideToolsCss from './side-tools.css'
import workspaceCss from './sidebar.css'
import type { LocaleService, Translate } from '../../../shared/i18n.ts'
import { useTranslate } from '../../../shared/use-i18n.ts'
import { WORKSPACE_MESSAGES, type WorkspaceMessage } from './i18n.ts'
import {
  DesktopSidebarService,
  type DesktopSidebar,
  type DesktopSidebarSnapshot,
} from './sidebar-service.ts'
import { HttpSidebarPreferencesStorage } from './sidebar-storage.ts'
import {
  betterSidebarApi,
  type BetterSidebarGitLogEntry,
  type BetterSidebarScope,
  workspaceChangesFromBetterSidebar,
} from './better-sidebar-api.ts'
import {
  nextReviewCommentId,
  ReviewCommentsService,
  type ReviewCommentSide,
  type ReviewSessionsService,
  type ReviewInputTriggersService,
} from './review-comments.ts'
import { reviewCommitFromBetterSidebar } from './review-diff.ts'
import type { GitReviewCommit } from './review-types.ts'
import {
  SidebarRuntimeSettingsService,
  type SidebarRuntimePreferences,
} from './runtime-settings.ts'

interface ObservableSnapshot<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

interface SessionSummary {
  blank?: boolean
  cwd?: string
}

interface SessionListState {
  current?: string
  byId: Record<string, SessionSummary>
}

interface RunningToolCall {
  callId: string
  name: string
  argsRaw: string
  subCalls?: readonly RunningToolCall[]
}

interface ConversationSnapshot {
  runningCalls?: readonly RunningToolCall[]
}

interface SessionBinding {
  session: ObservableSnapshot<ConversationSnapshot>
}

interface SessionsService extends ReviewSessionsService {
  list: ObservableSnapshot<SessionListState>
  binding(id: string): SessionBinding | undefined
  fork(options: { sessionId: string; increaseTitle?: boolean }): Promise<string>
  open(id: string): void
}

interface WorkspaceView {
  workspaceId: string
}

interface WorkspacesService {
  create(input: { path: string }): Promise<WorkspaceView>
  openPath(path: string): Promise<void>
  startSession(workspaceId?: string): void
}

interface ClientContext {
  effect(effect: () => (() => void) | void, label?: string): void
  get(name: string): unknown
  reflect: {
    provide(name: string, value: unknown, options?: unknown): (() => Promise<void> | void) | void
  }
}

interface SidebarSettingsState {
  openByDefault: boolean
  revision: number
  tabsEnabled: Record<string, boolean>
  viewersEnabled: Record<string, boolean>
  width: number
}

interface BoundSidebarSettingsActions {
  sync(
    openByDefault: boolean,
    revision: number,
    tabsEnabled: Record<string, boolean>,
    viewersEnabled: Record<string, boolean>,
    width: number,
  ): void
}

interface SidebarSettingsProps {
  reset(): void
  setOpenByDefault(open: boolean): void
  setTabEnabled(id: string, enabled: boolean): void
  setViewerEnabled(id: string, enabled: boolean): void
  setWidth(width: number): void
  runtime: SidebarRuntimeSettingsService
  sidebar: DesktopSidebar
  t: Translate<WorkspaceMessage>
  useStore<T>(selector: (state: SidebarSettingsState) => T): T
}

interface SlotsService {
  inject(name: string, register: () => unknown): void
  register(options: {
    id: string
    inject(actions: BoundSidebarSettingsActions): Omit<
      SidebarSettingsProps,
      't' | 'useStore'
    >
    locale: string
    label: () => string
    name: string
    order: number
    store: unknown
  }, component: (props: SidebarSettingsProps) => JSX.Element): unknown
}

interface WorkspaceToolsState {
  maximized: boolean
  open: boolean
  view: string
  width: number
}

export interface WorkspaceTools {
  getSnapshot(): WorkspaceToolsState
  subscribe(listener: () => void): () => void
  isOpen(): boolean
  openBrowser(): void
  openBrowserUrl(url: string): void
  openFile(path: string): void
  openFiles(): void
  openMenu(): void
  openReview(): void
  openSideChat(): Promise<void>
  openTrajectory(): void
  setOpen(open: boolean): void
  toggle(): void
  togglePanelMaximized(): void
  toggleSidePanel(): void
}

declare global {
  interface Window {
    dshDesktop?: DesktopBridge
  }
}

export const inject = [
  'desktopPanels',
  'locale',
  'pinnedSummary',
  'sessions',
  'inputTriggers',
  'slots',
  'workspaces',
]

const EMPTY_CONVERSATION: ConversationSnapshot = { runningCalls: [] }

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function responseJson<T>(
  response: Response,
  t: Translate<WorkspaceMessage>,
): Promise<T> {
  const payload = await response.json() as T & { error?: string }
  if (!response.ok) {
    throw new Error(payload.error ?? t('workspace.request-failed', {
      status: response.status,
    }))
  }
  return payload
}

function workspaceUrl(cwd: string): string {
  const url = new URL(WORKSPACE_API_PATH, window.location.origin)
  url.searchParams.set('cwd', cwd)
  return url.href
}

function statusLabel(status: WorkspaceSnapshot['changes'][number]['status']): string {
  return {
    added: 'A',
    modified: 'M',
    deleted: 'D',
    renamed: 'R',
    copied: 'C',
    untracked: 'U',
    conflicted: '!',
  }[status]
}

type ReviewCommentTarget = {
  kind: 'commit'
} | {
  kind: 'line'
  filePath: string
  line: number
  side: Exclude<ReviewCommentSide, null>
}

function reviewLineNumber(
  oldLine: number | null,
  newLine: number | null,
): number | null {
  return newLine ?? oldLine
}

function processTitle(call: RunningToolCall): string {
  try {
    const args = JSON.parse(call.argsRaw) as Record<string, unknown>
    const value = args.command ?? args.cmd ?? args.script ?? args.description
    if (Array.isArray(value)) return value.map(String).join(' ')
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  } catch {
    // Fall back to the raw tool name for non-JSON arguments.
  }
  return call.name
}

function flattenRunningCalls(calls: readonly RunningToolCall[]): RunningToolCall[] {
  const result: RunningToolCall[] = []
  for (const call of calls) {
    result.push(call)
    result.push(...flattenRunningCalls(call.subCalls ?? []))
  }
  return result
}

class WorkspaceToolsService implements WorkspaceTools {
  private state: WorkspaceToolsState
  private readonly listeners = new Set<() => void>()
  private style: HTMLStyleElement | undefined
  private element: HTMLDivElement | undefined
  private layout: HTMLDivElement | undefined
  private appRoot: HTMLElement | undefined
  private root: Root | undefined
  private stopSidebar: (() => void) | undefined
  private readonly narrowViewport = window.matchMedia('(max-width: 900px)')
  private readonly handleViewportChange = (): void => { this.applyLayout() }
  private readonly handleShortcut = (event: KeyboardEvent): void => {
    const key = event.key.toLowerCase()
    const primary = event.metaKey || event.ctrlKey
    if (event.key === 'Escape' && this.state.maximized) {
      event.preventDefault()
      this.togglePanelMaximized()
    } else if (event.ctrlKey && event.shiftKey && key === 'g') {
      event.preventDefault()
      this.openReview()
    } else if (primary && !event.altKey && key === 't') {
      event.preventDefault()
      this.openBrowser()
    } else if (primary && !event.altKey && key === 'p') {
      event.preventDefault()
      this.openFiles()
    } else if (primary && event.altKey && key === 's') {
      event.preventDefault()
      void this.openSideChat()
    } else if (primary && event.altKey && key === 'b') {
      event.preventDefault()
      this.toggleSidePanel()
    }
  }

  constructor(
    private readonly sidebar: DesktopSidebar,
    private readonly panels: DesktopPanels,
    private readonly locale: LocaleService,
    private readonly t: Translate<WorkspaceMessage>,
    private readonly pinnedSummary: PinnedSummary,
    private readonly sessions: SessionsService,
    private readonly workspaces: WorkspacesService,
  ) {
    this.state = this.project(sidebar.getSnapshot())
  }

  getSnapshot = (): WorkspaceToolsState => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  isOpen(): boolean { return this.state.open }

  setOpen(open: boolean): void {
    if (open) this.pinnedSummary.setOpen(false)
    this.sidebar.setOpen(open)
    if (!open) delete document.documentElement.dataset.ohDshPanelMaximized
  }

  toggle(): void {
    if (this.state.open && this.state.view === 'review') this.setOpen(false)
    else this.openReview()
  }

  openReview(): void { this.openView('review') }

  openBrowser(): void { this.openView('browser') }

  openBrowserUrl(url: string): void {
    let title = url
    try { title = new URL(url).hostname || url } catch {}
    this.pinnedSummary.setOpen(false)
    this.sidebar.openTab({ resource: url, title, type: 'browser' })
    this.sidebar.setOpen(true)
  }

  openFile(path: string): void {
    const title = path.split(/[\\/]/).filter(Boolean).pop() ?? path
    this.pinnedSummary.setOpen(false)
    this.sidebar.openTab({ resource: path, title, type: 'file' })
    this.sidebar.setOpen(true)
  }

  openFiles(): void {
    const list = this.sessions.list.getSnapshot()
    const cwd = list.current === undefined ? undefined : list.byId[list.current]?.cwd
    if (cwd === undefined) return
    this.openView('files', cwd)
  }

  openMenu(): void {
    this.pinnedSummary.setOpen(false)
    this.sidebar.activateTab(null)
    this.sidebar.setOpen(true)
  }

  toggleSidePanel(): void {
    if (this.state.open) this.setOpen(false)
    else this.openMenu()
  }

  async openSideChat(): Promise<void> {
    const current = this.sessions.list.getSnapshot().current
    if (current === undefined) this.workspaces.startSession()
    else {
      const child = await this.sessions.fork({ sessionId: current, increaseTitle: true })
      this.sessions.open(child)
    }
    this.setOpen(false)
  }

  openTrajectory(): void {
    const translated = this.t('trajectory').toLowerCase()
    const tab = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
      .find(element => {
        const label = element.textContent?.trim().toLowerCase()
        return label === translated || label === 'trajectory' || label === '轨迹'
      })
    if (tab === undefined) return
    tab.click()
    this.setOpen(false)
  }

  togglePanelMaximized(): void {
    if (!this.state.open) return
    const maximized = !this.state.maximized
    this.sidebar.setMaximized(maximized)
    if (maximized) document.documentElement.dataset.ohDshPanelMaximized = 'true'
    else delete document.documentElement.dataset.ohDshPanelMaximized
  }

  setWidth(width: number): void {
    this.sidebar.setWidth(width)
  }

  mount(): void {
    if (this.state.open) this.pinnedSummary.setOpen(false)
    this.stopSidebar = this.sidebar.subscribe(() => { this.syncSidebar() })
    this.style = document.createElement('style')
    this.style.dataset.ohDshDesktopSidebarStyles = 'true'
    this.style.textContent = `${workspaceCss}\n${sideToolsCss}`
    document.head.append(this.style)
    this.element = document.createElement('div')
    this.element.id = 'oh-dsh-sidebar-root'
    const appRoot = document.getElementById('root')
    if (appRoot === null) throw new Error('sidebar: app root is unavailable')
    const layout = document.createElement('div')
    layout.id = 'oh-dsh-embedded-layout'
    appRoot.before(layout)
    layout.append(appRoot, this.element)
    this.appRoot = appRoot
    this.layout = layout
    this.root = createRoot(this.element)
    this.root.render(
      <WorkspaceToolsSurface
        locale={this.locale}
        t={this.t}
        service={this}
        panels={this.panels}
        pinnedSummary={this.pinnedSummary}
        sessions={this.sessions}
        workspaces={this.workspaces}
        sidebar={this.sidebar}
      />,
    )
    this.narrowViewport.addEventListener('change', this.handleViewportChange)
    window.addEventListener('keydown', this.handleShortcut, true)
    this.applyLayout()
  }

  dispose(): void {
    this.stopSidebar?.()
    window.removeEventListener('keydown', this.handleShortcut, true)
    this.narrowViewport.removeEventListener('change', this.handleViewportChange)
    this.root?.unmount()
    this.element?.remove()
    if (this.layout !== undefined && this.appRoot !== undefined) {
      this.layout.before(this.appRoot)
      this.layout.remove()
    }
    this.style?.remove()
    delete document.documentElement.dataset.ohDshDesktopSidebarOpen
    delete document.documentElement.dataset.ohDshPanelMaximized
    document.documentElement.style.removeProperty('--oh-dsh-sidebar-width')
    if (document.documentElement.dataset.ohDshRightPanelOwner === 'sidebar') {
      delete document.documentElement.dataset.ohDshRightPanelOwner
      document.getElementById('root')?.style.removeProperty('padding-right')
    }
  }

  private publish(next: WorkspaceToolsState): void {
    this.state = next
    for (const listener of this.listeners) listener()
  }

  private openView(view: string, resource?: string): void {
    this.pinnedSummary.setOpen(false)
    this.sidebar.openTab({
      type: view,
      ...(resource !== undefined ? { resource } : {}),
    })
    this.sidebar.setOpen(true)
  }

  private project(snapshot: DesktopSidebarSnapshot): WorkspaceToolsState {
    const active = snapshot.tabs.find(tab => tab.id === snapshot.activeId)
    return {
      maximized: snapshot.maximized,
      open: snapshot.open,
      view: active?.type ?? 'menu',
      width: snapshot.width,
    }
  }

  private syncSidebar(): void {
    const next = this.project(this.sidebar.getSnapshot())
    if (next.open) this.pinnedSummary.setOpen(false)
    this.publish(next)
    if (next.maximized) {
      document.documentElement.dataset.ohDshPanelMaximized = 'true'
    } else {
      delete document.documentElement.dataset.ohDshPanelMaximized
    }
    this.applyLayout()
  }

  private applyLayout(): void {
    document.documentElement.style.setProperty('--oh-dsh-sidebar-width', `${String(this.state.width)}px`)
    const html = document.documentElement
    const appRoot = document.getElementById('root')
    if (this.state.open) {
      html.dataset.ohDshDesktopSidebarOpen = 'true'
      html.dataset.ohDshRightPanelOwner = 'sidebar'
      appRoot?.style.removeProperty('padding-right')
    } else {
      delete html.dataset.ohDshDesktopSidebarOpen
      if (html.dataset.ohDshRightPanelOwner === 'sidebar') {
        delete html.dataset.ohDshRightPanelOwner
        appRoot?.style.removeProperty('padding-right')
      }
    }
    if (this.layout !== undefined) {
      if (this.state.open && this.state.maximized) {
        this.layout.style.gridTemplateColumns = '0 minmax(0, 1fr)'
      } else {
        const track = this.state.open && !this.narrowViewport.matches ? this.state.width : 0
        this.layout.style.gridTemplateColumns = `minmax(0, 1fr) ${String(track)}px`
      }
    }
  }
}

function PanelIcon({ kind }: { kind: 'expand' | 'summary' | 'terminal' | 'side' }): JSX.Element {
  if (kind === 'expand') return <svg viewBox="0 0 20 20"><path d="M7 3H3v4M13 3h4v4M17 13v4h-4M7 17H3v-4" /></svg>
  if (kind === 'summary') {
    return <svg viewBox="0 0 20 20"><circle cx="5" cy="5" r="1.5" /><path d="M9 5h7M4 10h12" /><circle cx="15" cy="15" r="1.5" /><path d="M4 15h7" /></svg>
  }
  if (kind === 'terminal') {
    return <svg viewBox="0 0 20 20"><rect x="3" y="3" width="14" height="14" rx="2.5" /><path d="M3.5 13.5h13" /></svg>
  }
  return <svg viewBox="0 0 20 20"><rect x="3" y="3" width="14" height="14" rx="2.5" /><path d="M12.5 3.5v13" /></svg>
}

function DesktopPanelToolbar({
  service,
  panels,
  pinnedSummary,
  t,
}: {
  service: WorkspaceToolsService
  panels: DesktopPanels
  pinnedSummary: PinnedSummary
  t: Translate<WorkspaceMessage>
}): JSX.Element {
  const workspaceState = useSyncExternalStore(service.subscribe, service.getSnapshot)
  const terminalOpen = useSyncExternalStore(panels.subscribe, () => panels.isBottomPanelOpen())
  const summaryOpen = useSyncExternalStore(pinnedSummary.subscribe, () => pinnedSummary.isOpen())
  const sideOpen = workspaceState.open
  return (
    <nav className="oh-dsh-panel-toolbar" aria-label={t('panels.label')}>
      {sideOpen
        ? (
          <button
            type="button"
            aria-label={t('side.expand')}
            aria-pressed={workspaceState.maximized}
            title={workspaceState.maximized ? t('side.restore') : t('side.expand')}
            onClick={() => { service.togglePanelMaximized() }}
          ><PanelIcon kind="expand" /></button>
        )
        : (
          <button
            type="button"
            aria-label={t('summary.toggle')}
            aria-pressed={summaryOpen}
            title={t('summary.title')}
            onClick={() => { service.setOpen(false); pinnedSummary.toggle() }}
          ><PanelIcon kind="summary" /></button>
        )}
      <button
        type="button"
        aria-label={t('terminal.toggle')}
        aria-pressed={terminalOpen}
        title={`${t('terminal.title')} (⌘J)`}
        onClick={() => { panels.toggleBottomPanel() }}
      ><PanelIcon kind="terminal" /></button>
      <button
        type="button"
        aria-label={t('side.toggle')}
        aria-pressed={sideOpen}
        title={`${t('side.title')} (⌥⌘B)`}
        onClick={() => { service.toggleSidePanel() }}
      ><PanelIcon kind="side" /></button>
    </nav>
  )
}

function useActiveConversation(sessions: SessionsService, sessionId: string | undefined): ConversationSnapshot {
  const binding = sessionId === undefined ? undefined : sessions.binding(sessionId)
  const subscribe = useCallback(
    (listener: () => void) => binding?.session.subscribe(listener) ?? (() => {}),
    [binding],
  )
  const getSnapshot = useCallback(
    () => binding?.session.getSnapshot() ?? EMPTY_CONVERSATION,
    [binding],
  )
  return useSyncExternalStore(
    subscribe,
    getSnapshot,
  )
}

function WorkspacePanel({
  reviewComments,
  service,
  sessions,
  workspaces,
  t,
}: {
  reviewComments: ReviewCommentsService
  service: WorkspaceToolsService
  sessions: SessionsService
  workspaces: WorkspacesService
  t: Translate<WorkspaceMessage>
}): JSX.Element {
  const panelState = useSyncExternalStore(service.subscribe, service.getSnapshot)
  const sessionList = useSyncExternalStore(sessions.list.subscribe, sessions.list.getSnapshot)
  const sessionId = sessionList.current
  const cwd = sessionId === undefined ? undefined : sessionList.byId[sessionId]?.cwd
  const conversation = useActiveConversation(sessions, sessionId)
  const processes = useMemo(
    () => flattenRunningCalls(conversation.runningCalls ?? []),
    [conversation.runningCalls],
  )
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [diff, setDiff] = useState('')
  const [commitOpen, setCommitOpen] = useState(false)
  const [commitMessage, setCommitMessage] = useState('')
  const [newBranch, setNewBranch] = useState('')
  const [history, setHistory] = useState<BetterSidebarGitLogEntry[]>([])
  const [selectedCommit, setSelectedCommit] = useState<GitReviewCommit | null>(null)
  const [reviewLoading, setReviewLoading] = useState(false)
  const [commentTarget, setCommentTarget] = useState<ReviewCommentTarget | null>(null)
  const [commentBody, setCommentBody] = useState('')
  const [commentNotice, setCommentNotice] = useState('')
  const comments = useSyncExternalStore(
    reviewComments.subscribe,
    reviewComments.getSnapshot,
  )
  const visibleChanges = snapshot?.changes.slice(0, 200) ?? []
  const scope = useMemo<BetterSidebarScope | undefined>(
    () => sessionId === undefined || cwd === undefined
      ? undefined
      : { sessionId, cwd },
    [cwd, sessionId],
  )
  const branch = snapshot?.branch ?? null
  const selectedComments = useMemo(() => comments.filter(comment =>
    selectedCommit !== null
    && comment.commitId === selectedCommit.id
    && comment.sessionId === (sessionId ?? null)
    && comment.workspacePath === cwd
    && comment.branch === branch), [
    branch,
    comments,
    cwd,
    selectedCommit,
    sessionId,
  ])

  const refresh = useCallback(async (): Promise<void> => {
    if (cwd === undefined || sessionId === undefined) {
      setSnapshot(null)
      return
    }
    try {
      const nextScope = { sessionId, cwd }
      const [facts, status] = await Promise.all([
        responseJson<WorkspaceFacts>(await fetch(workspaceUrl(cwd)), t),
        betterSidebarApi.gitStatus(nextScope),
      ])
      if (!status.isRepo) {
        setHistory([])
        setSelectedCommit(null)
        setSnapshot({
          ...facts,
          kind: 'directory',
          branch: null,
          branches: [],
          changes: [],
        })
      } else {
        const [nextBranch, nextHistory] = await Promise.all([
          betterSidebarApi.gitBranch(nextScope),
          betterSidebarApi.gitLog(nextScope).catch(() => []),
        ])
        setHistory(nextHistory)
        setSnapshot({
          ...facts,
          kind: 'repository',
          branch: status.branch ?? nextBranch.current,
          branches: nextBranch.names,
          changes: workspaceChangesFromBetterSidebar(status.entries),
        })
      }
      setError('')
    } catch (nextError) {
      setError(errorMessage(nextError))
    }
  }, [cwd, sessionId, t])

  useEffect(() => {
    if (!panelState.open || panelState.view !== 'review' || cwd === undefined) return
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, 4_000)
    const onFocus = (): void => { void refresh() }
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [cwd, panelState.open, panelState.view, refresh])

  useEffect(() => {
    setSelectedPath(null)
    setDiff('')
    setHistory([])
    setSelectedCommit(null)
    setCommentTarget(null)
    setCommentBody('')
    setCommentNotice('')
  }, [cwd])

  useEffect(() => {
    if (cwd === undefined || branch === null) return
    reviewComments.activate(sessionId ?? null, cwd, branch)
  }, [branch, cwd, reviewComments, sessionId])

  const mutate = async (mutation: WorkspaceMutation): Promise<void> => {
    if (cwd === undefined || scope === undefined || busy) return
    setBusy(true)
    try {
      if (mutation.action === 'checkout') {
        await betterSidebarApi.gitCheckout(scope, mutation.branch)
      } else if (mutation.action === 'commit') {
        await betterSidebarApi.gitStage(scope)
        await betterSidebarApi.gitCommit(scope, mutation.message)
        setCommitMessage('')
      } else {
        const response = await fetch(workspaceUrl(cwd), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(mutation),
        })
        await responseJson<WorkspaceHostMutationResponse>(response, t)
      }
      await refresh()
      setError('')
    } catch (nextError) {
      setError(errorMessage(nextError))
    } finally {
      setBusy(false)
    }
  }

  const showDiff = async (
    change: WorkspaceSnapshot['changes'][number],
  ): Promise<void> => {
    if (scope === undefined) return
    if (selectedPath === change.path) {
      setSelectedPath(null)
      setDiff('')
      return
    }
    setSelectedPath(change.path)
    setDiff(t('workspace.loading-diff'))
    try {
      const response = await betterSidebarApi.gitDiff(
        scope,
        change.path,
        change.staged,
      )
      setDiff(response.diff || t('workspace.no-text-diff'))
    } catch (nextError) {
      setDiff(errorMessage(nextError))
    }
  }

  const showCommit = async (entry: BetterSidebarGitLogEntry): Promise<void> => {
    if (scope === undefined || reviewLoading) return
    if (selectedCommit?.id === entry.hashFull) {
      setSelectedCommit(null)
      setCommentTarget(null)
      return
    }
    setReviewLoading(true)
    setCommentTarget(null)
    setCommentBody('')
    setCommentNotice('')
    try {
      const result = await betterSidebarApi.gitCommitDiff(
        scope,
        entry.hashFull,
      )
      setSelectedCommit(reviewCommitFromBetterSidebar(entry, result.diff))
      setError('')
    } catch (nextError) {
      setError(errorMessage(nextError))
    } finally {
      setReviewLoading(false)
    }
  }

  const addReviewComment = (): void => {
    if (selectedCommit === null || cwd === undefined || branch === null
      || commentTarget === null || commentBody.trim() === '') return
    const lineTarget = commentTarget.kind === 'line' ? commentTarget : null
    const result = reviewComments.add(selectedCommit, {
      id: nextReviewCommentId(),
      sessionId: sessionId ?? null,
      workspacePath: cwd,
      branch,
      commitId: selectedCommit.id,
      filePath: lineTarget?.filePath ?? null,
      line: lineTarget?.line ?? null,
      side: lineTarget?.side ?? null,
      body: commentBody.trim(),
      createdAt: new Date().toISOString(),
    })
    setCommentBody('')
    setCommentTarget(null)
    setCommentNotice(result === 'inserted'
      ? t('workspace.comment-added')
      : t('workspace.comment-saved'))
  }

  const chooseWorkspace = async (): Promise<void> => {
    if (window.dshDesktop?.chooseWorkspace === undefined) return
    const paths = await window.dshDesktop?.chooseWorkspace() ?? []
    for (const path of paths) {
      const workspace = await workspaces.create({ path })
      workspaces.startSession(workspace.workspaceId)
    }
  }

  return (
    <div className="oh-dsh-review-view" aria-label={t('workspace.changes')}>
      <header className="oh-dsh-workspace-header">
        <div>
          <button type="button" aria-label={t('side.back')} onClick={() => { service.openMenu() }}>‹</button>
          <strong>{snapshot?.name ?? (cwd?.split(/[\\/]/).filter(Boolean).pop() || t('workspace.title'))}</strong>
        </div>
        <div>
          <button type="button" onClick={() => { void refresh() }} aria-label={t('workspace.refresh')} title={t('workspace.refresh')}>↻</button>
          {window.dshDesktop?.chooseWorkspace !== undefined && (
            <button type="button" onClick={() => { void chooseWorkspace() }} aria-label={t('workspace.add')} title={t('workspace.add')}>+</button>
          )}
          <button type="button" onClick={() => { service.setOpen(false) }} aria-label={t('workspace.close-review')} title={t('workspace.close-review')}>×</button>
        </div>
      </header>

      {cwd === undefined
        ? <div className="oh-dsh-workspace-empty">{t('workspace.select')}</div>
        : (
          <div className="oh-dsh-workspace-content">
            {error !== '' && <div className="oh-dsh-workspace-error" role="alert">{error}</div>}
            <section>
              <div className="oh-dsh-workspace-section-title">
                <span className="oh-dsh-workspace-section-icon">▣</span>
                <strong>{t('workspace.changes')}</strong>
                <span className="oh-dsh-workspace-count">{snapshot?.changes.length ?? 0}</span>
              </div>
              <div className="oh-dsh-change-list">
                {visibleChanges.map(change => (
                  <div key={`${change.path}:${change.oldPath ?? ''}`}>
                    <button
                      type="button"
                      className="oh-dsh-change-row"
                      data-selected={selectedPath === change.path || undefined}
                      onClick={() => { void showDiff(change) }}
                    >
                      <span className={`oh-dsh-change-status is-${change.status}`}>{statusLabel(change.status)}</span>
                      <span title={change.path}>{change.path}</span>
                      {change.staged && <small>{t('workspace.staged')}</small>}
                    </button>
                    {selectedPath === change.path && <pre className="oh-dsh-change-diff">{diff}</pre>}
                  </div>
                ))}
                {(snapshot?.changes.length ?? 0) > visibleChanges.length && (
                  <div className="oh-dsh-workspace-muted">
                    {t('workspace.more-changes', {
                      count: (snapshot?.changes.length ?? 0) - visibleChanges.length,
                    })}
                  </div>
                )}
                {snapshot?.kind === 'repository' && snapshot.changes.length === 0 && (
                  <div className="oh-dsh-workspace-muted">{t('workspace.clean')}</div>
                )}
                {snapshot?.kind === 'directory' && (
                  <div className="oh-dsh-workspace-muted">{t('workspace.not-git')}</div>
                )}
              </div>
            </section>

            {snapshot?.kind === 'repository' && (
              <section className="oh-dsh-review-history">
                <div className="oh-dsh-workspace-section-title">
                  <span className="oh-dsh-workspace-section-icon">◷</span>
                  <strong>{t('workspace.review-history')}</strong>
                  <span className="oh-dsh-workspace-count">{history.length}</span>
                </div>
                <div className="oh-dsh-review-commit-list">
                  {history.map(entry => (
                    <button
                      type="button"
                      key={entry.hashFull}
                      className="oh-dsh-review-commit-row"
                      data-selected={selectedCommit?.id === entry.hashFull || undefined}
                      disabled={reviewLoading}
                      onClick={() => { void showCommit(entry) }}
                    >
                      <code>{entry.hash}</code>
                      <span title={entry.subject}>{entry.subject}</span>
                      <small>{entry.author}</small>
                    </button>
                  ))}
                  {history.length === 0 && (
                    <div className="oh-dsh-workspace-muted">
                      {t('workspace.no-commits')}
                    </div>
                  )}
                </div>

                {selectedCommit !== null && (
                  <div className="oh-dsh-review-commit-detail">
                    <header>
                      <div>
                        <code>{selectedCommit.shortId}</code>
                        <strong>{selectedCommit.subject}</strong>
                        <small>
                          {selectedCommit.author} · {selectedCommit.authoredAt}
                        </small>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setCommentTarget({ kind: 'commit' })
                          setCommentNotice('')
                        }}
                      >{t('workspace.comment-commit')}</button>
                    </header>

                    {selectedComments.length > 0 && (
                      <div className="oh-dsh-review-comments">
                        <strong>{t('workspace.pending-comments')}</strong>
                        {selectedComments.map(comment => (
                          <div key={comment.id}>
                            <span>
                              {comment.filePath === null
                                ? t('workspace.review-commit')
                                : `${comment.filePath}:${String(comment.line)}`}
                            </span>
                            <p>{comment.body}</p>
                            <button
                              type="button"
                              aria-label={t('workspace.remove-comment')}
                              title={t('workspace.remove-comment')}
                              onClick={() => { reviewComments.remove(comment.id) }}
                            >×</button>
                          </div>
                        ))}
                      </div>
                    )}

                    {selectedCommit.files.map(file => (
                      <details key={`${file.oldPath ?? ''}:${file.path}`} open>
                        <summary>
                          <span title={file.path}>{file.path}</span>
                          <small>
                            <b>+{file.additions}</b> −{file.deletions}
                          </small>
                        </summary>
                        <div className="oh-dsh-review-diff-lines">
                          {file.lines.slice(0, 400).map(line => {
                            const lineNumber = reviewLineNumber(
                              line.oldLine,
                              line.newLine,
                            )
                            return (
                              <button
                                type="button"
                                key={line.key}
                                data-type={line.type}
                                disabled={lineNumber === null}
                                title={t('workspace.comment-line')}
                                onClick={() => {
                                  if (lineNumber === null) return
                                  setCommentTarget({
                                    kind: 'line',
                                    filePath: file.path,
                                    line: lineNumber,
                                    side: line.type === 'deletion' ? 'old' : 'new',
                                  })
                                  setCommentNotice('')
                                }}
                              >
                                <span>{line.oldLine ?? ''}</span>
                                <span>{line.newLine ?? ''}</span>
                                <code>{line.content || ' '}</code>
                              </button>
                            )
                          })}
                          {file.lines.length > 400 && (
                            <div className="oh-dsh-workspace-muted">
                              {t('workspace.diff-truncated', {
                                count: file.lines.length - 400,
                              })}
                            </div>
                          )}
                        </div>
                      </details>
                    ))}

                    {commentTarget !== null && (
                      <div className="oh-dsh-review-comment-form">
                        <strong>
                          {commentTarget.kind === 'commit'
                            ? t('workspace.comment-commit')
                            : `${commentTarget.filePath}:${String(commentTarget.line)}`}
                        </strong>
                        <textarea
                          autoFocus
                          value={commentBody}
                          placeholder={t('workspace.comment-placeholder')}
                          onChange={event => { setCommentBody(event.currentTarget.value) }}
                        />
                        <div>
                          <button
                            type="button"
                            onClick={() => {
                              setCommentTarget(null)
                              setCommentBody('')
                            }}
                          >{t('workspace.cancel')}</button>
                          <button
                            type="button"
                            disabled={commentBody.trim() === ''}
                            onClick={addReviewComment}
                          >{t('workspace.add-comment')}</button>
                        </div>
                      </div>
                    )}
                    {commentNotice !== '' && (
                      <p className="oh-dsh-review-comment-notice">
                        {commentNotice}
                      </p>
                    )}
                  </div>
                )}
              </section>
            )}

            <section className="oh-dsh-workspace-facts">
              <label className="oh-dsh-workspace-fact">
                <span className="oh-dsh-workspace-fact-icon">▱</span>
                <select aria-label={t('workspace.execution-environment')} value="local" onChange={() => {}}>
                  <option value="local">{t('workspace.local')}</option>
                </select>
                <span className="oh-dsh-workspace-chevron">⌄</span>
              </label>
              <label className="oh-dsh-workspace-fact">
                <span className="oh-dsh-workspace-fact-icon">⑂</span>
                <select
                  value={snapshot?.branch ?? ''}
                  disabled={snapshot?.kind !== 'repository' || busy}
                  aria-label={t('workspace.current-branch')}
                  onChange={event => { void mutate({ action: 'checkout', branch: event.currentTarget.value }) }}
                >
                  {(snapshot?.branches ?? []).map(branch => <option key={branch} value={branch}>{branch}</option>)}
                </select>
                <span className="oh-dsh-workspace-chevron">⌄</span>
              </label>
              {snapshot?.kind === 'repository' && (
                <div className="oh-dsh-new-branch">
                  <input
                    value={newBranch}
                    placeholder={t('workspace.new-branch')}
                    aria-label={t('workspace.new-branch-name')}
                    onChange={event => { setNewBranch(event.currentTarget.value) }}
                  />
                  <button
                    type="button"
                    disabled={busy || newBranch.trim() === ''}
                    onClick={() => { void mutate({ action: 'create-branch', branch: newBranch }).then(() => { setNewBranch('') }) }}
                  >{t('workspace.create')}</button>
                </div>
              )}
              <button
                type="button"
                className="oh-dsh-workspace-fact oh-dsh-commit-toggle"
                onClick={() => { setCommitOpen(open => !open) }}
                aria-expanded={commitOpen}
              >
                <span className="oh-dsh-workspace-fact-icon">—◯—</span>
                <span>{t('workspace.commit-or-push')}</span>
                <span className="oh-dsh-workspace-chevron">{commitOpen ? '⌃' : '⌄'}</span>
              </button>
              {commitOpen && snapshot?.kind === 'repository' && (
                <div className="oh-dsh-commit-box">
                  <textarea
                    value={commitMessage}
                    placeholder={t('workspace.commit-message')}
                    aria-label={t('workspace.commit-message')}
                    onChange={event => { setCommitMessage(event.currentTarget.value) }}
                  />
                  <div>
                    <button
                      type="button"
                      disabled={busy || snapshot.changes.length === 0 || commitMessage.trim() === ''}
                      onClick={() => { void mutate({ action: 'commit', message: commitMessage }) }}
                    >{t('workspace.commit-all')}</button>
                    <button
                      type="button"
                      disabled={busy || !snapshot.hasRemote}
                      onClick={() => { void mutate({ action: 'push' }) }}
                    >{t('workspace.push')}{snapshot.ahead > 0 ? ` (${String(snapshot.ahead)})` : ''}</button>
                  </div>
                  {snapshot.behind > 0 && (
                    <small>{t('workspace.behind', { count: snapshot.behind })}</small>
                  )}
                </div>
              )}
            </section>

            <section className="oh-dsh-workspace-directory">
              <span>{snapshot?.name ?? cwd.split(/[\\/]/).filter(Boolean).pop()}</span>
              <small title={cwd}>{cwd}</small>
              {window.dshDesktop?.chooseWorkspace !== undefined && (
                <button type="button" onClick={() => { void chooseWorkspace() }} aria-label={t('workspace.add')}>+</button>
              )}
            </section>

            <section className="oh-dsh-processes">
              <h3>{t('workspace.background-processes')}</h3>
              {processes.map(process => (
                <div key={process.callId} className="oh-dsh-process-row">
                  <span>›_</span>
                  <code title={processTitle(process)}>{processTitle(process)}</code>
                </div>
              ))}
              {processes.length === 0 && (
                <div className="oh-dsh-workspace-muted">{t('workspace.no-background-processes')}</div>
              )}
            </section>
          </div>
        )}
    </div>
  )
}

function WorkspaceToolsSurface(props: {
  locale: LocaleService
  t: Translate<WorkspaceMessage>
  service: WorkspaceToolsService
  sidebar: DesktopSidebar
  panels: DesktopPanels
  pinnedSummary: PinnedSummary
  sessions: SessionsService
  workspaces: WorkspacesService
}): JSX.Element {
  const t = useTranslate(props.locale, props.t)
  const panelState = useSyncExternalStore(props.service.subscribe, props.service.getSnapshot)
  const sessionList = useSyncExternalStore(props.sessions.list.subscribe, props.sessions.list.getSnapshot)
  const cwd = sessionList.current === undefined ? undefined : sessionList.byId[sessionList.current]?.cwd
  return (
    <>
      <DesktopPanelToolbar
        service={props.service}
        panels={props.panels}
        pinnedSummary={props.pinnedSummary}
        t={t}
      />
      <SideToolsPanel
        cwd={cwd}
        open={panelState.open}
        width={panelState.width}
        maximized={panelState.maximized}
        sidebar={props.sidebar}
        t={t}
        onClose={() => { props.service.setOpen(false) }}
        onResize={width => { props.service.setWidth(width) }}
      />
    </>
  )
}

function TextFileViewer({
  content,
  path,
  title,
}: {
  content: string
  path: string
  title: string
}): JSX.Element {
  return (
    <div className="oh-dsh-file-preview">
      <div><strong title={path}>{title}</strong></div>
      <pre>{content}</pre>
    </div>
  )
}

function BinaryFileViewer({
  onOpen,
  path,
  title,
  t,
}: {
  onOpen(): Promise<void>
  path: string
  title: string
  t: Translate<WorkspaceMessage>
}): JSX.Element {
  return (
    <div className="oh-dsh-file-preview">
      <div>
        <strong title={path}>{title}</strong>
        <button type="button" onClick={() => { void onOpen() }}>
          {t('files.open')}
        </button>
      </div>
      <div className="oh-dsh-side-muted">{t('files.viewer.binary')}</div>
    </div>
  )
}

function HtmlFileViewer({
  content,
  path,
  title,
}: {
  content: string
  path: string
  title: string
}): JSX.Element {
  return (
    <div className="oh-dsh-file-preview oh-dsh-html-preview">
      <div><strong title={path}>{title}</strong></div>
      <iframe title={title} sandbox="" srcDoc={content} />
    </div>
  )
}

function activeWorkspace(sessions: SessionsService): string | undefined {
  const snapshot = sessions.list.getSnapshot()
  return snapshot.current === undefined
    ? undefined
    : snapshot.byId[snapshot.current]?.cwd
}

function activeSidebarScope(sessions: SessionsService): {
  sessionId: string
  cwd: string
} | undefined {
  const snapshot = sessions.list.getSnapshot()
  if (snapshot.current === undefined) return undefined
  const cwd = snapshot.byId[snapshot.current]?.cwd
  return cwd === undefined ? undefined : { sessionId: snapshot.current, cwd }
}

function registerBuiltinSidebarTools(options: {
  openExternalPath(path: string): Promise<void>
  panels: DesktopPanels
  reviewComments: ReviewCommentsService
  service: WorkspaceToolsService
  sessions: SessionsService
  sidebar: DesktopSidebar
  t: Translate<WorkspaceMessage>
  workspaces: WorkspacesService
}): () => void {
  const {
    openExternalPath,
    panels,
    reviewComments,
    service,
    sessions,
    sidebar,
    t,
    workspaces,
  } = options
  const disposers = [
    sidebar.registerTab({
      chrome: 'custom',
      icon: <ToolIcon kind="review" />,
      id: 'review',
      order: 10,
      render: () => (
        <WorkspacePanel
          reviewComments={reviewComments}
          service={service}
          sessions={sessions}
          workspaces={workspaces}
          t={t}
        />
      ),
      requiresWorkspace: true,
      shortcut: '⌃⇧G',
      single: true,
      title: () => t('review'),
    }),
    sidebar.registerTab({
      action: () => { panels.toggleBottomPanel() },
      icon: <ToolIcon kind="terminal" />,
      id: 'terminal',
      order: 20,
      shortcut: '⌘J',
      title: () => t('terminal'),
    }),
    ...(window.dshDesktop === undefined
      ? []
      : [sidebar.registerTab({
          icon: <ToolIcon kind="browser" />,
          id: 'browser',
          order: 30,
          render: props => <BrowserView {...props} t={t} />,
          shortcut: '⌘T',
          title: () => t('browser'),
        })]),
    sidebar.registerTab({
      dedupeKey: tab => tab.resource,
      icon: <ToolIcon kind="files" />,
      id: 'files',
      order: 40,
      render: props => (
        <FilesView
          {...props}
          scope={activeSidebarScope(sessions)}
          sidebar={sidebar}
          t={t}
        />
      ),
      requiresWorkspace: true,
      shortcut: '⌘P',
      title: () => t('files'),
    }),
    sidebar.registerTab({
      dedupeKey: tab => tab.resource,
      hidden: true,
      icon: <ToolIcon kind="file" />,
      id: 'file',
      render: props => (
        <FileView
          {...props}
          scope={activeSidebarScope(sessions)}
          onOpenPath={openExternalPath}
          sidebar={sidebar}
          t={t}
        />
      ),
      requiresWorkspace: true,
      title: () => t('files'),
    }),
    sidebar.registerTab({
      action: async () => { await service.openSideChat() },
      icon: <ToolIcon kind="chat" />,
      id: 'side-chat',
      order: 50,
      shortcut: '⌥⌘S',
      title: () => t('side-chat'),
    }),
    sidebar.registerTab({
      action: () => { service.openTrajectory() },
      icon: <ToolIcon kind="trajectory" />,
      id: 'trajectory',
      order: 60,
      requiresWorkspace: true,
      title: () => t('trajectory'),
    }),
    sidebar.registerViewer({
      detect: (_path, head) => head.includes(0),
      extensions: [],
      fetchStrategy: 'binary-download',
      id: 'binary',
      order: 100,
      render: input => (
        <BinaryFileViewer
          onOpen={async () => { await openExternalPath(input.path) }}
          path={input.path}
          title={input.title}
          t={t}
        />
      ),
      title: () => t('files.viewer.binary'),
    }),
    sidebar.registerViewer({
      extensions: ['html', 'htm'],
      fetchStrategy: 'text',
      id: 'html',
      order: 30,
      render: input => (
        <HtmlFileViewer
          content={input.content ?? ''}
          path={input.path}
          title={input.title}
        />
      ),
      title: () => t('files.viewer.html'),
    }),
    sidebar.registerViewer({
      extensions: ['md', 'markdown', 'mdx'],
      fetchStrategy: 'text',
      id: 'markdown',
      order: 20,
      render: input => (
        <TextFileViewer
          content={input.content ?? ''}
          path={input.path}
          title={input.title}
        />
      ),
      title: () => t('files.viewer.markdown'),
    }),
    sidebar.registerViewer({
      extensions: [],
      fetchStrategy: 'text',
      id: 'text',
      order: -100,
      render: input => (
        <TextFileViewer
          content={input.content ?? ''}
          path={input.path}
          title={input.title}
        />
      ),
      title: () => t('files.viewer.text'),
    }),
  ]
  return () => {
    for (const dispose of disposers.reverse()) dispose()
  }
}

function sidebarLabel(value: string | (() => string)): string {
  return typeof value === 'function' ? value() : value
}

function SidebarSettingsRow({
  reset,
  runtime,
  setOpenByDefault,
  setTabEnabled,
  setViewerEnabled,
  setWidth,
  sidebar,
  t,
  useStore,
}: SidebarSettingsProps): JSX.Element {
  const state = useStore(snapshot => snapshot)
  const runtimeState = useSyncExternalStore(
    runtime.subscribe,
    runtime.getSnapshot,
  )
  const tabs = sidebar.getTabs().filter(descriptor => descriptor.hidden !== true)
  const viewers = sidebar.getViewers()
  const updateRuntime = (
    key: keyof SidebarRuntimePreferences,
    enabled: boolean,
  ): void => {
    void runtime.update({ [key]: enabled })
  }
  return (
    <div className="oh-dsh-sidebar-settings">
      <div className="oh-dsh-sidebar-settings-heading">
        <div>
          <strong>{t('settings.title')}</strong>
          <p>{t('settings.description')}</p>
        </div>
        <button type="button" onClick={reset}>{t('settings.reset')}</button>
      </div>
      <label className="oh-dsh-sidebar-settings-row">
        <span>
          <strong>{t('settings.open-by-default')}</strong>
          <small>{t('settings.open-by-default-description')}</small>
        </span>
        <input
          type="checkbox"
          checked={state.openByDefault}
          onChange={event => { setOpenByDefault(event.currentTarget.checked) }}
        />
      </label>
      <label className="oh-dsh-sidebar-settings-size">
        <span>
          <strong>{t('settings.width')}</strong>
          <small>{t('settings.width-value', { width: state.width })}</small>
        </span>
        <input
          type="range"
          min={SIDEBAR_MIN_WIDTH}
          max={SIDEBAR_MAX_WIDTH}
          step="10"
          value={state.width}
          onChange={event => { setWidth(Number(event.currentTarget.value)) }}
        />
      </label>
      <section>
        <h4>{t('settings.runtime')}</h4>
        <p>{t('settings.runtime-description')}</p>
        <label className="oh-dsh-sidebar-settings-row">
          <span>
            <strong>{t('settings.agent-terminal-tools')}</strong>
            <small>{t('settings.agent-terminal-tools-description')}</small>
          </span>
          <input
            type="checkbox"
            checked={runtimeState.preferences.agentTerminalTools}
            disabled={runtimeState.busy}
            onChange={event => {
              updateRuntime('agentTerminalTools', event.currentTarget.checked)
            }}
          />
        </label>
        <label className="oh-dsh-sidebar-settings-row">
          <span>
            <strong>{t('settings.bottom-terminal')}</strong>
            <small>{t('settings.bottom-terminal-description')}</small>
          </span>
          <input
            type="checkbox"
            checked={runtimeState.preferences.bottomPanelAutoTerminal}
            disabled={runtimeState.busy}
            onChange={event => {
              updateRuntime(
                'bottomPanelAutoTerminal',
                event.currentTarget.checked,
              )
            }}
          />
        </label>
        <label className="oh-dsh-sidebar-settings-row">
          <span>
            <strong>{t('settings.open-files')}</strong>
            <small>{t('settings.open-files-description')}</small>
          </span>
          <input
            type="checkbox"
            checked={runtimeState.preferences.interceptOpenPath}
            disabled={runtimeState.busy}
            onChange={event => {
              updateRuntime('interceptOpenPath', event.currentTarget.checked)
            }}
          />
        </label>
        <label className="oh-dsh-sidebar-settings-row">
          <span>
            <strong>{t('settings.open-links')}</strong>
            <small>{t('settings.open-links-description')}</small>
          </span>
          <input
            type="checkbox"
            checked={runtimeState.preferences.browserInterceptLinks}
            disabled={runtimeState.busy}
            onChange={event => {
              updateRuntime(
                'browserInterceptLinks',
                event.currentTarget.checked,
              )
            }}
          />
        </label>
        {runtimeState.error !== null && (
          <p className="oh-dsh-sidebar-settings-error" role="alert">
            {t(runtimeState.error === 'load'
              ? 'settings.runtime-load-failed'
              : 'settings.runtime-save-failed')}
          </p>
        )}
      </section>
      <section>
        <h4>{t('settings.tools')}</h4>
        <p>{t('settings.tools-description')}</p>
        <div className="oh-dsh-sidebar-settings-list">
          {tabs.map(descriptor => (
            <label key={descriptor.id}>
              <span>{sidebarLabel(descriptor.title)}</span>
              <input
                type="checkbox"
                checked={state.tabsEnabled[descriptor.id] !== false}
                onChange={event => {
                  setTabEnabled(descriptor.id, event.currentTarget.checked)
                }}
              />
            </label>
          ))}
        </div>
      </section>
      <section>
        <h4>{t('settings.viewers')}</h4>
        <p>{t('settings.viewers-description')}</p>
        <div className="oh-dsh-sidebar-settings-list">
          {viewers.map(descriptor => (
            <label key={descriptor.id}>
              <span>{sidebarLabel(descriptor.title)}</span>
              <input
                type="checkbox"
                checked={state.viewersEnabled[descriptor.id] !== false}
                onChange={event => {
                  setViewerEnabled(descriptor.id, event.currentTarget.checked)
                }}
              />
            </label>
          ))}
        </div>
      </section>
    </div>
  )
}

function syncSidebarSettings(
  actions: BoundSidebarSettingsActions | undefined,
  snapshot: DesktopSidebarSnapshot,
): void {
  actions?.sync(
    snapshot.openByDefault,
    snapshot.revision,
    { ...snapshot.tabsEnabled },
    { ...snapshot.viewersEnabled },
    snapshot.width,
  )
}

function pathBelongsToActiveWorkspace(
  sessions: SessionsService,
  path: string,
): boolean {
  const cwd = activeWorkspace(sessions)
  if (cwd === undefined) return false
  const normalizedRoot = cwd.replaceAll('\\', '/').replace(/\/+$/, '')
  const normalizedPath = path.replaceAll('\\', '/').replace(/\/+$/, '')
  return normalizedPath === normalizedRoot
    || normalizedPath.startsWith(`${normalizedRoot}/`)
}

export function apply(ctx: ClientContext): void {
  const locale = ctx.get('locale') as LocaleService
  const slots = ctx.get('slots') as SlotsService
  const t: Translate<WorkspaceMessage> = locale.bind('oh-dsh.sidebar')
  ctx.effect(
    () => locale.register('oh-dsh.sidebar', WORKSPACE_MESSAGES),
    'oh-dsh-sidebar: workspace tools dictionaries',
  )
  const panels = ctx.get('desktopPanels') as DesktopPanels
  const pinnedSummary = ctx.get('pinnedSummary') as PinnedSummary
  const sessions = ctx.get('sessions') as SessionsService
  const inputTriggers = ctx.get('inputTriggers') as ReviewInputTriggersService
  const workspaces = ctx.get('workspaces') as WorkspacesService
  const originalOpenPath = workspaces.openPath
  const openExternalPath = async (path: string): Promise<void> => {
    await originalOpenPath.call(workspaces, path)
  }
  const reviewComments = new ReviewCommentsService(
    sessions,
    inputTriggers,
    window.localStorage,
  )
  const desktopSidebar = new DesktopSidebarService(
    new HttpSidebarPreferencesStorage(fetch.bind(globalThis)),
  )
  const runtimeSettings = new SidebarRuntimeSettingsService()
  const service = new WorkspaceToolsService(
    desktopSidebar,
    panels,
    locale,
    t,
    pinnedSummary,
    sessions,
    workspaces,
  )
  const unregisterBuiltins = registerBuiltinSidebarTools({
    openExternalPath,
    panels,
    reviewComments,
    service,
    sessions,
    sidebar: desktopSidebar,
    t,
    workspaces,
  })
  const settingsStore = defineStore<SidebarSettingsState>({
    init: () => ({
      openByDefault: false,
      revision: -1,
      tabsEnabled: {},
      viewersEnabled: {},
      width: DEFAULT_SIDEBAR_PREFERENCES.defaultWidth,
    }),
    actions: {
      sync: (
        draft,
        openByDefault: boolean,
        revision: number,
        tabsEnabled: Record<string, boolean>,
        viewersEnabled: Record<string, boolean>,
        width: number,
      ) => {
        if (revision < draft.revision) return
        draft.openByDefault = openByDefault
        draft.revision = revision
        draft.tabsEnabled = tabsEnabled
        draft.viewersEnabled = viewersEnabled
        draft.width = width
      },
    },
  })
  let settingsActions: BoundSidebarSettingsActions | undefined
  ctx.effect(() => {
    const syncSession = (): void => {
      desktopSidebar.setSession(sessions.list.getSnapshot().current ?? null)
    }
    syncSession()
    const stopSessions = sessions.list.subscribe(syncSession)
    const stopSettings = desktopSidebar.subscribe(() => {
      syncSidebarSettings(settingsActions, desktopSidebar.getSnapshot())
    })
    const syncRuntime = (): void => {
      panels.setAutoOpenTerminal(
        runtimeSettings.getSnapshot().preferences.bottomPanelAutoTerminal,
      )
    }
    const stopRuntime = runtimeSettings.subscribe(syncRuntime)
    const interceptOpenPath = async (path: string): Promise<void> => {
      const runtime = runtimeSettings.getSnapshot().preferences
      const snapshot = desktopSidebar.getSnapshot()
      if (runtime.interceptOpenPath
        && snapshot.ready
        && desktopSidebar.isTabEnabled('file')
        && pathBelongsToActiveWorkspace(sessions, path)) {
        service.openFile(path)
        return
      }
      await openExternalPath(path)
    }
    const interceptExternalLink = (event: MouseEvent): void => {
      if (event.defaultPrevented || event.button !== 0
        || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return
      }
      const target = event.target
      const anchor = target instanceof Element
        ? target.closest<HTMLAnchorElement>('a[href]')
        : null
      if (anchor === null || anchor.hasAttribute('download')) return
      let url: URL
      try { url = new URL(anchor.href, window.location.href) } catch { return }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return
      if (url.origin === window.location.origin) return
      const runtime = runtimeSettings.getSnapshot().preferences
      const snapshot = desktopSidebar.getSnapshot()
      if (window.dshDesktop === undefined
        || !runtime.browserInterceptLinks
        || !snapshot.ready
        || !desktopSidebar.isTabEnabled('browser')) return
      event.preventDefault()
      service.openBrowserUrl(url.href)
    }
    workspaces.openPath = interceptOpenPath
    document.addEventListener('click', interceptExternalLink, true)
    syncRuntime()
    void runtimeSettings.start()
    void desktopSidebar.start()
    service.mount()
    const removeSidebar = ctx.reflect.provide(
      'desktopSidebar',
      desktopSidebar,
      undefined,
    )
    const removeService = ctx.reflect.provide('workspaceTools', service, undefined)
    return () => {
      stopSessions()
      stopSettings()
      stopRuntime()
      document.removeEventListener('click', interceptExternalLink, true)
      if (workspaces.openPath === interceptOpenPath) {
        workspaces.openPath = originalOpenPath
      }
      service.dispose()
      unregisterBuiltins()
      reviewComments.dispose()
      desktopSidebar.dispose()
      runtimeSettings.dispose()
      void removeSidebar?.()
      void removeService?.()
    }
  }, 'oh-dsh-sidebar: workspace tools and panel toolbar')

  slots.inject('settings.section', () => slots.register({
    id: 'oh-dsh-sidebar',
    inject: actions => {
      settingsActions = actions
      syncSidebarSettings(settingsActions, desktopSidebar.getSnapshot())
      return {
        reset: () => {
          desktopSidebar.setOpenByDefault(
            DEFAULT_SIDEBAR_PREFERENCES.openByDefault,
          )
          desktopSidebar.setWidth(DEFAULT_SIDEBAR_PREFERENCES.defaultWidth)
          for (const descriptor of desktopSidebar.getTabs()) {
            desktopSidebar.setTabEnabled(descriptor.id, true)
          }
          for (const descriptor of desktopSidebar.getViewers()) {
            desktopSidebar.setViewerEnabled(descriptor.id, true)
          }
          void runtimeSettings.reset()
        },
        setOpenByDefault: open => { desktopSidebar.setOpenByDefault(open) },
        setTabEnabled: (id, enabled) => {
          desktopSidebar.setTabEnabled(id, enabled)
        },
        setViewerEnabled: (id, enabled) => {
          desktopSidebar.setViewerEnabled(id, enabled)
        },
        setWidth: width => { desktopSidebar.setWidth(width) },
        runtime: runtimeSettings,
        sidebar: desktopSidebar,
      }
    },
    label: () => t('settings.title'),
    locale: 'oh-dsh.sidebar',
    name: 'settings.section',
    order: 40,
    store: settingsStore,
  }, SidebarSettingsRow))
}
