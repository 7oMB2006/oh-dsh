import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

test('terminal viewport cannot expose xterm default black behind the themed screen', () => {
  const css = readFileSync(join(root, 'plugins/panel-controls/src/terminal/terminal.css'), 'utf8')
  assert.match(css, /\.oh-dsh-terminal-view \.xterm-viewport[\s\S]*background-color:[^;]+!important/)
  assert.match(css, /\.oh-dsh-terminal-view \{[\s\S]*padding: 9px 12px;/)
  assert.doesNotMatch(css, /\.oh-dsh-terminal-view \.xterm \{[^}]*padding:/)
})
