/** Bounded JSON protocol shared by the desktop PTY host and terminal client. */

export const MAX_INPUT_BYTES = 64 * 1024
export const MAX_FRAME_BYTES = 128 * 1024
export const MAX_COLS = 1000
export const MAX_ROWS = 500

export interface TerminalStartMessage {
  type: 'start'
  cols: number
  rows: number
  cwd?: string
  shell?: string
}

export interface TerminalInputMessage {
  type: 'input'
  data: string
}

export interface TerminalResizeMessage {
  type: 'resize'
  cols: number
  rows: number
}

export type TerminalClientMessage = TerminalStartMessage
  | TerminalInputMessage
  | TerminalResizeMessage
  | { type: 'kill' }
  | { type: 'ping' }

export type TerminalServerMessage = {
  type: 'ready'
  sessionId: string
  pid: number
  shell: string
  cwd: string
} | {
  type: 'output'
  data: string
} | {
  type: 'exit'
  code: number | null
} | {
  type: 'error'
  message: string
} | {
  type: 'pong'
}

function terminalSize(message: Record<string, unknown>, operation: 'start' | 'resize'): { cols: number; rows: number } {
  const cols = Number(message.cols)
  const rows = Number(message.rows)
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || rows < 1) {
    throw new Error(`${operation} requires integer cols>=2 and rows>=1`)
  }
  if (cols > MAX_COLS || rows > MAX_ROWS) {
    throw new Error(`terminal size exceeds ${MAX_COLS}x${MAX_ROWS}`)
  }
  return { cols, rows }
}

/** Parse and validate one untrusted client frame. */
export function parseClientFrame(raw: string): TerminalClientMessage {
  if (Buffer.byteLength(raw, 'utf8') > MAX_FRAME_BYTES) {
    throw new Error(`frame exceeds ${MAX_FRAME_BYTES} bytes`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('frame is not valid JSON')
  }
  if (typeof parsed !== 'object' || parsed === null) throw new Error('frame must be a JSON object')
  const message = parsed as Record<string, unknown>
  switch (message.type) {
    case 'start': {
      const size = terminalSize(message, 'start')
      const cwd = typeof message.cwd === 'string' && message.cwd.length > 0 ? message.cwd : undefined
      const shell = typeof message.shell === 'string' && message.shell.length > 0 ? message.shell : undefined
      return {
        type: 'start',
        ...size,
        ...(cwd === undefined ? {} : { cwd }),
        ...(shell === undefined ? {} : { shell }),
      }
    }
    case 'input':
      if (typeof message.data !== 'string') throw new Error('input requires string data')
      if (Buffer.byteLength(message.data, 'utf8') > MAX_INPUT_BYTES) {
        throw new Error(`input exceeds ${MAX_INPUT_BYTES} bytes`)
      }
      return { type: 'input', data: message.data }
    case 'resize':
      return { type: 'resize', ...terminalSize(message, 'resize') }
    case 'kill':
      return { type: 'kill' }
    case 'ping':
      return { type: 'ping' }
    default:
      throw new Error(`unknown message type "${String(message.type)}"`)
  }
}

export function encodeServerMessage(message: TerminalServerMessage): string {
  return JSON.stringify(message)
}
