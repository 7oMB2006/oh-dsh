import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  mutateWorkspace,
  parseGitStatus,
  readWorkspaceDiff,
  readWorkspaceSnapshot,
} from '../plugins/desktop-sidebar/src/git-workspace.ts'
import {
  mapBetterSidebarFile,
  mapBetterSidebarTree,
} from '../plugins/desktop-sidebar/src/client/better-sidebar-api.ts'

function git(cwd: string, args: string[]): void {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr || result.stdout)
}

test('workspace tools project changes, diffs, branches, and commits', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'oh-dsh-workspace-tools-'))
  try {
    git(workspace, ['init', '-b', 'main'])
    git(workspace, ['config', 'user.name', 'Oh DSH Test'])
    git(workspace, ['config', 'user.email', 'oh-dsh@example.test'])
    writeFileSync(join(workspace, 'README.md'), 'first\n')
    git(workspace, ['add', 'README.md'])
    git(workspace, ['commit', '-m', 'initial'])
    writeFileSync(join(workspace, 'README.md'), 'second\n')
    writeFileSync(join(workspace, 'new.txt'), 'new\n')

    const snapshot = await readWorkspaceSnapshot(workspace)
    assert.equal(snapshot.kind, 'repository')
    assert.equal(snapshot.branch, 'main')
    assert.deepEqual(snapshot.changes.map(change => [change.path, change.status]), [
      ['new.txt', 'untracked'],
      ['README.md', 'modified'],
    ])
    assert.match(await readWorkspaceDiff(workspace, 'README.md'), /-first[\s\S]*\+second/)

    const committed = await mutateWorkspace(workspace, { action: 'commit', message: 'workspace panel commit' })
    assert.equal(committed.snapshot.changes.length, 0)
    const branched = await mutateWorkspace(workspace, { action: 'create-branch', branch: 'panel-test' })
    assert.equal(branched.snapshot.branch, 'panel-test')
    assert.ok(branched.snapshot.branches.includes('main'))
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('porcelain status parser preserves staged and rename metadata', () => {
  assert.deepEqual(parseGitStatus('M  staged.ts\0R  renamed.ts\0old.ts\0?? loose.txt\0'), [
    { path: 'loose.txt', oldPath: null, status: 'untracked', staged: false },
    { path: 'renamed.ts', oldPath: 'old.ts', status: 'renamed', staged: true },
    { path: 'staged.ts', oldPath: null, status: 'modified', staged: true },
  ])
})

test('workspace files adapt Better Sidebar responses to the Oh-DSH UI', () => {
  const root = mapBetterSidebarTree('/workspace', {
    path: '/workspace/src',
    entries: [
      { name: 'nested', path: '/workspace/src/nested', isDir: true, hidden: false },
      { name: 'index.ts', path: '/workspace/src/index.ts', isDir: false, hidden: false },
    ],
    truncated: false,
  })
  assert.equal(root.kind, 'directory')
  if (root.kind !== 'directory') return
  assert.equal(root.parent, '/workspace')
  assert.deepEqual(root.entries.map(entry => [entry.name, entry.kind]), [
    ['nested', 'directory'],
    ['index.ts', 'file'],
  ])
  const preview = mapBetterSidebarFile('/workspace', '/workspace/src/index.ts', {
    kind: 'text',
    content: 'export const ready = true\n',
    truncated: false,
  })
  assert.equal(preview.kind, 'file')
  if (preview.kind === 'file') assert.match(preview.content ?? '', /ready = true/)
})
