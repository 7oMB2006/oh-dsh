# Agent Note：从部署后的 store 解析 npm release 的 host 依赖

Status: implemented

[English](2026-08-17-npm-release-host-dependencies.md) | 中文

## Problem

Oh-DSH 将固定的 npm release assembly（DSH 0.1.0-rc.6）staging 到
`.stage/dsh-runtime`。RC.6 升级把每个插件的 `ohDsh.hostDependencies`
按 release 版本注入 assembly manifest，使 frozen-lockfile 安装能把这些
依赖放进运行时。main 的 `vision` 插件声明了 `@deepseek-ai/schemastery`，
而该包在 release 中发布为 3.18.1 —— 并不存在 `0.1.0-rc.6` 版本。注入因此
破坏了 `pnpm install --frozen-lockfile`，staging 无法完成。

## Decision

- 完全移除 manifest 注入（`prepareNpmAssembly` / `collectHostDependencies`）。
  release 依赖图已经包含全部 host peer：DSH 包在顶层，`@deepseek-ai/dsh-credentials`
  与 `@deepseek-ai/schemastery@3.18.1` 等传递依赖在 hoisted store 中，
  由 `exposeHoistedPackages` 重新导出。
- npm release 的 host 依赖通过 `runtimeDependencyTarget` 从部署后的运行时
  store 链接：优先精确 release 版本，回退到任意已存储版本——fork 的 peer
  保留自己的版本线。
- `scripts/dsh-runtime-<version>-lock.yaml`（按固定的
  `DSH_SOURCE_SPEC.version` 命名）基于纯净 release manifest 重新生成，
  specifier 与 release 依赖图一致（caret 范围），而非注入后的精确 pin。

## Consequences

- `pnpm run stage:dsh` 在 npm release 上可与 vision 插件一起正常工作。
- 若 host peer 不在 release 依赖图中，会在链接时明确失败
  （`DSH runtime is missing host dependency …`），而不是静默解析为空。
- 提交的运行时 lockfile 现在与 release 自身的解析一致，依赖变化后重新生成
  是机械性操作。

## Alternatives considered

- 保留注入并特殊处理 fork 版本：需要手工维护一份与 release 依赖图重复的
  版本映射；拒绝。
- 在 npm release 上使用 git checkout 的 `discoverSourcePackages` 路径：
  npm tarball 是单包，没有可发现的 workspace 源；拒绝。
- 围绕注入后的精确 pin 重新生成 lockfile：无法表达
  `@deepseek-ai/schemastery@0.1.0-rc.6`，因为该版本不存在；拒绝。
