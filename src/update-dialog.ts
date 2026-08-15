import type { DesktopUpdateBridge, DesktopUpdateState } from './contracts.ts'

declare global {
  interface Window {
    dshDesktopUpdate: DesktopUpdateBridge
  }
}

const bridge = window.dshDesktopUpdate
const title = document.querySelector<HTMLElement>('[data-field="title"]')!
const status = document.querySelector<HTMLElement>('[data-field="status"]')!
const version = document.querySelector<HTMLElement>('[data-field="version"]')!
const size = document.querySelector<HTMLElement>('[data-field="size"]')!
const notes = document.querySelector<HTMLElement>('[data-field="notes"]')!
const progressWrap = document.querySelector<HTMLElement>('[data-field="progress-wrap"]')!
const progress = document.querySelector<HTMLElement>('[data-field="progress"]')!
const progressText = document.querySelector<HTMLElement>('[data-field="progress-text"]')!
const error = document.querySelector<HTMLElement>('[data-field="error"]')!
const updateButton = document.querySelector<HTMLButtonElement>('[data-action="download"]')!
const cancelButton = document.querySelector<HTMLButtonElement>('[data-action="cancel"]')!
const retryButton = document.querySelector<HTMLButtonElement>('[data-action="retry"]')!
const installNowButton = document.querySelector<HTMLButtonElement>('[data-action="install-now"]')!
const installQuitButton = document.querySelector<HTMLButtonElement>('[data-action="install-on-quit"]')!
const releaseButton = document.querySelector<HTMLButtonElement>('[data-action="open-release"]')!
const checkButton = document.querySelector<HTMLButtonElement>('[data-action="check"]')!

function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes)) return 'Unknown size'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = units[0]
  for (let index = 0; value >= 1024 && index < units.length - 1; index += 1) {
    value /= 1024
    unit = units[index + 1]!
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${unit}`
}

function formatSpeed(bytes: number): string {
  return bytes > 0 ? `${formatBytes(bytes)}/s` : 'Waiting for network'
}

function formatEta(seconds: number | null): string {
  if (seconds === null) return 'Calculating time remaining'
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return minutes > 0 ? `${minutes}m ${String(remainder).padStart(2, '0')}s remaining` : `${remainder}s remaining`
}

function setVisible(element: HTMLElement, visible: boolean): void {
  element.hidden = !visible
}

function setButton(button: HTMLButtonElement, visible: boolean, enabled = visible): void {
  setVisible(button, visible)
  button.disabled = !enabled
}

function render(state: DesktopUpdateState): void {
  error.textContent = ''
  setVisible(error, false)
  setVisible(notes, state.status === 'available' || state.status === 'downloaded')
  setVisible(progressWrap, state.status === 'downloading')
  setButton(checkButton, state.status === 'idle' || state.status === 'not-available' || state.status === 'cancelled' || state.status === 'unsupported' || state.status === 'error')
  setButton(updateButton, state.status === 'available')
  setButton(cancelButton, state.status === 'downloading')
  setButton(retryButton, state.status === 'error' && state.retryable === true)
  setButton(installNowButton, state.status === 'downloaded' && state.platform !== 'unsupported')
  setButton(installQuitButton, state.status === 'downloaded' && state.platform !== 'deb' && state.platform !== 'unsupported')
  setButton(releaseButton, 'releaseUrl' in state && state.releaseUrl !== null, 'releaseUrl' in state && state.releaseUrl !== null)

  switch (state.status) {
    case 'idle':
      title.textContent = 'Software updates'
      status.textContent = 'Check the official GitHub Release for a newer version.'
      version.textContent = `Current version: ${state.currentVersion}`
      size.textContent = ''
      notes.textContent = ''
      break
    case 'checking':
      title.textContent = 'Checking for updates'
      status.textContent = 'Contacting the official Release service...'
      version.textContent = `Current version: ${state.currentVersion}`
      break
    case 'not-available':
      title.textContent = 'You are up to date'
      status.textContent = `Latest stable version: ${state.checkedVersion}`
      version.textContent = `Current version: ${state.currentVersion}`
      size.textContent = ''
      notes.textContent = ''
      break
    case 'available':
      title.textContent = 'Update available'
      status.textContent = state.releaseName ?? `Version ${state.latestVersion}`
      version.textContent = `Current ${state.currentVersion} -> ${state.latestVersion}`
      size.textContent = `Download size: ${formatBytes(state.size)}`
      notes.textContent = state.releaseNotes || 'No release notes were provided.'
      break
    case 'downloading':
      title.textContent = 'Downloading update'
      status.textContent = `${state.percent.toFixed(1)}% - ${formatSpeed(state.bytesPerSecond)} - ${formatEta(state.etaSeconds)}`
      version.textContent = `Current ${state.currentVersion} -> ${state.latestVersion}`
      size.textContent = `${formatBytes(state.transferred)} of ${formatBytes(state.total)}`
      progress.style.width = `${Math.max(0, Math.min(100, state.percent))}%`
      progressText.textContent = `${state.percent.toFixed(1)}%`
      break
    case 'downloaded':
      title.textContent = state.platform === 'deb' ? 'Installer ready' : 'Update ready to install'
      status.textContent = state.platform === 'deb' ? 'Open the system package installer to finish.' : 'Restart to apply the verified update.'
      version.textContent = `Current ${state.currentVersion} -> ${state.latestVersion}`
      size.textContent = `Downloaded: ${formatBytes(state.size)}`
      notes.textContent = state.releaseNotes || 'No release notes were provided.'
      installNowButton.textContent = state.platform === 'deb' ? 'Open System Installer' : 'Restart and Install Now'
      break
    case 'scheduled':
      title.textContent = 'Update scheduled'
      status.textContent = state.platform === 'deb' ? 'Finish installation in the system installer.' : 'The verified update will be installed when the application quits.'
      version.textContent = `Current ${state.currentVersion} -> ${state.latestVersion}`
      break
    case 'cancelled':
      title.textContent = 'Download cancelled'
      status.textContent = 'The current version is still installed.'
      version.textContent = `Current version: ${state.currentVersion}`
      break
    case 'unsupported':
      title.textContent = 'Automatic updates unavailable'
      status.textContent = state.message
      version.textContent = `Current version: ${state.currentVersion}`
      break
    case 'error':
      title.textContent = 'Update could not be completed'
      status.textContent = state.message
      version.textContent = `Current version: ${state.currentVersion}`
      error.textContent = `${state.stage} (${state.code})`
      setVisible(error, true)
      break
  }
}

async function run(type: Parameters<DesktopUpdateBridge['command']>[0]['type']): Promise<void> {
  try {
    render(await bridge.command({ type } as Parameters<DesktopUpdateBridge['command']>[0]))
  } catch (cause) {
    error.textContent = cause instanceof Error ? cause.message : String(cause)
    setVisible(error, true)
  }
}

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-action]')) {
  const action = button.dataset.action
  if (action === undefined || action === 'close') continue
  button.addEventListener('click', () => { void run(action as Parameters<DesktopUpdateBridge['command']>[0]['type']) })
}

bridge.onState(render)
void bridge.getState().then(render).catch(cause => {
  error.textContent = cause instanceof Error ? cause.message : String(cause)
  setVisible(error, true)
})
