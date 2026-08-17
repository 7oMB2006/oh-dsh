# Agent Note: 首次启动时清理过期的重复 macOS 应用包

Status: implemented

[English](2026-08-17-retire-stale-mac-app-bundles.md) | 中文

## 问题

打包后的 macOS 应用包在 0.1.x 系列中改了文件名——`Oh-DSH-Desktop.app`（v0.1.0–v0.1.3）变成了 `Oh-DSH Desktop.app`（v0.1.4+），但 bundle 标识符（`ai.deepseek.oh-dsh-desktop`）保持不变。从发布页 DMG 拖入 /Applications 安装的用户不会执行 `scripts/install-mac.mjs`，Finder 因而不会覆盖旧应用，而是让两个包并存：最终两个应用共享同一个 bundle 标识符，Dock、Spotlight 和自动更新可能一直解析到旧位置。issue #103 报告了这次可见改名上线后出现的重复应用。

## 决策

打包的 macOS 应用首次从 /Applications 启动时，`bootstrap()` 会调用 `retireStaleMacBundles`。该迁移探测 /Applications 下历史上的兄弟包名，用 `CFBundleIdentifier` 校验每个候选包与产品 bundle 标识符一致、且其 `CFBundleShortVersionString` 严格旧于当前运行版本，然后把符合条件的包以带时间戳的名字移入 ~/.Trash，注销旧路径，并通过 `lsregister` 把当前运行的包重新注册到 LaunchServices。版本无法校验的兄弟包永远不会被清理：保持原位并记录报告，因为未知版本不能作为"更旧"的证据。运行中的包永远不会被移动；直接从挂载的 DMG 启动（运行路径在 /Applications 之外）绝不会改动 /Applications；任何失败都只记日志、绝不中断启动。这与 `scripts/install-mac.mjs` 在本地安装时做的事一致，补齐了 DMG 安装场景下的同一缺口。

## 考虑过的替代方案

**把包文件名改回 `Oh-DSH-Desktop.app`。** electron-builder 用 `productName` 直接决定 `.app` 目录名，且没有按平台覆盖的选项；`productName` 同时驱动 Linux 桌面 `Name=` 和 Windows 文件元数据，全局改回会回归其他平台的显示名。它还会把重复问题转嫁给三个已发布的 `Oh-DSH Desktop.app` 版本的用户，而且文档和 README 已经写明 `/Applications/Oh-DSH Desktop.app` 路径。

**在 `afterPack` 阶段改名。** DMG 和 ZIP 目标按 `productName` 解析应用路径（macPackager.js），打包后改名会破坏产物生成；electron-builder 也没有任何选项能把包文件名与 `productName` 解耦。

**用 LaunchServices 或 Spotlight 扫描所有同标识符的包。** 依赖索引新鲜度，还会在启动时引入慢扫描；探测两个历史包名既确定又快，标识符校验则把无关应用挡在范围之外。

**只把清理留在 `scripts/install-mac.mjs` 里。** 它对 DMG 拖放安装的用户从不生效，而这正是 issue 指出的缺口。

## 后果

从任何一个已发布的包名升级，都会在新版本首次启动后收敛为单个应用；被清理的包仍可在废纸篓中找回。用户启动两个已安装包中较旧的那个时不会被改动，因为比运行版本更新的兄弟包永远不会被清理。同名升级仍然依赖 Finder 的覆盖行为。清理是尽力而为：当前用户对 /Applications 无写权限时移动会失败、只记日志、启动继续。清理后 `lsregister` 的重新注册会让 Dock、Spotlight 和自动更新解析到当前运行的包。该行为由 `tests/mac-bundle-migration.test.ts` 固定。
