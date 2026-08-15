import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import YAML from 'yaml'

export const PLATFORM_RULES = Object.freeze({
  'mac-arm64': { metadata: 'latest-mac.yml', arch: 'arm64', extension: '.zip' },
  'mac-x64': { metadata: 'latest-mac.yml', arch: 'x64', extension: '.zip' },
  'win-x64': { metadata: 'latest.yml', arch: 'x64', extension: '.exe' },
  'linux-x64': { metadata: 'latest-linux.yml', arch: 'x86_64', extension: '.AppImage' },
})

function assetName(file) {
  const raw = file?.url ?? file?.path
  if (typeof raw !== 'string' || raw === '') throw new Error('metadata file is missing url/path')
  try {
    return decodeURIComponent(new URL(raw).pathname.split('/').pop() ?? raw)
  } catch {
    return basename(raw)
  }
}

function readMetadata(path) {
  const value = YAML.parse(readFileSync(path, 'utf8'))
  if (value === null || typeof value !== 'object' || !Array.isArray(value.files)) {
    throw new Error(`invalid updater metadata: ${path}`)
  }
  return value
}

function sha512(path) {
  return createHash('sha512').update(readFileSync(path)).digest('base64')
}

function verifyFile(dir, file) {
  const name = assetName(file)
  const path = join(dir, name)
  if (!existsSync(path)) throw new Error(`metadata references missing asset: ${name}`)
  if (typeof file.sha512 !== 'string' || file.sha512 === '') throw new Error(`metadata asset has no sha512: ${name}`)
  const actual = sha512(path)
  const expected = file.sha512
  const digestMatches = actual === expected || createHash('sha512').update(readFileSync(path)).digest('hex') === expected
  if (!digestMatches) throw new Error(`sha512 mismatch for ${name}`)
  if (file.size !== undefined && Number(file.size) !== statSync(path).size) {
    throw new Error(`size mismatch for ${name}: metadata=${String(file.size)} actual=${String(statSync(path).size)}`)
  }
  if (file.blockMapSize !== undefined) {
    const blockmap = `${path}.blockmap`
    if (!existsSync(blockmap)) throw new Error(`metadata references missing blockmap: ${basename(blockmap)}`)
    if (Number(file.blockMapSize) !== statSync(blockmap).size) throw new Error(`blockmap size mismatch for ${name}`)
  }
  return name
}

export function mergeMetadata(documents) {
  if (documents.length === 0) throw new Error('at least one metadata document is required')
  const first = documents[0]
  const files = new Map()
  for (const document of documents) {
    if (document.version !== first.version) throw new Error('cannot merge metadata with different versions')
    for (const file of document.files) {
      const name = assetName(file)
      const previous = files.get(name)
      if (previous !== undefined && YAML.stringify(previous) !== YAML.stringify(file)) {
        throw new Error(`conflicting metadata for asset: ${name}`)
      }
      files.set(name, file)
    }
  }
  return {
    ...first,
    files: [...files.values()].sort((left, right) => assetName(left).localeCompare(assetName(right))),
  }
}

export function verifyMetadata({ dir, version, platform }) {
  const rule = PLATFORM_RULES[platform]
  if (rule === undefined) throw new Error(`unsupported metadata platform: ${platform}`)
  const metadataPath = join(dir, rule.metadata)
  if (!existsSync(metadataPath)) throw new Error(`missing updater metadata: ${rule.metadata}`)
  const metadata = readMetadata(metadataPath)
  if (metadata.version !== version) throw new Error(`metadata version ${String(metadata.version)} does not match ${version}`)
  const candidates = metadata.files.filter(file => {
    const name = assetName(file)
    const lower = name.toLowerCase()
    return lower.endsWith(rule.extension.toLowerCase()) && lower.includes(rule.arch.toLowerCase())
  })
  if (candidates.length !== 1) throw new Error(`expected one ${platform} updater asset, found ${String(candidates.length)}`)
  const selected = verifyFile(dir, candidates[0])
  if (metadata.files.some(file => assetName(file).toLowerCase().includes('oh-dsh-web'))) {
    throw new Error(`web distribution was included in ${rule.metadata}`)
  }
  return { metadataPath, selected, version: metadata.version }
}
