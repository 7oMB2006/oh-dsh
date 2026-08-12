<p align="center">
  <strong>简体中文</strong> ·
  <a href="./README.en.md">English</a>
</p>

<div align="center">
  <img src="./assets/dsh-whale.png" width="168" alt="Oh-DSH-Desktop whale">
  <h1>Oh-DSH-Desktop</h1>
  <p><strong>把 DeepSeek Harness 变成一个真正可安装、可扩展的桌面工作台。</strong></p>
  <p>
    保留 DSH React UI，把本地终端、Workspace、Git、浏览器和插件运行时
    装进一个自包含的 Electron 应用。
  </p>
  <p>
    <a href="#快速开始">快速开始</a> ·
    <a href="#核心能力">核心能力</a> ·
    <a href="#可扩展-side-panel">Side Panel</a> ·
    <a href="#桌面换肤">桌面换肤</a> ·
    <a href="#插件市场">插件市场</a> ·
    <a href="#架构">架构</a> ·
    <a href="#插件机制">插件机制</a> ·
    <a href="#开发与验证">开发与验证</a>
  </p>
</div>

<p align="center">
  <img alt="macOS 12+" src="https://img.shields.io/badge/macOS-12%2B-111111?logo=apple&logoColor=white">
  <img alt="Apple Silicon" src="https://img.shields.io/badge/arch-arm64-2f81f7">
  <img alt="DSH 0.0.1-rc.1" src="https://img.shields.io/badge/DSH-0.0.1--rc.1-2f81f7">
  <img alt="Electron 42" src="https://img.shields.io/badge/Electron-42-47848f?logo=electron&logoColor=white">
  <img alt="pnpm 11" src="https://img.shields.io/badge/pnpm-11-f69220?logo=pnpm&logoColor=white">
  <img alt="BSD 3-Clause" src="https://img.shields.io/badge/license-BSD--3--Clause-34a853">
</p>

<p align="center">
  <img src="./assets/oh-dsh-desktop-ui.png" alt="Oh-DSH-Desktop main interface" width="100%">
</p>

<p align="center">
  <sub>DSH 的界面与工作流不变；桌面能力通过独立 plugin 注入。</sub>
</p>

## 它是什么

Oh-DSH-Desktop 是 DeepSeek Harness 的桌面发行版，同时也是一组可注册给
DSH 的 bundle plugins。模型仍运行在云端；桌面应用负责界面、本地文件、
终端、浏览器、窗口集成和插件生命周期。

项目没有重写 DSH 前端，也不要求额外安装 Web Terminal。它把 DSH、Node.js、
Electron 和所需原生模块一起装进 macOS 应用，安装后即可启动完整 runtime。

> [!NOTE]
> 当前发布目标是 Apple Silicon（arm64）。测试包没有 Developer ID 和
> notarization，适合本机安装验证；正式分发前仍需完成 Apple 签名与公证。

## 核心能力

| 能力 | 实现 |
| --- | --- |
| 自包含桌面发行版 | Electron shell 内置 DSH runtime、Node.js 和原生模块 |
| 原生终端 | 自有 PTY host、多标签 Terminal、会话级尺寸与字体偏好 |
| Workspace Review | Changes、diff、分支切换、创建分支、commit/push 和后台进程 |
| Pinned Summary | 跟随当前 Session 的半高摘要卡片，并为正文自然预留空间 |
| 可扩展 Side Panel | Review、Browser、Files、Side chat、Trajectory 共用注册式右侧工具区 |
| 专注模式 | Side Panel 可展开覆盖 Chat，按 Esc 恢复 |
| 事务化插件市场 | 浏览 `dsh-external`，隔离预览安装、更新、启停和卸载，可应用、放弃或恢复 |
| 对话式插件管理 | Agent 与人类 UI 共用同一个风险、预览、应用和恢复事务内核 |
| 桌面换肤 | 四套 Oh-DSH 自有皮肤，通过 DSH 官方主题服务即时切换并跨启动保存 |
| 双语插件 UI | 设置中的中文 / English 会实时更新全部内置 Oh-DSH plugins |
| macOS 集成 | 隐藏式标题栏、窗口拖动、原生菜单、文件选择器和外链处理 |

Review 只存在于 Side Panel 内，不占用独立顶部图标。打开 Side Panel 会自动
收起 Pinned Summary；底部 Terminal 可以独立开关。

## 快速开始

### 安装测试包

从 [GitHub Releases](../../releases) 下载：

- `Oh-DSH-Desktop-0.1.0-arm64.dmg`
- `Oh-DSH-Desktop-0.1.0-arm64.zip`

打开 DMG，把 `Oh-DSH-Desktop.app` 拖入 `Applications`。未公证的测试包
首次运行时，可在 Finder 中右键应用并选择“打开”。

### 从源码运行

要求：

- macOS 12 或更高版本
- Apple Silicon
- Node.js 24+
- pnpm 11+
- Xcode Command Line Tools
- 能够读取 `dsh-source.json` 所固定 DSH 快照的 Git/SSH 凭证

```sh
pnpm install
pnpm run build:dsh
pnpm start
```

发行构建固定使用 DSH `0.0.1-rc.1` 的完整 Git commit
`e7f2790a2a863bfc23e5db483778fd12801cf9bf`。源码首次构建时下载到
`.cache/dsh-source/`，后续构建会校验版本与 commit。开发其他 DSH
checkout 时可以显式设置 `DSH_SOURCE=/absolute/path`；版本仍必须与固定版本一致。

DSH 的可写数据位于：

```text
~/Library/Application Support/Oh-DSH-Desktop/dsh
```

DeepSeek API key 可以从 DSH 设置页配置，也可以写入该目录中的 `.env`。
凭证不会写入应用包。

## 桌面交互

| 操作 | 快捷键 |
| --- | --- |
| 切换 DSH 左侧栏 | `⌘B` |
| 切换底部 Terminal | `⌘J` |
| 切换 Side Panel | `⌥⌘B` |
| 打开 Review | `⌃⇧G` |
| 打开 Browser | `⌘T` |
| 打开 Files | `⌘P` |
| 新建 Side chat | `⌥⌘S` |
| 退出 Side Panel 专注模式 | `Esc` |

顶部工具栏只保留当前状态所需的入口：

- Side Panel 关闭时显示 Pinned Summary。
- Side Panel 打开时隐藏 Pinned Summary，显示展开按钮。
- Terminal 和 Side Panel 始终可以独立切换。

## 可扩展 Side Panel

`@oh-dsh/desktop-sidebar` 是右侧工具区的唯一实现，不再并行维护
`workspace-tools` 或第二个 Side Panel plugin。内置 Review、Browser、Files、
Side chat 和 Trajectory 都通过同一套 `desktopSidebar` 服务注册；第三方
plugin 也可以注册自己的标签页和文件查看器。

侧边栏会按 Session 保存打开的标签页、当前标签、宽度和启动偏好。相同资源
可按规则去重；暂时缺失的 plugin 会留下可安全关闭的 orphan 标签，不会破坏
其他 Session 状态。文件预览按优先级、扩展名、内容探测和启用状态选择，HTML
预览运行在无脚本权限的 sandbox iframe 中。

在 **设置 → 通用 → 侧边栏** 中可以调整默认宽度和启动状态，并分别启停工具
与文件查看器。设置通过 Host preference API 保存，不依赖随机 loopback 端口
对应的 Web Storage。

## 桌面换肤

`@oh-dsh/desktop-skins` 在 **设置 → 通用 → 桌面皮肤** 中提供四套
Oh-DSH 自有外观：**深海流光**、**翡翠回路**、**青白瓷**和
**余烬暮色**。它只复用 DSH 官方 `ThemeService` 的注册与切换接口，
配色、命名和预览均由本项目重新设计。

选择后立即应用，无需重启。皮肤偏好由 Host plugin 写入应用数据目录，
不依赖随机 loopback 端口对应的浏览器存储，因此重新启动桌面端后仍会
恢复。选择 **原始外观** 会回到启用皮肤前的 Light、Dark 或 System
设置；在原生 Appearance 中切换时，皮肤插件会主动让出控制权。

所有主背景、侧栏、底部 Terminal 和右侧工具区使用同一个不透明基色，
避免透明纹理在 Pinned Summary 下方或面板边缘透出不同肤色。

## 架构

```mermaid
flowchart TB
  App["Oh-DSH-Desktop.app<br/>Electron shell"]
  Runtime["Bundled Node.js + DSH runtime"]
  UI["DSH React UI"]
  Shell["@oh-dsh/desktop-shell<br/>window · menu · PTY"]
  Panels["@oh-dsh/panel-controls<br/>terminal · bottom panel"]
  Summary["@oh-dsh/pinned-summary<br/>session summary"]
  Tools["@oh-dsh/desktop-sidebar<br/>registry · review · browser · files"]
  Market["@oh-dsh/plugin-marketplace<br/>discover · preview · recover"]
  Skins["@oh-dsh/desktop-skins<br/>theme · persist · restore"]

  App --> Runtime
  Runtime --> UI
  Runtime --> Shell
  UI --> Panels
  UI --> Summary
  UI --> Tools
  UI --> Market
  UI --> Skins
```

### 内置 plugins

| Plugin | 职责 |
| --- | --- |
| `@oh-dsh/desktop-shell` | Electron/DSH bridge、PTY WebSocket host、原生菜单与桌面能力 |
| `@oh-dsh/panel-controls` | 多标签 Terminal、底部面板、DSH 左侧栏、字体与高度偏好 |
| `@oh-dsh/pinned-summary` | 当前 Session 摘要和正文 gutter 管理 |
| `@oh-dsh/desktop-sidebar` | 唯一的右侧工具区、扩展注册表、Workspace/Git Review、Browser 与 Files |
| `@oh-dsh/plugin-marketplace` | `dsh-external` 目录、隔离候选 Profile、更新检查和回滚 |
| `@oh-dsh/desktop-skins` | 自有皮肤图库、官方 ThemeService 适配和 Host 持久化 |
| `@oh-dsh/desktop` | 根 bundle，按固定顺序注册所有桌面 plugins |

`cordis.patch.yml` 复用 `dsh-base` 与 `dsh-web-app`，绑定临时 loopback
端口，并按依赖顺序装载桌面 plugins。

## 插件市场

左侧 **插件** 入口读取
[`dsh-external/hub`](https://github.com/dsh-external/hub) 目录，并沿用 DSH
官方的 Profile bundle 与 repository plugin 两种加载机制。市场自身也是一个
`@oh-dsh/plugin-marketplace` plugin，不会替换 DSH Loader。

市场把 `plugin-registry`、`dsh-hub` 等管理项目中经过验证的设计收敛为一条
明确的事务链：

```text
检查来源与精确 commit
        ↓
复制当前 Profile 到隔离候选目录
        ↓
在写入受限的预览窗口中启动 DSH
        ↓
放弃（当前桌面零变化）或应用（保留 previous）
        ↓
必要时 Undo 恢复完整旧 Profile
```

- **全部 / 已安装 / 未安装 / 可更新 / 已停用** 分组保持目录完整，
  不会只显示局部结果。
- 安装与启用是两种状态；已安装插件可以单独预览启用或停用。
- 刷新时比较已安装 commit 与远端 HEAD，并为更新生成新的隔离预览。
- 首次应用会记录来源身份、机制、软件包名、精确 commit 和 manifest
  hash。TOFU 锁在卸载后仍保留；来源身份变化必须重新确认，同一
  commit 内容变化会被直接拒绝。
- 风险分为低、中、高和阻止四级。Repository plugin 应用后属于受信任
  主机代码；桌面内核与市场自身属于受保护插件，不能自我替换。
- 安装脚本默认阻止；只有用户审阅并确认后，才可在写入受限的预览目录中运行。
- 状态明确区分 `candidate`、`current` 和 `previous`。应用失败会自动恢复，
  成功后也可以手动恢复上一份完整 Profile。
- 打开原生设置页时市场自动关闭，避免遮挡设置内容。

Agent 可以在对话中使用 `desktop_plugin_search`、
`desktop_plugin_prepare`、`desktop_plugin_preview` 等工具完成同一流程。
`desktop_plugin_apply` 与 `desktop_plugin_recover` 始终进入 DSH 的人类审批；
它们不会获得第二套 Loader，也不能绕开隔离预览。

私有组织仓库通过 GitHub CLI 认证：

```sh
gh auth login
```

凭证由 `gh auth git-credential` 临时提供，不写入应用配置或命令行参数。

## 插件机制

应用菜单中的 **DSH → 从文件夹安装插件…** 等价于：

```sh
dsh plugin --profile desktop add <plugin-directory>
```

安装后 DSH runtime 自动重启。第三方依赖和 bundle 顺序保存在可写的
`profiles/desktop/package.json` 中；内置 plugins 会保持固定顺序，用户
plugins 保留自己的安装顺序。

所有内置客户端插件都注入 DSH 官方 `locale` 服务并注册 `zh` / `en`
词典。设置页切换语言后，Desktop skins、Terminal、Pinned Summary、
Desktop sidebar 和插件市场会在当前窗口内立即更新，不需要重启 runtime。

每个客户端插件都通过 DSH 标准的 `package.json#dsh.client` 声明平台、
预取行为与依赖边。Runtime smoke 会从实际 boot graph 校验这些声明，避免
Host 已打包但 Client bundle 返回 404 的假兼容状态。

## 安全边界

- DSH Web runtime 只监听随机 loopback 端口。
- Browser 使用独立 Electron partition，禁用 Node.js 和 preload 注入。
- Files API 会校验 realpath，拒绝越过当前 Workspace 的路径和符号链接。
- 文件列表、文件预览和 PTY 消息都有明确的数量或大小上限。
- `scripts/stage-dsh.mjs` 校验 Node.js SHA-256，并拒绝指回源码目录的链接。
- pnpm 的 release-age 策略保持启用，只对 `@deepseek-ai/*` 做显式排除。
- 市场从精确 Git commit 构建候选 Profile；预览写入受 macOS Seatbelt
  限制，应用前不会触碰当前桌面 Profile。
- Agent 管理通道只监听随机 loopback 端口。一次性凭据在 Host plugin
  挂载后立即从环境移除，并且从不传入预览 Runtime。

## 生成 macOS 安装包

完整构建会获取并重建 `dsh-source.json` 固定的 DSH：

```sh
pnpm run dist:mac
```

固定 DSH 的缓存构建产物已经是最新状态时：

```sh
pnpm run dist:mac:quick
```

产物位于 `release/`：

```text
release/
├── Oh-DSH-Desktop-0.1.0-arm64.dmg
├── Oh-DSH-Desktop-0.1.0-arm64.zip
└── mac-arm64/Oh-DSH-Desktop.app
```

当前仓库不依赖 GitHub Actions 生成发行包。发布前必须先在本机完成编译、
runtime 烟测、应用烟测和安装包校验：

```sh
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm test
pnpm run dist:mac
pnpm run smoke:app
codesign --verify --deep --strict \
  release/mac-arm64/Oh-DSH-Desktop.app
hdiutil verify release/Oh-DSH-Desktop-0.1.0-arm64.dmg
```

本地验证通过后，再手动创建或更新 GitHub Release：

```sh
gh release create v0.1.0 \
  release/Oh-DSH-Desktop-0.1.0-arm64.dmg \
  release/Oh-DSH-Desktop-0.1.0-arm64.zip \
  --title "Oh-DSH-Desktop 0.1.0" \
  --generate-notes

# Release 已存在时使用：
gh release upload v0.1.0 \
  release/Oh-DSH-Desktop-0.1.0-arm64.dmg \
  release/Oh-DSH-Desktop-0.1.0-arm64.zip \
  --clobber
```

`release/` 是本地构建目录，不提交进 Git；Release 中只上传验证过的 DMG
和 ZIP。

## 开发与验证

```sh
pnpm run typecheck
pnpm test
pnpm run check:screenshot
pnpm run build
pnpm run check:plugins
pnpm run smoke:runtime
pnpm run smoke:app
```

测试覆盖 profile 初始化、runtime 启动、PTY 协议、终端状态、Workspace/Git
边界、文件访问约束和右侧面板布局契约。截图检查还会确认 UI 图片的四个
圆角保留真实的 alpha 透明通道。`check:plugins` 会逐项报告根 bundle 与六个
内置 plugin 的 Host 激活、Client bundle、依赖图、Workspace API 和 PTY
兼容性。

### 项目结构

```text
.
├── assets/                  # 鲸鱼图标与 UI 截图
├── plugins/
│   ├── desktop-skins/       # 皮肤注册、设置图库与 Host 持久化
│   ├── desktop-sidebar/     # 右侧工具注册表、Review、Browser 与 Files
│   ├── desktop-shell/       # Electron bridge 与 PTY host
│   ├── panel-controls/      # Terminal 和面板控制
│   ├── pinned-summary/      # Session 摘要
│   ├── plugin-marketplace/  # 目录、隔离预览、更新与恢复
│   └── shared/              # 内置 plugins 共用的 locale 契约
├── scripts/                 # 构建、stage、smoke 和 macOS 打包
├── src/                     # Electron 主进程、preload 与根 bundle
├── tests/                   # Node test runner 回归测试
├── dsh-source.json          # DSH 版本、ref 与完整 commit 固定
└── cordis.patch.yml         # DSH bundle layer
```

## 提交约定

提交使用 `module: subject` 格式，并包含正文和 DCO：

```text
workspace: embed review tools

Explain what changed and why.

Signed-off-by: Your Name <you@example.com>
```

正文每行不超过 72 个字符。可以使用 `git commit -s` 自动添加签名。

## 致谢与下游关系

`@oh-dsh/desktop-sidebar` 是
[`dsh-external/DSH-better-sidebar`](https://github.com/dsh-external/DSH-better-sidebar)
的下游独立实现。我们参考并吸收了它成熟的注册/注销生命周期、Session 标签
恢复、文件查看器优先级、功能开关和 orphan 容错设计。感谢原项目维护者在
DSH 侧边栏扩展机制上的探索。

本项目没有照搬上游 UI、主题或组件样式；Oh-DSH 继续使用现有的内嵌布局、
图标、尺寸和 `desktop-skins` 主题系统，并把能力收敛到单一
`@oh-dsh/desktop-sidebar` plugin。上游项目使用 MIT License；详细说明见
[第三方声明](./THIRD_PARTY_NOTICES.md)。

## License

[BSD 3-Clause](./LICENSE)
