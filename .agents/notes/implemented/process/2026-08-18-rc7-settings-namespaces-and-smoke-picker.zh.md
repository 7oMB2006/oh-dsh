# Agent Note：rc7 设置命名空间边界、发布年龄策略与 smoke 选择器流程

Status: implemented

[English](2026-08-18-rc7-settings-namespaces-and-smoke-picker.md) | 中文

## Problem

将固定运行时升级到 DSH 0.1.0-rc.7 暴露了五处适配：rc7 的 api-proxy 用动态
命名空间服务取代了固定设置白名单，移除了 rc.6 的配置客户端边界；rc7 包发布
在 pnpm minimumReleaseAge 窗口内；hero 工作区选择器的交互对浏览器自动化
发生了变化；固定 TUI 内嵌的 dsh-std 工作区要求 pnpm 11.21.0，而 Oh-DSH CI
此前安装 pnpm 11.20.0。

## Decision

- **设置命名空间边界**：rc7 的 dsh-host-apiproxy 通过 settings.describe()
  动态服务所有已注册命名空间，并接受对任意命名空间的设置写入；rc.6 的
  staging 补丁（exposeVisionSettingsNamespace）只是向上游白名单追加一个
  命名空间，已无法表达该边界。常规 staging 与 Nix assembly 现在调用同一个
  restoreSettingsBoundary() 模块，在部署后的 api-proxy 上重建完整显式白名单：
  settings.describe 把命名空间
  过滤到 Web 偏好、产品与插件白名单加上模型提供方命名空间，且每个设置写入
  （update/replace/mutate）对其他命名空间一律以 `settings-not-exposed`
  拒绝。白名单为 WEB_SETTINGS_NAMESPACES（agent-loop、shell、locale、
  permission、ui-conversation、ui-theme、web-search-deepseek）、
  PRODUCT_SETTINGS_NAMESPACES（ui-onboarding、agent-presets、settings）
  以及 oh-dsh-vision。`agent-presets` 最初因 rc.6 并集没有它而被遗漏；
  固定的 rc.7 client 通过该命名空间写入默认 agent preset（ui-agent-preset
  的 writeDefaultPreset），导致每次默认模式切换都以 `settings-not-exposed`
  被拒——该错误码不在 rc.7 wire schema 声明之内，client 的响应解析因此
  崩溃，界面直接展示原始 Zod issue 转储而非错误消息。白名单现已包含它，
  tests/settings-boundary.test.ts 也在补丁输出中固定了该命名空间。这让
  [2026-07-30-config-plane-boundaries.md](../architecture/2026-07-30-config-plane-boundaries.md)、
  [2026-08-10-web-plugin-configuration.md](../feature/2026-08-10-web-plugin-configuration.md)
  与
  [2026-07-31-permission-default-for-new-sessions.md](../feature/2026-07-31-permission-default-for-new-sessions.md)
  记录的配置客户端边界保持成立：注册插件默认仍然不能远程读写自己的配置。
- **发布年龄策略**：固定 assembly 的 pnpm-workspace.yaml 现在镜像仓库的
  minimumReleaseAgeExclude（'@deepseek-ai/*'），新发布的 rc 版本无需等待
  年龄截止即可安装。
- **包管理器对齐**：仓库依赖、CI 与 release 任务统一固定 pnpm 11.21.0，
  与 TUI 内嵌 dsh-std 工作区一致。生命周期脚本直接复用已验证的包管理器，
  不再在安装期间下载平台特定的 pnpm engine。peer 策略还记录了已验证的
  React 19 TUI 桥接范围，兼容仍声明 React 18 peer 的 rc7 client 包。
- **Smoke 选择器流程**：rc7 把 hero 工作区选择器的打开绑定到触发器
  textarea（点击卡片不再生效），且非可信点击偶尔不命中，因此
  scripts/smoke-client.cjs 在卡片与 textarea 之间交替点击、aria-expanded
  翻转为 true 后停止、绝不把已打开的 picker 再点关。无人值守的 smoke
  runtime 设置 SSH_CONNECTION，让 rc7 选择文档化的 browse 后端，再验证
  其真实应用内对话框。这样源码与打包 smoke 都无需自动操作原生 OS
  对话框即可确定运行。
- **TUI marketplace 重启标记**：恢复标记是辅助信息。标记持久化失败，
  例如数据根目录只读或磁盘已满时，会被忽略，Apply 与 Undo 仍会进入共享
  marketplace 事务。
- **TUI profile 迁移**：`dsh-cc-tui` 是旧版 profile 自带的 bundle，而不是
  用户扩展。升级 profile 时移除这个已淘汰条目，同时保留其他所有非自有 bundle。

## Consequences

- 所有 assembly 路径都通过同一个 fail-closed 模块修改部署后的 api-proxy；
  由显式白名单而不是注册插件决定命名空间是否到达配置客户端。
- rc 发布后可立即安装 assembly。
- 全新 macOS x64 runner 不再因为 TUI prepare 内部切换包管理器版本而触发
  身份验证失败。
- Desktop 与 Web smoke 验证同一个真实 browse 交互，不依赖平台特定的
  选择器实现；有人值守时仍保留 rc7 的自动原生选择器判定。
- TUI marketplace 在无法写入恢复元数据时仍可执行；后续启动只是没有可消费
  的恢复标记。
- 现有 TUI profile 会收敛到已发布的 renderer，同时不会丢失用户安装的 bundle。

## Alternatives considered

- 直接信任 rc7 的动态服务：settings 的 redaction 对 union、intersection
  或 transform 背后的 secrets 不是 fail-closed（见
  config-plane-boundaries），已加载的 client 插件可能读取或修改从未经过
  Web 面评审的命名空间；拒绝。
- 证明 rc7 redaction fail-closed 后保留动态服务：上游 seam 并不承诺这一
  点，且每个版本都去证明不值得丢失边界；拒绝。
- 等待发布年龄截止而非豁免：每次 rc 发布后最多阻塞一天；拒绝。
- 关闭 pnpm engine 身份验证：在两层工作区使用同一版本即可解决问题时，
  没有理由削弱仓库安全策略；拒绝。
- 由 smoke 驱动原生 OS 目录对话框：平台相关且脆弱；拒绝。
- 让恢复标记写入失败阻断 Apply/Undo：恢复标记不是事务前置条件；拒绝。
- 把 `dsh-cc-tui` 当作非自有 bundle 保留：它由旧版 TUI profile 提供，可能指向
  新运行时中不存在的 renderer；拒绝。
