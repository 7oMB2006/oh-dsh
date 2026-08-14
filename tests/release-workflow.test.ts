import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

test('tagged releases build and upload both TUI archive formats', () => {
  const workflow = readFileSync(
    join(root, '.github', 'workflows', 'release.yml'),
    'utf8',
  ).replace(/\r\n?/g, '\n')

  assert.match(workflow, /run: node scripts\/build-tui\.mjs/)
  assert.match(workflow, /release\/oh-dsh-tui-\*\.tar\.gz/)
  assert.match(workflow, /release\/oh-dsh-tui-\*\.zip/)
  assert.match(workflow, /fetch-depth: 0/)
  assert.match(workflow, /fetch-tags: true/)
})
