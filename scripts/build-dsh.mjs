import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dshSource = resolve(process.env.DSH_SOURCE ?? join(root, '..', 'dsh'))
if (!existsSync(join(dshSource, 'package.json'))) {
  throw new Error(`DSH source checkout not found: ${dshSource}`)
}
const result = spawnSync('pnpm', ['run', 'build'], {
  cwd: dshSource,
  env: process.env,
  stdio: 'inherit',
})
if (result.error !== undefined) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)
