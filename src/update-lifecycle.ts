import type { DesktopUpdateCommand, DesktopUpdateState } from './contracts.ts'

interface UpdateCommandTarget {
  command(command: DesktopUpdateCommand): Promise<DesktopUpdateState>
}

/** Route an immediate install through the application's before-quit lifecycle. */
export async function scheduleImmediateUpdateInstall(
  manager: UpdateCommandTarget,
  quit: () => void,
): Promise<DesktopUpdateState> {
  const state = await manager.command({ type: 'install-on-quit' })
  if (state.status === 'scheduled') quit()
  return state
}

/** Ensure concurrent callers share one asynchronous cleanup operation. */
export function singleFlight<T>(operation: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined
  return () => {
    if (pending !== undefined) return pending
    const current = operation()
    pending = current
    void current.then(
      () => { if (pending === current) pending = undefined },
      () => { if (pending === current) pending = undefined },
    )
    return current
  }
}
