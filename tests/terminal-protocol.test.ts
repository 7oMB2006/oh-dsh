import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BETTER_SIDEBAR_TERMINAL_WS_PATH } from '../plugins/panel-controls/src/terminal/terminal-socket.ts'

test('desktop terminal uses the Better Sidebar host endpoint', () => {
  assert.equal(BETTER_SIDEBAR_TERMINAL_WS_PATH, '/sidebar/ws/terminal')
})
