import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  findExistingIssue,
  newerTagsThanPin,
  npmVersionsNewerThan,
  parseGitlinks,
  parseSubmodules,
  parseTagVersion,
  watcherTitlePrefix,
} from '../scripts/watch-upstream.mjs'

test('parseSubmodules reads every pinned upstream record', () => {
  const entries = parseSubmodules(
    [
      '[submodule "upstream/DSH-better-sidebar"]',
      '\tpath = upstream/DSH-better-sidebar',
      '\turl = https://github.com/omdsh-dev/DSH-better-sidebar.git',
      '\tbranch = main',
      '[submodule "upstream/dsh-TUI"]',
      '\tpath = upstream/dsh-TUI',
      '\turl = https://github.com/ccch1mneyyy/dsh-TUI.git',
      '\tbranch = main',
    ].join('\n'),
  )

  assert.deepEqual(entries, [
    {
      name: 'upstream/DSH-better-sidebar',
      path: 'upstream/DSH-better-sidebar',
      url: 'https://github.com/omdsh-dev/DSH-better-sidebar.git',
      branch: 'main',
    },
    {
      name: 'upstream/dsh-TUI',
      path: 'upstream/dsh-TUI',
      url: 'https://github.com/ccch1mneyyy/dsh-TUI.git',
      branch: 'main',
    },
  ])
})

test('parseGitlinks maps submodule paths to pinned commits', () => {
  const links = parseGitlinks(
    [
      '160000 commit f0965e1d6157a3e06ed2f5c7775a64428d5d3c29\tupstream/DSH-better-sidebar',
      '160000 commit bdff0afb028d50c304e4474fd40f83b0721d50fd\tupstream/dsh-TUI',
      '100644 blob 0000000000000000000000000000000000000000\tsrc/other.ts',
    ].join('\n'),
  )

  assert.equal(links.size, 2)
  assert.equal(links.get('upstream/dsh-TUI'), 'bdff0afb028d50c304e4474fd40f83b0721d50fd')
})

test('npmVersionsNewerThan orders DSH pre-releases after their final release', () => {
  assert.deepEqual(
    npmVersionsNewerThan('0.1.1-rc.2', ['0.1.0', '0.1.1-rc.1', '0.1.1-rc.2', '0.1.1-rc.3', '0.1.1']),
    ['0.1.1', '0.1.1-rc.3'],
  )
  assert.deepEqual(npmVersionsNewerThan('0.1.1', ['0.1.1', '0.1.0-rc.7']), [])
})

test('parseTagVersion accepts v-prefixed semver tags only', () => {
  assert.equal(parseTagVersion('v0.15.0'), '0.15.0')
  assert.equal(parseTagVersion('0.8.2'), '0.8.2')
  assert.equal(parseTagVersion('nightly-20260823'), null)
})

test('newerTagsThanPin compares against the pinned tag when the pin is a tag', () => {
  const tags = [
    { name: 'v0.15.0', sha: 'a'.repeat(40), date: null },
    { name: 'v0.16.0', sha: 'b'.repeat(40), date: null },
    { name: 'nightly', sha: 'c'.repeat(40), date: null },
  ]

  const newer = newerTagsThanPin({
    tags,
    pinnedSha: 'a'.repeat(40),
    pinnedTag: 'v0.15.0',
    pinnedDate: null,
  })

  assert.deepEqual(newer.map((tag) => tag.name), ['v0.16.0'])
})

test('newerTagsThanPin falls back to the pinned commit date past a tag pin', () => {
  const tags = [
    { name: 'v0.8.2', sha: 'a'.repeat(40), date: '2026-07-01T00:00:00Z' },
    { name: 'v0.8.8', sha: 'b'.repeat(40), date: '2026-08-20T00:00:00Z' },
    { name: 'v0.9.0', sha: 'c'.repeat(40), date: '2026-06-01T00:00:00Z' },
  ]

  const newer = newerTagsThanPin({
    tags,
    pinnedSha: 'd'.repeat(40),
    pinnedTag: undefined,
    pinnedDate: '2026-08-01T00:00:00Z',
  })

  assert.deepEqual(newer.map((tag) => tag.name), ['v0.8.8'])
})

test('watcher issues deduplicate by subject-key title prefix', () => {
  const openTitles = [
    '[upstream-watch] @deepseek-ai/dsh has newer releases (pinned 0.1.1-rc.2)',
    'Unrelated issue title',
  ]

  assert.equal(
    findExistingIssue(openTitles, '@deepseek-ai/dsh'),
    '[upstream-watch] @deepseek-ai/dsh has newer releases (pinned 0.1.1-rc.2)',
  )
  assert.equal(findExistingIssue(openTitles, 'upstream/dsh-TUI'), null)
  assert.equal(watcherTitlePrefix('upstream/dsh-TUI'), '[upstream-watch] upstream/dsh-TUI')
})
