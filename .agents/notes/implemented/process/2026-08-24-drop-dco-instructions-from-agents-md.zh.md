# Agent Note: Drop the DCO signing instructions from AGENTS.md

Status: implemented

[English](2026-08-24-drop-dco-instructions-from-agents-md.md) | 中文

## Problem

AGENTS.md 此前要求所有评审者——无论人工还是自动化——把 PR 引入的提交缺少
`Signed-off-by` trailer 视为阻塞合并的问题，并要求在评论前先用 git 枚举这些
提交。自动化评审机器人逐字引用该章节，并把它套用到它本不该约束的提交类别上
（PR 分支携带的 merge 提交、rebase 后的历史），产生需要花费评审周期去回应的
DCO 误报。仓库并没有 DCO 相关的 CI 门禁，这段文字既是唯一的"执行机制"，
也是唯一的噪音来源。

## Decision

- 从仓库级 `AGENTS.md` 的 "Commits and contributions" 一节移除 DCO 签署
  强制要求、PR 提交枚举方法，以及"未签名提交阻塞合并"的规则。
- 周边的贡献规范保持不变：英文的提交与评审用语、`<module>: <subject>`
  格式、72 字符行宽、上游许可证保留和 PR 卫生要求。
- 改写可选的 `Assisted-by:` 条目，去掉对已不存在的 DCO 的引用。
- 既有的已签名历史保持原样；贡献者仍可签署提交，但仓库不再有任何指令
  要求评审者检查它。

## Alternatives considered

**保留文字，期望评审者正确限定范围。** 不采纳：误报来自自动化评审，
散文的范围规则无法可靠地约束它们。

**把政策移到 `docs/` 而不是删除。** 不采纳：目标是让自动化评审不再把未
签名 trailer 当作阻塞项；一份"存在但不生效"的政策仍会诱导读文档的评审者
提出同样的问题。

**用 CI 而不是文字来执行 DCO。** 不采纳：那只会把误报变成硬性失败，
而且项目并没有要求增加这道门禁。

## Consequences

- 评审者（包括自动化评审）不再有可引用的仓库指令来标记未签名提交；
  DCO 类发现从此在本仓库不具可执行性。
- 项目依赖 CLA/贡献流程而非逐提交 trailer 做出声明；若外部政策重新要求
  DCO，需要再加 CI 门禁才有意义。
- 提交格式与评审用语规则仍然完全有效；被移除的只有签署强制要求及其
  评审流程。
