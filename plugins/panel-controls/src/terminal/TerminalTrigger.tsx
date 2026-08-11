import { useSyncExternalStore } from 'react'
import { openOrToggleTerminal } from './TerminalPanel.tsx'
import type { DockStore } from './panel-store.ts'

export function TerminalTrigger({ store }: { store: DockStore }): JSX.Element {
  const state = useSyncExternalStore(store.subscribe, store.getState)
  return (
    <button
      type="button"
      className="oh-dsh-terminal-trigger"
      aria-label="Toggle terminal"
      aria-pressed={!state.collapsed}
      title="Terminal (⌘J)"
      onClick={() => { openOrToggleTerminal(store) }}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <rect x="2.25" y="2.25" width="11.5" height="11.5" rx="2" />
        <path d="M2.75 10.25h10.5M5 6l2 2-2 2M8.5 10h2.5" />
      </svg>
    </button>
  )
}
