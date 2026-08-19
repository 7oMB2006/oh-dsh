# Agent Note: 为 Web smoke 的慢速 Electron 启动留出时间

Status: implemented

[English](2026-08-18-linux-web-smoke-timeout.md) | 中文

## Problem

Linux release runner 在 Web bundle 就绪后启动 Electron smoke client 可能超过
30 秒。固定超时会让健康的 Web 包在 client 断言执行前失败。

## Decision

Web smoke client 默认等待 120 秒。维护者可以通过
`DSH_SMOKE_CLIENT_TIMEOUT_MS` 设置其他正数超时；无效值会回退到同一个
120 秒默认值。

## Alternatives considered

**从 release packaging 中移除 Electron smoke。** 这会隐藏 Desktop/Web 集成
契约，而不是验证它；拒绝。

**不改变超时而重试 Electron 进程。** 重试会增加 runner 成本，在持续启动
拥塞时仍可能失败；拒绝。

## Consequences

慢速 Linux runner 有足够时间执行现有断言，而挂起的 client 仍会在有界时间内
失败。排查启动行为时，本地运行可以覆盖等待窗口。
