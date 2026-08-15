<p align="center">
  <strong>简体中文</strong> ·
  <a href="./usage.en.md">English</a> ·
  <a href="../README.md">返回 README</a>
</p>

# 安装、操作与排错

## 选择发行形态

- 需要完整本地工作台：安装 **Oh-DSH Desktop**。
- 只需要浏览器交互：安装 **Oh-DSH Web**，不携带 Electron。
- 纯终端交互：安装 **Oh-DSH TUI**，不携带 Electron 或浏览器 UI。

完整版已经包含三种形态，因此安装一次后可以使用 `desktop`、`web` 和 `tui`。

## 安装完整版

### macOS

1. 从最新 Release 下载 DMG。
2. 将 **Oh-DSH Desktop** 拖入 Applications。
3. 未公证的测试构建首次运行时，在 Finder 中右键应用并选择“打开”。

如确认文件来自项目 Release，但仍被 quarantine 阻止，可对实际下载文件执行：

```sh
xattr -d com.apple.quarantine ~/Downloads/Oh-DSH-Desktop-*.dmg
```

安装统一命令：

```sh
sudo ln -sf \
  "/Applications/Oh-DSH Desktop.app/Contents/Resources/bin/ohdsh" \
  /usr/local/bin/ohdsh
```

### Linux

AppImage：

```sh
chmod +x Oh-DSH-Desktop-*.AppImage
./Oh-DSH-Desktop-*.AppImage
```

deb：

```sh
sudo apt install ./Oh-DSH-Desktop-*.deb
```

### Windows

运行 Release 中的 Windows 安装器并启动 **Oh-DSH Desktop**。统一 CLI 位于应用
资源目录的 `bin\ohdsh.cmd`，可以将该目录加入 `PATH`。

### Desktop 在线更新

在应用菜单中选择 **Oh-DSH Desktop -> 检查更新…**。更新窗口只检查
`hust-open-atom-club/oh-dsh` 的 stable GitHub Release，不需要 GitHub 登录或
token。

- macOS、Windows 和 Linux AppImage 在下载并校验后可选择立即重启安装，或在
  下次退出时安装。
- `.deb` 会下载并打开系统的软件包安装器，不会绕过系统权限执行 `sudo`、`apt`
  或 `dpkg`。
- 更新器会使用系统代理设置；离线、代理认证、404、磁盘不足、校验失败、取消和
  重试都会在窗口中显示可恢复状态。校验失败时不会替换现有安装。
- 更新只替换应用程序，现有 DSH 数据、工作区设置、会话、已安装插件和 marketplace
  receipts 保留在原有数据目录中。

仅限签名的打包 Desktop 可自动更新。首次带更新器的 Release 之前安装的版本仍需
手动安装一次；本地开发构建和缺少当前平台安装包的 Release 会提供官方 Release
页面作为回退。

## 安装 Web-only

```sh
tar -xzf oh-dsh-web-*.tar.gz
cd oh-dsh-web-*/
./bin/ohdsh web
```

Windows：

```bat
bin\ohdsh.cmd web
```

常用选项：

| 选项 | 默认值 | 说明 |
| --- | --- | --- |
| `--host` | `127.0.0.1` | 监听地址 |
| `--port` | `3080` | 监听端口；`0` 使用随机端口 |
| `--data` | `~/.ohdsh` | 三端共享的 Oh-DSH 数据根目录 |
| `--no-open` | 关闭 | 不自动打开浏览器 |
| `--trusted-host` | 无 | 增加可信 authority，可重复 |

等价环境变量包括 `DSH_OH_WEB_HOST`、`DSH_OH_WEB_PORT`、
`DSH_OH_WEB_HOME` 和 `DSH_OH_WEB_OPEN`。`OH_DSH_HOME` 可以统一覆盖
Desktop、Web 和 TUI 的数据根目录。按 `Ctrl+C` 优雅退出。

不要在未配置访问边界时直接监听 `0.0.0.0`。对局域网开放时，应同时配置
`--trusted-host`，并由可信反向代理提供鉴权和 TLS。

## 安装 TUI-only

```sh
tar -xzf oh-dsh-tui-*.tar.gz
cd oh-dsh-tui-*/
./bin/ohdsh tui
```

Windows 使用 `bin\ohdsh.cmd tui`。TUI 需要真实交互终端；默认使用 alternate
screen，全屏选择、滚动和复制由上游 `dsh-TUI` 处理。

## 统一启动命令

```sh
ohdsh desktop
ohdsh web
ohdsh tui
```

- `desktop` 启动已安装应用；源码仓库中回退到 Electron 开发入口。
- `web` 启动 HTTP 服务并打印访问地址。
- `tui` 初始化独立 Profile，并在当前终端中附着运行上游 renderer。

TUI 常用选项：

| 选项 | 默认值 | 说明 |
| --- | --- | --- |
| `--cwd` | 当前目录 | Workspace |
| `--data` | `~/.ohdsh` | 三端共享的 Oh-DSH 数据根目录 |
| `--resume` | 新会话 | 恢复指定 Session id |
| `--lang` | 上游设置 | `zh` 或 `en` |
| `--preset` | `standard` | 初始 Agent preset |
| `--inline` | 关闭 | 保留终端 scrollback，不使用 alternate screen |

## Desktop 操作

| 操作 | macOS 快捷键 |
| --- | --- |
| 切换左侧栏 | `⌘B` |
| 切换底部 Terminal | `⌘J` |
| 切换右侧栏 | `⌥⌘B` |
| 打开 Review | `⌃⇧G` |
| 打开 Browser | `⌘T` |
| 打开 Files | `⌘P` |
| 新建 Side chat | `⌥⌘S` |
| 退出侧栏专注模式 | `Esc` |

设置页支持中英文、模型、权限、Agent preset、插件配置和 Oh-DSH 皮肤。
设置弹窗会覆盖并虚化所有工作区和侧栏内容。

Web 与 Desktop 可在设置页选择皮肤。TUI 输入 `/theme` 可选择相同的 Deep
Current、Jade Circuit、Porcelain 和 Ember Dusk；选择立即生效并在重启后保留。

## 插件市场

推荐流程：

1. 在未安装分类中选择插件。
2. 检查来源、commit、权限和风险等级。
3. 创建 candidate 并在隔离 Profile 中预览。
4. 效果不合适时选择放弃，当前桌面不发生变化。
5. 确认后应用；需要时再单独启用。
6. 更新失败时恢复 previous。

Agent 可以通过对话发起同样的安装操作，但仍需要经过预览、风险确认和应用，
不会直接修改当前 Profile。

## 从源码启动与打包

```sh
git submodule update --init --recursive
pnpm install
pnpm run build:dsh
pnpm run build
pnpm run stage:dsh
export PATH="$PWD/bin:$PATH"

ohdsh desktop
ohdsh web --port 3080
ohdsh tui
```

打包命令：

```sh
pnpm run dist:mac       # macOS 完整版
pnpm run dist:linux     # Linux 完整版
pnpm run dist:win       # Windows 完整版
pnpm run dist:web       # Web-only 轻量版
pnpm run dist:tui       # TUI-only 终端版
```

发布带自动更新功能的 tag 还需要配置 GitHub Actions 的 macOS 签名/公证凭据和
Windows Authenticode 凭据。工作流会在任意一个凭据、安装包、blockmap 或
`latest*.yml` 缺失时停止发布。

## 数据与排错

Desktop、Web 和 TUI 默认共同使用 `~/.ohdsh`，且不会加载 `~/.dsh` 中的
全局插件配置。三端分别使用 `profiles/desktop`、`profiles/web` 和
`profiles/tui`，但共享会话、凭据、皮肤和插件缓存；Electron 自身的数据
位于 `~/.ohdsh/desktop`。可用 `OH_DSH_HOME` 全局覆盖，也可用 Web/TUI 的
`--data` 临时隔离。DeepSeek API key 可以在 Models 设置中配置，或写入
`~/.ohdsh/.env`。

首次使用共享目录时，Desktop 会从系统应用数据目录中的旧
`Oh-DSH-Desktop` 状态导入会话、凭据、插件与界面设置；Web 会导入旧
`~/.oh-dsh-web/dsh`、根级皮肤与侧栏偏好，以及当前数据目录下的 `dsh/`。
迁移只复制共享目录中缺失的数据，并保留旧目录用于回滚；已存在的新状态
不会被覆盖。

排查顺序：

1. 运行 `ohdsh --help` 确认 CLI 来源。
2. 运行 `ohdsh web --help` 检查参数。
3. 运行 `ohdsh tui --help`，再用 `ohdsh tui --inline` 排除终端全屏兼容问题。
4. 使用随机端口验证：`ohdsh web --port 0 --no-open`。
5. 检查 Profile 是否同时安装并启用了所需插件。
6. Desktop 启动失败时，从终端运行应用内 `bin/ohdsh desktop` 获取日志。

架构与上游关系见[设计与插件边界](./design.md)。
