# Agent Note：启动器符号链接解析

Status: implemented

[English](2026-08-22-launcher-symlink-resolution.md) | 中文

## Problem

macOS 安装文档建议用 `sudo ln -sf` 把 `bin/ohdsh` 软链接到
`/usr/local/bin`，但启动器用 `$0` 计算根目录时不解析符号链接，
于是从 `/usr/local` 报出误导性的 "Oh-DSH is not built"（#116）。

同一版本还把只读模式下的 marketplace 降级为可浏览服务；该决策归属
跨端锁的 owner note
（[2026-08-17-cross-surface-read-only-session-lock](../architecture/2026-08-17-cross-surface-read-only-session-lock.md)），
已在其中记录。

## Decision

`bin/ohdsh` 在计算根目录前用 POSIX 的 `while [ -L ]` 循环解析 `$0`
的符号链接链（macOS 的 `readlink` 没有 `-f`），使 `/usr/local/bin`
里的链接能找到安装的应用布局。

## Consequences

- 启动器在 macOS/Linux 上可从任意相对或绝对符号链接链启动；
  Windows 的 `ohdsh.cmd` 不受影响（cmd 自行解析脚本路径）。
- 由 `tests/launcher-symlink.test.ts` 覆盖（Windows 跳过）。

## Alternatives considered

- 更新 macOS 文档去掉 `ln -sf`：网络上的既有指引仍会踩坑；循环
  只有六行；否决。
