# Agent Note: 在 Windows hoisted staging 中定位设置边界

Status: implemented

English | 中文

## Problem

Windows release staging 使用 pnpm 的 hoisted linker，因此部署后的
`dsh-host-apiproxy` 不一定位于 `.pnpm` 下。设置边界补丁器只搜索了
copy-import 布局，导致 Windows 打包在 Electron 打包前失败。

## Decision

`restoreSettingsBoundary()` 先检查 `.pnpm` copy-import 布局，再检查
hoisted 的 `node_modules/@deepseek-ai/dsh-host-apiproxy` 布局。两个路径都
解析到同一个上游 `lib/index.js`，并用两种布局的 fixture 覆盖这个契约。

## Alternatives considered

**强制 Windows 使用 copy-import linker。** 这会掩盖平台布局差异，且可能
增加安装时间和磁盘占用；拒绝。

**在 Windows 跳过设置补丁。** 这会让受支持平台拥有不同的配置边界；拒绝。

## Consequences

Windows 与 POSIX release staging 共用同一设置边界。未来 pnpm 布局改变时，
如果两个已知路径都不存在，流程仍会 fail closed。
