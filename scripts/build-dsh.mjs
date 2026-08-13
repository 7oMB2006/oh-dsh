import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveDshSource } from './dsh-source.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dshSource = resolveDshSource()
const pnpmCli = join(root, 'node_modules', 'pnpm', 'bin', 'pnpm.mjs')

function run(args) {
  const result = spawnSync(process.execPath, [pnpmCli, ...args], {
    cwd: dshSource,
    env: process.env,
    stdio: 'inherit',
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

run(['install', '--frozen-lockfile'])
run(['run', 'build'])
