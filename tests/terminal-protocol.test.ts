import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DESKTOP_TERMINAL_WS_PATH } from '../plugins/desktop-shell/src/terminal/endpoint.ts'
import { MAX_INPUT_BYTES, parseClientFrame } from '../plugins/desktop-shell/src/terminal/protocol.ts'

test('desktop terminal uses its own bounded protocol endpoint', () => {
  assert.equal(DESKTOP_TERMINAL_WS_PATH, '/oh-dsh-desktop/terminal/ws')
  assert.deepEqual(parseClientFrame(JSON.stringify({ type: 'start', cols: 100, rows: 30, cwd: '/tmp' })), {
    type: 'start',
    cols: 100,
    rows: 30,
    cwd: '/tmp',
  })
  assert.throws(
    () => parseClientFrame(JSON.stringify({ type: 'input', data: 'x'.repeat(MAX_INPUT_BYTES + 1) })),
    /input exceeds/,
  )
  assert.throws(() => parseClientFrame(JSON.stringify({ type: 'resize', cols: 1, rows: 30 })), /cols>=2/)
})
