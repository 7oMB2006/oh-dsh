import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { DesktopBridge } from '../../../../src/contracts.ts'
import type { DesktopPanels } from '../../../panel-controls/src/client.ts'
import type { PinnedSummary } from '../../../pinned-summary/src/client.ts'
import type {
  WorkspaceDiffResponse,
  WorkspaceMutation,
  WorkspaceMutationResponse,
  WorkspaceSnapshot,
} from '../protocol.ts'
import { WORKSPACE_API_PATH } from '../protocol.ts'
import { SideToolsPanel, type DesktopToolView } from './SideToolsPanel.tsx'
import sideToolsCss from './side-tools.css'
import workspaceCss from './desktop-sidebar.css'
import type { LocaleService, Translate } from '../../../shared/i18n.ts'
import { useTranslate } from '../../../shared/use-i18n.ts'
import { WORKSPACE_MESSAGES, type WorkspaceMessage } from './i18n.ts'
import { DesktopSidebarService } from './sidebar-service.ts'
import { HttpSidebarPreferencesStorage } from './sidebar-storage.ts'

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

interface SessionsService {
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

interface WorkspaceToolsState {
  maximized: boolean
  open: boolean
  view: DesktopToolView
  width: number
}

export interface WorkspaceTools {
  getSnapshot(): WorkspaceToolsState
  subscribe(listener: () => void): () => void
  isOpen(): boolean
  openBrowser(): void
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

export const inject = ['desktopPanels', 'locale', 'pinnedSummary', 'sessions', 'workspaces']

const OPEN_KEY = 'oh-dsh-desktop.workspace-tools.open'
const WIDTH_KEY = 'oh-dsh-desktop.workspace-tools.width'
const VIEW_KEY = 'oh-dsh-desktop.workspace-tools.view'
const DEFAULT_WIDTH = 390
const MIN_WIDTH = 330
const MAX_WIDTH = 620
const EMPTY_CONVERSATION: ConversationSnapshot = { runningCalls: [] }

function readBoolean(key: string): boolean {
  try { return localStorage.getItem(key) === 'true' } catch { return false }
}

function readWidth(): number {
  try {
    const value = Number(localStorage.getItem(WIDTH_KEY))
    return Number.isFinite(value) ? Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, value)) : DEFAULT_WIDTH
  } catch {
    return DEFAULT_WIDTH
  }
}

function readView(): DesktopToolView {
  try {
    const value = localStorage.getItem(VIEW_KEY)
    return value === 'menu' || value === 'browser' || value === 'files' ? value : 'review'
  } catch {
    return 'review'
  }
}

function persist(key: string, value: string): void {
  try { localStorage.setItem(key, value) } catch { /* best effort */ }
}

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

function workspaceUrl(cwd: string, diff?: string): string {
  const url = new URL(WORKSPACE_API_PATH, window.location.origin)
  url.searchParams.set('cwd', cwd)
  if (diff !== undefined) url.searchParams.set('diff', diff)
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
  private state: WorkspaceToolsState = {
    maximized: false,
    open: readBoolean(OPEN_KEY),
    view: readView(),
    width: readWidth(),
  }
  private readonly listeners = new Set<() => void>()
  private style: HTMLStyleElement | undefined
  private element: HTMLDivElement | undefined
  private layout: HTMLDivElement | undefined
  private appRoot: HTMLElement | undefined
  private root: Root | undefined
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
    private readonly panels: DesktopPanels,
    private readonly locale: LocaleService,
    private readonly t: Translate<WorkspaceMessage>,
    private readonly pinnedSummary: PinnedSummary,
    private readonly sessions: SessionsService,
    private readonly workspaces: WorkspacesService,
  ) {}

  getSnapshot = (): WorkspaceToolsState => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  isOpen(): boolean { return this.state.open }

  setOpen(open: boolean): void {
    if (open) this.pinnedSummary.setOpen(false)
    if (this.state.open === open) return
    this.publish({ ...this.state, maximized: open ? this.state.maximized : false, open })
    if (!open) delete document.documentElement.dataset.ohDshPanelMaximized
    persist(OPEN_KEY, String(open))
    this.applyLayout()
  }

  toggle(): void {
    if (this.state.open && this.state.view === 'review') this.setOpen(false)
    else this.openReview()
  }

  openReview(): void { this.openView('review') }

  openBrowser(): void { this.openView('browser') }

  openFiles(): void {
    const list = this.sessions.list.getSnapshot()
    if (list.current === undefined || list.byId[list.current]?.cwd === undefined) return
    this.openView('files')
  }

  openMenu(): void { this.openView('menu') }

  toggleSidePanel(): void {
    if (this.state.open) this.setOpen(false)
    else this.openView('menu')
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
    this.publish({ ...this.state, maximized })
    if (maximized) document.documentElement.dataset.ohDshPanelMaximized = 'true'
    else delete document.documentElement.dataset.ohDshPanelMaximized
    this.applyLayout()
  }

  setWidth(width: number): void {
    const clamped = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(width)))
    if (clamped === this.state.width) return
    this.publish({ ...this.state, width: clamped })
    persist(WIDTH_KEY, String(clamped))
    this.applyLayout()
  }

  mount(): void {
    if (this.state.open) this.pinnedSummary.setOpen(false)
    this.style = document.createElement('style')
    this.style.dataset.ohDshDesktopSidebarStyles = 'true'
    this.style.textContent = `${workspaceCss}\n${sideToolsCss}`
    document.head.append(this.style)
    this.element = document.createElement('div')
    this.element.id = 'oh-dsh-desktop-sidebar-root'
    const appRoot = document.getElementById('root')
    if (appRoot === null) throw new Error('desktop-sidebar: app root is unavailable')
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
      />,
    )
    this.narrowViewport.addEventListener('change', this.handleViewportChange)
    window.addEventListener('keydown', this.handleShortcut, true)
    this.applyLayout()
  }

  dispose(): void {
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
    document.documentElement.style.removeProperty('--oh-dsh-desktop-sidebar-width')
    if (document.documentElement.dataset.ohDshRightPanelOwner === 'desktop-sidebar') {
      delete document.documentElement.dataset.ohDshRightPanelOwner
      document.getElementById('root')?.style.removeProperty('padding-right')
    }
  }

  private publish(next: WorkspaceToolsState): void {
    this.state = next
    for (const listener of this.listeners) listener()
  }

  private openView(view: DesktopToolView): void {
    this.pinnedSummary.setOpen(false)
    if (this.state.open && this.state.view === view) return
    this.publish({ ...this.state, maximized: this.state.open ? this.state.maximized : false, open: true, view })
    persist(OPEN_KEY, 'true')
    persist(VIEW_KEY, view)
    this.applyLayout()
  }

  private applyLayout(): void {
    document.documentElement.style.setProperty('--oh-dsh-desktop-sidebar-width', `${String(this.state.width)}px`)
    const html = document.documentElement
    const appRoot = document.getElementById('root')
    if (this.state.open) {
      html.dataset.ohDshDesktopSidebarOpen = 'true'
      html.dataset.ohDshRightPanelOwner = 'desktop-sidebar'
      appRoot?.style.removeProperty('padding-right')
    } else {
      delete html.dataset.ohDshDesktopSidebarOpen
      if (html.dataset.ohDshRightPanelOwner === 'desktop-sidebar') {
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
  service,
  sessions,
  workspaces,
  t,
}: {
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
  const visibleChanges = snapshot?.changes.slice(0, 200) ?? []

  const refresh = useCallback(async (): Promise<void> => {
    if (cwd === undefined) {
      setSnapshot(null)
      return
    }
    try {
      setSnapshot(await responseJson<WorkspaceSnapshot>(await fetch(workspaceUrl(cwd)), t))
      setError('')
    } catch (nextError) {
      setError(errorMessage(nextError))
    }
  }, [cwd])

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
  }, [cwd])

  const mutate = async (mutation: WorkspaceMutation): Promise<void> => {
    if (cwd === undefined || busy) return
    setBusy(true)
    try {
      const response = await fetch(workspaceUrl(cwd), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(mutation),
      })
      const result = await responseJson<WorkspaceMutationResponse>(response, t)
      setSnapshot(result.snapshot)
      setError('')
      if (mutation.action === 'commit') setCommitMessage('')
    } catch (nextError) {
      setError(errorMessage(nextError))
    } finally {
      setBusy(false)
    }
  }

  const showDiff = async (path: string): Promise<void> => {
    if (cwd === undefined) return
    if (selectedPath === path) {
      setSelectedPath(null)
      setDiff('')
      return
    }
    setSelectedPath(path)
    setDiff(t('workspace.loading-diff'))
    try {
      const response = await responseJson<WorkspaceDiffResponse>(
        await fetch(workspaceUrl(cwd, path)),
        t,
      )
      setDiff(response.diff || t('workspace.no-text-diff'))
    } catch (nextError) {
      setDiff(errorMessage(nextError))
    }
  }

  const chooseWorkspace = async (): Promise<void> => {
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
          <button type="button" onClick={() => { void chooseWorkspace() }} aria-label={t('workspace.add')} title={t('workspace.add')}>+</button>
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
                      onClick={() => { void showDiff(change.path) }}
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
              <button type="button" onClick={() => { void chooseWorkspace() }} aria-label={t('workspace.add')}>+</button>
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
        review={(
          <WorkspacePanel
            service={props.service}
            sessions={props.sessions}
            workspaces={props.workspaces}
            t={t}
          />
        )}
        view={panelState.view}
        width={panelState.width}
        maximized={panelState.maximized}
        t={t}
        onClose={() => { props.service.setOpen(false) }}
        onResize={width => { props.service.setWidth(width) }}
        onReview={() => { props.service.openReview() }}
        onTerminal={() => { props.panels.toggleBottomPanel() }}
        onView={view => {
          if (view === 'browser') props.service.openBrowser()
          else if (view === 'files') props.service.openFiles()
          else if (view === 'review') props.service.openReview()
          else props.service.openMenu()
        }}
        onFiles={() => { props.service.openFiles() }}
        onSideChat={async () => { await props.service.openSideChat() }}
        onTrajectory={() => { props.service.openTrajectory() }}
        onOpenPath={async path => { await props.workspaces.openPath(path) }}
      />
    </>
  )
}

export function apply(ctx: ClientContext): void {
  const locale = ctx.get('locale') as LocaleService
  const t: Translate<WorkspaceMessage> = locale.bind('oh-dsh.desktop-sidebar')
  ctx.effect(
    () => locale.register('oh-dsh.desktop-sidebar', WORKSPACE_MESSAGES),
    'oh-dsh-desktop: workspace tools dictionaries',
  )
  const service = new WorkspaceToolsService(
    ctx.get('desktopPanels') as DesktopPanels,
    locale,
    t,
    ctx.get('pinnedSummary') as PinnedSummary,
    ctx.get('sessions') as SessionsService,
    ctx.get('workspaces') as WorkspacesService,
  )
  const desktopSidebar = new DesktopSidebarService(
    new HttpSidebarPreferencesStorage(fetch.bind(globalThis)),
  )
  ctx.effect(() => {
    void desktopSidebar.start()
    service.mount()
    const removeSidebar = ctx.reflect.provide(
      'desktopSidebar',
      desktopSidebar,
      undefined,
    )
    const removeService = ctx.reflect.provide('workspaceTools', service, undefined)
    return () => {
      service.dispose()
      desktopSidebar.dispose()
      void removeSidebar?.()
      void removeService?.()
    }
  }, 'oh-dsh-desktop: workspace tools and panel toolbar')
}
