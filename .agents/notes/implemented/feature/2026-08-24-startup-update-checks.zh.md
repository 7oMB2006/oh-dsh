# Agent Note: 启动时更新检查与安装器驱动的自更新

Status: implemented

[English](2026-08-24-startup-update-checks.md) | 中文

## Problem

此前只有 desktop 能检查更新，而且只能通过更新窗口手动进行。Web 与 TUI
安装无法得知出现了更新的稳定 Release，升级它们意味着手工重新执行安装器。
维护者要求在所有 surface、所有平台上实现 codex-TUI 风格的启动自动更新
检查——每次启动执行一次——并由安装脚本完成升级。

## Decision

- 在 `src/self-update.ts` 中实现统一检查：解析当前版本，从公开 GitHub API
  拉取 `releases/latest`（5 秒超时、单次尝试、可用 `OH_DSH_UPDATE_CHECK=0`
  关闭），用 `semver` 比较。检查失败即静默放弃——离线或限流的启动行为与
  现在完全一致。
- 启动接线：TUI 以 1.5 秒预算等待检查，并在第一帧前打印一行提示（在 inline
  滚回中可见）；Web 不阻塞地发起检查，在监听地址后打印提示；desktop 每次
  启动执行既有的 `DesktopUpdateManager.check()`，并在发现新版本时弹出一次
  系统通知，点击打开更新窗口。
- `ohdsh update` 在所有平台升级已打包的 web/tui 发行版：从仓库 main 分支
  下载 `install.sh`/`install.ps1`，并以检测到的 surface 运行
  （`lib/oh-dsh-web/main.js` 标记 web，其余打包布局视为 tui）。源码检出
  会被拒绝并提示改用 git；desktop 重定向到自带的校验更新器——应用运行中
  的退出与替换生命周期，shell 路径无法安全复刻。
- 落地页按检测到的平台展示安装命令（macOS/Linux 为 curl 一行命令，
  Windows 为 `irm | iex`），并保留复制按钮。

## Alternatives considered

**启动时静默自更新。** 不采纳：未经同意替换运行中的安装是安全与信任的
倒退；"提示 + 命令"模型让操作者掌握决定权，也与维护者引用的 codex-TUI
先例一致。

**为每个 surface 单独的更新器二进制或守护进程。** 不采纳：安装脚本已经
拥有经过校验的下载、暂存与原子替换；复用它们可以维持一个升级事务而不是
三个。

**desktop 也走 install.sh。** 不采纳：electron-updater 已提供带签名、
可续传、差量且支持退出时安装的更新；在应用内部用 shell 脚本退出应用
无法安全匹配该生命周期。

**按天缓存检查结果。** 不选择：明确要求是每次启动检查一次；每次检查只是
一次未鉴权 GET 且静默失败，成本可以忽略。

## Consequences

- 每次 `ohdsh tui`/`ohdsh web` 启动都会发起一次未鉴权的 GitHub API 请求
  （与其他客户端共享每 IP 每小时 60 次限额）；存在 `GH_TOKEN`/
  `GITHUB_TOKEN` 时会被使用。`OH_DSH_UPDATE_CHECK=0` 是受支持的关闭开关，
  `OH_DSH_UPDATE_API_BASE` 用于测试。
- 慢网络下 TUI 启动最多增加约 1.5 秒，快网络为零；未能在预算内返回的
  检查会被放弃，本次会话不显示提示。
- `ohdsh update` 对脚本本身的信任来自 raw.githubusercontent.com 的 TLS
  （与 `curl | bash` 同一信任根），脚本随后对 Release 产物执行自己的
  摘要校验。
- desktop 的通知每会话最多出现一次，即使反复打开更新窗口；`autoDownload`
  保持关闭，启动检查本身不会下载任何内容。
