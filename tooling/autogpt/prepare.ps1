param([switch]$Checkout)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$sources = Get-Content (Join-Path $projectRoot 'tooling/upstream-inspection.json') -Raw | ConvertFrom-Json
$source = $sources | Where-Object { $_.repo -eq 'Significant-Gravitas/AutoGPT' }
if (-not $Checkout) {
  Write-Output 'AutoGPT launch is deferred. To fetch pinned source only:'
  Write-Output 'powershell -File tooling/autogpt/prepare.ps1 -Checkout'
  Write-Output 'Then follow the upstream Windows self-hosting guide in the checked-out docs.'
  Write-Output 'Docker, an explicitly selected model/provider, credentials and spending limits are required.'
  exit 0
}
$destination = Join-Path $projectRoot 'tooling/runtime/AutoGPT'
if (Test-Path -LiteralPath $destination) { throw 'Destination exists; refusing to overwrite it.' }
New-Item -ItemType Directory -Path $destination | Out-Null
git -C $destination init
if ($LASTEXITCODE -ne 0) { throw 'Git init failed.' }
git -C $destination remote add origin 'https://github.com/Significant-Gravitas/AutoGPT.git'
git -C $destination fetch --depth 1 origin $source.sha
if ($LASTEXITCODE -ne 0) { throw 'Fetch failed.' }
git -C $destination checkout --detach FETCH_HEAD
if ($LASTEXITCODE -ne 0) { throw 'Checkout failed.' }
Write-Output "Pinned source fetched to $destination. No service started."
