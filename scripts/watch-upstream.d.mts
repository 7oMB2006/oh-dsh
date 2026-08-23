export interface SubmoduleEntry {
  readonly name: string
  readonly path?: string
  readonly url?: string
  readonly branch?: string
}

export interface UpstreamTag {
  readonly name: string
  readonly sha: string
  readonly date: string | null
}

export interface NpmVersionEntry {
  readonly version: string
  readonly date: string | null
}

export function parseSubmodules(text: string): SubmoduleEntry[]

export function parseGitlinks(text: string): Map<string, string>

export function npmVersionsNewerThan(pinned: string, versions: readonly string[]): string[]

export function parseTagVersion(tag: string): string | null

export function newerTagsThanPin(input: {
  readonly tags: readonly UpstreamTag[]
  readonly pinnedSha: string
  readonly pinnedTag: string | undefined
  readonly pinnedDate: string | null
}): UpstreamTag[]

export function watcherTitlePrefix(subjectKey: string): string

export function findExistingIssue(
  openTitles: readonly string[],
  subjectKey: string,
): string | null
