import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  desktopLaunchSpec,
  main,
} from '../src/cli.ts'

function output(): { stream: NodeJS.WriteStream; text: () => string } {
  let value = ''
  return {
    stream: {
      isTTY: false,
      write: (chunk: string) => {
        value += chunk
        return true
      },
    } as unknown as NodeJS.WriteStream,
    text: () => value,
  }
}

test('ohdsh dispatches desktop and web through one surface command', async () => {
  const stdout = output()
  const stderr = output()
  const calls: Array<{ args: readonly string[]; surface: string }> = []

  assert.equal(await main(
    ['desktop', '--inspect'],
    {},
    stdout.stream,
    stderr.stream,
    async args => {
      calls.push({ args, surface: 'desktop' })
      return 0
    },
    async args => {
      calls.push({ args, surface: 'web' })
      return 0
    },
  ), 0)
  assert.equal(await main(
    ['web', '--port', '0'],
    {},
    stdout.stream,
    stderr.stream,
    async () => 0,
    async args => {
      calls.push({ args, surface: 'web' })
      return 0
    },
  ), 0)
  assert.deepEqual(calls, [
    { args: ['--inspect'], surface: 'desktop' },
    { args: ['--port', '0'], surface: 'web' },
  ])
})

test('ohdsh reports the planned TUI without pretending to start it', async () => {
  const stdout = output()
  const stderr = output()
  assert.equal(await main(
    ['tui'],
    {},
    stdout.stream,
    stderr.stream,
  ), 2)
  assert.match(stderr.text(), /planned but is not available yet/)
})

test('desktop launch keeps source and installed macOS paths distinct', () => {
  assert.deepEqual(desktopLaunchSpec([], {
    OH_DSH_DESKTOP_APP: '/Applications/Oh-DSH Desktop.app',
  }, 'darwin'), {
    args: ['/Applications/Oh-DSH Desktop.app'],
    command: '/usr/bin/open',
  })
  assert.deepEqual(desktopLaunchSpec([], {}, 'darwin'), {
    args: ['-a', 'Oh-DSH Desktop'],
    command: '/usr/bin/open',
  })
})

test('desktop launch resolves paths with target platform semantics', () => {
  assert.deepEqual(desktopLaunchSpec(['--inspect'], {
    OH_DSH_DESKTOP_APP: 'C:\\Tools\\Oh-DSH Desktop.exe',
  }, 'win32'), {
    args: ['--inspect'],
    command: 'C:\\Tools\\Oh-DSH Desktop.exe',
  })
})
