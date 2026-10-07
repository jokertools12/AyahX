$ErrorActionPreference = 'Stop'
$release = Get-Content (Join-Path $PSScriptRoot 'terrain-release.json') -Raw | ConvertFrom-Json
$runtime = Join-Path $PSScriptRoot 'runtime'
New-Item -ItemType Directory -Force -Path $runtime | Out-Null
$archive = Join-Path $runtime 'terrain.zip'
Invoke-WebRequest -Uri $release.url -OutFile $archive
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $release.sha256) { throw 'Terrain checksum mismatch.' }
$destination = Join-Path $runtime 'terrain-release'
if (-not (Test-Path -LiteralPath (Join-Path $destination 'terrain.exe'))) {
  Expand-Archive -LiteralPath $archive -DestinationPath $destination
}
$sources = Get-Content (Join-Path $PSScriptRoot 'upstream-inspection.json') -Raw | ConvertFrom-Json
$source = $sources | Where-Object { $_.repo -eq 'sopaco/terrain' }
$tree = Invoke-RestMethod -Uri "https://api.github.com/repos/sopaco/terrain/git/trees/$($source.sha)?recursive=1"
foreach ($item in $tree.tree | Where-Object { $_.type -eq 'blob' -and $_.path -like 'env-catalog/*' }) {
  $target = Join-Path $runtime $item.path
  New-Item -ItemType Directory -Force -Path (Split-Path $target -Parent) | Out-Null
  Invoke-WebRequest -Uri "https://raw.githubusercontent.com/sopaco/terrain/$($source.sha)/$($item.path)" -OutFile $target
}
Write-Output 'Terrain binary and environment catalog prepared; no env apply or LLM call made.'
