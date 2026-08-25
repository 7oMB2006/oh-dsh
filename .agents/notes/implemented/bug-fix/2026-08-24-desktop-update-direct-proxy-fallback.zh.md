# Agent Note: 系统代理失效时 Desktop 更新自动直连重试

Status: implemented

[English](2026-08-24-desktop-update-direct-proxy-fallback.md) | 中文

## Problem

Issue #113 反馈 Desktop 更新完全不可用（"软件更新无效"）：更新窗口每次检查都以
`net::ERR_PROXY_CONNECTION_FAILED` 失败。`syncUpdaterProxy` 会把 Chromium 为
github.com 解析出的系统代理规则复制到 `electron-updater` 分区 session。当系统代理
指向一个已停止的本地客户端时，所有更新检查与下载都会永久失败：macOS 和 Windows
上的 Chromium 忽略 `HTTPS_PROXY`/`NO_PROXY` 环境变量覆盖，而固定下来的代理规则也
失去了 Chromium 的动态回退能力。此前仅改进文案的措施（可操作的错误提示加 Release
页面链接）无法让更新真正成功。

## Decision

- `DesktopUpdateManager` 接受 `bypassProxy` 钩子。检查与下载在遇到代理连接类失败
  （`ERR_PROXY_CONNECTION_FAILED`、`ERR_TUNNEL_CONNECTION_FAILED`、
  `ERR_PROXY_AUTH_UNSUPPORTED`）时，绕过代理直连重试一次。
- 一旦触发直连，本会话内保持直连：`syncUpdaterProxy` 不再重新复制失效的系统代理
  规则。
- 在仍可能重试时，不为代理类失败发布 updater 的 `error` 事件，避免窗口在重试落地
  前闪现死胡同错误。
- `PROXY_AUTH_REQUIRED` 保留"登录代理后重试"的提示：需要认证的代理通常守护着直连
  本就无法访问 GitHub 的网络。

## Alternatives considered

**仅改进错误文案。** 不采纳：用户依然无法完成更新，该措施上线后 issue 仍未关闭。

**把默认 session 切成直连。** 不采纳：这会改变应用自身网页内容的代理行为，而不只
是更新器。

**尊重 `HTTPS_PROXY`/`NO_PROXY` 环境变量。** 不采纳作为主修复：macOS 和 Windows
上的 Chromium 忽略这些变量，而且失效的系统代理仍需要直连回退。

**对所有失败码都直连重试。** 不采纳：会把真实的服务端和网络错误掩盖在一次多余的
直连尝试后面，推迟可操作的错误提示。

## Consequences

- 系统代理失效但 GitHub 可直连时（issue #113 背后的常见配置问题）更新可以完成。
- 若直连重试也失败，呈现的错误反映直连网络的状况，而不是失效的代理。
- 每个会话只重试一次，之后不再重试代理。
- 测试覆盖检查重试、下载重试、每会话一次的直连、非代理失败不触发直连，以及事件
  抑制。
