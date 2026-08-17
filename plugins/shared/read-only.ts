/**
 * Host-side read-only guard for Oh-DSH viewer surfaces.
 *
 * When another Oh-DSH surface owns the shared data root, a later surface may
 * start in read-only mode so it can inspect existing history without
 * corrupting an active session log. This helper blocks durable session writes
 * in the viewer runtime.
 *
 * @module oh-dsh/read-only
 */

interface ReadOnlyPersistence {
  create(...args: unknown[]): Promise<unknown>
  append(...args: unknown[]): Promise<unknown>
}

interface ReadOnlyInjectedContext {
  get(name: string): unknown
}

interface ReadOnlyHostContext {
  // Host plugins declare different injected context shapes. The guard only
  // needs `get` at runtime, so accept the callback context loosely here.
  inject(names: string[], callback: (ctx: any) => void): void
}

function readOnlyError(): Error {
  return new Error(
    'This Oh-DSH surface is in read-only mode because another surface '
    + 'owns the active session.',
  )
}

/** Install write blocking when the runtime was launched as a viewer. */
export function mountReadOnlyGuard(ctx: ReadOnlyHostContext): void {
  if (process.env.OH_DSH_READ_ONLY !== '1') return
  ctx.inject(['sessionPersistence'], persistenceCtx => {
    const persistence = persistenceCtx.get('sessionPersistence') as
      ReadOnlyPersistence | undefined
    if (persistence === undefined) return
    persistence.create = async () => { throw readOnlyError() }
    persistence.append = async () => { throw readOnlyError() }
  })
}
