param([switch]$Checkout)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$sources = Get-Content (Join-Path $PSScriptRoot 'upstream-inspection.json') -Raw | ConvertFrom-Json
$source = $sources | Where-Object { $_.repo -eq 'Comfy-Org/ComfyUI' }
if (-not $Checkout) {
  Write-Output 'ComfyUI launch is deferred. To fetch pinned source only:'
  Write-Output 'powershell -File tooling/comfy-prepare.ps1 -Checkout'
  Write-Output 'Use a dedicated Python environment and follow upstream GPU installation instructions.'
  Write-Output 'Start with: python main.py --listen 127.0.0.1 --port 8188 --offline --lowvram'
  Write-Output 'Install a licensed local checkpoint and set its filename in the AyahX API workflow.'
  exit 0
}
$destination = Join-Path $PSScriptRoot 'runtime/ComfyUI'
if (Test-Path -LiteralPath $destination) { throw 'Destination exists; refusing to overwrite it.' }
New-Item -ItemType Directory -Path $destination | Out-Null
git -C $destination init
if ($LASTEXITCODE -ne 0) { throw 'Git init failed.' }
git -C $destination remote add origin 'https://github.com/Comfy-Org/ComfyUI.git'
git -C $destination fetch --depth 1 origin $source.sha
if ($LASTEXITCODE -ne 0) { throw 'Fetch failed.' }
git -C $destination checkout --detach FETCH_HEAD
if ($LASTEXITCODE -ne 0) { throw 'Checkout failed.' }
Write-Output "Pinned source fetched to $destination. No environment, models or service installed."
