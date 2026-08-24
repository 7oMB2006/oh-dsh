# Agent Note: 开发阶段只暂存选中的交互形态

Status: implemented

[English](2026-08-24-surface-local-development-staging.md) | 中文

## Problem

共享 staging 脚本过去每次本地启动都会安装 Oh-DSH Desktop、Web 和 TUI 的全部
package，导致 `make tui` 和 `make web` 也要承担无关交互形态的启动成本，并且
可能在开发时留下含混的全形态 runtime。

## Decision

- 为 `scripts/stage-dsh.mjs` 增加 `--surface all|desktop|web|tui`；默认值仍为
  `all`，保证发布和既有完整 staging 流程不变。
- 为每个交互形态定义明确的 package 闭包；安装选中闭包前，移除未选中的
  Oh-DSH package link 和 manifest dependency。
- `make tui`、`make web` 和 `make desktop` 使用对应的 surface staging；`make stage`
  继续执行完整共享 staging。
- 保留选中 Profile 所需的 pinned DSH runtime 与 host dependency；优化移除的是
  无关的 Oh-DSH 交互层 package，不削弱当前形态所需的核心能力。
- Makefile 的 `upstream` target 每次构建都执行 `git submodule update --init`，
  使 checkout 始终跟随记录的 gitlink；只有当 dsh-TUI 检出的修订号与 `.stage/`
  下的 stamp 不一致时才重新编译，增量 checkout 不会再把过期的编译产物当作
  新 pin 暂存。

## Alternatives considered

**继续使用全形态开发 staging。** 不采纳，因为会拖慢本地启动，并掩盖形态声明
不完整的问题。

**为每种界面维护一套复制脚本。** 不采纳，因为会重复 dependency closure 和
staging link 逻辑。

**运行时从 patch YAML 自动推导 package。** 不采纳，因为显式 surface 闭包更易
审查、测试，也更容易在发布约束变化时保持稳定。

## Consequences

- 本地 TUI/Web staging 更小，不会因为上一次 full stage 而意外加载 Desktop-only
  package。
- 发布流程仍可使用默认的完整 staging，不需要额外参数。
- 新增 surface package 时，需要同步更新显式闭包和对应的 patch/profile contract。
