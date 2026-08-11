import { spawn, type ChildProcessByStdio } from 'node:child_process'
import { EventEmitter } from 'node:events'
import type { Readable } from 'node:stream'

const READY_LINE = /^dsh web: (http:\/\/127\.0\.0\.1:\d+)(?:\s|$)/

/** Process launch contract for the packaged DSH runtime. */
export interface DshRuntimeOptions {
  args: string[]
  cliEntry: string
  cwd: string
  env: NodeJS.ProcessEnv
  nodeBinary: string
  readyTimeoutMs?: number
  onLog?: (stream: 'stderr' | 'stdout', line: string) => void
}

/** Exit details emitted after an already-ready runtime terminates. */
export interface RuntimeExit {
  code: number | null
  signal: NodeJS.Signals | null
}

interface Deferred<T> {
  promise: Promise<T>
  reject(reason: unknown): void
  resolve(value: T): void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, reject, resolve }
}

function lineReader(consume: (line: string) => void): (chunk: Buffer) => void {
  let pending = ''
  return (chunk: Buffer): void => {
    pending += chunk.toString('utf8')
    for (let newline = pending.indexOf('\n'); newline >= 0; newline = pending.indexOf('\n')) {
      const line = pending.slice(0, newline).replace(/\r$/, '')
      pending = pending.slice(newline + 1)
      consume(line)
    }
  }
}

/** Supervise one DSH Host process and expose its loopback readiness URL. */
export class DshRuntimeSupervisor extends EventEmitter {
  private child: ChildProcessByStdio<null, Readable, Readable> | undefined
  private readonly options: DshRuntimeOptions
  private ready = false

  constructor(options: DshRuntimeOptions) {
    super()
    this.options = options
  }

  /** Whether a child process is currently owned by this supervisor. */
  get running(): boolean {
    return this.child !== undefined
  }

  /** Start DSH and resolve only after the bundle's post-settlement URL line. */
  async start(): Promise<URL> {
    if (this.child !== undefined) throw new Error('DSH runtime is already running')
    this.ready = false
    const child = spawn(this.options.nodeBinary, [this.options.cliEntry, ...this.options.args], {
      cwd: this.options.cwd,
      env: this.options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    this.child = child
    const readiness = deferred<URL>()
    let settled = false
    const settleFailure = (error: Error): void => {
      if (settled) return
      settled = true
      readiness.reject(error)
    }
    const consume = (stream: 'stderr' | 'stdout', line: string): void => {
      this.options.onLog?.(stream, line)
      this.emit('log', stream, line)
      if (stream !== 'stdout' || settled) return
      const match = READY_LINE.exec(line)
      if (match?.[1] === undefined) return
      settled = true
      this.ready = true
      readiness.resolve(new URL(match[1]))
    }
    child.stdout.on('data', lineReader(line => { consume('stdout', line) }))
    child.stderr.on('data', lineReader(line => { consume('stderr', line) }))
    child.once('error', (error) => {
      settleFailure(new Error(`failed to launch DSH runtime: ${error.message}`, { cause: error }))
    })
    child.once('exit', (code, signal) => {
      if (this.child === child) this.child = undefined
      if (!this.ready) {
        settleFailure(new Error(`DSH runtime exited before readiness (code=${String(code)}, signal=${String(signal)})`))
      } else {
        this.ready = false
        this.emit('exit', { code, signal } satisfies RuntimeExit)
      }
    })
    const timeout = setTimeout(() => {
      settleFailure(new Error(`DSH runtime did not become ready within ${String(this.options.readyTimeoutMs ?? 45_000)} ms`))
      child.kill('SIGTERM')
    }, this.options.readyTimeoutMs ?? 45_000)
    try {
      return await readiness.promise
    } finally {
      clearTimeout(timeout)
    }
  }

  /** Stop DSH gracefully, escalating only after the bounded teardown window. */
  async stop(timeoutMs = 8_000): Promise<void> {
    const child = this.child
    if (child === undefined) return
    const exited = new Promise<void>((resolve) => { child.once('exit', () => { resolve() }) })
    child.kill('SIGTERM')
    let timer: NodeJS.Timeout | undefined
    const timedOut = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => { resolve('timeout') }, timeoutMs)
    })
    const result = await Promise.race([exited.then(() => 'exit' as const), timedOut])
    if (timer !== undefined) clearTimeout(timer)
    if (result === 'timeout' && child.exitCode === null) {
      child.kill('SIGKILL')
      await exited
    }
    if (this.child === child) this.child = undefined
    this.ready = false
  }
}

/** Run a bounded, non-interactive DSH command such as profile plugin install. */
export async function runDshCommand(
  options: Omit<DshRuntimeOptions, 'args'>,
  args: string[],
  timeoutMs = 120_000,
): Promise<{ stderr: string; stdout: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(options.nodeBinary, [options.cliEntry, ...args], {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`DSH command timed out after ${String(timeoutMs)} ms`))
    }, timeoutMs)
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      if (code === 0) resolve({ stderr, stdout })
      else reject(new Error(
        `DSH command failed (code=${String(code)}, signal=${String(signal)})\n${stderr || stdout}`,
      ))
    })
  })
}
