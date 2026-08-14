<p align="center">
  <a href="./usage.md">简体中文</a> ·
  <strong>English</strong> ·
  <a href="../README.en.md">Back to README</a>
</p>

# Installation, operations, and troubleshooting

## Choose a distribution

- Install **Oh-DSH Desktop** for the complete local workbench.
- Install **Oh-DSH Web** for browser-only use without Electron.
- Wait for TUI-only for terminal use; `ohdsh tui` currently reports that the
  surface is not implemented.

The full distribution includes Web, so one installation supports both
`desktop` and `web`.

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

Extract the Windows package and start **Oh-DSH Desktop**. The unified CLI is
`bin\ohdsh.cmd` under the application resources directory; add that directory
to `PATH` if desired.

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

## Unified commands

```sh
ohdsh desktop
ohdsh web
ohdsh tui
```

- `desktop` opens the installed app and falls back to the Electron development
  entry when run from a source checkout.
- `web` starts the HTTP service and prints its URL.
- `tui` reserves the stable command name and currently exits with an explicit
  unavailable message.

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
and Desktop skins. Its modal covers and blurs every workspace and sidebar.

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
```

Packaging commands:

```sh
pnpm run dist:mac       # macOS full distribution
pnpm run dist:linux     # Linux full distribution
pnpm run dist:win       # Windows full distribution
pnpm run dist:web       # Web-only lightweight distribution
```

## Data and troubleshooting

Desktop retains the existing internal data directory to preserve state across
the visible-name migration. Web stores data in `~/.oh-dsh-web` by default.
Configure the DeepSeek API key in Models settings or in `.env` under the
matching DSH data directory.

Troubleshooting order:

1. Run `ohdsh --help` to confirm the CLI source.
2. Run `ohdsh web --help` to inspect options.
3. Test a random port with `ohdsh web --port 0 --no-open`.
4. Confirm that required plugins are both installed and enabled in the Profile.
5. If Desktop does not start, run its bundled `bin/ohdsh desktop` in a terminal
   to capture logs.

See [design and plugin boundaries](./design.en.md) for architecture and
upstream relationships.
