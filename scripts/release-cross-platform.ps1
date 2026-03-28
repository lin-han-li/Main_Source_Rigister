param(
    [string]$Version,
    [string]$TagPrefix = "v",
    [switch]$SkipNpmInstall,
    [switch]$SkipPush,
    [switch]$AllowDirty
)

$ErrorActionPreference = "Stop"

$dedicatedScript = Join-Path $PSScriptRoot "release-cross-platform-dedicated.ps1"
if (-not (Test-Path $dedicatedScript)) {
    throw "Dedicated release script not found: $dedicatedScript"
}

& $dedicatedScript @PSBoundParameters
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
