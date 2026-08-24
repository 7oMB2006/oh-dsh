# Agent Note: Use a release skill for stable application publishing

Status: implemented

[English](2026-08-24-release-skill-for-stable-publishing.md) | 中文

## Problem

Oh-DSH 的稳定版发布要求 package manifest 版本、带 `v` 前缀的 tag、Release
workflow 与 GitHub Release 资产保持一致。workflow 会拒绝与 `package.json`
不匹配的 tag，但此前没有一个可复用的位置记录打包失败后的恢复步骤。

## Decision

- 新增 `.agents/skills/dsh-release/SKILL.md`，作为稳定版应用发布的 agent
  操作流程。
- 明确两种版本形式：`package.json` 使用 `X.Y.Z`，发布 tag 使用
  `vX.Y.Z`；推送 tag 前先校验两者匹配。
- 要求版本准备 PR 合并后再对 `origin/main` 打 tag，并观察 `Release`
  workflow、核对最终发布资产。
- 对确定且与源码有关的打包失败，只删除已核实的失败 tag，提交修复 PR，
  等待合并后再对新的 main 提交打 tag。若已有 Release 或资产发布，则交给
  maintainer 恢复，不能盲目删除。

## Alternatives considered

**只在 `docs/usage.md` 中记录流程。** 不采纳：面向用户的使用文档不是
agent 专用 tag、CI 与回滚约束的合适位置，也会让发布时的操作说明更难发现。

**先推 tag，再在必然的版本不匹配失败后修复。** 不采纳：Release workflow
已有确定性的版本门禁，这样做只会制造一次可以预见的失败运行和远端 tag 变更。

**用脚本自动完成所有 tag 删除与 PR 恢复。** 不采纳：删除远端发布历史、
判断失败属于源码还是基础设施都需要现场检查，应保持显式操作。

## Consequences

- 发布 agent 有一份简洁且对应实际 workflow 与资产边界的操作流程。
- 每次稳定版发布都必须先合并版本准备变更，再推送 tag。
- 恢复流程保持谨慎且不接触凭据；skill 不嵌入或打印 API key。
- 若已有部分 Release 发布，skill 不替代 GitHub Actions 或 maintainer
  的恢复判断。
