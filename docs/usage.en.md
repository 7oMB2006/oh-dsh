<p align="center">
  <a href="./usage.md">简体中文</a> ·
  <strong>English</strong> ·
  <a href="../README.en.md">Back to README</a>
</p>

# Installation, operations, and troubleshooting

## Choose a distribution

- Install **Oh-DSH Desktop** for the complete local workbench.
- Install **Oh-DSH Web** for browser-only use without Electron.
- Install **Oh-DSH TUI** for terminal-only use without Electron or browser UI.

The full distribution includes all three surfaces, so one installation
supports `desktop`, `web`, and `tui`.

## Install the full distribution

### macOS

1. Download the DMG from the latest Release.
2. Drag **Oh-DSH Desktop** into Applications.
3. For an unnotarized test build, right-click the app in Finder and choose
   **Open** on first launch.

If a verified Release download remains quarantined, apply this to the actual
downloaded file:

```sh
xattr -d com.apple.quarantine ~/Downloads/Oh-DSH-Desktop-*.dmg
```

Install the unified command:

```sh
sudo ln -sf \
  "/Applications/Oh-DSH Desktop.app/Contents/Resources/bin/ohdsh" \
  /usr/local/bin/ohdsh
```

### Linux

AppImage:

```sh
chmod +x Oh-DSH-Desktop-*.AppImage
./Oh-DSH-Desktop-*.AppImage
```

deb:

```sh
sudo apt install ./Oh-DSH-Desktop-*.deb
```

### Windows

Run the Windows installer from the Release and start **Oh-DSH Desktop**. The unified CLI is
`bin\ohdsh.cmd` under the application resources directory; add that directory
to `PATH` if desired.

### Desktop online updates

Choose **Oh-DSH Desktop -> Check for Updates...** from the application menu.
The updater checks only stable GitHub Releases from
`hust-open-atom-club/oh-dsh`; it does not need a GitHub login or token.

- macOS, Windows, and Linux AppImage can restart and install after a verified
  download, or install on the next application quit.
- `.deb` downloads and opens the system package installer. It never runs
  `sudo`, `apt`, or `dpkg` around the system permission boundary.
- The updater uses the system proxy configuration. Offline, proxy-auth, 404,
  insufficient-space, verification, cancellation, and retry states are shown
  in the update window. A verification failure never replaces the current app.
- An update replaces only the application. DSH data, workspace settings,
  sessions, installed plugins, and marketplace receipts remain in the existing
  data directory.

Automatic updates require a signed packaged Desktop build. Versions installed
before the first updater-enabled Release need one manual install; local
development builds and Releases without a matching platform package fall back
to the official Release page.

## Install Web-only

```sh
tar -xzf oh-dsh-web-*.tar.gz
cd oh-dsh-web-*/
./bin/ohdsh web
```

Windows:

```bat
bin\ohdsh.cmd web
```

Common options:

| Option | Default | Description |
| --- | --- | --- |
| `--host` | `127.0.0.1` | Bind address |
| `--port` | `3080` | Listen port; `0` selects a random port |
| `--data` | `~/.oh-dsh-web` | Writable Web data root |
| `--no-open` | off | Do not open the browser automatically |
| `--trusted-host` | none | Add a trusted authority; repeatable |

Equivalent environment variables include `DSH_OH_WEB_HOST`,
`DSH_OH_WEB_PORT`, `DSH_OH_WEB_HOME`, and `DSH_OH_WEB_OPEN`. Press `Ctrl+C`
for a graceful shutdown.

Do not bind to `0.0.0.0` without an access boundary. For LAN exposure, add
`--trusted-host` and put authentication and TLS in a trusted reverse proxy.

## Install TUI-only

```sh
tar -xzf oh-dsh-tui-*.tar.gz
cd oh-dsh-tui-*/
./bin/ohdsh tui
```

Use `bin\ohdsh.cmd tui` on Windows. TUI requires a real interactive terminal.
It uses the alternate screen by default; upstream `dsh-TUI` owns fullscreen
selection, scrolling, and copy behavior.

## Unified commands

```sh
ohdsh desktop
ohdsh web
ohdsh tui
```

- `desktop` opens the installed app and falls back to the Electron development
  entry when run from a source checkout.
- `web` starts the HTTP service and prints its URL.
- `tui` initializes its Profile and attaches the upstream renderer to the
  current terminal.

Common TUI options:

| Option | Default | Description |
| --- | --- | --- |
| `--cwd` | Current directory | Workspace |
| `--data` | `~/.ohdsh` | Oh-DSH TUI Profile, session, and configuration root |
| `--resume` | New session | Resume a Session id |
| `--lang` | Upstream preference | `zh` or `en` |
| `--preset` | `standard` | Initial Agent preset |
| `--inline` | Off | Preserve terminal scrollback instead of alternate screen |

## Desktop operations

| Action | macOS shortcut |
| --- | --- |
| Toggle the left sidebar | `⌘B` |
| Toggle the bottom Terminal | `⌘J` |
| Toggle the right sidebar | `⌥⌘B` |
| Open Review | `⌃⇧G` |
| Open Browser | `⌘T` |
| Open Files | `⌘P` |
| Start a Side chat | `⌥⌘S` |
| Leave sidebar focus mode | `Esc` |

Settings covers language, models, permissions, Agent presets, plugin config,
and Oh-DSH skins. Its modal covers and blurs every workspace and sidebar.

Choose a skin from Settings on Web or Desktop. In TUI, run `/theme` to select
the same Deep Current, Jade Circuit, Porcelain, or Ember Dusk palette. The
choice applies immediately and survives restarts.

## Plugin marketplace

Recommended flow:

1. Choose a plugin from Not installed.
2. Inspect its source, commit, permissions, and risk level.
3. Prepare a candidate and preview it in an isolated Profile.
4. Discard it if the result is unsuitable; the current Desktop is unchanged.
5. Apply it explicitly, then enable it separately when needed.
6. Recover the previous state if an update fails.

An Agent can initiate the same operation through chat, but still passes
through preview, risk approval, and apply. It cannot directly mutate the
current Profile.

## Run and package from source

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

Packaging commands:

```sh
pnpm run dist:mac       # macOS full distribution
pnpm run dist:linux     # Linux full distribution
pnpm run dist:win       # Windows full distribution
pnpm run dist:web       # Web-only lightweight distribution
pnpm run dist:tui       # TUI-only terminal distribution
```

Publishing an auto-update tag also requires GitHub Actions secrets for macOS
signing/notarization and Windows Authenticode signing. The workflow refuses to
publish if credentials, an installer, a blockmap, or `latest*.yml` metadata is
missing.

## Data and troubleshooting

Desktop retains the existing internal data directory to preserve state across
the visible-name migration. Web stores data in `~/.oh-dsh-web` by default.
TUI uses its own `~/.ohdsh` root and does not load global plugin configuration
from `~/.dsh`. Configure the DeepSeek API key in Models settings or in `.env`
under the matching DSH data directory.

Troubleshooting order:

1. Run `ohdsh --help` to confirm the CLI source.
2. Run `ohdsh web --help` to inspect options.
3. Run `ohdsh tui --help`, then use `ohdsh tui --inline` to isolate
   alternate-screen terminal compatibility.
4. Test a random port with `ohdsh web --port 0 --no-open`.
5. Confirm that required plugins are both installed and enabled in the Profile.
6. If Desktop does not start, run its bundled `bin/ohdsh desktop` in a terminal
   to capture logs.

See [design and plugin boundaries](./design.en.md) for architecture and
upstream relationships.
