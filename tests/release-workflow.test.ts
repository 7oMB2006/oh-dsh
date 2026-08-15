import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { validateReleaseTag } from '../scripts/validate-release-tag.mjs'

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
  assert.match(workflow, /validate-release-tag\.mjs --tag/)
})

test('release tags must match a stable package version', () => {
  assert.equal(validateReleaseTag('v1.2.3', '1.2.3'), '1.2.3')
  assert.throws(() => validateReleaseTag('v1.2.3-beta.1', '1.2.3-beta.1'), /stable semver/)
  assert.throws(() => validateReleaseTag('v1.2.4', '1.2.3'), /does not match package version/)
})
