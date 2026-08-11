import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { spawn } from 'node-pty'
import { WebSocket, WebSocketServer } from 'ws'
import { DESKTOP_TERMINAL_WS_PATH } from './endpoint.ts'
import { encodeServerMessage, parseClientFrame, type TerminalServerMessage } from './protocol.ts'
import { TerminalSession } from './pty-session.ts'

export interface DesktopTerminalContext {
  httpServer: {
    registerUpgrade(route: {
      path: string
      handler: (request: IncomingMessage, socket: Duplex, head: Buffer) => void
    }): () => void
  }
  logger: {
    debug(message: string): void
    warn(message: string): void
  }
}

function rejectCrossOrigin(request: IncomingMessage, socket: Duplex): boolean {
  const origin = request.headers.origin
  const host = request.headers.host
  if (origin === undefined || host === undefined) return false
  try {
    if (new URL(origin).host === host) return false
  } catch {
    // A malformed origin is untrusted.
  }
  socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
  return true
}

/** Register the desktop terminal upgrade route and own all spawned sessions. */
export function mountDesktopTerminal(context: DesktopTerminalContext): () => void {
  const server = new WebSocketServer({ noServer: true, maxPayload: 128 * 1024 })
  let nextSessionId = 0

  server.on('connection', (socket) => {
    const send = (message: TerminalServerMessage): void => {
      if (socket.readyState === WebSocket.OPEN) socket.send(encodeServerMessage(message))
    }
    const session = new TerminalSession({
      spawn,
      platform: process.platform,
      environment: {
        ...process.env,
        TERM: process.env.TERM ?? 'xterm-256color',
        COLORTERM: process.env.COLORTERM ?? 'truecolor',
        TERM_PROGRAM: 'Oh-DSH-Desktop',
        PROMPT_EOL_MARK: '',
        BASH_SILENCE_DEPRECATION_WARNING: '1',
      },
      defaultCwd: process.cwd(),
      send,
      log: message => { context.logger.debug(`[desktop-terminal] ${message}`) },
    })
    socket.on('message', (data, isBinary) => {
      try {
        if (isBinary) throw new Error('binary frames are not supported')
        const message = parseClientFrame(data.toString())
        if (message.type === 'start') {
          nextSessionId += 1
          session.start(message, `desktop-terminal-${String(nextSessionId)}`)
        } else {
          session.handle(message)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        context.logger.warn(`[desktop-terminal] ${message}`)
        send({ type: 'error', message })
        socket.close(1008, 'protocol violation')
      }
    })
    socket.on('close', () => { session.dispose() })
    socket.on('error', (error) => {
      context.logger.warn(`[desktop-terminal] websocket error: ${error.message}`)
    })
  })

  const disposeRoute = context.httpServer.registerUpgrade({
    path: DESKTOP_TERMINAL_WS_PATH,
    handler: (request, socket, head) => {
      if (rejectCrossOrigin(request, socket)) return
      server.handleUpgrade(request, socket, head, (webSocket) => {
        server.emit('connection', webSocket, request)
      })
    },
  })

  return () => {
    disposeRoute()
    for (const client of server.clients) client.terminate()
    server.close()
  }
}
