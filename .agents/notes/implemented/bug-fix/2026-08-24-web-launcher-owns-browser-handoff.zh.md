# Agent Note: 浏览器移交由 oh-dsh web 启动器独占持有

Status: implemented

[English](2026-08-24-web-launcher-owns-browser-handoff.md) | 中文

## 问题

DSH runtime 0.1.1-rc.2（#122）为 `@deepseek-ai/dsh-web-app` 引入了由 `webStartup` 服务驱动的浏览器移交：该行解析 `openBrowser: !!js ctx.webStartup.openBrowser`，而 web-startup 插件在未传入 open 旗标时将该值默认为 `true`。PR #132 在 desktop surface 的 `web-runtime` 行中固定了 `openBrowser: false`，但 Oh-DSH Web 启动器（`src/web.ts`）启动 runtime 时只传入 `--profile web --host --port --trusted-host`，从不传入 open 旗标，因此 `webStartup.openBrowser` 解析为 `true`：捆绑包在启动器自身的移交之外又打开一个标签页，而且 `ohdsh web --no-open` 只会让启动器不打开浏览器，捆绑包仍会打开一个标签页。

## 决策

启动器在 runtime 启动参数中添加 `--no-open`，并将其与已通过同一 `webStartup` 接口传递的 `--host`/`--port`/`--trusted-host` 旗标并列。启动器仍是打开浏览器的唯一决策点：其 `--open`/`--no-open` 旗标、`stdout.isTTY` 交互式默认值和 `DSH_OH_WEB_OPEN` 环境变量覆盖均继续有效，捆绑包不再将 URL 交给操作系统浏览器。

## 考虑过的替代方案

**在 `web/cordis.patch.yml` 中固定 `openBrowser: false`。** 已否决，因为 web profile 也可通过独立的 `dsh --profile web` 访问，此时上游的交互式打开行为是预期 UX；配置固定会为所有人禁用这一行为。旗标方案将抑制范围限制在启动器路径。

## 后果

`ohdsh web` 恰好打开一个标签页（使用 `--no-open` 时为零个，使用 `--open` 强制时为一个）；独立的 `dsh --profile web` 保留上游交互式默认行为。若未来 runtime 版本重命名或移除 `--no-open`，启动器会在 runtime 启动时明确失败，而不会静默地双开标签页。已在真实 PTY 中对全部三条旗标路径完成活体验证，也已运行 `pnpm run typecheck` 和既有测试套件（228 个通过；3 个既有的 Nix-only 测试无法在 Windows 上运行）。
