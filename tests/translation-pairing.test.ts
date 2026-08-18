import assert from 'node:assert/strict'
import test from 'node:test'
import { isTranslationScopeFile } from '../scripts/translation-pairing.ts'

test('bilingual discovery excludes dependencies and generated releases', () => {
  assert.equal(isTranslationScopeFile('docs/design.md'), true)
  assert.equal(
    isTranslationScopeFile('.agents/notes/implemented/process/example.md'),
    true,
  )
  assert.equal(isTranslationScopeFile('upstream/dsh-TUI/README.md'), false)
  assert.equal(isTranslationScopeFile('release/oh-dsh-tui/README.md'), false)
  assert.equal(isTranslationScopeFile('.stage/dsh-runtime/README.md'), false)
  assert.equal(isTranslationScopeFile('web/dist/README.md'), false)
})
