$ErrorActionPreference = 'Stop'
$sentinel = 'GSTACK_PR1743_WINDOWS_DPAPI_SENTINEL_d4f531ce6a'
$transcript = New-Object System.Collections.Generic.List[string]
$ProbeRoot = $env:GSTACK_PR1743_PROBE_ROOT
$GstackRoot = $env:GSTACK_UNDER_TEST
$ConsumerRoot = $env:GSTACK_PR_TEST_CONSUMER
$IsolatedHome = $env:GSTACK_PR_TEST_HOME
$StateRoot = $env:GSTACK_PR_TEST_STATE
$ArtifactRoot = $env:GSTACK_PR_TEST_ARTIFACT_ROOT
$RepoId = $env:GSTACK_PR_TEST_REPO
$Phase = $env:GSTACK_PR_TEST_PHASE

function Add-SafeOutput([object[]]$Lines) {
  foreach ($line in $Lines) {
    $text = [string]$line
    $transcript.Add($text)
  }
}

if ($env:OS -ne 'Windows_NT') {
  Write-Output '{"ok":false,"error":"host-is-not-windows"}'
  exit 60
}
if ([string]::IsNullOrWhiteSpace($ProbeRoot) -or
    [string]::IsNullOrWhiteSpace($GstackRoot) -or
    [string]::IsNullOrWhiteSpace($ConsumerRoot) -or
    [string]::IsNullOrWhiteSpace($IsolatedHome) -or
    [string]::IsNullOrWhiteSpace($StateRoot) -or
    [string]::IsNullOrWhiteSpace($ArtifactRoot) -or
    [string]::IsNullOrWhiteSpace($RepoId) -or
    ($Phase -ne 'baseline' -and $Phase -ne 'candidate')) {
  Write-Output '{"ok":false,"error":"missing-safe-wrapper-context"}'
  exit 63
}

[IO.Directory]::CreateDirectory($IsolatedHome) | Out-Null
[IO.Directory]::CreateDirectory($StateRoot) | Out-Null
[IO.Directory]::CreateDirectory($ArtifactRoot) | Out-Null
[IO.Directory]::CreateDirectory((Join-Path $StateRoot 'tmp')) | Out-Null
$env:HOME = $IsolatedHome
$env:USERPROFILE = $IsolatedHome
$env:TMP = Join-Path $StateRoot 'tmp'
$env:TEMP = $env:TMP
$env:GSTACK_HOME = $StateRoot
$env:GSTACK_UNDER_TEST = $GstackRoot
$env:GSTACK_PR_TEST_REPO = $RepoId
Set-Location -LiteralPath $ConsumerRoot

$nodeProbe = Join-Path $ProbeRoot 'probe\node-spawn-matrix.mjs'
$nodeLines = & node $nodeProbe 2>&1
$nodeExit = $LASTEXITCODE
Add-SafeOutput $nodeLines

$coreExit = 0
if ($RepoId -ne 'stagehand') {
  $fixtureScript = Join-Path $ProbeRoot 'windows\create-dpapi-cookie-fixture.ts'
  $protectScript = Join-Path $ProbeRoot 'windows\protect-dpapi-key.ps1'
  $coreScript = Join-Path $ProbeRoot 'windows\dpapi-core-probe.ts'

  $fixtureLines = & bun $fixtureScript $IsolatedHome 2>&1
  $fixtureExit = $LASTEXITCODE
  Add-SafeOutput $fixtureLines
  if ($fixtureExit -ne 0) { $coreExit = $fixtureExit }

  if ($coreExit -eq 0) {
    try {
      $protectLines = & $protectScript -IsolatedHome $IsolatedHome 2>&1
      Add-SafeOutput $protectLines
    } catch {
      Add-SafeOutput @('{"dpapi_fixture_protection":false,"error":"powershell-protection-failed"}')
      $coreExit = 61
    }
  }

  if ($coreExit -eq 0) {
    $coreLines = & bun $coreScript $GstackRoot $IsolatedHome 2>&1
    $coreExit = $LASTEXITCODE
    Add-SafeOutput $coreLines
  }
} else {
  Add-SafeOutput @('{"dpapi":"negative-control-skipped","reason":"native-node-control"}')
}

$leaked = $false
foreach ($line in $transcript) {
  if ($line.Contains($sentinel)) { $leaked = $true; break }
}

if ($leaked) {
  Write-Output '{"ok":false,"sentinelLeak":true}'
  exit 62
}

foreach ($line in $transcript) { Write-Output $line }
$ok = ($nodeExit -eq 0 -and $coreExit -eq 0)
$summary = ConvertTo-Json -Compress @{
  repo = $RepoId
  phase = $Phase
  nodeExit = $nodeExit
  dpapiCoreExit = $coreExit
  sentinelLeak = $false
  ok = $ok
}
Write-Output $summary
[IO.File]::WriteAllText(
  (Join-Path $ArtifactRoot "pr1743-$RepoId-$Phase-summary.json"),
  "$summary`n",
  [Text.UTF8Encoding]::new($false)
)
exit $(if ($ok) { 0 } else { 1 })
