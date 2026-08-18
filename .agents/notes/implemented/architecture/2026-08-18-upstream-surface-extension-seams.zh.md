# Agent Note: 在公开扩展接口上固定已发布的交互层依赖

Status: implemented

[English](2026-08-18-upstream-surface-extension-seams.md) | 中文

## Problem

Oh-DSH 在保持单一 DSH runtime 和统一产品身份的同时，适配 Better Sidebar
与 dsh-TUI。依赖上游私有 UI 内部实现会让升级变得脆弱；而在离线 Nix 构建
中重新生成已发布的 TUI 产物，又会触发未声明的嵌套依赖安装。

## Decision

- 将 Better Sidebar 与 dsh-TUI 固定到已发布的 commit，并明确固定
  dsh-TUI 嵌套的 ecosystem-spec 与 dsh-std revision。
- 复用 Better Sidebar 的 host 能力，由 Oh-DSH 自己的 Desktop 与 Web
  组件负责渲染。
- 终端渲染由 dsh-TUI 负责。Oh-DSH 插件市场通过其公开 scene 与 shortcut
  service 注册，并复用 renderer 提供的 React 与 UI kit。
- 只对复制后的编译 renderer 执行一次带守卫的转换，不转换上游
  TypeScript 源码。
- Nix 构建保留固定的源码图用于依赖解析，但使用相同版本的已发布 TUI
  产物及其内置 dsh-std package，保证离线构建且不发生第二次依赖安装。
- 固定版本的 DSH 按其 pnpm lock 与 release-age 策略构建，并在最终组装时
  统一 pinned source 与 llm-agents 两种 Nix 输出根目录。
- 双语源码发现不扫描固定的 upstream 与生成的 release 目录；其中的文档
  分别遵循上游或打包产物自己的生命周期。
- 旧的 `dsh-cc-tui` 标识只为已有用户配置保留保护；新 Profile 使用
  `@deepseek-harness-tui/dsh-tui`。

## Alternatives considered

**分叉两个上游客户端。** 这样可以完全控制 UI，但会重复维护 renderer，
并把每次上游发布变成手工移植。

**在 Nix 中执行上游 TUI build script。** 该脚本会嵌套执行
`pnpm install`，无法在离线 sandbox 中稳定满足。

**为终端扩展增加第二套 plugin loader。** 这会让信任、预览和恢复流程
脱离共享的 DSH Profile 与 Loader。

## Consequences

- 上游升级被限制在已声明的 service 接口和经过检查的编译 renderer 适配。
- Nix 分别固定源码 commit 与对应已发布 TUI 的完整性哈希。
- 两种 DSH provider 即使 Nix 输出根目录不同，也会生成相同的 staged
  runtime 布局。
- 上游 README 与打包后的 README 不再进入 Oh-DSH 源文档翻译门禁。
- 本地源码构建仍会验证上游源码，发行组装可以使用上游发布的编译产物。
- 旧 TUI package 名称的兼容行为保持显式，可在已有配置迁移后移除。
