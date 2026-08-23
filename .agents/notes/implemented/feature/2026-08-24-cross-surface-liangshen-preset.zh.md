# Agent Note: 在所有交互端共享梁神 preset

Status: implemented

[English](2026-08-24-cross-surface-liangshen-preset.md) | 中文

## Problem

梁神 Agent preset 原本只随 dsh-TUI 提供，只有 TUI package 把它安装到用户根目录后
才可发现。Web 和 Desktop 使用同一个 DSH agent-preset service，但各自的 staged
deployment 没有这份 composition。

## Decision

- 增加 Oh-DSH 内置 `@oh-dsh/liangshen` Host plugin，并在 Web/Desktop bundle
  patch 中挂载；plugin 在会话创建前把 pinned `presets/liangshen` composition
  安装到共享用户 preset 根目录。
- TUI 不挂载这个 plugin；pinned dsh-TUI renderer 已经自带并暴露梁神模式。
- preset 源码继续放在 pinned dsh-TUI checkout 中，使 tool-bootstrap、压缩和子
  Agent 行为随其上游 owner 一起升级。
- 保持 `standard` 为默认值；梁神模式通过选择器、启动参数或环境变量显式启用。

## Alternatives considered

**复制到 staged DSH config root。** 不采纳，因为这会把 preset 变成 deployment
asset，而不是产品要求的、明确限定在 Web/Desktop 的内置 plugin。

**复制成新的 Oh-DSH plugin package。** 不采纳，因为这会产生一份由两个项目共同
维护的 composition 副本，而它的生命周期和上游归属已经由 dsh-TUI 负责。

**把梁神模式设为默认。** 不采纳，因为这会改变现有用户看到的模型工具 contract；
只提供可选能力可以保持向后兼容。

## Consequences

- Web/Desktop Agent preset 设置通过内置 plugin 解析梁神模式，TUI 继续使用 dsh-TUI
  原生实现。
- 按交互端的本地 staging 只在 Web/Desktop 包含该 plugin；TUI 不会收到重复的
  Liangshen runtime package。
- 每次 dsh-TUI 升级都需要重新验证 preset composition 以及三端 staged copy。
