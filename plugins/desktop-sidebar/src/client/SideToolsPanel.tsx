import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import type { WorkspaceFilesResponse, WorkspaceFileKind } from '../protocol.ts'
import { FILES_API_PATH } from '../protocol.ts'
import type { Translate } from '../../../shared/i18n.ts'
import type { WorkspaceMessage } from './i18n.ts'

export type DesktopToolView = 'review' | 'menu' | 'browser' | 'files'

interface ElectronWebviewElement extends HTMLElement {
  canGoBack(): boolean
  getURL(): string
  goBack(): void
  loadURL(url: string): Promise<void>
  reload(): void
}

interface SideToolsPanelProps {
  cwd: string | undefined
  onClose(): void
  onFiles(): void
  onOpenPath(path: string): Promise<void>
  onResize(width: number): void
  onReview(): void
  onSideChat(): Promise<void>
  onTerminal(): void
  onTrajectory(): void
  onView(view: DesktopToolView): void
  maximized: boolean
  open: boolean
  review: ReactNode
  view: DesktopToolView
  width: number
  t: Translate<WorkspaceMessage>
}

function ToolIcon({ kind }: { kind: 'review' | 'terminal' | 'browser' | 'files' | 'chat' | 'trajectory' }): JSX.Element {
  if (kind === 'review') return <svg viewBox="0 0 24 24"><rect x="5" y="4" width="14" height="16" rx="3" /><path d="M9 9h6M9 13h6M12 7v4" /></svg>
  if (kind === 'terminal') return <svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="14" rx="3" /><path d="m8 10 2 2-2 2M13 15h3" /></svg>
  if (kind === 'browser') return <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" /></svg>
  if (kind === 'files') return <svg viewBox="0 0 24 24"><path d="M3.5 7.5A2.5 2.5 0 0 1 6 5h4l2 2h6A2.5 2.5 0 0 1 20.5 9.5v7A2.5 2.5 0 0 1 18 19H6a2.5 2.5 0 0 1-2.5-2.5z" /></svg>
  if (kind === 'chat') return <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="M11 7v8M7 11h8M16 16l4 4" /></svg>
  return <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l-3 2" /></svg>
}

function ToolRow(props: {
  disabled?: boolean
  icon: Parameters<typeof ToolIcon>[0]['kind']
  label: string
  onClick(): void
  shortcut?: string
}): JSX.Element {
  return (
    <button className="oh-dsh-side-tool-row" type="button" disabled={props.disabled} onClick={props.onClick}>
      <ToolIcon kind={props.icon} />
      <span>{props.label}</span>
      {props.shortcut !== undefined && <kbd>{props.shortcut}</kbd>}
    </button>
  )
}

function SideMenu(props: SideToolsPanelProps): JSX.Element {
  const [error, setError] = useState('')
  const sideChat = async (): Promise<void> => {
    try {
      setError('')
      await props.onSideChat()
    } catch (next) {
      setError(next instanceof Error ? next.message : String(next))
    }
  }
  return (
    <div className="oh-dsh-side-menu">
      <ToolRow icon="review" label={props.t('review')} shortcut="⌃⇧G" onClick={props.onReview} />
      <ToolRow icon="terminal" label={props.t('terminal')} onClick={props.onTerminal} />
      <ToolRow icon="browser" label={props.t('browser')} shortcut="⌘T" onClick={() => { props.onView('browser') }} />
      <ToolRow icon="files" label={props.t('files')} shortcut="⌘P" disabled={props.cwd === undefined} onClick={props.onFiles} />
      <ToolRow icon="chat" label={props.t('side-chat')} shortcut="⌥⌘S" onClick={() => { void sideChat() }} />
      <ToolRow icon="trajectory" label={props.t('trajectory')} disabled={props.cwd === undefined} onClick={props.onTrajectory} />
      {error !== '' && <div className="oh-dsh-side-error" role="alert">{error}</div>}
    </div>
  )
}

function normalizeBrowserUrl(raw: string, t: Translate<WorkspaceMessage>): string {
  const value = raw.trim()
  if (value === '') throw new Error(t('browser.enter-url'))
  const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}`)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error(t('browser.http-only'))
  return url.href
}

function BrowserView({ t }: { t: Translate<WorkspaceMessage> }): JSX.Element {
  const container = useRef<HTMLDivElement | null>(null)
  const webview = useRef<ElectronWebviewElement | null>(null)
  const [address, setAddress] = useState('')
  const [error, setError] = useState('')
  const [canGoBack, setCanGoBack] = useState(false)

  useEffect(() => {
    const host = container.current
    if (host === null) return
    const element = document.createElement('webview') as unknown as ElectronWebviewElement
    element.className = 'oh-dsh-browser-webview'
    element.setAttribute('partition', 'persist:oh-dsh-browser')
    element.setAttribute('src', 'about:blank')
    const update = (event: Event): void => {
      const next = 'url' in event && typeof event.url === 'string' ? event.url : element.getURL()
      if (next !== '' && next !== 'about:blank') setAddress(next)
      setCanGoBack(element.canGoBack())
      setError('')
    }
    const failed = (event: Event): void => {
      const description = 'errorDescription' in event
        ? String(event.errorDescription)
        : t('browser.page-failed')
      setError(description)
    }
    element.addEventListener('did-navigate', update)
    element.addEventListener('did-navigate-in-page', update)
    element.addEventListener('did-fail-load', failed)
    host.append(element)
    webview.current = element
    return () => {
      webview.current = null
      element.remove()
    }
  }, [])

  const navigate = async (): Promise<void> => {
    try {
      const url = normalizeBrowserUrl(address, t)
      setAddress(url)
      setError('')
      await webview.current?.loadURL(url)
    } catch (next) {
      setError(next instanceof Error ? next.message : String(next))
    }
  }

  return (
    <div className="oh-dsh-browser-view">
      <form className="oh-dsh-browser-bar" onSubmit={event => { event.preventDefault(); void navigate() }}>
        <button type="button" disabled={!canGoBack} aria-label={t('browser.back')} onClick={() => { webview.current?.goBack() }}>‹</button>
        <button type="button" aria-label={t('browser.reload')} onClick={() => { webview.current?.reload() }}>↻</button>
        <input value={address} placeholder={t('browser.enter-url')} aria-label={t('browser.url')} onChange={event => { setAddress(event.currentTarget.value) }} />
        <button type="submit">{t('browser.go')}</button>
      </form>
      {error !== '' && <div className="oh-dsh-browser-error" role="alert">{error}</div>}
      <div ref={container} className="oh-dsh-browser-host" />
    </div>
  )
}

function fileUrl(cwd: string, path: string): string {
  const url = new URL(FILES_API_PATH, window.location.origin)
  url.searchParams.set('cwd', cwd)
  url.searchParams.set('path', path)
  return url.href
}

function formatSize(size: number | null): string {
  if (size === null) return ''
  if (size < 1024) return `${String(size)} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function fileGlyph(kind: WorkspaceFileKind): string {
  return kind === 'directory' ? '▱' : kind === 'symlink' ? '↗' : '▤'
}

function FilesView({
  cwd,
  onOpenPath,
  t,
}: {
  cwd: string | undefined
  onOpenPath(path: string): Promise<void>
  t: Translate<WorkspaceMessage>
}): JSX.Element {
  const [path, setPath] = useState(cwd)
  const [snapshot, setSnapshot] = useState<WorkspaceFilesResponse | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => { setPath(cwd); setSnapshot(null) }, [cwd])
  useEffect(() => {
    if (cwd === undefined || path === undefined) return
    const controller = new AbortController()
    setLoading(true)
    void fetch(fileUrl(cwd, path), { signal: controller.signal }).then(async response => {
      const payload = await response.json() as WorkspaceFilesResponse & { error?: string }
      if (!response.ok) {
        throw new Error(payload.error ?? t('files.request-failed', {
          status: response.status,
        }))
      }
      setSnapshot(payload)
      setError('')
    }).catch((next: unknown) => {
      if (!controller.signal.aborted) setError(next instanceof Error ? next.message : String(next))
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => { controller.abort() }
  }, [cwd, path, refreshKey])

  if (cwd === undefined) return <div className="oh-dsh-side-empty">{t('files.select-workspace')}</div>
  return (
    <div className="oh-dsh-files-view">
      <div className="oh-dsh-files-path" title={snapshot?.path ?? cwd}>
        <button type="button" disabled={snapshot?.parent == null} onClick={() => { if (snapshot?.parent !== undefined && snapshot.parent !== null) setPath(snapshot.parent) }}>‹</button>
        <span>{(snapshot?.path ?? cwd).slice(cwd.length) || '/'}</span>
        <button type="button" onClick={() => { setRefreshKey(value => value + 1) }}>↻</button>
      </div>
      {loading && <div className="oh-dsh-side-muted">{t('files.loading')}</div>}
      {error !== '' && <div className="oh-dsh-side-error" role="alert">{error}</div>}
      {snapshot?.kind === 'directory' && (
        <div className="oh-dsh-file-list">
          {snapshot.entries.map(entry => (
            <button key={entry.path} type="button" onClick={() => { setPath(entry.path) }}>
              <span>{fileGlyph(entry.kind)}</span>
              <span title={entry.name}>{entry.name}</span>
              <small>{formatSize(entry.size)}</small>
            </button>
          ))}
          {snapshot.entries.length === 0 && <div className="oh-dsh-side-muted">{t('files.empty-directory')}</div>}
          {snapshot.truncated && <div className="oh-dsh-side-muted">{t('files.showing-first')}</div>}
        </div>
      )}
      {snapshot?.kind === 'file' && (
        <div className="oh-dsh-file-preview">
          <div>
            <strong>{snapshot.path.split(/[\\/]/).pop()}</strong>
            <button type="button" onClick={() => { void onOpenPath(snapshot.path) }}>{t('files.open')}</button>
          </div>
          {snapshot.binary
            ? <div className="oh-dsh-side-muted">{t('files.binary', { size: formatSize(snapshot.size) })}</div>
            : <pre>{snapshot.content}{snapshot.truncated ? `\n\n… ${t('files.preview-truncated')}` : ''}</pre>}
        </div>
      )}
    </div>
  )
}

export function SideToolsPanel(props: SideToolsPanelProps): JSX.Element {
  const shown = props.open
  const beginResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = props.width
    const move = (next: PointerEvent): void => { props.onResize(startWidth + startX - next.clientX) }
    const finish = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }
  const title = props.view === 'browser'
    ? props.t('browser')
    : props.view === 'files'
      ? props.t('files')
      : props.view === 'review' ? props.t('review') : props.t('side.title')
  return (
    <aside
      className="oh-dsh-workspace-panel oh-dsh-side-panel"
      data-open={String(shown)}
      data-maximized={String(props.maximized)}
      aria-hidden={!shown}
      aria-label={title}
      style={{ width: '100%' }}
    >
      {!props.maximized && <div className="oh-dsh-workspace-resize" onPointerDown={beginResize} aria-hidden="true" />}
      {props.view !== 'menu' && props.view !== 'review' && (
        <header className="oh-dsh-workspace-header oh-dsh-side-header">
          <div>
            <button type="button" aria-label={props.t('side.back')} onClick={() => { props.onView('menu') }}>‹</button>
            <strong>{title}</strong>
          </div>
          <button type="button" aria-label={props.t('side.close')} onClick={props.onClose}>×</button>
        </header>
      )}
      {props.view === 'menu' && <SideMenu {...props} />}
      {props.view === 'review' && props.review}
      {props.view === 'browser' && <BrowserView t={props.t} />}
      {props.view === 'files' && <FilesView cwd={props.cwd} onOpenPath={props.onOpenPath} t={props.t} />}
    </aside>
  )
}
