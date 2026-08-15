import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  historyDirectionForKey,
  isAtHistoryBoundary,
} from '../plugins/sidebar/src/client/composer-history-keyboard.ts'

function key(keyName: string, options: Partial<Parameters<typeof historyDirectionForKey>[0]> = {}) {
  return {
    altKey: false,
    ctrlKey: false,
    isComposing: false,
    key: keyName,
    metaKey: false,
    shiftKey: false,
    ...options,
  }
}

test('recognizes only unmodified non-IME history arrows', () => {
  assert.equal(historyDirectionForKey(key('ArrowUp')), 'older')
  assert.equal(historyDirectionForKey(key('ArrowDown')), 'newer')
  assert.equal(historyDirectionForKey(key('ArrowUp', { shiftKey: true })), null)
  assert.equal(historyDirectionForKey(key('ArrowDown', { isComposing: true })), null)
  assert.equal(historyDirectionForKey(key('Enter')), null)
})
test('uses history only from an empty draft or while browsing a recalled entry', () => {
  const multiline = 'first\nsecond\nthird'
  assert.equal(isAtHistoryBoundary({ value: '', selectionStart: 0, selectionEnd: 0 }, 'older'), true)
  assert.equal(
    isAtHistoryBoundary({ value: '', selectionStart: 0, selectionEnd: 0 }, 'newer'),
    true,
  )
  assert.equal(isAtHistoryBoundary({ value: multiline, selectionStart: 0, selectionEnd: 0 }, 'older'), false)
  assert.equal(
    isAtHistoryBoundary({ value: multiline, selectionStart: multiline.length, selectionEnd: multiline.length }, 'newer'),
    false,
  )
  assert.equal(isAtHistoryBoundary({ value: multiline, selectionStart: 0, selectionEnd: 0 }, 'older', true), true)
  assert.equal(
    isAtHistoryBoundary({ value: multiline, selectionStart: multiline.length, selectionEnd: multiline.length }, 'newer', true),
    true,
  )
  assert.equal(isAtHistoryBoundary({ value: multiline, selectionStart: 7, selectionEnd: 7 }, 'older', true), false)
  assert.equal(isAtHistoryBoundary({ value: multiline, selectionStart: 7, selectionEnd: 7 }, 'newer', true), false)
  assert.equal(isAtHistoryBoundary({ value: multiline, selectionStart: 0, selectionEnd: 2 }, 'older'), false)
})
