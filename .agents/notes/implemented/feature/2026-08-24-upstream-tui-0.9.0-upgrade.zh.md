# Agent Note: 将 pinned dsh-TUI renderer 升级到 0.9.0

Status: implemented

[English](2026-08-24-upstream-tui-0.9.0-upgrade.md) | 中文

## Problem

上游 renderer 原来固定在 0.8.8，但它的后台 registry 检查会在 Oh-DSH 中提示
新版本。如果让上游 `/update` 修改 TUI Profile，就会绕过 Oh-DSH 的适配与打包
contract。

## Decision

- 将 dsh-TUI submodule 和已发布 renderer 一起固定到上游 0.9.0。
- 同步更新 Nix source revision、GitHub source hash、npm tarball URL、完整性
  hash 以及第三方 notice。
- 继续由 Oh-DSH 的 guarded compiled-renderer adapter 负责品牌、启动布局和
  update-check gate。
- 通过 Oh-DSH 启动环境标识禁用上游后台自动更新检查；后续升级统一走 Oh-DSH
  的 pinned release 流程。

## Alternatives considered

**直接在用户 Profile 中运行 `/update`。** 不采纳，因为它可能安装尚未经过
Oh-DSH adapter 和打包检查的 renderer。

**只修改界面显示的当前版本。** 不采纳，因为 runtime、Nix source、npm 产物和
provenance notice 仍会互相不一致。

**直接跟踪 upstream `main`。** 不采纳，因为本地源码和 Nix 打包都需要可复现的
renderer 产物。

## Consequences

- staged TUI 使用 dsh-TUI 0.9.0，并且在 Oh-DSH 环境中不再显示上游后台更新提示。
- 后续升级 dsh-TUI 需要一次有意的 pinned upgrade，并重新完成 adapter/staging
  验证。
- 复制后的 renderer 仍保留上游手动更新实现以维持兼容，但后台检查不再向用户
  暴露它。
