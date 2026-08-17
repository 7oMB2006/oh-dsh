# 双语文档

[English](README.md) | 中文

本仓库的文档会被人和 agent 阅读，因此范围内的每篇文档都以英文和简体中文维护。本页定义配对约定、检查、范围与排除规则；[translation-rules.md](translation-rules.md) 定义如何翻译；[terminology.md](terminology.md) 是术语真源。agent 的日常工作遵循根 [AGENTS.md](../../AGENTS.md) 中的轻量路径；扩展版 [.agents/skills/dsh-translate-docs](../../.agents/skills/dsh-translate-docs/SKILL.md) 工作流仅在用户显式调用时可用。

## 配对约定

- **两种语言同权。** 一篇文档可以先用任一语言撰写和评审，另一侧由它翻译而来。两个文件谁也不高于谁；约束它们的是二者必须说同样的话。
- **一对文档是三个同目录文件。** 英文 `foo.md`、中文 `foo.zh.md`，加一份一致性记录 `foo.i18n.yaml`，都在同一目录。不用语言目录，不用独立翻译仓库，不用中英混排的单文件。配对必须整体合并：PR 永远不会只带一种语言而缺其余两个文件。
- **一致性记录。** `foo.i18n.yaml` 保存两侧文件在上一次被确认「说同样的话」时各自的完整 git blob hash：

  ```yaml
  foo.md: 3f786850e387550fdab836ed7e6dc881de23001b
  foo.zh.md: 89e6c98d92887913cadf06b2adb97f26cde4849b
  ```

  用 blob hash 而不是 commit hash，这样同一个 PR 里改动的文件也能算出记录（`git hash-object foo.md`），一致性是纯内容比较。`--write` 会先把这些快照存入本地 Git 对象库再写下记录，未提交的工作树内容也不例外。因此记录的 hash 能还原任一侧上次确认时的确切文本，所以失去同步的配对是「按被改一侧的 diff 最小化地修补另一侧」，从不整篇重译。两侧对齐后，`pnpm run verify-translation-pairing --write <pair>` 重新记录两个 hash；那份 yaml diff 就是「确认一致」这个动作本身，可以被评审，也正因如此，`--write` 要求点名你确认过的配对（`--write --all` 是显式的全语料形式）。
- **语言切换行。** 中文文件一律在 H1 标题后立即以 `[English](foo.md) | 中文` 链回英文。普通撰写的英文文件在同一位置以 `English | [中文](foo.zh.md)` 互链。
- **结构与另一侧一一对应。** 标题深度与顺序、列表类型、有序列表起始编号、列表项数量、表格行列数、链接目标与逐字节一致的代码块在配对两侧一一对应；完整保持规则见 [translation-rules.md](translation-rules.md)。

## 门禁：verify-translation-pairing

`pnpm run verify-translation-pairing` 机械地强制执行这份约定；CI 在每次 PR 上运行它：

1. 范围内的每篇文档都有完整配对。
2. 任何已存在的配对产物都完整且一致：三个文件齐全、每一侧的当前 blob hash 等于记录值（改了任一侧而没重新确认配对就变红）、两侧都带语言切换行、结构签名按序一致：标题深度、逐字节一致的代码块（信息字符串与内容）、表格行列数、列表类型、有序列表起始编号、列表项数量，以及除切换行之外的每个链接目标。
3. 列为 `excluded` 的文件完全没有 `.zh.md`，也没有 `.i18n.yaml`。`.agents/notes/archived/` 下冻结的 Agent Note 不受这个持续演进的门禁约束；专用校验器会要求其现有的三个配对文件完整，并将其封存。

`pnpm run verify-translation-pairing --list` 打印范围内每篇文档的当前配对状态（missing、out-of-sync 或 ok）。它从不失败；其中 missing 与 out-of-sync 行指出普通检查会拒绝的违规。

`pnpm run verify-translation-pairing <pair...>` 只检查被点名的配对——配对的三个文件中的任意一个（或其裸词干）都能点名它——因此更新循环几秒内就能验证自己的配对，而不必重新扫描全语料。CI 运行的是无参数的全语料形式；限定范围的绿灯在 PR 层面永远不能替代它。

这个门禁带来的实际规则是：**当一个 PR 修改了已配对文档的任一侧时，同一个 PR 在术语指导下直接一次完成对侧文件的更新，并用 `--write <pair>` 重新记录配对**。留下失去同步的配对的 PR 会在 CI 变红。

门禁的限制很明确：**门禁通过意味着这组文档在当前内容上的一致性得到了确认，不代表确认本身正确可靠。** 它检查记录的 hash 与 Markdown 结构；它无法判断两侧是否真的在说同样的话，也无法判断措辞是否准确、术语是否得当、行文是否自然；这部分约定由评审者把关，见 [translation-rules.md](translation-rules.md)。重新记录了 hash 但另一侧翻得潦草的配对能通过门禁；它不得通过评审。

## 范围与排除

**范围**：`.agents/notes/**` 与 `docs/**` 下的全部活跃文档。依赖目录、被忽略的构建产物目录以及冻结的 `.agents/notes/archived/` 目录树只在发现阶段排除，不属于持续演进的翻译源文档。

**排除**（永不配对，门禁拒绝为它们建 `.zh.md` 或 `.i18n.yaml`）：

- 根 `README.md` 与 `README.en.md`：中文首页保留现有的单语布局，两个文件都不纳入配对约定。
- `.agents/notes/**/AGENTS.md` 以及指向它们的 `CLAUDE.md` 指令符号链接：agent 指令，与根 `AGENTS.md` 一样只以英文维护。
- `docs/i18n/terminology.md` 与 [style-samples.md](style-samples.md)：二者本身即为中英对照文档。
- [translation-prompt.md](translation-prompt.md)：翻译流水线的提示词模板；正文逐字进入模型请求，配对翻译会改变流水线行为。
- `.agents/notes/archived/`：冻结的历史三文件配对。[`verify-archived-agent-notes`](../../scripts/verify-archived-agent-notes.ts) 校验其完整性和内容封存记录；翻译维护绝不能重写这些文件。

**统一要求**：当前及今后纳入范围的每篇文档，合并时都必须构成完整的双语配对。[scripts/translation-pairing.manifest.json](../../scripts/translation-pairing.manifest.json) 只包含显式排除项；不存在逐文件推进清单、日期分界或 README 专用政策类别。

## 分工

日常更新对侧文件时，负责处理的 agent 会先加载 [terminology.md](terminology.md)，再直接一次性更新且只处理一遍；它不会调用翻译 skill、生成简报、执行单独的翻译评审轮次，也不会委派给 subagent。扩展版 [dsh-translate-docs](../../.agents/skills/dsh-translate-docs/SKILL.md) 工作流保留这些较重的机制，仅供用户显式调用。门禁负责检查配对是否完整、记录的 hash、两侧的语言切换行，以及本文列出的结构签名；翻译质量、术语和签名未涵盖的结构要求仍由评审把关。
