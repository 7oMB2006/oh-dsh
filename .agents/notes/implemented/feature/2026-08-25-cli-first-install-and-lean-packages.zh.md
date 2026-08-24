# Agent Note: 让命令行安装优先并精简发行包

Status: implemented

[English](2026-08-25-cli-first-install-and-lean-packages.md) | 中文

## 问题

命令行安装器此前默认安装 Desktop 包，Linux 用户安装后只有原生的
`oh-dsh-desktop` 路径，没有注册 `ohdsh` 命令。打包运行时还携带了 Node
头文件、npm、开发文件、source map 与 TypeScript 声明；这些内容不属于已发布
启动链路，却让 Electron 安装目录远大于压缩下载包所显示的体积。

## 决策

- 在[跨 surface 安装器决策](2026-08-24-install-sh-cross-surface-installer.md)
  的基础上，`install.sh` 与 `install.ps1` 默认安装 TUI；Web 和 Desktop
  仍通过 `--surface`/`-Surface` 显式选择。
- 两个安装器都把 Desktop 可执行文件写入共享的 dispatcher（调度器）记录。
  生成的 `ohdsh desktop` 会启动该可执行文件，同时保留直接的
  `oh-dsh-desktop` 入口。
- Unix 类系统会把安装器的 bin 目录注册给新 shell，Windows 会把它注册给
  新用户终端；现有 shell 不会被原地修改。
- 原生 PTY 编译完成后，只暂存启动所需的运行时文件：非 Windows 平台去除
  Node 符号，删除 Node 头文件、share 与 npm 工具，并删除 DSH 运行时中的
  TypeScript 源文件、声明和 source map。

## 考虑过的替代方案

**默认安装全部 surface。** 不采纳：三个独立包会重复携带固定版本的 Node 与
DSH 运行时，增加下载和磁盘占用，也会让命令行安装为用户可能不用的界面付费。

**继续默认 Desktop，只记录它的绝对可执行文件路径。** 不采纳：这会让首次
命令行安装与 TUI 工作流不一致，并且在安装其它 surface 以前无法使用共享的
`ohdsh` 命令。

**移除随包 Node 或 pnpm 运行时，改用系统工具。** 不采纳：发行包必须保留
固定且跨平台一致的运行时，插件市场操作也依赖随包提供的 pnpm 入口。

**只在 Electron builder 配置中裁剪文件。** 不采纳：同一份暂存运行时会进入
Desktop、Web 与 TUI 包，staging 边界才是保持三种发行形态一致的唯一位置。

## 后果

- 直接执行命令行安装后使用 `ohdsh tui`；安装其它 surface 后再使用
  `ohdsh web` 与 `ohdsh desktop`。
- dispatcher 负责路由，但不会取代原生 Desktop 入口。
- 裁剪后必须继续通过 runtime 与 Web 冒烟测试；启动速度优化不属于本次决策。

## 验证

- 暂存 DSH 运行时从约 363 MB 降至 242 MB。
- 暂存 Node 运行时从约 241 MB 降至 132 MB。
- 同一源码下，本地 Linux AppImage 探针从 v0.1.9 的 239,882,313 字节降至
  精简规则下的 212,912,254 字节。
- runtime 冒烟、Web 冒烟和隔离环境下的完整测试均通过。
