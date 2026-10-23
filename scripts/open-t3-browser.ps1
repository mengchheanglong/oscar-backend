param([string]$ThreadUrl)
$ErrorActionPreference = 'Stop'
$installedRoot = Join-Path $env:LOCALAPPDATA 'Programs\t3code'
$executable = Join-Path $installedRoot 'T3 Code (Beta).exe'
$serverDirectory = Join-Path $installedRoot 'resources\server.asar\apps\server\dist'
$runner = Join-Path $PSScriptRoot 't3-cli.cjs'
$dataRoot = if ($env:T3CODE_HOME) { $env:T3CODE_HOME } else { Join-Path $env:USERPROFILE '.t3' }
$outputPath = Join-Path $env:TEMP ([guid]::NewGuid().ToString() + '.t3-pair.out')
$errorPath = Join-Path $env:TEMP ([guid]::NewGuid().ToString() + '.t3-pair.err')
$previousElectronMode = $env:ELECTRON_RUN_AS_NODE
try {
  $env:ELECTRON_RUN_AS_NODE = '1'
  $arguments = '"' + $runner + '" "' + $serverDirectory + '" pair --base-dir "' + $dataRoot + '" --ttl 5m --label "OSCAR browser" --scope orchestration:read --scope orchestration:operate --scope filesystem:read --scope terminal:read --scope diagnostics:read'
  $pair = Start-Process -FilePath $executable -ArgumentList $arguments -Wait -PassThru -WindowStyle Hidden -RedirectStandardOutput $outputPath -RedirectStandardError $errorPath
  if ($pair.ExitCode -ne 0) { throw 'T3 pairing failed. Check that its existing server is running.' }
  $match = [regex]::Match([System.IO.File]::ReadAllText($outputPath), '(?im)^Pairing URL:\s*(\S+)')
  if (-not $match.Success) { throw 'T3 did not provide a pairing link.' }
  $pairUri = [uri]$match.Groups[1].Value
  if ($pairUri.Scheme -ne 'http' -or $pairUri.Host -notin @('127.0.0.1','localhost','[::1]')) {
    throw 'Expected a local T3 server. No browser was opened.'
  }
  # This is an interactive browser requested by the user; no second T3 server is started.
  Start-Process -FilePath $pairUri.AbsoluteUri
  if ($ThreadUrl) {
    $target = [uri]$ThreadUrl
    if ($target.Scheme -ne $pairUri.Scheme -or $target.Host -ne $pairUri.Host -or $target.Port -ne $pairUri.Port -or $target.UserInfo) { throw 'The thread must belong to the paired T3 server.' }
    Start-Sleep -Seconds 2
    Start-Process -FilePath $target.AbsoluteUri
  }
  Write-Output 'Opened the existing T3 server in your browser. Review any pending approval in T3.'
} finally {
  $env:ELECTRON_RUN_AS_NODE = $previousElectronMode
  foreach ($temporaryFile in @($outputPath, $errorPath)) {
    if (Test-Path -LiteralPath $temporaryFile) { Remove-Item -LiteralPath $temporaryFile }
  }
}
