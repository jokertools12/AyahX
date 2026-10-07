param(
  [string]$PythonPath = 'C:\Users\cpazi\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe',
  [string]$InstallerPath = 'C:\Users\cpazi\.codex\skills\.system\skill-installer\scripts\install-skill-from-github.py'
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $PythonPath) -or -not (Test-Path -LiteralPath $InstallerPath)) { throw 'Set PythonPath and InstallerPath to your local Python and Codex skill-installer helper.' }
$root = Split-Path $PSScriptRoot -Parent
$destination = Join-Path $root '.agents/skills'
$sources = Get-Content (Join-Path $PSScriptRoot 'upstream-inspection.json') -Raw | ConvertFrom-Json
foreach ($source in $sources) {
  $paths = @()
  switch ($source.repo) {
    'addyosmani/agent-skills' { $paths = @($source.paths | Where-Object { $_ -like 'skills/*/SKILL.md' } | ForEach-Object { $_ -replace '/SKILL.md$','' }) }
    'addyosmani/web-quality-skills' { $paths = @($source.paths | Where-Object { $_ -like 'skills/*/SKILL.md' } | ForEach-Object { $_ -replace '/SKILL.md$','' }) }
    'obra/superpowers' { $paths = @('skills/brainstorming','skills/systematic-debugging','skills/verification-before-completion','skills/writing-plans','skills/receiving-code-review','skills/requesting-code-review') }
    'nextlevelbuilder/ui-ux-pro-max-skill' { $paths = @('.claude/skills/ui-ux-pro-max') }
    'sopaco/terrain' { $paths = @('env-catalog/skills/terrain-knowledge-skill') }
    'vercel/ai' { $paths = @('skills/use-ai-sdk') }
  }
  $missing = @($paths | Where-Object { -not (Test-Path -LiteralPath (Join-Path $destination (Split-Path $_ -Leaf))) })
  if ($missing.Count -gt 0) {
    & $PythonPath $InstallerPath --repo $source.repo --ref $source.sha --dest $destination --path @missing
    if ($LASTEXITCODE -ne 0) { throw "Installation failed: $($source.repo)" }
  }
}
# Preserve shared references used by ../../references links in Addy's skills.
$addy = $sources | Where-Object { $_.repo -eq 'addyosmani/agent-skills' }
$tree = Invoke-RestMethod -Uri "https://api.github.com/repos/addyosmani/agent-skills/git/trees/$($addy.sha)?recursive=1"
foreach ($item in $tree.tree | Where-Object { $_.type -eq 'blob' -and $_.path -like 'references/*' }) {
  $target = Join-Path (Join-Path $root '.agents') $item.path
  if (-not (Test-Path -LiteralPath $target)) {
    New-Item -ItemType Directory -Force -Path (Split-Path $target -Parent) | Out-Null
    Invoke-WebRequest -Uri "https://raw.githubusercontent.com/addyosmani/agent-skills/$($addy.sha)/$($item.path)" -OutFile $target
  }
}
Write-Output 'Project skills prepared; existing installations preserved. Available on the next Codex turn.'
