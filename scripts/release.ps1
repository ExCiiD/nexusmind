# NexusMind release helper
# ------------------------
# Usage:
#   scripts\release.ps1            # full pipeline: build + publish prerelease
#   scripts\release.ps1 -PublishOnly  # skip rebuild, just upload existing artifacts
#   scripts\release.ps1 -NoPublish    # local build only, no GitHub upload
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
    [switch]$NoPublish
)

$ErrorActionPreference = 'Stop'

# ── Resolve repo root regardless of where the script is invoked from ──
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

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
$publishFlag = if ($NoPublish) { 'never' } else { 'always' }
Write-Host "[release] Running electron-builder --publish $publishFlag ..." -ForegroundColor Cyan
npx electron-builder --publish $publishFlag
if ($LASTEXITCODE -ne 0) { Write-Error "electron-builder failed"; exit $LASTEXITCODE }

Write-Host "[release] Done. Check the GitHub releases page." -ForegroundColor Green
