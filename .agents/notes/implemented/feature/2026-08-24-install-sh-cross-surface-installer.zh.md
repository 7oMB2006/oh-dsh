# Agent Note: install.sh 跨 surface 发行安装器

Status: implemented

[English](2026-08-24-install-sh-cross-surface-installer.md) | 中文

## Problem

用户此前必须克隆仓库或从 Release 页面手工挑选压缩包才能安装 Oh-DSH。三种
surface 以命名各异的产物发布（electron-builder 的 desktop 包、按平台的
web/tui tar 包），且只有 runtime 包附带 `.sha256` 旁车文件，因此不存在一个
受支持的统一入口，能对任意 surface 完成最新稳定版的解析、校验与安装。

## Decision

- 在仓库根目录提供一个覆盖全部三种 surface 的 POSIX `sh` 安装器，通过
  `--surface desktop|web|tui`（默认 `desktop`）选择。每个 surface 只安装
  自己的文件：macOS desktop 是 `/Applications` 下的 `.app`，附带 Launch
  Services 刷新与残留包清退；Linux desktop 是 `~/.local/bin` 下的
  AppImage；web/tui 是载荷加 `ohdsh` 符号链接。只有 desktop 会注册应用
  入口。
- 下载校验使用 GitHub REST API 已为每个资产发布的 `digest`（sha256）字段。
  它无需改动发布流程即可覆盖所有既有 Release，且在摘要缺失或不匹配时
  拒绝安装（fail closed）。
- 安装事务：解析最新稳定版（`releases/latest`，因此预发布不会被隐式选中；
  `--version` 固定标签时可以显式安装预发布），下载、校验、解压并在临时目录
  中验证，然后移开旧安装、原子换入新安装。标记文件（载荷内的
  `.oh-dsh-install.env`、`~/.local/share/oh-dsh/desktop/install.env`）让
  相同版本的重复执行变成无操作，除非传入 `--force`；`--uninstall` 执行
  反向卸载。
- macOS desktop 从 zip 产物安装（优先用 ditto 解压）而不是 DMG；只有当
  目标是默认 `/Applications` 路径时才会请求退出正在运行的应用，因此自定义
  目标与测试不会触碰真实会话。
- 脚本只支持 Unix/macOS。Windows（包括被脚本检测并拒绝的 Git Bash）的
  受支持路径是 `.exe` 安装包或 `win-x64` 便携包。
- 测试（`tests/install-sh.test.ts`）通过 `OH_DSH_API_BASE` /
  `OH_DSH_DOWNLOAD_BASE` 把脚本指向本地 mock 的 GitHub API 与下载端点，
  用 `OH_DSH_LSREGISTER` 提供记录调用的 lsregister 桩，并以 `--os`/
  `--arch` 覆盖使 macOS 注册决策在任何主机上都能断言。测试必须异步拉起
  脚本：同步 spawn 会阻塞服务 mock 的事件循环，使安装器的 curl 死锁。

## Alternatives considered

**在发布流程中为所有资产生成 `.sha256` 旁车文件。** 不采纳：目前只有解耦
的 runtime 包有旁车；API digest 无需改动发布流程即可覆盖每个历史版本的
每个资产。

**为 desktop 读取 `latest-mac.yml` 做校验。** 不采纳：那是 electron-updater
的元数据，只覆盖 desktop 产物且使用 sha512；API digest 对三种 surface 是
统一来源。

**默认使用交互式 surface 选择器。** 不采纳：`curl | bash` 天然非交互；
显式、有文档的 `--surface` 加旗舰默认值 `desktop` 让一行命令保持确定性。

**配套一个 Windows PowerShell 安装器。** 本次不做：NSIS `.exe` 已覆盖
Windows desktop，web/tui 的 `win-x64` 包自包含；脚本以可操作的提示拒绝
Windows shell。

**通过 `hdiutil` 从 DMG 安装 macOS desktop。** 不采纳：zip 产物携带相同的
bundle，没有挂载/卸载生命周期与清理风险。

**让 desktop 升级走 electron-updater。** 不采纳：应用内更新器已负责
desktop 自更新；shell 安装器补足首次安装与脚本化场景。

## Consequences

- 文档化安装 URL 是 `raw.githubusercontent.com/.../main/install.sh`，脚本
  随分支演进，而不是冻结的 release 资产；`release.yml` 不变。落地页在
  hero 区 surface 卡片下方以可复制的终端块展示这行命令，站点与安装 URL
  需要保持人工同步。
- 版本解析依赖 GitHub 的紧凑 REST JSON 形态。摘要解析器是无依赖的
  `awk`/`grep`/`sed`，按 `},{` 分隔资产对象（嵌套的 `uploader` 对象会让按
  `{` 切分的方案失效）；任何使摘要查找失效的形态变化都会以可操作的错误
  提示失败关闭，而不是安装未校验的字节。
- 未鉴权安装共享 GitHub API 每IP 每小时 60 次的限额；受限环境可使用文档中
  的 `GH_TOKEN`/`GITHUB_TOKEN`。
- 安装器的簿记位于 `~/.local/share/oh-dsh` 与载荷内部；`~/.ohdsh` 仍然
  完全是由 `src/data-root.ts` 拥有的共享应用数据根。
- 安装器测试只在 macOS 与 Linux 主机运行（Windows 跳过）；CI 的三个
  matrix 节点覆盖它。
