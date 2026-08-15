import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ComposerInputHistory,
  submittedInputEntries,
  type ComposerHistorySession,
} from '../plugins/sidebar/src/client/composer-input-history.ts'

test('reads only confirmed text user messages in chronological order', () => {
  assert.deepEqual(submittedInputEntries([
    { kind: 'command', seq: 1, content: [{ type: 'text', text: '/help' }] },
    { kind: 'user', seq: 2, content: [{ type: 'image' }, { type: 'text', text: 'first' }] },
    { kind: 'user', seq: 3, content: [{ type: 'text', text: 'second ' }, { type: 'text', text: 'part' }] },
    { kind: 'steering', seq: 4, content: [{ type: 'text', text: 'follow up' }] },
    { kind: 'user', seq: 5, content: [{ type: 'text', text: '' }] },
  ]), [
    { id: '2', value: 'first' },
    { id: '3', value: 'second part' },
    { id: '4', value: 'follow up' },
  ])
})
test('keeps histories isolated by session', () => {
  const histories = new ComposerInputHistory()
  histories.synchronize('one', { nodes: [{ kind: 'user', seq: 1, content: [{ type: 'text', text: 'one' }] }] })
  histories.synchronize('two', { nodes: [{ kind: 'user', seq: 2, content: [{ type: 'text', text: 'two' }] }] })
  assert.equal(histories.forSession('one').navigate('older', '').value, 'one')
  assert.equal(histories.forSession('two').navigate('older', '').value, 'two')
})

test('loads one older page at a time only while capacity remains', async () => {
  let resolveLoad: (() => void) | undefined
  let loads = 0
  const session: ComposerHistorySession = {
    getSnapshot: () => ({ hasMore: true, loadingOlder: false }),
    loadOlder: async () => {
      loads += 1
      await new Promise<void>(resolve => { resolveLoad = resolve })
    },
  }
  const histories = new ComposerInputHistory(2)
  assert.equal(histories.requestOlder('session', session), true)
  assert.equal(histories.requestOlder('session', session), false)
  assert.equal(loads, 1)
  resolveLoad?.()
  await new Promise(resolve => { setImmediate(resolve) })
  assert.equal(histories.requestOlder('session', session), true)
  histories.synchronize('session', {
    nodes: [
      { kind: 'user', seq: 1, content: [{ type: 'text', text: 'older' }] },
      { kind: 'user', seq: 2, content: [{ type: 'text', text: 'newer' }] },
    ],
  })
  assert.equal(histories.requestOlder('session', session), false)
})
