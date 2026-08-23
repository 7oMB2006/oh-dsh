# Agent Note: Web/Desktop 复用 staged runtime 的 node-pty binding

Status: implemented

[English](2026-08-24-web-sidebar-runtime-pty-binding.md) | 中文

## Problem

Better Sidebar package 声明了自己的 `node-pty@1.1.0` 依赖。surface staging 会把这份
依赖复制到 plugin 下面，而 pinned DSH runtime 还提供了另一份为 staged Node 重新构建的
`node-pty@1.2.0-beta.15`。Linux 下嵌套副本没有可用的 native `pty.node`，导致 Web
terminal WebSocket 在输出 shell 前提前关闭。

## Decision

- 在 Web/Desktop staging 阶段，让 Better Sidebar 的 `node-pty` 解析复用 staged
  runtime 顶层 native package。
- 删除 POSIX 下无效的嵌套 store 副本，并将 staged plugin manifest 改为 runtime
  package 版本；源码 package 声明保持不变，继续兼容其自身 workspace。
- 如果 runtime 缺少 native package，则直接让 staging 失败，不静默交付降级的终端能力。

## Alternatives considered

**保留嵌套依赖并同时构建两份。** 不采纳，因为会重复 native binding，增大 staged
runtime，并允许两个终端面向不同 ABI 构建漂移。

**修改上游 Better Sidebar package manifest。** 不采纳，因为 submodule 已固定，其源码
依赖 contract 不属于 Oh-DSH 可以直接重写的边界。

**native binding 不可用时关闭 Web terminal。** 不采纳，因为选中的 Web/Desktop surface
已经携带 runtime capability；staging 应让这个能力可加载。

## Consequences

- Web 和 Desktop 使用 pinned DSH runtime 的同一份 node-pty native build。
- Linux Web terminal smoke 会真正进入 shell，不再走降级 close path。
- 后续 runtime 升级 node-pty 时，仍需满足 Better Sidebar 的兼容 API contract。
