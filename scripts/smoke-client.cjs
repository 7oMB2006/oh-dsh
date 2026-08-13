const { app, BrowserWindow } = require('electron')
const { join } = require('node:path')

const runtimeUrl = process.argv[2]
const timeoutMs = 20_000

if (runtimeUrl === undefined) throw new Error('runtime URL is required')

app.disableHardwareAcceleration()

function finish(window, error) {
  if (error === undefined) {
    process.stdout.write('DSH Chromium client graph: ready\n')
  } else {
    process.stderr.write(`${error.stack ?? error.message}\n`)
  }
  window.destroy()
  app.exit(error === undefined ? 0 : 1)
}

void app.whenReady().then(async () => {
  const window = new BrowserWindow({
    height: 800,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(__dirname, 'smoke-client-preload.cjs'),
      sandbox: false,
    },
    width: 1280,
  })
  const startedAt = Date.now()
  let settled = false

  const settle = error => {
    if (settled) return
    settled = true
    finish(window, error)
  }

  window.webContents.on('render-process-gone', (_event, details) => {
    settle(new Error(`Chromium renderer exited: ${details.reason}`))
  })
  window.webContents.on('did-fail-load', (_event, code, description) => {
    settle(new Error(`Chromium failed to load DSH (${code}): ${description}`))
  })

  await window.loadURL(runtimeUrl)
  const poll = async () => {
    if (settled) return
    try {
      const state = await window.webContents.executeJavaScript(`(() => ({
        body: document.body?.innerText ?? '',
        ready: document.documentElement.dataset.ohDshDesktop === 'true',
      }))()`)
      if (state.ready === true) {
        settle()
        return
      }
      if (state.body.includes('Failed to load plugins')) {
        settle(new Error(state.body.trim()))
        return
      }
      if (Date.now() - startedAt >= timeoutMs) {
        settle(new Error(`DSH Chromium client graph timed out:\n${state.body.trim()}`))
        return
      }
    } catch (error) {
      settle(error instanceof Error ? error : new Error(String(error)))
      return
    }
    setTimeout(() => { void poll() }, 100)
  }
  await poll()
}).catch(error => {
  process.stderr.write(`${error.stack ?? String(error)}\n`)
  app.exit(1)
})
