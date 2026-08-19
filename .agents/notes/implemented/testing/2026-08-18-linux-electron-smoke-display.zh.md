# Agent Note: Run Linux Electron smoke under Xvfb

Status: implemented

[English](2026-08-18-linux-electron-smoke-display.md) | 中文

## Problem

当没有显示服务时，Linux release runner 可能在 Electron 创建首个
BrowserWindow 时无限等待。此时 Web runtime 健康，打包 Web smoke 仍会失败。

## Decision

打包 Web smoke 在 Linux 上优先通过 runner 提供的 `/usr/bin/xvfb-run`
启动 Electron；其他平台继续直接启动 Electron。

## Alternatives considered

**再次延长子进程超时。** 进程是在创建窗口时等待，延长超时只会掩盖缺少
显示服务的问题；否决。

**改成只检查 HTTP。** 这样会失去浏览器客户端和原生附件行为的覆盖；否决。

## Consequences

Linux CI 获得确定性的虚拟显示服务；没有 Xvfb 的本地 Linux 环境仍保留
原有的直接启动回退路径。
