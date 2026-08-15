import assert from 'node:assert/strict'
import { test } from 'node:test'
import { InputHistory } from '../plugins/sidebar/src/client/input-history.ts'

function entry(id: string, value: string) {
  return { id, value }
}

test('navigates older and newer entries and restores the draft', () => {
  const history = new InputHistory()
  history.seed(['first', 'second', 'third'])
  assert.equal(history.navigate('older', 'draft').value, 'third')
  assert.equal(history.navigate('older', 'third').value, 'second')
  assert.equal(history.navigate('older', 'second').value, 'first')
  assert.equal(history.navigate('older', 'first').changed, false)
  assert.equal(history.navigate('newer', 'first').value, 'second')
  assert.equal(history.navigate('newer', 'second').value, 'third')
  assert.equal(history.navigate('newer', 'third').value, 'draft')
  assert.equal(history.navigate('newer', 'draft').changed, false)
})

test('deduplicates consecutive entries, ignores blanks, and bounds memory', () => {
  const history = new InputHistory(2)
  history.seed(['  ', ' a ', ' a ', 'b', 'c'])
  assert.deepEqual(history.snapshot().entries, ['b', 'c'])
})

test('synchronizes the authoritative session window without losing the selected entry', () => {
  const history = new InputHistory()
  history.synchronize([
    entry('newer', 'newer'),
    entry('newest', 'newest'),
  ])
  assert.equal(history.navigate('older', 'draft').value, 'newest')
  history.synchronize([
    entry('older', 'older'),
    entry('newer', 'newer'),
    entry('newest', 'newest'),
  ])
  assert.equal(history.snapshot().cursor, 2)
  assert.equal(history.navigate('older', 'newest').value, 'newer')
})

test('retains the selected repeated message across a snapshot refresh', () => {
  const history = new InputHistory()
  history.synchronize([
    entry('first', 'repeat'),
    entry('middle', 'middle'),
    entry('last', 'repeat'),
  ])
  assert.equal(history.navigate('older', '').value, 'repeat')
  assert.equal(history.navigate('older', 'repeat').value, 'middle')
  assert.equal(history.navigate('older', 'middle').value, 'repeat')
  assert.equal(history.snapshot().cursor, 0)

  history.synchronize([
    entry('first', 'repeat'),
    entry('middle', 'middle'),
    entry('last', 'repeat'),
  ])

  assert.equal(history.snapshot().cursor, 0)
  assert.equal(history.navigate('older', 'repeat').changed, false)
  assert.equal(history.navigate('newer', 'repeat').value, 'middle')
})

test('resetting navigation preserves entries but abandons the draft', () => {
  const history = new InputHistory()
  history.record('message')
  assert.equal(history.navigate('older', 'draft').value, 'message')
  history.resetNavigation()
  assert.equal(history.snapshot().cursor, null)
  assert.equal(history.snapshot().draft, null)
  assert.equal(history.navigate('newer', 'message').changed, false)
})

test('rejects invalid limits', () => {
  assert.throws(() => new InputHistory(0), RangeError)
  assert.throws(() => new InputHistory(1.5), RangeError)
})
