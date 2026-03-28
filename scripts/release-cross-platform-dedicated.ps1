param(
    [string]$Version,
    [string]$TagPrefix = "v",
    [string]$RemoteName = "origin",
    [string]$ExpectedRepoUrl = "https://github.com/lin-han-li/Main_Source_Rigister.git",
    [switch]$SkipNpmInstall,
    [switch]$SkipPush,
    [switch]$AllowDirty,
    [switch]$AllowNestedRepo
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$rootDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $rootDir

function Invoke-External {
    param(
        [Parameter(Mandatory = $true)][string]$Command,
        [Parameter(Mandatory = $false)][string[]]$Args = @()
    )

    & $Command @Args
    if ($LASTEXITCODE -ne 0) {
        $joined = if ($Args.Count -gt 0) { "$Command $($Args -join ' ')" } else { $Command }
        throw "Command failed: $joined"
    }
}

function Get-PackageVersion {
    $packageJson = Get-Content -Raw -Path (Join-Path $rootDir "package.json") | ConvertFrom-Json
    return [string]$packageJson.version
}

function Normalize-RepoUrl {
    param([string]$Url)

    $normalized = if ($null -eq $Url) { "" } else { [string]$Url }
    $normalized = $normalized.Trim().ToLowerInvariant()
    if ($normalized.EndsWith(".git")) {
        $normalized = $normalized.Substring(0, $normalized.Length - 4)
    }
    return $normalized.TrimEnd("/")
}

function Assert-RepositoryContext {
    if ($AllowNestedRepo) {
        return
    }

    $gitRootRaw = (git rev-parse --show-toplevel).Trim()
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to resolve git root."
    }

    $gitRoot = (Resolve-Path $gitRootRaw).Path
    if ($gitRoot -ne $rootDir) {
        throw "This script is for a dedicated repository. Current git root is '$gitRoot', script root is '$rootDir'. Use -AllowNestedRepo only during migration."
    }
}

function Assert-RemoteMatchesDedicatedRepo {
    $remoteUrl = (git remote get-url $RemoteName).Trim()
    if ($LASTEXITCODE -ne 0 -or -not $remoteUrl) {
        throw "Remote '$RemoteName' not found."
    }

    $actual = Normalize-RepoUrl $remoteUrl
    $expected = Normalize-RepoUrl $ExpectedRepoUrl
    if ($actual -ne $expected) {
        throw "Remote '$RemoteName' points to '$remoteUrl', expected '$ExpectedRepoUrl'."
    }
}

function Assert-WorkflowExists {
    $workflowPath = Join-Path $rootDir ".github\workflows\build-desktop.yml"
    if (-not (Test-Path $workflowPath)) {
        throw "Workflow not found: $workflowPath"
    }
}

function Get-CurrentBranch {
    $branch = (git rev-parse --abbrev-ref HEAD).Trim()
    if (-not $branch -or $branch -eq "HEAD") {
        throw "Detached HEAD detected. Check out a branch before running this script."
    }

    return $branch
}

function Assert-CleanWorktree {
    $status = git status --short
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to read git status."
    }

    if ($status) {
        throw "Working tree is not clean. Commit or stash changes before tagging a release."
    }
}

function Assert-TagDoesNotExist {
    param([string]$TagName)

    git rev-parse -q --verify "refs/tags/$TagName" *> $null
    if ($LASTEXITCODE -eq 0) {
        throw "Tag '$TagName' already exists locally."
    }

    $remoteTag = git ls-remote --tags $RemoteName "refs/tags/$TagName"
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to query tags from remote '$RemoteName'."
    }
    if ($remoteTag) {
        throw "Tag '$TagName' already exists on remote '$RemoteName'."
    }
}

Write-Host "[release] Checking repository context..."
Assert-RepositoryContext
Assert-RemoteMatchesDedicatedRepo
Assert-WorkflowExists

if (-not $AllowDirty) {
    Write-Host "[release] Checking working tree..."
    Assert-CleanWorktree
}

if (-not $SkipNpmInstall) {
    Write-Host "[release] Installing Node dependencies..."
    if (Test-Path (Join-Path $rootDir "package-lock.json")) {
        Invoke-External -Command "npm" -Args @("ci")
    }
    else {
        Invoke-External -Command "npm" -Args @("install")
    }
}

$packageVersion = Get-PackageVersion
if ($Version -and $Version -ne $packageVersion) {
    throw "Requested version '$Version' does not match package.json version '$packageVersion'. Update package.json first."
}

$releaseVersion = if ($Version) { $Version } else { $packageVersion }
$tagName = "$TagPrefix$releaseVersion"
$branchName = Get-CurrentBranch

Write-Host "[release] Preparing tag '$tagName' on branch '$branchName'..."
Assert-TagDoesNotExist -TagName $tagName

Write-Host "[release] Running verify pipeline..."
Invoke-External -Command "npm" -Args @("run", "verify:desktop")

Write-Host "[release] Building Windows installer..."
Invoke-External -Command "npm" -Args @("run", "dist:win", "--", "--skip-verify")

if (-not $SkipPush) {
    Write-Host "[release] Pushing branch '$branchName'..."
    Invoke-External -Command "git" -Args @("push", $RemoteName, $branchName)
}

Write-Host "[release] Creating tag '$tagName'..."
Invoke-External -Command "git" -Args @("tag", $tagName)

if (-not $SkipPush) {
    Write-Host "[release] Pushing tag '$tagName'..."
    Invoke-External -Command "git" -Args @("push", $RemoteName, $tagName)

    Write-Host ""
    Write-Host "Release trigger completed."
    Write-Host "GitHub Actions will build Windows/Linux/macOS artifacts on native runners and publish them to Release."
}
else {
    Write-Host ""
    Write-Host "Created local tag '$tagName'."
    Write-Host "Push manually to trigger GitHub Actions:"
    Write-Host "  git push $RemoteName $branchName"
    Write-Host "  git push $RemoteName $tagName"
}
