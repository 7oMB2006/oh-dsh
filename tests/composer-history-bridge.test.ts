import assert from 'node:assert/strict'
import { test } from 'node:test'
import { composerInputForSession } from '../plugins/sidebar/src/client/composer-history-bridge.ts'

test('resolves the session-scoped public composer input', () => {
  const scope = { id: 'session' }
  let received: unknown
  let draft = ''
  const input = composerInputForSession({
    get: () => ({ input: { for: (context: unknown) => {
      received = context
      return { setDraft: (value: string) => { draft = value } }
    } } }),
  }, { scope: () => scope }, 'session')
  assert.notEqual(input, undefined)
  input?.setDraft('recalled message')
  assert.equal(received, scope)
  assert.equal(draft, 'recalled message')
})
test('degrades without a scope, service, or usable conversation input', () => {
  assert.equal(composerInputForSession({ get: () => undefined }, {}, 'session'), undefined)
  assert.equal(composerInputForSession({ get: () => undefined }, { scope: () => ({}) }, 'session'), undefined)
  assert.equal(composerInputForSession({
    get: () => { throw new Error('old runtime') },
  }, { scope: () => ({}) }, 'session'), undefined)
})
