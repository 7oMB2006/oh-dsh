# Agent Note: Watch upstream dependencies with a scheduled bot reporter

Status: implemented

[English](2026-08-23-upstream-dependency-watch.md) | 中文

## Problem

Oh-DSH 通过 `dsh-source.json`（当前为 `@deepseek-ai/dsh@0.1.1-rc.2`）
pin 住 DSH 运行时，并通过 `upstream/` 子模块 pin 住两个插件上游。目前
没有任何机制播报上游的新版本：每次升级——例如 0.1.1-rc.2 那次——都靠人工
发现，往往滞后于发布数日，而历次 DSH 升级都需要在 `plugins/` 中做契约
适配，越早动手越有利。

## Decision

- 新增定时 `Upstream watch` workflow（每日 UTC 01:17 的 cron，外加
  `workflow_dispatch`），运行 `scripts/watch-upstream.mjs`。
- 脚本直接从仓库本身读取 pin：npm 运行时来自 `dsh-source.json`，子模块
  来自 `.gitmodules` 加 `git ls-tree` 的 gitlink——因此不存在需要同步
  维护的第二份版本清单。
- npm 检查用 semver（识别预发布版）比较 registry 的版本列表与
  `latest` dist-tag 和 pin；子模块检查报告比 pin 更新的上游 tag
  （pin 恰好落在 tag 上时精确比较，落在 tag 之后的提交上时回退到 pin
  提交时间），以及被跟踪分支领先 pin 的提交数。
- 检查结果按主题各开一个 issue，打上 `upstream-watch` 标签，由
  `github-actions[bot]` 使用 `GITHUB_TOKEN`（`issues: write`）创建。
  已存在标题带该主题 `[upstream-watch] <subject>` 前缀的 open issue
  即视为在跟踪、不再重复创建；若 issue 被关闭而 pin 未动，下一次运行
  会重新提请该主题。
- 任一主题的检查失败都会让 job 失败，而"发现新版本"退出码为 0——发现
  是信号，不是故障。未设置 `GITHUB_TOKEN`/`UPSTREAM_WATCH_REPO`（或
  传入 `--dry-run`）时脚本只输出报告，本地运行即处于该模式。

## Alternatives considered

- **Dependabot 或 Renovate**：npm pin 位于 `dsh-source.json` 而非包清单，
  其 npm 生态看不到；其子模块更新会以 PR 直接移动 pin，绕过 pinned-source
  规则要求的适配步骤。两个缺口都致命，故弃用。
- **单个每日滚动汇总 issue**：单一主题串无法按主题关闭，而关闭正是维护者
  标记"已处理"的方式；按主题开 issue 与按主题升级的流程一致。
- **托管的第三方监控服务**：为一个定时 workflow 即可无服务器完成的任务
  引入拥有仓库访问权的外部服务，得不偿失。

## Consequences

- 发现自动化、决策人工化：bot 绝不提 PR 或移动 pin，因为 DSH 的契约漂移
  需要人工适配后各 surface 才能跟进。
- 重复提醒是有意为之：只要 pin 落后于上游，issue 被关闭后的每次运行都会
  重新开一个，因此"不适用"的关闭应当配上说明，或次日移动 pin。
- GitHub 会在仓库 60 天无活动后停用 cron workflow；安静的仓库会悄悄停止
  监控，直到任意一次 push 或一次 `workflow_dispatch` 运行将其恢复。
- 每次运行的开销是一次 npm registry 请求加每个子模块约三次 GitHub API
  调用——无需关心 token 配额。
