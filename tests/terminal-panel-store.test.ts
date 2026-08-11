import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createDockStore,
  nextTabId,
  panelReducer,
  type TerminalPanelState,
} from '../plugins/panel-controls/src/terminal/panel-store.ts'

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()
  get length(): number { return this.values.size }
  clear(): void { this.values.clear() }
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null }
  removeItem(key: string): void { this.values.delete(key) }
  setItem(key: string, value: string): void { this.values.set(key, value) }
}

test('terminal tabs survive activation and close their own state only', () => {
  const initial: TerminalPanelState = {
    collapsed: false,
    size: 280,
    fontFamily: 'monospace',
    fontSize: 13,
    tabs: [],
    activeTabId: null,
  }
  const first = nextTabId()
  const second = nextTabId()
  const withTabs = panelReducer(panelReducer(initial, { type: 'add-tab', id: first }), { type: 'add-tab', id: second })
  const activated = panelReducer(withTabs, { type: 'activate-tab', id: first })
  const closed = panelReducer(activated, { type: 'remove-tab', id: first })
  assert.deepEqual(closed.tabs.map(tab => tab.id), [second])
  assert.equal(closed.activeTabId, second)
})

test('terminal dock preferences are scoped per DSH session', () => {
  const storage = new MemoryStorage()
  const first = createDockStore(storage, 'session-a')
  const second = createDockStore(storage, 'session-b')
  first.dispatch({ type: 'set-size', size: 420 })
  first.dispatch({ type: 'set-collapsed', collapsed: false })
  assert.equal(createDockStore(storage, 'session-a').getState().size, 420)
  assert.equal(createDockStore(storage, 'session-a').getState().collapsed, false)
  assert.equal(second.getState().size, 280)
  assert.equal(second.getState().collapsed, true)
})
