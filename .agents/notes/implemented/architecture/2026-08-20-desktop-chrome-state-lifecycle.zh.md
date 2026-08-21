# Agent Note: 桌面外壳遵循原生窗口生命周期

Status: implemented

[English](2026-08-20-desktop-chrome-state-lifecycle.md) | 中文

## 问题

渲染器自绘的 Windows 标题栏在用户通过系统控件而不是页面按钮改变窗口状态时，可能继续显示过期的最大化或还原状态。Pointer capture 也可能通过取消或 capture 丢失结束，而不经过 pointer-up 处理器，使桌面框架停留在拖拽状态。

## 决定

原生窗口状态继续由主进程负责，并通过隔离的 DesktopBridge 推送 maximize 和 unmaximize 事件。渲染器保留启动时的状态查询；如果已有更新的原生事件到达，就忽略这个旧查询结果；菜单栏销毁时同时注销事件监听。桌面框架拖拽手柄对 pointer-up、pointer-cancel 和 lost-pointer-capture 使用同一个幂等结束路径，以活动 pointer id 区分事件，并清理待执行的动画帧。

## 曾考虑的替代方案

**由渲染器轮询窗口状态**：这会增加依赖时序的工作，并且仍可能错过两次轮询之间发生的原生状态变化。

**只在页面最大化按钮完成后更新**：这无法覆盖 Snap Layouts、键盘快捷键和原生标题栏操作。

**只保留 pointer-up 清理路径**：取消路径可能保留拖拽状态和待执行的动画帧。

## 影响

每个桌面窗口和插件预览窗口都可以发布原生最大化状态，而不再增加第二个渲染器状态源。Bridge 增加了可移除的窗口状态订阅；显式释放 capture 后即使随后触发 capture-loss 事件，拖拽清理也不会重复执行。验收检查覆盖事件通道和所有拖拽结束处理器，但仍需要在真实 Windows 环境中验证交互行为。
