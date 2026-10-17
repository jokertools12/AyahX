# Syncs MCP, skills, and a local Cursor plugin so they stay available for
# every Cursor login on this Windows user. OAuth still happens once per account.
param(
  [switch]$SkipRailwayCli
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$cursorHome = Join-Path $env:USERPROFILE '.cursor'
$skillDest = Join-Path $cursorHome 'skills'
$pluginDest = Join-Path $cursorHome 'plugins\local\ayahx-agent-stack'
$userMcp = Join-Path $cursorHome 'mcp.json'
$projectMcp = Join-Path $root '.cursor\mcp.json'
New-Item -ItemType Directory -Force -Path $skillDest | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $pluginDest '.cursor-plugin') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $pluginDest 'skills') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $env:USERPROFILE '.cache\playwright-mcp\chrome-profile') | Out-Null

function Copy-SkillTree([string]$Source, [string]$Destination) {
  if (-not (Test-Path -LiteralPath $Source)) { return }
  robocopy $Source $Destination /E /XO /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy failed for $Source (exit $LASTEXITCODE)" }
}

Copy-SkillTree (Join-Path $root '.agents\skills') $skillDest
Copy-SkillTree (Join-Path $env:USERPROFILE '.config\opencode\skills') $skillDest
Copy-SkillTree (Join-Path $env:USERPROFILE '.codex\skills\use-railway') (Join-Path $skillDest 'use-railway')
$cloudFsSkill = Join-Path $env:USERPROFILE '.opencode\mcp\cloud-fs\node_modules\@nogoo9\mcp-server-cloud-fs\skills\cloud-fs'
Copy-SkillTree $cloudFsSkill (Join-Path $skillDest 'cloud-fs')
foreach ($pluginName in @('cloudflare-security', 'cloudflare-data-security')) {
  $cfRoot = Join-Path $env:USERPROFILE ".codex\plugins\cache\openai-curated-remote\$pluginName"
  if (Test-Path -LiteralPath $cfRoot) {
    $latest = Get-ChildItem $cfRoot -Directory | Sort-Object Name -Descending | Select-Object -First 1
    if ($latest) { Copy-SkillTree (Join-Path $latest.FullName 'skills') $skillDest }
  }
}

$mergeJs = @'
const fs = require('fs');
const path = require('path');
const userMcp = process.argv[1];
const projectMcp = process.argv[2];
const home = process.env.USERPROFILE;
const cloudFs = path.join(home, '.opencode/mcp/cloud-fs/node_modules/@nogoo9/mcp-server-cloud-fs/dist/index.js');
const portable = JSON.parse(fs.readFileSync(projectMcp, 'utf8'));
let existing = { mcpServers: {} };
if (fs.existsSync(userMcp)) {
  existing = JSON.parse(fs.readFileSync(userMcp, 'utf8'));
  existing.mcpServers = existing.mcpServers || {};
}
Object.assign(existing.mcpServers, portable.mcpServers || {});
if (fs.existsSync(cloudFs) && !existing.mcpServers['r2-ayahx']) {
  existing.mcpServers['r2-ayahx'] = {
    command: 'C:\\Program Files\\nodejs\\node.exe',
    args: [cloudFs, 's3', 's3://ayahx-audio-prod', 's3://ayahx-audio-staging', '--endpoint', 'https://495659d0e5a689a32e39119fb56190a3.r2.cloudflarestorage.com', '--region', 'auto', '--no-cache'],
    env: { AWS_PROFILE: 'r2-ayahx' }
  };
}
fs.writeFileSync(userMcp, JSON.stringify(existing, null, 2) + '\n');
'@
$mergeFile = Join-Path $env:TEMP 'ayahx-merge-cursor-mcp.js'
[System.IO.File]::WriteAllText($mergeFile, $mergeJs)
node $mergeFile $userMcp $projectMcp
Remove-Item -LiteralPath $mergeFile -Force

Copy-Item -LiteralPath $projectMcp -Destination (Join-Path $pluginDest 'mcp.json') -Force
@'
{
  "name": "ayahx-agent-stack",
  "description": "AyahX Railway, Cloudflare, browser MCP, and operational skills for any Cursor login on this machine.",
  "version": "1.0.0",
  "author": { "name": "AyahX" },
  "skills": "./skills/",
  "mcpServers": "./mcp.json"
}
'@ | Set-Content -LiteralPath (Join-Path $pluginDest '.cursor-plugin\plugin.json') -Encoding utf8
Copy-SkillTree (Join-Path $skillDest 'use-railway') (Join-Path $pluginDest 'skills\use-railway')
Copy-SkillTree (Join-Path $skillDest 'cloud-fs') (Join-Path $pluginDest 'skills\cloud-fs')

if (-not $SkipRailwayCli -and (Get-Command railway -ErrorAction SilentlyContinue)) {
  railway skills update --agent cursor | Out-Host
}

$skillCount = @(Get-ChildItem $skillDest -Directory -ErrorAction SilentlyContinue).Count
Write-Output "Cursor skills: $skillDest ($skillCount)"
Write-Output "User MCP: $userMcp"
Write-Output "Project MCP: $projectMcp"
Write-Output "Local plugin: $pluginDest"
Write-Output 'Marketplace plugins stay in this Cursor install. After a new Cursor login, authenticate Railway and Cloudflare once.'
