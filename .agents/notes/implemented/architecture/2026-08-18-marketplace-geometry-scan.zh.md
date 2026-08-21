# Agent Note: Marketplace 几何同步跟随打开状态

Status: implemented

[English](2026-08-18-marketplace-geometry-scan.md) | 中文

## 问题

Marketplace 插件观察整个 document，并在每次 body mutation 和 sidebar resize
时安排几何同步，即使它自己的 surface 处于关闭状态。Settings 查找随后测量
document 中的所有按钮。桌面 sidebar 过渡会改变布局并触发这些 observer，因此
关闭的 marketplace 也会给无关的动画增加 renderer 长任务。

## 决定

只有 marketplace surface 打开时才安排几何同步。打开时从已声明的 sidebar
子树中查找 Settings 控件，并在同一轮查找中复用每个按钮的矩形。打开 surface
时安排第一次几何同步；已经排队的同步在读取布局前再次确认 surface 仍然打开。 关闭时仍保留不读取布局的 footer 堆叠同步，因此收起导航保持垂直对齐。

## 曾考虑的替代方案

**保留全局扫描并调整动画**：这会把无关的 observer 成本隐藏在 frame 中，且
成本仍然随 marketplace 卡片总数增长。

**移除几何同步**：sidebar 或窗口尺寸变化时，Marketplace surface 的左边界会
失效。

**永久缓存 Settings 按钮**：当 DSH 在 session 或响应式切换期间替换 sidebar
子树时，缓存会失效。

## 影响

关闭的 marketplace 不再因为无关的 DOM 或 sidebar 活动执行布局读取。打开时仍
会在 mutation、resize 和打开动作后同步，但候选按钮数量被限制在 sidebar 内。
在 marketplace 关闭时，v23 的桌面收起测量不再出现此前观察到的长任务或大幅
animation-frame 空档。载入大型目录且保持打开的 marketplace 仍是独立的内容重排
问题。
