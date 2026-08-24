# Agent Note: 浏览器移交由 oh-dsh web 启动器独占持有

Status: implemented

[English](2026-08-24-web-launcher-owns-browser-handoff.md) | 中文

## 问题

DSH runtime 0.1.1-rc.2(#122)为 `@deepseek-ai/dsh-web-app` 引入了由 `webStartup` 服务驱动的浏览器移交：行配置解析 `openBrowser: !!js ctx.webStartup.openBrowser`,web-startup 插件在未传 open 旗标时将该值默认为 `true`。PR #132 在 desktop surface 的 `web-runtime` 行上固定了 `openBrowser: false`,但 Oh-DSH Web 启动器(`src/web.ts`)spawn runtime 时只传 `--profile web --host --port --trusted-host`,从不传 open 旗标,于是 `webStartup.openBrowser` 解析为 `true`：bundle 在启动器自己的移交之上又开了一个标签页,且 `ohdsh web --no-open` 只能让启动器闭嘴,bundle 照开一个。

## 决策

启动器在 runtime spawn 参数里加 `--no-open`,与它已经经由同一条 `webStartup` seam 传递的 `--host`/`--port`/`--trusted-host` 并列。启动器保持为打开浏览器的唯一决策点：它的 `--open`/`--no-open` 旗标、`stdout.isTTY` 交互默认、`DSH_OH_WEB_OPEN` 环境变量覆盖全部继续有效,bundle 不再把 URL 交给系统浏览器。

## 考虑过的替代方案

**在 `web/cordis.patch.yml` 固定 `openBrowser: false`。** 否决：web profile 也可被独立 `dsh --profile web` 访问,那里上游的交互式默认打开是预期 UX;patch pin 会对所有人取消它。旗标方案把抑制限定在 launcher 路径。

## 后果

`ohdsh web` 恰好开一个标签页(`--no-open` 时零个,`--open` 强制时一个);独立 `dsh --profile web` 保留上游交互默认。若未来 runtime 版本重命名或移除 `--no-open`,启动器会在 runtime 启动时大声失败,而不是静默双开。已在真实 PTY 下对三条旗标路径活体验证,`pnpm run typecheck` 与既有测试套件通过(228 通过;3 个失败是 Windows 上无法运行的 Nix-only 既有测试)。
