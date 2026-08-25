# Agent Note: 可折叠的工作区变更摘要

Status: implemented

[English](2026-08-24-collapsible-workspace-change-summary.md) | 中文

## Problem

工作区审查侧栏启动后会同时展开变更文件列表和提交历史。仓库包含多个编辑或提交时，内容会立即占满面板高度，用户也无法先看到这次修改的大致规模。

## Decision

「变更」和「提交历史」区域默认折叠，标题行负责切换各自的展开状态。标题使用 `aria-expanded` 和会旋转的 SVG 下拉箭头。工作区面板打开期间，紧凑摘要通过两次带作用域的聚合 Git diff 读取，并在 Git 不返回 untracked 文件 diff 时通过现有文件系统接口读取文本文件。展开「变更」区域只控制文件列表的显示，并增加带作用域的文件级读取，不会延迟标题摘要。侧栏统计新增和删除的 diff 行，在标题中显示绿色 `+N` 与红色 `-N`，并在每个文件路径前重复显示文件级统计。二进制文件或无法读取的内容显示零计数，不虚构行数。选中的提交详情位于「提交历史」区域内，只有该区域展开时才会渲染。

## Alternatives considered

**保持列表默认展开，只增加统计。** 不采用：需求的默认视图需要保留纵向空间，并让用户决定何时检查具体文件。

**修改上游 Better Sidebar 的 Git 协议。** 不采用：现有带作用域的 `gitDiff`、`fsRead` 和 `gitStatus` 已经提供所需数据，修改协议会扩大兼容性和运行时风险。

**只根据状态字母计算统计。** 不采用：状态字母只能说明变更类型，不能提供新增和删除数量；有意义的统计必须基于实际 diff 文本。

## Consequences

初始审查面板在包含大量编辑或提交的仓库中保持紧凑且稳定。用户可以分别展开需要查看的区域。展开「变更」区域会触发额外的带作用域读取，因此统计返回前标题会短暂显示加载标记。untracked 文本文件可以得到新增行统计，二进制文件则明确保持不可按文本行统计。区域展开后，既有的单文件 diff 和提交审查交互保持可用。

## Testing

`node --test tests/sidebar.test.ts tests/workspace-tools.test.ts tests/diff-stats.test.ts` 通过，共 13 个测试。`corepack pnpm@11.21.0 run typecheck` 通过。`corepack pnpm@11.21.0 run build` 通过。变更文件的 `git diff --check` 通过。
