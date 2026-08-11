import { useCallback, useSyncExternalStore } from 'react'
import type { LocaleService, Translate } from './i18n.ts'

/** Re-render a plugin component whenever the native DSH locale changes. */
export function useTranslate<Key extends string>(
  locale: LocaleService,
  translate: Translate<Key>,
): Translate<Key> {
  const subscribe = useCallback(
    (listener: () => void) => locale.subscribe(listener),
    [locale],
  )
  const getSnapshot = useCallback(
    () => locale.getSnapshot().revision,
    [locale],
  )
  useSyncExternalStore(subscribe, getSnapshot)
  return translate
}
