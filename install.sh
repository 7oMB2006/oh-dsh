#!/bin/sh
# Oh-DSH latest-release installer.
#
# Installs a published Oh-DSH release from GitHub without cloning the
# repository: resolves the latest stable release (or a pinned --version),
# downloads the artifact for the detected OS/architecture, verifies the
# published SHA-256 digest, and swaps the previous installation only after
# the new one is fully staged. Supported surfaces: desktop, web, tui.
#
# Usage:
#   curl -fsSL \
#     https://raw.githubusercontent.com/hust-open-atom-club/oh-dsh/main/install.sh \
#     | bash -s -- --surface tui
#   sh install.sh --surface web --version v0.1.8
#   sh install.sh --uninstall --surface desktop
#
# Unix/macOS only; Windows uses install.ps1 from the same repository.
# On Windows under Git Bash, run install.ps1 from PowerShell instead.

set -eu

REPO_DEFAULT='hust-open-atom-club/oh-dsh'
API_BASE_DEFAULT='https://api.github.com'
DOWNLOAD_BASE_DEFAULT='https://github.com'
APP_NAME='Oh-DSH Desktop'
LEGACY_APP_NAME='Oh-DSH-Desktop.app'
BUNDLE_ID='ai.deepseek.oh-dsh-desktop'
LSREGISTER_DEFAULT='/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister'

usage() {
  cat <<'EOF'
install.sh — install Oh-DSH from the latest GitHub Release

Usage:
  sh install.sh [options]

Options:
  -s, --surface NAME    Surface to install: desktop (default), web, or tui.
                        Each surface installs only its own files and launcher.
  -v, --version TAG     Release tag to install (for example v0.1.8).
                        Default: the latest stable Release. Prereleases are
                        never selected implicitly; pin --version to install one.
  -d, --dest DIR        Install destination.
                        desktop on macOS: directory receiving the .app
                          (default /Applications).
                        desktop on Linux: directory receiving the AppImage
                          (default ~/.local/bin).
                        web/tui: payload directory
                          (default ~/.local/share/oh-dsh/<surface>).
      --bin-dir DIR     Directory receiving the `ohdsh` launcher symlink for
                        web/tui (default ~/.local/bin).
      --repo SLUG       GitHub owner/repo (default hust-open-atom-club/oh-dsh).
      --uninstall       Remove the installed surface instead of installing.
      --force           Reinstall even when the same version is installed.
      --os NAME         Override OS detection: darwin or linux (advanced).
      --arch NAME       Override architecture detection: arm64 or x64
                        (advanced).
  -h, --help            Show this help.

Environment:
  OH_DSH_SURFACE, OH_DSH_VERSION, OH_DSH_INSTALL_DIR, OH_DSH_BIN_DIR,
  OH_DSH_REPO       Same meaning as the matching options; options win.
  OH_DSH_OS, OH_DSH_ARCH   Same meaning as --os/--arch.
  OH_DSH_API_BASE, OH_DSH_DOWNLOAD_BASE
                   Override the GitHub API and download base URLs.
  GH_TOKEN, GITHUB_TOKEN
                   Optional token for authenticated GitHub API requests.

Uninstall:
  sh install.sh --uninstall [--surface NAME] [--dest DIR] [--bin-dir DIR]

Files:
  web/tui installs a payload plus an `ohdsh` symlink in --bin-dir; desktop on
  macOS installs "Oh-DSH Desktop.app" and refreshes Launch Services; desktop
  on Linux installs an executable named oh-dsh-desktop.
EOF
}

die() {
  printf 'install.sh: %s\n' "$1" >&2
  exit 1
}

log() {
  printf '==> %s\n' "$1"
}

# ---------------------------------------------------------------------------
# Options
# ---------------------------------------------------------------------------

surface=${OH_DSH_SURFACE:-desktop}
version_arg=${OH_DSH_VERSION:-}
dest_arg=${OH_DSH_INSTALL_DIR:-}
bin_dir_arg=${OH_DSH_BIN_DIR:-}
repo=${OH_DSH_REPO:-$REPO_DEFAULT}
os_arg=${OH_DSH_OS:-}
arch_arg=${OH_DSH_ARCH:-}
force=0
uninstall=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    -s|--surface)
      [ "$#" -ge 2 ] || die "$1 requires a value"
      surface=$2
      shift 2
      ;;
    -v|--version)
      [ "$#" -ge 2 ] || die "$1 requires a value"
      version_arg=$2
      shift 2
      ;;
    -d|--dest)
      [ "$#" -ge 2 ] || die "$1 requires a value"
      dest_arg=$2
      shift 2
      ;;
    --bin-dir)
      [ "$#" -ge 2 ] || die "$1 requires a value"
      bin_dir_arg=$2
      shift 2
      ;;
    --repo)
      [ "$#" -ge 2 ] || die "$1 requires a value"
      repo=$2
      shift 2
      ;;
    --force)
      force=1
      shift
      ;;
    --uninstall)
      uninstall=1
      shift
      ;;
    --os)
      [ "$#" -ge 2 ] || die "$1 requires a value"
      os_arg=$2
      shift 2
      ;;
    --arch)
      [ "$#" -ge 2 ] || die "$1 requires a value"
      arch_arg=$2
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "unknown option: $1 (see --help)"
      ;;
  esac
done

case "$surface" in
  desktop|web|tui) ;;
  *) die "unsupported surface '$surface' (expected desktop, web, or tui)" ;;
esac

[ -n "${HOME:-}" ] || die 'HOME is not set; cannot determine default locations'
command -v curl >/dev/null 2>&1 || die 'curl is required (https://curl.se)'

api_base=${OH_DSH_API_BASE:-$API_BASE_DEFAULT}
download_base=${OH_DSH_DOWNLOAD_BASE:-$DOWNLOAD_BASE_DEFAULT}
data_home=${XDG_DATA_HOME:-$HOME/.local/share}/oh-dsh

# ---------------------------------------------------------------------------
# Platform detection
# ---------------------------------------------------------------------------

kernel=$(uname -s)
case "$kernel" in
  Darwin) detected_os=darwin ;;
  Linux) detected_os=linux ;;
  MINGW*|MSYS*|CYGWIN*)
    die "install.sh does not support Windows shells ($kernel). Run install.ps1 from PowerShell: irm https://raw.githubusercontent.com/$repo/main/install.ps1 | iex"
    ;;
  *)
    die "unsupported operating system '$kernel' (supported: macOS, Linux)"
    ;;
esac

machine=$(uname -m)
case "$machine" in
  arm64|aarch64) detected_arch=arm64 ;;
  x86_64|amd64) detected_arch=x64 ;;
  *)
    die "unsupported architecture '$machine' (published targets: darwin arm64/x64, linux x64, windows x64)"
    ;;
esac

os=${os_arg:-$detected_os}
arch=${arch_arg:-$detected_arch}

case "$os" in
  darwin|linux) ;;
  win|win32|windows)
    die "install.sh does not install Windows releases; run install.ps1 from PowerShell: irm https://raw.githubusercontent.com/$repo/main/install.ps1 | iex"
    ;;
  *) die "unsupported --os '$os' (expected darwin or linux)" ;;
esac
case "$arch" in
  arm64|x64) ;;
  *) die "unsupported --arch '$arch' (expected arm64 or x64)" ;;
esac

if [ "$os" = linux ] && [ "$arch" = arm64 ]; then
  die "no linux-arm64 Release assets are published yet; see https://github.com/$repo/releases for available targets"
fi

# ---------------------------------------------------------------------------
# Destinations
# ---------------------------------------------------------------------------

bin_dir=${bin_dir_arg:-$HOME/.local/bin}
case "$bin_dir" in
  */) bin_dir=${bin_dir%/} ;;
esac

case "$surface" in
  web|tui)
    dest=${dest_arg:-$data_home/$surface}
    ;;
  desktop)
    if [ "$os" = darwin ]; then
      dest=${dest_arg:-/Applications}
    else
      dest=${dest_arg:-$bin_dir}
    fi
    ;;
esac
case "$dest" in
  */) dest=${dest%/} ;;
esac

marker_dir=$data_home/desktop
desktop_marker=$marker_dir/install.env

workdir=''
cleanup() {
  if [ -n "$workdir" ] && [ -d "$workdir" ]; then
    rm -rf "$workdir"
  fi
}
trap cleanup EXIT INT TERM

make_workdir() {
  workdir=$(mktemp -d "${TMPDIR:-/tmp}/oh-dsh-install.XXXXXXXXXX")
}

timestamp() {
  date +%Y%m%d-%H%M%S
}

sha256_file() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | cut -d' ' -f1
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    die 'neither shasum nor sha256sum is available to verify downloads'
  fi
}

gh_curl() {
  auth=''
  if [ -n "${GH_TOKEN:-}" ] || [ -n "${GITHUB_TOKEN:-}" ]; then
    auth="Authorization: Bearer ${GH_TOKEN:-$GITHUB_TOKEN}"
  fi
  if [ -n "$auth" ]; then
    curl -fsSL --retry 3 --retry-delay 2 \
      -H "$auth" \
      -H 'Accept: application/vnd.github+json' \
      -H 'User-Agent: oh-dsh-install' \
      "$@"
  else
    curl -fsSL --retry 3 --retry-delay 2 \
      -H 'Accept: application/vnd.github+json' \
      -H 'User-Agent: oh-dsh-install' \
      "$@"
  fi
}

json_tag() {
  printf '%s\n' "$1" | tr ',' '\n' | sed -n 's/^"tag_name":"\([^"]*\)"$/\1/p' | head -n 1
}

json_asset_digest() {
  # GitHub asset objects contain a nested "uploader" object, so splitting on
  # '{' would break "name" and "digest" onto different lines. Asset objects
  # are separated by '},{', and nothing inside an asset (the flat uploader
  # object included) matches that sequence, so it isolates one asset per
  # line regardless of field order.
  printf '%s\n' "$1" | awk '{ gsub(/\},\{/, "\n"); print }' \
    | grep -F "\"name\":\"$2\"" \
    | grep -o '"digest":"sha256:[0-9a-f]*"' \
    | head -n 1 \
    | sed 's/^"digest":"sha256://; s/"$//'
}

write_marker() {
  printf 'OH_DSH_INSTALL_SURFACE=%s\n' "$surface" \
    > "$1"
  printf 'OH_DSH_INSTALL_TAG=%s\n' "$tag" >> "$1"
  printf 'OH_DSH_INSTALL_VERSION=%s\n' "$version" >> "$1"
  printf 'OH_DSH_INSTALL_ASSET=%s\n' "$asset" >> "$1"
  printf 'OH_DSH_INSTALL_OS=%s\n' "$os" >> "$1"
  printf 'OH_DSH_INSTALL_ARCH=%s\n' "$arch" >> "$1"
}

same_version_installed() {
  # $1: marker path
  [ -f "$1" ] || return 1
  # shellcheck disable=SC1090
  . "$1"
  if [ "${OH_DSH_INSTALL_SURFACE:-}" = "$surface" ] \
    && [ "${OH_DSH_INSTALL_VERSION:-}" = "$version" ] \
    && [ "${OH_DSH_INSTALL_ASSET:-}" = "$asset" ]; then
    result=0
  else
    result=1
  fi
  unset OH_DSH_INSTALL_SURFACE OH_DSH_INSTALL_TAG OH_DSH_INSTALL_VERSION \
    OH_DSH_INSTALL_ASSET OH_DSH_INSTALL_OS OH_DSH_INSTALL_ARCH
  return $result
}

# ---------------------------------------------------------------------------
# Uninstall
# ---------------------------------------------------------------------------

remove_desktop_mac() {
  app="$dest/$APP_NAME.app"
  removed=0
  if [ -d "$app" ]; then
    rm -rf "$app"
    log "Removed $app"
    removed=1
  fi
  legacy="$dest/$LEGACY_APP_NAME"
  if [ -d "$legacy" ]; then
    rm -rf "$legacy"
    log "Removed legacy $legacy"
    removed=1
  fi
  lsregister_bin=${OH_DSH_LSREGISTER:-$LSREGISTER_DEFAULT}
  if [ "$removed" = 1 ] && [ -x "$lsregister_bin" ]; then
    "$lsregister_bin" -u "$app" >/dev/null 2>&1 || true
  fi
  if [ -f "$desktop_marker" ]; then
    rm -f "$desktop_marker"
    log "Removed $desktop_marker"
  fi
  [ "$removed" = 1 ] || log "No Oh-DSH Desktop app found under $dest; nothing to remove"
}

remove_desktop_linux() {
  image="$dest/oh-dsh-desktop"
  if [ -f "$image" ]; then
    rm -f "$image"
    log "Removed $image"
  else
    log "No oh-dsh-desktop AppImage found under $dest; nothing to remove"
  fi
  if [ -f "$desktop_marker" ]; then
    rm -f "$desktop_marker"
    log "Removed $desktop_marker"
  fi
}

remove_surface_payload() {
  removed=0
  if [ -d "$dest" ]; then
    rm -rf "$dest"
    log "Removed $dest"
    removed=1
  fi
  link="$bin_dir/ohdsh"
  if [ -L "$link" ]; then
    target=$(readlink "$link")
    case "$target" in
      "$dest"|"$dest"/*)
        rm -f "$link"
        log "Removed launcher $link"
        removed=1
        ;;
    esac
  fi
  [ "$removed" = 1 ] || log "No $surface installation found at $dest; nothing to remove"
}

if [ "$uninstall" = 1 ]; then
  case "$surface" in
    desktop)
      if [ "$os" = darwin ]; then
        remove_desktop_mac
      else
        remove_desktop_linux
      fi
      ;;
    web|tui)
      remove_surface_payload
      ;;
  esac
  exit 0
fi

# ---------------------------------------------------------------------------
# Release selection
# ---------------------------------------------------------------------------

make_workdir

if [ -n "$version_arg" ]; then
  case "$version_arg" in
    v*) tag=$version_arg ;;
    *) tag="v$version_arg" ;;
  esac
  release_path="/repos/$repo/releases/tags/$tag"
else
  release_path="/repos/$repo/releases/latest"
fi

log "Resolving $([ -n "$version_arg" ] && printf 'release %s' "$tag" || printf 'latest stable release') from $repo"
release_json=$(gh_curl "$api_base$release_path") \
  || die "failed to fetch release information from $api_base$release_path"
[ -n "$release_json" ] || die "empty release response from $api_base$release_path"

if [ -z "${tag:-}" ]; then
  tag=$(json_tag "$release_json")
  [ -n "$tag" ] || die 'could not read tag_name from the release response'
fi
case "$tag" in
  v*) version=${tag#v} ;;
  *) version=$tag ;;
esac

case "$surface:$os" in
  desktop:darwin)
    asset="Oh-DSH-Desktop-$version-$arch.zip"
    ;;
  desktop:linux)
    asset="Oh-DSH-Desktop-$version-x86_64.AppImage"
    ;;
  web:*) asset="oh-dsh-web-$version-$os-$arch.tar.gz" ;;
  tui:*) asset="oh-dsh-tui-$version-$os-$arch.tar.gz" ;;
esac

digest=$(json_asset_digest "$release_json" "$asset")
[ -n "$digest" ] \
  || die "release $tag publishes no sha256 digest for $asset; verify the asset list at https://github.com/$repo/releases/tag/$tag"

# ---------------------------------------------------------------------------
# Idempotency
# ---------------------------------------------------------------------------

case "$surface" in
  web|tui) current_marker=$dest/.oh-dsh-install.env ;;
  desktop) current_marker=$desktop_marker ;;
esac

if [ "$force" != 1 ] && same_version_installed "$current_marker"; then
  log "$surface $version ($asset) is already installed; pass --force to reinstall"
  exit 0
fi

# ---------------------------------------------------------------------------
# Download and verify
# ---------------------------------------------------------------------------

archive="$workdir/$asset"
url="$download_base/$repo/releases/download/$tag/$asset"
log "Downloading $asset"
gh_curl -o "$archive" "$url" \
  || die "failed to download $url"

actual=$(sha256_file "$archive")
if [ "$actual" != "$digest" ]; then
  die "checksum mismatch for $asset: expected sha256:$digest, got sha256:$actual; the previous installation was left untouched"
fi
log "Verified sha256:$digest"

# ---------------------------------------------------------------------------
# Install: web and tui
# ---------------------------------------------------------------------------

install_payload_surface() {
  extract_dir="$workdir/extract"
  mkdir -p "$extract_dir"
  tar -xzf "$archive" -C "$extract_dir" \
    || die "failed to extract $asset; the previous installation was left untouched"

  set -- "$extract_dir"/*
  if [ "$#" -ne 1 ] || [ ! -d "$1" ]; then
    die "unexpected archive layout in $asset (expected one $surface payload directory); the previous installation was left untouched"
  fi
  payload=$1
  if [ ! -x "$payload/bin/ohdsh" ] || [ ! -d "$payload/lib" ]; then
    die "$asset does not contain a runnable $surface payload; the previous installation was left untouched"
  fi

  parent=$(dirname -- "$dest")
  mkdir -p "$parent"
  staged="$dest.install-pending.$$"
  rm -rf "$staged"
  if ! mv -- "$payload" "$staged"; then
    rm -rf "$staged"
    die "failed to stage the new $surface payload; the previous installation was left untouched"
  fi
  write_marker "$staged/.oh-dsh-install.env"

  previous="$dest.previous-$(timestamp)"
  had_previous=0
  if [ -e "$dest" ]; then
    mv -- "$dest" "$previous"
    had_previous=1
  fi
  if ! mv -- "$staged" "$dest"; then
    if [ "$had_previous" = 1 ]; then
      mv -- "$previous" "$dest"
    fi
    die "failed to move the staged $surface payload into place; the previous installation was left untouched"
  fi
  rm -rf "$previous"
  # Purge staged leftovers from interrupted upgrades.
  rm -rf "$dest.previous-"* "$dest.install-pending."*

  mkdir -p "$bin_dir"
  ln -sfn "$dest/bin/ohdsh" "$bin_dir/ohdsh"

  log "Installed Oh-DSH $surface $version to $dest"
  log "Launcher: $bin_dir/ohdsh"
  case ":${PATH:-}:" in
    *":$bin_dir:"*) ;;
    *)
      printf '    note: %s is not in PATH; add it with\n      export PATH="%s:$PATH"\n' "$bin_dir" "$bin_dir"
      ;;
  esac
  printf '    start with: %s %s\n' "$bin_dir/ohdsh" "$surface"
}

# ---------------------------------------------------------------------------
# Install: desktop on Linux (AppImage)
# ---------------------------------------------------------------------------

install_desktop_linux() {
  mkdir -p "$dest"
  if [ ! -w "$dest" ]; then
    die "$dest is not writable; pass --dest DIR or rerun with sufficient privileges"
  fi
  staged="$dest/.oh-dsh-desktop.pending.$$"
  rm -f "$staged"
  if ! mv -- "$archive" "$staged"; then
    rm -f "$staged"
    die "failed to stage the new AppImage; the previous installation was left untouched"
  fi
  chmod 0755 "$staged"

  image="$dest/oh-dsh-desktop"
  previous="$dest/.oh-dsh-desktop.previous-$(timestamp)"
  had_previous=0
  if [ -f "$image" ]; then
    mv -- "$image" "$previous"
    had_previous=1
  fi
  if ! mv -- "$staged" "$image"; then
    if [ "$had_previous" = 1 ]; then
      mv -- "$previous" "$image"
    fi
    die "failed to move the staged AppImage into place; the previous installation was left untouched"
  fi
  rm -f "$previous"
  # Purge staged leftovers from interrupted upgrades.
  rm -f "$dest/.oh-dsh-desktop.previous-"* "$dest/.oh-dsh-desktop.pending."*

  mkdir -p "$marker_dir"
  write_marker "$desktop_marker"

  log "Installed Oh-DSH Desktop $version to $image"
  case ":${PATH:-}:" in
    *":$dest:"*) ;;
    *)
      printf '    note: %s is not in PATH; add it with\n      export PATH="%s:$PATH"\n' "$dest" "$dest"
      ;;
  esac
  printf '    start with: %s\n' "$image"
}

# ---------------------------------------------------------------------------
# Install: desktop on macOS (.app under /Applications)
# ---------------------------------------------------------------------------

quit_running_app() {
  osascript -e "tell application id \"$BUNDLE_ID\" to quit" >/dev/null 2>&1 || true
  if ! command -v pgrep >/dev/null 2>&1; then
    return 0
  fi
  attempt=0
  while [ "$attempt" -lt 50 ]; do
    if ! pgrep -f "$app_dest/" >/dev/null 2>&1; then
      return 0
    fi
    attempt=$((attempt + 1))
    sleep 0.1
  done
  die 'Oh-DSH Desktop did not quit cleanly; close it and rerun the installer'
}

install_desktop_mac() {
  extract_dir="$workdir/extract"
  mkdir -p "$extract_dir"
  if command -v ditto >/dev/null 2>&1; then
    ditto -x -k "$archive" "$extract_dir" \
      || die "failed to extract $asset; the previous installation was left untouched"
  elif command -v unzip >/dev/null 2>&1; then
    unzip -qq "$archive" -d "$extract_dir" \
      || die "failed to extract $asset; the previous installation was left untouched"
  else
    tar -xf "$archive" -C "$extract_dir" \
      || die "failed to extract $asset (no ditto, unzip, or zip-capable tar); the previous installation was left untouched"
  fi

  set -- "$extract_dir"/*.app
  if [ "$#" -ne 1 ] || [ ! -d "$1" ]; then
    die "unexpected archive layout in $asset (expected one .app bundle); the previous installation was left untouched"
  fi
  app_source=$1
  executables=$(find "$app_source/Contents/MacOS" -type f -perm -u+x 2>/dev/null | head -n 1 || true)
  [ -n "$executables" ] \
    || die "$asset does not contain a runnable application bundle; the previous installation was left untouched"

  mkdir -p "$dest"
  if [ ! -w "$dest" ]; then
    die "$dest is not writable; pass --dest DIR (for example ~/Applications) or rerun with sufficient privileges"
  fi

  app_dest="$dest/$APP_NAME.app"
  # Only the default /Applications destination is treated as owned by the
  # installer; custom destinations never touch the running session.
  if [ "$kernel" = Darwin ] \
    && [ "$app_dest" = "/Applications/$APP_NAME.app" ] \
    && [ -d "$app_dest" ]; then
    quit_running_app
  fi

  backup_dir=$dest
  reserve_backup() {
    # $1: base name without .app; the backup lives beside the app only until
    # the new bundle is validated, then it is deleted (no Trash buildup).
    stem="$1-before-$(timestamp)"
    index=0
    while :; do
      if [ "$index" = 0 ]; then
        candidate="$backup_dir/$stem.app"
      else
        candidate="$backup_dir/$stem-$index.app"
      fi
      if [ ! -e "$candidate" ]; then
        printf '%s' "$candidate"
        return 0
      fi
      index=$((index + 1))
    done
  }

  staged="$dest/.$APP_NAME.app.install.$$"
  rm -rf "$staged"
  if command -v ditto >/dev/null 2>&1; then
    copy_ok=0
    ditto "$app_source" "$staged" && copy_ok=1
  else
    copy_ok=0
    cp -R "$app_source" "$staged" && copy_ok=1
  fi
  if [ "$copy_ok" != 1 ]; then
    rm -rf "$staged"
    die "failed to stage the new app bundle; the previous installation was left untouched"
  fi

  backup=''
  had_previous=0
  if [ -e "$app_dest" ]; then
    backup=$(reserve_backup "$APP_NAME")
    mv -- "$app_dest" "$backup"
    had_previous=1
  fi
  if ! mv -- "$staged" "$app_dest"; then
    if [ "$had_previous" = 1 ]; then
      mv -- "$backup" "$app_dest"
    fi
    die "failed to move the staged app bundle into place; the previous installation was left untouched"
  fi

  if [ -d "$dest/$LEGACY_APP_NAME" ]; then
    rm -rf "$dest/$LEGACY_APP_NAME"
    log "Removed legacy $dest/$LEGACY_APP_NAME"
  fi

  # Purge stale bundles from earlier installs so Launch Services and Finder
  # show exactly one Oh-DSH Desktop.
  for stale in "$dest/$APP_NAME-before-"*.app "$dest/Oh-DSH-Desktop-before-"*.app; do
    if [ -e "$stale" ]; then
      rm -rf "$stale"
    fi
  done
  rm -rf "$dest/.$APP_NAME.app.install."*

  lsregister_bin=${OH_DSH_LSREGISTER:-$LSREGISTER_DEFAULT}
  if [ -x "$lsregister_bin" ]; then
    "$lsregister_bin" -f "$app_dest" >/dev/null 2>&1 \
      || printf 'install.sh: warning: Launch Services refresh failed; the app is installed but may need one Finder open to register\n' >&2
  fi

  mkdir -p "$marker_dir"
  write_marker "$desktop_marker"

  log "Installed $app_dest"
  if [ "$had_previous" = 1 ]; then
    rm -rf "$backup"
    log "Removed the previous app bundle"
  fi
}

case "$surface:$os" in
  web:*|tui:*) install_payload_surface ;;
  desktop:linux) install_desktop_linux ;;
  desktop:darwin) install_desktop_mac ;;
  *) die "no install path for surface '$surface' on '$os'" ;;
esac

log "Done"
