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
- web/tui 安装在 bin 目录放置调度式 `ohdsh` 启动器而不是符号链接：web 与
  tui 的载荷各自只携带自己 surface 的依赖，一个共享符号链接会让第二次
  安装破坏第一个 surface。启动器在安装器数据目录的 `launcher.env` 中记录
  每个 surface 的载荷位置，把 `ohdsh web`/`ohdsh tui` 路由到提供该 surface
  的载荷；卸载其中一个 surface 时会为剩余的 surface 刷新启动器。
- 标记是惰性的 `KEY=value` 文本：写入时做字符集校验，读取时逐行解析
  （绝不 source），并记录目标目录使 desktop 幂等以请求的位置为键；
  "已安装"快速路径额外校验应用、镜像、载荷与启动器仍然存在，普通重跑
  即可修复缺失。
- web/tui 目标的卸载在任何递归删除之前都以匹配的 surface 标记为闸门；
  遗留 `Oh-DSH-Desktop.app` 只有在 Info.plist 证明是本应用且版本严格更旧
  时才清退（plutil 探测，镜像 `src/mac-bundle-migration.ts` 的行为）；
  无法验证或更新的包保留并给出警告。
- 升级采用原地替换：新安装验证通过后，旧的应用包、AppImage 或载荷会连同
  残留暂存目录一起删除，每个 surface 只保留一份安装。早期版本会把被替换
  的 macOS `.app` 移入 `~/.Trash`；加入升级清理后该行为被放弃，备份只在
  暂存到验证之间存在。
- GitHub JSON 解析器在匹配前归一化所有空白，带缩进的响应与紧凑响应解析
  结果一致。
- macOS desktop 从 zip 产物安装（优先用 ditto 解压）而不是 DMG；只有当
  目标是默认 `/Applications` 路径时才会请求退出正在运行的应用，因此自定义
  目标与测试不会触碰真实会话。
- Windows 通过 `install.ps1`（PowerShell 5.1+）安装：对 web/tui 使用相同的
  版本解析、摘要校验与暂存替换，载荷位于 `%LOCALAPPDATA%\oh-dsh`，并在
  安装器自有的默认 bin 目录创建 `ohdsh.cmd` 并管理用户 PATH；desktop 通过
  NSIS 安装器的静默 `/S` 模式完成。`install.sh` 检测到 Windows shell 时
  拒绝执行并指向 `install.ps1`。
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

**配套一个 Windows PowerShell 安装器。** 最初不采纳，让首个安装器保持
Unix-only，由 NSIS `.exe` 覆盖 Windows desktop；后续因 web/tui 的 `win-x64`
载荷同样需要一行命令安装、`ohdsh update` 需要 Windows 升级路径而被明确
要求，决策反转，以 `install.ps1` 交付。

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
- `tests/install-sh.test.ts` 在 macOS 与 Linux 主机运行，
  `tests/install-ps1.test.ts` 在 Windows 运行（共用同一个 mock GitHub
  服务器）；两个套件在对方平台跳过。macOS desktop 场景没有 Windows 对应
  测试，因为伪造的 NSIS 可执行文件无法真正运行。
