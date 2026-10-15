[CmdletBinding()]
param(
    [ValidateSet('Preview', 'Check', 'Start')]
    [string]$Mode = 'Preview'
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$planRoot = Join-Path $repoRoot 'AyahX_Enterprise_Plan_Package_2026-10-14'
$promptPath = Join-Path $repoRoot '.codex/prompts/start-enterprise.ar.md'
foreach ($required in @(
    'AGENTS.md', '.codex/config.toml', '.codex/ORCHESTRATION.md',
    '.codex/agents/ayahx_luna.toml', '.codex/agents/ayahx_sol.toml',
    '.codex/agents/ayahx_astra.toml',
    'docs/implementation/ayahx-plan/NEXT_SESSION.md',
    'AyahX_Enterprise_Plan_Package_2026-10-14/00_PLAN/IMPLEMENTATION_TASKS.md',
    '.codex/prompts/start-enterprise.ar.md'
)) {
    if (-not (Test-Path -LiteralPath (Join-Path $repoRoot $required) -PathType Leaf)) {
        throw "Missing required file: $required"
    }
}

if ($Mode -eq 'Preview') {
    [pscustomobject]@{
        Mode = 'Preview - no model call or implementation'
        Project = $repoRoot
        Plan = $planRoot
        Coordinator = 'gpt-6.1-sol / medium'
        Subagents = 'gpt-6-luna / medium; gpt-6.1-sol / medium; gpt-6-astra / low'
        MaxSubagents = 2
        Prompt = $promptPath
        StartCommand = '.\tooling\codex.ps1 -Mode Start'
    } | Format-List
    return
}

$codexCommand = (Get-Command codex -CommandType Application -ErrorAction Stop).Source
if ($Mode -eq 'Check') {
    & $codexCommand --strict-config -C $repoRoot doctor --summary
    if ($LASTEXITCODE -ne 0) { throw "Codex doctor failed: $LASTEXITCODE" }
    $catalogText = & $codexCommand -C $repoRoot debug models
    if ($LASTEXITCODE -ne 0) { throw "Codex model catalog failed: $LASTEXITCODE" }
    $catalog = ($catalogText -join "`n") | ConvertFrom-Json
    foreach ($model in @('gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-luna')) {
        if (-not ($catalog.models | Where-Object { $_.slug -eq $model })) {
            throw "Requested model missing from catalog: $model. No substitution was made."
        }
        Write-Output "Catalog contains $model"
    }
    Write-Output 'Configuration/catalog check complete. No inference or implementation started.'
    return
}

# Explicit Start enters interactive Codex; it does not schedule a background job.
$prompt = "Project root: $repoRoot`nPlan root: $planRoot`n`n" +
    (Get-Content -LiteralPath $promptPath -Raw -Encoding UTF8)
& $codexCommand --cd $repoRoot --model gpt-6.1-sol -c 'model_reasoning_effort="medium"' $prompt
exit $LASTEXITCODE
