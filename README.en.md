<p align="center">
  <a href="./README.md">简体中文</a> ·
  <strong>English</strong>
</p>

<div align="center">
  <img src="./assets/dsh-whale.png" width="136" alt="Oh-DSH whale">
  <h1>Oh-DSH</h1>
  <p><strong>One DSH runtime, independently installable interaction surfaces.</strong></p>
</div>

<p align="center">
  <img alt="macOS" src="https://img.shields.io/badge/macOS-12%2B-111111?logo=apple&logoColor=white">
  <img alt="Linux" src="https://img.shields.io/badge/Linux-x64-FCC624?logo=linux&logoColor=black">
  <img alt="Windows" src="https://img.shields.io/badge/Windows-x64-0078D6?logo=windows&logoColor=white">
  <img alt="MIT" src="https://img.shields.io/badge/license-MIT-34a853">
</p>

<p align="center">
  <img src="./assets/oh-dsh-desktop-overview.png" alt="Oh-DSH Desktop" width="100%">
</p>

Oh-DSH packages DeepSeek Harness, Node.js, and local capabilities as
installable Desktop and Web distributions. Models still run in the cloud;
Oh-DSH owns workspaces, terminals, Git review, browser and window integration,
and the plugin lifecycle.

## Download and install

Choose a distribution from the
[latest GitHub Release](https://github.com/hust-open-atom-club/oh-dsh/releases/latest):

| Distribution | Includes | Best for |
| --- | --- | --- |
| Full | **Oh-DSH Desktop**, Web, Node runtime, and bundled plugins | Local development workbench |
| Web-only | **Oh-DSH Web**, Node runtime, and bundled Web plugins; no Electron | Small installs, browser, or remote access |
| TUI-only | Planned | Terminal-only environments |

The full distribution is available as DMG/ZIP, AppImage/deb, and a Windows
package. On macOS, open the DMG and drag **Oh-DSH Desktop** into Applications.
On Linux, run the AppImage or install the deb with `apt`.

Extract and start the Web-only package directly:

```sh
tar -xzf oh-dsh-web-*.tar.gz
cd oh-dsh-web-*/
./bin/ohdsh web
```

The default URL is <http://127.0.0.1:3080>. On Windows, run:

```bat
bin\ohdsh.cmd web
```

### Install the unified command

The macOS full distribution contains a CLI that can be added to `PATH`:

```sh
sudo ln -sf \
  "/Applications/Oh-DSH Desktop.app/Contents/Resources/bin/ohdsh" \
  /usr/local/bin/ohdsh
```

Use `./bin/ohdsh` from a Web-only package, or add it to `PATH`.

## Start a surface

```sh
ohdsh desktop   # Start Oh-DSH Desktop
ohdsh web       # Start Oh-DSH Web
ohdsh tui       # Planned; currently reports that TUI is unavailable
```

Run `ohdsh web --help` for host, port, data directory, and trusted-host
options.

## Run from source

Node.js, pnpm, and the platform build tools are required:

```sh
git submodule update --init --recursive
pnpm install
pnpm run build:dsh
pnpm run build
pnpm run stage:dsh
export PATH="$PWD/bin:$PATH"

ohdsh desktop
ohdsh web
```

Build the full distribution with the platform-specific `dist:mac`,
`dist:linux`, or `dist:win` script. Build only the Web surface with
`pnpm run dist:web`.

<details>
<summary><strong>More interfaces</strong></summary>

### Plugin marketplace

![Oh-DSH plugin marketplace](./assets/oh-dsh-plugin-marketplace.png)

### Desktop skins

![Oh-DSH desktop skins](./assets/oh-dsh-desktop-skins.png)

</details>

## Documentation

- [Design and plugin boundaries](./docs/design.en.md)
- [Installation, operations, and troubleshooting](./docs/usage.en.md)

Some bundled plugins are Oh-DSH downstream adaptations of upstream projects.
Features are synchronized periodically while this project owns the UI,
themes, runtime boundaries, and packaging. The design guide records every
source and adaptation boundary.

## License

[MIT](./LICENSE)
