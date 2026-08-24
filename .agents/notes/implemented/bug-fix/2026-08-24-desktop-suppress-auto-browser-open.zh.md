# Agent Note: 抑制桌面界面的默认浏览器自动打开

Status: implemented

[English](2026-08-24-desktop-suppress-auto-browser-open.md) | 中文

## 问题

自 dsh 0.1.0-rc.8 起，`web-app` bundle 在 webserver 启动完成后会自动打开系统默认浏览器：`dsh --profile web` 现在会在服务就绪后把 URL 交给浏览器，除非传入 `--no-open`。Oh-DSH Desktop 内嵌了同一个 bundle（`@deepseek-ai/dsh-web-app` 在 `DESKTOP_BUNDLES` 中），因此启动桌面界面时也会额外打开一个指向 loopback URL 的浏览器标签页——即使 Electron 外壳本身已经绘制了自己的窗口并加载完全相同的 URL。

桌面 profile 的 patch 覆盖了 `web-runtime` 这个 row 的配置（`printUrl: true`、`surfaceContext: false`、`trustedHosts: []`），但未设置 `openBrowser`，于是该行回退到 bundle 的 schema 默认值 `true`。

## 决策

桌面 `cordis.patch.yml`（`web-runtime` 行）现在设置 `openBrowser: false`。这保留了 `printUrl: true`，因此运行时仍会打印 `dsh web: <url>`，supervisor 的就绪行仍会触发。桌面外壳是该 URL 的唯一打开者；系统默认浏览器永远不会被交给该 URL。

独立的 web 界面不受影响：`web/cordis.patch.yml` 没有重新声明 `web-runtime`，所以 web profile 仍然动态地从 `ctx.webStartup.openBrowser` 解析 `openBrowser`（即 `web-startup` 插件解析的 `--open`/`--no-open` 标志族）。TUI profile 完全不打包 `web-app`。

## 备选方案

**在桌面运行时的 spawn 参数上加 `--no-open`。** 被否决，因为这会把启动器与一个上游标志耦合，该标志可能被改名或移除，而且该标志只为 `web` 命令行存在；桌面已经通过自己的 patch 配置拥有界面的打开行为。把决定放在 patch 里，能落在做出该决定的那个界面上。

**仅在出现 `--open`/`--no-open` 标志时设置 `openBrowser`。** 被否决，因为桌面不暴露这些标志，而且无论 argv 是什么它都不想要交棒；一个静态的 `false` 是不含糊的。

**通过移除桌面的 `web-runtime` 覆盖来复用上游的 `--no-open` 默认值。** 被否决，因为桌面覆盖本来就存在（它已经替换了 `printUrl`/`surfaceContext`/`trustedHosts`），移除它也会丢掉这些有意设置的值。

## 影响

桌面不再打开第二个浏览器窗口。URL 行仍然打印，所以桌面运行时监督与打包的 web 启动器保持不变。`openBrowser` 配置现在在桌面界面上有一个静态默认值，其取值由桌面发行版决定，而非上游 bundle。

比 rc.2 更新的已固定 DSH 版本在 `web-app` 中仍保留自动打开；桌面 patch 无论如何都把它固定为关闭。`ohdsh web` 启动器不再获得上游交棒：自它开始向 runtime 传递 `--no-open` 起（见 [2026-08-24-web-launcher-owns-browser-handoff.zh](2026-08-24-web-launcher-owns-browser-handoff.zh.md)），该界面的浏览器交棒由启动器独占持有，独立的 `dsh --profile web` 保留上游交互式默认。
