param([switch]$CheckOnly, [switch]$SkipAgents)
$ErrorActionPreference = 'Stop'
$backendRoot = Split-Path -Parent $PSScriptRoot
$workspaceRoot = Split-Path -Parent $backendRoot
$frontendRoot = Join-Path $workspaceRoot 'oscar-frontend'
$runtimeRoot = Join-Path $workspaceRoot 'runtimes'
$logRoot = Join-Path $env:LOCALAPPDATA 'OSCAR\logs'

function Test-Endpoint([string]$Url) {
  try { return (Invoke-WebRequest -Uri $Url -TimeoutSec 3 -UseBasicParsing).StatusCode -eq 200 } catch { return $false }
}
function Wait-Endpoint([string]$Name, [string]$Url, [int]$TimeoutSeconds = 90) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-Endpoint $Url) { Write-Output "$Name ready: $Url"; return }
    Start-Sleep -Milliseconds 750
  }
  throw "$Name did not become ready. Check its private logs in $logRoot. Existing data and processes were preserved."
}
function Start-LocalProcess([string]$Name, [string]$File, [string[]]$Arguments, [string]$Directory) {
  New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
  $quoted = ($Arguments | ForEach-Object { '"' + $_ + '"' }) -join ' '
  $process = Start-Process -FilePath $File -ArgumentList $quoted -WorkingDirectory $Directory -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $logRoot "$Name-$stamp.out.log") -RedirectStandardError (Join-Path $logRoot "$Name-$stamp.err.log")
  Write-Output "$Name started (PID $($process.Id))."
}
function Assert-FreePort([int]$Port) {
  if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
    throw "Port $Port is occupied by a service that failed its readiness check. Inspect it before starting another process."
  }
}
function Test-LocalNodeProcess([string]$Script) {
  return [bool](Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object {
    $_.CommandLine -and $_.CommandLine.IndexOf($Script, [StringComparison]::OrdinalIgnoreCase) -ge 0
  })
}

$endpoints = [ordered]@{ Backend = 'http://127.0.0.1:43101/api/v1/health/ready'; Frontend = 'http://127.0.0.1:43100/api/v1/health/ready'; Paperclip = 'http://127.0.0.1:43103/api/health'; T3 = 'http://127.0.0.1:43102/.well-known/t3/environment' }
if ($CheckOnly) {
  $failed = $false
  foreach ($entry in $endpoints.GetEnumerator()) {
    if ($SkipAgents -and $entry.Key -in 'Paperclip','T3') { continue }
    $ready = Test-Endpoint $entry.Value
    Write-Output "$($entry.Key): $(if ($ready) { 'ready' } else { 'unavailable' })"
    if (-not $ready) { $failed = $true }
  }
  if ($failed) { exit 1 }; exit 0
}
$node = (Get-Command node.exe).Source
Push-Location $backendRoot
try {
  & $node (Join-Path $PSScriptRoot 'verify-local-target.cjs')
  if ($LASTEXITCODE -ne 0) { throw 'Refusing to start against an unexpected database.' }
  & docker compose up -d --wait postgres
  if ($LASTEXITCODE -ne 0) { throw 'Local PostgreSQL did not become ready.' }
  # The application explicitly migrates the existing local database; no seeds or resets.
  & pnpm migration:run
  if ($LASTEXITCODE -ne 0) { throw 'Migration failed. Existing data was preserved.' }
} finally { Pop-Location }
if (-not (Test-Endpoint $endpoints.Backend)) {
  Assert-FreePort 43101
  if (-not (Test-Path (Join-Path $backendRoot 'dist\main.js'))) { throw 'Build the backend with pnpm build first.' }
  Start-LocalProcess 'backend' $node @((Join-Path $backendRoot 'dist\main.js')) $backendRoot
}
Wait-Endpoint 'Backend' $endpoints.Backend
if (-not (Test-Endpoint $endpoints.Frontend)) {
  Assert-FreePort 43100
  if (-not (Test-Path (Join-Path $frontendRoot '.next\BUILD_ID'))) { throw 'Build the frontend with pnpm build first.' }
  Start-LocalProcess 'frontend' $node @((Join-Path $frontendRoot 'node_modules\next\dist\bin\next'), 'start','--port','43100','--hostname','127.0.0.1') $frontendRoot
}
Wait-Endpoint 'Frontend' $endpoints.Frontend
if (-not $SkipAgents) {
  $paperclipRoot = Join-Path $runtimeRoot 'paperclip'
  if (-not (Test-Endpoint $endpoints.Paperclip)) {
    Assert-FreePort 43103
    $paperclipScript = Join-Path $paperclipRoot 'start.cjs'
    if (Test-LocalNodeProcess $paperclipScript) {
      Write-Output 'Paperclip is already starting; waiting for the existing process.'
    } else {
      $pidFile = Join-Path $paperclipRoot 'data\instances\default\db\postmaster.pid'
      if (Test-Path -LiteralPath $pidFile) {
        $ownerId = [int](Get-Content -LiteralPath $pidFile -TotalCount 1)
        $owner = Get-Process -Id $ownerId -ErrorAction SilentlyContinue
        $listener = Get-NetTCPConnection -LocalPort 43107 -State Listen -ErrorAction SilentlyContinue
        # Windows can recycle a dead Postgres PID for another process. Preserve the stale lock instead of stopping that process.
        if (-not $listener -and (-not $owner -or $owner.ProcessName -ne 'postgres')) {
          Move-Item -LiteralPath $pidFile -Destination ($pidFile + '.stale-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
        }
      }
      Start-LocalProcess 'paperclip' $node @($paperclipScript) $paperclipRoot
    }
  }
  if (-not (Test-Endpoint $endpoints.T3)) {
    Assert-FreePort 43102
    $t3Root = Join-Path $env:LOCALAPPDATA 'Programs\t3code'
    $oldElectronMode = $env:ELECTRON_RUN_AS_NODE
    try {
      $env:ELECTRON_RUN_AS_NODE = '1'
      Start-LocalProcess 't3' (Join-Path $t3Root 'T3 Code (Beta).exe') @((Join-Path $PSScriptRoot 't3-cli.cjs'), (Join-Path $t3Root 'resources\server.asar\apps\server\dist'), 'start','--host','127.0.0.1','--port','43102','--no-browser') $workspaceRoot
    } finally { $env:ELECTRON_RUN_AS_NODE = $oldElectronMode }
  }
  Wait-Endpoint 'T3' $endpoints.T3
  # A cold Paperclip module load on Windows can exceed the normal app startup window.
  Wait-Endpoint 'Paperclip' $endpoints.Paperclip 600
}
Write-Output 'OSCAR is ready at http://127.0.0.1:43100/. OAuth and agent execution permissions remain configured in OSCAR settings.'
