param(
  [string]$Profile = 'desktop',
  [string]$DshHome = (Join-Path $env:USERPROFILE '.dsh'),
  [switch]$SkipPnpm,
  [switch]$WhatIf
)

# dsh-workspace-hide-empty install:
#   1. copy this plugin package to <DshHome>\plugins\<name> (ASCII path, survives
#      workspace moves and keeps the profile link spec stable);
#   2. record a link: dependency in the profile manifest;
#   3. select the bundle in dsh.profile.bundles (that is what mounts its Loader row);
#   4. materialise the node_modules entry (pnpm when the Host is stopped,
#      otherwise a directory junction, which is what pnpm would create anyway).
#
# The browser half is loaded when the Host boots, so the behaviour applies after
# one restart. Rollback: scripts/uninstall.ps1.
$ErrorActionPreference = 'Stop'
$name = 'dsh-workspace-hide-empty'
$src = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$profileDir = Join-Path (Join-Path $DshHome 'profiles') $Profile
$profileJson = Join-Path $profileDir 'package.json'
$pluginsDir = Join-Path $DshHome 'plugins'
$target = Join-Path $pluginsDir $name
$linkDir = Join-Path (Join-Path $profileDir 'node_modules') $name
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

Write-Host "source : $src"
Write-Host "target : $target"
Write-Host "profile: $profileDir"

if (-not (Test-Path $profileJson)) { throw "profile package.json not found: $profileJson" }
if (-not (Test-Path (Join-Path $src 'cordis.patch.yml'))) { throw "not a plugin package: $src" }

$running = Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue
if ($null -ne $running) {
  Write-Host 'DeepSeek Harness is running: files are installed now, the bundle loads on next start.'
} else {
  Write-Host 'DeepSeek Harness is not running.'
}

# 1. copy the package to <DshHome>\plugins\<name>
if (-not $WhatIf) {
  if (Test-Path $target) {
    $backup = "$target.bak-$stamp"
    Move-Item $target $backup -Force
    Write-Host "previous copy moved to: $backup"
  }
  New-Item -ItemType Directory -Force -Path $target | Out-Null
  Copy-Item (Join-Path $src 'lib') $target -Recurse -Force
  Copy-Item (Join-Path $src 'scripts') $target -Recurse -Force
  Copy-Item (Join-Path $src 'test') $target -Recurse -Force -ErrorAction SilentlyContinue
  Copy-Item (Join-Path $src 'cordis.patch.yml') $target -Force
  Copy-Item (Join-Path $src 'package.json') $target -Force
  Copy-Item (Join-Path $src 'README.md') $target -Force -ErrorAction SilentlyContinue
  Write-Host "copied package -> $target"
} else {
  Write-Host "WhatIf: would copy package -> $target"
}

# 2 + 3. profile manifest: link: dependency + bundle selection
$utf8 = New-Object System.Text.UTF8Encoding($false)
$doc = Get-Content $profileJson -Raw -Encoding UTF8 | ConvertFrom-Json

$spec = "link:$($target -replace '\\', '/')"
$deps = $doc.dependencies
$current = $null
if ($null -ne $deps) { $current = $deps.$name }
$changed = $false
if ($current -ne $spec) {
  if (-not $WhatIf) { Copy-Item $profileJson "$profileJson.bak-hideempty-$stamp" -Force }
  if ($null -eq $deps) { $doc | Add-Member -NotePropertyName dependencies -NotePropertyValue ([pscustomobject]@{}) }
  $doc.dependencies | Add-Member -NotePropertyName $name -NotePropertyValue $spec -Force
  $changed = $true
  Write-Host "dependency: $name -> $spec"
} else {
  Write-Host "dependency: already $name -> $spec"
}

$bundles = @($doc.dsh.profile.bundles)
if ($bundles -notcontains $name) {
  $doc.dsh.profile.bundles = @($bundles + $name)
  $changed = $true
  Write-Host "bundle: added $name to dsh.profile.bundles"
} else {
  Write-Host "bundle: dsh.profile.bundles already contains $name"
}

if ($changed -and $WhatIf) {
  Write-Host 'WhatIf: profile manifest left unchanged.'
} elseif ($changed) {
  $json = $doc | ConvertTo-Json -Depth 100
  [System.IO.File]::WriteAllText($profileJson, $json, $utf8)
  Write-Host "wrote $profileJson (backup: package.json.bak-hideempty-$stamp)"
}

# 4. node_modules entry: prefer pnpm while the Host is stopped, otherwise a junction.
$hasPnpm = (-not $SkipPnpm) -and ($null -eq $running)
if (-not $WhatIf -and $hasPnpm) {
  $pnpm = Join-Path $env:USERPROFILE '.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.cjs'
  $node = Join-Path $env:USERPROFILE '.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
  if ((Test-Path $pnpm) -and (Test-Path $node)) {
    Write-Host 'running pnpm install in the profile...'
    Push-Location $profileDir
    try { & $node $pnpm install --prefer-offline } finally { Pop-Location }
  } else {
    Write-Host 'pnpm runtime not found; falling back to a junction.'
    $hasPnpm = $false
  }
}

if (-not $WhatIf -and -not $hasPnpm) {
  if (Test-Path $linkDir) {
    $item = Get-Item $linkDir -Force
    if ($item.LinkType -or $item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
      cmd /c rmdir "$linkDir"
    } else {
      Move-Item $linkDir "$linkDir.bak-$stamp" -Force
    }
  }
  New-Item -ItemType Directory -Force -Path (Split-Path $linkDir -Parent) | Out-Null
  cmd /c mklink /J "$linkDir" "$target" | Out-Null
  Write-Host "junction: $linkDir -> $target"
}

Write-Host ''
Write-Host 'next:'
Write-Host '  1. restart DeepSeek Harness (the browser half loads at page start);'
Write-Host '  2. in the app console run: __dshWorkspaceHideEmpty.health()'
Write-Host '  3. archive the last visible session of a non-default workspace -> its row disappears;'
Write-Host '     unarchive any session -> the row returns; default workspace stays visible.'
