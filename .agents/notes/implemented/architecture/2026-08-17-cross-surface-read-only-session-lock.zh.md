# Agent Note：跨端会话归属与只读查看

Status: implemented

[English](2026-08-17-cross-surface-read-only-session-lock.md) | 中文

## 问题

Desktop、Web 和 TUI 各自针对同一个共享数据根启动独立的 DSH runtime 进程。
DSH JSONL 会话持久化只允许每个会话有一个活动写入者，并且不提供跨进程写
协调。当两个表面并发写入同一个会话时，它们各自的 seq 游标可能交错，从而
损坏日志。

## 决策

新增数据根锁，指定一个表面作为活动写入方。后续表面不再被直接拒绝，而是
可以作为只读查看方启动：

- `tryAcquireRuntimeLock()` 为第一个表面返回写锁；当另一个活动表面已持有
  数据根时，返回只读结果。
- 只读 runtime 接收 `OH_DSH_READ_ONLY=1`。
- Host 侧 guard 在只读模式下阻止 `sessionPersistence.create()` 和
  `append()`。
- 只读模式会跳过或最小化 marketplace 挂载与 profile 初始化，避免修改活动
  表面持有的状态。
- 锁文件记录 launcher PID、runtime child PID 和进程启动标识，使 stale 锁
  回收不会绕过孤儿 runtime 或误判被复用的 PID。

## 曾考虑的替代方案

- 直接拒绝所有第二个表面：实现简单，但会在其他表面活跃时无法查看共享历史。
- 精确到每个会话的归属追踪：更精确，但需要 DSH runtime 配合上报哪些会话
  处于活跃状态以及由谁持有。

## 后果

- 第二个表面可以查看历史，而不会冒并发写入的风险。
- 只读模式下的写入会以清晰的只读错误失败。
- 已损坏的旧日志不会自动修复。
- 由于没有可用的原子 compare-and-swap，stale reclaim 锁需要手动清理，
  不能安全接管崩溃遗留的 mutex。
