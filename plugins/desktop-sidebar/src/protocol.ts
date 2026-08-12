export const WORKSPACE_API_PATH = '/oh-dsh-desktop/workspace'
export const FILES_API_PATH = '/oh-dsh-desktop/files'

export type WorkspaceFileKind = 'directory' | 'file' | 'symlink'

export interface WorkspaceFileEntry {
  kind: WorkspaceFileKind
  name: string
  path: string
  size: number | null
}

export type WorkspaceFilesResponse = {
  kind: 'directory'
  cwd: string
  path: string
  parent: string | null
  entries: WorkspaceFileEntry[]
  truncated: boolean
} | {
  kind: 'file'
  cwd: string
  path: string
  parent: string
  content: string | null
  binary: boolean
  size: number
  truncated: boolean
}

export type WorkspaceChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'untracked' | 'conflicted'

export interface WorkspaceChange {
  path: string
  oldPath: string | null
  status: WorkspaceChangeStatus
  staged: boolean
}

export interface WorkspaceSnapshot {
  kind: 'directory' | 'repository'
  cwd: string
  root: string
  name: string
  branch: string | null
  branches: string[]
  changes: WorkspaceChange[]
  ahead: number
  behind: number
  hasRemote: boolean
}

export type WorkspaceMutation = {
  action: 'checkout'
  branch: string
} | {
  action: 'create-branch'
  branch: string
} | {
  action: 'commit'
  message: string
} | {
  action: 'push'
}

export interface WorkspaceMutationResponse {
  message: string
  snapshot: WorkspaceSnapshot
}

export interface WorkspaceDiffResponse {
  diff: string
}
