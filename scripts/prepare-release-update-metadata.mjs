import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import YAML from 'yaml'
import { mergeMetadata, verifyMetadata } from './update-metadata.mjs'

const args = process.argv.slice(2)
const value = name => {
  const index = args.indexOf(name)
  return index === -1 ? undefined : args[index + 1]
}
const dir = value('--dir')
const version = value('--version')
if (dir === undefined || version === undefined) throw new Error('usage: prepare-release-update-metadata.mjs --dir ARTIFACT_DIR --version VERSION')

function metadata(id, name) {
  const path = join(dir, 'updater-metadata', id, name)
  if (!existsSync(path)) throw new Error(`missing ${id} updater metadata: ${path}`)
  return path
}

const arm64 = metadata('macos-arm64', 'latest-mac.yml')
const x64 = metadata('macos-x64', 'latest-mac.yml')
const merged = mergeMetadata([
  YAML.parse(readFileSync(arm64, 'utf8')),
  YAML.parse(readFileSync(x64, 'utf8')),
])
writeFileSync(join(dir, 'latest-mac.yml'), YAML.stringify(merged))
copyFileSync(metadata('windows-x64', 'latest.yml'), join(dir, 'latest.yml'))
copyFileSync(metadata('linux-x64', 'latest-linux.yml'), join(dir, 'latest-linux.yml'))

for (const platform of ['mac-arm64', 'mac-x64', 'win-x64', 'linux-x64']) {
  verifyMetadata({ dir, version, platform })
}
console.log(`prepared updater metadata for ${version}`)
