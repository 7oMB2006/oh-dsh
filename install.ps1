<#
Oh-DSH latest-release installer for Windows.

Installs a published Oh-DSH release from GitHub without cloning the
repository: resolves the latest stable release (or a pinned -Version),
downloads the artifact for the platform, verifies the published SHA-256
digest, and swaps the previous installation only after the new one is
staged. Supported surfaces: desktop, web, tui.

Usage:
  irm https://raw.githubusercontent.com/hust-open-atom-club/oh-dsh/main/install.ps1 | iex
  .\install.ps1 -Surface tui
  .\install.ps1 -Surface web -Version v0.1.8
  .\install.ps1 -Uninstall -Surface tui

Requires PowerShell 5.1+ and tar (bundled with Windows 10 1803+) for the
web/tui payloads.
#>

[CmdletBinding()]
param(
    [ValidateSet('desktop', 'web', 'tui')]
    [string]$Surface = 'desktop',
    [string]$Version = '',
    [string]$Dest = '',
    [string]$BinDir = '',
    [string]$Repo = 'hust-open-atom-club/oh-dsh',
    [string]$Arch = '',
    [switch]$Force,
    [switch]$Uninstall,
    [string]$ApiBase = 'https://api.github.com',
    [string]$DownloadBase = 'https://github.com'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$AppName = 'Oh-DSH Desktop'
$ExecutableName = 'oh-dsh-desktop'
$DataHome = Join-Path $env:LOCALAPPDATA 'oh-dsh'

function Write-Step {
    param([string]$Message)
    Write-Host "==> $Message"
}

function Die {
    param([string]$Message)
    Write-Error "install.ps1: $Message"
    exit 1
}

function Get-Arch {
    if ($Arch -ne '') {
        if ($Arch -notin @('x64', 'arm64')) {
            Die "unsupported -Arch '$Arch' (expected x64 or arm64)"
        }
        return $Arch
    }
    if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { return 'arm64' }
    return 'x64'
}

$DetectedArch = Get-Arch
if ($DetectedArch -eq 'arm64') {
    Die "no windows-arm64 Release assets are published yet; see https://github.com/$Repo/releases for available targets"
}

function Get-PayloadDest {
    if ($Surface -eq 'desktop') {
        if ($Dest -ne '') { return $Dest }
        return ''
    }
    if ($Dest -ne '') { return $Dest }
    return (Join-Path $DataHome $Surface)
}

function Get-BinDir {
    if ($BinDir -ne '') { return $BinDir }
    return (Join-Path $DataHome 'bin')
}

function Read-Marker {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    $values = @{}
    foreach ($line in Get-Content -LiteralPath $Path) {
        $pair = $line -split '=', 2
        if ($pair.Count -eq 2) { $values[$pair[0]] = $pair[1] }
    }
    return $values
}

function Write-Marker {
    param([string]$Path)
    $dir = Split-Path -Parent $Path
    if (-not (Test-Path -LiteralPath $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
    $lines = @(
        "OH_DSH_INSTALL_SURFACE=$Surface",
        "OH_DSH_INSTALL_TAG=$script:Tag",
        "OH_DSH_INSTALL_VERSION=$script:ReleaseVersion",
        "OH_DSH_INSTALL_ASSET=$script:AssetName",
        "OH_DSH_INSTALL_OS=win",
        "OH_DSH_INSTALL_ARCH=$DetectedArch"
    )
    Set-Content -LiteralPath $Path -Value $lines -Encoding ASCII
}

function Remove-SurfaceInstall {
    if ($Surface -eq 'desktop') {
        $candidates = @(
            (Join-Path $env:LOCALAPPDATA 'Programs' 'Oh-DSH Desktop'),
            (Join-Path $env:LOCALAPPDATA 'Programs' 'oh-dsh-desktop')
        )
        $removed = $false
        foreach ($installDir in $candidates) {
            if (-not (Test-Path -LiteralPath $installDir)) { continue }
            $uninstaller = Join-Path $installDir 'Uninstall Oh-DSH Desktop.exe'
            if (Test-Path -LiteralPath $uninstaller) {
                Write-Step "Running the desktop uninstaller"
                $process = Start-Process -FilePath $uninstaller -ArgumentList '/S' -Wait -PassThru
                if ($process.ExitCode -notin @(0, $null)) {
                    Die "the desktop uninstaller exited with $($process.ExitCode)"
                }
            } else {
                Remove-Item -LiteralPath $installDir -Recurse -Force
            }
            Write-Step "Removed $installDir"
            $removed = $true
        }
        $marker = Join-Path $DataHome 'desktop\install.env'
        if (Test-Path -LiteralPath $marker) {
            Remove-Item -LiteralPath $marker -Force
            Write-Step "Removed $marker"
        }
        if (-not $removed) { Write-Step 'No Oh-DSH Desktop installation found; nothing to remove' }
        return
    }

    $payload = Get-PayloadDest
    $binDir = Get-BinDir
    $shim = Join-Path $binDir 'ohdsh.cmd'
    $removed = $false
    if ($payload -ne '' -and (Test-Path -LiteralPath $payload)) {
        Remove-Item -LiteralPath $payload -Recurse -Force
        Write-Step "Removed $payload"
        $removed = $true
    }
    if (Test-Path -LiteralPath $shim) {
        $content = Get-Content -LiteralPath $shim -Raw
        if ($content -like "*$payload*") {
            Remove-Item -LiteralPath $shim -Force
            Write-Step "Removed launcher $shim"
            $removed = $true
        }
    }
    if (-not $removed) { Write-Step "No $Surface installation found; nothing to remove" }
}

if ($Uninstall) {
    Remove-SurfaceInstall
    exit 0
}

# ---------------------------------------------------------------------------
# Release selection
# ---------------------------------------------------------------------------

$Headers = @{
    'Accept' = 'application/vnd.github+json'
    'User-Agent' = 'oh-dsh-install'
}
$Token = $env:GH_TOKEN
if ([string]::IsNullOrEmpty($Token)) { $Token = $env:GITHUB_TOKEN }
if (-not [string]::IsNullOrEmpty($Token)) {
    $Headers['Authorization'] = "Bearer $Token"
}

if ($Version -ne '') {
    $Tag = if ($Version.StartsWith('v')) { $Version } else { "v$Version" }
    $ReleasePath = "/repos/$Repo/releases/tags/$Tag"
} else {
    $Tag = ''
    $ReleasePath = "/repos/$Repo/releases/latest"
}

Write-Step "Resolving $(if ($Version -ne '') { "release $Tag" } else { 'latest stable release' }) from $Repo"
try {
    $Release = Invoke-RestMethod -Method Get -Uri "$ApiBase$ReleasePath" -Headers $Headers
} catch {
    Die "failed to fetch release information from $ApiBase$ReleasePath : $($_.Exception.Message)"
}

if ($Tag -eq '') { $Tag = [string]$Release.tag_name }
if ([string]::IsNullOrEmpty($Tag)) { Die 'could not read tag_name from the release response' }
$ReleaseVersion = $Tag.TrimStart('v')

switch ($Surface) {
    'desktop' { $AssetName = "Oh-DSH-Desktop-$ReleaseVersion-x64.exe" }
    'web' { $AssetName = "oh-dsh-web-$ReleaseVersion-win-x64.tar.gz" }
    'tui' { $AssetName = "oh-dsh-tui-$ReleaseVersion-win-x64.tar.gz" }
}

$Asset = @($Release.assets) | Where-Object { $_.name -eq $AssetName } | Select-Object -First 1
if ($null -eq $Asset) {
    Die "release $Tag has no asset $AssetName; see https://github.com/$Repo/releases/tag/$Tag"
}
$Digest = [string]$Asset.digest
if (-not $Digest.StartsWith('sha256:')) {
    Die "release $Tag publishes no sha256 digest for $AssetName; verify the asset list at https://github.com/$Repo/releases/tag/$Tag"
}
$ExpectedHash = $Digest.Substring(7).ToLowerInvariant()

# ---------------------------------------------------------------------------
# Idempotency
# ---------------------------------------------------------------------------

if ($Surface -eq 'desktop') {
    $MarkerPath = Join-Path $DataHome 'desktop\install.env'
} else {
    $MarkerPath = Join-Path (Get-PayloadDest) '.oh-dsh-install.env'
}
if (-not $Force) {
    $Marker = Read-Marker -Path $MarkerPath
    if ($null -ne $Marker `
        -and $Marker['OH_DSH_INSTALL_SURFACE'] -eq $Surface `
        -and $Marker['OH_DSH_INSTALL_VERSION'] -eq $ReleaseVersion `
        -and $Marker['OH_DSH_INSTALL_ASSET'] -eq $AssetName) {
        Write-Step "$Surface $ReleaseVersion ($AssetName) is already installed; pass -Force to reinstall"
        exit 0
    }
}

# ---------------------------------------------------------------------------
# Download and verify
# ---------------------------------------------------------------------------

$WorkDir = New-Item -ItemType Directory -Path (Join-Path $env:TEMP ("oh-dsh-install-{0}" -f ([guid]::NewGuid().ToString('N')))) -Force
try {
    $Archive = Join-Path $WorkDir $AssetName
    $Url = "$DownloadBase/$Repo/releases/download/$Tag/$AssetName"
    Write-Step "Downloading $AssetName"
    try {
        Invoke-WebRequest -Uri $Url -OutFile $Archive -Headers $Headers -UseBasicParsing
    } catch {
        Die "failed to download $Url : $($_.Exception.Message)"
    }

    $ActualHash = (Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($ActualHash -ne $ExpectedHash) {
        Die "checksum mismatch for $AssetName : expected sha256:$ExpectedHash, got sha256:$ActualHash; the previous installation was left untouched"
    }
    Write-Step "Verified sha256:$ExpectedHash"

    # -----------------------------------------------------------------------
    # Install
    # -----------------------------------------------------------------------

    if ($Surface -eq 'desktop') {
        Write-Step "Running the Oh-DSH Desktop installer silently"
        $process = Start-Process -FilePath $Archive -ArgumentList '/S' -Wait -PassThru
        if ($process.ExitCode -notin @(0, $null)) {
            Die "the desktop installer exited with $($process.ExitCode); the previous installation was left untouched"
        }
        Write-Marker -Path $MarkerPath
        Write-Step "Installed Oh-DSH Desktop $ReleaseVersion"
        exit 0
    }

    if (-not (Get-Command tar -ErrorAction SilentlyContinue)) {
        Die 'tar is required to extract the payload (bundled with Windows 10 1803+)'
    }

    $ExtractDir = Join-Path $WorkDir 'extract'
    New-Item -ItemType Directory -Path $ExtractDir -Force | Out-Null
    & tar -xzf $Archive -C $ExtractDir
    if ($LASTEXITCODE -ne 0) {
        Die "failed to extract $AssetName; the previous installation was left untouched"
    }

    $entries = Get-ChildItem -LiteralPath $ExtractDir
    if ($entries.Count -ne 1 -or -not $entries[0].PSIsContainer) {
        Die "unexpected archive layout in $AssetName (expected one $Surface payload directory); the previous installation was left untouched"
    }
    $Payload = $entries[0].FullName
    $Launcher = Join-Path $Payload 'bin\ohdsh.cmd'
    if (-not (Test-Path -LiteralPath $Launcher) -or -not (Test-Path -LiteralPath (Join-Path $Payload 'lib'))) {
        Die "$AssetName does not contain a runnable $Surface payload; the previous installation was left untouched"
    }

    $FinalDest = Get-PayloadDest
    $Parent = Split-Path -Parent $FinalDest
    if (-not (Test-Path -LiteralPath $Parent)) {
        New-Item -ItemType Directory -Path $Parent -Force | Out-Null
    }
    $Staged = "$FinalDest.install-pending"
    if (Test-Path -LiteralPath $Staged) { Remove-Item -LiteralPath $Staged -Recurse -Force }
    Move-Item -LiteralPath $Payload -Destination $Staged
    Write-Marker -Path (Join-Path $Staged '.oh-dsh-install.env')

    $HadPrevious = $false
    if (Test-Path -LiteralPath $FinalDest) {
        Move-Item -LiteralPath $FinalDest -Destination "$FinalDest.previous"
        $HadPrevious = $true
    }
    try {
        Move-Item -LiteralPath $Staged -Destination $FinalDest
    } catch {
        if ($HadPrevious) {
            Move-Item -LiteralPath "$FinalDest.previous" -Destination $FinalDest
        }
        Die "failed to move the staged $Surface payload into place; the previous installation was left untouched"
    }
    if ($HadPrevious) {
        Remove-Item -LiteralPath "$FinalDest.previous" -Recurse -Force
    }
    # Purge staged leftovers from interrupted upgrades.
    foreach ($stale in @("$FinalDest.previous", "$FinalDest.install-pending")) {
        if (Test-Path -LiteralPath $stale) {
            Remove-Item -LiteralPath $stale -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    $FinalBinDir = Get-BinDir
    if (-not (Test-Path -LiteralPath $FinalBinDir)) {
        New-Item -ItemType Directory -Path $FinalBinDir -Force | Out-Null
    }
    $ShimPath = Join-Path $FinalBinDir 'ohdsh.cmd'
    $Shim = "@echo off`r`nSETLOCAL`r`nCALL `"$FinalDest\bin\ohdsh.cmd`" %*"
    Set-Content -LiteralPath $ShimPath -Value $Shim -Encoding ASCII
    Write-Step "Installed Oh-DSH $Surface $ReleaseVersion to $FinalDest"
    Write-Step "Launcher: $ShimPath"

    # Only the installer-owned default bin directory manages the user PATH;
    # an explicit -BinDir is the caller's to maintain.
    if ($BinDir -eq '') {
        $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
        if ($null -eq $userPath) { $userPath = '' }
        $pathEntries = @($userPath -split ';' | Where-Object { $_ -ne '' })
        if ($pathEntries -notcontains $FinalBinDir) {
            [Environment]::SetEnvironmentVariable('Path', ($userPath.TrimEnd(';') + ';' + $FinalBinDir), 'User')
            Write-Step "Added $FinalBinDir to the user PATH (new terminals only)"
        }
    }
} finally {
    Remove-Item -LiteralPath $WorkDir -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Step 'Done'
