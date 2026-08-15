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

未签名安装器可能触发 Windows SmartScreen。确认文件来自项目 Release 后，选择
“更多信息”再选择“仍要运行”；安装过程可能请求管理员授权。

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

## 图片识别

Desktop、Web 和 TUI 都会加载内置的 `@oh-dsh/vision`。纯文本模型遇到图片路径、
URL 或粘贴图片引用时会调用 `view_image`，由配置的 OpenAI-compatible 视觉模型
完成 OCR、图表读取、物体计数、截图排错与界面布局分析，再把文本结果交回当前模型。

在 Desktop 或 Web UI 中，先复制一张 PNG、JPEG、WebP 或 GIF，再把焦点放到消息
输入框并按 `⌘V`（macOS）或 `Ctrl+V`（Windows/Linux）。输入栏上方会立即出现一
个带图片缩略图的气泡；点击右上角 `×` 可在发送前移除。上传期间会显示进度标记，
失败时气泡会变为错误状态并阻止该引用被发送。

粘贴图片保存到 DSH 自带的 attachment store，并在消息中序列化为只对当前 Session
有效的不透明 `view_image` 引用。这条桥接保持消息本身为文本输入，所以默认的
DeepSeek 文本模型不需要声明原生 image-input 能力。TUI 没有图形化缩略图，直接在
消息中提供 Workspace 内的图片路径或 HTTP(S) URL 即可使用同一个工具。

默认后端使用智谱 `glm-4.6v-flash`。把密钥写入共享数据根目录的凭据文件（默认
`~/.ohdsh/.credentials.yaml`），三端即可共同使用：

```yaml
VISION_API_KEY: your-api-key
```

凭据文件应保持仅当前用户可读，例如在 macOS/Linux 上执行
`chmod 600 ~/.ohdsh/.credentials.yaml`。也可以在启动前 `export VISION_API_KEY=...`。

后端和模型可在共享的 `~/.ohdsh/settings.yaml` 中覆盖：

```yaml
oh-dsh-vision:
  baseURL: https://dashscope.aliyuncs.com/compatible-mode/v1
  model: qwen3-vl-flash
  apiKeyEnv: DASHSCOPE_API_KEY
  maxTokens: 2048
  timeoutMs: 60000
  maxImageBytes: 10485760
```

使用本地 Ollama 时不要求密钥：

```yaml
oh-dsh-vision:
  baseURL: http://localhost:11434/v1
  model: qwen3-vl:4b
```

本地图片路径只能位于当前 Session 的 Workspace 内，解析软链接后仍会检查边界；
远程 URL、本地图片内容或粘贴图片内容只会在调用 `view_image` 时发送给所配置的
视觉端点。粘贴引用不能跨 Session 使用。浏览器附件按钮和拖放仍属于 DSH 原生图片
输入，受当前模型声明的 image-input 能力限制；面向纯文本模型时请使用上述粘贴气泡、
Workspace 图片路径或 HTTP(S) URL。

## Desktop 操作

### 对话输入历史

焦点位于主对话输入框时，在第一行开头按 `ArrowUp` 可取回上一条已提交消息；在
最后一行末尾按 `ArrowDown` 可向后浏览，并最终恢复开始浏览前的草稿。多行输入中，
未处于这两个边界的方向键仍保持原有的光标移动行为。

历史按当前会话隔离，只包含已确认的用户文本消息，仅在本次应用运行期间保存在内存
中。输入框最多保留最近 100 条记录；在容量允许时，浏览到最早记录会按需加载更早的
会话消息。

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

发布工作流在 GitHub Actions 的 macOS 签名/公证凭据和 Windows Authenticode
凭据齐全时生成正式签名包。缺少任一组凭据时，工作流会明确警告并降级生成 macOS
ad-hoc 签名包或 Windows 未签名安装器，而不会阻止 Web、TUI 和 Desktop 打包。
降级产物仅支持上文所述的手动安装，不能视为支持自动更新。启用正式签名需要配置
`MACOS_CSC_LINK`、`MACOS_CSC_KEY_PASSWORD`、`APPLE_ID`、
`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`、`WINDOWS_CSC_LINK` 和
`WINDOWS_CSC_KEY_PASSWORD`。安装包、内嵌或外置 blockmap、`latest*.yml` 元数据
仍会被严格校验，缺失时停止发布。可从 Actions 手动运行 Release workflow 做四平台
打包检查；手动运行只上传 workflow artifacts，不创建 GitHub Release。

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
