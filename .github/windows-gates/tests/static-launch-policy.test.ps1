Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$gateRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$ownedLaunchers = @(
  (Join-Path $gateRoot 'common-windows.ps1'),
  (Join-Path $gateRoot 'run-model-overlays.ps1'),
  (Join-Path $gateRoot 'pr2260\run-pr2260.ps1'),
  (Join-Path $gateRoot 'pr1981\run-pr1981.ps1'),
  (Join-Path $gateRoot 'pr1743\orchestrate-pr1743.ps1')
)
$invokeCount = 0
foreach ($file in $ownedLaunchers) {
  $text = [IO.File]::ReadAllText($file)
  if ($text -match '(?i)\$home\b' -or $text -match '(?i)(^|[^\w])-Home\b') {
    throw "runner uses PowerShell's reserved HOME variable: $file"
  }
  if ($text -match '(?m)^\s*&\s+' -or $text -match '\b(Start-Process|Invoke-Expression)\b') {
    throw "unreviewed direct child launch in $file"
  }
  foreach ($line in ($text -split '\r?\n')) {
    if ($line -match '\bInvoke-LoggedProcess\b' -and $line -notmatch '^\s*function\s+Invoke-LoggedProcess') {
      $invokeCount += 1
      if ($line -notmatch '\s-Environment\s+') {
        throw "Invoke-LoggedProcess omitted fail-closed environment in $file"
      }
    }
  }
}

. (Join-Path $gateRoot 'common-windows.ps1')
$smokeRoot = Join-Path ([IO.Path]::GetTempPath()) "gstack-windows-environment-smoke-$([Guid]::NewGuid().ToString('N'))"
$smokeLockdown = $null
try {
  $smokeHome = Join-Path $smokeRoot 'home'
  $smokeTemp = Join-Path $smokeRoot 'tmp'
  $smokeEnvironment = New-SafeWindowsEnvironment -IsolatedHome $smokeHome -Temp $smokeTemp
  if ($smokeEnvironment.HOME -ne $smokeHome -or $smokeEnvironment.USERPROFILE -ne $smokeHome) {
    throw 'safe environment smoke test did not preserve the isolated home'
  }

  $smokeNetworkEvidence = Join-Path $smokeRoot 'network'
  $smokeLockdown = Enter-TestNetworkLockdown -EvidenceDirectory $smokeNetworkEvidence
  $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
  $listener.Start()
  try {
    $port = ([Net.IPEndPoint]$listener.LocalEndpoint).Port
    $acceptTask = $listener.AcceptTcpClientAsync()
    $client = [Net.Sockets.TcpClient]::new()
    try {
      $connectTask = $client.ConnectAsync('127.0.0.1', $port)
      if (-not $connectTask.Wait(5000) -or -not $acceptTask.Wait(5000)) {
        throw 'network lockdown blocked the required IPv4 loopback transport'
      }
      $acceptedClient = $acceptTask.GetAwaiter().GetResult()
      try {
        if (-not $client.Connected -or -not $acceptedClient.Connected) {
          throw 'IPv4 loopback smoke connection was not established'
        }
      } finally {
        $acceptedClient.Dispose()
      }
    } finally {
      $client.Dispose()
    }
  } finally {
    $listener.Stop()
  }
} finally {
  if ($null -ne $smokeLockdown) {
    Exit-TestNetworkLockdown -RuleName $smokeLockdown -EvidenceDirectory (Join-Path $smokeRoot 'network')
  }
  if (Test-Path -LiteralPath $smokeRoot) { Remove-Item -LiteralPath $smokeRoot -Recurse -Force }
}
if ($invokeCount -lt 20) { throw "unexpectedly small reviewed child-launch surface: $invokeCount" }

$common = [IO.File]::ReadAllText((Join-Path $gateRoot 'common-windows.ps1'))
if ($common -notmatch '\$psi\.Environment\.Clear\(\)') { throw 'common launcher does not clear inherited environment' }
if ($common -notmatch 'valuesLogged\s*=\s*\$false') { throw 'child environment evidence is not key-only' }
if ($common -match 'record\.values') { throw 'child environment values are serialized' }
if ($common -notmatch '(?s)function Enter-TestNetworkLockdown.+?catch\s*\{.+?Remove-NetFirewallRule.+?Get-NetFirewallRule.+?throw') {
  throw 'network lockdown setup lacks internal exception-safe cleanup'
}

foreach ($runner in $ownedLaunchers | Where-Object { $_ -notmatch 'common-windows\.ps1$' }) {
  $text = [IO.File]::ReadAllText($runner)
  if ($text -notmatch '\bNew-SafeWindowsEnvironment\b') { throw "runner omitted safe environment builder: $runner" }
  if ($text -notmatch '\bEnter-TestNetworkLockdown\b' -or $text -notmatch '\bExit-TestNetworkLockdown\b' -or $text -notmatch '\bfinally\b') {
    throw "runner omitted try/finally network restoration: $runner"
  }
}

$modelRunner = [IO.File]::ReadAllText((Join-Path $gateRoot 'run-model-overlays.ps1'))
$pr2260Runner = [IO.File]::ReadAllText((Join-Path $gateRoot 'pr2260\run-pr2260.ps1'))
foreach ($entry in @(
  @{ Name = 'model overlays'; Text = $modelRunner },
  @{ Name = 'PR2260'; Text = $pr2260Runner }
)) {
  if ($entry.Text -notmatch 'build-node-server\.sh' -or $entry.Text -notmatch 'server-node\.mjs') {
    throw "$($entry.Name) omitted the required Windows Node server bundle setup"
  }
}

$pr1981Runner = [IO.File]::ReadAllText((Join-Path $gateRoot 'pr1981\run-pr1981.ps1'))
if ($pr1981Runner -notmatch 'gbrain\.cmd' -or $pr1981Runner -notmatch 'Join-Path \$gbrainBin ''gbrain''' -or $pr1981Runner -match "@\('build',\s*'--compile'.*gbrain") {
  throw 'PR1981 did not use the source-backed official Windows gbrain launcher'
}
if ($pr2260Runner -notmatch "Remove\('MSYS_NO_PATHCONV'\)") {
  throw 'PR2260 Windows server build retained probe-only MSYS path suppression'
}
$dpapiProbe = [IO.File]::ReadAllText((Join-Path $gateRoot 'pr1743\windows\dpapi-core-probe.ts'))
if ($dpapiProbe -notmatch "typeof globalThis\.Bun !== 'undefined'" -or $dpapiProbe -notmatch 'if \(!hasNativeBun\)') {
  throw 'PR1743 DPAPI probe would overwrite native Bun with the Node polyfill'
}

$runtimeText = ($ownedLaunchers | ForEach-Object { [IO.File]::ReadAllText($_) }) -join [Environment]::NewLine
if ($runtimeText -match 'git\s+clone\s+https?://' -or $runtimeText -match 'Invoke-WebRequest|curl\s+https?://|wget\s+https?://') {
  throw 'runtime launcher contains unapproved direct network fetch'
}
Write-Output "STATIC_LAUNCH_POLICY_OK reviewedInvocations=$invokeCount"
