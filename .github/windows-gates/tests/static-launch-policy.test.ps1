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

$runtimeText = ($ownedLaunchers | ForEach-Object { [IO.File]::ReadAllText($_) }) -join [Environment]::NewLine
if ($runtimeText -match 'git\s+clone\s+https?://' -or $runtimeText -match 'Invoke-WebRequest|curl\s+https?://|wget\s+https?://') {
  throw 'runtime launcher contains unapproved direct network fetch'
}
Write-Output "STATIC_LAUNCH_POLICY_OK reviewedInvocations=$invokeCount"
