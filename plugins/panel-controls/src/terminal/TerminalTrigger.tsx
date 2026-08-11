import { useSyncExternalStore } from 'react'
import { openOrToggleTerminal } from './TerminalPanel.tsx'
import type { DockStore } from './panel-store.ts'
import type { LocaleService, Translate } from '../../../shared/i18n.ts'
import { useTranslate } from '../../../shared/use-i18n.ts'
import type { TerminalMessage } from './i18n.ts'

export function TerminalTrigger({
  locale,
  t: translate,
  store,
}: {
  locale: LocaleService
  t: Translate<TerminalMessage>
  store: DockStore
}): JSX.Element {
  const t = useTranslate(locale, translate)
  const state = useSyncExternalStore(store.subscribe, store.getState)
  return (
    <button
      type="button"
      className="oh-dsh-terminal-trigger"
      aria-label={t('terminal.toggle')}
      aria-pressed={!state.collapsed}
      title={`${t('terminal')} (⌘J)`}
      onClick={() => { openOrToggleTerminal(store) }}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <rect x="2.25" y="2.25" width="11.5" height="11.5" rx="2" />
        <path d="M2.75 10.25h10.5M5 6l2 2-2 2M8.5 10h2.5" />
      </svg>
    </button>
  )
}
