# Agent Note: 为 TUI 增加 Codex 风格的启动浮层

Status: implemented

[English](2026-08-23-codex-style-tui-startup-overlay.md) | 中文

## Problem

固定版本的 dsh-TUI renderer 启动时会显示鲸鱼/logo，以及多行由 renderer
负责的前端信息。Oh-DSH 需要一个具有 Codex TUI 信息层级的产品自有启动界面，
同时保持上游 renderer 和现有升级边界不变。

## Decision

- 在受守护的 renderer 适配阶段，用产品自有的启动浮层替换复制后的编译
  `LogoV2.js` 模块。
- 用紧凑的圆角框显示 Oh-DSH 标题/版本、模型与推理强度、目录和当前权限模式，
  标签采用 Codex 风格。
- 启动卡片按内容自动计算宽度；inline 模式下 Chat 根节点、行容器和 ScrollBox
  全程按内容高度排列，只有显式 fullscreen 模式才使用填满 viewport 的底部滚动
  布局。
- 保持瞬态浮层位于锚点上方，使命令/文件补全以及所有 picker/dialog 都留在
  inline frame 内；同时去掉启动卡片、上下文摘要和输入框之间重复的空行。
- 在 Oh-DSH 启动标识下禁用上游自动触发的主屏 viewport 重锚，让动态回合始终
  保持 inline 内容锚点；显式布局变化所需的 reanchor 仍然保留。
- 将 `danger-full-access` 映射为 `YOLO mode`，并保留只读与工作区可写模式的
  明确标签。
- 不再挂载上游旧 Logo 树：staged renderer 只包含新的 overlay，其余 TUI
  行为仍由上游负责。

## Alternatives considered

**分叉或直接修改上游 TUI 源码。** 不采纳，因为这会增加 renderer 升级成本，
并破坏固定 submodule 的维护边界。

**增加第二套 TUI plugin loader 或新的 scene service。** 不采纳，因为启动头部
  已经由 renderer 所有，需求不需要新的生命周期或能力边界。

**只重命名现有 wordmark，保留原启动画面布局。** 不采纳，因为需求关注的是
  Codex 的信息层级，包括带框的模型、目录和权限行。

## Consequences

- 启动时显示 Oh-DSH 身份，不再包含或露出上游鲸鱼、动画、tip、渐变
  wordmark 或 drift 提示。
- 浮层在渲染时读取配置中的权限环境变量；后续 session-mode 变化仍由现有的
  状态栏和权限流程表达，而不是修改静态启动摘要。
- 适配器拥有一个精确的编译模块 seam，因此上游 `LogoV2` 签名或大小写变化
  会在打包时明确失败，需要有意更新适配逻辑。
