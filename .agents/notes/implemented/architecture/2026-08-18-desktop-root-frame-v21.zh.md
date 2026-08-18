# Agent Note: Desktop v21 由浏览器根框架负责布局

Status: implemented

[English](2026-08-18-desktop-root-frame-v21.md) | 中文

## 问题

桌面客户端需要由一个所有者负责 sidebar、conversation、details 和 overlay slots。DSH 已交付的 ui-layout 同时负责根 grid，并在收起 settle 路径中移除面板 entry；而桌面表面需要更慢的可见列宽过渡和稳定的子组件挂载。v20 的修复禁用了过渡并增加 edge rail，只隐藏了现象，没有建立布局所有权。

## 决定

Oh-DSH desktop bundle 禁用 ui-layout，插入私有的 @oh-dsh/desktop-frame client plugin。该插件注册带有 sidebar、conversation、details 和 shell.overlay 子项的 root slot，保持这些子项挂载，并负责 sidebar/details 宽度、窄窗口收起、拖拽手柄、主题 token 投影和 layout service。它使用 DSH slow transition 变量驱动 grid 过渡；拖拽期间临时关闭过渡。

Desktop frame 是组合层，不替代子功能插件。Sidebar、conversation、details、overlay、theme 和 runtime service 仍通过原有 slots 与注入 service 进入。Frame 不新增第二套菜单、标题栏或 session renderer。

只有在打包窗口位于前台、没有被遮挡，并且报告 document.visibilityState === visible、document.hidden === false 时，可见时序测量才有效。后台或被遮挡的 Chromium 窗口可能节流 timer 与 animation callback，因此这些样本不能证明 renderer 卡顿。验收检查应按 animation frame 检查列轨迹，并单独记录 long task。

## 曾考虑的替代方案

**保留 ui-layout 并调整收起延迟**：这会保留两个互相竞争的根布局所有者，也不能保证过渡期间子项持续挂载。

**保留 v20 的 immediate rail workaround**：它移除了可见过渡，也没有解决根布局所有权和时序问题；这里只通过负向回归断言保证它不再回来。

**把桌面行为分散到每个子插件**：这会在独立插件中重复宽度、响应式和 overlay 策略，使根几何无法在一个位置审计。

## 影响

桌面组合现在在加载时依赖 DSH slots 及 theme/runtime service，私有包必须随每个 desktop bundle 一起构建和 staging。Frame 增加了少量根布局代码，但提供了单一、可观测的列动画所有者，并保持子组件生命周期稳定。在声称动画平滑之前，验收包必须在真实前台窗口中测试。

切换不同的非空会话时，details 面板会在新会话绘制前关闭，与上游布局约定一致。在 Windows 上，渲染器自绘的标题栏控制同时安装在主窗口和隔离插件预览窗口中；只有主窗口显示原生应用菜单。
