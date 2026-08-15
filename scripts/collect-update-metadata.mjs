import { mkdirSync, renameSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
const value = name => {
  const index = args.indexOf(name)
  return index === -1 ? undefined : args[index + 1]
}
const dir = value('--dir')
const id = value('--id')
if (dir === undefined || id === undefined) throw new Error('usage: collect-update-metadata.mjs --dir RELEASE_DIR --id PLATFORM_ID')
const destination = join(dir, 'updater-metadata', id)
mkdirSync(destination, { recursive: true })
for (const name of readdirSync(dir)) {
  if (!/^latest(?:-(?:mac|linux))?\.yml$/.test(name)) continue
  renameSync(join(dir, name), join(destination, name))
}
