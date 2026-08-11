import { existsSync, statSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import type { IPty } from 'node-pty'
import type { TerminalClientMessage, TerminalServerMessage } from './protocol.ts'
import { resolveShell } from './shell.ts'

export interface PtySpawn {
  (file: string, args: string[] | string, options: {
    name: string
    cols: number
    rows: number
    cwd?: string
    env: NodeJS.ProcessEnv
  }): IPty
}

export interface TerminalSessionDependencies {
  spawn: PtySpawn
  platform: NodeJS.Platform
  environment: NodeJS.ProcessEnv
  defaultCwd: string
  send: (message: TerminalServerMessage) => void
  log: (message: string) => void
}

type SessionPhase = 'idle' | 'running' | 'exited' | 'disposed'

/** One WebSocket owns exactly one PTY process. */
export class TerminalSession {
  private readonly dependencies: TerminalSessionDependencies
  private phase: SessionPhase = 'idle'
  private pty: IPty | undefined
  private dataSubscription: { dispose(): void } | undefined
  private exitSubscription: { dispose(): void } | undefined

  constructor(dependencies: TerminalSessionDependencies) {
    this.dependencies = dependencies
  }

  private resolveCwd(requested: string | undefined): string {
    if (requested !== undefined && isAbsolute(requested) && existsSync(requested)) {
      try {
        if (statSync(requested).isDirectory()) return requested
      } catch {
        // Fall back to the desktop runtime cwd when the directory races away.
      }
    }
    return this.dependencies.defaultCwd
  }

  start(request: Extract<TerminalClientMessage, { type: 'start' }>, sessionId: string): void {
    if (this.phase !== 'idle') {
      this.dependencies.send({ type: 'error', message: 'session already started' })
      return
    }
    const shell = resolveShell(this.dependencies.platform, this.dependencies.environment, request.shell)
    const cwd = this.resolveCwd(request.cwd)
    let pty: IPty
    try {
      pty = this.dependencies.spawn(shell.path, shell.args, {
        name: 'xterm-256color',
        cols: request.cols,
        rows: request.rows,
        cwd,
        env: this.dependencies.environment,
      })
    } catch (error) {
      this.phase = 'exited'
      this.dependencies.log(`spawn failed: ${error instanceof Error ? error.message : String(error)}`)
      this.dependencies.send({ type: 'error', message: `failed to spawn ${shell.path}` })
      return
    }
    this.phase = 'running'
    this.pty = pty
    this.dataSubscription = pty.onData((data) => {
      this.dependencies.send({ type: 'output', data })
    })
    this.exitSubscription = pty.onExit(({ exitCode }) => {
      this.phase = 'exited'
      this.pty = undefined
      this.dependencies.send({ type: 'exit', code: exitCode })
    })
    this.dependencies.send({
      type: 'ready',
      sessionId,
      pid: pty.pid,
      shell: shell.path,
      cwd,
    })
  }

  handle(message: Exclude<TerminalClientMessage, { type: 'start' }>): void {
    if (message.type === 'ping') {
      this.dependencies.send({ type: 'pong' })
      return
    }
    if (this.phase !== 'running' || this.pty === undefined) {
      this.dependencies.send({ type: 'error', message: 'terminal is not running' })
      return
    }
    switch (message.type) {
      case 'input':
        this.pty.write(message.data)
        return
      case 'resize':
        this.pty.resize(message.cols, message.rows)
        return
      case 'kill':
        this.pty.kill()
        return
    }
  }

  dispose(): void {
    if (this.phase === 'disposed') return
    this.phase = 'disposed'
    const pty = this.pty
    this.pty = undefined
    this.dataSubscription?.dispose()
    this.exitSubscription?.dispose()
    this.dataSubscription = undefined
    this.exitSubscription = undefined
    if (pty === undefined) return
    try {
      pty.kill()
    } catch (error) {
      this.dependencies.log(`kill failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
