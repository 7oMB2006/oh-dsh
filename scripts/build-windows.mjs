import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const requestedArch = process.argv[2]
const arch = requestedArch ?? { arm64: 'arm64', x64: 'x64' }[process.arch] ?? process.arch
if (arch !== 'x64') {
  throw new Error(`unsupported Windows architecture: ${arch}; only x64 is packaged`)
}

const electronPackage = join(root, 'node_modules', 'electron')
const electronBinary = join(electronPackage, 'dist', 'electron.exe')
if (!existsSync(electronBinary)) {
  const installResult = spawnSync(process.execPath, [join(electronPackage, 'install.js')], {
    cwd: root,
    stdio: 'inherit',
  })
  if (installResult.error !== undefined) throw installResult.error
  if (installResult.status !== 0) process.exit(installResult.status ?? 1)
}

const builder = join(root, 'node_modules', '.bin', 'electron-builder')
const result = spawnSync(builder, ['--win', `--${arch}`], {
  cwd: root,
  env: {
    ...process.env,
    CSC_IDENTITY_AUTO_DISCOVERY: 'false',
  },
  stdio: 'inherit',
})
if (result.error !== undefined) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)
