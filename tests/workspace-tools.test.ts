import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  mutateWorkspace,
  parseGitStatus,
  readWorkspaceDiff,
  readWorkspaceSnapshot,
} from '../plugins/workspace-tools/src/git-workspace.ts'
import { readWorkspaceFiles } from '../plugins/workspace-tools/src/workspace-files.ts'

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

test('workspace files stay bounded to the selected workspace', async () => {
  const parent = mkdtempSync(join(tmpdir(), 'oh-dsh-workspace-files-'))
  const workspace = join(parent, 'workspace')
  const outside = join(parent, 'outside.txt')
  try {
    mkdirSync(join(workspace, 'src'), { recursive: true })
    writeFileSync(join(workspace, 'src', 'index.ts'), 'export const ready = true\n')
    writeFileSync(outside, 'secret\n')
    symlinkSync(outside, join(workspace, 'outside-link'))

    const root = await readWorkspaceFiles(workspace, undefined)
    assert.equal(root.kind, 'directory')
    if (root.kind !== 'directory') return
    assert.deepEqual(root.entries.map(entry => [entry.name, entry.kind]), [
      ['src', 'directory'],
      ['outside-link', 'symlink'],
    ])
    const preview = await readWorkspaceFiles(workspace, join(workspace, 'src', 'index.ts'))
    assert.equal(preview.kind, 'file')
    if (preview.kind === 'file') assert.match(preview.content ?? '', /ready = true/)
    await assert.rejects(readWorkspaceFiles(workspace, join(workspace, 'outside-link')), /escapes the workspace/)
  } finally {
    rmSync(parent, { recursive: true, force: true })
  }
})
