import { DESKTOP_TERMINAL_WS_PATH } from '../../../desktop-shell/src/terminal/endpoint.ts'
import type {
  TerminalClientMessage,
  TerminalServerMessage,
} from '../../../desktop-shell/src/terminal/protocol.ts'

export interface TerminalSocketHandlers {
  onOutput(data: string): void
  onReady(cwd: string): void
  onExit(code: number | null): void
  onError(message: string): void
}

export function terminalWebSocketUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}${DESKTOP_TERMINAL_WS_PATH}`
}

export class TerminalSocket {
  private readonly url: string
  private socket: WebSocket | undefined
  private status: 'connecting' | 'ready' | 'closed' = 'connecting'
  private readonly pendingOutput: string[] = []

  constructor(url = terminalWebSocketUrl()) {
    this.url = url
  }

  connect(
    cols: number,
    rows: number,
    handlers: TerminalSocketHandlers,
    options?: { cwd?: string; shell?: string },
  ): void {
    if (this.socket !== undefined) return
    const socket = new WebSocket(this.url)
    this.socket = socket
    this.status = 'connecting'
    socket.onopen = () => {
      this.send({
        type: 'start',
        cols,
        rows,
        ...(options?.cwd === undefined ? {} : { cwd: options.cwd }),
        ...(options?.shell === undefined ? {} : { shell: options.shell }),
      })
    }
    socket.onmessage = (event) => {
      if (typeof event.data !== 'string') return
      let message: TerminalServerMessage
      try {
        message = JSON.parse(event.data) as TerminalServerMessage
      } catch {
        handlers.onError('received an invalid terminal frame')
        return
      }
      switch (message.type) {
        case 'ready':
          this.status = 'ready'
          handlers.onReady(message.cwd)
          for (const output of this.pendingOutput) handlers.onOutput(output)
          this.pendingOutput.length = 0
          return
        case 'output':
          if (this.status === 'ready') handlers.onOutput(message.data)
          else if (this.pendingOutput.length < 1000) this.pendingOutput.push(message.data)
          return
        case 'exit':
          this.status = 'closed'
          handlers.onExit(message.code)
          return
        case 'error':
          handlers.onError(message.message)
          return
        case 'pong':
          return
      }
    }
    socket.onclose = () => {
      if (this.status === 'closed') return
      this.status = 'closed'
      handlers.onExit(null)
    }
    socket.onerror = () => { handlers.onError('connection failed') }
  }

  sendInput(data: string): void {
    this.send({ type: 'input', data })
  }

  sendResize(cols: number, rows: number): void {
    this.send({ type: 'resize', cols, rows })
  }

  close(): void {
    const socket = this.socket
    this.socket = undefined
    if (socket === undefined) return
    socket.onclose = null
    socket.onerror = null
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'kill' }))
    socket.close()
  }

  private send(message: TerminalClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message))
  }
}
