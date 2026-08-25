# Agent Note: 桌面更新失败恢复

Status: implemented

[English](2026-08-21-desktop-update-failure-recovery.md) | 中文

## 问题

Desktop 更新器会把 Electron 和 Chromium 的原始失败直接显示在更新窗口中。
代理不可用时，用户可能看到 `net::ERR_PROXY_CONNECTION_FAILED` 和笼统的
`UPDATE_FAILED` 错误码；同一个错误状态还会同时提供 **Retry** 与
**Check Again**，但两个命令实际都只是重新检查。如果检查在取得 release
元数据之前失败，状态中也没有 release URL，手动下载入口反而会在最需要时
消失。

原始诊断对维护者仍然有用，但它不能指导用户恢复。更新器需要由一个明确的
所有者统一决定错误分类、重试策略、手动 release 回退，以及主进程 manager、
preload bridge 与更新 renderer 之间的失败呈现。

## 决策

`DesktopUpdateManager` 统一拥有所有更新操作失败后的恢复契约。错误对象存在
非空结构化错误码时直接使用；否则从错误消息中识别 Chromium 的 `ERR_*`
错误码。已知的代理、联网、DNS、超时、拒绝连接和磁盘空间错误会映射成简短的
恢复指引。完整原始诊断只写入更新日志，不再复制进用户提示；未知失败仍显示
原来经过长度限制的消息。

每个错误状态继续携带既有的 `retryable` 判断。可重试失败只显示一个主要操作
**Try Again**，不再同时显示重复的 **Check Again**；不可重试失败仍可提供
**Check Again**。错误码以紧凑的诊断标签保留在窗口中。

每个失败状态也必须提供手动 release 目标。已有 release 元数据时保留确切的
release URL；尚无元数据时回退到 Oh-DSH 官方 Releases 索引。`openRelease()`
先使用元数据 URL，再使用当前状态已经发布的 URL，因此早期检查失败之后，
回退入口仍然可用。

更新 preload 通过既有的 `desktop:brand-icon` IPC handler 实现
`DesktopUpdateBridge.brandIconDataUrl()`。失败 renderer 以 best-effort
方式加载打包的官方鲸鱼图，并且只在错误状态显示。图片缺失或读取失败不会
改变更新状态，也不会影响恢复按钮。

## 考虑过的替代方案

**继续在窗口显示原始更新错误。** 这样保留了最多细节，但要求用户自行理解
Electron 与 Chromium 内部错误。原始值仍保留在日志中，窗口则改为显示用户
实际可以执行的恢复动作。

**可重试失败同时保留 Retry 与 Check Again。** 两个命令在该状态下都会启动
同一次检查，形成了虚假的选择。只保留一个主要操作可以明确重试契约。

**只在取得元数据后提供 release 链接。** 网络和代理失败往往发生在元数据到达
之前，这会让回退入口恰好从这些失败中消失。官方 Releases 索引虽然不如具体
版本页面精确，但无需元数据也始终有效。

**嵌入或单独维护更新器插图。** 复制插图会增加另一份品牌资产，并逐渐偏离
Desktop shell。通过既有 IPC 所有者复用打包的官方鲸鱼图，只保留一个资产
来源；加载失败时降级为文字和按钮，而不是阻断恢复。

**自动修复代理设置。** 更新器无法安全推断或修改系统代理策略、凭据与企业
配置。它只负责识别失败并提供重试和手动 release 入口，网络修复仍由用户或
管理员完成。这里拒绝的是修改系统代理策略；后续单独交付的、仅作用于更新器
自身 session 的直连重试由另一条决策拥有，见
[直连代理回退](2026-08-24-desktop-update-direct-proxy-fallback.md)。

## 后果

更新失败现在会提供稳定错误码、有针对性的指引、单一重试入口，并且即使元数据
请求从未完成，也仍有 release 回退。维护者可以继续从日志取得原始诊断，未知
错误也不会丢失原有消息。

回退入口有意打开 Releases 索引，而不是猜测某个版本的安装包。已知错误码消息
和重试策略属于 `DesktopUpdateManager` 拥有的产品行为，后续变更必须同步更新
测试。新增 `brandIconDataUrl()` 扩展了更新 preload 契约，因此所有
`DesktopUpdateBridge` 实现都必须提供该方法。图片请求是 best-effort，不会
成为恢复流程的前置条件。

该决策改进的是失败恢复呈现。issue #113 报告的底层代理连接故障现在由另一条
[直连代理回退](2026-08-24-desktop-update-direct-proxy-fallback.md)决策
处理：检查或下载失败时绕过更新器代理直连重试一次；上面的失败呈现契约在两种
情况下都继续有效。

## 测试

`tests/update-manager.test.ts` 覆盖只嵌在错误消息中的 Chromium 代理错误码、
脱敏后的用户指引、可重试判断、官方 Releases 回退，以及打开该回退。直连重试
本身的测试覆盖随直连代理回退决策记录。既有更新器测试继续覆盖结构化代理认证
错误与未知可重试失败。更新失败窗口也在打包后的 720 × 620 视口中完成检查。
