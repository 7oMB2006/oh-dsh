export interface GitDshSourceSpec {
  readonly source: 'git'
  readonly repository: string
  readonly ref: string
  readonly revision: string
  readonly version: string
}

export interface NpmDshSourceSpec {
  readonly source: 'npm'
  readonly package: string
  readonly version: string
  readonly integrity: string
  readonly tarball: string
  readonly packageManager: string
}

export type DshSourceSpec = GitDshSourceSpec | NpmDshSourceSpec

export const DSH_SOURCE_SPEC: DshSourceSpec

export function resolveDshSource(): string

export function resolvePinnedPnpm(source: string): {
  binDir: string
  cliEntry: string
}

export function prepareNpmAssembly(
  source: string,
  dependencies: Readonly<Record<string, string>>,
): void
