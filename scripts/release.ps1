# NexusMind release helper
# ------------------------
# Usage:
#   scripts\release.ps1            # full pipeline: build + publish prerelease
#   scripts\release.ps1 -PublishOnly  # skip rebuild, just upload existing artifacts
#   scripts\release.ps1 -NoPublish    # local build only, no GitHub upload
#   scripts\release.ps1 -AllowDirty   # build even with uncommitted changes (asked otherwise)
#
# Before any build the script runs the project checks (typecheck, lint,
# i18n, unit tests) and refuses to go on if one fails. It also refuses a
# working folder with uncommitted changes unless you confirm: the installer
# is built from the folder, not from the commit, so another session's
# unfinished work would ship (REL-1 / REL-2 in docs/QUALITY_CRITERIA.md).
#
# Why this script exists:
# `npm run release` -> `electron-builder --publish always` needs a valid
# GitHub token in $env:GH_TOKEN. Classic PATs expire (30/60/90d) and we
# kept getting 401 Bad credentials right when we wanted to ship.
#
# The `gh` CLI stores a never-expiring OAuth token in the OS keyring, so
# we ask `gh auth token` for it every run. No more dead tokens in `.env`.

[CmdletBinding()]
param(
    [switch]$PublishOnly,
    [switch]$NoPublish,
    [switch]$AllowDirty
)

$ErrorActionPreference = 'Stop'

# ── Resolve repo root regardless of where the script is invoked from ──
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

# Fingerprint of what would be built: HEAD, the uncommitted diff, and the
# content of untracked files. Build outputs (out/, dist/, release/) are
# git-ignored, so building does not change it.
function Get-WorkingTreeFingerprint {
    $parts = New-Object System.Collections.Generic.List[string]
    $parts.Add((git rev-parse HEAD))
    $parts.Add(((git diff HEAD --binary) -join "`n"))
    foreach ($f in @(git ls-files --others --exclude-standard)) {
        $parts.Add("$f " + (git hash-object -- "$f"))
    }
    $bytes = [System.Text.Encoding]::UTF8.GetBytes(($parts -join "`n"))
    $sha = [System.Security.Cryptography.SHA256]::Create()
    return ([System.BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '')
}

# ── 0. Pre-flight: clean folder and passing checks (skipped with -PublishOnly,
#       which uploads artifacts that were already checked when built) ──────
if (-not $PublishOnly) {
    $dirty = @(git status --porcelain --untracked-files=normal)
    if ($LASTEXITCODE -ne 0) { Write-Error "git status failed: is this a git checkout?"; exit 1 }
    if ($dirty.Count -gt 0 -and -not $AllowDirty) {
        Write-Host "[release] Uncommitted changes in the working folder (they would be built into the installer):" -ForegroundColor Yellow
        $dirty | Select-Object -First 30 | ForEach-Object { Write-Host "    $_" }
        if ($dirty.Count -gt 30) { Write-Host ("    ... and {0} more" -f ($dirty.Count - 30)) }
        $interactive = [Environment]::UserInteractive -and -not [Console]::IsInputRedirected
        if (-not $interactive) {
            Write-Error "Working folder not clean. Commit or set the changes aside, or pass -AllowDirty."
            exit 1
        }
        $answer = Read-Host "[release] Build anyway? Type YES to continue"
        if ($answer -cne 'YES') { Write-Host "[release] Aborted." -ForegroundColor Yellow; exit 1 }
    }
    # Checked again just before electron-builder: another session editing
    # the folder during the checks or the build must not slip into the installer.
    $treeAtStart = Get-WorkingTreeFingerprint

    $checks = @(
        @{ Name = 'typecheck'; Args = @('run', 'typecheck') },
        @{ Name = 'lint';      Args = @('run', 'lint') },
        @{ Name = 'i18n';      Args = @('run', 'check:i18n') },
        @{ Name = 'unit tests'; Args = @('run', 'test') }
    )
    foreach ($check in $checks) {
        Write-Host ("[release] Check: {0}..." -f $check.Name) -ForegroundColor Cyan
        & npm @($check.Args)
        if ($LASTEXITCODE -ne 0) {
            Write-Error ("Check failed: {0}. Nothing was built." -f $check.Name)
            exit 1
        }
    }
    Write-Host "[release] All checks passed." -ForegroundColor Green

    # The bundled ffmpeg.exe ships in every installer: only the pinned binary (#13, S19-04).
    # Same check as `npm run dist` (predist): scripts/check-ffmpeg.mjs, one implementation.
    & node (Join-Path $repoRoot 'scripts\check-ffmpeg.mjs')
    if ($LASTEXITCODE -ne 0) { Write-Error "ffmpeg.exe check failed. Nothing was built."; exit 1 }
}

# ── 1. Get a working GitHub token (unless we're skipping publish) ─────
if (-not $NoPublish) {
    # Clear any stale token so `gh auth token` picks the keyring one.
    Remove-Item Env:GH_TOKEN -ErrorAction SilentlyContinue
    Remove-Item Env:GITHUB_TOKEN -ErrorAction SilentlyContinue

    $token = (gh auth token 2>$null).Trim()
    if (-not $token) {
        Write-Error "gh CLI is not authenticated. Run: gh auth login"
        exit 1
    }
    if ($token -notmatch '^(gh[opus]_|github_pat_)') {
        Write-Error "gh auth token returned something unexpected ('$($token.Substring(0,4))...'). Aborting."
        exit 1
    }
    $env:GH_TOKEN = $token
    Write-Host ("[release] Using gh token ({0}***{1})" -f $token.Substring(0,4), $token.Substring($token.Length-4)) -ForegroundColor Cyan
}

# ── 2. Build (unless caller said skip) ────────────────────────────────
if (-not $PublishOnly) {
    Write-Host "[release] Building electron-vite bundles..." -ForegroundColor Cyan
    npm run build
    if ($LASTEXITCODE -ne 0) { Write-Error "Build failed"; exit $LASTEXITCODE }
}

# ── 3. Run electron-builder ───────────────────────────────────────────
if (-not $PublishOnly) {
    if ((Get-WorkingTreeFingerprint) -ne $treeAtStart) {
        Write-Host "[release] The working folder changed since the checks:" -ForegroundColor Yellow
        git status --short | Select-Object -First 30 | ForEach-Object { Write-Host "    $_" }
        Write-Error "Working folder changed during the checks or the build. Nothing was packaged: run the release again."
        exit 1
    }
}
$publishFlag = if ($NoPublish) { 'never' } else { 'always' }
Write-Host "[release] Running electron-builder --publish $publishFlag ..." -ForegroundColor Cyan
npx electron-builder --publish $publishFlag
if ($LASTEXITCODE -ne 0) { Write-Error "electron-builder failed"; exit $LASTEXITCODE }

Write-Host "[release] Done. Check the GitHub releases page." -ForegroundColor Green
