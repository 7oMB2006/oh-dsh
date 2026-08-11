import { existsSync } from 'node:fs'
import { isAbsolute as posixIsAbsolute } from 'node:path'
import { isAbsolute as winIsAbsolute } from 'node:path/win32'

export interface ShellSpec {
  path: string
  args: string[]
}

function existingAbsolute(
  candidate: string | undefined,
  fallback: string,
  isAbsolute: (path: string) => boolean,
): string {
  if (candidate !== undefined && candidate.length > 0 && isAbsolute(candidate) && existsSync(candidate)) {
    return candidate
  }
  return fallback
}

/** Resolve a safe interactive shell without letting a stale preference brick the terminal. */
export function resolveShell(
  platform: NodeJS.Platform,
  environment: NodeJS.ProcessEnv,
  requested?: string,
): ShellSpec {
  if (platform === 'win32') {
    const candidate = existingAbsolute(requested, environment.COMSPEC ?? '', winIsAbsolute)
    const path = candidate === '' ? 'powershell.exe' : candidate
    const lower = path.toLowerCase()
    return lower.endsWith('powershell.exe') || lower.endsWith('pwsh.exe')
      ? { path, args: ['-NoLogo'] }
      : { path, args: [] }
  }
  const candidate = existingAbsolute(requested, environment.SHELL ?? '', posixIsAbsolute)
  return { path: candidate || (platform === 'darwin' ? '/bin/zsh' : '/bin/bash'), args: [] }
}
