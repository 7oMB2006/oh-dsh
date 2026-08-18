# Agent Note：让 Windows 原生标题栏与 macOS 覆盖式标题栏分离

Status: implemented

[English](2026-08-17-windows-native-titlebar-offset.md) | 中文

## 问题

Desktop 客户端在所有平台都应用 40px 的渲染器偏移和固定可拖拽 chrome 层。
Electron 只有 macOS 隐藏原生标题栏；Windows 仍保留原生标题栏和应用菜单。因此
Windows 内容多出一层顶部偏移，固定的 Desktop 界面也继承了错误的标题栏高度。

## 决策

Desktop 客户端从 Electron preload bridge 同步读取平台事实，在 macOS 使用 40px 偏移，
在 Windows 和 Linux 使用 0px 偏移。Desktop 客户端 chrome CSS 的回退值为零，固定的
Desktop 界面在异步元数据查询开始前就得到相同的值。该查询只提供预览身份；查询失败
不会移除已经安装的窗口 chrome。销毁时恢复此前的内联值。Windows 继续使用 Electron
原生标题栏；本次改动不再新增第二套 Windows 窗口控件实现。

Desktop 客户端在固定的右上角面板工具栏旁为 Session log 下载胶囊预留固定位置。该位置属于
Desktop chrome CSS，而不是运行时 transform，因此窗口缩放和标题栏重新渲染都不会累积漂移。Web
端使用相同的固定布局。

## 备选方案

**隐藏 Windows 原生标题栏并启用窗口控件覆盖层。** 否决：当前 Windows 配置明确
使用原生窗口 chrome；该方案还需要负责可拖拽区域、控件安全区和 Windows 窗口行为，
超出本 Issue 的范围。

**所有 Desktop 平台继续保留 40px 偏移。** 否决：这会与 Windows 原生标题栏重复，
产生报告中的空白区域。

**只移除 Windows 的 body padding。** 否决：置顶摘要和插件市场也消费共享标题栏偏移，
只改 body 会让它们在 Windows 上继续错位。

## 后果

macOS 保留自定义覆盖式标题栏。Windows 和 Linux 内容从原生窗口 chrome 下方的渲染器
视口顶部开始，固定的 Desktop 界面也使用零偏移。平台相关样式根据 preload 提供的平台
事实同步安装，并随 Desktop 客户端 effect 一起移除。
Desktop 和 Web 都会把 Session log 控件放在固定面板工具栏旁的预留位置，不在运行时测量或变换它。

## 测试

平台偏移、元数据失败路径和 Desktop 固定 Session log 位置测试通过。`pnpm run typecheck` 和
`pnpm run build` 通过。
`pnpm test` 报告 180 项：177 项通过、1 项失败、2 项跳过；命令因既有的 Windows
环境无法在 `tests/nix-collect-deps.test.ts` 中启动 `python3`（9009）而以失败退出。
Windows x64 打包命令通过，并生成安装器和 unpacked 包。对重新构建的 Windows 包进行
DevTools 检查，结果为 body 顶部内距为零、标题栏伪元素高度为零，root frame 从渲染器
视口 y=0 开始。Electron smoke preload 暴露了相同的同步平台字段，客户端 smoke 会断言
各平台的偏移。Desktop smoke 已到达客户端图谱，但在既有的工作区对话框循环中超时；Web
smoke 被既有的 Windows PowerShell 终端命令阻塞，因为该环境没有 `printf`。
