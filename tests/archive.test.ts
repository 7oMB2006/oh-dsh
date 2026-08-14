import assert from 'node:assert/strict'
import { test } from 'node:test'
import { portableZipArguments } from '../src/archive.ts'

test('portable ZIP archives store runtime symlinks without expanding them', () => {
  assert.deepEqual(
    portableZipArguments('release.zip', 'release-directory'),
    ['-qry', '-y', 'release.zip', 'release-directory'],
  )
})
