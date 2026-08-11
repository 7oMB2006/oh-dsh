# Oh-DSH-Desktop

Oh-DSH-Desktop 是 DeepSeek Harness 的可安装桌面发行版，也是一组可以注册给 DSH 的 bundle plugins。它沿用 DSH 的 React Web UI，把 macOS 窗口、本地终端、工作区与 Git、面板控制、Pinned Summary、插件安装和运行时生命周期组合进同一个 Electron 应用，并把 DSH、Node.js 与所需原生模块一并打包。

## 架构边界

- `plugins/desktop-shell`：Electron/DSH 桥接、本地 PTY WebSocket host、原生菜单命令与桌面能力声明。
- `plugins/panel-controls`：多标签 Terminal、底部面板、侧栏切换、字号和高度偏好；终端代码由本项目拥有，不依赖 `dsh-web-terminal`。
- `plugins/pinned-summary`：跟随当前 Session 的 Pinned Summary，以及会给正文预留空间的右侧面板。
- `plugins/workspace-tools`：统一顶部面板工具栏，以及内嵌的 Review、Changes、diff、分支、commit/push、Workspace、后台进程、Browser、Files、Side chat 和 Trajectory。
- `src/plugin.ts`：根 bundle，把上面的插件作为 `@oh-dsh/desktop` 一起注册。
- `src/main.ts`：Electron shell，只负责窗口、菜单、权限、外链与 DSH 子进程监督，不承载模型或 Agent 逻辑。
- `cordis.patch.yml`：bundle layer，复用 `dsh-base` 和 `dsh-web-app`，使用临时 loopback 端口并按顺序装载桌面插件。
- `scripts/stage-dsh.mjs` 生成自包含 runtime，修复 pnpm workspace 软链接，校验官方 Node SHA-256，并拒绝任何仍指向源码检出的链接。

Review 是 Side Panel 内的工具视图，不占用独立顶部图标；Side Panel 是不带浮窗边框的完整内嵌列，并可展开覆盖 Chat。Pinned Summary 是独立的 288px 半高卡片，打开 Side Panel 时会自动收起。底部 Terminal 可以独立开关，Browser 使用隔离的 Electron webview。

## 本地运行

前置条件：相邻目录存在 DSH 源码（默认 `../dsh`），Node.js 24+、pnpm、Xcode Command Line Tools。

```sh
pnpm install
pnpm run build
pnpm run stage:dsh
pnpm start
```

首次启动后，DSH 的可写数据位于 `~/Library/Application Support/Oh-DSH-Desktop/dsh`。DeepSeek API key 可在 DSH UI 的设置/引导中配置，也可写入该目录下的 `.env`；凭证不会写入 `.app`。

## 生成 macOS 安装包

完整构建会先重建相邻 DSH 仓库：

```sh
pnpm run dist:mac
```

如果 DSH 的构建产物已经是最新的，可使用：

```sh
pnpm run dist:mac:quick
```

产物写入 `release/`：

- `release/Oh-DSH-Desktop-0.1.0-arm64.dmg`
- `release/Oh-DSH-Desktop-0.1.0-arm64.zip`
- `release/mac-arm64/Oh-DSH-Desktop.app`

当前配置生成 Apple Silicon (`arm64`) 的 DMG 和 ZIP。测试包不使用 Developer ID，适合本机安装验证；对外发布前需要配置 Apple Developer 签名和 notarization。

## 插件机制

应用内的 `DSH → 从文件夹安装插件…` 会运行：

```sh
dsh plugin --profile desktop add <plugin-directory>
```

安装完成后 DSH Runtime 自动重启。profile 的第三方依赖与 bundle 顺序保存在可写的 `profiles/desktop/package.json`。内置的 `@oh-dsh/desktop-shell`、`@oh-dsh/panel-controls`、`@oh-dsh/pinned-summary`、`@oh-dsh/workspace-tools` 和根 bundle `@oh-dsh/desktop` 会随应用一起安装，用户插件保持原有顺序。
