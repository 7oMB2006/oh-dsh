import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { prerelease, valid } from 'semver'

export function validateReleaseTag(tag, version) {
  if (typeof tag !== 'string' || !tag.startsWith('v')) {
    throw new Error(`release tag must start with v: ${String(tag)}`)
  }
  const normalizedTag = valid(tag.slice(1))
  if (normalizedTag === null || prerelease(normalizedTag) !== null) {
    throw new Error(`release tag must be a stable semver version: ${tag}`)
  }
  if (normalizedTag !== version) {
    throw new Error(`release tag ${tag} does not match package version ${version}`)
  }
  return normalizedTag
}

function argument(name) {
  const args = process.argv.slice(2)
  const index = args.indexOf(name)
  return index === -1 ? undefined : args[index + 1]
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const tag = argument('--tag')
  const version = argument('--version')
  if (tag === undefined || version === undefined) {
    throw new Error('usage: validate-release-tag.mjs --tag vX.Y.Z --version X.Y.Z')
  }
  console.log(`validated stable release ${validateReleaseTag(tag, version)}`)
}
