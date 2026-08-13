import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const stage = join(root, '.stage')
const release = join(root, 'release')
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
const platform = process.platform
const arch = process.arch
const dirName = `oh-dsh-web-${version}-${platform}-${arch}`
const packageDir = join(release, dirName)

for (const required of [
  join(root, 'dist', 'web.js'),
  join(stage, 'dsh-runtime', 'lib', 'bin.js'),
  join(stage, 'node-runtime', 'bin', 'node'),
  join(stage, 'dsh-runtime', 'node_modules', '@oh-dsh', 'web', 'dist', 'index.js'),
  join(stage, 'dsh-runtime', 'node_modules', '@oh-dsh', 'web', 'dist', 'cordis.patch.yml'),
]) {
  if (!existsSync(required)) {
    throw new Error(`web distribution artifact missing: ${required}; run pnpm run build && pnpm run stage:dsh first`)
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with status ${String(result.status)}`)
  }
}

rmSync(packageDir, { recursive: true, force: true })
mkdirSync(join(packageDir, 'bin'), { recursive: true })
mkdirSync(join(packageDir, 'lib', 'oh-dsh-web'), { recursive: true })

copyFileSync(join(root, 'dist', 'web.js'), join(packageDir, 'lib', 'oh-dsh-web', 'main.js'))
copyFileSync(join(root, 'package.json'), join(packageDir, 'package.json'))
copyFileSync(join(root, 'LICENSE'), join(packageDir, 'LICENSE'))
copyFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), join(packageDir, 'THIRD_PARTY_NOTICES.md'))
cpSync(join(stage, 'dsh-runtime'), join(packageDir, 'dsh-runtime'), { recursive: true })
cpSync(join(stage, 'node-runtime'), join(packageDir, 'node-runtime'), { recursive: true })

const launcher = join(packageDir, 'bin', 'oh-dsh-web')
writeFileSync(launcher, `#!/usr/bin/env sh
# Oh-DSH-Web ${version} launcher: runs the bundled Node runtime against the packaged DSH.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
export DSH_OH_WEB_ROOT="$ROOT"
exec "$ROOT/node-runtime/bin/node" "$ROOT/lib/oh-dsh-web/main.js" "$@"
`)
chmodSync(launcher, 0o755)

writeFileSync(join(packageDir, 'README.md'), `# Oh-DSH-Web ${version}

DeepSeek Harness 的浏览器发行版：开箱即用的 DSH Web UI，附带 Oh-DSH 的
皮肤、Pinned Summary、Sidebar（Files/Git/Review）与 PTY 终端能力。
模型运行在云端，本发行版只负责把 Web runtime 跑起来，数据默认存放在
\`~/.oh-dsh-web\`。

## 安装与运行

\`\`\`sh
tar -xzf ${dirName}.tar.gz
cd ${dirName}
./bin/oh-dsh-web
\`\`\`

启动后终端会打印地址（默认 \`http://127.0.0.1:3080\`），交互式终端下会
自动打开浏览器；也可以手动访问打印的 URL。首次启动会创建
\`~/.oh-dsh-web\` 数据目录（\`~/.oh-dsh-web/dsh\` 是 DSH_HOME）。

## 配置

| 选项 | 默认 | 说明 |
| --- | --- | --- |
| \`--host\` / \`DSH_OH_WEB_HOST\` | \`127.0.0.1\` | 监听地址；\`0.0.0.0\` 暴露到局域网 |
| \`--port\` / \`DSH_OH_WEB_PORT\` | \`3080\` | 监听端口；\`0\` 表示随机端口 |
| \`--data\` / \`DSH_OH_WEB_HOME\` | \`~/.oh-dsh-web\` | 可写数据根目录 |
| \`--no-open\` / \`DSH_OH_WEB_OPEN=0\` | 自动打开 | 不自动打开浏览器 |
| \`--trusted-host <auth>\` | — | 浏览器信任围栏的额外 authority（可重复） |

退出按 \`Ctrl+C\`，会优雅地停止 DSH runtime。

## 内置 Oh-DSH 能力

- Oh-DSH 皮肤：四套主题，设置页即时切换，Host 持久化。
- Pinned Summary：当前 Session 摘要。
- Sidebar：Session tabs、Files、Git Review、逐行评论与 workspace Git API。
- PTY 终端 dock（浏览器内 xterm）。
- 插件市场暂为桌面发行版专属（Web 传输在规划中）。

## 安全边界

- 默认只监听 loopback；对外暴露时请自行评估信任边界。
- 浏览器与 Agent 管理通道遵循 DSH Web runtime 的 origin 信任围栏。
- Better Sidebar Host 对 Files 和 Git 请求执行 Session 与 Workspace 边界校验。

## 从源码构建

\`\`\`sh
pnpm install
pnpm run dist:web
\`\`\`

产物位于 \`release/\`（tar.gz 与 zip），构建完成后会对打包产物自动跑
\`smoke:web\` 验证。
`)

const tarball = join(release, `${dirName}.tar.gz`)
const zip = join(release, `${dirName}.zip`)
rmSync(tarball, { force: true })
rmSync(zip, { force: true })
run('tar', ['-czf', tarball, dirName], { cwd: release })
run('zip', ['-qry', zip, dirName], { cwd: release })

console.log(`Packaged Oh-DSH-Web ${version}: ${packageDir}`)
console.log(`  ${tarball}`)
console.log(`  ${zip}`)

// Self-verify the packaged layout exactly like the staged one.
const smoke = join(root, 'scripts', 'smoke-web.mjs')
const verify = spawnSync(process.execPath, [smoke, 'release'], {
  cwd: root,
  env: process.env,
  stdio: 'inherit',
})
if (verify.error !== undefined) throw verify.error
if (verify.status !== 0) process.exit(verify.status ?? 1)
