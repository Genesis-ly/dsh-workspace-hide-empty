param(
  [string]$Profile = 'desktop',
  [string]$DshHome = (Join-Path $env:USERPROFILE '.dsh'),
  [switch]$Purge,
  [switch]$WhatIf
)

# dsh-workspace-hide-empty uninstall:
#   removes the link: dependency, drops the bundle selection and the node_modules
#   entry. With -Purge the copied package under <DshHome>\plugins is deleted too.
$ErrorActionPreference = 'Stop'
$name = 'dsh-workspace-hide-empty'
$profileDir = Join-Path (Join-Path $DshHome 'profiles') $Profile
$profileJson = Join-Path $profileDir 'package.json'
$linkDir = Join-Path (Join-Path $profileDir 'node_modules') $name
$target = Join-Path (Join-Path $DshHome 'plugins') $name
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

if (-not (Test-Path $profileJson)) { throw "profile package.json not found: $profileJson" }

$utf8 = New-Object System.Text.UTF8Encoding($false)
$doc = Get-Content $profileJson -Raw -Encoding UTF8 | ConvertFrom-Json
$changed = $false

if ($null -ne $doc.dependencies -and $null -ne $doc.dependencies.$name) {
  if (-not $WhatIf) { Copy-Item $profileJson "$profileJson.bak-hideempty-rm-$stamp" -Force }
  $doc.dependencies.PSObject.Properties.Remove($name)
  $changed = $true
  Write-Host "dependency: removed $name"
}

$bundles = @($doc.dsh.profile.bundles) | Where-Object { $_ -ne $name }
if ($bundles.Count -ne @($doc.dsh.profile.bundles).Count) {
  $doc.dsh.profile.bundles = @($bundles)
  $changed = $true
  Write-Host "bundle: removed $name"
}

if ($changed -and -not $WhatIf) {
  [System.IO.File]::WriteAllText($profileJson, ($doc | ConvertTo-Json -Depth 100), $utf8)
  Write-Host "wrote $profileJson"
}

if (-not $WhatIf -and (Test-Path $linkDir)) {
  $item = Get-Item $linkDir -Force
  if ($item.LinkType -or $item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
    cmd /c rmdir "$linkDir"
  } else {
    Remove-Item $linkDir -Recurse -Force
  }
  Write-Host "removed node_modules entry: $linkDir"
}

if ($Purge -and (Test-Path $target)) {
  if (-not $WhatIf) { Remove-Item $target -Recurse -Force }
  Write-Host "purged package copy: $target"
}

Write-Host 'restart DeepSeek Harness to unmount the plugin.'
