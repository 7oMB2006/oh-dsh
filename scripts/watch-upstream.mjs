import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import semver from 'semver'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

export const WATCH_LABEL = 'upstream-watch'

/** Parse a `.gitmodules` file into one record per `[submodule "..."]` section. */
export function parseSubmodules(text) {
  const entries = []
  let current = null
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    const section = /^\[submodule\s+"(.+)"\]$/.exec(line)
    if (section) {
      current = { name: section[1] }
      entries.push(current)
      continue
    }
    const field = /^([a-zA-Z]+)\s*=\s*(.*)$/.exec(line)
    if (field && current) current[field[1]] = field[2]
  }
  return entries.filter((entry) => entry.path && entry.url)
}

/** Parse `git ls-tree HEAD -- <paths>` output into path → pinned commit. */
export function parseGitlinks(text) {
  const links = new Map()
  for (const line of text.split(/\r?\n/)) {
    const match = /^160000 commit ([0-9a-f]{40})\t(.+)$/.exec(line.trim())
    if (match) links.set(match[2], match[1])
  }
  return links
}

/**
 * Versions from an npm registry document strictly newer than `pinned`,
 * newest first. Pre-release ordering follows semver, matching how the
 * runtime-update comparator treats DSH releases.
 */
export function npmVersionsNewerThan(pinned, versions) {
  return versions
    .filter((version) => semver.valid(version) !== null && semver.gt(version, pinned))
    .sort((a, b) => semver.rcompare(a, b))
}

/** Strip a leading `v` and return the version if it is valid semver. */
export function parseTagVersion(tag) {
  const stripped = tag.startsWith('v') ? tag.slice(1) : tag
  return semver.valid(stripped)
}

/**
 * Upstream tags newer than the pinned submodule revision. When the pin
 * points exactly at a tag, newer means a greater semver tag; otherwise the
 * pinned commit's date is the cutoff, because a pin past a tag (e.g.
 * `v0.8.2-94-gbdff0af`) has no tag of its own to compare against.
 */
export function newerTagsThanPin({ tags, pinnedSha, pinnedTag, pinnedDate }) {
  const pinnedVersion = pinnedTag === undefined ? null : parseTagVersion(pinnedTag)
  const cutoff = Date.parse(pinnedDate ?? '')
  return tags
    .filter((tag) => {
      const version = parseTagVersion(tag.name)
      if (version === null) return false
      if (tag.sha === pinnedSha) return false
      if (pinnedVersion !== null) return semver.gt(version, pinnedVersion)
      const tagDate = Date.parse(tag.date ?? '')
      return !Number.isNaN(cutoff) && !Number.isNaN(tagDate) && tagDate > cutoff
    })
    .sort((a, b) => semver.rcompare(parseTagVersion(a.name), parseTagVersion(b.name)))
}

/** Stable per-subject prefix used both for issue titles and deduplication. */
export function watcherTitlePrefix(subjectKey) {
  return `[upstream-watch] ${subjectKey}`
}

/** The open issue already tracking this subject, if any. */
export function findExistingIssue(openTitles, subjectKey) {
  const prefix = watcherTitlePrefix(subjectKey)
  return openTitles.find((title) => title.startsWith(prefix)) ?? null
}

function ownerRepoFromUrl(url) {
  const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/.exec(url)
  return match === null ? null : `${match[1]}/${match[2]}`
}

async function fetchJson(url, token, options = {}) {
  const headers = { accept: 'application/json' }
  if (token !== undefined) headers.authorization = `Bearer ${token}`
  if (options.body !== undefined) headers['content-type'] = 'application/json'
  const response = await fetch(url, { ...options, headers })
  if (!response.ok) throw new Error(`${url} responded ${response.status}`)
  return response.json()
}

async function fetchNpmPackage(name) {
  return fetchJson(`https://registry.npmjs.org/${encodeURIComponent(name)}`)
}

function githubApi(path, token) {
  return fetchJson(`https://api.github.com${path}`, token)
}

async function checkNpmRuntime(source, token) {
  if (source.source !== 'npm') {
    console.log(`dsh-source.json pins a git source; skipping the npm watch`)
    return null
  }
  const doc = await fetchNpmPackage(source.package)
  const newer = npmVersionsNewerThan(source.version, Object.keys(doc.versions ?? {}))
  return {
    kind: 'npm',
    key: source.package,
    package: source.package,
    pinned: source.version,
    latest: doc['dist-tags']?.latest ?? null,
    newer: newer.map((version) => ({ version, date: doc.time?.[version] ?? null })),
  }
}

async function checkSubmodule(submodule, pinnedSha, token) {
  const ownerRepo = ownerRepoFromUrl(submodule.url)
  if (ownerRepo === null) {
    throw new Error(`cannot derive a GitHub repository from ${submodule.url}`)
  }
  const branch = submodule.branch ?? 'main'
  const tags = await githubApi(`/repos/${ownerRepo}/tags?per_page=100`, token)
  const tagList = tags.map((tag) => ({ name: tag.name, sha: tag.commit.sha, date: null }))
  const pinnedTag = tagList.find((tag) => tag.sha === pinnedSha)?.name
  let pinnedDate = null
  if (pinnedTag === undefined) {
    const commit = await githubApi(`/repos/${ownerRepo}/commits/${pinnedSha}`, token)
    pinnedDate = commit.commit.committer.date
  }
  const compare = await githubApi(`/repos/${ownerRepo}/compare/${pinnedSha}...${branch}`, token)
  return {
    kind: 'git',
    key: submodule.path,
    repo: ownerRepo,
    branch,
    pinnedSha,
    pinnedTag: pinnedTag ?? null,
    pinnedDate,
    aheadBy: compare.ahead_by ?? 0,
    newerTags: newerTagsThanPin({ tags: tagList, pinnedSha, pinnedTag, pinnedDate }),
  }
}

function npmNeedsIssue(subject) {
  return subject.newer.length > 0
}

function submoduleNeedsIssue(subject) {
  return subject.newerTags.length > 0 || subject.aheadBy > 0
}

function formatDate(value) {
  if (value === null || value === undefined) return 'unknown'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString().slice(0, 10)
}

function npmIssue(subject) {
  const title = `${watcherTitlePrefix(subject.key)} has newer releases (pinned ${subject.pinned})`
  const rows = subject.newer
    .map((entry) => `| ${entry.version} | ${formatDate(entry.date)} |`)
    .join('\n')
  const body = [
    `The pinned DSH runtime \`${subject.package}\` is behind upstream.`,
    '',
    `- Pinned version: **${subject.pinned}** (dsh-source.json)`,
    `- Current \`latest\` dist-tag: **${subject.latest ?? 'unknown'}**`,
    '',
    'Versions published after the pin:',
    '',
    '| Version | Published |',
    '| --- | --- |',
    rows,
    '',
    `Registry: https://www.npmjs.com/package/${subject.package}`,
    '',
    'Bumping the pin touches `dsh-source.json` and regenerates',
    '`scripts/dsh-runtime-<version>-lock.yaml`; upstream contract changes',
    'may need adaptation in `plugins/` before the surfaces can move.',
    '',
    'Reported automatically by the daily `Upstream watch` workflow. Close',
    'this issue after bumping the pin, or as not applicable.',
  ].join('\n')
  return { title, body }
}

function submoduleIssue(subject) {
  const title = `${watcherTitlePrefix(subject.key)} advanced beyond the pinned revision`
  const pin = subject.pinnedTag ?? subject.pinnedSha.slice(0, 12)
  const lines = [
    `The pinned submodule \`${subject.key}\` is behind \`${subject.repo}\` branch \`${subject.branch}\`.`,
    '',
    `- Pinned revision: **${pin}**`,
    `- Upstream \`${subject.branch}\` is **${subject.aheadBy}** commit(s) ahead`,
  ]
  if (subject.newerTags.length > 0) {
    lines.push('', 'Tags newer than the pin:', '', '| Tag | Pushed |', '| --- | --- |')
    for (const tag of subject.newerTags.slice(0, 5)) {
      lines.push(`| ${tag.name} | ${formatDate(tag.date)} |`)
    }
  }
  lines.push(
    '',
    `Compare: https://github.com/${subject.repo}/compare/${subject.pinnedSha.slice(0, 12)}...${subject.branch}`,
    '',
    'The pin moves via the git submodule pointer; upstream behavior changes',
    'may need adaptation in `plugins/` per the pinned-source rule.',
    '',
    'Reported automatically by the daily `Upstream watch` workflow. Close',
    'this issue after re-pinning, or as not applicable.',
  )
  return { title, body: lines.join('\n') }
}

async function ensureWatchLabel(token, repo) {
  try {
    await fetchJson(`https://api.github.com/repos/${repo}/labels`, token, {
      method: 'POST',
      body: JSON.stringify({ name: WATCH_LABEL, color: '5319e7', description: 'Automated upstream dependency watch' }),
    })
  } catch (error) {
    // The label already exists (422); anything else falls through to the
    // issue creation, which still works without it.
    if (!String(error.message).includes('422')) console.warn(`label check: ${error.message}`)
  }
}

async function listOpenWatcherTitles(token, repo) {
  const issues = await githubApi(
    `/repos/${repo}/issues?labels=${encodeURIComponent(WATCH_LABEL)}&state=open&per_page=100`,
    token,
  )
  return issues.map((issue) => issue.title)
}

async function createIssue(token, repo, issue) {
  const created = await fetchJson(`https://api.github.com/repos/${repo}/issues`, token, {
    method: 'POST',
    body: JSON.stringify({ title: issue.title, body: issue.body, labels: [WATCH_LABEL] }),
  })
  return created.html_url
}

function printSubject(subject) {
  if (subject.kind === 'npm') {
    const status = npmNeedsIssue(subject)
      ? `${subject.newer.length} newer release(s), latest ${subject.latest}`
      : `up to date (latest ${subject.latest ?? 'unknown'})`
    console.log(`- npm ${subject.package}: pinned ${subject.pinned} — ${status}`)
    return
  }
  const status = submoduleNeedsIssue(subject)
    ? `${subject.aheadBy} commit(s) ahead, newer tags: ${subject.newerTags.map((tag) => tag.name).join(', ') || 'none'}`
    : 'up to date'
  console.log(`- ${subject.key} (${subject.repo}@${subject.branch}): ${status}`)
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const token = process.env.GITHUB_TOKEN
  const repo = process.env.UPSTREAM_WATCH_REPO

  const source = JSON.parse(readFileSync(join(root, 'dsh-source.json'), 'utf8'))
  const submodules = parseSubmodules(readFileSync(join(root, '.gitmodules'), 'utf8'))
  const gitlinks = parseGitlinks(
    execFileSync('git', ['ls-tree', 'HEAD', '--', ...submodules.map((entry) => entry.path)], {
      cwd: root,
      encoding: 'utf8',
    }),
  )

  const subjects = []
  const failures = []
  const npmSubject = await checkNpmRuntime(source, token).catch((error) => {
    failures.push(`npm runtime: ${error.message}`)
    return null
  })
  if (npmSubject !== null) subjects.push(npmSubject)
  for (const submodule of submodules) {
    const pinnedSha = gitlinks.get(submodule.path)
    if (pinnedSha === undefined) {
      failures.push(`${submodule.path}: no pinned gitlink in HEAD`)
      continue
    }
    const subject = await checkSubmodule(submodule, pinnedSha, token).catch((error) => {
      failures.push(`${submodule.path}: ${error.message}`)
      return null
    })
    if (subject !== null) subjects.push(subject)
  }

  console.log('Upstream watch report:')
  for (const subject of subjects) printSubject(subject)
  for (const failure of failures) console.warn(`! ${failure}`)

  const pending = subjects.filter((subject) =>
    subject.kind === 'npm' ? npmNeedsIssue(subject) : submoduleNeedsIssue(subject),
  )
  if (pending.length === 0) {
    console.log('No upstream updates to report.')
    process.exit(failures.length > 0 ? 1 : 0)
  }

  if (token === undefined || repo === undefined || dryRun) {
    console.log('Report-only mode; would file issues for:')
    for (const subject of pending) {
      const issue = subject.kind === 'npm' ? npmIssue(subject) : submoduleIssue(subject)
      console.log(`- ${issue.title}`)
    }
    process.exit(failures.length > 0 ? 1 : 0)
  }

  await ensureWatchLabel(token, repo)
  const openTitles = await listOpenWatcherTitles(token, repo)
  for (const subject of pending) {
    const issue = subject.kind === 'npm' ? npmIssue(subject) : submoduleIssue(subject)
    const existing = findExistingIssue(openTitles, subject.key)
    if (existing !== null) {
      console.log(`already tracked: ${existing}`)
      continue
    }
    const url = await createIssue(token, repo, issue)
    console.log(`created ${url}`)
  }
  process.exit(failures.length > 0 ? 1 : 0)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main()
}
