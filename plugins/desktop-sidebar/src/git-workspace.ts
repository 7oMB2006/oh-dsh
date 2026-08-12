import { execFile } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { basename, isAbsolute } from 'node:path'
import { promisify } from 'node:util'
import type {
  WorkspaceChange,
  WorkspaceChangeStatus,
  WorkspaceMutation,
  WorkspaceSnapshot,
} from './protocol.ts'

const execFileAsync = promisify(execFile)
const MAX_GIT_OUTPUT = 8 * 1024 * 1024

export function normalizeWorkspacePath(raw: string | undefined): string {
  const cwd = raw?.trim()
  if (cwd === undefined || cwd === '' || cwd.length > 4096 || !isAbsolute(cwd)) {
    throw new Error('invalid workspace path')
  }
  if (!existsSync(cwd) || !statSync(cwd).isDirectory()) throw new Error('workspace directory does not exist')
  return cwd
}

async function git(args: readonly string[], cwd: string, timeout = 20_000): Promise<string> {
  const result = await execFileAsync('git', [...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: MAX_GIT_OUTPUT,
    timeout,
  })
  return result.stdout
}

function statusFromCode(code: string): WorkspaceChangeStatus {
  if (code === '??') return 'untracked'
  if (code.includes('U') || code === 'AA' || code === 'DD') return 'conflicted'
  if (code.includes('R')) return 'renamed'
  if (code.includes('C')) return 'copied'
  if (code.includes('D')) return 'deleted'
  if (code.includes('A')) return 'added'
  return 'modified'
}

export function parseGitStatus(output: string): WorkspaceChange[] {
  const entries = output.split('\0')
  const changes: WorkspaceChange[] = []
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    if (entry === undefined || entry.length < 4) continue
    const code = entry.slice(0, 2)
    if (code === '!!') continue
    const path = entry.slice(3)
    let oldPath: string | null = null
    if (code.includes('R') || code.includes('C')) {
      oldPath = entries[index + 1] || null
      index += 1
    }
    changes.push({
      path,
      oldPath,
      status: statusFromCode(code),
      staged: code[0] !== ' ' && code[0] !== '?',
    })
  }
  return changes.sort((left, right) => left.path.localeCompare(right.path))
}

function parseAheadBehind(output: string): { ahead: number; behind: number } {
  const [behindRaw, aheadRaw] = output.trim().split(/\s+/)
  const behind = Number(behindRaw)
  const ahead = Number(aheadRaw)
  return {
    ahead: Number.isFinite(ahead) ? ahead : 0,
    behind: Number.isFinite(behind) ? behind : 0,
  }
}

async function repositoryRoot(cwd: string): Promise<string | null> {
  try {
    return (await git(['rev-parse', '--show-toplevel'], cwd)).trim() || null
  } catch {
    return null
  }
}

export async function readWorkspaceSnapshot(rawCwd: string | undefined): Promise<WorkspaceSnapshot> {
  const cwd = normalizeWorkspacePath(rawCwd)
  const root = await repositoryRoot(cwd)
  if (root === null) {
    return {
      kind: 'directory',
      cwd,
      root: cwd,
      name: basename(cwd) || cwd,
      branch: null,
      branches: [],
      changes: [],
      ahead: 0,
      behind: 0,
      hasRemote: false,
    }
  }
  const [branchOutput, branchesOutput, statusOutput, remotesOutput] = await Promise.all([
    git(['branch', '--show-current'], root),
    git(['for-each-ref', '--format=%(refname:short)', 'refs/heads'], root),
    git(['status', '--porcelain=v1', '-z', '--untracked-files=all'], root),
    git(['remote'], root),
  ])
  let counts = { ahead: 0, behind: 0 }
  try {
    counts = parseAheadBehind(await git(['rev-list', '--left-right', '--count', '@{upstream}...HEAD'], root))
  } catch {
    // A local-only branch has no upstream yet.
  }
  const branch = branchOutput.trim() || 'HEAD'
  const branches = branchesOutput.split(/\r?\n/).map(value => value.trim()).filter(Boolean)
  if (branch !== 'HEAD' && !branches.includes(branch)) branches.unshift(branch)
  return {
    kind: 'repository',
    cwd,
    root,
    name: basename(root) || root,
    branch,
    branches,
    changes: parseGitStatus(statusOutput),
    ...counts,
    hasRemote: remotesOutput.trim() !== '',
  }
}

function requiredText(value: string, label: string, maxLength: number): string {
  const normalized = value.trim()
  if (normalized === '' || normalized.length > maxLength || normalized.includes('\0')) {
    throw new Error(`invalid ${label}`)
  }
  return normalized
}

export async function mutateWorkspace(
  rawCwd: string | undefined,
  mutation: WorkspaceMutation,
): Promise<{ message: string; snapshot: WorkspaceSnapshot }> {
  const before = await readWorkspaceSnapshot(rawCwd)
  if (before.kind !== 'repository') throw new Error('workspace is not a Git repository')
  const cwd = before.root
  let message: string
  switch (mutation.action) {
    case 'checkout': {
      const branch = requiredText(mutation.branch, 'branch', 240)
      if (!before.branches.includes(branch)) throw new Error(`unknown local branch: ${branch}`)
      await git(['switch', branch], cwd)
      message = `Switched to ${branch}`
      break
    }
    case 'create-branch': {
      const branch = requiredText(mutation.branch, 'branch', 240)
      await git(['check-ref-format', '--branch', branch], cwd)
      await git(['switch', '-c', branch], cwd)
      message = `Created ${branch}`
      break
    }
    case 'commit': {
      const commitMessage = requiredText(mutation.message, 'commit message', 10_000)
      await git(['add', '--all'], cwd)
      await git(['commit', '-m', commitMessage], cwd, 60_000)
      message = 'Committed all workspace changes'
      break
    }
    case 'push': {
      if (!before.hasRemote) throw new Error('repository has no Git remote')
      let hasUpstream = true
      try {
        await git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], cwd)
      } catch {
        hasUpstream = false
      }
      if (hasUpstream) await git(['push'], cwd, 120_000)
      else {
        if (before.branch === null || before.branch === 'HEAD') throw new Error('cannot push a detached HEAD')
        await git(['push', '--set-upstream', 'origin', before.branch], cwd, 120_000)
      }
      message = 'Pushed the current branch'
      break
    }
  }
  return { message, snapshot: await readWorkspaceSnapshot(cwd) }
}

export async function readWorkspaceDiff(rawCwd: string | undefined, rawPath: string | null): Promise<string> {
  const snapshot = await readWorkspaceSnapshot(rawCwd)
  if (snapshot.kind !== 'repository') throw new Error('workspace is not a Git repository')
  const path = requiredText(rawPath ?? '', 'change path', 4096)
  const change = snapshot.changes.find(entry => entry.path === path)
  if (change === undefined) throw new Error('change is no longer present')
  if (change.status === 'untracked') {
    try {
      return await git(['diff', '--no-index', '--', '/dev/null', path], snapshot.root)
    } catch (error) {
      const stderr = error instanceof Error && 'stderr' in error ? String(error.stderr) : ''
      const stdout = error instanceof Error && 'stdout' in error ? String(error.stdout) : ''
      return stdout || stderr
    }
  }
  return await git(['diff', 'HEAD', '--no-ext-diff', '--no-color', '--', path], snapshot.root)
}
