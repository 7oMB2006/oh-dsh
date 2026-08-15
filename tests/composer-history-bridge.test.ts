import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  composerInputForSession,
  hasOpenComposerTriggerMenu,
} from '../plugins/sidebar/src/client/composer-history-bridge.ts'

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

test('defers history navigation to an active input trigger menu', () => {
  const scope = { id: 'session' }
  assert.equal(hasOpenComposerTriggerMenu({
    sessionOf: context => {
      assert.equal(context, scope)
      return { menu: { getSnapshot: () => ({ open: true }) } }
    },
  }, { scope: () => scope }, 'session'), true)
  assert.equal(hasOpenComposerTriggerMenu({
    sessionOf: () => ({ menu: { getSnapshot: () => ({ open: false }) } }),
  }, { scope: () => scope }, 'session'), false)
})

test('degrades when input trigger menu capabilities are unavailable', () => {
  assert.equal(hasOpenComposerTriggerMenu(undefined, {}, 'session'), false)
  assert.equal(hasOpenComposerTriggerMenu({}, { scope: () => ({}) }, 'session'), false)
  assert.equal(hasOpenComposerTriggerMenu({
    sessionOf: () => { throw new Error('old runtime') },
  }, { scope: () => ({}) }, 'session'), false)
  assert.equal(hasOpenComposerTriggerMenu({}, {
    scope: () => { throw new Error('pruned session') },
  }, 'session'), false)
})
